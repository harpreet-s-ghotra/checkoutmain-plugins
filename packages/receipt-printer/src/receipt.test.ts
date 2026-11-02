import { describe, it, expect, vi, beforeEach } from 'vitest'
import { existsSync, readFileSync } from 'node:fs'
import PDFDocument from 'pdfkit'

const io = vi.hoisted(() => ({
  printPdfFile: vi.fn(async (file: string) => {
    io.pdfFiles.push(file)
  }),
  printRawFile: vi.fn(async (file: string) => {
    io.rawFiles.push({ file, bytes: readFileSync(file) })
  }),
  pdfFiles: [] as string[],
  rawFiles: [] as { file: string; bytes: Buffer }[],
  rasterFails: false
}))
vi.mock('./transport', () => ({
  printPdfFile: io.printPdfFile,
  printRawFile: io.printRawFile
}))
vi.mock('./escpos-raster', async (importOriginal) => {
  const real = await importOriginal<typeof import('./escpos-raster')>()
  return {
    ...real,
    pdfToEscPosRaster: vi.fn(async (...args: Parameters<typeof real.pdfToEscPosRaster>) => {
      if (io.rasterFails) throw new Error('canvas missing')
      return real.pdfToEscPosRaster(...args)
    })
  }
})

import { printReceiptPdf, pageWidthPoints, dotsPerPoint, STAR_CUT_LP_OPTIONS } from './receipt'

function pdfOf(text: string): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: [pageWidthPoints(80), 120], margin: 4 })
    const chunks: Buffer[] = []
    doc.on('data', (c: Buffer) => chunks.push(c))
    doc.on('end', () => resolve(Buffer.concat(chunks)))
    doc.on('error', reject)
    doc.font('Helvetica').fontSize(12).text(text)
    doc.end()
  })
}

describe('printReceiptPdf', () => {
  beforeEach(() => {
    io.printPdfFile.mockClear()
    io.printRawFile.mockClear()
    io.pdfFiles.length = 0
    io.rawFiles.length = 0
    io.rasterFails = false
  })

  it('sizes the page to the roll', () => {
    expect(pageWidthPoints(80)).toBe(204)
    expect(pageWidthPoints(58)).toBe(136)
    expect(dotsPerPoint(80)).toBeCloseTo(576 / 204, 5)
  })

  it('sends an Epson the page as ESC/POS raster and says so', async () => {
    const path = await printReceiptPdf(await pdfOf('TEST STORE'), {
      printerName: 'EPSON TM-T20III Receipt',
      paperWidthMm: 80
    })
    expect(path).toBe('escpos')
    expect(io.printPdfFile).not.toHaveBeenCalled()
    expect(io.rawFiles).toHaveLength(1)
    expect(io.rawFiles[0].file).toMatch(/receipt-\d+\.bin$/)
    expect([...io.rawFiles[0].bytes.subarray(0, 2)]).toEqual([0x1b, 0x40])
    expect([...io.rawFiles[0].bytes.subarray(-4)]).toEqual([0x1d, 0x56, 0x42, 0x03])
  })

  it('sends a Star the PDF through the driver with the cut options', async () => {
    const path = await printReceiptPdf(await pdfOf('x'), {
      printerName: 'Star TSP654',
      paperWidthMm: 80
    })
    expect(path).toBe('driver')
    expect(io.printPdfFile).toHaveBeenCalledWith(
      expect.stringMatching(/receipt-\d+\.pdf$/),
      'Star TSP654',
      {
        lpOptions: STAR_CUT_LP_OPTIONS
      }
    )
    expect(io.printRawFile).not.toHaveBeenCalled()
  })

  it('takes the host answer on whether the queue is an Epson', async () => {
    const ask = vi.fn(async () => true)
    expect(
      await printReceiptPdf(
        await pdfOf('x'),
        { printerName: 'Front Counter', paperWidthMm: 58 },
        { isEpson: ask }
      )
    ).toBe('escpos')
    expect(ask).toHaveBeenCalledWith('Front Counter')
    expect(
      await printReceiptPdf(
        await pdfOf('x'),
        { printerName: 'EPSON TM-m30', paperWidthMm: 80 },
        { isEpson: false }
      )
    ).toBe('driver')
  })

  it('falls back to the driver when the raster cannot be drawn, and leaves no scratch file behind', async () => {
    io.rasterFails = true
    const warn = vi.fn()
    const path = await printReceiptPdf(
      await pdfOf('x'),
      { printerName: 'EPSON TM-T20IV', paperWidthMm: 80 },
      { log: { warn } }
    )
    expect(path).toBe('driver')
    expect(warn).toHaveBeenCalledWith(expect.stringMatching(/canvas missing/))
    expect(io.pdfFiles).toHaveLength(1)
    expect(io.printRawFile).not.toHaveBeenCalled()
  })

  it('removes the PDF once the raster is written', async () => {
    await printReceiptPdf(await pdfOf('x'), { printerName: 'EPSON TM-T20IV', paperWidthMm: 80 })
    const pdf = io.rawFiles[0].file.replace(/\.bin$/, '.pdf')
    expect(existsSync(pdf)).toBe(false)
  })

  it('refuses without a printer', async () => {
    await expect(
      printReceiptPdf(await pdfOf('x'), { printerName: '', paperWidthMm: 80 })
    ).rejects.toThrow(/Receipt printer not set up/)
  })
})
