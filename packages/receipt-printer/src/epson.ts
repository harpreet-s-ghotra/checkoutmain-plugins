import { isEpsonReceiptPrinter } from './escpos-raster'

/**
 * What the OS says about a queue, for a queue whose NAME does not say Epson:
 * the driver / make-and-model, and on a Mac the device URI
 * (`usb://EPSON/TM-T20III`). In Electron:
 *
 *     describe: async (name) => {
 *       const p = (await webContents.getPrintersAsync()).find((x) => x.name === name)
 *       return p ? [p.displayName, p.description, ...Object.values(p.options ?? {})].join(' ') : null
 *     }
 */
export type DescribePrinter = (printerName: string) => Promise<string | null>

const epsonByQueue = new Map<string, boolean>()

/**
 * Whether a receipt queue drives an Epson TM printer, so receipts go to it as
 * ESC/POS raster. Nothing to set up: the queue name usually says so ("EPSON
 * TM-T20III Receipt", "EPSON_TM_T20III"), and when a store has renamed the queue
 * ("Front Counter") the OS still describes the device. Looked up once per queue
 * per process. Any failure answers "not Epson", which leaves the printer on the
 * PDF path — a sideways receipt beats no receipt.
 */
export async function isEpsonReceiptQueue(
  printerName: string,
  describe?: DescribePrinter
): Promise<boolean> {
  if (!printerName) return false
  if (isEpsonReceiptPrinter(printerName)) return true
  const cached = epsonByQueue.get(printerName)
  if (cached !== undefined) return cached
  if (!describe) return false
  try {
    const described = await describe(printerName)
    if (described == null) return false
    const epson = isEpsonReceiptPrinter(described)
    epsonByQueue.set(printerName, epson)
    return epson
  } catch {
    return false
  }
}

/** Forget what the OS said (a queue was re-pointed at another device). */
export function resetEpsonCache(): void {
  epsonByQueue.clear()
}
