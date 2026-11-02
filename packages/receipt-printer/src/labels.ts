// ── Shelf-label pure helpers ──
// Framework-free logic shared by the label printer and a settings preview.
// Kept side-effect-free so it works without Electron, a DB, or a printer.

import type { LabelSettings } from './types'

/** bwip-js barcode symbology ids we emit. */
export type LabelSymbology = 'upca' | 'ean13' | 'code128'

/**
 * GTIN (UPC-A / EAN-13) check-digit validation: from the right, excluding the
 * final check digit, digits are weighted 3,1,3,1…; the check digit is
 * (10 − sum mod 10) mod 10.
 */
export function hasValidGtinCheckDigit(digits: string): boolean {
  const check = Number(digits[digits.length - 1])
  let sum = 0
  for (let i = digits.length - 2, w = 3; i >= 0; i--, w = 4 - w) {
    sum += Number(digits[i]) * w
  }
  return (10 - (sum % 10)) % 10 === check
}

/**
 * Auto-select a barcode symbology from the SKU value so a real retail barcode
 * round-trips as itself: a 12-digit numeric SKU with a valid check digit →
 * UPC-A, a valid 13-digit → EAN-13, anything else → Code128, which encodes the
 * SKU verbatim and scans on registers and phones.
 */
export function selectSymbology(sku: string): LabelSymbology {
  const value = sku.trim()
  if (/^\d{12}$/.test(value) && hasValidGtinCheckDigit(value)) return 'upca'
  if (/^\d{13}$/.test(value) && hasValidGtinCheckDigit(value)) return 'ean13'
  return 'code128'
}

/** Minimal shape needed to decide printability + resolve a label name. */
export type LabelCandidate = {
  sku: string
  name: string
  /** Optional short, label-only name that wins over `name`. */
  printable_name?: string | null
  size?: string | null
  price?: number | null
}

/** The effective shelf price used on the label. */
export function labelPrice(item: LabelCandidate): number {
  return item.price ?? 0
}

/**
 * Whether a shelf label makes sense for this item: it needs a code to print
 * and a price above zero (a $0 label is pointless).
 */
export function canPrintLabel(item: LabelCandidate): boolean {
  if (!item.sku.trim()) return false
  if (labelPrice(item) <= 0) return false
  return true
}

/** Label name precedence: printable_name ?? name. */
export function resolveLabelName(item: LabelCandidate): string {
  return (item.printable_name?.trim() || item.name || '').trim()
}

/**
 * Whether this item's resolved label name fits a shelf tag: non-empty and
 * ≤ `maxNameLength`. A longer name is skipped + reported rather than printed
 * clipped.
 */
export function isPrintableLabelName(item: LabelCandidate, maxNameLength: number): boolean {
  const name = resolveLabelName(item)
  return name.length > 0 && name.length <= maxNameLength
}

/** Top-box text for the label: the name with the size appended (e.g. "Milk 1 gal"). */
export function appendSize(name: string, size: string | null | undefined): string {
  const s = size?.trim()
  return s ? `${name} ${s}` : name
}

// ── Settings defaults + bounds (single source for main's sanitizer and the
//    settings modal's inputs, so UI limits can't drift from what saves) ──

// A ~2.25in × 1.25in shelf tag at 1000 microns/mm is the common Zebra/DYMO/
// Rollo default; operators recalibrate size with the test print.
export const LABEL_SETTINGS_DEFAULTS: LabelSettings = {
  labelPrinterName: '',
  widthMicrons: 57150, // 2.25in
  heightMicrons: 31750, // 1.25in
  printBarcode: false,
  paddingTopMm: 2,
  paddingRightMm: 2,
  paddingBottomMm: 2,
  paddingLeftMm: 2,
  columnSplitPct: 60, // barcode column (bottom-left) wider than the price column
  rowSplitPct: 55, // top row (name + size) a touch taller than the bottom row
  nameFontSize: 11,
  priceFontSize: 16,
  skuFontSize: 7,
  maxNameLength: 30,
  batchSize: 10,
  printLanguage: 'auto',
  dpi: 203
}

/** [min, max] per numeric setting, in that setting's own unit. */
export const LABEL_SETTINGS_BOUNDS = {
  sizeMicrons: [5000, 300000],
  sizeMm: [5, 300],
  paddingMm: [0, 15],
  splitPct: [20, 80],
  fontPt: [4, 48],
  skuFontPt: [4, 24],
  nameLen: [10, 60],
  batchSize: [1, 100]
} as const

export function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value))
}

/**
 * Normalize a persisted (or drafted) LabelSettings blob against the defaults
 * and safe bounds. Used by main before saving/printing and by the browser-dev
 * mock, so both agree on what a valid config is.
 */
export function sanitizeLabelSettings(cfg: Partial<LabelSettings> | undefined): LabelSettings {
  const d = LABEL_SETTINGS_DEFAULTS
  const b = LABEL_SETTINGS_BOUNDS
  return {
    labelPrinterName: cfg?.labelPrinterName ?? '',
    widthMicrons: clamp(Math.round(cfg?.widthMicrons ?? d.widthMicrons), ...b.sizeMicrons),
    heightMicrons: clamp(Math.round(cfg?.heightMicrons ?? d.heightMicrons), ...b.sizeMicrons),
    printBarcode: cfg?.printBarcode ?? d.printBarcode,
    paddingTopMm: clamp(cfg?.paddingTopMm ?? d.paddingTopMm, ...b.paddingMm),
    paddingRightMm: clamp(cfg?.paddingRightMm ?? d.paddingRightMm, ...b.paddingMm),
    paddingBottomMm: clamp(cfg?.paddingBottomMm ?? d.paddingBottomMm, ...b.paddingMm),
    paddingLeftMm: clamp(cfg?.paddingLeftMm ?? d.paddingLeftMm, ...b.paddingMm),
    columnSplitPct: clamp(Math.round(cfg?.columnSplitPct ?? d.columnSplitPct), ...b.splitPct),
    rowSplitPct: clamp(Math.round(cfg?.rowSplitPct ?? d.rowSplitPct), ...b.splitPct),
    nameFontSize: clamp(Math.round(cfg?.nameFontSize ?? d.nameFontSize), ...b.fontPt),
    priceFontSize: clamp(Math.round(cfg?.priceFontSize ?? d.priceFontSize), ...b.fontPt),
    skuFontSize: clamp(Math.round(cfg?.skuFontSize ?? d.skuFontSize), ...b.skuFontPt),
    maxNameLength: clamp(Math.round(cfg?.maxNameLength ?? d.maxNameLength), ...b.nameLen),
    batchSize: clamp(Math.round(cfg?.batchSize ?? d.batchSize), ...b.batchSize),
    printLanguage:
      cfg?.printLanguage === 'zpl' || cfg?.printLanguage === 'os' ? cfg.printLanguage : 'auto',
    dpi: cfg?.dpi === 300 ? 300 : 203
  }
}

// ── Printer language routing ──
// Zebra label printers are driven with native ZPL; DYMO/Brother/generic go
// through the OS/PDF path. Detection is by the OS printer name.

export type PrintLanguage = 'zpl' | 'os'

/** Heuristic: does this OS printer name look like a Zebra (ZPL) device? */
export function isZebraPrinter(name: string | null | undefined): boolean {
  if (!name) return false
  // Brand name, or a Zebra model prefix (ZQ520/620, ZD410/420, ZT230, ZP450,
  // GK420, GX430, ZR…), or an explicit "ZPL" in the queue name.
  return /zebra|zpl|\b(zq|zd|zt|zp|zr|gk|gx|gc|hc)\d/i.test(name)
}

/** Resolve the effective print language from the setting + selected printer. */
export function resolvePrintLanguage(
  setting: 'auto' | 'zpl' | 'os',
  printerName: string | null | undefined
): PrintLanguage {
  if (setting === 'zpl') return 'zpl'
  if (setting === 'os') return 'os'
  return isZebraPrinter(printerName) ? 'zpl' : 'os'
}

// ── 2×2 label grid geometry ──
// Name + size (full-width top box, up to 2 lines) over Barcode (bottom-left) ·
// Price (bottom-right). Column/row split percents move the dividers. Shared so
// the PDF renderer, the ZPL renderer, and the settings preview draw the
// identical layout at any scale.

export type LabelRect = { x: number; y: number; w: number; h: number }
export type LabelGrid = {
  /** Full-width top box — the name (with size appended). */
  name: LabelRect
  barcode: LabelRect
  price: LabelRect
}

/** Per-edge inner margins in the SAME units as width/height. */
export type LabelMargins = { top?: number; right?: number; bottom?: number; left?: number }

/**
 * Callers pass per-edge margins (converted from their mm padding to
 * px/pt/dots). Any omitted edge defaults to 0.
 */
export function computeLabelGrid(
  width: number,
  height: number,
  columnSplitPct: number,
  rowSplitPct: number,
  margins: LabelMargins = {},
  gapRatio = 0.03
): LabelGrid {
  const mt = margins.top ?? 0
  const mr = margins.right ?? 0
  const mb = margins.bottom ?? 0
  const ml = margins.left ?? 0
  const innerW = Math.max(0, width - ml - mr)
  const innerH = Math.max(0, height - mt - mb)
  const colGap = innerW * gapRatio
  const rowGap = innerH * gapRatio
  const leftW = (innerW - colGap) * (columnSplitPct / 100)
  const rightW = innerW - colGap - leftW
  const topH = (innerH - rowGap) * (rowSplitPct / 100)
  const botH = innerH - rowGap - topH
  const x0 = ml
  const y0 = mt
  const x1 = ml + leftW + colGap
  const y1 = mt + topH + rowGap
  return {
    // Top row is a single full-width box; the column split only divides the
    // bottom row (barcode | price).
    name: { x: x0, y: y0, w: innerW, h: topH },
    barcode: { x: x0, y: y1, w: leftW, h: botH },
    price: { x: x1, y: y1, w: rightW, h: botH }
  }
}
