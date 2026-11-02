// Native ZPL (Zebra Programming Language) rendering for the 2x2 shelf label.
// Mirrors the PDF renderer's layout via the shared grid geometry, so a Zebra
// prints the same Name / Size / Barcode / Price arrangement -- but as vector ZPL
// the thermal head reproduces exactly, at any DPI, with no rasterizing.

import { formatCurrency } from './format-currency'
import { appendSize, computeLabelGrid, resolveLabelName, selectSymbology } from './labels'
import type { LabelSymbology } from './labels'
import type { LabelPrintItem, LabelSettings } from './types'

const MM_PER_INCH = 25.4

/** Label media dimension (microns) -> printer dots at the given DPI. */
export function micronsToDots(microns: number, dpi: number): number {
  return Math.round((microns / 1000 / MM_PER_INCH) * dpi)
}

/** Point size -> dots (ZPL fonts are specified in dots). */
function ptToDots(pt: number, dpi: number): number {
  return Math.max(8, Math.round((pt * dpi) / 72))
}

/**
 * Shrink the name font (dots) so `text` is likely to fit the two-line name box.
 * ZPL's ^FB clips rather than scales, so we pick the largest height at which the
 * estimated two-line capacity holds the whole string (^A0 glyph advance ≈ 0.6×
 * the font height). Floored at 8 dots — the length gate keeps names ≤ the limit,
 * so this only fine-tunes the tight (near-limit) cases.
 */
function fitNameFontDots(text: string, widthDots: number, maxFontDots: number): number {
  const min = 8
  for (let f = maxFontDots; f > min; f -= 1) {
    const perLine = Math.floor(widthDots / (0.6 * f))
    if (perLine * 2 >= text.length) return f
  }
  return min
}

/**
 * ZPL uses ^ and ~ as command prefixes; a literal one in field data would break
 * the format. With ^CI28 (UTF-8) everything else prints fine, so we only need to
 * neutralize those two prefixes.
 */
function zplEscape(text: string): string {
  return text.replace(/[\^~]/g, ' ')
}

/** Total barcode modules incl. quiet zones — for fitting AND centering. */
function barcodeModules(sym: LabelSymbology, dataLen: number): number {
  if (sym === 'upca' || sym === 'ean13') return 113 // 95 encoded + ~9 quiet each side
  return dataLen * 11 + 35 + 20 // Code128 encoded + ~10 quiet each side
}

/** Module (narrow-bar) width in dots that keeps the barcode inside availDots. */
function moduleWidth(sym: LabelSymbology, dataLen: number, availDots: number): number {
  const mw = Math.floor(availDots / barcodeModules(sym, dataLen))
  return Math.max(1, Math.min(3, mw))
}

/** ZPL barcode command for the SKU. UPC-A/EAN-13 take the value minus its check
 *  digit (ZPL recomputes it); anything else is Code128, which accepts it whole. */
function barcodeZpl(
  sku: string,
  sym: LabelSymbology,
  heightDots: number,
  byModule: number
): string {
  const by = `^BY${byModule}`
  if (sym === 'upca')
    return `${by}^BUN,${heightDots},Y,N^FD${sku.replace(/\D/g, '').slice(0, 11)}^FS`
  if (sym === 'ean13')
    return `${by}^BEN,${heightDots},Y,N^FD${sku.replace(/\D/g, '').slice(0, 12)}^FS`
  return `${by}^BCN,${heightDots},Y,N,N^FD${zplEscape(sku)}^FS`
}

/** Render one label as a single ^XA...^XZ ZPL format. */
export function renderLabelZpl(
  item: LabelPrintItem,
  settings: LabelSettings,
  formatPrice: (price: number) => string = formatCurrency
): string {
  const dpi = settings.dpi
  const w = micronsToDots(settings.widthMicrons, dpi)
  const h = micronsToDots(settings.heightMicrons, dpi)
  const dotsPerMm = dpi / MM_PER_INCH
  const g = computeLabelGrid(w, h, settings.columnSplitPct, settings.rowSplitPct, {
    top: settings.paddingTopMm * dotsPerMm,
    right: settings.paddingRightMm * dotsPerMm,
    bottom: settings.paddingBottomMm * dotsPerMm,
    left: settings.paddingLeftMm * dotsPerMm
  })

  const r = (n: number): number => Math.round(n)
  const topLine = zplEscape(appendSize(resolveLabelName(item) || item.sku, item.size))
  const nameFont = fitNameFontDots(topLine, r(g.name.w), ptToDots(settings.nameFontSize, dpi))
  const priceFont = ptToDots(settings.priceFontSize, dpi)
  const skuFont = ptToDots(settings.skuFontSize, dpi)

  const lines: string[] = ['^XA', '^CI28', `^PW${w}`, `^LL${h}`, '^LH0,0']

  // Name + size -- full-width top box, up to 2 lines.
  lines.push(
    `^FO${r(g.name.x)},${r(g.name.y)}^A0N,${nameFont},${nameFont}` +
      `^FB${r(g.name.w)},2,0,L,0^FD${topLine}^FS`
  )

  // Price -- bottom-right (the yellow zone), centered.
  const priceY = r(g.price.y + (g.price.h - priceFont) / 2)
  lines.push(
    `^FO${r(g.price.x)},${priceY}^A0N,${priceFont},${priceFont}` +
      `^FB${r(g.price.w)},1,0,C,0^FD${zplEscape(formatPrice(item.price))}^FS`
  )

  // Barcode -- bottom-left, or the SKU as text when barcodes are off.
  if (settings.printBarcode) {
    const sym = selectSymbology(item.sku)
    const barHeight = Math.max(20, r(g.barcode.h * 0.55))
    const by = moduleWidth(sym, item.sku.length, r(g.barcode.w))
    // Center the barcode (bars + interpretation line) in its cell.
    const barW = barcodeModules(sym, item.sku.length) * by
    const textH = Math.round(barHeight * 0.32) + 6 // interpretation-line height estimate
    const bx = r(g.barcode.x + Math.max(0, (g.barcode.w - barW) / 2))
    const by0 = r(g.barcode.y + Math.max(0, (g.barcode.h - (barHeight + textH)) / 2))
    lines.push(`^FO${bx},${by0}${barcodeZpl(item.sku, sym, barHeight, by)}`)
  } else {
    const y = r(g.barcode.y + (g.barcode.h - skuFont) / 2)
    lines.push(
      `^FO${r(g.barcode.x)},${y}^A0N,${skuFont},${skuFont}^FB${r(g.barcode.w)},1,0,C,0^FD${zplEscape(item.sku)}^FS`
    )
  }

  lines.push('^XZ')
  return lines.join('\n')
}

/** Render a batch as one ZPL stream -- one ^XA...^XZ format per label. */
export function renderLabelsZpl(
  items: LabelPrintItem[],
  settings: LabelSettings,
  formatPrice: (price: number) => string = formatCurrency
): string {
  return items.map((item) => renderLabelZpl(item, settings, formatPrice)).join('\n')
}
