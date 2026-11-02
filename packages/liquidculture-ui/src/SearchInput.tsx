import { forwardRef } from 'react'
import { Search } from 'lucide-react'
import { cn } from './cn'
import './search-input.css'

/**
 * Icon + input search pill. Used by the scan bar, inventory, lookups.
 * `onSubmit` fires on Enter — a barcode scanner types the code then sends
 * Enter, so the scan bar resolves the item there.
 */
export const SearchInput = forwardRef<
  HTMLInputElement,
  {
    value: string
    onChange: (value: string) => void
    onSubmit?: (value: string) => void
    placeholder?: string
    ariaLabel?: string
    autoFocus?: boolean
    className?: string
  }
>(function SearchInput(
  {
    value,
    onChange,
    onSubmit,
    placeholder = 'Search…',
    ariaLabel = 'Search',
    autoFocus,
    className
  },
  ref
) {
  return (
    <label className={cn('ui-search', className)}>
      <Search size={18} className="ui-search__icon" aria-hidden />
      <input
        ref={ref}
        className="ui-search__input"
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && onSubmit) {
            e.preventDefault()
            onSubmit(value)
          }
        }}
        placeholder={placeholder}
        aria-label={ariaLabel}
        autoFocus={autoFocus}
      />
    </label>
  )
})
