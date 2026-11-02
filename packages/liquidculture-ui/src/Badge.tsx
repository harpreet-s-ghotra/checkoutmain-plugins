import { cn } from './cn'
import './badge.css'

export type BadgeTone = 'success' | 'warning' | 'danger' | 'neutral' | 'info'

/** Status pill — for state, never a clickable action. */
export function Badge({
  tone = 'neutral',
  uppercase = false,
  className,
  children
}: {
  tone?: BadgeTone
  uppercase?: boolean
  className?: string
  children: React.ReactNode
}): React.JSX.Element {
  return (
    <span
      className={cn('ui-badge', `ui-badge--${tone}`, uppercase && 'ui-badge--upper', className)}
    >
      {children}
    </span>
  )
}

/** Category tag — one of six token tints (1–6), chosen by category order. */
export function Tag({
  tint,
  className,
  children
}: {
  tint: number
  className?: string
  children: React.ReactNode
}): React.JSX.Element {
  const n = ((tint - 1) % 6) + 1
  return <span className={cn('ui-tag', `ui-tag--${n}`, className)}>{children}</span>
}
