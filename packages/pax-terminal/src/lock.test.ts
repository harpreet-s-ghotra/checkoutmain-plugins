import { describe, expect, it, vi } from 'vitest'
import { createTerminalLock, PaxTerminalBusyError } from './lock'

function deferred<T = void>(): { promise: Promise<T>; resolve: (v: T) => void } {
  let resolve!: (v: T) => void
  const promise = new Promise<T>((r) => {
    resolve = r
  })
  return { promise, resolve }
}

const tick = async (): Promise<void> => {
  for (let i = 0; i < 5; i++) await Promise.resolve()
}

describe('terminal lock', () => {
  it('is idle until a command runs, and idle again after', async () => {
    const lock = createTerminalLock()
    expect(lock.isBusy()).toBe(false)
    const gate = deferred()
    const run = lock.run('sale', 'reject-if-busy', () => gate.promise)
    await tick()
    expect(lock.isBusy()).toBe(true)
    expect(lock.describe()?.label).toBe('sale')
    gate.resolve()
    await run
    expect(lock.isBusy()).toBe(false)
    expect(lock.describe()).toBeNull()
  })

  it('refuses a transaction while another command is open', async () => {
    const lock = createTerminalLock()
    const gate = deferred()
    const first = lock.run('sale', 'reject-if-busy', () => gate.promise)
    await tick()
    const fn = vi.fn()
    await expect(lock.run('refund', 'reject-if-busy', fn)).rejects.toBeInstanceOf(
      PaxTerminalBusyError
    )
    await expect(lock.run('refund', 'reject-if-busy', fn)).rejects.toThrow(/busy with another sale/)
    expect(fn).not.toHaveBeenCalled()
    gate.resolve()
    await first
  })

  it('refuses a transaction while a follow-up is only queued', async () => {
    const lock = createTerminalLock()
    const gate = deferred()
    const first = lock.run('sale', 'reject-if-busy', () => gate.promise)
    const queued = lock.run('void', 'wait', async () => 'voided')
    gate.resolve()
    // The sale has settled but the void has not run yet — still busy.
    await expect(lock.run('sale', 'reject-if-busy', async () => 1)).rejects.toThrow(
      PaxTerminalBusyError
    )
    await first
    await expect(queued).resolves.toBe('voided')
  })

  it('runs waiting commands strictly one after another, in order', async () => {
    const lock = createTerminalLock()
    const order: string[] = []
    const gate = deferred()
    const a = lock.run('sale', 'wait', async () => {
      order.push('a:start')
      await gate.promise
      order.push('a:end')
    })
    const b = lock.run('void', 'wait', async () => {
      order.push('b')
    })
    await tick()
    expect(order).toEqual(['a:start'])
    gate.resolve()
    await Promise.all([a, b])
    expect(order).toEqual(['a:start', 'a:end', 'b'])
  })

  it('releases the terminal when a command throws', async () => {
    const lock = createTerminalLock()
    await expect(
      lock.run('sale', 'reject-if-busy', async () => {
        throw new Error('socket boom')
      })
    ).rejects.toThrow('socket boom')
    expect(lock.isBusy()).toBe(false)
    await expect(lock.run('sale', 'reject-if-busy', async () => 'ok')).resolves.toBe('ok')
  })

  it('cancels in-flight probes when a command starts, and only then', async () => {
    const lock = createTerminalLock()
    const cancel = vi.fn()
    const unregister = lock.registerProbe(cancel)
    expect(lock.probeCount()).toBe(1)

    await lock.run('sale', 'reject-if-busy', async () => {
      expect(cancel).toHaveBeenCalledTimes(1)
    })

    unregister()
    expect(lock.probeCount()).toBe(0)
    await lock.run('sale', 'reject-if-busy', async () => undefined)
    expect(cancel).toHaveBeenCalledTimes(1)
  })

  it('keeps two terminals apart', async () => {
    const a = createTerminalLock()
    const b = createTerminalLock()
    const gate = deferred()
    const sale = a.run('sale', 'reject-if-busy', () => gate.promise)
    await tick()
    expect(b.isBusy()).toBe(false)
    await expect(b.run('sale', 'reject-if-busy', async () => 'ok')).resolves.toBe('ok')
    gate.resolve()
    await sale
  })

  describe('background check', () => {
    it('runs only when the terminal is idle', async () => {
      const lock = createTerminalLock()
      let release!: () => void
      const sale = lock.run('sale', 'reject-if-busy', () => new Promise<void>((r) => (release = r)))
      await expect(lock.run('lookup check', 'background', async () => 1)).rejects.toThrow(/busy/)
      release()
      await sale
      await expect(lock.run('lookup check', 'background', async () => 1)).resolves.toBe(1)
    })

    it('makes a sale wait behind it instead of refusing it', async () => {
      const lock = createTerminalLock()
      const order: string[] = []
      let release!: () => void
      const check = lock.run('lookup check', 'background', async () => {
        await new Promise<void>((r) => (release = r))
        order.push('check')
      })
      await vi.waitFor(() => expect(lock.describe()?.label).toBe('lookup check'))
      const sale = lock.run('sale', 'reject-if-busy', async () => {
        order.push('sale')
      })
      // A second transaction while the first is queued is still refused.
      await expect(lock.run('sale', 'reject-if-busy', async () => 0)).rejects.toThrow(/busy/)
      release()
      await Promise.all([check, sale])
      expect(order).toEqual(['check', 'sale'])
    })
  })
})
