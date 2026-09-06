/**
 * Decode confirmation and code normalisation — the pure, unit-tested half of
 * the camera scanner.
 */

/**
 * Camera decoders (ZXing) report UPC-A barcodes as EAN-13 with a leading zero;
 * USB scanners emit the 12 digits printed under the bars. Normalise camera
 * reads to the printed form so both paths store and match the same code.
 *
 * This is the default `normalize` for `CameraScanner`. Pass your own to keep
 * the raw 13-digit form, or to apply a richer GTIN canonicalisation (see the
 * `@checkoutmain/barcode-gtin` package).
 */
export function normalizeScannedCode(code: string): string {
  const v = code.trim()
  return /^0\d{12}$/.test(v) ? v.slice(1) : v
}

/**
 * Camera decodes occasionally misread a frame (one bad digit that still passes
 * the checksum). Require the SAME code on two consecutive decodes before
 * acting. Frames that decode nothing don't reset the pending code — they carry
 * no contradicting evidence — but a pending code goes stale after `staleMs`.
 */
export type ConfirmState = { code: string | null; at: number }

export function createConfirmState(): ConfirmState {
  return { code: null, at: 0 }
}

/** Feed one decoded code; returns the code once confirmed, else null. */
export function confirmScan(
  state: ConfirmState,
  code: string,
  now: number,
  staleMs = 1500
): string | null {
  const fresh = state.code === code && now - state.at <= staleMs
  if (fresh) {
    state.code = null
    state.at = 0
    return code
  }
  state.code = code
  state.at = now
  return null
}
