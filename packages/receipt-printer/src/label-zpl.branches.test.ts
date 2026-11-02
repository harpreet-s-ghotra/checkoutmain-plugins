import { describe, it, expect } from 'vitest'
import { renderLabelZpl } from './label-zpl'
import { LABEL_SETTINGS_DEFAULTS } from './labels'
import type { LabelPrintItem, LabelSettings } from './types'

const SETTINGS: LabelSettings = { ...LABEL_SETTINGS_DEFAULTS, printBarcode: true }

const item = (over: Partial<LabelPrintItem>): LabelPrintItem => ({
  sku: '036000291452',
  name: 'Ginger Kombucha',
  size: '16 oz',
  price: 3.95,
  ...over
})

describe('label-zpl symbology and fitting branches', () => {
  it('uses the UPC-A command for a valid 12-digit code, dropping the check digit', () => {
    const zpl = renderLabelZpl(item({}), SETTINGS)
    expect(zpl).toContain('^BUN')
    expect(zpl).toContain('^FD03600029145^FS')
  })

  it('uses the EAN-13 command for a valid 13-digit code', () => {
    const zpl = renderLabelZpl(item({ sku: '4006381333931' }), SETTINGS)
    expect(zpl).toContain('^BEN')
    expect(zpl).toContain('^FD400638133393^FS')
  })

  it('falls back to Code 128 for anything else and neutralises ZPL prefixes', () => {
    const zpl = renderLabelZpl(item({ sku: 'AB^12~9', name: 'Odd ^ Name' }), SETTINGS)
    expect(zpl).toContain('^BCN')
    expect(zpl).toContain('^FDAB 12 9^FS')
    expect(zpl).not.toContain('Odd ^ Name')
    expect(zpl).toContain('Odd   Name')
  })

  it('shrinks the name font down to the floor for a very long name', () => {
    const short = renderLabelZpl(item({ name: 'Tea' }), LABEL_SETTINGS_DEFAULTS)
    const long = renderLabelZpl(item({ name: 'A'.repeat(200), size: '' }), LABEL_SETTINGS_DEFAULTS)
    const fontOf = (z: string): number => Number(z.match(/\^A0N,(\d+)/)?.[1] ?? 0)
    expect(fontOf(long)).toBeLessThan(fontOf(short))
    expect(fontOf(long)).toBeGreaterThanOrEqual(8)
  })

  it('clamps the barcode module width between 1 and 3 dots', () => {
    const wide: LabelSettings = { ...SETTINGS, widthMicrons: 200_000 }
    const narrow: LabelSettings = { ...SETTINGS, widthMicrons: 20_000 }
    expect(renderLabelZpl(item({}), wide)).toContain('^BY3')
    expect(renderLabelZpl(item({}), narrow)).toContain('^BY1')
  })

  it('omits the barcode when disabled', () => {
    const zpl = renderLabelZpl(item({}), { ...SETTINGS, printBarcode: false })
    expect(zpl).not.toContain('^BUN')
    expect(zpl).not.toContain('^BCN')
  })
})
