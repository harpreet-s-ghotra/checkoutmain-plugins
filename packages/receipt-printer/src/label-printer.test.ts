import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { LabelPrintItem, LabelSettings } from './types'

// The real bwip-js renders the barcodes: the UPC encoders refuse letters, which
// is the fallback this test exercises.
import { createLabelPrinter } from './label-printer'
import { LABEL_SETTINGS_DEFAULTS } from './labels'

const io = {
  printPdfFile: vi.fn(async () => undefined),
  printRawFile: vi.fn(async () => undefined)
}

const settings = (over: Partial<LabelSettings> = {}): LabelSettings => ({
  ...LABEL_SETTINGS_DEFAULTS,
  labelPrinterName: 'Brother QL',
  printBarcode: true,
  printLanguage: 'os',
  maxNameLength: 40,
  ...over
})

const item = (over: Partial<LabelPrintItem> = {}): LabelPrintItem => ({
  sku: '036000291452',
  name: 'Ginger Kombucha',
  size: '16 oz',
  price: 3.95,
  ...over
})

const saved = vi.fn((): Partial<LabelSettings> => ({ labelPrinterName: 'Saved Printer' }))
const printer = createLabelPrinter({ getSettings: saved, ...io })

describe('printLabels', () => {
  beforeEach(() => {
    io.printPdfFile.mockClear()
    io.printRawFile.mockClear()
    saved.mockClear()
  })

  it('renders a PDF job and prints it on the OS driver', async () => {
    const result = await printer.printLabels({ items: [item()], settings: settings() })
    expect(result).toEqual({ printed: 1, skipped: 0 })
    expect(io.printPdfFile).toHaveBeenCalledWith(
      expect.stringMatching(/labels-\d+\.pdf$/),
      'Brother QL',
      {
        orientation: 'portrait',
        lpOptions: []
      }
    )
  })

  it('uses the saved settings when the job carries none', async () => {
    const result = await printer.printLabels({ items: [item()] })
    expect(saved).toHaveBeenCalled()
    expect(result).toEqual({ printed: 1, skipped: 0 })
    expect(io.printPdfFile).toHaveBeenCalledWith(
      expect.any(String),
      'Saved Printer',
      expect.anything()
    )
  })

  it('falls back to Code 128 when the SKU is not a valid UPC/EAN', async () => {
    const result = await printer.printLabels({
      items: [item({ sku: 'ABC-123' }), item({ sku: '12345' })],
      settings: settings()
    })
    expect(result).toEqual({ printed: 2, skipped: 0 })
    expect(io.printPdfFile).toHaveBeenCalledTimes(1)
  })

  it('skips the barcode entirely when disabled or the SKU is blank', async () => {
    await printer.printLabels({
      items: [item({ sku: '   ' }), item()],
      settings: settings({ printBarcode: false })
    })
    await printer.printLabels({ items: [item({ sku: '  ' })], settings: settings() })
    expect(io.printPdfFile).toHaveBeenCalledTimes(2)
  })

  it('skips over-length names and reports the count, and refuses with no printer', async () => {
    const long = item({ name: 'X'.repeat(60) })
    expect(await printer.printLabels({ items: [long], settings: settings() })).toEqual({
      printed: 0,
      skipped: 1
    })
    expect(io.printPdfFile).not.toHaveBeenCalled()
    expect(await printer.printLabels({ items: [], settings: settings() })).toEqual({
      printed: 0,
      skipped: 0
    })
    await expect(
      printer.printLabels({ items: [item()], settings: settings({ labelPrinterName: '' }) })
    ).rejects.toThrow(/No label printer selected/)
  })

  it('shrinks a long allowed name down to the minimum font sizes', async () => {
    const result = await printer.printLabels({
      items: [item({ name: 'W'.repeat(38), size: '' })],
      settings: settings({ widthMicrons: 15_000, heightMicrons: 8_000 })
    })
    expect(result.printed).toBe(1)
  })

  it('routes a Zebra printer to ZPL through the raw path', async () => {
    const result = await printer.printLabels({
      items: [item(), item({ sku: '4006381333931' })],
      settings: settings({ labelPrinterName: 'Zebra ZD420', printLanguage: 'auto' })
    })
    expect(result).toEqual({ printed: 2, skipped: 0 })
    expect(io.printRawFile).toHaveBeenCalledWith(
      expect.stringMatching(/labels-\d+\.zpl$/),
      'Zebra ZD420'
    )
    expect(io.printPdfFile).not.toHaveBeenCalled()
  })

  it('handles unicode names, odd SKUs, many items and a custom price format', async () => {
    const custom = createLabelPrinter({
      getSettings: () => settings(),
      ...io,
      formatPrice: (p) => `€${p.toFixed(2)}`
    })
    const many = Array.from({ length: 40 }, (_, i) =>
      item({ sku: `SKU${i}`, name: `Product ${i}` })
    )
    const result = await custom.printLabels({
      items: [...many, item({ name: '日本製品' }), item({ sku: '978-0-306-40615', name: 'Book' })]
    })
    expect(result).toEqual({ printed: 42, skipped: 0 })
  })
})
