# @checkoutmain/camera-barcode-scanner

A phone-camera barcode scanner for React that works on iPhone Safari — the
platform with no native `BarcodeDetector`, aggressive memory limits, and a
habit of silently killing Web Workers.

```tsx
import { useState } from 'react'
import { CameraScanner } from '@checkoutmain/camera-barcode-scanner'
import '@checkoutmain/camera-barcode-scanner/styles.css'

export function ScanButton() {
  const [open, setOpen] = useState(false)
  return (
    <>
      <button onClick={() => setOpen(true)}>Scan</button>
      {open && (
        <CameraScanner
          onScan={async (code) => {
            const product = await api.lookup(code)
            if (!product) return 'unrecognized'
            await showProductSheet(product) // scanner stays paused until this resolves
          }}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  )
}
```

**Peer dependencies:** `react >= 18`, `zxing-wasm ^3.1`.

## How it works

```
main thread                              worker (scan-worker.ts)
─────────────────────────────            ───────────────────────────
getUserMedia 1280×720 ──► <video>
  every 100ms:
    drawImage → getImageData  ──frame──► readBarcodes (ZXing-C++ WASM)
    (band  = middle 34% of the frame)    fast: no rotate/tryHarder
    (every 3rd: downscaled full frame)   tolerant: rotate + tryHarder
                             ◄─result──  { code | null, decodeMs }
  confirmScan: same code twice in a row?
    yes → pause, release camera, onScan(code) → resume
```

### Decisions worth knowing

- **All decoding is off the main thread.** The main thread only copies pixels
  (a few ms). The WASM decode runs in a Worker so the preview never stutters
  and a network lookup after a decode is not starved. On iPhone Safari there is
  no `BarcodeDetector`; the worker _is_ the engine, not a fallback.
- **Two-tier frames.** Most frames send only the reticle band with all
  tolerances off — the minimum work, and instant for a level barcode. Every
  third frame that misses sends a downscaled full frame with rotation retries,
  so tilted or off-reticle codes still read. The tolerant pass is capped by
  **area** (350k pixels), not width: a "640-wide" portrait frame was 640×1138,
  larger than the band it was meant to be cheaper than.
- **Two consecutive decodes must agree.** A one-digit misread can still pass
  a checksum. `confirmScan` only fires when the same code arrives twice;
  empty frames do not reset the pending code (they carry no contradicting
  evidence) but it goes stale after 1.5s.
- **10 frames per second, not 60.** Each pumped frame allocates and transfers
  a ~1MB buffer. Pumping at rAF speed churned ~75MB/s of garbage on the phone.
  10/s still confirms a code in about 200ms.
- **One canvas per decode mode.** A shared canvas that ping-ponged between
  band and full-frame geometry reallocated its backing store several times a
  second — a real memory hazard on iOS. Each canvas keeps one geometry for the
  life of the session.
- **The camera is released while you handle a scan.** iOS holds tens of MB for
  a live capture pipeline. Long sessions used to run out of memory during
  review pauses, so the stream is stopped while `onScan` is pending and
  re-acquired when it resolves. Turn off with `releaseCameraWhilePaused={false}`
  if your handler is near-instant.
- **A stalled worker is respawned, not just logged.** iOS can kill a worker
  outright under memory pressure. Posting to a dead worker is a silent no-op,
  so a 2s watchdog terminates and respawns it (up to 5 times, then it shows an
  error asking the user to reopen).
- **Rescan cooldown, not session dedupe.** The same code within 3s is a frame
  burst or an accidental double-read and only flashes. After that a rescan is
  intentional and fires `onScan` again — a session-long dedupe made rescans
  look like the scanner had died.
- **Audio context is created on the opening tap.** iOS only allows audio that
  starts inside a user gesture. The context is created when the component
  mounts (still inside the tap that opened it) and resumed on any pointerdown.
- **`muted` and `playsinline` are set imperatively.** React does not reliably
  set the `muted` _property_, and without it iOS renders the inline stream
  black.

## Props

| Prop                       | Type                                                            | Default                                 | Notes                                                                                  |
| -------------------------- | --------------------------------------------------------------- | --------------------------------------- | -------------------------------------------------------------------------------------- |
| `onScan`                   | `(code) => ScanOutcome \| void \| Promise<ScanOutcome \| void>` | required                                | Scanning pauses until the promise settles. Return `'unrecognized'` for red flash/buzz. |
| `onClose`                  | `() => void`                                                    | required                                | Close tapped, or first code captured in `once` mode.                                   |
| `once`                     | `boolean`                                                       | `false`                                 | Fire for the first confirmed code, then close.                                         |
| `title` / `hint`           | `string`                                                        | sensible                                | Bar title and the pill under the reticle.                                              |
| `rescanCooldownMs`         | `number`                                                        | `3000`                                  |                                                                                        |
| `normalize`                | `(code) => string`                                              | `normalizeScannedCode`                  | Strips the leading zero ZXing adds to UPC-A. Pass `(c) => c` for raw.                  |
| `formats`                  | `BarcodeFormat[]`                                               | EAN-13/8, UPC-A/E, Code128, Code39, ITF | Any `zxing-wasm` reader format. Add `'QRCode'` if you need it.                         |
| `wasmUrl`                  | `string`                                                        | zxing-wasm CDN loader                   | Self-host: `import url from 'zxing-wasm/reader/zxing_reader.wasm?url'` (Vite).         |
| `sound` / `vibrate`        | `boolean`                                                       | `true`                                  |                                                                                        |
| `releaseCameraWhilePaused` | `boolean`                                                       | `true`                                  | See above.                                                                             |
| `resolution`               | `{ width, height }`                                             | `1280×720`                              | Clean decodes at 720p; higher costs memory for no gain in testing.                     |
| `onDiagnostic`             | `(d: ScanDiagnostic) => void`                                   | —                                       | Timing/lifecycle events; see below.                                                    |
| `className`                | `string`                                                        | —                                       |                                                                                        |

Also exported: `confirmScan`, `createConfirmState`, `normalizeScannedCode`,
`cameraErrorMessage`, `DEFAULT_FORMATS`, and the worker message types.

## Styling

The overlay is `position: fixed; inset: 0` with BEM classes under `.cam-scan`.
Every colour and radius reads a custom property with a fallback, so set these
on `:root` (or any ancestor) to match your design system:

```css
:root {
  --cam-scan-bg: #0b0f0d;
  --cam-scan-panel: #111815;
  --cam-scan-border: #22302a;
  --cam-scan-text: #e8efe9;
  --cam-scan-muted: #8aa093;
  --cam-scan-ok: #35c46b;
  --cam-scan-fail: #ff6a5e;
  --cam-scan-radius: 3px;
  --cam-scan-font: system-ui, sans-serif;
  --cam-scan-z: 60;
}
```

The reticle height (34%) matches the `BAND` constant in the component: the
fast decode pass reads exactly the strip the user is told to aim at. Change
both or neither.

## Diagnostics

Pass `onDiagnostic` to receive `{ event, t, data }` objects. Events: `start`,
`decode-pending`, `decode`, `handled`, `worker-stall`, `worker-error`,
`worker-respawn`, and a `summary` every ~2s with pump rate, hit/empty counts,
average grab and decode times, and stall count. In development, POSTing these
to a tiny endpoint that prints to the terminal is how the numbers in this
README were measured.

## Requirements and gotchas

- **HTTPS.** `getUserMedia` needs a secure context. On a LAN dev server use a
  self-signed cert (Vite: `@vitejs/plugin-basic-ssl`).
- **Worker bundling.** The component spawns
  `new Worker(new URL('./scan-worker.ts', import.meta.url), { type: 'module' })`.
  Vite, webpack 5, Parcel and Rspack all understand this pattern. If yours does
  not, copy `scan-worker.ts` to a static path and adjust the URL.
- **WASM loading.** By default `zxing-wasm` fetches `zxing_reader.wasm` from
  jsDelivr. For offline or CSP-locked deployments pass `wasmUrl`.
- **`once` mode** is for filling a single field: it fires, closes, and never
  resumes.
