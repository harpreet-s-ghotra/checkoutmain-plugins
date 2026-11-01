import type { PaxChargeResult, PaxResponseSummary } from './types'

/**
 * PAX POSLink semi-integrated protocol — framing + message build/parse.
 *
 * Framing (STX … ETX + LRC, LRC = XOR over payload+ETX) is the documented,
 * stable layer and is implemented fully.
 *
 * The DoCredit (T00) request and (T01) response are POSITIONAL: top-level fields
 * are FS-delimited and several are themselves US-delimited groups (Amount /
 * Account / Trace / Host information). The structure below follows the public
 * POSLink layout and was confirmed against live Fiserv/First Data RapidConnect
 * terminals. The `TransType` codes are the RapidConnect ones; another host
 * application on the same POSLink may use others — they are isolated in
 * `TransType` for that reason.
 */

// ── Control bytes ──
export const STX = 0x02
export const ETX = 0x03
/** Field separator between top-level fields. */
export const FS = 0x1c
/** Unit separator for sub-fields within a field group. */
export const US = 0x1f

export const CMD_DO_CREDIT = 'T00'
export const CMD_DO_CREDIT_RESPONSE = 'T01'

/**
 * Leading packet field the terminal prefixes to its RESPONSE
 * (`STX "0" FS "T01" …`). It is response-only — adding it to a request makes the
 * terminal reject the packet outright (no ACK), so requests start with the
 * command. Kept for response parsing offsets.
 */
export const PACKET_INFO = '0'

/** ACK / NAK control bytes (POSLink request/response handshake). */
export const ACK = 0x06
export const NAK = 0x15

/**
 * Protocol version string sent in every request. Must match the terminal's
 * POSLink app version — a mismatch makes the terminal misparse later fields
 * (observed: "TRANS TYPE NULL"). RapidConnect terminals report 1.58.
 */
export const PROTOCOL_VERSION = '1.58'

/**
 * Fiserv/First Data RapidConnect transaction codes — fixed-width 2-digit strings.
 * SALE=01, RETURN(refund)=02, VOID(reversal)=11.
 */
export const TransType = {
  SALE: '01',
  RETURN: '02',
  VOID: '11'
} as const

/**
 * POSLink ECR amount: plain integer cents, no padding/symbols (e.g. 1102 = $11.02).
 * The terminal applies the host's 12-char zero-padding itself — sending it padded
 * here is rejected as "AMOUNT INVALID".
 */
export function formatAmount(cents: number): string {
  return String(Math.max(0, Math.round(cents)))
}

/** "000000" is the POSLink approval response code; anything else is decline/error. */
export const APPROVAL_CODE = '000000'

const fs = String.fromCharCode(FS)
const us = String.fromCharCode(US)

/** XOR-based LRC over the bytes from after STX through ETX inclusive. */
export function lrc(bytes: Buffer): number {
  let acc = 0
  for (const b of bytes) acc ^= b
  return acc & 0xff
}

/** Frame a payload string into `STX + payload + ETX + LRC` (LRC over payload+ETX). */
export function frame(payload: string): Buffer {
  const payloadBytes = Buffer.from(payload, 'ascii')
  const body = Buffer.concat([payloadBytes, Buffer.from([ETX])])
  return Buffer.concat([Buffer.from([STX]), body, Buffer.from([lrc(body)])])
}

/**
 * Strip and validate a framed response. Locates STX anywhere in the buffer so a
 * leading ACK (0x06) — which the terminal prefixes to its response — is ignored.
 * Throws on bad framing/LRC.
 */
export function unframe(buf: Buffer): string {
  const stxIndex = buf.indexOf(STX)
  if (stxIndex < 0) throw new Error('PAX response: missing STX')
  const etxIndex = buf.indexOf(ETX, stxIndex + 1)
  if (etxIndex < 0) throw new Error('PAX response: missing ETX')
  const receivedLrc = buf[etxIndex + 1]
  if (receivedLrc === undefined) throw new Error('PAX response: missing LRC')
  const body = buf.subarray(stxIndex + 1, etxIndex + 1)
  if (lrc(body) !== receivedLrc) throw new Error('PAX response: LRC check failed')
  return buf.subarray(stxIndex + 1, etxIndex).toString('ascii')
}

/** Whether a complete frame (STX…ETX + LRC) is present, ignoring a leading ACK. */
export function hasCompleteFrame(buf: Buffer): boolean {
  const stxIndex = buf.indexOf(STX)
  if (stxIndex < 0) return false
  const etxIndex = buf.indexOf(ETX, stxIndex + 1)
  return etxIndex >= 0 && buf.length >= etxIndex + 2
}

/** Join sub-fields into a US-delimited group. */
function group(...parts: Array<string | number>): string {
  return parts.map(String).join(us)
}

/**
 * Build a DoCredit (T00) request. TransType is the RapidConnect 2-digit code at
 * the POSLink TransType position (field 2) — the terminal maps this field to the
 * host transaction code, so IndustryCode/TenderType are NOT sent here (the
 * terminal sets those host-side). Field order:
 *   0 Command, 1 Version, 2 TransType (01/02/11),
 *   3 AmountInformation  (US: TransactionAmount[plain cents], Tip, CashBack, ...)
 *   4 AccountInformation (empty — card is read on the terminal)
 *   5 TraceInformation   (US: ReferenceNumber, InvoiceNumber, ...)
 *   6 AVS, 7 Cashier, 8 Commercial, 9 MOTO, 10 Additional (empty for a basic sale)
 */
function buildDoCredit(opts: {
  transType: string
  amountCents?: number
  referenceNumber?: string
}): Buffer {
  const amountInfo =
    opts.amountCents != null ? group(formatAmount(opts.amountCents), '', '', '', '', '') : ''
  const accountInfo = ''
  const traceInfo = group(opts.referenceNumber ?? '', '', '', '', '', '')
  const payload = [
    CMD_DO_CREDIT,
    PROTOCOL_VERSION,
    opts.transType,
    amountInfo,
    accountInfo,
    traceInfo,
    '', // AVS Information
    '', // Cashier Information
    '', // Commercial Information
    '', // MOTO Information
    '' // Additional Information
  ].join(fs)
  return frame(payload)
}

/** Build a SALE request for an amount in cents, tagged with an ECR reference. */
export function buildSaleRequest(amountCents: number, ecrRef: string): Buffer {
  return buildDoCredit({ transType: TransType.SALE, amountCents, referenceNumber: ecrRef })
}

/** Build a RETURN (refund) request for an amount in cents against a prior ref. */
export function buildReturnRequest(referenceNumber: string, amountCents: number): Buffer {
  return buildDoCredit({ transType: TransType.RETURN, amountCents, referenceNumber })
}

/** Build a VOID request against a prior reference (full amount). */
export function buildVoidRequest(referenceNumber: string): Buffer {
  return buildDoCredit({ transType: TransType.VOID, referenceNumber })
}

export const CMD_LOCAL_DETAIL_REPORT = 'R02'
export const CMD_LOCAL_DETAIL_REPORT_RESPONSE = 'R03'

/** EDC type "all" in a report request: credit and debit both. */
const EDC_TYPE_ALL = '00'

/**
 * Build a LocalDetailReport (R02) request that looks up one transaction in the
 * terminal's open batch by the ECR reference the sale was sent with. This is the
 * POSLink status inquiry for a sale whose answer never reached us. Field order,
 * from Global Payments' PAX SDK (`BuildReportTransaction`):
 *   0 Command, 1 Version, 2 EDCType, 3 TransType, 4 CardType, 5 RecordNumber,
 *   6 TerminalRefNum (the terminal's own transaction number), 7 AuthCode,
 *   8 ReferenceNumber (the ECR reference sent in the sale's T00), 9 ExtData
 * An early build sent the ECR reference at field 6, and every terminal answered
 * `100003 TRANS# INVALID`. `parseLocalDetailReport` trusts an answer only when
 * every check passes, and anything else leaves the sale exactly as unknown as it
 * was.
 */
export function buildLocalDetailReportRequest(ecrRef: string): Buffer {
  return frame(
    [CMD_LOCAL_DETAIL_REPORT, PROTOCOL_VERSION, EDC_TYPE_ALL, '', '', '', '', '', ecrRef, ''].join(
      fs
    )
  )
}

/**
 * Build a LocalDetailReport (R02) request for one record of the terminal's
 * batch by position (RecordNumber, field 5) and nothing else; null asks for the
 * record the terminal returns when no filter is given. This is how a sale is
 * found on a terminal that does not find it by our reference: some RapidConnect
 * terminals answer `100023 NOT FOUND` to every reference lookup, so the newest
 * records are read and matched by amount and time instead.
 */
export function buildRecordReportRequest(recordNumber: number | null): Buffer {
  const index = recordNumber === null ? '' : String(recordNumber)
  return frame(
    [CMD_LOCAL_DETAIL_REPORT, PROTOCOL_VERSION, EDC_TYPE_ALL, '', '', index, '', '', '', ''].join(
      fs
    )
  )
}

/** Host response code on every approval RapidConnect terminals have returned. */
export const HOST_APPROVAL_CODE = '000'

/** One record of a LocalDetailReport answer, the fields a lookup decides on. */
export type DetailRecord = {
  totalRecords: number | null
  recordNumber: number | null
  hostCode: string
  transType: string
  approvedCents: number | null
  lastFour: string
  /** The TraceInformation group: transaction number, our reference if kept, the terminal's clock. */
  trace: string[]
  /** The ECR reference the terminal kept with the record, if any (trace field 1). */
  ecrRef: string
  /** The terminal's clock at the transaction, `YYYYMMDDhhmmss`, or ''. */
  timestamp: string
  globalUid: string
  /** The record rewritten as the T01 the sale should have received. */
  t01: string
}

export type DetailReport = { ok: true; record: DetailRecord } | { ok: false; reason: string }

/** The terminal's `YYYYMMDDhhmmss` (its local clock) as epoch ms, or null. */
export function parseTerminalTime(stamp: string): number | null {
  const m = /^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})$/.exec(stamp.trim())
  if (!m) return null
  const [, y, mo, d, h, mi, s] = m.map(Number)
  const at = new Date(y, mo - 1, d, h, mi, s).getTime()
  return Number.isFinite(at) ? at : null
}

/** An R03 record as the T01 approval it stands for, for `parseResponse`. */
function recordAsT01(f: string[]): string {
  const ext = f.slice(14).find((x) => x.includes('GLOBALUID=') || x.includes('CARDBIN=')) ?? ''
  return [
    PACKET_INFO,
    CMD_DO_CREDIT_RESPONSE,
    f[2] ?? PROTOCOL_VERSION,
    APPROVAL_CODE,
    'APPROVED',
    f[7] ?? '',
    f[9] ?? '',
    f[11] ?? '',
    f[12] ?? '',
    f[13] ?? '',
    '',
    '',
    '',
    ext
  ].join(fs)
}

/**
 * Read a LocalDetailReport (R03) answer as one record, with no opinion on
 * whether it is the sale being looked for; `parseLocalDetailReport` has that
 * opinion for a reference lookup, the terminal's recent-record match for the
 * rest. Not ok when the report itself failed.
 */
export function readDetailReport(payload: string): DetailReport {
  const f = splitFields(payload)
  if (f[1] !== CMD_LOCAL_DETAIL_REPORT_RESPONSE) {
    return { ok: false, reason: `unexpected command ${f[1] ?? '(none)'}` }
  }
  if (f[3] !== APPROVAL_CODE) {
    return { ok: false, reason: `report answered ${f[3] ?? ''} ${f[4] ?? ''}`.trim() }
  }
  const trace = splitGroup(f[13])
  const addl = parseAdditionalInfo(f)
  return {
    ok: true,
    record: {
      totalRecords: intOrNull(f[5]),
      recordNumber: intOrNull(f[6]),
      hostCode: splitGroup(f[7])[0] ?? '',
      transType: f[9] ?? '',
      approvedCents: intOrNull(splitGroup(f[11])[0]),
      lastFour: (splitGroup(f[12])[0] ?? '').replace(/\D/g, '').slice(-4),
      trace,
      ecrRef: trace[1] ?? '',
      timestamp: trace[2] ?? '',
      globalUid: addl.GLOBALUID ?? '',
      t01: recordAsT01(f)
    }
  }
}

/**
 * One line describing an R03 answer for a log or a support row: what the
 * terminal said, and for a record its position, host code, type, amount,
 * masked last four, trace group and GLOBALUID. Never the account field itself.
 */
export function describeDetailReport(payload: string): string {
  const f = splitFields(payload)
  const head = `${f[1] ?? '?'} ${f[3] ?? ''} ${f[4] ?? ''}`.trim()
  if (f[1] !== CMD_LOCAL_DETAIL_REPORT_RESPONSE || f[3] !== APPROVAL_CODE) return head
  const host = splitGroup(f[7])
  const lastFour = (splitGroup(f[12])[0] ?? '').replace(/\D/g, '').slice(-4)
  return (
    `${head} records=${f[5] ?? '?'} record=${f[6] ?? '?'} host=${host[0] ?? ''} ${host[1] ?? ''} ` +
    `type=${f[9] ?? ''} amount=${splitGroup(f[11])[0] ?? ''} last4=${lastFour} ` +
    `trace=${splitGroup(f[13]).join('/')} uid=${parseAdditionalInfo(f).GLOBALUID ?? ''}`
  )
}

export type RecoveredSale = { found: true; payload: string } | { found: false; reason: string }

/**
 * Read a LocalDetailReport (R03) answer for the sale sent as `ecrRef` for
 * `requestedCents`. Field order:
 *   0 PacketInfo, 1 Command, 2 Version, 3 ResponseCode, 4 ResponseMessage,
 *   5 TotalRecord, 6 RecordNumber, 7 HostInformation, 8 EDCType, 9 TransType,
 *   10 OrigTransType, 11 AmountInformation, 12 AccountInformation,
 *   13 TraceInformation, 14 Cashier, 15 Commercial, 16 Check, 17 ExtData
 *
 * Found only when the report succeeded, holds exactly one record, that record
 * carries our ECR reference, the host approved it with the approval code, and it
 * approved the full amount. The record is then rewritten as the T01 response the
 * sale should have received, so `parseResponse` reads it exactly as it reads a
 * live approval (last four, brand, GLOBALUID, credit or debit).
 */
export function parseLocalDetailReport(
  payload: string,
  ecrRef: string,
  requestedCents: number
): RecoveredSale {
  const read = readDetailReport(payload)
  if (!read.ok) return { found: false, reason: read.reason }
  const r = read.record
  if (r.totalRecords !== 1)
    return { found: false, reason: `report holds ${r.totalRecords ?? '?'} records` }
  if (!r.trace.includes(ecrRef)) return { found: false, reason: 'record is not this sale' }
  if (r.hostCode !== HOST_APPROVAL_CODE) {
    return { found: false, reason: `record not approved (host ${r.hostCode})` }
  }
  if (r.approvedCents !== requestedCents) {
    return {
      found: false,
      reason: `record approved ${r.approvedCents ?? '?'} of ${requestedCents}`
    }
  }
  return { found: true, payload: r.t01 }
}

/** Split an FS-delimited payload into its top-level fields. */
export function splitFields(payload: string): string[] {
  return payload.split(fs)
}

/** Split a US-delimited field group into its sub-fields. */
export function splitGroup(field: string | undefined): string[] {
  return (field ?? '').split(us)
}

/**
 * The AdditionalInformation field is a US-delimited list of KEY=VALUE pairs
 * (CARDBIN, GLOBALUID, EDCTYPE, APPLAB, AID, ...). Locate it by content and parse
 * it into a map — more robust than a positional index.
 */
function parseAdditionalInfo(fields: string[]): Record<string, string> {
  const field = fields.find((f) => f.includes('GLOBALUID=') || f.includes('CARDBIN='))
  const map: Record<string, string> = {}
  if (!field) return map
  for (const pair of field.split(us)) {
    const eq = pair.indexOf('=')
    if (eq > 0) map[pair.slice(0, eq)] = pair.slice(eq + 1)
  }
  return map
}

/** Derive a card brand from the BIN's leading digit. */
function brandFromBin(bin: string | undefined): string {
  const d = (bin ?? '').trim()[0]
  if (d === '4') return 'Visa'
  if (d === '5') return 'Mastercard'
  if (d === '3') return 'Amex'
  if (d === '6') return 'Discover'
  return 'unknown'
}

/**
 * Derive a card brand from the EMV application label / name. Credit approvals on
 * RapidConnect return an empty `CARDBIN` (observed 2026-07-17), so the brand must
 * fall back to `APPLAB` ("VISA CREDIT") / `APPNAME` ("CHASE VISA").
 */
function brandFromAppLabel(label: string | undefined): string {
  const u = (label ?? '').toUpperCase()
  if (u.includes('VISA')) return 'Visa'
  if (u.includes('MASTERCARD') || u.includes('MASTER CARD') || u.includes('MC')) return 'Mastercard'
  if (u.includes('AMEX') || u.includes('AMERICAN EXPRESS')) return 'Amex'
  if (u.includes('DISCOVER')) return 'Discover'
  return 'unknown'
}

function intOrNull(value: string | undefined): number | null {
  const n = Number.parseInt(value ?? '', 10)
  return Number.isFinite(n) ? n : null
}

/** Summarize a T01 response payload for diagnostics and failure reporting. */
export function describeResponse(payload: string): PaxResponseSummary {
  const f = splitFields(payload)
  const host = splitGroup(f[5])
  const amount = splitGroup(f[7])
  const account = splitGroup(f[8])
  const addl = parseAdditionalInfo(f)
  const binBrand = brandFromBin(addl.CARDBIN)
  return {
    responseCode: f[3] ?? '',
    responseMessage: f[4] ?? '',
    hostCode: host[0] ?? '',
    hostMessage: host[1] ?? '',
    authCode: host[2] ?? '',
    approveAmountCents: intOrNull(amount[0]),
    amountDueCents: intOrNull(amount[1]),
    lastFour: (account[0] ?? '').replace(/\D/g, '').slice(-4),
    cardBrand: binBrand !== 'unknown' ? binBrand : brandFromAppLabel(addl.APPLAB || addl.APPNAME),
    aid: addl.AID ?? '',
    edcType: addl.EDCTYPE ?? '',
    tvr: addl.TVR ?? '',
    cvm: addl.CVM ?? '',
    globalUid: addl.GLOBALUID ?? '',
    trace: splitGroup(f[9]).join('/')
  }
}

/**
 * True when the host captured less than was asked for — a partial approval.
 * Deliberately derived from the amounts rather than a magic response code, so it
 * holds regardless of how a host spells a partial.
 */
export function isPartialApproval(summary: PaxResponseSummary, requestedCents: number): boolean {
  const approved = summary.approveAmountCents
  return approved != null && approved > 0 && approved < requestedCents
}

const dollars = (cents: number): string => `$${(cents / 100).toFixed(2)}`

/**
 * Parse a DoCredit (T01) response. Field order (FS-separated):
 *   0 PacketInfo ("0"), 1 Command, 2 Version, 3 ResponseCode, 4 ResponseMessage,
 *   5 HostInformation    (US: HostRespCode, HostRespMsg, AuthCode, HostReferenceNumber, Trace, Batch)
 *   6 TransType
 *   7 AmountInformation  (US: ApproveAmount, AmountDue, TipAmount, ...)
 *   8 AccountInformation (US: Account(masked), EXPD, CardType, ...)
 *   9 TraceInformation   (US: ReferenceNumber, InvoiceNumber, ...)
 */
export function parseResponse(payload: string, requestedCents: number): PaxChargeResult {
  const f = splitFields(payload)
  const responseCode = f[3] ?? ''
  const responseMessage = f[4] ?? ''
  const host = splitGroup(f[5])
  const amount = splitGroup(f[7])
  const account = splitGroup(f[8])
  const trace = splitGroup(f[9])
  const addl = parseAdditionalInfo(f)

  // Durable reference for void/refund: GLOBALUID is present on both approvals and
  // declines; fall back to the host reference / trace ref.
  const reference = addl.GLOBALUID || host[3] || trace[0] || ''
  const echoedCents = Number.parseInt(amount[0] ?? '', 10)
  const approvedCents =
    Number.isFinite(echoedCents) && echoedCents > 0 ? echoedCents : Math.round(requestedCents)
  const lastFour = (account[0] ?? '').replace(/\D/g, '').slice(-4)
  // Brand comes from the card BIN in AdditionalInformation (account[2] is expiry).
  // Credit approvals return an empty CARDBIN, so fall back to the EMV app
  // label/name (APPLAB/APPNAME) before giving up.
  const binBrand = brandFromBin(addl.CARDBIN)
  const cardBrand =
    binBrand !== 'unknown' ? binBrand : brandFromAppLabel(addl.APPLAB || addl.APPNAME)

  // How the card was actually processed: a PIN was entered (online/offline PIN
  // CVM, or a non-zero PIN status) → debit; signature/no-CVM → credit. This is the
  // truth of what happened, regardless of which tender button the cashier pressed.
  const pinEntered =
    (addl.PINSTATUSNUM != null && addl.PINSTATUSNUM !== '0') || addl.CVM === '1' || addl.CVM === '2'
  const tenderType: 'credit' | 'debit' = pinEntered ? 'debit' : 'credit'

  const fullyApproved = responseCode === APPROVAL_CODE

  // A PARTIAL approval is money captured, not a decline: the card covered part of
  // the sale and the host returns the shortfall in AmountDue. Treating it as a
  // decline silently loses the captured amount — the cashier sees the full total
  // still owing while the customer has already been charged. Detected from the
  // amounts rather than the response code so it holds however a host spells it;
  // observed as 000002 "PARTIALLY APPROVED" / 002 "APPRV LESSER AMT" on a prepaid
  // card with insufficient balance.
  const requested = Math.round(requestedCents)
  const partial =
    !fullyApproved && Number.isFinite(echoedCents) && echoedCents > 0 && echoedCents < requested
  const dueCents = Number.parseInt(amount[1] ?? '', 10)
  const amountDueCents =
    Number.isFinite(dueCents) && dueCents > 0 ? dueCents : Math.round(requested - echoedCents)
  const approved = fullyApproved || partial

  return {
    reference,
    success: approved,
    status: approved ? 'approved' : 'declined',
    message: partial
      ? `Card approved ${dollars(approvedCents)} of ${dollars(requested)} — ${dollars(amountDueCents)} still due`
      : approved
        ? responseMessage || 'Approved'
        : responseMessage || 'Card declined',
    lastFour,
    cardBrand,
    tenderType,
    approvedCents,
    ...(partial ? { partial: true, amountDueCents } : {}),
    responseCode,
    hostCode: host[0] ?? '',
    authCode: host[2] ?? ''
  }
}
