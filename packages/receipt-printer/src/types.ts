// ── Receipt printer ──

/** Thermal roll width. An 80 mm roll prints 72 mm wide; a 58 mm roll 48 mm. */
export type PaperWidthMm = 58 | 80

/**
 * How dark an Epson prints: heat (ESC/POS print density) and stroke weight.
 * Star and other drivers set darkness in the driver and ignore this.
 */
export type PrintDarkness = 'light' | 'normal' | 'dark' | 'darkest'

/**
 * Darkness when a register has not chosen one: a new thermal printer prints
 * faint at its own setting, so the default leans dark.
 */
export const DEFAULT_PRINT_DARKNESS: PrintDarkness = 'dark'

/** What a receipt job needs to know about the printer it goes to. */
export type ReceiptPrinter = {
  /** OS printer queue name (CUPS on macOS/Linux, winspool on Windows). */
  printerName: string
  paperWidthMm: PaperWidthMm
  /** Epson only; missing = `DEFAULT_PRINT_DARKNESS`. */
  darkness?: PrintDarkness
}

/** Which way a receipt went out: ESC/POS raster sent raw, or the PDF through the driver. */
export type ReceiptPrintPath = 'escpos' | 'driver'

/** Where the library says what it did. Console by default; a POS wires its own. */
export type PrinterLogger = {
  info(message: string): void
  warn(message: string): void
}

// ── Shelf labels ──

export type LabelSettings = {
  /** Selected OS printer for labels; separate from the receipt printer. */
  labelPrinterName: string
  /** Label media size in microns; orientation is implied by width vs height. */
  widthMicrons: number
  heightMicrons: number
  /** Render the SKU as a scannable barcode (symbology auto-selected). */
  printBarcode: boolean
  /** Inner margin (quiet zone) per edge, in mm. */
  paddingTopMm: number
  paddingRightMm: number
  paddingBottomMm: number
  paddingLeftMm: number
  /** Width % of the LEFT (barcode) column in the bottom row. Right = remainder. */
  columnSplitPct: number
  /** Height % of the TOP row (name + size). Bottom row = the remainder. */
  rowSplitPct: number
  /** Point sizes for each grid cell's text. */
  nameFontSize: number
  priceFontSize: number
  /** SKU text drawn under (or in place of) the barcode. */
  skuFontSize: number
  /** Longest label name (chars) that still fits the two-line name box. */
  maxNameLength: number
  /** Labels per paced batch chunk during a mass print. */
  batchSize: number
  /**
   * How labels are sent to this printer:
   *  - 'auto': ZPL when the printer looks like a Zebra, else the OS/PDF path.
   *  - 'zpl' : always native ZPL (Zebra).
   *  - 'os'  : always the OS/PDF driver path (DYMO, Brother, generic).
   */
  printLanguage: 'auto' | 'zpl' | 'os'
  /** Printer head resolution, used to size ZPL output (203 typical; 300 for ZD). */
  dpi: number
}

/** One label to render + print. */
export type LabelPrintItem = {
  name: string
  size: string | null
  sku: string
  price: number
  /** Optional short, label-only name that wins over `name`. */
  printable_name?: string | null
}

export type PrintLabelsInput = {
  items: LabelPrintItem[]
  /** One-off settings override (sanitized) — a settings screen's test print. */
  settings?: LabelSettings
}

export type PrintLabelsResult = {
  printed: number
  skipped: number
}
