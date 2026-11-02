import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { EventEmitter } from 'node:events'
import { existsSync, mkdtempSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

const dir = mkdtempSync(join(tmpdir(), 'raw-host-'))

/** A stand-in powershell.exe running the helper's protocol. */
class FakeHost extends EventEmitter {
  stdout = Object.assign(new EventEmitter(), { setEncoding: vi.fn() })
  stderr = Object.assign(new EventEmitter(), { setEncoding: vi.fn() })
  written: string[] = []
  rc = 0
  stdin = {
    write: (line: string, cb?: (err?: Error) => void): boolean => {
      this.written.push(line)
      cb?.()
      if (line !== 'QUIT\n')
        setTimeout(() => this.stdout.emit('data', `RAW-HOST-DONE ${this.rc}\n`), 0)
      return true
    }
  }
  kill = vi.fn()
  ready(): void {
    this.stdout.emit('data', 'RAW-HOST-READY\n')
  }
}

let host: FakeHost
const spawn = vi.fn(() => {
  host = new FakeHost()
  setTimeout(() => host.ready(), 0)
  return host
})
vi.mock('node:child_process', () => ({ spawn: (...a: unknown[]) => spawn(...(a as [])) }))

import { createRawPrinterHost } from './windows-raw-host'

describe('windows raw printer host', () => {
  let raw: ReturnType<typeof createRawPrinterHost>
  const log = { info: vi.fn(), warn: vi.fn() }

  beforeEach(() => {
    spawn.mockClear()
    raw = createRawPrinterHost({ dir, docName: 'Test "Doc"', log })
  })
  afterEach(() => raw.stop())

  it('starts PowerShell once and sends each job as base64 down the pipe', async () => {
    await raw.send('Star TSP143 (STR_T-001)', Buffer.from([0x07]))
    await raw.send('Star TSP143 (STR_T-001)', Buffer.from([0x07]))
    expect(spawn).toHaveBeenCalledTimes(1)
    const [name, bytes] = host.written[0].trim().split(' ')
    expect(Buffer.from(name, 'base64').toString()).toBe('Star TSP143 (STR_T-001)')
    expect([...Buffer.from(bytes, 'base64')]).toEqual([0x07])
    expect(host.written).toHaveLength(2)
  })

  it('writes the helper beside its DLL, with the document name quoted safely', async () => {
    await raw.send('P', Buffer.from([1]))
    const [cmd, args] = spawn.mock.calls[0] as unknown as [string, string[]]
    expect(cmd).toBe('powershell.exe')
    const script = args[args.indexOf('-File') + 1]
    expect(script).toBe(join(dir, 'raw-printer-host.ps1'))
    expect(args[args.length - 1]).toBe(join(dir, 'RawPrinterHost.dll'))
    expect(existsSync(script)).toBe(true)
    const text = readFileSync(script, 'utf-8')
    expect(text).toContain('DocName = "Test Doc"')
    expect(text).toContain("'RAW-HOST-READY'")
  })

  it('rejects when the printer write fails, so the caller can fall back', async () => {
    await raw.send('P', Buffer.from([1]))
    host.rc = 1801
    await expect(raw.send('P', Buffer.from([1]))).rejects.toThrow(/Win32 error 1801/)
  })

  it('rejects when the host exits before it is ready, and restarts next time', async () => {
    spawn.mockImplementationOnce(() => {
      host = new FakeHost()
      setTimeout(() => host.emit('exit', 1), 0)
      return host
    })
    await expect(raw.send('P', Buffer.from([1]))).rejects.toThrow(/exited during start/)
    await raw.send('P', Buffer.from([1]))
    expect(spawn).toHaveBeenCalledTimes(2)
  })

  it('warms the host ahead of the first job and stops it on quit', async () => {
    raw.warm()
    expect(spawn).toHaveBeenCalledTimes(1)
    await raw.send('P', Buffer.from([1]))
    expect(spawn).toHaveBeenCalledTimes(1)
    raw.stop()
    expect(host.written).toContain('QUIT\n')
    expect(host.kill).toHaveBeenCalled()
    expect(log.info).toHaveBeenCalledWith(expect.stringMatching(/raw printer host ready/))
  })
})
