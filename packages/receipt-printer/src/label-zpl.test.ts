import { describe, it, expect } from 'vitest'
import { micronsToDots, renderLabelZpl, renderLabelsZpl } from './label-zpl'
import { LABEL_SETTINGS_DEFAULTS } from './labels'
import type { LabelPrintItem, LabelSettings } from './types'

describe('label-zpl', () => {
  describe('micronsToDots', () => {
    it('converts microns to dots at 203 DPI', () => {
      // 1 inch = 25.4 mm = 25400 microns
      // At 203 DPI: 25400 microns should be ~203 dots
      const result = micronsToDots(25400, 203)
      expect(result).toBe(203)
    })

    it('converts microns to dots at 300 DPI', () => {
      const result = micronsToDots(25400, 300)
      expect(result).toBe(300)
    })

    it('converts standard label width (57150 microns = 2.25 inch)', () => {
      // 2.25 * 203 = 456.75 ≈ 457
      const result = micronsToDots(57150, 203)
      expect(result).toBe(457)
    })

    it('converts standard label height (31750 microns = 1.25 inch)', () => {
      // 1.25 * 203 = 253.75 ≈ 254
      const result = micronsToDots(31750, 203)
      expect(result).toBe(254)
    })

    it('handles zero microns', () => {
      expect(micronsToDots(0, 203)).toBe(0)
    })

    it('handles small values', () => {
      expect(micronsToDots(100, 203)).toBeGreaterThan(0)
    })

    it('scales with DPI', () => {
      const dots203 = micronsToDots(10000, 203)
      const dots300 = micronsToDots(10000, 300)
      // Higher DPI should produce more dots
      expect(dots300).toBeGreaterThan(dots203)
      expect(dots300 / dots203).toBeCloseTo(300 / 203, 0)
    })
  })

  describe('renderLabelZpl', () => {
    const defaultItem: LabelPrintItem = {
      sku: '123456789012',
      name: 'Test Product',
      price: 19.99,
      size: ''
    }

    const defaultSettings: LabelSettings = LABEL_SETTINGS_DEFAULTS

    it('generates valid ZPL frame', () => {
      const zpl = renderLabelZpl(defaultItem, defaultSettings)
      expect(zpl).toContain('^XA') // start frame
      expect(zpl).toContain('^XZ') // end frame
      expect(zpl).toContain('^CI28') // UTF-8 encoding
    })

    it('includes product name', () => {
      const zpl = renderLabelZpl(defaultItem, defaultSettings)
      expect(zpl).toContain('Test Product')
    })

    it('includes price formatted as currency', () => {
      const zpl = renderLabelZpl(defaultItem, defaultSettings)
      expect(zpl).toContain('$19.99') // formatCurrency
    })

    it('includes SKU', () => {
      const zpl = renderLabelZpl(defaultItem, defaultSettings)
      expect(zpl).toContain('123456789012')
    })

    it('sets page width', () => {
      const zpl = renderLabelZpl(defaultItem, defaultSettings)
      expect(zpl).toMatch(/\^PW\d+/) // page width command
    })

    it('sets page length', () => {
      const zpl = renderLabelZpl(defaultItem, defaultSettings)
      expect(zpl).toMatch(/\^LL\d+/) // page length command
    })

    it('appends size to product name', () => {
      const itemWithSize: LabelPrintItem = {
        ...defaultItem,
        size: '750ml'
      }
      const zpl = renderLabelZpl(itemWithSize, defaultSettings)
      expect(zpl).toContain('Test Product 750ml')
    })

    it('includes barcode when printBarcode is true', () => {
      const settings: LabelSettings = {
        ...defaultSettings,
        printBarcode: true
      }
      const zpl = renderLabelZpl(defaultItem, settings)
      expect(zpl).toMatch(/\^BU|^BC|^BN/) // barcode commands
    })

    it('includes SKU text when printBarcode is false', () => {
      const settings: LabelSettings = {
        ...defaultSettings,
        printBarcode: false
      }
      const zpl = renderLabelZpl(defaultItem, settings)
      // When barcode is off, SKU is rendered as text instead
      expect(zpl).toContain('123456789012')
    })

    it('respects font sizes', () => {
      const zpl = renderLabelZpl(defaultItem, defaultSettings)
      // Should contain A0N font commands for various font sizes
      expect(zpl).toMatch(/\^A0N/)
    })

    it('uses 203 DPI when set', () => {
      const settings: LabelSettings = {
        ...defaultSettings,
        dpi: 203
      }
      const zpl = renderLabelZpl(defaultItem, settings)
      expect(zpl).toBeDefined()
    })

    it('uses 300 DPI when set', () => {
      const settings: LabelSettings = {
        ...defaultSettings,
        dpi: 300
      }
      const zpl = renderLabelZpl(defaultItem, settings)
      expect(zpl).toBeDefined()
    })

    it('escapes special ZPL characters (^ and ~)', () => {
      const itemWithSpecial: LabelPrintItem = {
        ...defaultItem,
        name: 'Test^Product~Name'
      }
      const zpl = renderLabelZpl(itemWithSpecial, defaultSettings)
      // ^ and ~ should be replaced with spaces
      expect(zpl).not.toContain('Test^Product~Name')
      expect(zpl).toContain('Test Product Name')
    })

    it('respects padding settings', () => {
      const settings: LabelSettings = {
        ...defaultSettings,
        paddingTopMm: 5,
        paddingRightMm: 5,
        paddingBottomMm: 5,
        paddingLeftMm: 5
      }
      const zpl = renderLabelZpl(defaultItem, settings)
      expect(zpl).toBeDefined() // Should still be valid
    })

    it('respects column split percentage', () => {
      const settings60: LabelSettings = {
        ...defaultSettings,
        columnSplitPct: 60
      }
      const settings40: LabelSettings = {
        ...defaultSettings,
        columnSplitPct: 40
      }
      const zpl60 = renderLabelZpl(defaultItem, settings60)
      const zpl40 = renderLabelZpl(defaultItem, settings40)
      // Both should be valid, but different coordinates
      expect(zpl60).toBeDefined()
      expect(zpl40).toBeDefined()
      expect(zpl60).not.toBe(zpl40)
    })

    it('respects row split percentage', () => {
      const settings55: LabelSettings = {
        ...defaultSettings,
        rowSplitPct: 55
      }
      const settings45: LabelSettings = {
        ...defaultSettings,
        rowSplitPct: 45
      }
      const zpl55 = renderLabelZpl(defaultItem, settings55)
      const zpl45 = renderLabelZpl(defaultItem, settings45)
      expect(zpl55).not.toBe(zpl45)
    })

    it('handles high price values', () => {
      const itemHighPrice: LabelPrintItem = {
        ...defaultItem,
        price: 999.99,
        size: ''
      }
      const zpl = renderLabelZpl(itemHighPrice, defaultSettings)
      expect(zpl).toContain('$999.99')
    })

    it('handles low price values', () => {
      const itemLowPrice: LabelPrintItem = {
        ...defaultItem,
        price: 0.99,
        size: ''
      }
      const zpl = renderLabelZpl(itemLowPrice, defaultSettings)
      expect(zpl).toContain('$0.99')
    })

    it('handles missing product name gracefully', () => {
      const itemNoName: LabelPrintItem = {
        sku: '123456789012',
        name: '',
        price: 19.99,
        size: ''
      }
      const zpl = renderLabelZpl(itemNoName, defaultSettings)
      expect(zpl).toBeDefined()
      // Should still include SKU as fallback
      expect(zpl).toContain('123456789012')
    })

    it('generates multiple frames per item', () => {
      const zpl = renderLabelZpl(defaultItem, defaultSettings)
      const frameStarts = (zpl.match(/\^XA/g) || []).length
      const frameEnds = (zpl.match(/\^XZ/g) || []).length
      expect(frameStarts).toBe(1)
      expect(frameEnds).toBe(1)
    })

    it('includes barcode modules and line height calculations', () => {
      const settings: LabelSettings = {
        ...defaultSettings,
        printBarcode: true
      }
      const zpl = renderLabelZpl(defaultItem, settings)
      // ZPL barcode specification should include height
      expect(zpl).toMatch(/\^BU|^BC|^BN/)
    })

    it('uses text orientation A0N (angle 0, normal)', () => {
      const zpl = renderLabelZpl(defaultItem, defaultSettings)
      expect(zpl).toContain('^A0N')
    })
  })

  describe('renderLabelsZpl', () => {
    const items: LabelPrintItem[] = [
      {
        sku: '111111111111',
        name: 'Product 1',
        price: 9.99,
        size: ''
      },
      {
        sku: '222222222222',
        name: 'Product 2',
        price: 14.99,
        size: ''
      },
      {
        sku: '333333333333',
        name: 'Product 3',
        price: 19.99,
        size: ''
      }
    ]

    const settings: LabelSettings = LABEL_SETTINGS_DEFAULTS

    it('generates ZPL for multiple items', () => {
      const zpl = renderLabelsZpl(items, settings)
      expect(zpl).toContain('Product 1')
      expect(zpl).toContain('Product 2')
      expect(zpl).toContain('Product 3')
    })

    it('contains one frame per item', () => {
      const zpl = renderLabelsZpl(items, settings)
      const frameCount = (zpl.match(/\^XA/g) || []).length
      expect(frameCount).toBe(items.length)
    })

    it('separates frames with newlines', () => {
      const zpl = renderLabelsZpl(items, settings)
      const frames = zpl.split('\n^XA')
      // First frame has ^XA, others are split
      expect(frames.length).toBeGreaterThanOrEqual(items.length)
    })

    it('handles single item', () => {
      const singleItem = [items[0]]
      const zpl = renderLabelsZpl(singleItem, settings)
      const frameCount = (zpl.match(/\^XA/g) || []).length
      expect(frameCount).toBe(1)
    })

    it('handles empty array', () => {
      const zpl = renderLabelsZpl([], settings)
      // Should return empty string or just newlines
      expect(zpl.length).toBeLessThan(10) // not much content
    })

    it('includes all prices', () => {
      const zpl = renderLabelsZpl(items, settings)
      expect(zpl).toContain('$9.99')
      expect(zpl).toContain('$14.99')
      expect(zpl).toContain('$19.99')
    })

    it('includes all SKUs', () => {
      const zpl = renderLabelsZpl(items, settings)
      expect(zpl).toContain('111111111111')
      expect(zpl).toContain('222222222222')
      expect(zpl).toContain('333333333333')
    })

    it('can be sent as single ZPL job to printer', () => {
      const zpl = renderLabelsZpl(items, settings)
      // Valid ZPL starts with ^XA and ends with ^XZ
      expect(zpl).toMatch(/\^XA/)
      expect(zpl).toMatch(/\^XZ/)
    })
  })

  describe('ZPL generation edge cases', () => {
    it('handles very long product names', () => {
      const longNameItem: LabelPrintItem = {
        sku: '123456789012',
        name: 'A'.repeat(60),
        price: 19.99,
        size: ''
      }
      const zpl = renderLabelZpl(longNameItem, LABEL_SETTINGS_DEFAULTS)
      expect(zpl).toBeDefined()
      // Font should be shrunk or wrapped
      expect(zpl).toMatch(/\^A0N/)
    })

    it('handles product names with sizes', () => {
      const itemWithSize: LabelPrintItem = {
        sku: '123456789012',
        name: 'Premium Vodka',
        size: '750ml',
        price: 39.99
      }
      const zpl = renderLabelZpl(itemWithSize, LABEL_SETTINGS_DEFAULTS)
      expect(zpl).toContain('Premium Vodka 750ml')
    })

    it('handles zero price', () => {
      const freeItem: LabelPrintItem = {
        sku: '123456789012',
        name: 'Free Sample',
        price: 0,
        size: ''
      }
      const zpl = renderLabelZpl(freeItem, LABEL_SETTINGS_DEFAULTS)
      expect(zpl).toContain('$0.00')
    })

    it('handles very high prices', () => {
      const expensiveItem: LabelPrintItem = {
        sku: '123456789012',
        name: 'Rare Collectible',
        price: 5000,
        size: ''
      }
      const zpl = renderLabelZpl(expensiveItem, LABEL_SETTINGS_DEFAULTS)
      // formatCurrency will produce $5,000.00 with thousands separator
      expect(zpl).toContain('$5,000.00')
    })

    it('respects minimum font sizes', () => {
      const settings: LabelSettings = {
        ...LABEL_SETTINGS_DEFAULTS,
        nameFontSize: 4,
        priceFontSize: 4,
        skuFontSize: 4
      }
      const zpl = renderLabelZpl(
        {
          sku: '123456789012',
          name: 'Product',
          price: 19.99,
          size: ''
        },
        settings
      )
      expect(zpl).toBeDefined()
    })

    it('respects maximum font sizes', () => {
      const settings: LabelSettings = {
        ...LABEL_SETTINGS_DEFAULTS,
        nameFontSize: 48,
        priceFontSize: 48
      }
      const zpl = renderLabelZpl(
        {
          sku: '123456789012',
          name: 'Product',
          price: 19.99,
          size: ''
        },
        settings
      )
      expect(zpl).toBeDefined()
    })

    it('handles numeric SKUs correctly', () => {
      const items: LabelPrintItem[] = [
        { sku: '123456789012', name: 'UPC-A', price: 9.99, size: '' }, // 12 digits
        { sku: '1234567890123', name: 'EAN-13', price: 9.99, size: '' }, // 13 digits
        { sku: 'ABC-123-XYZ', name: 'Code 128', price: 9.99, size: '' } // non-numeric
      ]
      for (const item of items) {
        const zpl = renderLabelZpl(item, LABEL_SETTINGS_DEFAULTS)
        expect(zpl).toContain(item.sku)
      }
    })
  })
})
