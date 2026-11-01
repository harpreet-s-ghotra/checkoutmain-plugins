import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { PaxReportEvent, PaxTerminalConfig, PaxTerminalOptions } from './types'

type SocketBehavior = {
  mode:
    | 'data'
    | 'timeout'
    | 'error'
    | 'connect-timeout'
    | 'connect-refused'
    | 'ack-fail'
    // The terminal accepts the request and then holds it (customer at the card
    // prompt) until the test calls state.deliver().
    | 'hold'
    // The TCP connect never completes until the test calls state.completeConnect().
    | 'connect-hold'
    // The terminal ACKs the request, then never answers.
    | 'ack-silence'
  response: Buffer
  /** Builds the response from the request, when it depends on what was sent. */
  respond?: (request: Buffer) => Buffer
}

const state = vi.hoisted(() => ({
  behavior: { mode: 'data', response: Buffer.from([]) } as SocketBehavior,
  lastRequest: Buffer.from([]) as Buffer,
  requests: [] as Buffer[],
  // One behaviour per connection, in order; the last one taken stays in force.
  script: [] as SocketBehavior[],
  connects: 0,
  deliver: null as null | (() => void),
  completeConnect: null as null | (() => void),
  destroyedWhileConnecting: 0
}))

// A fake terminal on the other end of `net.Socket`, scripted per connection.
vi.mock('net', () => {
  class FakeSocket {
    private handlers: Record<string, (arg?: unknown) => void> = {}
    // A real socket goes silent once destroyed; mirror that so a response
    // delivered on a late microtask (after the ACK and teardown) is ignored
    // rather than re-entering the data handler.
    private destroyed = false
    setTimeout(): void {
      void 0
    }
    on(event: string, handler: (arg?: unknown) => void): this {
      this.handlers[event] = handler
      return this
    }
    connect(_port: number, _host: string, cb: () => void): void {
      state.connects++
      const next = state.script.shift()
      if (next) state.behavior = next
      if (state.behavior.mode === 'connect-hold') {
        let connected = false
        state.completeConnect = () => {
          connected = true
          if (!this.destroyed) cb()
        }
        this.onDestroy = () => {
          if (!connected) state.destroyedWhileConnecting++
        }
        return
      }
      if (state.behavior.mode === 'connect-timeout') {
        queueMicrotask(() => this.handlers.timeout?.())
        return
      }
      if (state.behavior.mode === 'connect-refused') {
        queueMicrotask(() => {
          const err = new Error('connect ECONNREFUSED') as NodeJS.ErrnoException
          err.code = 'ECONNREFUSED'
          this.handlers.error?.(err)
        })
        return
      }
      cb()
    }
    write(buf: Buffer, cb?: (err?: Error) => void): void {
      if (this.destroyed) return
      // The framed request is multi-byte; the post-response finalize ACK is a
      // single byte.
      if (buf.length > 1) {
        state.lastRequest = buf
        state.requests.push(buf)
        cb?.()
        if (state.behavior.mode === 'ack-silence') {
          queueMicrotask(() => {
            if (this.destroyed) return
            this.handlers.data?.(Buffer.from([0x06]))
            this.handlers.timeout?.()
          })
          return
        }
        const respond = state.behavior.respond
        if (state.behavior.mode === 'hold') {
          const response = state.behavior.response
          state.deliver = () => {
            if (!this.destroyed) this.handlers.data?.(response)
          }
          return
        }
        queueMicrotask(() => {
          if (this.destroyed) return
          if (state.behavior.mode === 'timeout') this.handlers.timeout?.()
          else if (state.behavior.mode === 'error') this.handlers.error?.(new Error('socket boom'))
          else this.handlers.data?.(respond ? respond(buf) : state.behavior.response)
        })
        return
      }
      // Single-byte finalize ACK. 'ack-fail' models the OS rejecting the flush
      // (e.g. EPIPE) so the write callback reports an error — the terminal never
      // gets the handshake, but the charge already approved.
      cb?.(state.behavior.mode === 'ack-fail' ? new Error('ACK write failed (EPIPE)') : undefined)
    }
    private onDestroy: (() => void) | null = null
    destroy(): void {
      if (!this.destroyed) this.onDestroy?.()
      this.destroyed = true
    }
  }
  return { Socket: FakeSocket }
})

import { frame, unframe, FS, US } from './protocol'
import { __testing, createPaxTerminal, transactionTimeoutMs } from './terminal'

const fs = String.fromCharCode(FS)
const us = String.fromCharCode(US)
const CONN: PaxTerminalConfig = { host: '192.168.1.50', port: 10009, timeout_ms: 1000 }

const report = vi.fn<(event: PaxReportEvent) => void>()
const metric = vi.fn<(name: string, label: string) => void>()
const isKnownReference = vi.fn<(uid: string) => boolean>(() => false)
const HOOKS: PaxTerminalOptions = {
  report,
  metric,
  isKnownReference,
  timing: { recoveryGapMs: 0, lookupCheckDelayMs: 60_000 }
}
const terminal = (options: PaxTerminalOptions = HOOKS) => createPaxTerminal(CONN, options)
const reports = (): PaxReportEvent[] => report.mock.calls.map((c) => c[0])
const stage = <S extends PaxReportEvent['stage']>(s: S) =>
  reports().filter((r): r is Extract<PaxReportEvent, { stage: S }> => r.stage === s)

function approvedFrame(): Buffer {
  const host = ['00', 'APPROVAL', 'AUTH1', '', 'TRC', 'BCH'].join(us)
  const amount = ['2599', '', '', ''].join(us)
  const account = ['****1111', '2', '1231'].join(us)
  const trace = ['', 'INV'].join(us)
  const addl = ['CARDBIN=411111', 'GLOBALUID=GUID42', 'EDCTYPE=CREDIT'].join(us)
  return frame(
    [
      '0',
      'T01',
      '1.58',
      '000000',
      'APPROVED',
      host,
      '01',
      amount,
      account,
      trace,
      '',
      '',
      '',
      addl,
      ''
    ].join(fs)
  )
}

/** The ECR reference a framed sale request carried (Trace group, field 5). */
function ecrRefOf(request: Buffer): string {
  return unframe(request).split(fs)[5].split(us)[0]
}

/** A LocalDetailReport (R03) answer holding one record for `ref`. */
function reportFrame(
  ref: string,
  opts: { cents?: number; hostCode?: string; records?: string; code?: string } = {}
): Buffer {
  const host = [opts.hostCode ?? '000', 'APPROVAL', 'AUTH9', 'HREF', '', ''].join(us)
  const amount = [String(opts.cents ?? 3810), '0', '', ''].join(us)
  const account = ['****8732', '', '1230'].join(us)
  const trace = ['7', ref, '20261022192019'].join(us)
  const ext = ['GLOBALUID=GUID-RECOVERED', 'APPLAB=US DEBIT', 'CVM=1'].join(us)
  return frame(
    [
      '0',
      'R03',
      '1.58',
      opts.code ?? '000000',
      opts.code ? 'NOT FOUND' : 'OK',
      opts.records ?? '1',
      '1',
      host,
      '02',
      '01',
      '',
      amount,
      account,
      trace,
      '',
      '',
      '',
      ext
    ].join(fs)
  )
}

/** The terminal's clock, as a record stamps it: `YYYYMMDDhhmmss` local time. */
function terminalTime(at: number): string {
  const d = new Date(at)
  const p = (n: number): string => String(n).padStart(2, '0')
  return (
    `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}` +
    `${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`
  )
}

/** An R03 record read by position: the terminal kept no reference of ours. */
function recordFrame(opts: {
  cents?: number
  uid?: string
  at?: number
  total?: string
  ref?: string
  hostCode?: string
  transType?: string
  account?: string
}): Buffer {
  const host = [opts.hostCode ?? '000', 'APPROVAL', 'AUTH9', 'HREF'].join(us)
  const amount = [String(opts.cents ?? 3810), '0'].join(us)
  const trace = ['7', opts.ref ?? '', terminalTime(opts.at ?? Date.now())].join(us)
  const ext = [`GLOBALUID=${opts.uid ?? 'GUID-NEWEST'}`, 'APPLAB=US DEBIT', 'CVM=1'].join(us)
  return frame(
    [
      '0',
      'R03',
      '1.58',
      '000000',
      'OK',
      opts.total ?? '1',
      '1',
      host,
      '02',
      opts.transType ?? '01',
      '',
      amount,
      [opts.account ?? '****8732', '', '1230'].join(us),
      trace,
      '',
      '',
      '',
      ext
    ].join(fs)
  )
}

function declinedFrame(): Buffer {
  const host = ['', 'Failed_Ticket Status is not good', '', '', '', '0'].join(us)
  return frame(['0', 'T01', '1.58', '000100', 'DECLINE', host, '01', '', '', ''].join(fs))
}

const flushMicrotasks = async (): Promise<void> => {
  for (let i = 0; i < 5; i++) await Promise.resolve()
}

describe('createPaxTerminal', () => {
  beforeEach(() => {
    state.behavior = { mode: 'data', response: approvedFrame() }
    state.lastRequest = Buffer.from([])
    state.requests = []
    state.script = []
    state.connects = 0
    state.deliver = null
    state.completeConnect = null
    state.destroyedWhileConnecting = 0
    __testing.reset()
    report.mockReset()
    metric.mockReset()
    isKnownReference.mockReset()
    isKnownReference.mockImplementation(() => false)
  })

  afterEach(() => __testing.reset())

  it('parses an approved sale', async () => {
    const result = await terminal().sale({ cents: 2599 })
    expect(result.success).toBe(true)
    expect(result.reference).toBe('GUID42') // from GLOBALUID
    expect(result.lastFour).toBe('1111')
    expect(result.cardBrand).toBe('Visa') // from CARDBIN 411111
    expect(result.approvedCents).toBe(2599)
    const fields = unframe(state.lastRequest).split(fs)
    expect(fields[0]).toBe('T00')
    expect(fields[2]).toBe('01')
    expect(fields[3].split(us)[0]).toBe('2599')
    expect(ecrRefOf(state.lastRequest)).toMatch(/^ECR\d{6}$/)
  })

  it('uses the configured ECR prefix', async () => {
    await terminal({ ...HOOKS, ecrPrefix: 'HSPOS' }).sale({ cents: 100 })
    expect(ecrRefOf(state.lastRequest)).toMatch(/^HSPOS\d{6}$/)
  })

  it('defaults the port to 10009', () => {
    expect(createPaxTerminal({ host: '10.0.0.9' }).config).toEqual({
      host: '10.0.0.9',
      port: 10009,
      timeout_ms: undefined
    })
  })

  it('returns a declined refund as a result, not an exception', async () => {
    state.behavior = { mode: 'data', response: declinedFrame() }
    const result = await terminal().refund('GUID42', 2599)
    expect(result.success).toBe(false)
    expect(result.message).toBe('DECLINE')
    expect(stage('response')).toEqual([
      expect.objectContaining({ operation: 'refund', kind: 'decline', requestedCents: 2599 })
    ])
  })

  it('standaloneCredit issues a RETURN (TransType 02) with a fresh ECR ref', async () => {
    const result = await terminal().standaloneCredit({ cents: 2599 })
    expect(result.success).toBe(true)
    expect(result.reference).toBe('GUID42')
    expect(result.lastFour).toBe('1111')
    expect(result.cardBrand).toBe('Visa')

    // The wire request is a RETURN with a fresh ECR ref, not an original ref.
    const fields = unframe(state.lastRequest).split(fs)
    expect(fields[2]).toBe('02') // TransType RETURN
    expect(fields[3].split(us)[0]).toBe('2599') // amount cents
    expect(fields[5].split(us)[0]).toMatch(/^ECR\d{6}$/) // fresh ECR reference
  })

  it('standaloneCredit returns success:false on a decline (does not throw)', async () => {
    state.behavior = { mode: 'data', response: declinedFrame() }
    const result = await terminal().standaloneCredit({ cents: 2599 })
    expect(result.success).toBe(false)
  })

  it('surfaces a socket timeout as an error', async () => {
    state.behavior = { mode: 'timeout', response: Buffer.from([]) }
    await expect(terminal().sale({ cents: 100 })).rejects.toThrow(/timed out/)
  })

  it('fails fast with a clear message when the terminal never answers the connect', async () => {
    state.behavior = { mode: 'connect-timeout', response: Buffer.from([]) }
    await expect(terminal().sale({ cents: 100 })).rejects.toThrow(
      /Card terminal unreachable \(192\.168\.1\.50:10009\)/
    )
  })

  it('maps a refused connection to the same cashier-facing message', async () => {
    state.behavior = { mode: 'connect-refused', response: Buffer.from([]) }
    await expect(terminal().sale({ cents: 100 })).rejects.toThrow(/Card terminal unreachable/)
  })

  it('reports when the terminal cannot be reached', async () => {
    state.behavior = { mode: 'connect-refused', response: Buffer.from([]) }
    await expect(terminal().sale({ cents: 100 })).rejects.toThrow()

    expect(reports()).toEqual([
      expect.objectContaining({
        stage: 'error',
        kind: 'unreachable',
        operation: 'sale',
        requestedCents: 100,
        terminal: '192.168.1.50:10009'
      })
    ])
  })

  it('reports a corrupt frame as a protocol error', async () => {
    const corrupt = Buffer.from(approvedFrame())
    corrupt[corrupt.length - 1] ^= 0xff
    state.behavior = { mode: 'data', response: corrupt }
    await expect(terminal().sale({ cents: 100 })).rejects.toThrow(/LRC/)
    expect(stage('error')[0]).toMatchObject({
      kind: 'protocol',
      error: expect.stringMatching(/LRC/)
    })
  })

  it('still charges when the report hook throws', async () => {
    report.mockImplementationOnce(() => {
      throw new Error('queue unavailable')
    })
    state.behavior = { mode: 'ack-fail', response: approvedFrame() }
    // Reporting sits on the payment path, so it must never surface as a decline.
    await expect(terminal().sale({ cents: 2599 })).resolves.toMatchObject({ success: true })
  })

  it('works with no hooks at all', async () => {
    state.behavior = { mode: 'ack-fail', response: approvedFrame() }
    await expect(createPaxTerminal(CONN).sale({ cents: 2599 })).resolves.toMatchObject({
      success: true
    })
  })

  it('an approved sale flushes its finalize ACK and reports nothing', async () => {
    const result = await terminal().sale({ cents: 2599 })
    expect(result.success).toBe(true)
    expect(report).not.toHaveBeenCalled()
  })

  it('completes the sale but reports when the finalize ACK cannot be flushed', async () => {
    // The terminal approved and we parsed the response, but the ACK that tells it
    // to finalize failed to flush — the charge stands, yet the terminal may be
    // left armed ("ready to charge"). The sale must still succeed AND the host
    // must hear about it so a silent re-occurrence is no longer invisible.
    state.behavior = { mode: 'ack-fail', response: approvedFrame() }
    const result = await terminal().sale({ cents: 2599 })
    expect(result.success).toBe(true)
    expect(result.reference).toBe('GUID42')

    expect(reports()).toEqual([
      {
        stage: 'finalize',
        operation: 'sale',
        requestedCents: 2599,
        terminal: '192.168.1.50:10009',
        error: 'ACK write failed (EPIPE)'
      }
    ])
  })

  it('reports a partial approval with the host summary', async () => {
    const host = ['002', 'APPRV LESSER AMT', 'AUTH1', '', '', ''].join(us)
    const partial = frame(
      [
        '0',
        'T01',
        '1.58',
        '000002',
        'PARTIALLY APPROVED',
        host,
        '01',
        ['1891', '831'].join(us),
        ['****1111', '2', '1231'].join(us),
        '',
        '',
        '',
        '',
        ['CARDBIN=411111', 'GLOBALUID=GUID-P'].join(us),
        ''
      ].join(fs)
    )
    state.behavior = { mode: 'data', response: partial }
    const result = await terminal().sale({ cents: 2722 })
    expect(result).toMatchObject({ success: true, partial: true, approvedCents: 1891 })
    expect(stage('response')[0]).toMatchObject({
      kind: 'partial',
      summary: expect.objectContaining({
        hostMessage: 'APPRV LESSER AMT',
        approveAmountCents: 1891
      })
    })
  })

  it('test() resolves ok on connect', async () => {
    const result = await terminal().test()
    expect(result).toEqual({ ok: true, message: 'Connected to 192.168.1.50:10009' })
  })

  it('names the address in a test that timed out', async () => {
    // A settings screen shows this verbatim, and "timed out" with no address is
    // not something a store can act on.
    state.behavior = { mode: 'connect-timeout', response: Buffer.from([]) }
    await expect(terminal().test()).resolves.toEqual({
      ok: false,
      message: 'Timed out connecting to 192.168.1.50:10009'
    })
  })

  it('reports the socket error verbatim from a failed test', async () => {
    state.behavior = { mode: 'connect-refused', response: Buffer.from([]) }
    const result = await terminal().test()
    expect(result.ok).toBe(false)
    expect(result.message).toBeTruthy()
  })

  it('voids through the terminal, and says so when the void is refused', async () => {
    const t = terminal()
    await expect(t.voidSale('GUID42')).resolves.toMatchObject({ success: true })
    expect(unframe(state.lastRequest).split(fs)[2]).toBe('11')

    state.behavior = { mode: 'data', response: declinedFrame() }
    await expect(t.voidSale('GUID42')).resolves.toMatchObject({
      success: false,
      message: 'DECLINE'
    })
  })

  it('refunds an original sale when the terminal approves', async () => {
    const result = await terminal().refund('GUID42', 2599)
    expect(result.success).toBe(true)
    const fields = unframe(state.lastRequest).split(fs)
    expect(fields[2]).toBe('02')
    expect(fields[5].split(us)[0]).toBe('GUID42')
  })

  it('gives each request its own ECR reference', async () => {
    // De-duplication at the terminal depends on it: two sales sharing a
    // reference is how a second charge gets silently swallowed.
    const t = terminal()
    await t.standaloneCredit({ cents: 100 })
    const first = state.lastRequest.toString('latin1')
    await t.standaloneCredit({ cents: 100 })
    const second = state.lastRequest.toString('latin1')
    expect(first).not.toBe(second)
  })

  describe('one command on the terminal at a time', () => {
    it('skips the probe while a sale is on the terminal', async () => {
      state.behavior = { mode: 'hold', response: approvedFrame() }
      const t = terminal()
      const sale = t.sale({ cents: 2599 })
      await flushMicrotasks()
      expect(t.isBusy()).toBe(true)
      expect(state.connects).toBe(1)

      const probe = await t.test()
      expect(probe).toMatchObject({ ok: true, skipped: true })
      // No second TCP client was opened on the terminal mid-sale.
      expect(state.connects).toBe(1)

      state.deliver!()
      await expect(sale).resolves.toMatchObject({ success: true })
      expect(t.isBusy()).toBe(false)

      state.behavior = { mode: 'data', response: approvedFrame() }
      const after = await t.test()
      expect(after.skipped).toBeUndefined()
      expect(state.connects).toBe(2)
    })

    it('shares the lock between two handles on the same address', async () => {
      state.behavior = { mode: 'hold', response: approvedFrame() }
      const sale = terminal().sale({ cents: 2599 })
      await flushMicrotasks()
      const other = createPaxTerminal({ host: CONN.host, port: CONN.port })
      expect(other.isBusy()).toBe(true)
      await expect(other.sale({ cents: 100 })).rejects.toThrow(/busy/)
      state.deliver!()
      await sale
    })

    it('tears down a probe that is still connecting when a sale starts', async () => {
      state.behavior = { mode: 'connect-hold', response: approvedFrame() }
      const t = terminal()
      const probe = t.test()
      await flushMicrotasks()

      state.behavior = { mode: 'hold', response: approvedFrame() }
      const sale = t.sale({ cents: 2599 })

      await expect(probe).resolves.toMatchObject({ ok: true, skipped: true })
      expect(state.destroyedWhileConnecting).toBe(1)

      await flushMicrotasks()
      state.deliver!()
      await expect(sale).resolves.toMatchObject({ success: true })
    })

    it('refuses a second sale while one is prompting, without touching the terminal', async () => {
      state.behavior = { mode: 'hold', response: approvedFrame() }
      const t = terminal()
      const first = t.sale({ cents: 2599 })
      await flushMicrotasks()

      await expect(t.sale({ cents: 2599 })).rejects.toThrow(/busy with another sale/)
      await expect(t.standaloneCredit({ cents: 500 })).rejects.toThrow(/busy/)
      expect(state.connects).toBe(1)
      // A refusal is not a card failure — nothing reached a card.
      expect(report).not.toHaveBeenCalled()

      state.deliver!()
      await expect(first).resolves.toMatchObject({ success: true })
    })

    it('queues a void behind the open sale instead of refusing it', async () => {
      state.behavior = { mode: 'hold', response: approvedFrame() }
      const t = terminal()
      const sale = t.sale({ cents: 2599 })
      await flushMicrotasks()

      const voided = t.voidSale('GUID42')
      await flushMicrotasks()
      // Still one connection: the void has not been sent yet.
      expect(state.connects).toBe(1)

      state.deliver!()
      await expect(sale).resolves.toMatchObject({ success: true })
      await flushMicrotasks()
      expect(state.connects).toBe(2)
      state.deliver!()
      await expect(voided).resolves.toMatchObject({ success: true })
      expect(t.isBusy()).toBe(false)
    })

    it('frees the terminal after a failed sale', async () => {
      state.behavior = { mode: 'timeout', response: Buffer.from([]) }
      const t = terminal()
      await expect(t.sale({ cents: 100 })).rejects.toThrow()
      expect(t.isBusy()).toBe(false)
    })
  })

  describe('a sale the terminal accepted and never answered', () => {
    const silent: SocketBehavior = { mode: 'ack-silence', response: Buffer.from([]) }

    it('asks the terminal for the sale by its ECR reference and completes it', async () => {
      // The terminal's batch holds the sale it was sent: the first request.
      state.script = [
        silent,
        {
          mode: 'data',
          response: Buffer.from([]),
          respond: () => reportFrame(ecrRefOf(state.requests[0]))
        }
      ]
      const t = terminal()
      const result = await t.sale({ cents: 3810 })
      const saleRef = ecrRefOf(state.requests[0])

      expect(result.success).toBe(true)
      expect(result.reference).toBe('GUID-RECOVERED')
      expect(result.lastFour).toBe('8732')
      expect(result.tenderType).toBe('debit')
      expect(result.approvedCents).toBe(3810)
      const lookup = unframe(state.requests[1]).split(fs)
      expect(lookup[0]).toBe('R02')
      expect(lookup[8]).toBe(saleRef)
      expect(reports()).toEqual([
        expect.objectContaining({
          stage: 'recovery',
          recovered: true,
          ecrRef: saleRef,
          trigger: 'no-answer'
        })
      ])
      expect(t.isBusy()).toBe(false)
    })

    it.each([
      ['no record', { code: '100023' }],
      ['two records', { records: '2' }],
      ['a host decline', { hostCode: '500' }],
      ['a different amount', { cents: 3000 }]
    ])('leaves the sale unknown when the report shows %s', async (_label, opts) => {
      state.script = [
        silent,
        {
          mode: 'data',
          response: Buffer.from([]),
          respond: () => reportFrame(ecrRefOf(state.requests[0]), opts)
        }
      ]
      const err = await terminal()
        .sale({ cents: 3810 })
        .catch((e: Error) => e)
      expect(err).toBeInstanceOf(Error)
      expect((err as Error).message).toContain('timed out after accepting the request')
      const saleRef = ecrRefOf(state.requests[0])
      expect((err as Error & { ecrRef: string }).ecrRef).toBe(saleRef)
      expect((err as Error).message).toContain(`[sale ${saleRef}]`)
      // The sale, then three attempts of a reference lookup plus the newest
      // record (which here answers the same frame, so it is never this sale).
      const recentReads = 'records' in opts ? 3 : 1
      expect(state.requests).toHaveLength(1 + 3 * (1 + recentReads))
      const recovery = stage('recovery')[0]
      expect(recovery).toMatchObject({ recovered: false, ecrRef: saleRef })
      expect(recovery.lookups.filter((l) => l.startsWith('by reference:'))).toHaveLength(3)
    })

    it('never takes a record for another sale', async () => {
      state.script = [silent, { mode: 'data', response: reportFrame('ECR000001') }]
      await expect(terminal().sale({ cents: 3810 })).rejects.toThrow(
        'timed out after accepting the request'
      )
    })

    describe('on a terminal that does not find sales by our reference', () => {
      const notFound: SocketBehavior = {
        mode: 'data',
        response: reportFrame('x', { code: '100023' })
      }
      const record = (opts: Parameters<typeof recordFrame>[0]): SocketBehavior => ({
        mode: 'data',
        response: recordFrame(opts)
      })
      /** Requests after the sale, by command and record position. */
      const asked = (): string[] =>
        state.requests.slice(1).map((r) => {
          const f = unframe(r).split(fs)
          return f[0] === 'R02' ? `R02 ref=${f[8]} index=${f[5]}` : f[0]
        })

      it('takes the newest record when it is this sale', async () => {
        state.script = [silent, notFound, record({ cents: 3810 })]
        const result = await terminal().sale({ cents: 3810 })
        const saleRef = ecrRefOf(state.requests[0])

        expect(result).toMatchObject({
          success: true,
          reference: 'GUID-NEWEST',
          approvedCents: 3810
        })
        expect(asked()).toEqual([`R02 ref=${saleRef} index=`, 'R02 ref= index='])
        const recovery = stage('recovery')[0]
        expect(recovery).toMatchObject({ recovered: true, ecrRef: saleRef })
        expect(recovery.lookups[0]).toContain('R03 100023 NOT FOUND')
        expect(recovery.lookups[1]).toContain('uid=GUID-NEWEST')
        expect(recovery.lookups[2]).toBe('newest (latest record): this sale')
      })

      it('reads the last record by position from either end when the batch is longer', async () => {
        const old = Date.now() - 60 * 60_000
        state.script = [
          silent,
          notFound,
          record({ cents: 500, uid: 'FIRST', at: old, total: '3' }), // index 0, an hour ago
          record({ cents: 3810, uid: 'SECOND', at: old + 1000 }), // index 2
          record({ cents: 3810, uid: 'THIRD' }) // index 3: the newest
        ]
        const result = await terminal().sale({ cents: 3810 })
        expect(result.reference).toBe('THIRD')
        expect(asked().slice(1)).toEqual([
          'R02 ref= index=',
          'R02 ref= index=2',
          'R02 ref= index=3'
        ])
      })

      it.each([
        ['a different amount', { cents: 3000 }],
        ['a record from before the sale', { cents: 3810, at: Date.now() - 6 * 60_000 }],
        ['another sale of ours', { cents: 3810, ref: 'ECR000001' }],
        ['a decline', { cents: 3810, hostCode: '500' }],
        ['a refund', { cents: 3810, transType: '02' }]
      ])('leaves the sale unknown when the newest record is %s', async (_label, opts) => {
        state.script = [
          silent,
          notFound,
          record(opts),
          notFound,
          record(opts),
          notFound,
          record(opts)
        ]
        await expect(terminal().sale({ cents: 3810 })).rejects.toThrow(
          'timed out after accepting the request'
        )
      })

      it('leaves the sale unknown when the newest record is a sale the host already has', async () => {
        isKnownReference.mockImplementation((uid) => uid === 'SAVED-EARLIER')
        state.script = [silent, notFound, record({ cents: 3810, uid: 'SAVED-EARLIER' })]
        await expect(terminal().sale({ cents: 3810 })).rejects.toThrow(
          'timed out after accepting the request'
        )
        expect(isKnownReference).toHaveBeenCalledWith('SAVED-EARLIER')
      })

      it('never takes the sale it just approved', async () => {
        const t = terminal()
        state.behavior = { mode: 'data', response: approvedFrame() } // GUID42, $25.99
        await t.sale({ cents: 2599 })
        state.script = [silent, notFound, record({ cents: 2599, uid: 'GUID42' })]
        await expect(t.sale({ cents: 2599 })).rejects.toThrow(
          'timed out after accepting the request'
        )
      })
    })

    it('keeps the sale unknown when the lookups themselves time out', async () => {
      state.script = [silent, { mode: 'timeout', response: Buffer.from([]) }]
      await expect(terminal().sale({ cents: 3810 })).rejects.toThrow(
        'timed out after accepting the request'
      )
      expect(state.connects).toBe(4)
    })

    it('does not look anything up when the terminal never acknowledged', async () => {
      state.behavior = { mode: 'timeout', response: Buffer.from([]) }
      await expect(terminal().sale({ cents: 3810 })).rejects.toThrow(/PAX terminal timed out \(/)
      expect(state.connects).toBe(1)
    })

    describe('pressing Card again on that payment', () => {
      const notFound: SocketBehavior = {
        mode: 'data',
        response: Buffer.from([]),
        respond: () => reportFrame('none', { code: '100023' })
      }

      /** A sale that stays unknown; resolves with the reference its error carries. */
      async function unknownSale(): Promise<string> {
        state.script = [silent, notFound]
        const err = await terminal()
          .sale({ cents: 3810 })
          .catch((e: Error & { ecrRef?: string }) => e)
        const ref = (err as Error & { ecrRef?: string }).ecrRef
        expect(ref).toBe(ecrRefOf(state.requests[0]))
        state.requests = []
        state.connects = 0
        return ref!
      }

      it('finds the earlier sale approved and does not charge again', async () => {
        const ref = await unknownSale()
        state.script = [{ mode: 'data', response: reportFrame(ref) }]

        const result = await terminal().sale({ cents: 3810, retryOf: ref })

        expect(result.success).toBe(true)
        expect(result.reference).toBe('GUID-RECOVERED')
        expect(state.requests.map((r) => unframe(r).split(fs)[0])).toEqual(['R02'])
        const retry = stage('recovery').find((r) => r.trigger === 'retry')
        expect(retry).toMatchObject({ recovered: true, ecrRef: ref })
      })

      it('charges again when the terminal holds no approval for it', async () => {
        const ref = await unknownSale()
        state.script = [notFound, notFound, notFound, { mode: 'data', response: approvedFrame() }]

        const result = await terminal().sale({ cents: 3810, retryOf: ref })

        expect(result.reference).toBe('GUID42')
        const commands = state.requests.map((r) => unframe(r).split(fs)[0])
        // Three attempts, each a reference lookup and the newest record, then the charge.
        expect(commands).toEqual([...Array<string>(6).fill('R02'), 'T00'])
        expect(ecrRefOf(state.requests[6])).not.toBe(ref)
      })

      it('charges without asking when the amount changed', async () => {
        const ref = await unknownSale()
        await terminal().sale({ cents: 2599, retryOf: ref })
        expect(state.requests.map((r) => unframe(r).split(fs)[0])).toEqual(['T00'])
      })

      it('asks about a sale only once', async () => {
        const ref = await unknownSale()
        state.script = [notFound, notFound, notFound, { mode: 'data', response: approvedFrame() }]
        await terminal().sale({ cents: 3810, retryOf: ref })
        state.requests = []
        await terminal().sale({ cents: 3810, retryOf: ref })
        expect(state.requests.map((r) => unframe(r).split(fs)[0])).toEqual(['T00'])
      })

      it('ignores a reference this terminal never left unresolved', async () => {
        await terminal().sale({ cents: 2599, retryOf: 'ECR999999' })
        expect(state.requests.map((r) => unframe(r).split(fs)[0])).toEqual(['T00'])
      })
    })

    it('does not look up a refund the terminal went silent on', async () => {
      state.behavior = silent
      await expect(terminal().refund('GUID42', 500)).rejects.toThrow(
        'timed out after accepting the request'
      )
      expect(state.connects).toBe(1)
    })
  })

  describe('sale lookup check', () => {
    /** An approved sale for $25.99; resolves with the ECR reference it was sent with. */
    async function approvedSale(t = terminal()): Promise<string> {
      state.behavior = { mode: 'data', response: approvedFrame() }
      await t.sale({ cents: 2599 })
      return ecrRefOf(state.lastRequest)
    }
    /** The R03 record of that sale, as the terminal would return it. */
    const recordOf = (
      ref: string,
      overrides: { uid?: string; account?: string } = {}
    ): SocketBehavior => ({
      mode: 'data',
      response: frame(
        [
          '0',
          'R03',
          '1.58',
          '000000',
          'OK',
          '1',
          '1',
          ['000', 'APPROVAL', 'AUTH1', ''].join(us),
          '01',
          '01',
          '',
          ['2599', '0'].join(us),
          [overrides.account ?? '****1111', '', '1231'].join(us),
          ['7', ref].join(us),
          '',
          '',
          '',
          [`GLOBALUID=${overrides.uid ?? 'GUID42'}`, 'CARDBIN=411111'].join(us)
        ].join(fs)
      )
    })

    it('says so when there has been no card sale yet', async () => {
      await expect(terminal().checkSaleLookup()).resolves.toMatchObject({ status: 'no-sale' })
      expect(state.connects).toBe(0)
      expect(metric).not.toHaveBeenCalled()
    })

    it('works when the terminal returns the last sale as recorded', async () => {
      const t = terminal()
      const ref = await approvedSale(t)
      state.script = [recordOf(ref)]
      const result = await t.checkSaleLookup()
      expect(result.status).toBe('works')
      const lookup = unframe(state.lastRequest).split(fs)
      expect([lookup[0], lookup[8]]).toEqual(['R02', ref])
      expect(metric).toHaveBeenCalledWith('pax_lookup_check', 'works')
      expect(report).not.toHaveBeenCalled()
    })

    it('works by newest record when the terminal does not find the sale by reference', async () => {
      const t = terminal()
      await approvedSale(t) // GUID42, ****1111
      state.script = [
        { mode: 'data', response: reportFrame('x', { code: '100023' }) },
        { mode: 'data', response: recordFrame({ cents: 2599, uid: 'GUID42', account: '****1111' }) }
      ]
      const result = await t.checkSaleLookup('daily')
      expect(result.status).toBe('works-recent')
      expect(result.message).toContain('newest record')
      expect(metric).toHaveBeenCalledWith('pax_lookup_check', 'works-recent')
      // Filed all the same: the answers show what this terminal's batch holds.
      const check = stage('lookup-check')[0]
      expect(check).toMatchObject({ status: 'works-recent', trigger: 'daily' })
      expect(check.answers).toEqual([
        'by reference: R03 100023 NOT FOUND',
        expect.stringContaining('latest record: R03 000000 OK')
      ])
    })

    it('is not found when the newest record is some other sale', async () => {
      const t = terminal()
      await approvedSale(t)
      state.script = [
        { mode: 'data', response: reportFrame('x', { code: '100023' }) },
        { mode: 'data', response: recordFrame({ cents: 2599, uid: 'SOMEONE-ELSE' }) }
      ]
      const result = await t.checkSaleLookup()
      expect(result.status).toBe('not-found')
      expect(stage('lookup-check')[0].reason).toContain(
        'newest record reference SOMEONE-ELSE vs GUID42'
      )
    })

    it('files a mismatch with what differed', async () => {
      const t = terminal()
      const ref = await approvedSale(t)
      state.script = [recordOf(ref, { uid: 'OTHER' })]
      expect((await t.checkSaleLookup()).status).toBe('mismatch')
      const check = stage('lookup-check')[0]
      expect(check).toMatchObject({ status: 'mismatch', ecrRef: ref })
      expect(check.reason).toContain('OTHER')
    })

    it.each([
      ['not-found', { mode: 'data', response: reportFrame('x', { code: '100023' }) }],
      ['no-answer', { mode: 'timeout', response: Buffer.from([]) }]
    ] as const)('files %s', async (status, behavior) => {
      const t = terminal()
      await approvedSale(t)
      state.script = [behavior as SocketBehavior]
      expect((await t.checkSaleLookup('daily')).status).toBe(status)
      expect(metric).toHaveBeenCalledWith('pax_lookup_check', status)
      expect(stage('lookup-check')[0]).toMatchObject({ status, trigger: 'daily' })
    })

    it('stands down while a sale is on the terminal', async () => {
      const t = terminal()
      await approvedSale(t)
      state.behavior = { mode: 'hold', response: approvedFrame() }
      const sale = t.sale({ cents: 2599 })
      await vi.waitFor(() => expect(state.deliver).not.toBeNull())
      expect((await t.checkSaleLookup()).status).toBe('busy')
      state.deliver!()
      await sale
      expect(metric).not.toHaveBeenCalled()
    })

    it('runs once a day, shortly after the first approved sale', async () => {
      const t = terminal({ ...HOOKS, timing: { recoveryGapMs: 0, lookupCheckDelayMs: 0 } })
      const ref = await approvedSale(t)
      state.script = [recordOf(ref)]
      await vi.waitFor(() => expect(metric).toHaveBeenCalledWith('pax_lookup_check', 'works'))
      const connects = state.connects
      await approvedSale(t)
      await new Promise((r) => setTimeout(r, 5))
      expect(state.connects).toBe(connects + 1) // the sale, no second check
    })
  })

  it('never lets a timeout override undercut the terminal card-entry window', () => {
    expect(transactionTimeoutMs({ ...CONN, timeout_ms: undefined })).toBe(75_000)
    expect(transactionTimeoutMs({ ...CONN, timeout_ms: 1000 })).toBe(60_000)
    expect(transactionTimeoutMs({ ...CONN, timeout_ms: 180_000 })).toBe(180_000)
  })
})
