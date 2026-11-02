/**
 * Open the cash drawer. The drawer plugs into the receipt printer (RJ11 "DK"
 * port), so opening it is a few raw bytes sent to the receipt printer's queue,
 * past the driver.
 */
import { printRawBytes, type RawPrintOptions } from './transport'

// ESC/POS open-drawer: ESC p <pin 2 = drawer 1> <on 50 ms> <off 500 ms>.
// Epson TM-series and most ESC/POS printers.
const ESCPOS_OPEN = Buffer.from([0x1b, 0x70, 0x00, 0x19, 0xfa])

// Star Line Mode printers (TSP100 / 650 / 654…) ignore ESC p: a single BEL
// fires their drawer port.
const STAR_OPEN = Buffer.from([0x07])

/** The drawer-kick bytes for a printer, by its queue name: Star gets BEL, the rest ESC p. */
export function drawerKickBytes(printerName: string): Buffer {
  return /star|tsp\d/i.test(printerName) ? STAR_OPEN : ESCPOS_OPEN
}

/** Kick the drawer through the receipt printer. Throws when no printer is given. */
export async function openCashDrawer(
  printerName: string | null | undefined,
  opts: RawPrintOptions & { tmpDir?: string } = {}
): Promise<void> {
  if (!printerName) throw new Error('Receipt printer not set up — the drawer opens through it')
  await printRawBytes(drawerKickBytes(printerName), printerName, { ...opts, prefix: 'drawer' })
}
