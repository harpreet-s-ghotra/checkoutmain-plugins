import { describe, it, expect, vi, beforeEach } from 'vitest'
import { isEpsonReceiptQueue, resetEpsonCache } from './epson'

describe('isEpsonReceiptQueue', () => {
  beforeEach(() => resetEpsonCache())

  it('answers from the queue name without asking the OS', async () => {
    const describe = vi.fn()
    expect(await isEpsonReceiptQueue('EPSON TM-T20III Receipt', describe)).toBe(true)
    expect(describe).not.toHaveBeenCalled()
  })

  it('asks the OS about a renamed queue once, and remembers the answer', async () => {
    const describe = vi.fn(async () => 'EPSON TM-T20IV Receipt usb://EPSON/TM-T20IV')
    expect(await isEpsonReceiptQueue('Front Counter', describe)).toBe(true)
    expect(await isEpsonReceiptQueue('Front Counter', describe)).toBe(true)
    expect(describe).toHaveBeenCalledTimes(1)
  })

  it('leaves a Star, an unknown device, or a failed lookup on the PDF path', async () => {
    expect(await isEpsonReceiptQueue('Counter', async () => 'Star TSP654 usb://Star/TSP654')).toBe(
      false
    )
    expect(await isEpsonReceiptQueue('Other', async () => null)).toBe(false)
    expect(
      await isEpsonReceiptQueue('Broken', async () => {
        throw new Error('no window')
      })
    ).toBe(false)
    expect(await isEpsonReceiptQueue('Nameless')).toBe(false)
    expect(await isEpsonReceiptQueue('')).toBe(false)
  })
})
