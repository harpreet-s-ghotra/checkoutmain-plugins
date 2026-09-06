/**
 * The vectors here are real retail rows, not invented ones: the Sutter Home
 * 187ml minis are sold under their 8-digit UPC-E, and a camera decoder hands
 * back the expanded 13-digit form when one is scanned. That mismatch is the
 * bug this module exists to close, so it is pinned first.
 */
import { describe, expect, it } from 'vitest'
import {
  barcodeLookupVariants,
  canonicalGtin,
  compressToUpcE,
  expandUpcE,
  upcaCheckDigit
} from './gtin'

/** Barcode printed as UPC-E → its UPC-A. */
const REAL_PAIRS: [upce: string, upca: string][] = [
  ['08502528', '085200000258'],
  ['08502625', '085200000265'],
  ['08502926', '085200000296'],
  ['08505428', '085200000548'],
  ['08505525', '085200000555'],
  ['08505923', '085200000593'],
  ['08506223', '085200000623'],
  ['08507523', '085200000753'],
  ['08507620', '085200000760'],
  ['08509628', '085200000968'],
  ['08509822', '085200000982'],
  ['08511623', '085200001163'],
  ['08511827', '085200001187']
]

describe('upcaCheckDigit', () => {
  it('matches the printed check digit of real UPC-As', () => {
    for (const [, upca] of REAL_PAIRS) {
      expect(upcaCheckDigit(upca.slice(0, 11))).toBe(Number(upca[11]))
    }
  })

  it('matches the printed check digit of an EAN-13', () => {
    expect(upcaCheckDigit('400894819490')).toBe(0)
  })
})

describe('expandUpcE', () => {
  it('expands every real UPC-E', () => {
    for (const [upce, upca] of REAL_PAIRS) {
      expect(expandUpcE(upce)).toBe(upca)
    }
  })

  it('covers all four digit layouts', () => {
    // The last of the six digits selects the layout: 0-2, 3, 4 and 5-9 each
    // shuffle differently, and pinning one would leave three untested. Vectors
    // are DERIVED rather than hand-picked — a mistyped check digit would make a
    // case silently vacuous by turning it into "not a UPC-E".
    for (const [d1, d2, d3, d4, d5, d6] of [
      ['1', '2', '7', '8', '9', '0'],
      ['1', '2', '7', '8', '9', '2'],
      ['1', '2', '3', '4', '5', '3'],
      ['1', '2', '3', '4', '5', '4'],
      ['1', '2', '3', '4', '5', '7']
    ]) {
      const ns = '0'
      const body =
        d6 === '0' || d6 === '1' || d6 === '2'
          ? `${ns}${d1}${d2}${d6}0000${d3}${d4}${d5}`
          : d6 === '3'
            ? `${ns}${d1}${d2}${d3}00000${d4}${d5}`
            : d6 === '4'
              ? `${ns}${d1}${d2}${d3}${d4}00000${d5}`
              : `${ns}${d1}${d2}${d3}${d4}${d5}0000${d6}`
      const check = String(upcaCheckDigit(body))
      const upca = body + check
      const upce = `${ns}${d1}${d2}${d3}${d4}${d5}${d6}${check}`

      expect(expandUpcE(upce)).toBe(upca)
      expect(compressToUpcE(upca)).toBe(upce)
    }
  })

  it('refuses an 8-digit code that is not a UPC-E', () => {
    // An internal 8-digit SKU must never be mistaken for a compressed barcode —
    // the check digit is what tells them apart.
    expect(expandUpcE('08502529')).toBeNull() // real code, wrong check digit
    expect(expandUpcE('28502528')).toBeNull() // number system 2 is not UPC-E
    expect(expandUpcE('1234567')).toBeNull()
    expect(expandUpcE('085025281')).toBeNull()
    expect(expandUpcE('0850252A')).toBeNull()
  })
})

describe('compressToUpcE', () => {
  it('compresses back to the code printed on the bottle', () => {
    for (const [upce, upca] of REAL_PAIRS) {
      expect(compressToUpcE(upca)).toBe(upce)
    }
  })

  it('returns null for a UPC-A with no UPC-E form', () => {
    // Most UPC-As have none — it needs a run of zeros in the right place.
    expect(compressToUpcE('012345678905')).toBeNull()
    expect(compressToUpcE('088004028091')).toBeNull()
  })

  it('rejects anything that is not a 12-digit number-system 0 or 1 UPC-A', () => {
    expect(compressToUpcE('0085200000258')).toBeNull()
    expect(compressToUpcE('285200000258')).toBeNull()
    expect(compressToUpcE('85200000258')).toBeNull()
  })
})

describe('canonicalGtin', () => {
  it('maps every printed form of one product to the same string', () => {
    expect(canonicalGtin('08502528')).toBe('85200000258')
    expect(canonicalGtin('085200000258')).toBe('85200000258')
    expect(canonicalGtin('0085200000258')).toBe('85200000258')
    expect(canonicalGtin('85200000258')).toBe('85200000258')
  })

  it('leaves non-numeric codes alone', () => {
    expect(canonicalGtin(' NB-1234 ')).toBe('NB-1234')
  })
})

describe('barcodeLookupVariants', () => {
  it('finds a UPC-E row from the expanded code the decoder returns', () => {
    // The actual bug: ZXing reports the mini's UPC-E symbol as this 13-digit
    // string, while the row is stored as `08502528`.
    expect(barcodeLookupVariants('0085200000258')).toContain('08502528')
  })

  it('finds a UPC-A row from the short code a wedge scanner emits', () => {
    expect(barcodeLookupVariants('08502528')).toContain('085200000258')
  })

  it('is symmetric — either printed form reaches the same set', () => {
    const fromLong = barcodeLookupVariants('0085200000258').sort()
    const fromShort = barcodeLookupVariants('08502528').sort()
    expect(fromShort).toEqual(fromLong)
  })

  it('covers the zero-stripped and zero-padded forms that exist in the wild', () => {
    // 11-digit rows exist (an import dropped the leading zero); a camera adds
    // one to make 13. Both must be reachable from a 12-digit scan.
    const v = barcodeLookupVariants('085200000258')
    expect(v).toContain('85200000258')
    expect(v).toContain('085200000258')
    expect(v).toContain('0085200000258')
  })

  it('always includes the code exactly as scanned', () => {
    for (const code of ['0085200000258', '08502528', '012345678905', 'NB-1234', '']) {
      const v = barcodeLookupVariants(code)
      if (code) expect(v).toContain(code)
    }
  })

  it('leaves a non-barcode code alone', () => {
    // Internal codes and keyed SKUs get no GTIN treatment — expanding them
    // would invent lookups for products that do not exist.
    expect(barcodeLookupVariants('NB-1234')).toEqual(['NB-1234'])
    expect(barcodeLookupVariants('ABC')).toEqual(['ABC'])
    expect(barcodeLookupVariants('1234')).toEqual(['1234'])
  })

  it('returns nothing for an empty code', () => {
    expect(barcodeLookupVariants('   ')).toEqual([])
  })

  it('does not invent a UPC-E for a code that has none', () => {
    const v = barcodeLookupVariants('012345678905')
    expect(v.every((c) => c.length !== 8)).toBe(true)
  })
})
