import { describe, it, expect } from 'vitest'
import PDFDocument from 'pdfkit'
import {
  DARKNESS_LEVELS,
  PRINT_WIDTH_DOTS,
  bitsToEscPos,
  densityCommand,
  isEpsonReceiptPrinter,
  pdfToEscPosRaster,
  printWidthDots,
  rgbaToBits,
  trimTrailingBlankRows
} from './escpos-raster'

function pdfOf(draw: (doc: PDFKit.PDFDocument) => void, height = 200): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({
      size: [204, height],
      margins: { top: 4, bottom: 4, left: 4, right: 4 }
    })
    const chunks: Buffer[] = []
    doc.on('data', (c: Buffer) => chunks.push(c))
    doc.on('end', () => resolve(Buffer.concat(chunks)))
    doc.on('error', reject)
    draw(doc)
    doc.end()
  })
}

const INIT = [0x1b, 0x40]
const CUT = [0x1d, 0x56, 0x42, 0x03]

describe('isEpsonReceiptPrinter', () => {
  it('matches Epson queues on Mac and Windows', () => {
    expect(isEpsonReceiptPrinter('EPSON_TM_T20IV')).toBe(true)
    expect(isEpsonReceiptPrinter('EPSON TM-T20IV Receipt')).toBe(true)
    expect(isEpsonReceiptPrinter('TM-T88V')).toBe(true)
    expect(isEpsonReceiptPrinter('Receipt TM_m30')).toBe(true)
  })

  it('leaves Star and everything else on the PDF path', () => {
    expect(isEpsonReceiptPrinter('Star TSP654')).toBe(false)
    expect(isEpsonReceiptPrinter('TSP100 (STR_T-001)')).toBe(false)
    expect(isEpsonReceiptPrinter('Zebra ZD421')).toBe(false)
    expect(isEpsonReceiptPrinter('Customtm1 printer')).toBe(false)
  })
})

describe('rgbaToBits', () => {
  it('packs dark opaque pixels as set bits, leftmost dot first', () => {
    // 8x1: black, white, black, transparent black, then grey (dark), light grey, white, white
    const px = [
      [0, 0, 0, 255],
      [255, 255, 255, 255],
      [0, 0, 0, 255],
      [0, 0, 0, 0],
      [100, 100, 100, 255],
      [200, 200, 200, 255],
      [255, 255, 255, 255],
      [255, 255, 255, 255]
    ].flat()
    const bits = rgbaToBits(new Uint8Array(px), 8, 1)
    expect([...bits]).toEqual([0b10101000])
  })
})

describe('trimTrailingBlankRows', () => {
  it('drops blank rows at the bottom only', () => {
    const bits = Buffer.from([0, 0, 1, 0, 0, 0])
    expect(trimTrailingBlankRows(bits, 2)).toBe(2)
    expect(trimTrailingBlankRows(Buffer.alloc(4), 2)).toBe(0)
  })
})

describe('bitsToEscPos', () => {
  it('splits tall images into GS v 0 bands and ends with a feed-and-cut', () => {
    const width = 16
    const height = 300
    const bits = Buffer.alloc((width / 8) * height, 0xff)
    const out = bitsToEscPos(bits, width, height)
    expect([...out.subarray(0, 2)]).toEqual(INIT)
    // First band: 2 bytes a row, 256 rows.
    expect([...out.subarray(2, 10)]).toEqual([0x1d, 0x76, 0x30, 0, 2, 0, 0, 1])
    const second = 10 + 2 * 256
    expect([...out.subarray(second, second + 8)]).toEqual([0x1d, 0x76, 0x30, 0, 2, 0, 44, 0])
    expect([...out.subarray(out.length - 4)]).toEqual(CUT)
    expect(out.length).toBe(2 + 8 + 512 + 8 + 88 + 4)
  })

  it('still cuts an empty receipt', () => {
    expect([...bitsToEscPos(Buffer.alloc(0), PRINT_WIDTH_DOTS, 0)]).toEqual([...INIT, ...CUT])
  })
})

describe('printWidthDots', () => {
  it('prints 72 mm on 80 mm paper and 48 mm on 58 mm, at 203 dpi', () => {
    expect(printWidthDots(80)).toBe(576)
    expect(printWidthDots(58)).toBe(384)
  })
})

describe('pdfToEscPosRaster', () => {
  it('draws a receipt page at 576 dots and trims the blank tail', async () => {
    const pdf = await pdfOf((doc) => {
      doc.font('Helvetica-Bold').fontSize(13).text('TEST STORE', { align: 'center' })
    }, 400)
    const out = await pdfToEscPosRaster(pdf)
    expect([...out.subarray(0, 2)]).toEqual(INIT)
    expect(out[2]).toBe(0x1d)
    expect(out[3]).toBe(0x76)
    // 72 bytes a row = 576 dots.
    expect(out[6] | (out[7] << 8)).toBe(PRINT_WIDTH_DOTS / 8)
    const rows = out[8] | (out[9] << 8)
    // One line of 13pt text, not the whole 400pt (~1130-dot) page.
    expect(rows).toBeGreaterThan(20)
    expect(rows).toBeLessThan(120)
    expect([...out.subarray(out.length - 4)]).toEqual(CUT)
  })
})

describe('pdfToEscPosRaster on 58 mm paper', () => {
  it('draws at 384 dots', async () => {
    const pdf = await pdfOf((doc) => doc.font('Helvetica').fontSize(10).text('58 mm'), 100)
    const out = await pdfToEscPosRaster(pdf, printWidthDots(58))
    expect(out[6] | (out[7] << 8)).toBe(384 / 8)
  })
})

describe('isEpsonReceiptPrinter (TM-T20III)', () => {
  it('matches the TM-T20III queue names', () => {
    expect(isEpsonReceiptPrinter('EPSON TM-T20III Receipt')).toBe(true)
    expect(isEpsonReceiptPrinter('EPSON_TM_T20III')).toBe(true)
    expect(isEpsonReceiptPrinter('usb://EPSON/TM-T20III?serial=1')).toBe(true)
  })
})

describe('print darkness', () => {
  it('sends the print density right after initialise, negative as 256 - n', () => {
    expect([...densityCommand(3)]).toEqual([0x1d, 0x28, 0x4b, 0x02, 0x00, 0x31, 3])
    expect([...densityCommand(-2)]).toEqual([0x1d, 0x28, 0x4b, 0x02, 0x00, 0x31, 254])
    expect(densityCommand(40)[6]).toBe(6)
    const out = bitsToEscPos(Buffer.alloc(0), PRINT_WIDTH_DOTS, 0, 6)
    expect([...out.subarray(0, 9)]).toEqual([0x1b, 0x40, 0x1d, 0x28, 0x4b, 0x02, 0x00, 0x31, 6])
  })

  it('leaves the printer its own density at normal', () => {
    expect(DARKNESS_LEVELS.normal.density).toBeNull()
    expect([...bitsToEscPos(Buffer.alloc(0), PRINT_WIDTH_DOTS, 0)]).toEqual([...INIT, ...CUT])
  })

  it('a higher threshold prints greyer pixels, so strokes get bolder', () => {
    const grey = new Uint8Array([
      180, 180, 180, 255, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
      0, 0, 0
    ])
    expect(rgbaToBits(grey, 8, 1, DARKNESS_LEVELS.normal.threshold)[0]).toBe(0)
    expect(rgbaToBits(grey, 8, 1, DARKNESS_LEVELS.dark.threshold)[0]).toBe(0x80)
  })

  it('draws more ink at darkest than at light', async () => {
    const pdf = await pdfOf((doc) => doc.font('Helvetica').fontSize(10).text('SAMPLE STORE'), 60)
    const ink = (b: Buffer): number =>
      [...b].reduce((n, x) => n + x.toString(2).replace(/0/g, '').length, 0)
    const light = await pdfToEscPosRaster(pdf, PRINT_WIDTH_DOTS, 'light')
    const darkest = await pdfToEscPosRaster(pdf, PRINT_WIDTH_DOTS, 'darkest')
    expect(ink(darkest)).toBeGreaterThan(ink(light))
  })
})
