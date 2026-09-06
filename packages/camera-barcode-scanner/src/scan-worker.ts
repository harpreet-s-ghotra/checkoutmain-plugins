/**
 * ZXing WASM decode worker. The camera loop on the main thread only grabs
 * pixels (drawImage + getImageData, a few ms) and posts them here; the heavy
 * WASM decode runs off-thread so the preview stays smooth and post-decode
 * work isn't starved. On iPhone Safari (no native BarcodeDetector) this is the
 * whole scanning engine, not a fallback.
 *
 * Messages in:  ScanWorkerInit (optional, once) then ScanWorkerRequest frames.
 * Messages out: ScanWorkerResponse, one per frame.
 */
import { prepareZXingModule, readBarcodes } from 'zxing-wasm/reader'
import type { ReaderOptions } from 'zxing-wasm/reader'

export type BarcodeFormat = NonNullable<ReaderOptions['formats']>[number]

export type ScanWorkerInit = {
  type: 'init'
  /**
   * Where to fetch `zxing_reader.wasm`. When omitted, zxing-wasm's default
   * loader is used, which resolves the matching version from the jsDelivr CDN.
   * Pass a self-hosted URL for offline or CSP-restricted deployments — with
   * Vite: `import wasmUrl from 'zxing-wasm/reader/zxing_reader.wasm?url'`.
   */
  wasmUrl?: string
  /** Symbologies to decode. Defaults to the retail set (see DEFAULT_FORMATS). */
  formats?: BarcodeFormat[]
}

export type ScanWorkerRequest = {
  type: 'frame'
  buffer: ArrayBuffer
  width: number
  height: number
  /** 'fast' = reticle band, tolerances off; 'tolerant' = full frame, rotation on. */
  mode: 'fast' | 'tolerant'
}

export type ScanWorkerMessage = ScanWorkerInit | ScanWorkerRequest

export type ScanWorkerResponse = { code: string | null; decodeMs: number }

/** Retail symbologies: what is printed on consumer packaging and shelf labels. */
export const DEFAULT_FORMATS: BarcodeFormat[] = [
  'EAN-13',
  'EAN-8',
  'UPC-A',
  'UPC-E',
  'Code128',
  'Code39',
  'ITF'
]

let formats: BarcodeFormat[] = DEFAULT_FORMATS
let initialised = false

function init(msg?: Partial<ScanWorkerInit>): void {
  initialised = true
  if (msg?.formats && msg.formats.length > 0) formats = msg.formats
  void prepareZXingModule({
    overrides: msg?.wasmUrl ? { locateFile: () => msg.wasmUrl as string } : {},
    fireImmediately: true
  }).catch(() => {
    // A failed module load surfaces as decode errors, which the main thread
    // treats as a stalled worker and respawns.
  })
}

function optionsFor(mode: ScanWorkerRequest['mode']): ReaderOptions {
  return mode === 'fast'
    ? {
        formats,
        tryHarder: false,
        tryRotate: false,
        tryInvert: false,
        tryDownscale: false,
        maxNumberOfSymbols: 1
      }
    : {
        formats,
        tryHarder: true,
        tryRotate: true,
        tryInvert: false,
        tryDownscale: false,
        maxNumberOfSymbols: 1
      }
}

self.onmessage = async (e: MessageEvent<ScanWorkerMessage>) => {
  const msg = e.data
  if (msg.type === 'init') {
    init(msg)
    return
  }
  if (!initialised) init()

  const { buffer, width, height, mode } = msg
  const t0 = performance.now()
  let code: string | null = null
  try {
    const image = new ImageData(new Uint8ClampedArray(buffer), width, height)
    const results = await readBarcodes(image, optionsFor(mode))
    code = results.find((r) => r.isValid && r.text)?.text ?? null
  } catch {
    // Bad frame or decoder hiccup — report "nothing" and keep going.
  }
  const response: ScanWorkerResponse = { code, decodeMs: Math.round(performance.now() - t0) }
  self.postMessage(response)
}
