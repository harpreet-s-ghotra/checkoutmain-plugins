import { describe, expect, it } from 'vitest'
import {
  ETX,
  FS,
  STX,
  TransType,
  US,
  buildLocalDetailReportRequest,
  buildRecordReportRequest,
  describeDetailReport,
  parseTerminalTime,
  readDetailReport,
  buildReturnRequest,
  buildSaleRequest,
  buildVoidRequest,
  frame,
  hasCompleteFrame,
  lrc,
  parseLocalDetailReport,
  parseResponse,
  unframe
} from './protocol'

const fs = String.fromCharCode(FS)
const us = String.fromCharCode(US)

/** Build a T01 DoCredit response payload mirroring a real RapidConnect frame. */
function makeResponse(opts: {
  code?: string
  msg?: string
  globalUid?: string
  amount?: string
  /** AmountDue — the shortfall the host reports on a partial approval. */
  amountDue?: string
  pan?: string
  bin?: string
  appLabel?: string
  /** Adds PIN-debit signals (PINSTATUSNUM=1, CVM=2) to the AdditionalInformation. */
  pinEntered?: boolean
}): string {
  const {
    code = '000000',
    msg = 'APPROVED',
    globalUid = 'GUID999',
    amount = '2599',
    amountDue = '',
    pan = '************1111',
    bin = '411111',
    appLabel,
    pinEntered = false
  } = opts
  const hostInfo = ['00', 'APPROVAL', 'AUTH123', '', 'TRACE1', 'BATCH1'].join(us)
  const amountInfo = [amount, amountDue, '', ''].join(us)
  const accountInfo = [pan, '2', '1231'].join(us) // [0]=PAN/last4, [2]=expiry
  const traceInfo = ['', 'INV1'].join(us)
  const addlInfo = [
    `CARDBIN=${bin}`,
    ...(appLabel === undefined ? [] : [`APPLAB=${appLabel}`]),
    `GLOBALUID=${globalUid}`,
    ...(pinEntered ? ['PINSTATUSNUM=1', 'CVM=2'] : ['CVM=6']),
    'EDCTYPE=CREDIT'
  ].join(us)
  // 0 packet, 1 cmd, 2 ver, 3 code, 4 msg, 5 host, 6 transtype, 7 amount,
  // 8 account, 9 trace, 10-12 empty, 13 additional, 14 empty.
  return [
    '0',
    'T01',
    '1.58',
    code,
    msg,
    hostInfo,
    '01',
    amountInfo,
    accountInfo,
    traceInfo,
    '',
    '',
    '',
    addlInfo,
    ''
  ].join(fs)
}

describe('framing', () => {
  it('computes LRC as XOR of all bytes', () => {
    expect(lrc(Buffer.from([0x01, 0x02, 0x03]))).toBe(0x01 ^ 0x02 ^ 0x03)
    expect(lrc(Buffer.from([]))).toBe(0)
  })

  it('frames payload as STX + payload + ETX + LRC', () => {
    const out = frame('AB')
    expect(out[0]).toBe(STX)
    expect(out[3]).toBe(ETX)
    expect(out[4]).toBe(lrc(Buffer.from([0x41, 0x42, ETX])))
  })

  it('round-trips frame -> unframe', () => {
    const payload = ['T01', '1.28', '000000', 'APPROVED'].join(fs)
    expect(unframe(frame(payload))).toBe(payload)
  })

  it('ignores the ACK the terminal prefixes to its response', () => {
    const framed = frame('HELLO')
    expect(unframe(Buffer.concat([Buffer.from([0x06]), framed]))).toBe('HELLO')
  })

  it('rejects a frame with a bad LRC', () => {
    const good = frame('HELLO')
    const corrupted = Buffer.from(good)
    corrupted[corrupted.length - 1] = corrupted[corrupted.length - 1] ^ 0xff
    expect(() => unframe(corrupted)).toThrow(/LRC/)
  })

  it('throws on missing STX/ETX', () => {
    expect(() => unframe(Buffer.from([0x41, 0x42]))).toThrow(/STX/)
    expect(() => unframe(Buffer.from([STX, 0x41, 0x42]))).toThrow(/ETX/)
  })

  it('detects complete vs partial frames', () => {
    const full = frame('X')
    expect(hasCompleteFrame(full)).toBe(true)
    expect(hasCompleteFrame(full.subarray(0, full.length - 1))).toBe(false)
    expect(hasCompleteFrame(Buffer.from([STX]))).toBe(false)
  })
})

describe('request builders', () => {
  it('puts the 2-digit TransType at field 2 with plain-cents amount', () => {
    const fields = unframe(buildSaleRequest(2599, 'ECR000001')).split(fs)
    expect(fields[0]).toBe('T00') // Command
    expect(fields[2]).toBe(TransType.SALE) // '01' at the POSLink TransType position
    expect(fields[3].split(us)[0]).toBe('2599') // plain integer cents (no padding)
    expect(fields[5].split(us)[0]).toBe('ECR000001') // TraceInformation.ReferenceNumber
  })

  it('builds return and void with RapidConnect transaction codes', () => {
    const ret = unframe(buildReturnRequest('REF123', 500)).split(fs)
    expect(ret[2]).toBe(TransType.RETURN) // '02'
    expect(ret[3].split(us)[0]).toBe('500')
    const vd = unframe(buildVoidRequest('REF123')).split(fs)
    expect(vd[2]).toBe(TransType.VOID) // '11'
    expect(vd[5].split(us)[0]).toBe('REF123')
  })
})

describe('response parsing', () => {
  it('maps an approval to a successful charge result', () => {
    const result = parseResponse(makeResponse({}), 2599)
    expect(result.status).toBe('approved')
    expect(result.success).toBe(true)
    expect(result.reference).toBe('GUID999') // reference from GLOBALUID
    expect(result.lastFour).toBe('1111') // from account[0]
    expect(result.cardBrand).toBe('Visa') // derived from CARDBIN 411111
    expect(result.approvedCents).toBe(2599)
    expect(result.authCode).toBe('AUTH123')
    expect(result.hostCode).toBe('00')
  })

  it('maps a non-approval code to a decline', () => {
    const result = parseResponse(makeResponse({ code: '100002', msg: 'DECLINED' }), 1000)
    expect(result.status).toBe('declined')
    expect(result.success).toBe(false)
    expect(result.message).toBe('DECLINED')
    expect(result.responseCode).toBe('100002')
  })

  it('falls back to the requested amount when none is echoed', () => {
    const result = parseResponse(makeResponse({ amount: '' }), 1250)
    expect(result.approvedCents).toBe(1250)
  })

  it('derives the brand from the EMV app label when CARDBIN is empty (credit approval)', () => {
    // Real credit approvals on this host return an empty CARDBIN; the brand must
    // fall back to APPLAB rather than reporting "unknown".
    const result = parseResponse(makeResponse({ bin: ' ', appLabel: 'VISA CREDIT' }), 2599)
    expect(result.cardBrand).toBe('Visa')
  })

  it('reports tenderType from the terminal — PIN entered → debit, else credit', () => {
    // No PIN (signature / CVM=6) → credit.
    expect(parseResponse(makeResponse({}), 2599).tenderType).toBe('credit')
    // Online PIN (PINSTATUSNUM=1, CVM=2) → debit, regardless of the selected tender.
    expect(parseResponse(makeResponse({ pinEntered: true }), 2599).tenderType).toBe('debit')
  })

  it('parses a Visa credit approval frame captured from a live RapidConnect terminal', () => {
    // 2026-07-17: ResponseCode 000000, empty CARDBIN, APPLAB=VISA CREDIT, a
    // masked account ending 9999, GLOBALUID reference.
    const hex =
      '0602301c5430311c312e35381c3030303030301c4f4b1c3030301f415050524f56414c1f3039323732431f321f321f301f3338363139383136303032383831311c30311c311f301f301f301f301f301f1f1f301f301f301f301f301f301c393939391f321f303733311f1f1f1f30311f43415244484f4c4445522f564953411f1f1f301c311f4853504f533030303030341f32303236303731373030323633391c1c1c1c4341524442494e3d201f4154433d303031321f4150504e414d453d434841534520564953411f4150504c41423d56495341204352454449541f43564d3d361f534e3d323239303232383033391f454443545950453d4352454449541f4941443d30363032313230334130303030301f485245443d38413032333033303546333430313032394633393031303739313038354439373436443630303832303030301f4149443d41303030303030303033313031301f474c4f42414c5549443d323239303232383033393230323630373137303032363339383738341f50414e5345514e554d3d30321f5456523d303030303030303030301f50524f4752414d545950453d301c1c032b'
    const result = parseResponse(unframe(Buffer.from(hex, 'hex')), 1)
    expect(result.success).toBe(true)
    expect(result.status).toBe('approved')
    expect(result.lastFour).toBe('9999')
    expect(result.cardBrand).toBe('Visa')
    expect(result.reference).toBe('2290228039202607170026398784')
    expect(result.approvedCents).toBe(1)
    expect(result.tenderType).toBe('credit')
  })
})

describe('partial approvals', () => {
  // Captured live 2026-07-25 from a $20 prepaid Visa rung for $27.22:
  // response 000002 "PARTIALLY APPROVED", host 002 "APPRV LESSER AMT",
  // ApproveAmount 1891, AmountDue 831.
  const partialFrame = (): string =>
    makeResponse({
      code: '000002',
      msg: 'PARTIALLY APPROVED',
      amount: '1891',
      amountDue: '831'
    })

  it('treats a partial approval as a SUCCESS, not a decline', () => {
    const result = parseResponse(partialFrame(), 2722)
    expect(result.success).toBe(true)
    expect(result.status).toBe('approved')
    expect(result.partial).toBe(true)
  })

  it('reports the amount the host captured, not the amount requested', () => {
    const result = parseResponse(partialFrame(), 2722)
    expect(result.approvedCents).toBe(1891)
    expect(result.amountDueCents).toBe(831)
  })

  it('tells the cashier what was taken and what is still owed', () => {
    expect(parseResponse(partialFrame(), 2722).message).toBe(
      'Card approved $18.91 of $27.22 — $8.31 still due'
    )
  })

  it('keeps the reference so the partial can be voided or refunded', () => {
    expect(parseResponse(partialFrame(), 2722).reference).toBe('GUID999')
  })

  it('derives the shortfall when the host omits AmountDue', () => {
    const frame = makeResponse({ code: '000002', msg: 'PARTIAL', amount: '1000', amountDue: '' })
    const result = parseResponse(frame, 2500)
    expect(result.partial).toBe(true)
    expect(result.approvedCents).toBe(1000)
    expect(result.amountDueCents).toBe(1500)
  })

  it('is not partial when the full amount is approved', () => {
    const result = parseResponse(makeResponse({ amount: '2599' }), 2599)
    expect(result.partial).toBeUndefined()
    expect(result.amountDueCents).toBeUndefined()
  })

  it('is not partial when the host approves MORE than requested', () => {
    const result = parseResponse(makeResponse({ amount: '2599' }), 2000)
    expect(result.partial).toBeUndefined()
    expect(result.success).toBe(true)
  })

  it('stays a decline when nothing was approved', () => {
    const frame = makeResponse({ code: '000100', msg: 'DECLINE', amount: '0', amountDue: '0' })
    const result = parseResponse(frame, 2722)
    expect(result.success).toBe(false)
    expect(result.partial).toBeUndefined()
    expect(result.status).toBe('declined')
  })
})

describe('LocalDetailReport (sale lookup)', () => {
  const ref = 'ECR123456'
  function report(overrides: Record<number, string> = {}): string {
    const f = [
      '0',
      'R03',
      '1.58',
      '000000',
      'OK',
      '1',
      '1',
      ['000', 'APPROVAL', 'AUTH9', 'HREF'].join(us),
      '02',
      '01',
      '',
      ['3810', '0'].join(us),
      ['****8732', '', '1230'].join(us),
      ['7', ref, '20261022192019'].join(us),
      '',
      '',
      '',
      ['GLOBALUID=GUID9', 'APPLAB=US DEBIT', 'CVM=1'].join(us)
    ]
    for (const [i, v] of Object.entries(overrides)) f[Number(i)] = v
    return f.join(fs)
  }

  it('asks for every card type by the ECR reference', () => {
    const fields = unframe(buildLocalDetailReportRequest(ref)).split(fs)
    expect(fields).toEqual(['R02', '1.58', '00', '', '', '', '', '', ref, ''])
  })

  it('rewrites a matching approval as the T01 the sale should have received', () => {
    const result = parseLocalDetailReport(report(), ref, 3810)
    expect(result.found).toBe(true)
    if (!result.found) return
    const sale = parseResponse(result.payload, 3810)
    expect(sale).toMatchObject({
      success: true,
      reference: 'GUID9',
      lastFour: '8732',
      tenderType: 'debit',
      approvedCents: 3810,
      status: 'approved'
    })
  })

  it.each([
    ['another command', { 1: 'T01' }, 'unexpected command T01'],
    ['a failed report', { 3: '100023', 4: 'NOT FOUND' }, 'report answered 100023 NOT FOUND'],
    ['several records', { 5: '3' }, 'report holds 3 records'],
    ['another sale', { 13: ['7', 'ECR000001'].join(us) }, 'record is not this sale'],
    ['a decline', { 7: ['500', 'DECLINE'].join(us) }, 'record not approved (host 500)'],
    ['a partial amount', { 11: ['2000', '1810'].join(us) }, 'record approved 2000 of 3810']
  ])('refuses %s', (_label, overrides, reason) => {
    expect(parseLocalDetailReport(report(overrides), ref, 3810)).toEqual({ found: false, reason })
  })

  it('asks for a record by position, and for the default one with no position', () => {
    expect(unframe(buildRecordReportRequest(41)).split(fs)).toEqual([
      'R02',
      '1.58',
      '00',
      '',
      '',
      '41',
      '',
      '',
      '',
      ''
    ])
    expect(unframe(buildRecordReportRequest(null)).split(fs)[5]).toBe('')
  })

  it('reads a record with no opinion on whose sale it is', () => {
    const read = readDetailReport(report({ 5: '12', 6: '11' }))
    expect(read.ok).toBe(true)
    if (!read.ok) return
    expect(read.record).toMatchObject({
      totalRecords: 12,
      recordNumber: 11,
      hostCode: '000',
      transType: '01',
      approvedCents: 3810,
      lastFour: '8732',
      ecrRef: ref,
      timestamp: '20261022192019',
      globalUid: 'GUID9'
    })
    expect(parseResponse(read.record.t01, 3810).reference).toBe('GUID9')
    expect(readDetailReport(report({ 3: '100023', 4: 'NOT FOUND' }))).toEqual({
      ok: false,
      reason: 'report answered 100023 NOT FOUND'
    })
  })

  it('describes an answer without the account field', () => {
    const line = describeDetailReport(report())
    expect(line).toBe(
      `R03 000000 OK records=1 record=1 host=000 APPROVAL type=01 amount=3810 last4=8732 trace=7/${ref}/20261022192019 uid=GUID9`
    )
    expect(line).not.toContain('****')
    expect(describeDetailReport(report({ 3: '100023', 4: 'NOT FOUND' }))).toBe(
      'R03 100023 NOT FOUND'
    )
  })

  it('reads the terminal clock as local time', () => {
    expect(parseTerminalTime('20261022192019')).toBe(new Date(2026, 9, 22, 19, 20, 19).getTime())
    expect(parseTerminalTime('')).toBeNull()
    expect(parseTerminalTime('2026-10-22')).toBeNull()
  })
})
