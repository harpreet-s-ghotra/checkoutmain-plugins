import type { LucideIcon } from 'lucide-react'
import { cn } from './cn'
import './tabs.css'

export interface TabItem<T extends string> {
  value: T
  label: string
  icon?: LucideIcon
  /** Small count pill after the label (e.g. number of deals). */
  count?: number
}

/**
 * Section tabs for a screen: a strip of touch-height tabs with an underline on
 * the active one. Use for switching between views of one screen; use
 * `Segmented` for an either/or setting inside a form.
 */
export function Tabs<T extends string>({
  items,
  value,
  onChange,
  ariaLabel,
  className
}: {
  items: TabItem<T>[]
  value: T
  onChange: (value: T) => void
  ariaLabel: string
  className?: string
}): React.JSX.Element {
  return (
    <div className={cn('ui-tabs', className)} role="tablist" aria-label={ariaLabel}>
      {items.map(({ value: v, label, icon: Icon, count }) => {
        const on = v === value
        return (
          <button
            key={v}
            type="button"
            role="tab"
            aria-selected={on}
            className={cn('ui-tabs__tab', on && 'ui-tabs__tab--on')}
            onClick={() => onChange(v)}
          >
            {Icon && <Icon size={18} aria-hidden />}
            <span className="ui-tabs__label">{label}</span>
            {count != null && count > 0 && <span className="ui-tabs__count tnum">{count}</span>}
          </button>
        )
      })}
    </div>
  )
}
