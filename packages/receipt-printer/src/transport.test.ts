/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { existsSync, mkdtempSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { execFile } from 'node:child_process'

vi.mock('node:child_process', () => ({ execFile: vi.fn() }))

import { printPdfFile, printRawFile, printRawBytes } from './transport'

const setPlatform = (value: string): void => {
  Object.defineProperty(process, 'platform', { value, configurable: true })
}

describe('print dispatch by platform', () => {
  const realPlatform = process.platform
  let dir: string
  let file: string
  let exec: ReturnType<typeof vi.mocked<typeof execFile>>

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'cm-print-'))
    file = join(dir, 'job.bin')
    writeFileSync(file, 'data')
    exec = vi.mocked(execFile)
    exec.mockReset()
  })

  afterEach(() => {
    setPlatform(realPlatform)
  })

  const replyWith = (err: Error | null, stderr = ''): void => {
    exec.mockImplementation(((...args: unknown[]) => {
      const cb = args.find((a) => typeof a === 'function') as (
        e: Error | null,
        out: string,
        errOut: string
      ) => void
      cb(err, '', stderr)
      return undefined as never
    }) as any)
  }

  it('refuses to print without a printer name', async () => {
    await expect(printPdfFile(file, '')).rejects.toThrow(/No printer selected/)
    await expect(printRawFile(file, '')).rejects.toThrow(/No printer selected/)
  })

  it('prints a PDF through lp on Unix with extra lp options, then removes the file', async () => {
    setPlatform('darwin')
    replyWith(null)
    await printPdfFile(file, 'Epson', { lpOptions: ['-o', 'media=Custom.80x200mm'] })
    expect(exec).toHaveBeenCalledWith(
      'lp',
      ['-d', 'Epson', '-o', 'media=Custom.80x200mm', file],
      expect.any(Function)
    )
    expect(existsSync(file)).toBe(false)
  })

  it('wraps an lp failure and still removes the file', async () => {
    setPlatform('linux')
    replyWith(new Error('lp: The printer is not connected'))
    await expect(printPdfFile(file, 'Epson')).rejects.toThrow(
      'Print failed: lp: The printer is not connected'
    )
    expect(existsSync(file)).toBe(false)
  })

  it('on Windows a PDF goes through pdf-to-printer and its failure is wrapped', async () => {
    setPlatform('win32')
    // No SumatraPDF on this machine: the driver call rejects and the wrapper reports it.
    await expect(printPdfFile(file, 'Epson', { orientation: 'landscape' })).rejects.toThrow(
      /^Print failed: /
    )
    expect(exec).not.toHaveBeenCalled()
    expect(existsSync(file)).toBe(false)
  })

  it('sends raw bytes through lp -o raw on Unix', async () => {
    setPlatform('darwin')
    replyWith(null)
    await printRawFile(file, 'Zebra')
    expect(exec).toHaveBeenCalledWith(
      'lp',
      ['-d', 'Zebra', '-o', 'raw', file],
      expect.any(Function)
    )
    expect(existsSync(file)).toBe(false)
  })

  it('sends raw bytes through the PowerShell spooler shim on Windows', async () => {
    setPlatform('win32')
    replyWith(null)
    await printRawFile(file, 'Zebra ZD420')
    const [cmd, args] = exec.mock.calls[0] as unknown as [string, string[]]
    expect(cmd).toBe('powershell.exe')
    expect(args).toEqual(
      expect.arrayContaining(['-File', '-Printer', 'Zebra ZD420', '-Path', file, '-AsmPath'])
    )
    const script = args[args.indexOf('-File') + 1]
    expect(existsSync(script)).toBe(true)

    // The script path is cached for later jobs.
    writeFileSync(file, 'again')
    replyWith(null)
    await printRawFile(file, 'Zebra ZD420')
    const [, args2] = exec.mock.calls[1] as unknown as [string, string[]]
    expect(args2[args2.indexOf('-File') + 1]).toBe(script)
  })

  it('prefers the warm host on Windows and falls back to the spawn when it fails', async () => {
    setPlatform('win32')
    const send = vi.fn(async () => undefined)
    await printRawFile(file, 'Star', { host: { send, warm: vi.fn(), stop: vi.fn() } })
    expect(send).toHaveBeenCalledWith('Star', Buffer.from('data'))
    expect(exec).not.toHaveBeenCalled()
    expect(existsSync(file)).toBe(false)

    writeFileSync(file, 'again')
    const warn = vi.fn()
    replyWith(null)
    await printRawFile(file, 'Star', {
      host: {
        send: vi.fn(async () => {
          throw new Error('host down')
        }),
        warm: vi.fn(),
        stop: vi.fn()
      },
      log: { warn }
    })
    expect(warn).toHaveBeenCalledWith(expect.stringMatching(/host down/))
    expect(exec).toHaveBeenCalledTimes(1)
  })

  it('prefers PowerShell stderr over the generic error and falls back to the message', async () => {
    setPlatform('win32')
    replyWith(new Error('exit 1'), 'OpenPrinter failed for Zebra\n')
    await expect(printRawFile(file, 'Zebra')).rejects.toThrow(
      'Print failed: OpenPrinter failed for Zebra'
    )
    writeFileSync(file, 'again')
    replyWith(new Error('exit 1'), '')
    await expect(printRawFile(file, 'Zebra')).rejects.toThrow('Print failed: exit 1')
  })

  it('printRawBytes writes a scratch file, sends it and cleans up', async () => {
    setPlatform('darwin')
    replyWith(null)
    await printRawBytes(Buffer.from([0x07]), 'Star', { prefix: 'drawer', tmpDir: dir })
    const [, args] = exec.mock.calls[0] as unknown as [string, string[]]
    expect(args[args.length - 1]).toMatch(/drawer-\d+\.bin$/)
    expect(existsSync(args[args.length - 1])).toBe(false)
  })
})
