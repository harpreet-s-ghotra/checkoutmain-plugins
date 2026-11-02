# @checkoutmain/receipt-printer

Thermal receipts, the cash drawer and shelf labels from Node or Electron, on
macOS, Windows and Linux, on the printers a small store actually buys: Star
TSP, Epson TM, Zebra, DYMO, Brother. You lay the receipt out once as a PDF the
width of the roll; this package sends it the way the printer in front of it
needs, and tells you which way that was.

Every rule in here was learned on a counter, not from a spec sheet. The READMEs
in this repo explain the why; the code carries the what.

```ts
import {
  printReceiptPdf,
  pageWidthPoints,
  isEpsonReceiptQueue,
  openCashDrawer,
  createRawPrinterHost,
  createLabelPrinter
} from '@checkoutmain/receipt-printer'

// 1. Lay the receipt out at the roll's width (pdfkit, or anything that makes a PDF).
const pdf = await renderReceipt({ pageWidth: pageWidthPoints(80) })

// 2. Send it. A Star gets the PDF through its driver and cuts; an Epson TM gets
//    the same page as ESC/POS raster, upright and cut on every OS.
const path = await printReceiptPdf(pdf, {
  printerName: 'EPSON TM-T20III Receipt',
  paperWidthMm: 80
})
// path → 'escpos' | 'driver'

// 3. The drawer hangs off the receipt printer.
await openCashDrawer('EPSON TM-T20III Receipt')
```

## What you get

| Piece                                                                           | What it does                                                                                                                                                                                   |
| ------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `printReceiptPdf(pdf, printer, opts)`                                           | Routes a receipt-roll PDF: ESC/POS raster sent raw for an Epson, the PDF through the driver (with the Star cut options) for everything else. Falls back to the driver if the raster fails.     |
| `pdfToEscPosRaster(pdf, widthDots, darkness)`                                   | Draws every page of a PDF to a 1-bit bitmap at the printer's dot width and wraps it in ESC/POS: `ESC @`, print density, `GS v 0` bands, feed-and-cut.                                          |
| `isEpsonReceiptPrinter(name)` / `isEpsonReceiptQueue(name, describe)`           | Tells an Epson TM queue from a Star or anything else, by queue name, then by what the OS says about a renamed queue. Cached per process.                                                       |
| `printPdfFile` / `printRawFile` / `printRawBytes`                               | The transport: `lp` on macOS/Linux (`-o raw` for bytes), SumatraPDF via `pdf-to-printer` or a WINSPOOL shim on Windows. Deletes the file after. Never falls through to the OS default printer. |
| `createRawPrinterHost({ dir })`                                                 | The warm Windows host: one PowerShell process kept alive so a drawer kick takes milliseconds instead of 2.6 seconds.                                                                           |
| `drawerKickBytes(name)` / `openCashDrawer(name)`                                | ESC `p` for ESC/POS printers, a single BEL for Star Line Mode.                                                                                                                                 |
| `createLabelPrinter({ getSettings })`                                           | Shelf labels: native ZPL for a Zebra over the raw path, a PDF page per label for DYMO / Brother / generic. One shared grid for both and for your settings preview.                             |
| `renderLabelZpl` / `renderLabelsPdf` / `computeLabelGrid` / `selectSymbology` … | The pure parts, exported for previews and tests.                                                                                                                                               |

## Why a PDF, then ESC/POS

Receipts, tickets and reports are laid out once as a narrow PDF and handed to
the printer driver. On a **Star TSP654** that is the end of the story: the
driver prints the page as it is and cuts on the Star-only `DocCutType` option.

On an **Epson TM** it is not:

- **macOS:** the CUPS queue is usually set up with a generic Epson driver, which
  lays the narrow page out on Letter paper. Sideways, overlapping, no cut.
- **Windows (Epson APD driver):** SumatraPDF hands the page to a driver whose
  paper is a roll, and the receipt comes out turned on its side. Nothing cuts it.

So for an Epson the same PDF is drawn to a bitmap and sent as raw ESC/POS, which
involves no driver setting at all:

1. pdfjs renders each page at the printer's dot width (**576 dots** = 72 mm at
   203 dpi on an 80 mm roll, 384 on a 58 mm roll) on a Skia canvas
   (`@napi-rs/canvas`), with pdfjs's own copies of the 14 standard PDF fonts, so
   Helvetica is the same face on every OS and the layout you measured is the
   layout that prints.
2. Pixels darker than a threshold print black (`rgbaToBits`); blank rows at the
   bottom are trimmed so the cut lands under the last line.
3. Output: `ESC @`, the print density, the image in `GS v 0` bands of 256 rows
   (`GS v 0` takes 65535 rows on paper, but older firmware buffers far less),
   then `GS V 66 3`: feed past the cutter, partial cut.

**Which printers:** nothing to set up. `isEpsonReceiptPrinter` matches anything
with `EPSON` or a `TM-…` model in the queue name (`EPSON_TM_T20IV`, `EPSON
TM-T20IV Receipt`, `TM-T88V`) and refuses `Star` / `TSP…`. When a store has
renamed the queue ("Front Counter"), `isEpsonReceiptQueue` asks the host what
the OS says about the device, which still names the driver, the make-and-model
and on a Mac the USB address (`usb://EPSON/TM-T20IV`). The answer is remembered
per queue; a failed lookup means "not Epson", which leaves the printer on the
PDF path, because a sideways receipt beats no receipt.

**Barcodes on an Epson:** a Code 128 scaled by the driver gets bars of uneven
width. Draw it at one pixel per module and widen it so every bar is a whole
number of printer dots (`dotsPerPoint(paperWidthMm)` gives the factor), with
the number as text beneath.

**If the raster fails** (the canvas module missing, a corrupt PDF), the PDF
still goes to the driver and the job reports `'driver'`.

## Print darkness

A new TM prints faint at its own density. `PrintDarkness` sets two things at
once per job: the ESC/POS print density (`GS ( K` fn 49, −6 … +6 heat steps,
sent right after `ESC @`) and how grey an anti-aliased pixel may be and still
print, which thickens strokes.

| Level     | Density       | Ink threshold (0–255) |
| --------- | ------------- | --------------------- |
| `light`   | −2            | 140                   |
| `normal`  | printer's own | 160                   |
| `dark`    | +3            | 190                   |
| `darkest` | +6            | 215                   |

The default is `dark`. A model that does not support a density step ignores it;
the stroke weight still applies. A Star sets darkness in its driver.

## The warm Windows host

A drawer kick, an ESC/POS receipt or a ZPL label reaches a Windows printer by
pushing bytes through a C# shim over WINSPOOL's `RAW` datatype. The shim is
cheap. _Reaching_ it is not: spawning `powershell.exe` pays CLR startup,
assembly load and usually an antivirus scan every time. Measured at a store in
July 2026, with the compiled DLL already cached:

```
12:25  drawer opened via=usb:win32 ms=2665
12:34  drawer opened via=usb:win32 ms=2652
18:51  drawer opened via=usb:win32 ms=3085
```

2.6 seconds on every cash sale, no first-run penalty, no fast case. The cost is
the process, not the work.

`createRawPrinterHost` starts that process once and keeps it: a generated `.ps1`
that compiles the shim to a DLL beside it (once), prints `RAW-HOST-READY`, then
reads one line per job (`<printer base64> <bytes base64>`) and answers
`RAW-HOST-DONE <win32 error>`. Base64 on both operands removes PowerShell
quoting from the protocol entirely; printer names contain spaces and
apostrophes, and escaping them through two languages is where this would
otherwise break.

```ts
const host = createRawPrinterHost({ dir: app.getPath('userData'), docName: 'My POS' })
host.warm() // at app launch, so the first cash sale skips the startup too
await openCashDrawer(printerName, { host })
app.on('before-quit', () => host.stop())
```

Every failure (start timeout, host exit, a wedged helper, a non-zero Win32
error) rejects, and `printRawFile` falls back to a one-shot spawn. A warm host
is an optimisation, never a new way for the drawer to stop working.

## The cash drawer

The drawer plugs into the receipt printer's RJ11 "DK" port, so opening it is a
few bytes sent to the receipt printer's queue past the driver: `ESC p 0 25 250`
for Epson and every other ESC/POS printer, a single `BEL` (`0x07`) for Star
Line Mode printers (TSP100 / 650 / 654), which ignore `ESC p`.

## Shelf labels

One label is a 2×2 grid: name + size across the top (up to two lines), barcode
bottom-left, price bottom-right. `computeLabelGrid` draws that grid in any unit,
so the PDF renderer, the ZPL renderer and a settings preview on screen agree to
the pixel.

- **Zebra** (`isZebraPrinter`: brand name, a ZQ/ZD/ZT/ZP/GK/GX model prefix, or
  "ZPL" in the queue name) gets native ZPL through the raw path: vector text and
  barcodes the thermal head reproduces exactly at any DPI, no rasterising. UPC-A
  and EAN-13 are sent minus their check digit (ZPL recomputes it); anything
  else is Code 128, which accepts it whole. `^` and `~` in a name are
  neutralised, since they are ZPL command prefixes.
- **DYMO / Brother / generic** get a PDF, one page per label sized to the media,
  through the OS driver.
- `selectSymbology` picks UPC-A or EAN-13 only when the SKU is 12 or 13 digits
  **with a valid check digit**, so a real retail barcode round-trips as itself;
  everything else is Code 128. A SKU the UPC encoder refuses falls back to Code
  128; a blank one prints no barcode.
- Names over `maxNameLength` are **skipped and counted**, never clipped.
- `sanitizeLabelSettings` clamps every setting to the bounds a settings screen
  should also use (`LABEL_SETTINGS_BOUNDS`), so what saves is what prints.

```ts
const labels = createLabelPrinter({
  getSettings: () => store.labelSettings, // the register's saved settings
  tmpDir: app.getPath('temp')
})
const { printed, skipped } = await labels.printLabels({
  items: [{ sku: '036000291452', name: 'Ginger Kombucha', size: '16 oz', price: 3.95 }]
})
```

## Wiring it into Electron

- **Which queue is an Epson:** give `isEpsonReceiptQueue` the OS description
  from the driver bridge, then hand its answer to the job:

  ```ts
  const describe = async (name: string) => {
    const p = (await win.webContents.getPrintersAsync()).find((x) => x.name === name)
    return p ? [p.displayName, p.description, ...Object.values(p.options ?? {})].join(' ') : null
  }
  await printReceiptPdf(pdf, printer, { isEpson: (n) => isEpsonReceiptQueue(n, describe), host })
  ```

- **Packaging:** `@napi-rs/canvas` is a native module and `pdf-to-printer`
  carries a SumatraPDF binary; unpack both from the asar
  (`asarUnpack: ['node_modules/@napi-rs/**', 'node_modules/pdf-to-printer/**']`).
  pdfjs's standard fonts are read from inside the asar, which works.
- **Logging:** every function takes `log: { info, warn }`; without one, warnings
  go to `console.warn` and info is dropped.

## Peer dependencies

| Package              | For                              | Needed when              |
| -------------------- | -------------------------------- | ------------------------ |
| `pdfjs-dist` ^6      | drawing a PDF to a bitmap        | an Epson is in the store |
| `@napi-rs/canvas` ^1 | the canvas that drawing lands on | an Epson is in the store |
| `pdfkit`             | label PDFs                       | labels on a non-Zebra    |
| `bwip-js` ^4         | label barcodes (PNG)             | labels with barcodes     |
| `pdf-to-printer` ^5  | PDFs through a Windows driver    | Windows                  |

pdfjs and the canvas are loaded on first use, so a Star-only install never
loads them.

## Not here

Receipt **layout** (what a receipt says, how a sale is drawn) stays in the
application: it is where the store's name, tax lines and loyalty footer live.
This package starts at "here is the PDF" and at "here is the label text".

## Tests

`npm test` from the repo root. The raster tests draw real PDFs through pdfjs
and the Skia canvas and check the ESC/POS frame byte by byte (bands, cut,
density, the ink difference between `light` and `darkest`); the Windows host is
driven against a fake `powershell.exe` speaking its protocol; the transport is
tested on every platform by mocking `child_process`; the label tests render
real barcodes with bwip-js and real pages with pdfkit.
