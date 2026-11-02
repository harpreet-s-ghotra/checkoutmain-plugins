/**
 * Shelf-label printing. One PDF page (or one ZPL format) per label, sized to
 * the configured media. Zebra printers get native ZPL over the raw spooler
 * path; DYMO / Brother / generic go through the OS driver as a PDF.
 */
import { writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import PDFDocument from 'pdfkit'
import * as bwipjs from 'bwip-js/node'
import { formatCurrency } from './format-currency'
import { renderLabelsZpl } from './label-zpl'
import {
  appendSize,
  computeLabelGrid,
  isPrintableLabelName,
  resolveLabelName,
  resolvePrintLanguage,
  sanitizeLabelSettings,
  selectSymbology,
  type LabelRect
} from './labels'
import {
  printPdfFile as defaultPrintPdfFile,
  printRawFile as defaultPrintRawFile
} from './transport'
import type { LabelPrintItem, LabelSettings, PrintLabelsInput, PrintLabelsResult } from './types'

// 1in = 25400µm = 72pt
const MICRONS_PER_POINT = 25400 / 72
export const micronsToPoints = (microns: number): number => microns / MICRONS_PER_POINT

/** Largest font size (≤ max) at which `text` fits `width` on one line. */
function fitFontSize(doc: PDFKit.PDFDocument, text: string, width: number, max: number): number {
  const min = 4
  for (let size = max; size > min; size -= 0.5) {
    doc.fontSize(size)
    if (doc.widthOfString(text) <= width) return size
  }
  return min
}

/** Largest font size (≤ max) at which `text`, wrapped to `width`, fits `height`. */
function fitWrappedFontSize(
  doc: PDFKit.PDFDocument,
  text: string,
  width: number,
  height: number,
  max: number
): number {
  const min = 6
  for (let size = max; size > min; size -= 0.5) {
    doc.fontSize(size)
    if (doc.heightOfString(text, { width }) <= height) return size
  }
  return min
}

/** How far the barcode may be stretched past its natural aspect (the digits under it distort first). */
const MAX_BARCODE_STRETCH = 1.5

/** PNG width/height from the IHDR chunk — all we need is the aspect. */
function pngAspect(buf: Buffer): number | null {
  if (buf.length < 24) return null
  const w = buf.readUInt32BE(16)
  const h = buf.readUInt32BE(20)
  return w > 0 && h > 0 ? w / h : null
}

function drawCentered(
  doc: PDFKit.PDFDocument,
  text: string,
  rect: LabelRect,
  font: string,
  maxSize: number,
  align: 'left' | 'center' | 'right'
): void {
  if (!text) return
  doc.font(font)
  const size = fitFontSize(doc, text, rect.w, maxSize)
  doc.fontSize(size)
  const y = rect.y + Math.max(0, (rect.h - doc.currentLineHeight()) / 2)
  doc.text(text, rect.x, y, { width: rect.w, align, lineBreak: false })
}

/**
 * One label: name + size across the top (up to two lines), barcode bottom-left,
 * price bottom-right. Cell rects come from the shared grid so a settings
 * preview drawn with `computeLabelGrid` matches the paper exactly.
 */
function renderLabel(
  doc: PDFKit.PDFDocument,
  item: LabelPrintItem,
  settings: LabelSettings,
  barcodePng: Buffer | null,
  formatPrice: (price: number) => string
): void {
  const ptPerMm = 72 / 25.4
  const grid = computeLabelGrid(
    doc.page.width,
    doc.page.height,
    settings.columnSplitPct,
    settings.rowSplitPct,
    {
      top: settings.paddingTopMm * ptPerMm,
      right: settings.paddingRightMm * ptPerMm,
      bottom: settings.paddingBottomMm * ptPerMm,
      left: settings.paddingLeftMm * ptPerMm
    }
  )

  const topLine = appendSize(resolveLabelName(item) || item.sku, item.size)
  doc.font('Helvetica-Bold')
  const nameSize = fitWrappedFontSize(doc, topLine, grid.name.w, grid.name.h, settings.nameFontSize)
  doc.fontSize(nameSize)
  doc.text(topLine, grid.name.x, grid.name.y, {
    width: grid.name.w,
    height: grid.name.h,
    ellipsis: true,
    align: 'left'
  })

  // Give the bottom row whatever height the name did not use.
  const usedNameH = Math.min(grid.name.h, doc.heightOfString(topLine, { width: grid.name.w }))
  const reclaimed = Math.max(0, grid.name.h - usedNameH)
  if (reclaimed > 0) {
    for (const cell of [grid.barcode, grid.price]) {
      cell.y -= reclaimed
      cell.h += reclaimed
    }
  }

  drawCentered(
    doc,
    formatPrice(item.price),
    grid.price,
    'Helvetica-Bold',
    settings.priceFontSize,
    'center'
  )

  if (barcodePng) {
    // Full cell width (module width is what the scanner resolves); height is
    // stretched past the natural aspect only up to MAX_BARCODE_STRETCH.
    const natural = pngAspect(barcodePng)
    const drawnH =
      natural != null
        ? Math.min(grid.barcode.h, (grid.barcode.w / natural) * MAX_BARCODE_STRETCH)
        : grid.barcode.h
    doc.image(barcodePng, grid.barcode.x, grid.barcode.y + (grid.barcode.h - drawnH) / 2, {
      width: grid.barcode.w,
      height: drawnH
    })
  } else {
    drawCentered(doc, item.sku, grid.barcode, 'Courier', settings.skuFontSize, 'center')
  }
}

/** A barcode PNG for `text` in symbology `bcid` (a bwip-js id). */
export type BarcodeRenderer = (bcid: string, text: string) => Promise<Buffer>

const bwipBarcode: BarcodeRenderer = (bcid, text) =>
  bwipjs.toBuffer({ bcid, text, scale: 3, height: 8, includetext: true, textxalign: 'center' })

/** SKU barcode PNG for an item, or null when disabled / unrenderable. */
async function barcodeFor(
  item: LabelPrintItem,
  settings: LabelSettings,
  render: BarcodeRenderer
): Promise<Buffer | null> {
  if (!settings.printBarcode) return null
  const text = item.sku.trim()
  if (!text) return null
  try {
    return await render(selectSymbology(text), text)
  } catch {
    // Non-numeric SKU under a UPC symbology — Code128 accepts anything.
    try {
      return await render('code128', text)
    } catch {
      return null
    }
  }
}

export type LabelRenderOptions = {
  /** Draws the barcode PNG; bwip-js by default. */
  barcode?: BarcodeRenderer
  /** Formats the price on the label; "$1,234.50" by default. */
  formatPrice?: (price: number) => string
}

/** The labels as one PDF, a page per label, sized to the media. */
export async function renderLabelsPdf(
  items: LabelPrintItem[],
  settings: LabelSettings,
  opts: LabelRenderOptions = {}
): Promise<Buffer> {
  const pageW = micronsToPoints(settings.widthMicrons)
  const pageH = micronsToPoints(settings.heightMicrons)
  const render = opts.barcode ?? bwipBarcode
  const formatPrice = opts.formatPrice ?? formatCurrency
  const barcodes = await Promise.all(items.map((item) => barcodeFor(item, settings, render)))

  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: [pageW, pageH], margin: 0 })
    const chunks: Buffer[] = []
    doc.on('data', (c: Buffer) => chunks.push(c))
    doc.on('end', () => resolve(Buffer.concat(chunks)))
    doc.on('error', reject)
    items.forEach((item, i) => {
      if (i > 0) doc.addPage({ size: [pageW, pageH], margin: 0 })
      renderLabel(doc, item, settings, barcodes[i], formatPrice)
    })
    doc.end()
  })
}

export type LabelPrinterDeps = LabelRenderOptions & {
  /** The register's saved label settings, used when a job carries none. */
  getSettings: () => Partial<LabelSettings> | LabelSettings
  /** Transport seams; the package's own by default. */
  printPdfFile?: typeof defaultPrintPdfFile
  printRawFile?: (filePath: string, printerName: string) => Promise<void>
  /** Where the scratch files go. */
  tmpDir?: string
}

export type LabelPrinter = {
  /**
   * Render + print one job with every item's label. Names over the length
   * limit are skipped rather than clipped, and the count comes back.
   */
  printLabels(input: PrintLabelsInput): Promise<PrintLabelsResult>
}

export function createLabelPrinter(deps: LabelPrinterDeps): LabelPrinter {
  const printPdf = deps.printPdfFile ?? defaultPrintPdfFile
  const printRaw = deps.printRawFile ?? defaultPrintRawFile
  const dir = deps.tmpDir ?? tmpdir()

  async function printLabels(input: PrintLabelsInput): Promise<PrintLabelsResult> {
    const requested = input.items ?? []
    const settings = sanitizeLabelSettings(input.settings ?? deps.getSettings())

    const items = requested.filter((it) => isPrintableLabelName(it, settings.maxNameLength))
    const skipped = requested.length - items.length
    if (items.length === 0) return { printed: 0, skipped }

    const printerName = settings.labelPrinterName
    if (!printerName) throw new Error('No label printer selected — choose one in Label settings')

    if (resolvePrintLanguage(settings.printLanguage, printerName) === 'zpl') {
      const tmpFile = join(dir, `labels-${Date.now()}.zpl`)
      writeFileSync(tmpFile, renderLabelsZpl(items, settings, deps.formatPrice), 'utf-8')
      await printRaw(tmpFile, printerName)
      return { printed: items.length, skipped }
    }

    const tmpFile = join(dir, `labels-${Date.now()}.pdf`)
    writeFileSync(tmpFile, await renderLabelsPdf(items, settings, deps))
    // The page IS the label; orientation is expressed by width × height.
    await printPdf(tmpFile, printerName, { orientation: 'portrait', lpOptions: [] })
    return { printed: items.length, skipped }
  }

  return { printLabels }
}
