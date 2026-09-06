/**
 * USB barcode scanners emit characters fast then press Enter. We accumulate
 * keystrokes that arrive within `intervalMs` of each other and flush the
 * buffer when Enter is pressed.
 *
 * Pure module — no DOM access — so the parser can be unit-tested in node.
 * `useKeyboardWedge` wires it to `document` keydown.
 */

export type ScannerEvent =
  { type: 'char'; key: string; timestamp: number } | { type: 'flush'; timestamp: number }

export type ScannerOptions = {
  /** Maximum gap (ms) between two scanner keystrokes. Above this, buffer resets. Default 50. */
  intervalMs?: number
  /** Minimum buffered length to count as a scan (filters stray Enter presses). Default 3. */
  minLength?: number
}

const DEFAULT_INTERVAL_MS = 50
const DEFAULT_MIN_LENGTH = 3

export type ParserState = {
  buffer: string
  lastTs: number
}

export function createParserState(): ParserState {
  return { buffer: '', lastTs: 0 }
}

/**
 * Push one event into the parser. Returns the scanned barcode if a flush
 * produced one, otherwise null. Mutates `state` in place.
 *
 * Human typing is filtered by timing alone: a person cannot hold the
 * inter-key gap under 50ms across a whole code, so their buffer keeps
 * resetting and never reaches `minLength` by the time Enter arrives.
 */
export function parseScannerInput(
  state: ParserState,
  event: ScannerEvent,
  options: ScannerOptions = {}
): string | null {
  const interval = options.intervalMs ?? DEFAULT_INTERVAL_MS
  const minLen = options.minLength ?? DEFAULT_MIN_LENGTH

  if (event.type === 'char') {
    if (state.buffer.length > 0 && event.timestamp - state.lastTs > interval) {
      state.buffer = ''
    }
    state.buffer += event.key
    state.lastTs = event.timestamp
    return null
  }

  // flush
  const value = state.buffer
  state.buffer = ''
  state.lastTs = 0
  if (value.length < minLen) return null
  return value
}
