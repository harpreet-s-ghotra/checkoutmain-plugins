import { cn } from './cn'
import './checkbox.css'

/** Checkbox with a title + optional description, wrapped in a tappable card. */
export function Checkbox({
  checked,
  onChange,
  label,
  description,
  boxed = true,
  className
}: {
  checked: boolean
  onChange: (checked: boolean) => void
  label: string
  description?: string
  boxed?: boolean
  className?: string
}): React.JSX.Element {
  return (
    <label className={cn('ui-checkbox', boxed && 'ui-checkbox--boxed', className)}>
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span className="ui-checkbox__text">
        <span className="ui-checkbox__label">{label}</span>
        {description && <span className="ui-checkbox__desc">{description}</span>}
      </span>
    </label>
  )
}
