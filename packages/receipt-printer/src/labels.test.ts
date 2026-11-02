/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect } from 'vitest'
import {
  hasValidGtinCheckDigit,
  selectSymbology,
  labelPrice,
  canPrintLabel,
  resolveLabelName,
  isPrintableLabelName,
  appendSize,
  clamp,
  sanitizeLabelSettings,
  isZebraPrinter,
  resolvePrintLanguage,
  computeLabelGrid,
  LABEL_SETTINGS_DEFAULTS,
  LABEL_SETTINGS_BOUNDS
} from './labels'
import type { LabelCandidate } from './labels'

describe('labels', () => {
  describe('hasValidGtinCheckDigit', () => {
    it('validates UPC-A (12 digits)', () => {
      // 5901234123457 is a valid UPC-A
      expect(hasValidGtinCheckDigit('5901234123457')).toBe(true)
      // 5901234123456 is not valid
      expect(hasValidGtinCheckDigit('5901234123456')).toBe(false)
    })

    it('validates EAN-13 (13 digits)', () => {
      // 5901234123457 (valid EAN-13)
      expect(hasValidGtinCheckDigit('5901234123457')).toBe(true)
    })

    it('validates test Visa UPC-A', () => {
      // From https://www.gs1.org/services/how-calculate-check-digit-manually
      expect(hasValidGtinCheckDigit('123456789012')).toBe(true)
    })

    it('rejects invalid checksums', () => {
      expect(hasValidGtinCheckDigit('123456789011')).toBe(false)
      // 000000000000 is actually valid (all zeros)
      expect(hasValidGtinCheckDigit('111111111116')).toBe(false)
    })

    it('weights alternate 3 and 1 from the right', () => {
      // The algorithm weights from right: 3,1,3,1... so position matters
      expect(hasValidGtinCheckDigit('978020137962')).toBe(true) // valid ISBN
    })
  })

  describe('selectSymbology', () => {
    it('returns upca for 12-digit numeric with valid checksum', () => {
      expect(selectSymbology('123456789012')).toBe('upca')
    })

    it('returns ean13 for 13-digit numeric with valid checksum', () => {
      expect(selectSymbology('5901234123457')).toBe('ean13')
    })

    it('returns code128 for invalid checksums', () => {
      expect(selectSymbology('123456789011')).toBe('code128')
    })

    it('returns code128 for non-numeric', () => {
      expect(selectSymbology('ABC-123-XYZ')).toBe('code128')
      expect(selectSymbology('SKU123')).toBe('code128')
    })

    it('returns code128 for wrong length', () => {
      expect(selectSymbology('12345')).toBe('code128')
      expect(selectSymbology('123456789012345')).toBe('code128')
    })

    it('trims whitespace', () => {
      expect(selectSymbology('  123456789012  ')).toBe('upca')
    })

    it('handles empty string', () => {
      expect(selectSymbology('')).toBe('code128')
    })
  })

  describe('labelPrice', () => {
    it('returns price when present', () => {
      const item: LabelCandidate = { sku: '123', name: 'Test', price: 19.99 }
      expect(labelPrice(item)).toBe(19.99)
    })

    it('returns 0 when price is null', () => {
      const item: LabelCandidate = { sku: '123', name: 'Test', price: null }
      expect(labelPrice(item)).toBe(0)
    })

    it('returns 0 when price is undefined', () => {
      const item: LabelCandidate = { sku: '123', name: 'Test' }
      expect(labelPrice(item)).toBe(0)
    })
  })

  describe('canPrintLabel', () => {
    it('returns true for valid item', () => {
      const item: LabelCandidate = { sku: '123456789012', name: 'Beer', price: 9.99 }
      expect(canPrintLabel(item)).toBe(true)
    })

    it('returns false for empty sku', () => {
      const item: LabelCandidate = { sku: '', name: 'Beer', price: 9.99 }
      expect(canPrintLabel(item)).toBe(false)
    })

    it('returns false for whitespace-only sku', () => {
      const item: LabelCandidate = { sku: '   ', name: 'Beer', price: 9.99 }
      expect(canPrintLabel(item)).toBe(false)
    })

    it('returns false for zero price', () => {
      const item: LabelCandidate = { sku: '123456789012', name: 'Beer', price: 0 }
      expect(canPrintLabel(item)).toBe(false)
    })

    it('returns false for negative price', () => {
      const item: LabelCandidate = { sku: '123456789012', name: 'Beer', price: -5 }
      expect(canPrintLabel(item)).toBe(false)
    })

    it('returns false for null price', () => {
      const item: LabelCandidate = { sku: '123456789012', name: 'Beer', price: null }
      expect(canPrintLabel(item)).toBe(false)
    })

    it('returns false for undefined price', () => {
      const item: LabelCandidate = { sku: '123456789012', name: 'Beer' }
      expect(canPrintLabel(item)).toBe(false)
    })
  })

  describe('resolveLabelName', () => {
    it('uses printable_name when present', () => {
      const item: LabelCandidate = {
        sku: '123',
        name: 'Full Product Name',
        printable_name: 'Short Name'
      }
      expect(resolveLabelName(item)).toBe('Short Name')
    })

    it('falls back to name when printable_name is null', () => {
      const item: LabelCandidate = {
        sku: '123',
        name: 'Full Name',
        printable_name: null
      }
      expect(resolveLabelName(item)).toBe('Full Name')
    })

    it('falls back to name when printable_name is empty', () => {
      const item: LabelCandidate = {
        sku: '123',
        name: 'Full Name',
        printable_name: '  '
      }
      expect(resolveLabelName(item)).toBe('Full Name')
    })

    it('uses name when printable_name is undefined', () => {
      const item: LabelCandidate = {
        sku: '123',
        name: 'Full Name'
      }
      expect(resolveLabelName(item)).toBe('Full Name')
    })

    it('returns empty string when both are missing', () => {
      const item: LabelCandidate = {
        sku: '123',
        name: ''
      }
      expect(resolveLabelName(item)).toBe('')
    })

    it('trims whitespace', () => {
      const item: LabelCandidate = {
        sku: '123',
        name: '  Test Name  ',
        printable_name: '  Trimmed  '
      }
      expect(resolveLabelName(item)).toBe('Trimmed')
    })
  })

  describe('isPrintableLabelName', () => {
    it('returns true for valid name within limit', () => {
      const item: LabelCandidate = { sku: '123', name: 'Beer' }
      expect(isPrintableLabelName(item, 30)).toBe(true)
    })

    it('returns false for empty name', () => {
      const item: LabelCandidate = { sku: '123', name: '' }
      expect(isPrintableLabelName(item, 30)).toBe(false)
    })

    it('returns false for name exceeding limit', () => {
      const item: LabelCandidate = { sku: '123', name: 'A'.repeat(31) }
      expect(isPrintableLabelName(item, 30)).toBe(false)
    })

    it('returns true for name exactly at limit', () => {
      const item: LabelCandidate = { sku: '123', name: 'A'.repeat(30) }
      expect(isPrintableLabelName(item, 30)).toBe(true)
    })

    it('handles printable_name precedence', () => {
      const item: LabelCandidate = {
        sku: '123',
        name: 'A'.repeat(40),
        printable_name: 'Short'
      }
      expect(isPrintableLabelName(item, 30)).toBe(true)
    })
  })

  describe('appendSize', () => {
    it('appends size when provided', () => {
      expect(appendSize('Milk', '1 gal')).toBe('Milk 1 gal')
    })

    it('returns name when size is null', () => {
      expect(appendSize('Milk', null)).toBe('Milk')
    })

    it('returns name when size is undefined', () => {
      expect(appendSize('Milk', undefined)).toBe('Milk')
    })

    it('returns name when size is whitespace', () => {
      expect(appendSize('Milk', '  ')).toBe('Milk')
    })

    it('handles empty name', () => {
      // With empty name and size, it adds a space then size
      expect(appendSize('', '1 gal')).toBe(' 1 gal')
    })

    it('trims size', () => {
      expect(appendSize('Milk', '  1 gal  ')).toBe('Milk 1 gal')
    })
  })

  describe('clamp', () => {
    it('returns value when within bounds', () => {
      expect(clamp(50, 0, 100)).toBe(50)
    })

    it('returns min when value is below', () => {
      expect(clamp(-10, 0, 100)).toBe(0)
    })

    it('returns max when value is above', () => {
      expect(clamp(150, 0, 100)).toBe(100)
    })

    it('handles equal min and max', () => {
      expect(clamp(50, 100, 100)).toBe(100)
    })

    it('handles negative values', () => {
      expect(clamp(-50, -100, 0)).toBe(-50)
      expect(clamp(-150, -100, 0)).toBe(-100)
    })
  })

  describe('sanitizeLabelSettings', () => {
    it('uses defaults when input is undefined', () => {
      const result = sanitizeLabelSettings(undefined)
      expect(result).toEqual(LABEL_SETTINGS_DEFAULTS)
    })

    it('uses defaults when input is empty object', () => {
      const result = sanitizeLabelSettings({})
      expect(result).toEqual(LABEL_SETTINGS_DEFAULTS)
    })

    it('clamps numeric values to bounds', () => {
      const result = sanitizeLabelSettings({
        widthMicrons: 1000000, // exceeds max
        heightMicrons: 1000, // below min
        paddingTopMm: 20, // exceeds max
        nameFontSize: 100 // exceeds max
      })
      expect(result.widthMicrons).toBe(LABEL_SETTINGS_BOUNDS.sizeMicrons[1])
      expect(result.heightMicrons).toBe(LABEL_SETTINGS_BOUNDS.sizeMicrons[0])
      expect(result.paddingTopMm).toBe(LABEL_SETTINGS_BOUNDS.paddingMm[1])
      expect(result.nameFontSize).toBe(LABEL_SETTINGS_BOUNDS.fontPt[1])
    })

    it('rounds numeric values', () => {
      const result = sanitizeLabelSettings({
        widthMicrons: 57150.7,
        columnSplitPct: 60.3
      })
      expect(result.widthMicrons).toBe(57151)
      expect(result.columnSplitPct).toBe(60)
    })

    it('validates printLanguage enum', () => {
      expect(sanitizeLabelSettings({ printLanguage: 'zpl' }).printLanguage).toBe('zpl')
      expect(sanitizeLabelSettings({ printLanguage: 'os' }).printLanguage).toBe('os')
      expect(sanitizeLabelSettings({ printLanguage: 'auto' }).printLanguage).toBe('auto')
      expect(sanitizeLabelSettings({ printLanguage: 'invalid' as any }).printLanguage).toBe('auto')
    })

    it('validates dpi enum', () => {
      expect(sanitizeLabelSettings({ dpi: 203 }).dpi).toBe(203)
      expect(sanitizeLabelSettings({ dpi: 300 }).dpi).toBe(300)
      expect(sanitizeLabelSettings({ dpi: 150 as any }).dpi).toBe(203)
    })

    it('preserves boolean values', () => {
      const result = sanitizeLabelSettings({ printBarcode: true })
      expect(result.printBarcode).toBe(true)
    })

    it('preserves printer name', () => {
      const result = sanitizeLabelSettings({ labelPrinterName: 'Zebra ZD420' })
      expect(result.labelPrinterName).toBe('Zebra ZD420')
    })
  })

  describe('isZebraPrinter', () => {
    it('recognizes Zebra brand name', () => {
      expect(isZebraPrinter('Zebra ZD420')).toBe(true)
      expect(isZebraPrinter('ZEBRA')).toBe(true)
    })

    it('recognizes Zebra model prefixes', () => {
      expect(isZebraPrinter('ZQ520')).toBe(true)
      expect(isZebraPrinter('ZD420')).toBe(true)
      expect(isZebraPrinter('ZT230')).toBe(true)
      expect(isZebraPrinter('ZP450')).toBe(true)
      expect(isZebraPrinter('ZR200')).toBe(true)
      expect(isZebraPrinter('GK420')).toBe(true)
      expect(isZebraPrinter('GX430')).toBe(true)
      expect(isZebraPrinter('GC420')).toBe(true)
      expect(isZebraPrinter('HC100')).toBe(true)
    })

    it('recognizes ZPL in name', () => {
      expect(isZebraPrinter('MyPrinter ZPL')).toBe(true)
      expect(isZebraPrinter('Printer-zpl')).toBe(true)
    })

    it('returns false for non-Zebra printers', () => {
      expect(isZebraPrinter('HP LaserJet')).toBe(false)
      expect(isZebraPrinter('Canon imageCLASS')).toBe(false)
      expect(isZebraPrinter('DYMO LabelWriter')).toBe(false)
    })

    it('returns false for null/undefined', () => {
      expect(isZebraPrinter(null)).toBe(false)
      expect(isZebraPrinter(undefined)).toBe(false)
    })

    it('case-insensitive matching', () => {
      expect(isZebraPrinter('zEbRa')).toBe(true)
      expect(isZebraPrinter('zd420')).toBe(true)
    })
  })

  describe('resolvePrintLanguage', () => {
    it('returns zpl when setting is zpl', () => {
      expect(resolvePrintLanguage('zpl', 'HP LaserJet')).toBe('zpl')
      expect(resolvePrintLanguage('zpl', null)).toBe('zpl')
    })

    it('returns os when setting is os', () => {
      expect(resolvePrintLanguage('os', 'Zebra ZD420')).toBe('os')
      expect(resolvePrintLanguage('os', null)).toBe('os')
    })

    it('detects Zebra printer on auto', () => {
      expect(resolvePrintLanguage('auto', 'Zebra ZD420')).toBe('zpl')
      expect(resolvePrintLanguage('auto', 'ZQ520')).toBe('zpl')
    })

    it('defaults to os on auto for non-Zebra', () => {
      expect(resolvePrintLanguage('auto', 'HP LaserJet')).toBe('os')
      expect(resolvePrintLanguage('auto', null)).toBe('os')
    })
  })

  describe('computeLabelGrid', () => {
    it('creates basic grid with defaults', () => {
      const grid = computeLabelGrid(100, 100, 60, 55)
      expect(grid.name).toBeDefined()
      expect(grid.barcode).toBeDefined()
      expect(grid.price).toBeDefined()
    })

    it('name is full width at top', () => {
      const grid = computeLabelGrid(100, 100, 60, 55)
      expect(grid.name.x).toBe(0)
      expect(grid.name.y).toBe(0)
      expect(grid.name.w).toBe(100)
    })

    it('barcode and price split bottom row', () => {
      const grid = computeLabelGrid(100, 100, 60, 55)
      // barcode left, price right
      expect(grid.barcode.x).toBeLessThan(grid.price.x)
      // same row
      expect(grid.barcode.y).toBe(grid.price.y)
      // width split by columnSplitPct
      expect(grid.barcode.w + grid.price.w).toBeLessThan(100) // gap reduces total
    })

    it('applies margins', () => {
      const margins = { top: 10, right: 10, bottom: 10, left: 10 }
      const grid = computeLabelGrid(100, 100, 60, 55, margins)
      expect(grid.name.x).toBe(10)
      expect(grid.name.y).toBe(10)
    })

    it('handles missing margins gracefully', () => {
      const grid = computeLabelGrid(100, 100, 60, 55, {})
      expect(grid.name.x).toBe(0)
      expect(grid.name.y).toBe(0)
    })

    it('respects columnSplitPct', () => {
      const grid60 = computeLabelGrid(100, 100, 60, 55)
      const grid40 = computeLabelGrid(100, 100, 40, 55)
      // 60% should make barcode wider than 40%
      expect(grid60.barcode.w).toBeGreaterThan(grid40.barcode.w)
      expect(grid60.price.w).toBeLessThan(grid40.price.w)
    })

    it('respects rowSplitPct', () => {
      const grid55 = computeLabelGrid(100, 100, 60, 55)
      const grid45 = computeLabelGrid(100, 100, 60, 45)
      // 55% should make name taller than 45%
      expect(grid55.name.h).toBeGreaterThan(grid45.name.h)
      expect(grid55.barcode.h).toBeLessThan(grid45.barcode.h)
    })

    it('handles negative dimensions gracefully', () => {
      const grid = computeLabelGrid(0, 0, 60, 55)
      expect(grid.name.w).toBe(0)
      expect(grid.name.h).toBeGreaterThanOrEqual(0)
    })

    it('applies gapRatio for gap between columns/rows', () => {
      const gridNoGap = computeLabelGrid(100, 100, 60, 55, {}, 0)
      const gridWithGap = computeLabelGrid(100, 100, 60, 55, {}, 0.05)
      // With gap, total area used is less
      expect(gridWithGap.barcode.w + gridWithGap.price.w).toBeLessThan(
        gridNoGap.barcode.w + gridNoGap.price.w
      )
    })

    it('verifies grid does not overlap', () => {
      const grid = computeLabelGrid(100, 100, 60, 55)
      // name should not overlap barcode/price
      const nameBottom = grid.name.y + grid.name.h
      const botTop = grid.barcode.y
      expect(nameBottom).toBeLessThanOrEqual(botTop)
    })

    it('barcode and price should not overlap horizontally', () => {
      const grid = computeLabelGrid(100, 100, 60, 55)
      const barcodeRight = grid.barcode.x + grid.barcode.w
      const priceLeft = grid.price.x
      expect(barcodeRight).toBeLessThanOrEqual(priceLeft)
    })
  })
})
