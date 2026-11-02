import type { PrinterLogger } from './types'

const silent = (): void => {}

/** Fill in whatever the host did not provide, so every module can log freely. */
export function resolveLogger(log?: Partial<PrinterLogger> | null): PrinterLogger {
  return {
    info: log?.info ?? silent,
    warn: log?.warn ?? ((m) => console.warn(m))
  }
}
