import { useEffect, useRef, useState } from 'react'
import { confirmScan, createConfirmState, normalizeScannedCode } from './confirm'
import type {
  BarcodeFormat,
  ScanWorkerInit,
  ScanWorkerRequest,
  ScanWorkerResponse
} from './scan-worker'
import './CameraScanner.css'

/**
 * What the host decided about a scanned code. Drives the flash colour and the
 * confirmation tone: recognized = green + high tone, unrecognized = red + low
 * buzz. Returning nothing from `onScan` counts as recognized.
 */
export type ScanOutcome = 'recognized' | 'unrecognized'

/** Timing and lifecycle events, for tuning on real phones. Never required. */
export type ScanDiagnostic = { event: string; t: number; data: Record<string, unknown> }

export interface CameraScannerProps {
  /**
   * Called once per confirmed code. Scanning PAUSES (and by default the camera
   * is released) until the returned promise settles, so the host can open a
   * modal, look the code up, or navigate, then resume by resolving.
   */
  onScan: (code: string) => ScanOutcome | void | Promise<ScanOutcome | void>
  /** The user tapped close, or (in `once` mode) the first code was captured. */
  onClose: () => void
  /** Single-shot: fire `onScan` for the first confirmed code, then `onClose`. */
  once?: boolean
  title?: string
  hint?: string
  /**
   * The same code read again within this window is treated as a frame burst
   * or an accidental double-read and only flashes; after it, a rescan is
   * deliberate and fires `onScan` again. Default 3000ms.
   */
  rescanCooldownMs?: number
  /**
   * Post-decode transform. Default strips the leading zero ZXing adds to
   * UPC-A codes (`normalizeScannedCode`). Pass `(c) => c` for raw output.
   */
  normalize?: (code: string) => string
  /** Symbologies to decode. Default: EAN-13/8, UPC-A/E, Code128, Code39, ITF. */
  formats?: BarcodeFormat[]
  /** Self-hosted `zxing_reader.wasm` URL. Default: zxing-wasm's CDN loader. */
  wasmUrl?: string
  /** Confirmation beep through WebAudio. Default true. */
  sound?: boolean
  /** Haptic pulse via `navigator.vibrate`. Default true. */
  vibrate?: boolean
  /**
   * Stop the camera stream while `onScan` is pending. Default true — iOS holds
   * tens of MB for a live capture pipeline, and review pauses are where long
   * sessions ran out of memory. Set false if your `onScan` is near-instant.
   */
  releaseCameraWhilePaused?: boolean
  /** Preferred capture resolution. Default 1280×720 (clean decodes, low memory). */
  resolution?: { width: number; height: number }
  onDiagnostic?: (d: ScanDiagnostic) => void
  /** Extra class on the root element. */
  className?: string
}

type Flash = ScanOutcome | null

/** Fraction of the frame height the fast pass reads — matches the reticle CSS. */
const BAND = 0.34
/** Frames are pumped at most this often; each one allocates ~1MB of pixels. */
const PUMP_INTERVAL_MS = 100
/** Area cap for the tolerant full-frame pass (≈ the band's pixel count). */
const TOLERANT_MAX_PIXELS = 350_000
/** A worker that has not answered in this long is presumed dead and respawned. */
const WORKER_STALL_MS = 2000
const WORKER_MAX_RESPAWNS = 5

/** Play a short tone through an already-unlocked AudioContext. */
function playTone(ctx: AudioContext, freq: number, type: OscillatorType, ms: number): void {
  try {
    const osc = ctx.createOscillator()
    const gain = ctx.createGain()
    osc.type = type
    osc.frequency.value = freq
    gain.gain.value = 0.09
    osc.connect(gain)
    gain.connect(ctx.destination)
    osc.start()
    osc.stop(ctx.currentTime + ms / 1000)
  } catch {
    // Audio is best-effort — vibration + the visual flash still confirm the scan.
  }
}

export function cameraErrorMessage(err: unknown): string {
  const name = (err as { name?: string })?.name
  if (name === 'NotAllowedError' || name === 'SecurityError')
    return 'Camera permission was denied. Allow camera access for this site, then reopen the scanner.'
  if (name === 'NotFoundError' || name === 'OverconstrainedError')
    return 'No usable camera was found on this device.'
  if (typeof window !== 'undefined' && !window.isSecureContext)
    return 'The camera needs a secure (HTTPS) connection.'
  return err instanceof Error ? err.message : 'Could not start the camera.'
}

export default function CameraScanner({
  onScan,
  onClose,
  once = false,
  title,
  hint,
  rescanCooldownMs = 3000,
  normalize = normalizeScannedCode,
  formats,
  wasmUrl,
  sound = true,
  vibrate = true,
  releaseCameraWhilePaused = true,
  resolution = { width: 1280, height: 720 },
  onDiagnostic,
  className
}: CameraScannerProps): React.JSX.Element {
  const videoRef = useRef<HTMLVideoElement>(null)
  const [flash, setFlash] = useState<Flash>(null)
  const [error, setError] = useState<string | null>(null)

  // Last-handled time per code. A short cooldown swallows frame bursts and
  // accidental double-reads, but a deliberate rescan after it fires again —
  // a session-long dedupe made rescans look like the scanner had died.
  const seenRef = useRef<Map<string, number>>(new Map())
  // Pause decoding while the host is handling a code.
  const busyRef = useRef(false)
  const firedRef = useRef(false)
  const audioRef = useRef<AudioContext | null>(null)

  // Latest props without re-arming the camera each render.
  const propsRef = useRef({
    onScan,
    onClose,
    normalize,
    rescanCooldownMs,
    sound,
    vibrate,
    releaseCameraWhilePaused,
    onDiagnostic
  })
  propsRef.current = {
    onScan,
    onClose,
    normalize,
    rescanCooldownMs,
    sound,
    vibrate,
    releaseCameraWhilePaused,
    onDiagnostic
  }

  useEffect(() => {
    let stopped = false
    let stream: MediaStream | undefined

    const diag = (event: string, data: Record<string, unknown> = {}): void => {
      propsRef.current.onDiagnostic?.({ event, t: Math.round(performance.now()), data })
    }
    const buzz = (ms: number): void => {
      if (propsRef.current.vibrate) navigator.vibrate?.(ms)
    }
    const tone = (kind: ScanOutcome): void => {
      const audio = audioRef.current
      if (!audio || !propsRef.current.sound) return
      if (kind === 'recognized') playTone(audio, 920, 'sine', 110)
      else playTone(audio, 320, 'square', 220)
    }

    // One canvas PER decode mode, each with a stable geometry — a shared
    // canvas ping-ponged between band and tolerant sizes, reallocating its
    // backing store several times a second (a real memory hazard on iOS).
    // willReadFrequently keeps them on a CPU-readable path for getImageData.
    const bandCanvas = document.createElement('canvas')
    const bandCtx = bandCanvas.getContext('2d', { willReadFrequently: true })
    const tolerantCanvas = document.createElement('canvas')
    const tolerantCtx = tolerantCanvas.getContext('2d', { willReadFrequently: true })

    // iOS Safari only autoplays an inline camera stream when the element is
    // *truly* muted + playsinline. React doesn't reliably set the `muted`
    // property, so do it imperatively or the video renders black.
    const video = videoRef.current
    if (video) {
      video.muted = true
      video.setAttribute('muted', '')
      video.setAttribute('playsinline', 'true')
      video.setAttribute('autoplay', 'true')
    }

    // Create the audio context now — still within the tap that opened the
    // scanner — so confirmation tones can play (iOS blocks audio otherwise).
    if (!audioRef.current) {
      const Ctor =
        window.AudioContext ??
        (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
      if (Ctor) audioRef.current = new Ctor()
    }
    void audioRef.current?.resume().catch(() => {})

    async function handleCode(rawCode: string): Promise<void> {
      const code = propsRef.current.normalize(rawCode)

      // Single-shot: capture the first code and close.
      if (once) {
        if (firedRef.current) return
        firedRef.current = true
        buzz(120)
        tone('recognized')
        try {
          await propsRef.current.onScan(code)
        } finally {
          propsRef.current.onClose()
        }
        return
      }

      // Within the cooldown (frame burst / double-read): just flash to
      // acknowledge. After it, a rescan is intentional — handle it fully.
      const lastHandled = seenRef.current.get(code)
      if (
        lastHandled != null &&
        performance.now() - lastHandled < propsRef.current.rescanCooldownMs
      ) {
        setFlash('recognized')
        window.setTimeout(() => setFlash(null), 180)
        return
      }
      seenRef.current.set(code, performance.now())

      // Pause scanning BEFORE calling the host, not after: the decode loop
      // saturates a phone's main thread, and a fetch racing against it takes
      // seconds instead of ~1s. Acknowledge the read immediately so the pause
      // doesn't feel like a hang. Release the camera too — the live capture
      // pipeline holds tens of MB the host's review UI doesn't need.
      busyRef.current = true
      setFlash('recognized')
      buzz(60)
      if (propsRef.current.releaseCameraWhilePaused) stopCamera()

      let outcome: ScanOutcome = 'recognized'
      const t0 = performance.now()
      try {
        outcome = (await propsRef.current.onScan(code)) ?? 'recognized'
      } catch {
        outcome = 'unrecognized'
      }
      diag('handled', { code, ms: Math.round(performance.now() - t0), outcome })
      if (stopped) return
      setFlash(outcome)
      window.setTimeout(() => setFlash(null), 350)
      tone(outcome)
      if (outcome === 'unrecognized') buzz(180)

      busyRef.current = false
      if (propsRef.current.releaseCameraWhilePaused) void startCamera()
    }

    // Pump loop: grab pixels on the main thread (cheap), decode in the worker
    // (heavy). One frame in flight at a time; alternate fast band frames with
    // an occasional tolerant full frame when the band keeps missing.
    //
    // Throttled to PUMP_INTERVAL_MS: each pumped frame allocates + transfers a
    // ~1MB pixel buffer, so pumping at raw rAF speed (60/s) churned ~75MB/s of
    // garbage on the phone. 10/s still confirms a code in ~200ms.
    const confirm = createConfirmState()
    let frameNo = 0
    let inFlight = false
    let postedAt = 0
    let lastPumpAt = 0
    let respawns = 0
    const stats = {
      pumped: 0,
      hits: 0,
      empty: 0,
      grabMs: 0,
      decodeMs: 0,
      decodeMsMax: 0,
      stalls: 0
    }
    let summaryAt = performance.now()

    function spawnWorker(): Worker {
      const w = new Worker(new URL('./scan-worker.ts', import.meta.url), { type: 'module' })
      const init: ScanWorkerInit = { type: 'init', wasmUrl, formats }
      w.postMessage(init)
      w.onerror = (e) => {
        stats.stalls++
        diag('worker-error', { message: e.message ?? 'unknown' })
        respawnWorker('error')
      }
      w.onmessage = (e: MessageEvent<ScanWorkerResponse>) => {
        inFlight = false
        const { code, decodeMs } = e.data
        stats.decodeMs += decodeMs
        if (decodeMs > stats.decodeMsMax) stats.decodeMsMax = decodeMs
        if (stopped) return
        if (!code) {
          stats.empty++
          return
        }
        stats.hits++
        // A checksum can survive a one-digit misread: act only when two
        // consecutive decodes agree.
        const confirmed = confirmScan(confirm, code, performance.now())
        diag(confirmed ? 'decode' : 'decode-pending', { code, frames: frameNo, decodeMs })
        if (confirmed) void handleCode(confirmed)
      }
      return w
    }

    // iOS can kill the worker outright (memory pressure, failed module load).
    // Posting to a dead worker is a silent no-op, so a stall must RESPAWN the
    // worker — clearing the latch alone leaves scanning dead forever.
    function respawnWorker(reason: string): void {
      inFlight = false
      if (stopped) return
      respawns++
      diag('worker-respawn', { reason, respawns })
      try {
        worker.terminate()
      } catch {
        // Already dead — that's why we're here.
      }
      if (respawns > WORKER_MAX_RESPAWNS) {
        setError('The scanner engine keeps crashing — close the scanner and reopen it.')
        return
      }
      worker = spawnWorker()
    }

    let worker = spawnWorker()

    function pumpFrame(now: number): void {
      const v = videoRef.current
      if (busyRef.current || !bandCtx || !tolerantCtx || !v || v.videoWidth === 0) return
      if (inFlight) {
        // Watchdog: a worker that never responds would otherwise freeze
        // scanning forever with no visible symptom.
        if (now - postedAt > WORKER_STALL_MS) {
          stats.stalls++
          diag('worker-stall', { frames: frameNo, stalledMs: Math.round(now - postedAt) })
          respawnWorker('stall')
        }
        return
      }
      if (now - lastPumpAt < PUMP_INTERVAL_MS) return
      lastPumpAt = now
      const vw = v.videoWidth
      const vh = v.videoHeight

      // Every 3rd frame goes tolerant (downscaled full frame, rotation on) so
      // tilted or off-reticle barcodes read; the rest are cheap band frames.
      const tolerant = frameNo % 3 === 2
      const canvas = tolerant ? tolerantCanvas : bandCanvas
      const ctx = tolerant ? tolerantCtx : bandCtx
      let w: number
      let h: number
      if (tolerant) {
        // Cap by AREA, not width: in portrait a "640 wide" full frame was
        // 640×1138 — bigger than the band it's meant to be cheaper than.
        const scale = Math.min(1, Math.sqrt(TOLERANT_MAX_PIXELS / (vw * vh)))
        w = Math.max(1, Math.round(vw * scale))
        h = Math.max(1, Math.round(vh * scale))
      } else {
        w = vw
        h = Math.max(1, Math.round(vh * BAND))
      }
      // Each canvas keeps ONE geometry — dimensions only change if the camera
      // resolution itself changes, so backing stores are never reallocated.
      if (canvas.width !== w) canvas.width = w
      if (canvas.height !== h) canvas.height = h
      if (tolerant) {
        ctx.drawImage(v, 0, 0, vw, vh, 0, 0, w, h)
      } else {
        const bandY = Math.round((vh - h) / 2)
        ctx.drawImage(v, 0, bandY, vw, h, 0, 0, w, h)
      }
      const image = ctx.getImageData(0, 0, w, h)
      stats.grabMs += performance.now() - now
      const request: ScanWorkerRequest = {
        type: 'frame',
        buffer: image.data.buffer,
        width: w,
        height: h,
        mode: tolerant ? 'tolerant' : 'fast'
      }
      inFlight = true
      postedAt = now
      frameNo++
      stats.pumped++
      worker.postMessage(request, [request.buffer])
    }

    function maybeSummarize(now: number): void {
      if (!propsRef.current.onDiagnostic) return
      if (now - summaryAt < 2000 || stats.pumped === 0) return
      const done = stats.hits + stats.empty
      diag('summary', {
        pumpPerSec: Math.round((stats.pumped / (now - summaryAt)) * 1000),
        pumped: stats.pumped,
        hits: stats.hits,
        empty: stats.empty,
        avgGrabMs: Math.round((stats.grabMs / stats.pumped) * 10) / 10,
        avgDecodeMs: done ? Math.round(stats.decodeMs / done) : null,
        maxDecodeMs: stats.decodeMsMax,
        stalls: stats.stalls
      })
      stats.pumped = stats.hits = stats.empty = 0
      stats.grabMs = stats.decodeMs = stats.decodeMsMax = stats.stalls = 0
      summaryAt = now
    }

    async function scanLoop(): Promise<void> {
      while (!stopped) {
        try {
          const now = performance.now()
          pumpFrame(now)
          maybeSummarize(now)
        } catch {
          // Frame not ready (e.g. camera still starting) — keep going.
        }
        // Yield a frame so the video preview stays smooth between decodes.
        await new Promise((resolve) => requestAnimationFrame(() => resolve(null)))
      }
    }

    async function startCamera(): Promise<boolean> {
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: {
            facingMode: { ideal: 'environment' },
            width: { ideal: resolution.width },
            height: { ideal: resolution.height }
          }
        })
        if (stopped) {
          stopCamera()
          return false
        }
        if (videoRef.current) {
          videoRef.current.srcObject = stream
          await videoRef.current.play().catch(() => {})
        }
        return true
      } catch (err) {
        setError(cameraErrorMessage(err))
        return false
      }
    }

    function stopCamera(): void {
      stream?.getTracks().forEach((t) => t.stop())
      stream = undefined
      if (videoRef.current) videoRef.current.srcObject = null
    }

    async function start(): Promise<void> {
      if (!(await startCamera())) return
      diag('start', {
        videoW: videoRef.current?.videoWidth ?? 0,
        videoH: videoRef.current?.videoHeight ?? 0,
        ua: navigator.userAgent.slice(0, 80)
      })
      void scanLoop()
    }
    void start()

    return () => {
      stopped = true
      worker.terminate()
      stopCamera()
      // Release the audio hardware — contexts are a limited resource and an
      // unclosed one leaks per scanner open. close() is async; fire and forget.
      try {
        void audioRef.current?.close().catch(() => {})
      } catch {
        // already closed / not supported — nothing to release.
      }
      audioRef.current = null
    }
    // formats / wasmUrl / resolution are read once at mount by design: changing
    // the engine mid-session would mean tearing the camera down anyway.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [once])

  return (
    <div
      className={`cam-scan${className ? ` ${className}` : ''}`}
      role="dialog"
      aria-label="Camera barcode scanner"
      onPointerDown={() => void audioRef.current?.resume().catch(() => {})}
    >
      <div className="cam-scan__bar">
        <span className="cam-scan__title">{title ?? (once ? 'Scan barcode' : 'Camera scan')}</span>
        <button type="button" className="cam-scan__close" onClick={onClose} aria-label="Close">
          ✕
        </button>
      </div>

      <div className={`cam-scan__stage${flash ? ` cam-scan__stage--${flash}` : ''}`}>
        {error ? (
          <p className="cam-scan__error">{error}</p>
        ) : (
          <>
            <video ref={videoRef} className="cam-scan__video" playsInline muted autoPlay />
            <div className="cam-scan__reticle" aria-hidden="true" />
            <p className="cam-scan__hint">{hint ?? 'Point at the barcode'}</p>
          </>
        )}
      </div>
    </div>
  )
}
