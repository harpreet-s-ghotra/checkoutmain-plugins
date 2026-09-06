import { describe, it, expect } from 'vitest'
import { confirmScan, createConfirmState, normalizeScannedCode } from './confirm'

describe('normalizeScannedCode', () => {
  it('strips the EAN-13 leading zero down to the printed UPC-A digits', () => {
    expect(normalizeScannedCode('0087000005525')).toBe('087000005525')
  })

  it('leaves true EAN-13 codes (non-zero first digit) untouched', () => {
    expect(normalizeScannedCode('4008948194900')).toBe('4008948194900')
  })

  it('leaves 12-digit UPC-A, short codes, and alphanumerics untouched', () => {
    expect(normalizeScannedCode('087000005525')).toBe('087000005525')
    expect(normalizeScannedCode('12345678')).toBe('12345678')
    expect(normalizeScannedCode('AB-0123456789')).toBe('AB-0123456789')
  })

  it('trims whitespace', () => {
    expect(normalizeScannedCode(' 0087000005525 ')).toBe('087000005525')
  })
})

describe('confirmScan', () => {
  it('requires the same code on two consecutive decodes', () => {
    const state = createConfirmState()
    expect(confirmScan(state, '087000005525', 1000)).toBeNull()
    expect(confirmScan(state, '087000005525', 1030)).toBe('087000005525')
  })

  it('a different code restarts confirmation (misread rejected)', () => {
    const state = createConfirmState()
    expect(confirmScan(state, '0818290012593', 1000)).toBeNull()
    expect(confirmScan(state, '8878760012593', 1030)).toBeNull()
    expect(confirmScan(state, '0818290012593', 1060)).toBeNull()
    expect(confirmScan(state, '0818290012593', 1090)).toBe('0818290012593')
  })

  it('a stale pending code does not confirm', () => {
    const state = createConfirmState()
    expect(confirmScan(state, '087000005525', 1000)).toBeNull()
    expect(confirmScan(state, '087000005525', 4000)).toBeNull()
    expect(confirmScan(state, '087000005525', 4020)).toBe('087000005525')
  })

  it('resets after a confirmation so a rescan needs two frames again', () => {
    const state = createConfirmState()
    confirmScan(state, 'A11111111111', 1000)
    expect(confirmScan(state, 'A11111111111', 1020)).toBe('A11111111111')
    expect(confirmScan(state, 'A11111111111', 1040)).toBeNull()
    expect(confirmScan(state, 'A11111111111', 1060)).toBe('A11111111111')
  })
})
