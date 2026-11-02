/**
 * Text helpers behind `PriceInput` (components/ui). Pure, so forms can bridge
 * number state without rendering the component.
 */
/** Digits beyond this are ignored: $9,999,999.99 is enough for any line. */
const MAX_DIGITS = 9

/**
 * Text → the dollar string a price input shows. Only digits count, and they
 * fill in from the right like a register keypad: "9" → 0.09, "99" → 0.99,
 * "999" → 9.99. Backspacing "9.99" to "9.9" gives 0.99. Nothing typed, or
 * only zeros, is the empty string so the placeholder shows.
 */
export function normalizePriceText(text: string): string {
  const digits = text.replace(/\D/g, '').replace(/^0+/, '').slice(-MAX_DIGITS)
  if (!digits) return ''
  const cents = digits.padStart(3, '0')
  return `${cents.slice(0, -2)}.${cents.slice(-2)}`
}

/** A number from state → the text the input shows ("" for 0 or unset). */
export function priceToText(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value) || value <= 0) return ''
  return (Math.round(value * 100) / 100).toFixed(2)
}

/** The text the input shows → a number for state (0 when empty). */
export function priceFromText(text: string): number {
  const n = Number(text)
  return Number.isFinite(n) ? n : 0
}
