import { describe, it, expect } from 'vitest'
import { createParserState, parseScannerInput } from './parser'

describe('parseScannerInput', () => {
  it('returns null until flush is received', () => {
    const state = createParserState()
    expect(parseScannerInput(state, { type: 'char', key: '5', timestamp: 0 })).toBeNull()
    expect(parseScannerInput(state, { type: 'char', key: '0', timestamp: 1 })).toBeNull()
    expect(parseScannerInput(state, { type: 'char', key: '0', timestamp: 2 })).toBeNull()
    expect(parseScannerInput(state, { type: 'char', key: '0', timestamp: 3 })).toBeNull()
    expect(parseScannerInput(state, { type: 'flush', timestamp: 4 })).toBe('5000')
  })

  it('flushes the accumulated buffer in scanner-fast bursts', () => {
    const state = createParserState()
    const ts0 = 100
    'abc12345'.split('').forEach((char, i) => {
      parseScannerInput(state, { type: 'char', key: char, timestamp: ts0 + i * 5 })
    })
    expect(parseScannerInput(state, { type: 'flush', timestamp: ts0 + 100 })).toBe('abc12345')
  })

  it('resets when the inter-key gap exceeds intervalMs', () => {
    const state = createParserState()
    parseScannerInput(state, { type: 'char', key: 'A', timestamp: 0 })
    parseScannerInput(state, { type: 'char', key: 'B', timestamp: 5 })
    // long pause discards the AB buffer
    parseScannerInput(state, { type: 'char', key: 'X', timestamp: 200 })
    parseScannerInput(state, { type: 'char', key: 'Y', timestamp: 205 })
    parseScannerInput(state, { type: 'char', key: 'Z', timestamp: 210 })
    expect(parseScannerInput(state, { type: 'flush', timestamp: 215 })).toBe('XYZ')
  })

  it('discards buffers shorter than minLength on flush', () => {
    const state = createParserState()
    parseScannerInput(state, { type: 'char', key: 'a', timestamp: 0 })
    parseScannerInput(state, { type: 'char', key: 'b', timestamp: 5 })
    expect(parseScannerInput(state, { type: 'flush', timestamp: 10 })).toBeNull()
  })

  it('respects custom intervalMs and minLength options', () => {
    const state = createParserState()
    parseScannerInput(state, { type: 'char', key: 'X', timestamp: 0 }, { intervalMs: 200 })
    parseScannerInput(state, { type: 'char', key: 'Y', timestamp: 150 }, { intervalMs: 200 })
    expect(
      parseScannerInput(state, { type: 'flush', timestamp: 200 }, { intervalMs: 200, minLength: 1 })
    ).toBe('XY')
  })

  it('clears state after a successful flush', () => {
    const state = createParserState()
    parseScannerInput(state, { type: 'char', key: '1', timestamp: 0 })
    parseScannerInput(state, { type: 'char', key: '2', timestamp: 2 })
    parseScannerInput(state, { type: 'char', key: '3', timestamp: 4 })
    expect(parseScannerInput(state, { type: 'flush', timestamp: 6 })).toBe('123')
    expect(state.buffer).toBe('')
    expect(state.lastTs).toBe(0)
  })

  it('a human typing slowly never produces a scan', () => {
    const state = createParserState()
    '087000005525'.split('').forEach((char, i) => {
      parseScannerInput(state, { type: 'char', key: char, timestamp: i * 120 })
    })
    expect(parseScannerInput(state, { type: 'flush', timestamp: 2000 })).toBeNull()
  })
})
