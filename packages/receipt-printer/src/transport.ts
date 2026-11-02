/**
 * How a finished job reaches a printer: a PDF through the OS driver (`lp` on
 * macOS/Linux, SumatraPDF via pdf-to-printer on Windows), or raw bytes past the
 * driver entirely (ESC/POS, ZPL, a drawer kick). Every call deletes its file
 * afterwards and never falls through to the OS default printer: a register
 * whose printer is not set should say so, not print on whichever printer the
 * machine prefers.
 */
import { execFile } from 'node:child_process'
import { readFileSync, unlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { resolveLogger } from './log'
import type { PrinterLogger } from './types'
import type { RawPrinterHost } from './windows-raw-host'

export type PrintPdfOptions = {
  orientation?: 'portrait' | 'landscape'
  /** Extra `lp` options on macOS/Linux (`['-o', 'DocCutType=1PartialCutDoc']`). */
  lpOptions?: string[]
}

export type RawPrintOptions = {
  /** The warm Windows host; without one every raw job is a one-shot spawn. */
  host?: RawPrinterHost | null
  log?: Partial<PrinterLogger>
}

function removeQuietly(filePath: string): void {
  try {
    unlinkSync(filePath)
  } catch {
    /* already gone */
  }
}

/** Print a PDF file to a named printer through its driver, then delete the file. */
export async function printPdfFile(
  filePath: string,
  printerName: string,
  opts: PrintPdfOptions = {}
): Promise<void> {
  if (!printerName) throw new Error('No printer selected — choose one in Printer settings')
  const orientation = opts.orientation ?? 'portrait'
  const lpOptions = opts.lpOptions ?? []
  try {
    if (process.platform === 'win32') {
      const ptp = await import('pdf-to-printer')
      // SumatraPDF would otherwise "fit" the tall narrow page by rotating it.
      await ptp.print(filePath, {
        printer: printerName,
        silent: true,
        orientation,
        scale: 'noscale'
      })
    } else {
      await new Promise<void>((resolve, reject) => {
        execFile('lp', ['-d', printerName, ...lpOptions, filePath], (err) =>
          err ? reject(err) : resolve()
        )
      })
    }
  } catch (err) {
    throw new Error(`Print failed: ${err instanceof Error ? err.message : String(err)}`)
  } finally {
    removeQuietly(filePath)
  }
}

// PowerShell that pushes raw bytes at a Windows printer through the spooler's
// RAW datatype (winspool WritePrinter) — how ZPL reaches a Zebra untouched. The
// C# shim is compiled once to a cached DLL; later jobs just load it.
const WIN_RAW_PRINT_PS1 = `param([string]$Printer, [string]$Path, [string]$AsmPath)
$ErrorActionPreference = "Stop"
$src = @"
using System;
using System.IO;
using System.Runtime.InteropServices;
public class CmRawPrint {
  [StructLayout(LayoutKind.Sequential, CharSet=CharSet.Unicode)]
  public struct DOCINFO { [MarshalAs(UnmanagedType.LPWStr)] public string pDocName; [MarshalAs(UnmanagedType.LPWStr)] public string pOutputFile; [MarshalAs(UnmanagedType.LPWStr)] public string pDataType; }
  [DllImport("winspool.Drv", EntryPoint="OpenPrinterW", SetLastError=true, CharSet=CharSet.Unicode)] public static extern bool OpenPrinter(string src, out IntPtr h, IntPtr pd);
  [DllImport("winspool.Drv", EntryPoint="ClosePrinter", SetLastError=true)] public static extern bool ClosePrinter(IntPtr h);
  [DllImport("winspool.Drv", EntryPoint="StartDocPrinterW", SetLastError=true, CharSet=CharSet.Unicode)] public static extern bool StartDocPrinter(IntPtr h, int level, ref DOCINFO di);
  [DllImport("winspool.Drv", EntryPoint="EndDocPrinter", SetLastError=true)] public static extern bool EndDocPrinter(IntPtr h);
  [DllImport("winspool.Drv", EntryPoint="StartPagePrinter", SetLastError=true)] public static extern bool StartPagePrinter(IntPtr h);
  [DllImport("winspool.Drv", EntryPoint="EndPagePrinter", SetLastError=true)] public static extern bool EndPagePrinter(IntPtr h);
  [DllImport("winspool.Drv", EntryPoint="WritePrinter", SetLastError=true)] public static extern bool WritePrinter(IntPtr h, byte[] buf, int count, out int written);
  public static void Send(string printer, byte[] bytes) {
    IntPtr h;
    if (!OpenPrinter(printer, out h, IntPtr.Zero)) throw new Exception("OpenPrinter failed for '" + printer + "'");
    try {
      DOCINFO di = new DOCINFO(); di.pDocName = "Raw print"; di.pDataType = "RAW";
      if (!StartDocPrinter(h, 1, ref di)) throw new Exception("StartDocPrinter failed");
      if (!StartPagePrinter(h)) throw new Exception("StartPagePrinter failed");
      int written;
      if (!WritePrinter(h, bytes, bytes.Length, out written) || written != bytes.Length)
        throw new Exception("WritePrinter failed: wrote " + written + " of " + bytes.Length + " bytes");
      EndPagePrinter(h); EndDocPrinter(h);
    } finally { ClosePrinter(h); }
  }
}
"@
$loaded = $false
if ($AsmPath -and (Test-Path $AsmPath)) {
  try { Add-Type -Path $AsmPath; $loaded = $true } catch { Remove-Item $AsmPath -Force -ErrorAction SilentlyContinue }
}
if (-not $loaded) {
  if ($AsmPath) {
    try { Add-Type -TypeDefinition $src -OutputAssembly $AsmPath | Out-Null; Add-Type -Path $AsmPath; $loaded = $true } catch { }
  }
  if (-not $loaded) { Add-Type -TypeDefinition $src }
}
if (-not $Printer) { throw "No printer specified" }
[CmRawPrint]::Send($Printer, [System.IO.File]::ReadAllBytes($Path))
`

let winRawScriptPath: string | null = null

function ensureWinRawScript(): string {
  if (!winRawScriptPath) {
    const p = join(tmpdir(), 'cm-rawprint.ps1')
    writeFileSync(p, WIN_RAW_PRINT_PS1, 'utf-8')
    winRawScriptPath = p
  }
  return winRawScriptPath
}

/**
 * Send a raw byte file (ZPL, an Epson raster receipt, a drawer kick) straight
 * to the printer, bypassing any driver, then delete the file. On Windows it
 * goes down the warm PowerShell host when one is given, so it skips the ~2.6 s
 * process start; if the host fails, a one-shot spawn still sends it.
 */
export async function printRawFile(
  filePath: string,
  printerName: string,
  opts: RawPrintOptions = {}
): Promise<void> {
  if (!printerName) throw new Error('No printer selected — choose one in Printer settings')
  const log = resolveLogger(opts.log)
  try {
    if (process.platform === 'win32') {
      if (opts.host) {
        try {
          await opts.host.send(printerName, readFileSync(filePath))
          return
        } catch (err) {
          log.warn(
            `warm raw-printer host failed, falling back to a one-shot spawn: ${err instanceof Error ? err.message : String(err)}`
          )
        }
      }
      const script = ensureWinRawScript()
      const asmPath = join(tmpdir(), 'cm-rawprint.dll')
      await new Promise<void>((resolve, reject) => {
        execFile(
          'powershell.exe',
          [
            '-NoProfile',
            '-NonInteractive',
            '-ExecutionPolicy',
            'Bypass',
            '-File',
            script,
            '-Printer',
            printerName,
            '-Path',
            filePath,
            '-AsmPath',
            asmPath
          ],
          (err, _stdout, stderr) =>
            err ? reject(new Error(stderr?.trim() || err.message)) : resolve()
        )
      })
    } else {
      await new Promise<void>((resolve, reject) => {
        execFile('lp', ['-d', printerName, '-o', 'raw', filePath], (err) =>
          err ? reject(err) : resolve()
        )
      })
    }
  } catch (err) {
    throw new Error(`Print failed: ${err instanceof Error ? err.message : String(err)}`)
  } finally {
    removeQuietly(filePath)
  }
}

/** Write bytes to a scratch file and send them raw — the drawer kick and ZPL path in one call. */
export async function printRawBytes(
  bytes: Buffer,
  printerName: string,
  opts: RawPrintOptions & { prefix?: string; tmpDir?: string } = {}
): Promise<void> {
  const file = join(opts.tmpDir ?? tmpdir(), `${opts.prefix ?? 'raw'}-${Date.now()}.bin`)
  writeFileSync(file, bytes)
  await printRawFile(file, printerName, opts)
}
