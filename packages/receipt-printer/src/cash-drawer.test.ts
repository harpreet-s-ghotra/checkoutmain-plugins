import { describe, it, expect, vi, beforeEach } from 'vitest'

const sent: { bytes: number[]; printer: string }[] = []
vi.mock('./transport', async (importOriginal) => {
  const real = await importOriginal<typeof import('./transport')>()
  return {
    ...real,
    printRawBytes: vi.fn(async (bytes: Buffer, printer: string) => {
      sent.push({ bytes: [...bytes], printer })
    })
  }
})

import { drawerKickBytes, openCashDrawer } from './cash-drawer'

describe('cash drawer', () => {
  beforeEach(() => {
    sent.length = 0
  })

  it('kicks a Star with BEL and everything else with ESC p', () => {
    expect([...drawerKickBytes('Star TSP654 (STR_T-001)')]).toEqual([0x07])
    expect([...drawerKickBytes('TSP100')]).toEqual([0x07])
    expect([...drawerKickBytes('EPSON TM-T20III Receipt')]).toEqual([0x1b, 0x70, 0x00, 0x19, 0xfa])
  })

  it('opens through the receipt printer', async () => {
    await openCashDrawer('Star TSP143IIIU')
    expect(sent).toEqual([{ bytes: [0x07], printer: 'Star TSP143IIIU' }])
  })

  it('says why when no receipt printer is set up', async () => {
    await expect(openCashDrawer(null)).rejects.toThrow(/Receipt printer not set up/)
    await expect(openCashDrawer('')).rejects.toThrow(/Receipt printer not set up/)
  })
})
