/**
 * A receipt-roll job, laid out once as a PDF the width of the roll, sent the
 * way the printer in front of it needs: a Star (or any non-Epson) gets the PDF
 * through its driver, which cuts on the Star cut options; an Epson TM gets the
 * same page drawn to ESC/POS raster and sent raw, upright and cut. If drawing
 * the raster fails, the PDF still goes to the driver: a bad receipt beats none.
 */
import { readFileSync, unlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pdfToEscPosRaster, printWidthDots } from './escpos-raster'
import { isEpsonReceiptPrinter } from './escpos-raster'
import { resolveLogger } from './log'
import { printPdfFile, printRawFile, type RawPrintOptions } from './transport'
import {
  DEFAULT_PRINT_DARKNESS,
  type PaperWidthMm,
  type ReceiptPrinter,
  type ReceiptPrintPath
} from './types'

const PT_PER_MM = 72 / 25.4

/** Page width in PDF points for a roll: an 80 mm roll prints 72 mm, a 58 mm roll 48 mm. */
export function pageWidthPoints(paperWidthMm: PaperWidthMm): number {
  return Math.round((paperWidthMm === 58 ? 48 : 72) * PT_PER_MM)
}

/** Printer dots per PDF point on an Epson, for drawing a barcode to whole dots. */
export function dotsPerPoint(paperWidthMm: PaperWidthMm): number {
  return printWidthDots(paperWidthMm) / pageWidthPoints(paperWidthMm)
}

/** `lp` options that make a Star driver partial-cut after the document, not every page. */
export const STAR_CUT_LP_OPTIONS = [
  '-o',
  'DocCutType=1PartialCutDoc',
  '-o',
  'PageCutType=0NoCutPage'
]

export type ReceiptJobOptions = RawPrintOptions & {
  /**
   * Whether this queue is an Epson (ESC/POS raster). A boolean when the host
   * already knows, a function to ask (`isEpsonReceiptQueue` with the OS
   * description), or omitted to decide from the queue name alone.
   */
  isEpson?: boolean | ((printerName: string) => Promise<boolean>)
  /** `lp` options for the driver path; defaults to the Star cut options. */
  lpOptions?: string[]
  /** Where the scratch files go. */
  tmpDir?: string
  /** Scratch file prefix, so a log line names the job. */
  prefix?: string
}

/**
 * Print a receipt-roll PDF on the printer the way it needs, and say which way
 * it went. The PDF should already be laid out at `pageWidthPoints(paperWidthMm)`.
 */
export async function printReceiptPdf(
  pdf: Buffer,
  printer: ReceiptPrinter,
  opts: ReceiptJobOptions = {}
): Promise<ReceiptPrintPath> {
  if (!printer.printerName) {
    throw new Error('Receipt printer not set up — choose one in Printer settings')
  }
  const log = resolveLogger(opts.log)
  const dir = opts.tmpDir ?? tmpdir()
  const tmpFile = join(dir, `${opts.prefix ?? 'receipt'}-${Date.now()}.pdf`)
  writeFileSync(tmpFile, pdf)

  const epson =
    typeof opts.isEpson === 'boolean'
      ? opts.isEpson
      : opts.isEpson
        ? await opts.isEpson(printer.printerName)
        : isEpsonReceiptPrinter(printer.printerName)

  if (epson) {
    let rawFile: string | null = null
    try {
      const escpos = await pdfToEscPosRaster(
        readFileSync(tmpFile),
        printWidthDots(printer.paperWidthMm),
        printer.darkness ?? DEFAULT_PRINT_DARKNESS
      )
      rawFile = tmpFile.replace(/\.pdf$/i, '') + '.bin'
      writeFileSync(rawFile, escpos)
    } catch (err) {
      log.warn(
        `ESC/POS raster failed, printing the PDF through the driver: ${err instanceof Error ? err.message : String(err)}`
      )
      rawFile = null
    }
    if (rawFile) {
      try {
        unlinkSync(tmpFile)
      } catch {
        /* ignore */
      }
      await printRawFile(rawFile, printer.printerName, { host: opts.host, log: opts.log })
      return 'escpos'
    }
  }
  await printPdfFile(tmpFile, printer.printerName, {
    lpOptions: opts.lpOptions ?? STAR_CUT_LP_OPTIONS
  })
  return 'driver'
}
