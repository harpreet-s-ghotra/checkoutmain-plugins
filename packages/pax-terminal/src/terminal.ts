import * as net from 'net'
import {
  ACK,
  HOST_APPROVAL_CODE,
  STX,
  TransType,
  buildLocalDetailReportRequest,
  buildRecordReportRequest,
  buildReturnRequest,
  buildSaleRequest,
  buildVoidRequest,
  describeDetailReport,
  describeResponse,
  frame,
  hasCompleteFrame,
  isPartialApproval,
  parseLocalDetailReport,
  parseResponse,
  parseTerminalTime,
  readDetailReport,
  unframe,
  APPROVAL_CODE
} from './protocol'
import type { DetailRecord } from './protocol'
import { createTerminalLock } from './lock'
import type { PaxCommandPolicy, TerminalLock } from './lock'
import { resolveConfig } from './types'
import type {
  PaxChargeResult,
  PaxLogger,
  PaxLookupCheckResult,
  PaxLookupCheckStatus,
  PaxOperation,
  PaxProbeResult,
  PaxReportEvent,
  PaxTerminalConfig,
  PaxTerminalOptions,
  ResolvedTerminalConfig,
  TerminalSaleInput
} from './types'

// Post-connect transaction window: the whole time the terminal is prompting the
// customer to insert/tap and dip through the host. This is dwell time, not our
// latency, so it must comfortably exceed how long an unhurried customer takes —
// 60 s was close enough to the real spread that some sales timed out mid-dip.
// 75 s clears the slowest approval recorded in production (71 s; p90 19 s,
// p99 36 s over 6,767 approvals) without making a cashier wait two minutes on a
// terminal that has gone silent.
export const DEFAULT_TIMEOUT_MS = 75_000
// Floor for a `timeout_ms` override. The terminal's own card-entry window is
// 30 s (it answers 100001 TIMEOUT at ~30.7 s), and approvals have been measured
// at up to 71 s end to end; an override below this would make our socket give
// up while the terminal is still mid-transaction — the one timeout whose outcome
// is genuinely unknown.
export const MIN_TRANSACTION_TIMEOUT_MS = 60_000
const CONNECT_TIMEOUT_MS = 5_000
// A healthy socket hands a single ACK byte to the OS in microseconds; this
// bound only exists so a wedged socket can never hang a live sale waiting on the
// flush callback. The charge has already approved by this point.
const ACK_FLUSH_TIMEOUT_MS = 2_000

// Looking a silent sale up in the terminal's batch: a few short tries, a moment
// apart, so a terminal still storing the record gets the chance to. Bounded so
// the cashier, who has already waited out the transaction window, waits at most
// about half a minute more.
const RECOVERY_ATTEMPTS = 3
const RECOVERY_TIMEOUT_MS = 10_000
const RECOVERY_GAP_MS = 2_000
const LOOKUP_CHECK_DELAY_MS = 5_000

/** How far a terminal's clock may run behind the register's and a record still count as after the sale. */
const CLOCK_TOLERANCE_MS = 5 * 60_000

const MAX_UNRESOLVED = 20
const MAX_KNOWN_UIDS = 200

/**
 * The terminal acknowledged the request (its single ACK byte arrived) and then
 * never sent an answer. It took the sale, so the card may well have been
 * charged: the one failure worth asking the terminal about. For a sale that
 * stayed unknown after the lookup, `ecrRef` names it so the next attempt on the
 * same payment can pass it back as `retryOf`.
 */
export class PaxNoAnswerError extends Error {
  ecrRef: string | null = null
  constructor(conn: ResolvedTerminalConfig) {
    super(`PAX terminal timed out after accepting the request (${conn.host}:${conn.port})`)
    this.name = 'PaxNoAnswerError'
  }
}

/** The post-connect socket timeout for a terminal command. */
export function transactionTimeoutMs(conn: PaxTerminalConfig): number {
  const configured = conn.timeout_ms
  if (typeof configured !== 'number' || !Number.isFinite(configured)) return DEFAULT_TIMEOUT_MS
  return Math.max(configured, MIN_TRANSACTION_TIMEOUT_MS)
}

/** The cashier-facing message when the terminal can't be reached at all. */
function unreachableMessage(conn: ResolvedTerminalConfig): string {
  return (
    `Card terminal unreachable (${conn.host}:${conn.port}) — check that it is powered on ` +
    `and connected to the network`
  )
}

/** Network errors that mean "nothing answered at that address/port". */
function isConnectFailure(err: NodeJS.ErrnoException): boolean {
  return (
    err.code === 'ETIMEDOUT' ||
    err.code === 'ECONNREFUSED' ||
    err.code === 'EHOSTUNREACH' ||
    err.code === 'ENETUNREACH' ||
    err.code === 'EHOSTDOWN'
  )
}

const noop = (): void => undefined
const silentLogger: PaxLogger = { debug: noop, info: noop, warn: noop, error: noop }

/**
 * ECR reference sent with every request. Seeded from the clock, not from zero,
 * so a restart does not send the references of earlier sales again: a sale is
 * looked up in the terminal's batch by this reference, which only works while
 * it names one transaction. Shared across every terminal in the process.
 */
let ecrCounter = Math.floor(Date.now() / 1000) % 1_000_000

/**
 * Sales whose outcome stayed unknown, by ECR reference → what was asked and
 * when. The payment screen passes one back as `retryOf` when the cashier
 * presses Card again, and the terminal is asked about it before a second
 * charge. Bounded: only the latest few matter.
 */
type UnresolvedSale = { cents: number; startedAt: number }

/** The last fully approved sale, the one a lookup check asks the terminal for. */
type ApprovedSale = { ecrRef: string; cents: number; result: PaxChargeResult }

/**
 * Everything that has to be shared by every `createPaxTerminal` pointed at one
 * physical terminal: the lock, the sales still unknown, the GLOBALUIDs taken
 * since the process started (so a batch record is never mistaken for a new
 * sale), and the lookup check's once-a-day state.
 */
type TerminalState = {
  lock: TerminalLock
  unresolved: Map<string, UnresolvedSale>
  knownUids: Set<string>
  lastApproved: ApprovedSale | null
  lookupCheckedOn: string | null
  lookupCheckTimer: ReturnType<typeof setTimeout> | null
}

const states = new Map<string, TerminalState>()

function stateFor(conn: ResolvedTerminalConfig): TerminalState {
  const key = `${conn.host}:${conn.port}`
  let s = states.get(key)
  if (!s) {
    s = {
      lock: createTerminalLock(),
      unresolved: new Map(),
      knownUids: new Set(),
      lastApproved: null,
      lookupCheckedOn: null,
      lookupCheckTimer: null
    }
    states.set(key, s)
  }
  return s
}

function localDay(at: Date): string {
  const p = (n: number): string => String(n).padStart(2, '0')
  return `${at.getFullYear()}-${p(at.getMonth() + 1)}-${p(at.getDate())}`
}

const LOOKUP_CHECK_MESSAGES: Record<PaxLookupCheckStatus, string> = {
  works: 'Sale lookup works: the terminal returned the last card sale and it matched.',
  'works-recent':
    'Sale lookup works by newest record: this terminal does not find sales by our reference, but its newest record was the last card sale.',
  mismatch: 'The terminal returned a record, but it did not match the last card sale.',
  'not-found': 'The terminal did not return the last card sale.',
  'no-answer': 'The terminal did not answer the sale lookup.',
  busy: 'The terminal is busy. Try again when no sale is on it.',
  'no-sale': 'No card sale yet since the app started. Run one, then check again.'
}

const BUSY_MESSAGE = 'Terminal is processing a transaction — not probed'

const delay = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

/** `Omit` that keeps a union's members apart. */
type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never
type ReportInput = DistributiveOmit<PaxReportEvent, 'terminal'>

/** A PAX terminal: the commands a POS sends it, each safe to call from anywhere. */
export type PaxTerminal = {
  readonly config: ResolvedTerminalConfig
  /**
   * Card-present sale. Resolves with the terminal's answer — a decline is a
   * result with `success: false`, not an exception. Rejects with
   * `PaxTerminalBusyError` (another command is open, nothing was sent),
   * `PaxNoAnswerError` (accepted, never answered, not found in the batch —
   * outcome unknown) or an `Error` naming the address when unreachable.
   */
  sale(input: TerminalSaleInput): Promise<PaxChargeResult>
  /**
   * Standalone ("blind") card credit: a RETURN with a fresh reference and no
   * original sale. The terminal prompts for a card and credits it. For returns
   * with no receipt. Same errors as `sale`.
   */
  standaloneCredit(input: { cents: number }): Promise<PaxChargeResult>
  /** RETURN against a prior sale's `reference`, partial or full. Waits its turn if the terminal is busy. */
  refund(reference: string, cents: number): Promise<PaxChargeResult>
  /** VOID a prior sale by its `reference`. Waits its turn if the terminal is busy. */
  voidSale(reference: string): Promise<PaxChargeResult>
  /**
   * Reachability probe: a plain TCP connect, closed as soon as it opens. No
   * POSLink bytes are written, so the terminal never sees a command. Skipped
   * (`skipped: true`) while a command is on the terminal.
   */
  test(): Promise<PaxProbeResult>
  /**
   * Ask the terminal for the last sale it approved and compare the record with
   * what came back at the time — proving the recovery lookup on a good sale
   * instead of waiting for a lost one. Runs automatically once a day shortly
   * after the first approval; call it for a "Check sale lookup" button.
   */
  checkSaleLookup(trigger?: 'daily' | 'manual'): Promise<PaxLookupCheckResult>
  /** True while a command is running or queued on this terminal. */
  isBusy(): boolean
}

export function createPaxTerminal(
  config: PaxTerminalConfig,
  options: PaxTerminalOptions = {}
): PaxTerminal {
  const conn = resolveConfig(config)
  const state = stateFor(conn)
  const { lock } = state
  const log: PaxLogger = { ...silentLogger, ...options.log }
  const terminalId = `${conn.host}:${conn.port}`
  const ecrPrefix = options.ecrPrefix ?? 'ECR'
  const ecrPattern = new RegExp(`^${ecrPrefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\d{6}$`)
  const timing = {
    connectTimeoutMs: options.timing?.connectTimeoutMs ?? CONNECT_TIMEOUT_MS,
    recoveryAttempts: options.timing?.recoveryAttempts ?? RECOVERY_ATTEMPTS,
    recoveryTimeoutMs: options.timing?.recoveryTimeoutMs ?? RECOVERY_TIMEOUT_MS,
    recoveryGapMs: options.timing?.recoveryGapMs ?? RECOVERY_GAP_MS,
    lookupCheckDelayMs: options.timing?.lookupCheckDelayMs ?? LOOKUP_CHECK_DELAY_MS
  }

  // ── Host hooks, each wrapped so it can never surface as a failure to charge ──

  function report(event: ReportInput): void {
    if (!options.report) return
    try {
      options.report({ terminal: terminalId, ...event } as PaxReportEvent)
    } catch (err) {
      log.warn(`report hook failed: ${err instanceof Error ? err.message : String(err)}`)
    }
  }

  function metric(name: string, label: string): void {
    if (!options.metric) return
    try {
      options.metric(name, label)
    } catch (err) {
      log.warn(`metric hook failed: ${err instanceof Error ? err.message : String(err)}`)
    }
  }

  function isKnownUid(uid: string): boolean {
    if (!uid) return false
    if (state.knownUids.has(uid)) return true
    if (!options.isKnownReference) return false
    try {
      return options.isKnownReference(uid)
    } catch {
      return false
    }
  }

  function rememberUid(uid: string): void {
    if (!uid) return
    state.knownUids.delete(uid)
    state.knownUids.add(uid)
    while (state.knownUids.size > MAX_KNOWN_UIDS) {
      state.knownUids.delete(state.knownUids.values().next().value as string)
    }
  }

  function rememberUnresolved(ecrRef: string, sale: UnresolvedSale): void {
    state.unresolved.set(ecrRef, sale)
    while (state.unresolved.size > MAX_UNRESOLVED) {
      state.unresolved.delete(state.unresolved.keys().next().value as string)
    }
  }

  function nextEcrRef(): string {
    ecrCounter = (ecrCounter + 1) % 1_000_000
    return `${ecrPrefix}${String(ecrCounter).padStart(6, '0')}`
  }

  // ── Transport ──

  /**
   * Open a socket to the terminal, write the framed request, and resolve with
   * the complete framed response.
   */
  function send(
    request: Buffer,
    context?: { amountCents: number; operation: PaxOperation },
    timeoutMs = transactionTimeoutMs(conn)
  ): Promise<Buffer> {
    return new Promise((resolve, reject) => {
      const socket = new net.Socket()
      const chunks: Buffer[] = []
      let settled = false
      let connected = false

      const received = (): Buffer => Buffer.concat(chunks)
      const finish = (err: Error | null, value?: Buffer): void => {
        if (settled) return
        settled = true
        socket.destroy()
        if (err) reject(err)
        else resolve(value!)
      }

      // Finalize a fully-received response: ACK the terminal so it completes the
      // sale and returns to idle, THEN tear the socket down. Node's
      // socket.destroy() does NOT flush queued writes, so destroying in the same
      // tick as the ACK write can drop that byte before it reaches the wire — the
      // terminal never gets the finalize handshake and is left displaying the
      // sale as still pending ("ready to charge") even though the charge
      // approved. So we wait for the ACK to be handed to the OS (the write
      // callback) before destroying, and never let this step block the sale: the
      // charge already approved, so we always resolve with the response, and a
      // flush failure is reported, not thrown.
      const finalize = (buf: Buffer): void => {
        if (settled) return
        settled = true

        let flushDone = false
        let flushTimer: ReturnType<typeof setTimeout> | null = null
        const complete = (ackErr: Error | null): void => {
          if (flushDone) return
          flushDone = true
          if (flushTimer) clearTimeout(flushTimer)
          if (ackErr) {
            log.error(
              `ACK to ${terminalId} did not flush after an approved charge — ` +
                `terminal may remain armed: ${ackErr.message}`
            )
            if (context) {
              report({
                stage: 'finalize',
                operation: context.operation,
                requestedCents: context.amountCents,
                error: ackErr.message
              })
            }
          }
          socket.destroy()
          resolve(buf)
        }

        flushTimer = setTimeout(
          () => complete(new Error('ACK flush timed out')),
          ACK_FLUSH_TIMEOUT_MS
        )
        flushTimer.unref?.()

        try {
          socket.write(Buffer.from([ACK]), (err) => complete(err ?? null))
        } catch (err) {
          complete(err instanceof Error ? err : new Error(String(err)))
        }
      }

      // Fail fast while CONNECTING: a healthy terminal accepts TCP in
      // milliseconds, so anything beyond a few seconds means it is off, on a
      // different IP, or off the network — don't make the cashier sit through
      // the OS's ~21 s ETIMEDOUT. Once connected, switch to the long transaction
      // timeout (the customer still has to insert/tap their card).
      socket.setTimeout(timing.connectTimeoutMs)

      log.debug(`→ ${terminalId} sending ${request.length}B: ${request.toString('hex')}`)

      socket.connect(conn.port, conn.host, () => {
        connected = true
        socket.setTimeout(timeoutMs)
        socket.write(request, (err) => {
          if (err) finish(err)
        })
      })

      socket.on('data', (chunk) => {
        chunks.push(chunk)
        const buf = received()
        log.debug(`← received ${buf.length}B: ${buf.toString('hex')}`)
        if (hasCompleteFrame(buf)) {
          finalize(buf)
        }
      })

      socket.on('timeout', () => {
        if (!connected) {
          log.warn(`connect timeout to ${terminalId}`)
          finish(new Error(unreachableMessage(conn)))
          return
        }
        const got = received()
        log.warn(`timeout after ${got.length}B from ${terminalId}`)
        // An ACK with no frame behind it: the terminal accepted the request.
        if (got.length > 0 && got.indexOf(STX) < 0) finish(new PaxNoAnswerError(conn))
        else finish(new Error(`PAX terminal timed out (${terminalId})`))
      })

      socket.on('error', (err) => {
        if (!connected && isConnectFailure(err)) {
          log.warn(`connect failed to ${terminalId}: ${err.message}`)
          finish(new Error(unreachableMessage(conn)))
          return
        }
        finish(err)
      })

      socket.on('close', () => {
        if (settled) return
        const got = received()
        // Surface any partial bytes the terminal sent before closing — invaluable
        // for diagnosing a rejected/malformed request.
        log.warn(
          `connection closed with ${got.length}B received` +
            (got.length ? `: ${got.toString('hex')}` : ' (no data)')
        )
        finish(
          new Error(
            got.length
              ? `PAX terminal closed after sending ${got.length} bytes (incomplete frame)`
              : 'PAX terminal closed the connection without responding (request likely rejected)'
          )
        )
      })
    })
  }

  /** Log a response and, when it was not a clean full approval, report it. Never throws. */
  function noteResponse(payload: string, requestedCents: number, operation: PaxOperation): void {
    try {
      const summary = describeResponse(payload)
      const partial = isPartialApproval(summary, requestedCents)
      const approved = summary.responseCode === APPROVAL_CODE
      log.info(
        `${operation} response ${summary.responseCode} ${summary.responseMessage} ` +
          `host=${summary.hostCode} ${summary.hostMessage} amount=${summary.approveAmountCents ?? ''}` +
          `/${requestedCents} brand=${summary.cardBrand} last4=${summary.lastFour} ` +
          `trace=${summary.trace} uid=${summary.globalUid}`
      )
      if (approved && !partial) return
      report({
        stage: 'response',
        operation,
        requestedCents,
        kind: partial ? 'partial' : 'decline',
        summary
      })
    } catch (err) {
      log.warn(`response report skipped: ${err instanceof Error ? err.message : String(err)}`)
    }
  }

  function reportError(requestedCents: number, operation: PaxOperation, err: unknown): void {
    const message = err instanceof Error ? err.message : String(err)
    report({
      stage: 'error',
      operation,
      requestedCents,
      kind: /unreachable|timed out|closed the connection/i.test(message)
        ? 'unreachable'
        : 'protocol',
      error: message
    })
  }

  /**
   * Send a framed request, unframe the response, and report every failure
   * shape: unreachable/timeout (send throws), corrupt frame (unframe throws),
   * and declines/partials (via noteResponse). All four operations route through
   * here so refunds and voids report identically to sales.
   */
  async function exchange(
    request: Buffer,
    amountCents: number,
    operation: PaxOperation,
    policy: PaxCommandPolicy,
    recover?: () => Promise<Buffer | null>
  ): Promise<string> {
    let raw: Buffer
    try {
      // One command on the terminal at a time. A busy rejection happens before
      // any byte is sent, so it is thrown straight to the caller without a report
      // (nothing reached the card). A recovery lookup runs inside the same turn,
      // so nothing else reaches the terminal between the silent request and the
      // question about it.
      raw = await lock.run(operation, policy, async () => {
        try {
          return await send(request, { amountCents, operation })
        } catch (err) {
          if (!recover || !(err instanceof PaxNoAnswerError)) throw err
          const recovered = await recover()
          if (recovered) return recovered
          throw err
        }
      })
    } catch (err) {
      if (err instanceof Error && err.name === 'PaxTerminalBusyError') {
        log.warn(`${operation} refused: ${err.message}`)
        throw err
      }
      reportError(amountCents, operation, err)
      throw err
    }
    let payload: string
    try {
      payload = unframe(raw)
    } catch (err) {
      // A malformed frame / failed LRC must not bypass reporting by throwing
      // after the send.
      reportError(amountCents, operation, err)
      throw err
    }
    noteResponse(payload, amountCents, operation)
    return payload
  }

  // ── Recovery: a sale the terminal accepted and never answered ──

  type ReportAnswer = { payload: string; summary: string }

  /** Send one report request and log what came back, as a support row will carry it. */
  async function askReport(request: Buffer, label: string): Promise<ReportAnswer> {
    const payload = unframe(await send(request, undefined, timing.recoveryTimeoutMs))
    const summary = describeDetailReport(payload)
    log.info(`lookup ${label}: ${summary}`)
    return { payload, summary }
  }

  /**
   * Why a batch record is not the sale sent as `ecrRef` for `cents` at
   * `startedAt`, or null when nothing rules it out: a full approval of a SALE for
   * the same amount, not a sale this register already has, not another of our
   * references, stamped no earlier than the sale less the clock tolerance.
   */
  function recordMismatch(
    record: DetailRecord,
    ecrRef: string,
    cents: number,
    startedAt: number
  ): string | null {
    if (record.hostCode !== HOST_APPROVAL_CODE)
      return `not approved (host ${record.hostCode || '?'})`
    if (record.transType !== TransType.SALE) return `not a sale (type ${record.transType || '?'})`
    if (record.approvedCents !== cents)
      return `amount ${record.approvedCents ?? '?'} is not ${cents}`
    if (record.ecrRef && record.ecrRef !== ecrRef && ecrPattern.test(record.ecrRef)) {
      return `another sale of ours (${record.ecrRef})`
    }
    if (isKnownUid(record.globalUid)) return 'a sale this register already has'
    const at = parseTerminalTime(record.timestamp)
    if (at === null) return 'no time on the record'
    if (at < startedAt - CLOCK_TOLERANCE_MS) return `from before this sale (${record.timestamp})`
    return null
  }

  type Candidate = { label: string; record: DetailRecord }

  /**
   * The newest records of the terminal's batch: the one it returns with no
   * filter, and the last by position counted from either end (which end the
   * terminal counts from is not documented). Same record read twice counts once.
   * `notes` gets one line per answer.
   */
  async function readNewestRecords(notes: string[]): Promise<Candidate[]> {
    const found: Candidate[] = []
    const seen = new Set<string>()
    const indexes: Array<number | null> = [null]
    for (let i = 0; i < indexes.length; i++) {
      const index = indexes[i]
      const label = index === null ? 'latest record' : `record ${index}`
      try {
        const { payload, summary } = await askReport(buildRecordReportRequest(index), label)
        const read = readDetailReport(payload)
        notes.push(`${label}: ${summary}`)
        if (!read.ok) continue
        const { record } = read
        if (i === 0 && record.totalRecords !== null && record.totalRecords > 1) {
          indexes.push(record.totalRecords - 1, record.totalRecords)
        }
        const key =
          record.globalUid || `${record.timestamp}/${record.approvedCents}/${record.lastFour}`
        if (seen.has(key)) continue
        seen.add(key)
        found.push({ label, record })
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        notes.push(`${label}: failed: ${message}`)
        log.info(`lookup ${label} failed: ${message}`)
      }
    }
    const at = (c: Candidate): number => parseTerminalTime(c.record.timestamp) ?? -1
    return found.sort((a, b) => at(b) - at(a))
  }

  /**
   * Find a silent sale on a terminal that does not find it by our reference, by
   * reading the newest record of its batch. Nothing else reached the terminal
   * between the sale and this lookup (the lock holds), so the newest record is
   * that sale or the sale was never recorded: the newest record is taken when
   * `recordMismatch` finds nothing against it, and nothing else is.
   */
  async function recoverByRecentRecord(
    ecrRef: string,
    cents: number,
    startedAt: number,
    notes: string[]
  ): Promise<string | null> {
    const newest = (await readNewestRecords(notes))[0]
    if (!newest) return null
    const why = recordMismatch(newest.record, ecrRef, cents, startedAt)
    notes.push(`newest (${newest.label}): ${why ?? 'this sale'}`)
    log.info(`sale ${ecrRef} newest record is ${why ?? 'this sale'}`)
    return why ? null : newest.record.t01
  }

  /**
   * Ask the terminal how a silent sale ended (LocalDetailReport by its ECR
   * reference, then by newest record). Resolves with the T01 frame the sale
   * should have received when the terminal holds a full approval for it, and
   * null otherwise: no record, a record that does not pass every check, or a
   * terminal that does not answer. Null leaves the sale exactly as unknown as
   * it was, never declined.
   */
  async function recoverSale(
    ecrRef: string,
    amountCents: number,
    trigger: 'no-answer' | 'retry',
    startedAt: number
  ): Promise<Buffer | null> {
    log.warn(
      trigger === 'retry'
        ? `sale ${ecrRef} retried — asking the terminal whether it went through first`
        : `sale ${ecrRef} got no answer — asking the terminal how it ended`
    )
    const lookups: string[] = []
    const done = (recovered: boolean): void =>
      report({
        stage: 'recovery',
        requestedCents: amountCents,
        ecrRef,
        recovered,
        trigger,
        lookups
      })
    for (let attempt = 1; attempt <= timing.recoveryAttempts; attempt++) {
      await delay(timing.recoveryGapMs)
      try {
        const byRef = await askReport(
          buildLocalDetailReportRequest(ecrRef),
          `by reference ${ecrRef}`
        )
        const result = parseLocalDetailReport(byRef.payload, ecrRef, amountCents)
        if (result.found) {
          lookups.push(`by reference: approved (${byRef.summary})`)
          log.info(`sale ${ecrRef} recovered: the terminal approved it`)
          done(true)
          return frame(result.payload)
        }
        lookups.push(`by reference: ${result.reason} (${byRef.summary})`)
        log.info(`sale ${ecrRef} lookup ${attempt}/${timing.recoveryAttempts}: ${result.reason}`)
        // The terminal may not keep our reference at all: read its newest record.
        const recent = await recoverByRecentRecord(ecrRef, amountCents, startedAt, lookups)
        if (recent) {
          log.info(`sale ${ecrRef} recovered from the terminal's newest record`)
          done(true)
          return frame(recent)
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        lookups.push(`failed: ${message}`)
        log.info(`sale ${ecrRef} lookup ${attempt}/${timing.recoveryAttempts} failed: ${message}`)
      }
    }
    log.warn(`sale ${ecrRef} not recovered — outcome unknown`)
    done(false)
    return null
  }

  /**
   * Before charging again for a payment whose last sale stayed unknown, ask the
   * terminal whether that sale went through. By now the terminal has certainly
   * finished it, so this is the lookup most likely to find it. Only the same
   * amount is looked up: a recovered approval completes this payment, and an
   * approval for a different amount is not this payment's to take.
   */
  async function checkRetriedSale(input: TerminalSaleInput): Promise<PaxChargeResult | null> {
    const ref = input.retryOf
    if (!ref) return null
    const sale = state.unresolved.get(ref)
    state.unresolved.delete(ref)
    if (!sale) {
      log.info(`retry of ${ref}: not an unresolved sale on this register — charging`)
      return null
    }
    if (sale.cents !== input.cents) {
      log.info(`retry of ${ref}: amount changed (${sale.cents} → ${input.cents}) — charging`)
      return null
    }
    const raw = await lock.run('sale', 'reject-if-busy', () =>
      recoverSale(ref, sale.cents, 'retry', sale.startedAt)
    )
    return raw ? parseResponse(unframe(raw), sale.cents) : null
  }

  // ── Lookup check ──

  async function checkSaleLookup(
    trigger: 'daily' | 'manual' = 'manual'
  ): Promise<PaxLookupCheckResult> {
    const sale = state.lastApproved
    let status: PaxLookupCheckStatus
    let reason = ''
    const answers: string[] = []
    if (!sale) {
      status = 'no-sale'
    } else {
      try {
        ;[status, reason] = await lock.run(
          'lookup check',
          'background',
          async (): Promise<[PaxLookupCheckStatus, string]> => {
            const same = (uid: string, lastFour: string): boolean =>
              uid === sale.result.reference && lastFour === sale.result.lastFour
            const differs = (uid: string, lastFour: string): string =>
              `reference ${uid || '(none)'} vs ${sale.result.reference}, last four ${lastFour || '(none)'} vs ${sale.result.lastFour}`
            const byRef = await askReport(
              buildLocalDetailReportRequest(sale.ecrRef),
              `by reference ${sale.ecrRef}`
            )
            answers.push(`by reference: ${byRef.summary}`)
            const found = parseLocalDetailReport(byRef.payload, sale.ecrRef, sale.cents)
            if (found.found) {
              const record = parseResponse(found.payload, sale.cents)
              return same(record.reference, record.lastFour)
                ? ['works', '']
                : ['mismatch', differs(record.reference, record.lastFour)]
            }
            // Not found by reference: is the newest record the sale? That is the
            // lookup `recoverByRecentRecord` would make for a silent sale here.
            const newest = (await readNewestRecords(answers))[0]
            if (newest && same(newest.record.globalUid, newest.record.lastFour)) {
              return ['works-recent', '']
            }
            return [
              'not-found',
              newest
                ? `${found.reason}; newest record ${differs(newest.record.globalUid, newest.record.lastFour)}`
                : found.reason
            ]
          }
        )
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        status = err instanceof Error && err.name === 'PaxTerminalBusyError' ? 'busy' : 'no-answer'
        reason = message
      }
    }
    log.info(`lookup check (${trigger}): ${status}${reason ? ` — ${reason}` : ''}`)
    if (status !== 'busy' && status !== 'no-sale') {
      metric('pax_lookup_check', status)
      // 'works-recent' is filed too: its answers show what this terminal's batch
      // holds, which is how the match it relies on gets confirmed per terminal.
      if (status !== 'works') {
        report({
          stage: 'lookup-check',
          requestedCents: sale!.cents,
          ecrRef: sale!.ecrRef,
          status,
          reason,
          trigger,
          answers
        })
      }
    }
    return { status, message: LOOKUP_CHECK_MESSAGES[status] }
  }

  /** Remember an approved sale, and run the day's lookup check shortly after the first. */
  function noteApproved(ecrRef: string, cents: number, result: PaxChargeResult): void {
    rememberUid(result.reference)
    if (!result.success || result.partial) return
    state.lastApproved = { ecrRef, cents, result }
    const today = localDay(new Date())
    if (state.lookupCheckedOn === today) return
    state.lookupCheckedOn = today
    state.lookupCheckTimer = setTimeout(() => {
      state.lookupCheckTimer = null
      void checkSaleLookup('daily').then((r) => {
        // The terminal was busy: let the next approved sale try again today.
        if (r.status === 'busy') state.lookupCheckedOn = null
      })
    }, timing.lookupCheckDelayMs)
    state.lookupCheckTimer.unref?.()
  }

  // ── Commands ──

  async function sale(input: TerminalSaleInput): Promise<PaxChargeResult> {
    const earlier = await checkRetriedSale(input)
    if (earlier) return earlier

    const ecrRef = nextEcrRef()
    const startedAt = Date.now()
    try {
      const payload = await exchange(
        buildSaleRequest(input.cents, ecrRef),
        input.cents,
        'sale',
        'reject-if-busy',
        () => recoverSale(ecrRef, input.cents, 'no-answer', startedAt)
      )
      const result = parseResponse(payload, input.cents)
      noteApproved(ecrRef, input.cents, result)
      return result
    } catch (err) {
      if (err instanceof PaxNoAnswerError) {
        // Still unknown after the lookup. The reference rides on the error so the
        // payment screen can hand it back if the cashier presses Card again.
        rememberUnresolved(ecrRef, { cents: input.cents, startedAt })
        err.ecrRef = ecrRef
        err.message = `${err.message} [sale ${ecrRef}]`
      }
      throw err
    }
  }

  async function returnRequest(
    referenceNumber: string,
    cents: number,
    operation: 'refund' | 'credit',
    policy: PaxCommandPolicy
  ): Promise<PaxChargeResult> {
    const payload = await exchange(
      buildReturnRequest(referenceNumber, cents),
      cents,
      operation,
      policy
    )
    return parseResponse(payload, cents)
  }

  function test(): Promise<PaxProbeResult> {
    if (lock.isBusy()) {
      return Promise.resolve({ ok: true, message: BUSY_MESSAGE, skipped: true })
    }

    return new Promise((resolve) => {
      const socket = new net.Socket()
      let settled = false

      const done = (result: PaxProbeResult): void => {
        if (settled) return
        settled = true
        unregister()
        socket.destroy()
        resolve(result)
      }

      const unregister = lock.registerProbe(() =>
        done({ ok: true, message: BUSY_MESSAGE, skipped: true })
      )

      socket.setTimeout(timing.connectTimeoutMs)
      socket.connect(conn.port, conn.host, () => {
        done({ ok: true, message: `Connected to ${terminalId}` })
      })
      socket.on('timeout', () =>
        done({ ok: false, message: `Timed out connecting to ${terminalId}` })
      )
      socket.on('error', (err) => done({ ok: false, message: err.message }))
    })
  }

  return {
    config: conn,
    sale,
    // Prompts the customer for a card, exactly like a sale — never queue it.
    standaloneCredit: (input) =>
      returnRequest(nextEcrRef(), input.cents, 'credit', 'reject-if-busy'),
    // A refund against a completed sale is a deliberate follow-up: queue it
    // behind whatever is on the terminal rather than refusing it.
    refund: (reference, cents) => returnRequest(reference, cents, 'refund', 'wait'),
    voidSale: async (reference) => {
      const payload = await exchange(buildVoidRequest(reference), 0, 'void', 'wait')
      return parseResponse(payload, 0)
    },
    test,
    checkSaleLookup,
    isBusy: () => lock.isBusy()
  }
}

/** Test-only: forget every terminal's lock and recovery state. */
export const __testing = {
  reset(): void {
    for (const s of states.values()) {
      if (s.lookupCheckTimer) clearTimeout(s.lookupCheckTimer)
    }
    states.clear()
  }
}
