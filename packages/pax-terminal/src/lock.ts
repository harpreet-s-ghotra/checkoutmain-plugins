/**
 * One conversation with a PAX terminal at a time.
 *
 * The PAX is a single-connection POSLink device: it runs one transaction and
 * talks to one ECR socket. Without this, a status poll opens its own TCP
 * connection to port 10009 in the middle of charges, and a second
 * sale/refund/void can be sent while the first is still prompting.
 *
 * Every terminal command runs through `lock.run`:
 *
 * - A **transaction** (sale, standalone card credit) refuses to start while any
 *   other command is open — queuing it would prompt the customer for a second
 *   card as soon as the first finished, which is a double charge in waiting.
 * - A **follow-up** (void, refund against a reference) waits its turn instead,
 *   because it is always a deliberate reversal the cashier asked for.
 * - A **background check** (the daily sale-lookup check) runs only when the
 *   terminal is idle, and never makes a transaction refuse: a sale that arrives
 *   while one runs waits behind it (a second or so) instead.
 * - A **status probe** never waits and never overlaps: while a command is open
 *   it is skipped (the caller reports last-known status), and a probe that is
 *   mid-connect when a command starts is cancelled so it cannot hold a socket
 *   open alongside the transaction.
 */

/** Thrown when a card transaction is asked for while the terminal is in use. */
export class PaxTerminalBusyError extends Error {
  constructor(active: string) {
    super(
      `Card terminal is busy with another ${active} — finish or cancel it on the terminal, then try again`
    )
    this.name = 'PaxTerminalBusyError'
  }
}

export type PaxCommandPolicy = 'reject-if-busy' | 'wait' | 'background'

export type OpenCommand = { label: string; startedAt: number; background?: boolean }

export type TerminalLock = {
  /** True while a terminal command is running or queued. */
  isBusy(): boolean
  /** What is on the terminal right now, for logs. `null` when idle. */
  describe(): OpenCommand | null
  /** Run `fn` with exclusive use of the terminal; see the module comment for the policies. */
  run<T>(label: string, policy: PaxCommandPolicy, fn: () => Promise<T>): Promise<T>
  /**
   * Register an in-flight status probe. `cancel` is called if a terminal command
   * starts before the probe finishes. Returns the unregister function the probe
   * must call when it settles.
   */
  registerProbe(cancel: () => void): () => void
  /** Number of probes in flight (for tests). */
  probeCount(): number
}

/** One lock per physical terminal. Share it between everything that talks to that address. */
export function createTerminalLock(): TerminalLock {
  let active: OpenCommand | null = null
  let waiting = 0
  let tail: Promise<void> = Promise.resolve()
  const probes = new Set<() => void>()

  const isBusy = (): boolean => active !== null || waiting > 0

  return {
    isBusy,
    describe: () => (active ? { ...active } : null),
    async run<T>(label: string, policy: PaxCommandPolicy, fn: () => Promise<T>): Promise<T> {
      if (policy === 'background' && isBusy()) {
        throw new PaxTerminalBusyError(active?.label ?? 'transaction')
      }
      // Only a background check is open, with nothing queued: queue behind it.
      const behindBackground = active?.background === true && waiting === 0
      if (policy === 'reject-if-busy' && isBusy() && !behindBackground) {
        throw new PaxTerminalBusyError(active?.label ?? 'transaction')
      }

      const previous = tail
      let release!: () => void
      tail = new Promise<void>((resolve) => {
        release = resolve
      })

      waiting++
      try {
        await previous
      } finally {
        waiting--
      }

      active = { label, startedAt: Date.now(), background: policy === 'background' }
      // A probe still connecting must not hold a second socket open next to the
      // transaction we are about to start.
      for (const cancel of [...probes]) cancel()
      try {
        return await fn()
      } finally {
        active = null
        release()
      }
    },
    registerProbe(cancel: () => void): () => void {
      probes.add(cancel)
      return () => {
        probes.delete(cancel)
      }
    },
    probeCount: () => probes.size
  }
}
