import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react'
import { cn } from './cn'
import type { InputProps } from './Field'
import { normalizePriceText } from './price-text'
import './price-input.css'

export type PriceInputProps = Omit<InputProps, 'value' | 'onChange' | 'type' | 'inputMode'> & {
  /** Dollar text as shown, e.g. "9.99"; "" when empty. Use `priceToText` for a number. */
  value: string
  /** Fires with the normalized dollar text on every edit. */
  onChange: (text: string) => void
}

/**
 * A dollar amount field that types like a keypad: the decimal point is placed
 * for you, digits shift in from the right, and the caret stays at the end.
 * Use it for every price, cost, and cash amount instead of a number input.
 */
export const PriceInput = forwardRef<HTMLInputElement, PriceInputProps>(function PriceInput(
  { value, onChange, className, placeholder = '0.00', onFocus, ...rest },
  ref
) {
  const inner = useRef<HTMLInputElement>(null)
  useImperativeHandle(ref, () => inner.current as HTMLInputElement)

  // A reformat moves the caret; keep it at the end where the next digit lands.
  useEffect(() => {
    const el = inner.current
    if (el && document.activeElement === el) {
      const end = el.value.length
      el.setSelectionRange(end, end)
    }
  }, [value])

  return (
    <input
      ref={inner}
      type="text"
      inputMode="decimal"
      autoComplete="off"
      className={cn('ui-input', 'ui-input--price', className)}
      value={value}
      placeholder={placeholder}
      onChange={(e) => onChange(normalizePriceText(e.target.value))}
      onFocus={(e) => {
        const end = e.target.value.length
        e.target.setSelectionRange(end, end)
        onFocus?.(e)
      }}
      {...rest}
    />
  )
})
