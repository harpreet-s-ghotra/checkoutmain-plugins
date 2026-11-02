/**
 * Long-lived PowerShell host for raw printer writes on Windows.
 *
 * A drawer kick, an ESC/POS receipt or a ZPL label reaches the printer by
 * pushing bytes through a C# shim over WINSPOOL's RAW datatype. That shim is
 * cheap; *reaching* it is not. Spawning `powershell.exe` pays CLR startup,
 * assembly load and (usually) an antivirus scan every time — measured at a
 * store in July 2026 as a floor of **2.6 seconds per kick**, on every cash
 * sale, with the compiled DLL already cached:
 *
 *     12:25  drawer opened via=usb:win32 ms=2665
 *     12:34  drawer opened via=usb:win32 ms=2652
 *     18:51  drawer opened via=usb:win32 ms=3085
 *
 * There was no first-run penalty and no fast case, which is what rules out the
 * compile: the cost is the process, not the work.
 *
 * So the process is started once and kept. The first job of the day still pays
 * startup; every later one is a line of text down a pipe.
 *
 * The helper runs from a generated .ps1 rather than `-Command -`, because
 * PowerShell's stdin mode executes line by line and the C# source is a
 * multi-line here-string. A file also keeps the per-job protocol to one line.
 *
 * Every failure path rejects so the caller can fall back to a one-shot spawn
 * (`printRawFile` does): a warm host is an optimisation, never a new way for
 * the drawer to stop working.
 */
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { resolveLogger } from './log'
import type { PrinterLogger } from './types'

/** Beyond this a job is treated as lost and the host is recycled. */
const OP_TIMEOUT_MS = 8_000
/** Startup includes CLR init and a possible compile on a cold machine. */
const READY_TIMEOUT_MS = 30_000

export const RAW_HOST_READY = 'RAW-HOST-READY'
export const RAW_HOST_DONE = 'RAW-HOST-DONE'

export type RawPrinterHostOptions = {
  /** A writable directory the helper script and its compiled DLL live in (Electron: `app.getPath('userData')`). */
  dir: string
  /** The document name the spooler shows. */
  docName?: string
  log?: Partial<PrinterLogger>
}

export type RawPrinterHost = {
  /**
   * Write raw bytes to a Windows printer through the warm host. Rejects on any
   * failure so the caller can fall back to a one-shot spawn.
   */
  send(printerName: string, bytes: Buffer): Promise<void>
  /**
   * Start the host ahead of the first job (app launch), so the first cash sale
   * of the day does not pay PowerShell's startup either. Errors are ignored:
   * the first job retries, and falls back.
   */
  warm(): void
  /** Stop the host (app quit). Safe to call when it was never started. */
  stop(): void
}

/**
 * The helper script. Regenerated on every host start so it can never drift from
 * this file, and so a partially written copy repairs itself.
 *
 * Both operands of the per-job line are base64, which removes PowerShell
 * quoting from the protocol entirely — printer names contain spaces and
 * apostrophes, and escaping them through two languages is where this would
 * otherwise break.
 */
export function rawPrinterHostScript(docName: string): string {
  const safeDoc = docName.replace(/["\\]/g, '')
  return `
$ErrorActionPreference = 'Stop'
$dll = $args[0]
$code = @"
using System;
using System.Runtime.InteropServices;
public class RawPrinterHost {
  [StructLayout(LayoutKind.Sequential, CharSet=CharSet.Unicode)]
  public class DOCINFO { public string DocName; public string OutputFile; public string DataType; }
  [DllImport("winspool.Drv", SetLastError=true, CharSet=CharSet.Unicode)] public static extern bool OpenPrinter(string p, out IntPtr h, IntPtr d);
  [DllImport("winspool.Drv", SetLastError=true)] public static extern bool ClosePrinter(IntPtr h);
  [DllImport("winspool.Drv", SetLastError=true, CharSet=CharSet.Unicode)] public static extern bool StartDocPrinter(IntPtr h, int level, [In, MarshalAs(UnmanagedType.LPStruct)] DOCINFO di);
  [DllImport("winspool.Drv", SetLastError=true)] public static extern bool EndDocPrinter(IntPtr h);
  [DllImport("winspool.Drv", SetLastError=true)] public static extern bool StartPagePrinter(IntPtr h);
  [DllImport("winspool.Drv", SetLastError=true)] public static extern bool EndPagePrinter(IntPtr h);
  [DllImport("winspool.Drv", SetLastError=true)] public static extern bool WritePrinter(IntPtr h, byte[] b, int cnt, out int written);
  public static int Send(string printer, byte[] bytes) {
    IntPtr h;
    if (!OpenPrinter(printer, out h, IntPtr.Zero)) return Marshal.GetLastWin32Error();
    var di = new DOCINFO{ DocName = "${safeDoc}", DataType = "RAW" };
    int written = 0;
    bool ok = StartDocPrinter(h, 1, di) && StartPagePrinter(h) && WritePrinter(h, bytes, bytes.Length, out written);
    int err = ok ? 0 : Marshal.GetLastWin32Error();
    EndPagePrinter(h); EndDocPrinter(h); ClosePrinter(h);
    return err;
  }
}
"@

$loaded = $false
if (Test-Path $dll) {
  try { Add-Type -Path $dll; $loaded = $true } catch { $loaded = $false }
}
if (-not $loaded) {
  $tmp = [System.IO.Path]::Combine([System.IO.Path]::GetDirectoryName($dll), [System.IO.Path]::GetRandomFileName() + '.dll')
  try {
    Add-Type -TypeDefinition $code -OutputAssembly $tmp
    Move-Item -LiteralPath $tmp -Destination $dll -Force
    Add-Type -Path $dll
  } catch {
    if (Test-Path $tmp) { Remove-Item -LiteralPath $tmp -Force -ErrorAction SilentlyContinue }
    Add-Type -TypeDefinition $code
  }
}

[Console]::Out.WriteLine('${RAW_HOST_READY}')
[Console]::Out.Flush()

while ($true) {
  $line = [Console]::In.ReadLine()
  if ($null -eq $line -or $line -eq 'QUIT') { break }
  $rc = -1
  try {
    $parts = $line.Split(' ')
    $printer = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($parts[0]))
    $bytes = [Convert]::FromBase64String($parts[1])
    $rc = [RawPrinterHost]::Send($printer, $bytes)
  } catch {
    $rc = -1
  }
  [Console]::Out.WriteLine('${RAW_HOST_DONE} ' + $rc)
  [Console]::Out.Flush()
}
`
}

export function createRawPrinterHost(options: RawPrinterHostOptions): RawPrinterHost {
  const log = resolveLogger(options.log)
  const docName = options.docName ?? 'Receipt'
  const scriptPath = join(options.dir, 'raw-printer-host.ps1')
  const dllPath = join(options.dir, 'RawPrinterHost.dll')

  let child: ChildProcessWithoutNullStreams | null = null
  let ready: Promise<void> | null = null
  let pending: ((line: string) => void) | null = null
  /** One job at a time — the helper is a single request/response loop. */
  let chain: Promise<unknown> = Promise.resolve()

  function teardown(reason: string): void {
    if (pending) {
      const notify = pending
      pending = null
      notify(`${RAW_HOST_DONE} -1 (${reason})`)
    }
    if (child) {
      child.removeAllListeners()
      child.kill()
      child = null
    }
    ready = null
  }

  function start(): Promise<void> {
    if (ready) return ready

    ready = new Promise<void>((resolve, reject) => {
      try {
        writeFileSync(scriptPath, rawPrinterHostScript(docName), 'utf-8')
      } catch (err) {
        reject(new Error(`raw printer helper unwritable: ${(err as Error).message}`))
        return
      }

      const proc = spawn(
        'powershell.exe',
        [
          '-NoProfile',
          '-NonInteractive',
          '-ExecutionPolicy',
          'Bypass',
          '-File',
          scriptPath,
          dllPath
        ],
        { windowsHide: true }
      )
      child = proc

      let buffer = ''
      let started = false
      const timer = setTimeout(() => {
        if (!started) {
          teardown('start timeout')
          reject(new Error('raw printer host did not start'))
        }
      }, READY_TIMEOUT_MS)

      proc.stdout.setEncoding('utf-8')
      proc.stdout.on('data', (chunk: string) => {
        buffer += chunk
        let idx: number
        while ((idx = buffer.indexOf('\n')) >= 0) {
          const line = buffer.slice(0, idx).trim()
          buffer = buffer.slice(idx + 1)
          if (!line) continue
          if (line === RAW_HOST_READY) {
            started = true
            clearTimeout(timer)
            log.info('raw printer host ready — later jobs skip process startup')
            resolve()
          } else if (line.startsWith(RAW_HOST_DONE) && pending) {
            const notify = pending
            pending = null
            notify(line)
          }
        }
      })

      proc.stderr.setEncoding('utf-8')
      proc.stderr.on('data', (d: string) => {
        const text = d.trim()
        if (text) log.warn(`raw printer host stderr: ${text.slice(0, 200)}`)
      })

      proc.on('error', (err) => {
        clearTimeout(timer)
        teardown(err.message)
        reject(err)
      })

      proc.on('exit', (code) => {
        clearTimeout(timer)
        // Exit between jobs is normal enough (machine sleep, AV); the next job
        // restarts it. Exit DURING a job must not leave the caller hanging.
        teardown(`host exited code=${code}`)
        if (!started) reject(new Error(`raw printer host exited during start (code ${code})`))
      })
    }).catch((err) => {
      ready = null
      throw err
    })

    return ready
  }

  function send(printerName: string, bytes: Buffer): Promise<void> {
    const run = async (): Promise<void> => {
      await start()
      const proc = child
      if (!proc) throw new Error('raw printer host unavailable')

      const payload = `${Buffer.from(printerName, 'utf-8').toString('base64')} ${bytes.toString('base64')}\n`

      const answer = await new Promise<string>((resolve, reject) => {
        const timer = setTimeout(() => {
          // A wedged helper would silently swallow every later job, so recycle
          // it rather than leaving a host that answers nothing.
          teardown('operation timeout')
          reject(new Error('raw printer host timed out'))
        }, OP_TIMEOUT_MS)

        pending = (line: string): void => {
          clearTimeout(timer)
          resolve(line)
        }

        proc.stdin.write(payload, (err) => {
          if (err) {
            clearTimeout(timer)
            pending = null
            teardown(err.message)
            reject(err)
          }
        })
      })

      const rc = Number(answer.slice(RAW_HOST_DONE.length).trim().split(' ')[0])
      if (rc !== 0) throw new Error(`WritePrinter failed (Win32 error ${rc})`)
    }

    // Serialise: the helper is one request/response loop, so overlapping jobs
    // would read each other's replies.
    const result = chain.then(run, run)
    chain = result.catch(() => undefined)
    return result
  }

  function warm(): void {
    void start().catch((err: unknown) =>
      log.warn(
        `raw printer host warm-up failed: ${err instanceof Error ? err.message : String(err)}`
      )
    )
  }

  function stop(): void {
    if (!child) return
    try {
      child.stdin.write('QUIT\n')
    } catch {
      // Already gone — the kill below is what matters.
    }
    teardown('shutdown')
  }

  return { send, warm, stop }
}
