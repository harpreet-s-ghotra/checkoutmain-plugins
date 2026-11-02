import { forwardRef } from 'react'
import { cn } from './cn'
import './field.css'

/** Label + control + optional hint/error wrapper. Renders a <label>. */
export function Field({
  label,
  hint,
  error,
  wide,
  className,
  children
}: {
  label?: string
  hint?: string
  error?: string
  wide?: boolean
  className?: string
  children: React.ReactNode
}): React.JSX.Element {
  return (
    <label className={cn('ui-field', wide && 'ui-field--wide', className)}>
      {label && <span className="ui-field__label">{label}</span>}
      {children}
      {error ? (
        <span className="ui-field__error">{error}</span>
      ) : hint ? (
        <span className="ui-field__hint">{hint}</span>
      ) : null}
    </label>
  )
}

export type InputProps = React.InputHTMLAttributes<HTMLInputElement>

/** Boxed text input (design.md input spec). */
export const Input = forwardRef<HTMLInputElement, InputProps>(function Input(
  { className, ...rest },
  ref
) {
  return <input ref={ref} className={cn('ui-input', className)} {...rest} />
})

export type SelectProps = React.SelectHTMLAttributes<HTMLSelectElement>

/** Styled select with a token-colored chevron. */
export const Select = forwardRef<HTMLSelectElement, SelectProps>(function Select(
  { className, children, ...rest },
  ref
) {
  return (
    <select ref={ref} className={cn('ui-input', 'ui-input--select', className)} {...rest}>
      {children}
    </select>
  )
})
