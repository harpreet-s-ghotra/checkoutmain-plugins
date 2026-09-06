import { useEffect, useRef } from 'react'
import { createParserState, parseScannerInput } from './parser'
import type { ScannerOptions } from './parser'

export type KeyboardWedgeOptions = ScannerOptions & {
  /** Detach the listener (e.g. while a modal owns the keyboard). Default true. */
  enabled?: boolean
  /**
   * Skip keystrokes whose target is an input, textarea, or contentEditable, so
   * a scan never lands while someone is typing in a field. Default true.
   * Set false if your scanner should ALSO fill the focused field's row.
   */
  ignoreEditable?: boolean
  /** Where to listen. Default `document`. */
  target?: Document | HTMLElement | null
}

/**
 * Listen for keyboard-wedge scanner bursts and call `onScan(code)` whenever
 * Enter flushes a code-length buffer. Modifier combos and special keys are
 * ignored; ordinary typing is filtered by timing (see `parseScannerInput`).
 */
export function useKeyboardWedge(
  onScan: (code: string) => void,
  options: KeyboardWedgeOptions = {}
): void {
  const { enabled = true, ignoreEditable = true, target, intervalMs, minLength } = options
  const stateRef = useRef(createParserState())
  const onScanRef = useRef(onScan)
  onScanRef.current = onScan

  useEffect(() => {
    if (!enabled) return undefined
    const node: Document | HTMLElement | null =
      target === undefined ? (typeof document === 'undefined' ? null : document) : target
    if (!node) return undefined
    const parserOptions: ScannerOptions = { intervalMs, minLength }

    const handleKey = (event: KeyboardEvent): void => {
      if (ignoreEditable) {
        const el = event.target as HTMLElement | null
        const tag = el?.tagName?.toLowerCase()
        if (tag === 'input' || tag === 'textarea' || el?.isContentEditable) return
      }

      if (event.key === 'Enter') {
        const result = parseScannerInput(
          stateRef.current,
          { type: 'flush', timestamp: event.timeStamp },
          parserOptions
        )
        if (result) {
          event.preventDefault()
          onScanRef.current(result)
        }
        return
      }

      // Ignore modifier-only events and special keys.
      if (event.key.length !== 1) return
      if (event.metaKey || event.ctrlKey || event.altKey) return

      parseScannerInput(
        stateRef.current,
        { type: 'char', key: event.key, timestamp: event.timeStamp },
        parserOptions
      )
    }

    const listener = handleKey as EventListener
    node.addEventListener('keydown', listener)
    return () => node.removeEventListener('keydown', listener)
  }, [enabled, ignoreEditable, target, intervalMs, minLength])
}

export type ScannerCaptureProps = KeyboardWedgeOptions & {
  onScan: (code: string) => void
}

/** Component form of `useKeyboardWedge` — mount once near the top of a screen. */
export function ScannerCapture({ onScan, ...options }: ScannerCaptureProps): null {
  useKeyboardWedge(onScan, options)
  return null
}
