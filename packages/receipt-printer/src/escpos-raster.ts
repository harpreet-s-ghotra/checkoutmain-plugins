import { createRequire } from 'node:module'
import { join, dirname } from 'node:path'
import type { PrintDarkness } from './types'

/**
 * Receipts for Epson TM printers, sent as ESC/POS raster instead of a PDF.
 *
 * Receipts are laid out once, as a PDF the width of the roll, and a Star driver
 * prints that page as it is. Epson's drivers do not: the Mac's CUPS queue lays it out on a
 * Letter page (sideways, overlapping), Windows' APD driver turns it on its side,
 * and neither cuts, because the cut is a Star-only driver option. So for an Epson
 * the same PDF is drawn to a 576-dot bitmap (72 mm at 203 dpi, the TM-T20's print
 * width) and sent raw — `GS v 0` image bands, then `GS V` feed-and-cut. No driver
 * setting is involved, so it comes out upright and cut on every OS.
 * See README.md (Why a PDF, then ESC/POS).
 */

/** Printable width in dots: 72 mm at 203 dpi on 80 mm paper. */
export const PRINT_WIDTH_DOTS = 576

/** Printable width in dots for a roll: 80 mm prints 72 mm (576), 58 mm prints 48 mm (384). */
export const printWidthDots = (paperWidthMm: 58 | 80): number => (paperWidthMm === 58 ? 384 : 576)

/** `GS v 0` takes up to 65535 rows, but older firmware buffers far less. */
const BAND_ROWS = 256

/** Pixels darker than this (0–255 luminance) print black. */
const INK_THRESHOLD = 160

/**
 * Print darkness on an Epson, two ways at once: `density` is the ESC/POS print
 * density (`GS ( K` fn 49, -6..+6 heat steps; null = the printer's own
 * setting), and `threshold` decides how grey an anti-aliased pixel may be and
 * still print, so a higher one draws thicker strokes.
 */
export const DARKNESS_LEVELS: Record<PrintDarkness, { density: number | null; threshold: number }> =
  {
    light: { density: -2, threshold: 140 },
    normal: { density: null, threshold: INK_THRESHOLD },
    dark: { density: 3, threshold: 190 },
    darkest: { density: 6, threshold: 215 }
  }

/**
 * Whether a receipt queue is an Epson TM printer that should get ESC/POS raster.
 * Matches the Mac queue (`EPSON_TM_T20IV`) and Windows driver names
 * (`EPSON TM-T20IV Receipt`, `TM-T88V`). Star printers keep the PDF path.
 */
export function isEpsonReceiptPrinter(printerName: string): boolean {
  if (/\bstar\b|tsp\d/i.test(printerName)) return false
  return /epson/i.test(printerName) || /(^|[^a-z])tm[-_ ]?[a-z]\d/i.test(printerName)
}

/**
 * Pack RGBA pixels into 1-bit rows, most significant bit = leftmost dot, the
 * layout `GS v 0` expects. `width` must be a multiple of 8.
 */
export function rgbaToBits(
  rgba: Uint8Array | Uint8ClampedArray,
  width: number,
  height: number,
  threshold: number = INK_THRESHOLD
): Buffer {
  const bytesPerRow = width / 8
  const bits = Buffer.alloc(bytesPerRow * height)
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4
      // Transparent pixels are paper, whatever their colour channels say.
      if (rgba[i + 3] < 128) continue
      const lum = 0.299 * rgba[i] + 0.587 * rgba[i + 1] + 0.114 * rgba[i + 2]
      if (lum < threshold) bits[y * bytesPerRow + (x >> 3)] |= 0x80 >> (x & 7)
    }
  }
  return bits
}

/** Drop blank rows at the bottom so the cut lands just under the last line. */
export function trimTrailingBlankRows(bits: Buffer, bytesPerRow: number): number {
  let rows = bits.length / bytesPerRow
  while (rows > 0) {
    const row = bits.subarray((rows - 1) * bytesPerRow, rows * bytesPerRow)
    if (row.some((b) => b !== 0)) break
    rows--
  }
  return rows
}

/** `GS ( K` fn 49: print density for this job, -6..+6 (negative as 256 - n). */
export function densityCommand(level: number): Buffer {
  const m = Math.max(-6, Math.min(6, Math.round(level)))
  return Buffer.from([0x1d, 0x28, 0x4b, 0x02, 0x00, 0x31, m < 0 ? 256 + m : m])
}

/**
 * Wrap 1-bit rows in ESC/POS: initialise, the print density when one is set,
 * the image in `GS v 0` bands, then feed past the cutter and partial-cut
 * (`GS V 66 n`).
 */
export function bitsToEscPos(
  bits: Buffer,
  width: number,
  height: number,
  density: number | null = null
): Buffer {
  const bytesPerRow = width / 8
  const parts: Buffer[] = [Buffer.from([0x1b, 0x40])]
  if (density !== null) parts.push(densityCommand(density))
  for (let y0 = 0; y0 < height; y0 += BAND_ROWS) {
    const rows = Math.min(BAND_ROWS, height - y0)
    parts.push(
      Buffer.from([
        0x1d,
        0x76,
        0x30,
        0x00,
        bytesPerRow & 0xff,
        bytesPerRow >> 8,
        rows & 0xff,
        rows >> 8
      ]),
      bits.subarray(y0 * bytesPerRow, (y0 + rows) * bytesPerRow)
    )
  }
  parts.push(Buffer.from([0x1d, 0x56, 0x42, 0x03]))
  return Buffer.concat(parts)
}

type PdfjsModule = typeof import('pdfjs-dist/legacy/build/pdf.mjs')

let pdfjsPromise: Promise<PdfjsModule> | null = null
function loadPdfjs(): Promise<PdfjsModule> {
  if (!pdfjsPromise) {
    pdfjsPromise = import('pdfjs-dist/legacy/build/pdf.mjs') as unknown as Promise<PdfjsModule>
  }
  return pdfjsPromise
}

/**
 * pdfjs's copies of the 14 standard PDF fonts. Receipts use Helvetica without
 * embedding it, so without these pdfjs falls back to whatever the OS has, and a
 * Windows register would print in a different face from the one measured.
 */
function standardFontDir(): string {
  const pkg = createRequire(import.meta.url).resolve('pdfjs-dist/package.json')
  // In a packaged app the module resolves inside app.asar, which fs can read.
  return join(dirname(pkg), 'standard_fonts') + '/'
}

/** Draw every page of a receipt PDF at the printer's width and return ESC/POS. */
export async function pdfToEscPosRaster(
  pdf: Buffer,
  widthDots: number = PRINT_WIDTH_DOTS,
  darkness: PrintDarkness = 'normal'
): Promise<Buffer> {
  const { density, threshold } = DARKNESS_LEVELS[darkness]
  const pdfjs = await loadPdfjs()
  const { createCanvas } = await import('@napi-rs/canvas')
  const task = pdfjs.getDocument({
    data: new Uint8Array(pdf),
    standardFontDataUrl: standardFontDir()
  })
  try {
    const doc = await task.promise
    const pages: Buffer[] = []
    const bytesPerRow = widthDots / 8
    for (let n = 1; n <= doc.numPages; n++) {
      const page = await doc.getPage(n)
      const scale = widthDots / page.getViewport({ scale: 1 }).width
      const viewport = page.getViewport({ scale })
      const height = Math.ceil(viewport.height)
      const canvas = createCanvas(widthDots, height)
      const ctx = canvas.getContext('2d')
      ctx.fillStyle = '#ffffff'
      ctx.fillRect(0, 0, widthDots, height)
      await page.render({
        canvas: canvas as unknown as HTMLCanvasElement,
        canvasContext: ctx as unknown as CanvasRenderingContext2D,
        viewport
      }).promise
      const rgba = ctx.getImageData(0, 0, widthDots, height).data
      const bits = rgbaToBits(rgba, widthDots, height, threshold)
      pages.push(bits)
    }
    const all = Buffer.concat(pages)
    const rows = trimTrailingBlankRows(all, bytesPerRow)
    return bitsToEscPos(all.subarray(0, rows * bytesPerRow), widthDots, rows, density)
  } finally {
    await task.destroy()
  }
}
