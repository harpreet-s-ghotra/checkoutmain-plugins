/**
 * Barcode equivalence — every printed form of one GTIN.
 *
 * A small bottle carries a compressed UPC-E symbol; the same product's shelf
 * tag and case carry the full UPC-A. They encode the SAME product, and a
 * lookup that treats them as different strings simply fails to find the item.
 *
 * Two strategies exist. If you control the schema, store a canonical form
 * (expand UPC-E, strip leading zeros) in an indexed column and compare that.
 * If you are querying stored strings you cannot rewrite, expand the ONE code
 * you were handed into every form it could have been stored as and match any
 * of them — that is `barcodeLookupVariants`.
 */

/**
 * Expand an 8-digit UPC-E barcode to its 12-digit UPC-A equivalent, or null
 * when `code` is not a valid UPC-E.
 *
 * UPC-E carries the UPC-A's check digit unchanged, so we expand, recompute the
 * UPC-A check, and accept the expansion only when it matches — which stops a
 * random 8-digit internal code from being mistaken for a UPC-E.
 */
export function expandUpcE(code: string): string | null {
  if (!/^\d{8}$/.test(code)) return null
  const ns = code[0]
  if (ns !== '0' && ns !== '1') return null // UPC-E is only number system 0 or 1
  const [d1, d2, d3, d4, d5, d6] = code.slice(1, 7).split('')
  let body: string // 11-digit UPC-A without its check digit
  if (d6 === '0' || d6 === '1' || d6 === '2') body = `${ns}${d1}${d2}${d6}0000${d3}${d4}${d5}`
  else if (d6 === '3') body = `${ns}${d1}${d2}${d3}00000${d4}${d5}`
  else if (d6 === '4') body = `${ns}${d1}${d2}${d3}${d4}00000${d5}`
  else body = `${ns}${d1}${d2}${d3}${d4}${d5}0000${d6}`
  const check = upcaCheckDigit(body)
  if (String(check) !== code[7]) return null
  return body + check
}

/** Modulo-10 check digit for an 11-digit UPC-A body (or 12-digit EAN-13 body). */
export function upcaCheckDigit(body: string): number {
  let odd = 0
  let even = 0
  for (let i = 0; i < body.length; i++) {
    const n = body.charCodeAt(i) - 48
    // Weights count from the RIGHT: the digit nearest the check gets 3.
    if ((body.length - i) % 2 === 1) odd += n
    else even += n
  }
  return (10 - ((odd * 3 + even) % 10)) % 10
}

/**
 * Compress a 12-digit UPC-A to the 8-digit UPC-E printed on the small bottle,
 * or null when it has no UPC-E form (most UPC-As do not).
 *
 * This is the direction that is easy to miss. ZXing hands back the EXPANDED
 * code for a UPC-E symbol — scanning a 187ml whose printed symbol is
 * `08502528` yields `0085200000258` — so a lookup arrives holding a UPC-A and
 * has to find a row stored as UPC-E.
 *
 * Rather than invert the expansion by hand and risk an off-by-one in the digit
 * shuffling, each of the four layouts produces a candidate and we accept only
 * the one that expands back to exactly this UPC-A. The round trip is the proof,
 * so a wrong candidate can never escape.
 */
export function compressToUpcE(upca: string): string | null {
  if (!/^\d{12}$/.test(upca)) return null
  const s = upca
  const ns = s[0]
  if (ns !== '0' && ns !== '1') return null
  const check = s[11]
  const candidates = [
    `${ns}${s[1]}${s[2]}${s[8]}${s[9]}${s[10]}${s[3]}${check}`, // manufacturer ends 0,1,2
    `${ns}${s[1]}${s[2]}${s[3]}${s[9]}${s[10]}3${check}`,
    `${ns}${s[1]}${s[2]}${s[3]}${s[4]}${s[10]}4${check}`,
    `${ns}${s[1]}${s[2]}${s[3]}${s[4]}${s[5]}${s[10]}${check}`
  ]
  return candidates.find((c) => expandUpcE(c) === upca) ?? null
}

/**
 * Canonical form of a numeric barcode for storage and comparison: UPC-E
 * expanded to UPC-A, then leading zeros removed (they carry no meaning in a
 * GTIN). Non-numeric codes are returned trimmed and otherwise untouched.
 */
export function canonicalGtin(code: string): string {
  const raw = code.trim()
  if (!/^\d{8,14}$/.test(raw)) return raw
  const expanded = raw.length === 8 ? (expandUpcE(raw) ?? raw) : raw
  return expanded.replace(/^0+/, '') || '0'
}

/**
 * Every string this code could be stored as, for an exact-match lookup.
 *
 * Covers the four ways one GTIN reaches a database:
 *  - as scanned (a USB wedge emits the digits printed under the bars),
 *  - zero-stripped (leading zeros carry no meaning in a GTIN, and 11-digit rows
 *    exist in the wild because some import dropped them),
 *  - zero-padded to UPC-A and EAN-13 (a camera decoder adds one), and
 *  - compressed to UPC-E (what a small bottle actually carries).
 *
 * Non-numeric codes — internal codes, keyed SKUs — pass through untouched as a
 * single variant: none of this applies to them.
 */
export function barcodeLookupVariants(code: string): string[] {
  const raw = code.trim()
  const out = new Set<string>()
  if (raw) out.add(raw)
  if (!/^\d{8,14}$/.test(raw)) return [...out]

  const core = canonicalGtin(raw)
  out.add(core)

  if (core.length <= 12) {
    const upca = core.padStart(12, '0')
    out.add(upca)
    const upce = compressToUpcE(upca)
    if (upce) out.add(upce)
  }
  if (core.length <= 13) out.add(core.padStart(13, '0'))

  return [...out]
}
