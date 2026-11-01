# CheckoutMain Plugins

Reusable, documented building blocks extracted from the
[CheckoutMain](https://checkoutmain.co) / High Spirits point-of-sale system.
Each package is small, has no framework lock-in beyond React where a component
is involved, and ships with the reasoning behind its design decisions — the
hard-won parts, not just the code.

MIT licensed. Use them, fork them, ship them.

## Packages

| Package                                                     | What it does                                                                                                                                                                                                       |
| ----------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| [`camera-barcode-scanner`](packages/camera-barcode-scanner) | Phone-camera barcode scanner for React. ZXing WASM decoding in a Web Worker, a two-tier frame strategy, two-decode confirmation, and the iOS Safari memory handling that took weeks to learn.                      |
| [`keyboard-wedge-scanner`](packages/keyboard-wedge-scanner) | Capture USB / Bluetooth scanners that type like a keyboard. A pure, unit-tested keystroke parser plus a React hook and component.                                                                                  |
| [`barcode-gtin`](packages/barcode-gtin)                     | GTIN equivalence: UPC-E ↔ UPC-A with check-digit proof, a canonical form, and every stored string a scanned code could match.                                                                                      |
| [`pax-terminal`](packages/pax-terminal)                     | Drive a PAX card terminal (POSLink over TCP, Fiserv RapidConnect) from Node: sale, return, void, standalone credit, a one-command-at-a-time lock, and recovery of a sale the terminal accepted but never answered. |

The three barcode packages compose: the camera scanner and the wedge hook both
hand you a code string; `barcode-gtin` turns that string into the lookup you
actually need. `pax-terminal` stands alone on the payment side.

```tsx
import { CameraScanner } from '@checkoutmain/camera-barcode-scanner'
import '@checkoutmain/camera-barcode-scanner/styles.css'
import { useKeyboardWedge } from '@checkoutmain/keyboard-wedge-scanner'
import { barcodeLookupVariants } from '@checkoutmain/barcode-gtin'

function InventoryScreen() {
  const [scanning, setScanning] = useState(false)

  async function lookup(code: string) {
    const rows = await db.products.whereIn('barcode', barcodeLookupVariants(code))
    return rows.length ? 'recognized' : 'unrecognized'
  }

  useKeyboardWedge((code) => void lookup(code))

  return (
    <>
      <button onClick={() => setScanning(true)}>Scan with camera</button>
      {scanning && <CameraScanner onScan={lookup} onClose={() => setScanning(false)} />}
    </>
  )
}
```

## Installing

The packages are published as **TypeScript source** (the `exports` map points
at `src/`). That is deliberate: the camera scanner spawns a Web Worker with
`new URL('./scan-worker.ts', import.meta.url)`, which bundlers (Vite, webpack 5,
Parcel, Rspack) resolve at build time — shipping a prebuilt bundle would hide
the worker from them. Any modern bundler that compiles TypeScript handles it.

Three ways to bring a package in:

1. **Copy the folder.** Each `packages/<name>/src` is self-contained. Drop it
   into your project and import it relatively. This is the "plugin" spirit of
   the repo — there is nothing to keep in sync.
2. **Install from git.**
   ```bash
   npm install github:harpreet-s-ghotra/checkoutmain-plugins#main
   ```
   then import from `checkoutmain-plugins/packages/camera-barcode-scanner/src`.
3. **npm workspaces / git submodule** if you already run a monorepo.

Peer dependencies: `react >= 18` for the React pieces, `zxing-wasm ^3` for the
camera scanner. `barcode-gtin` has none. `pax-terminal` needs Node ≥ 18 (it
opens TCP sockets) and nothing else.

## Development

```bash
npm install
npm run check        # prettier + tsc + vitest
npm test             # just the tests
```

Tests cover everything that is pure: the decode-confirmation state machine,
the wedge parser, and all GTIN arithmetic (with real retail barcodes as
vectors). The camera component itself is exercised on devices, not in jsdom —
`getUserMedia`, Workers, and WASM are exactly the parts jsdom cannot fake.
The PAX terminal runs its whole flow against a scripted fake socket, with a
frame captured from a live terminal as the parsing vector.

## Contributing

Issues and pull requests are welcome. Keep the bar the packages set: a pure
core with tests, a thin adapter for React, and a README that explains **why**,
not just what. Formatting is Prettier (single quotes, no semicolons, 100
columns) — `npm run format`.

## Origin

Extracted from the CheckoutMain admin portal and the High Spirits POS, where
these run on store owners' phones and registers every day — the PAX package
takes the card payments. The comments in the
source are the original ones: they record what broke on real hardware and what
fixed it.
