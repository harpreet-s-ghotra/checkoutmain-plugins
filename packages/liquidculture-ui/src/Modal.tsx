import { useEffect, useRef } from 'react'
import { X } from 'lucide-react'
import { cn } from './cn'
import { IconTile } from './IconTile'
import './modal.css'

export type ModalSize = 'sm' | 'md' | 'lg' | 'xl'

/**
 * The one modal. Scrim + panel + header (icon tile · title · close) + scrollable
 * body + optional footer. Closes on scrim click and Escape; Enter presses the
 * footer's primary button. Pass footer actions (usually <Button>s) via the
 * `footer` prop.
 */
export function Modal({
  title,
  icon,
  onClose,
  footer,
  size = 'md',
  ariaLabel,
  children
}: {
  title: string
  icon?: React.ReactNode
  onClose: () => void
  footer?: React.ReactNode
  size?: ModalSize
  ariaLabel?: string
  children: React.ReactNode
}): React.JSX.Element {
  const panelRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose()
      if (e.key === 'Enter') acceptOnEnter(e, panelRef.current)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  // Move focus into the dialog unless a child (autoFocus) already took it, so
  // typing — or a scanner — never reaches the register underneath.
  useEffect(() => {
    const panel = panelRef.current
    if (panel && !panel.contains(document.activeElement)) panel.focus()
  }, [])

  return (
    <div className="ui-modal__scrim" onMouseDown={onClose}>
      <div
        ref={panelRef}
        tabIndex={-1}
        className={cn('ui-modal', `ui-modal--${size}`)}
        role="dialog"
        aria-modal="true"
        aria-label={ariaLabel ?? title}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <header className="ui-modal__head">
          <h2 className="ui-modal__title">
            {icon && (
              <IconTile tone="subtle" size="sm">
                {icon}
              </IconTile>
            )}
            {title}
          </h2>
          <button type="button" className="ui-modal__close" aria-label="Close" onClick={onClose}>
            <X size={20} aria-hidden />
          </button>
        </header>

        <div className="ui-modal__body">{children}</div>

        {footer && <footer className="ui-modal__foot">{footer}</footer>}
      </div>
    </div>
  )
}

/**
 * Enter accepts the dialog: it presses the footer's primary button when that
 * button is enabled. Danger buttons (delete, refund) stay tap-only. Left alone:
 * Enter in a text field (it may be a scanner's), a keypad that owns Enter
 * itself, a key a field already handled, and any dialog stacked underneath.
 */
function acceptOnEnter(e: KeyboardEvent, panel: HTMLElement | null): void {
  if (!panel || e.defaultPrevented) return
  const target = e.target as HTMLElement | null
  if (target && ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName)) return
  const dialogs = document.querySelectorAll('[aria-modal="true"]')
  if (dialogs[dialogs.length - 1] !== panel) return
  if (panel.querySelector('.keypad-entry')) return
  const primary = panel.querySelectorAll<HTMLButtonElement>(
    '.ui-modal__foot .ui-btn--primary:not(:disabled)'
  )
  const button = primary[primary.length - 1]
  if (!button) return
  e.preventDefault()
  button.click()
}
