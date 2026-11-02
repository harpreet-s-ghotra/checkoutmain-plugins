import { cn } from './cn'
import './segmented.css'

export interface SegmentedOption<T extends string> {
  value: T
  label: string
}

/** A small either/or toggle (e.g. Each / By weight). */
export function Segmented<T extends string>({
  options,
  value,
  onChange,
  ariaLabel
}: {
  options: SegmentedOption<T>[]
  value: T
  onChange: (value: T) => void
  ariaLabel?: string
}): React.JSX.Element {
  return (
    <div className="ui-segmented" role="group" aria-label={ariaLabel}>
      {options.map((opt) => (
        <button
          key={opt.value}
          type="button"
          className={cn('ui-segmented__opt', value === opt.value && 'ui-segmented__opt--on')}
          aria-pressed={value === opt.value}
          // A wrapping <label> (Field) would otherwise name the first option
          // after the field; each option keeps its own name.
          aria-label={opt.label}
          onClick={() => onChange(opt.value)}
        >
          {opt.label}
        </button>
      ))}
    </div>
  )
}
