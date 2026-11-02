import { forwardRef } from 'react'
import { cn } from './cn'
import './button.css'

export type ButtonVariant = 'primary' | 'success' | 'secondary' | 'danger' | 'ghost' | 'neutral'
export type ButtonSize = 'sm' | 'md' | 'lg'

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant
  size?: ButtonSize
  /** Stretch to the container width. */
  block?: boolean
}

/**
 * The one button. Never write a raw <button> for a standard action — see
 * docs/design.md → Component Library.
 * - primary: navy, default (nav + admin actions, Save)
 * - success: green (high-intent tender: Pay / Charge / Complete Sale)
 * - secondary: outline
 * - danger: void / delete
 * - ghost: text-only
 */
export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = 'primary', size = 'md', block = false, className, type = 'button', ...rest },
  ref
) {
  return (
    <button
      ref={ref}
      type={type}
      className={cn(
        'ui-btn',
        `ui-btn--${variant}`,
        `ui-btn--${size}`,
        block && 'ui-btn--block',
        className
      )}
      {...rest}
    />
  )
})
