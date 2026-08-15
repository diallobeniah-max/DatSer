import React, { useCallback, useEffect, useRef, useState } from 'react'
import {
  Camera,
  ChevronsDown,
  ChevronsUp,
  Flashlight,
  FlashlightOff,
  Loader2,
  RefreshCcw,
  ScanLine,
  X,
  ZoomIn,
  ZoomOut
} from 'lucide-react'
import { canvasToDataUrl } from '../utils/paperScanImage'
import {
  AUTO_CAPTURE_STATUS,
  createAutoCaptureTracker,
  detectDocumentCorners,
  polygonArea,
  smoothCorners
} from '../utils/documentScan'
import {
  analysisToDisplay,
  createDetectionLoop,
  displayCornersToVideo,
  drawDocumentOutline,
  setTorch,
  torchSupported
} from '../utils/paperScanCamera'
import { getQrCameraConstraintCandidates } from '../utils/qrCheckIn'

const NORMALIZED_DEFAULT_CORNERS = [
  { x: 0.08, y: 0.08 },
  { x: 0.92, y: 0.08 },
  { x: 0.92, y: 0.92 },
  { x: 0.08, y: 0.92 }
]

const clamp01 = (value) => Math.max(0, Math.min(1, value))

const detectToStatus = (state) => {
  switch (state) {
    case AUTO_CAPTURE_STATUS.HOLDING:
      return 'holding'
    case AUTO_CAPTURE_STATUS.STABLE:
    case AUTO_CAPTURE_STATUS.READY:
      return 'found'
    default:
      return 'searching'
  }
}

// Reads the full-resolution current video frame as a data URL. Returns null
// before the video has real frames or if encoding fails.
const captureFrame = (video) => {
  if (!video || !video.videoWidth || !video.videoHeight) return null
  const canvas = document.createElement('canvas')
  canvas.width = video.videoWidth
  canvas.height = video.videoHeight
  const context = canvas.getContext('2d')
  if (!context) return null
  context.drawImage(video, 0, 0, canvas.width, canvas.height)
  const dataUrl = canvasToDataUrl(canvas)
  if (!dataUrl) return null
  return { dataUrl, width: canvas.width, height: canvas.height }
}

const DocumentCameraModal = ({ isOpen, onClose, onCaptured }) => {
  const videoRef = useRef(null)
  const trackRef = useRef(null)
  const overlayRef = useRef(null)
  const previewRef = useRef(null)
  const detectionRef = useRef(null) // smoothed corners from the last tick
  const analysisTargetRef = useRef(null)
  const displaySizeRef = useRef({ width: 0, height: 0 })
  const trackerRef = useRef(null)
  const loopRef = useRef(null)
  const runningRef = useRef(false)
  const captureBusyRef = useRef(false)
  const autoCaptureRef = useRef(true)

  const [status, setStatus] = useState('Starting camera...')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [cameraIndex, setCameraIndex] = useState(0)
  const [cameraCount, setCameraCount] = useState(1)
  const [torchOn, setTorchOn] = useState(false)
  const [autoCapture, setAutoCapture] = useState(true)
  const [detectStatus, setDetectStatus] = useState('searching')
  const [mode, setMode] = useState('live')
  const [captured, setCaptured] = useState(null)
  const [manualCorners, setManualCorners] = useState(NORMALIZED_DEFAULT_CORNERS)
  const [dragIndex, setDragIndex] = useState(null)

  useEffect(() => {
    autoCaptureRef.current = autoCapture
  }, [autoCapture])

  const stopCamera = useCallback(() => {
    runningRef.current = false
    loopRef.current?.stop()
    loopRef.current = null
    captureBusyRef.current = false
    trackRef.current?.stop()
    trackRef.current = null
    if (videoRef.current) videoRef.current.srcObject = null
    trackerRef.current = null
    detectionRef.current = null
    analysisTargetRef.current = null
  }, [])

  const handleCaptureNow = useCallback((documentCorners) => {
    if (captureBusyRef.current) return
    captureBusyRef.current = true
    setBusy(true)
    runningRef.current = false
    loopRef.current?.stop()
    const video = videoRef.current
    if (!video) {
      captureBusyRef.current = false
      setBusy(false)
      return
    }
    const frame = captureFrame(video)
    if (!frame) {
      captureBusyRef.current = false
      setBusy(false)
      return
    }
    const analysis = analysisTargetRef.current
    let videoCorners = null
    if (documentCorners && analysis) {
      try {
        const displayCorners = analysisToDisplay({
          corners: documentCorners,
          analysisWidth: analysis.width,
          analysisHeight: analysis.height,
          displayWidth: analysis.dispWidth,
          displayHeight: analysis.dispHeight
        })
        videoCorners = displayCornersToVideo({
          corners: displayCorners,
          videoWidth: frame.width,
          videoHeight: frame.height,
          displayWidth: analysis.dispWidth,
          displayHeight: analysis.dispHeight
        })
      } catch {
        videoCorners = null
      }
    }
    captureBusyRef.current = false
    setBusy(false)
    setCaptured({ ...frame, corners: videoCorners })
    setManualCorners(videoCorners
      ? videoCorners.map((p) => ({ x: clamp01(p.x / frame.width), y: clamp01(p.y / frame.height) }))
      : NORMALIZED_DEFAULT_CORNERS)
    setMode('crop')
    setStatus(videoCorners ? 'Adjust the corners, then Apply Crop' : 'No document detected — drag the corners, then Apply Crop')
  }, [])

  // One detection pass: analyze the current frame, smooth, update status/outline.
  const detectAndDraw = useCallback(() => {
    const video = videoRef.current
    const display = displaySizeRef.current
    if (!video || !video.videoWidth || !video.videoHeight || !display.width || !display.height) return
    const vidWidth = video.videoWidth
    const vidHeight = video.videoHeight

    // Analysis canvas keeps the DISPLAY aspect (what object-cover shows).
    let width
    let height
    if (display.width >= display.height) {
      width = Math.min(Math.round(display.width), 640)
      height = Math.max(2, Math.round(width * display.height / display.width))
    } else {
      height = Math.min(Math.round(display.height), 640)
      width = Math.max(2, Math.round(height * display.width / display.height))
    }
    const canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = height
    const ctx = canvas.getContext('2d', { willReadFrequently: true })
    if (!ctx) return
    const scale = Math.max(display.width / vidWidth, display.height / vidHeight)
    const srcW = display.width / scale
    const srcH = display.height / scale
    const srcX = (vidWidth - srcW) / 2
    const srcY = (vidHeight - srcH) / 2
    ctx.drawImage(video, srcX, srcY, srcW, srcH, 0, 0, width, height)
    let imageData
    try {
      imageData = ctx.getImageData(0, 0, width, height)
    } catch {
      return
    }
    const detected = detectDocumentCorners({
      rgba: imageData.data,
      width: imageData.width,
      height: imageData.height,
      options: { minAreaFraction: 0.08, minPoints: 200 }
    })
    let smoothed = detected
    const previous = detectionRef.current
    if (previous && smoothed) smoothed = smoothCorners(previous, smoothed, 0.35)
    detectionRef.current = smoothed

    const tracker = trackerRef.current
    if (!tracker) return
    const areaFraction = smoothed ? polygonArea(smoothed) / (width * height) : 0
    const result = tracker.tick({ corners: smoothed, areaFraction })
    const nextStatus = detectToStatus(result.status)
    setDetectStatus((current) => (current === nextStatus ? current : nextStatus))
    analysisTargetRef.current = { width, height, dispWidth: display.width, dispHeight: display.height }

    const overlay = overlayRef.current
    if (overlay) {
      if (overlay.width !== display.width || overlay.height !== display.height) {
        overlay.width = display.width
        overlay.height = display.height
      }
      const overlayCtx = overlay.getContext('2d')
      if (!overlayCtx) return
      overlayCtx.setTransform(1, 0, 0, 1, 0, 0)
      const confirmed = result.status === AUTO_CAPTURE_STATUS.STABLE || result.status === AUTO_CAPTURE_STATUS.READY
      if (smoothed) {
        const displayCorners = analysisToDisplay({
          corners: smoothed,
          analysisWidth: width,
          analysisHeight: height,
          displayWidth: display.width,
          displayHeight: display.height
        })
        drawDocumentOutline({ canvas: overlay, corners: displayCorners, confirmed })
      } else {
        overlayCtx.clearRect(0, 0, overlay.width, overlay.height)
      }
    }

    if (autoCaptureRef.current && result.shouldCapture) {
      handleCaptureNow(smoothed)
    }
  }, [handleCaptureNow])

  useEffect(() => {
    if (!isOpen) {
      stopCamera()
      return undefined
    }
    if (mode !== 'live') return undefined
    let disposed = false
    setError('')
    setStatus('Starting camera...')
    setBusy(false)
    setCaptured(null)
    setManualCorners(NORMALIZED_DEFAULT_CORNERS)
    setDetectStatus('searching')
    setTorchOn(false)
    detectionRef.current = null
    trackerRef.current = createAutoCaptureTracker({
      requiredHoldFrames: 5,
      movementThreshold: 4,
      resetFrames: 4
    })

    const start = async () => {
      if (!navigator.mediaDevices?.getUserMedia) {
        setError('Camera capture is not supported in this browser. You can still upload an image.')
        return
      }
      let candidates = getQrCameraConstraintCandidates([])
      try {
        trackRef.current?.stop()
        trackRef.current = null
        let videoDevices = []
        if (navigator.mediaDevices?.enumerateDevices) {
          try {
            videoDevices = (await navigator.mediaDevices.enumerateDevices()).filter((device) => device.kind === 'videoinput')
          } catch {
            videoDevices = []
          }
        }
        setCameraCount(Math.max(1, videoDevices.length))
        candidates = getQrCameraConstraintCandidates(videoDevices)
        const constraints = candidates[cameraIndex] || candidates[0] || { audio: false, video: true }
        const stream = await navigator.mediaDevices.getUserMedia(constraints)
        if (disposed) {
          stream.getTracks().forEach((track) => track.stop())
          return
        }
        videoRef.current.srcObject = stream
        trackRef.current = stream.getVideoTracks()[0]
        try {
          await videoRef.current.play()
          setStatus(autoCaptureRef.current ? 'Point at the sheet' : 'Hold the sheet steady, then tap Capture')
        } catch (playError) {
          if (disposed) return
          setStatus('')
          setError('The camera feed opened but playback failed. You can retry, switch sheets, or upload an image instead.')
        }
      } catch (cameraError) {
        if (cameraError?.name !== 'NotAllowedError' && cameraIndex < Math.max(candidates.length - 1, 0)) {
          setStatus('Trying another camera...')
          setCameraIndex((index) => index + 1)
          return
        }
        setError(cameraError?.name === 'NotAllowedError'
          ? 'Camera access was blocked. Allow camera permission and try again.'
          : 'Could not open a usable camera. Check that another app is not using it, or upload an image instead.')
      }
    }

    start()

    // Poll until the video has a real frame and a layout size, then run CV on a
    // throttled interval. Everything is torn down on close/unmount.
    let bootTimer = null
    let bootCleanup = null
    bootTimer = window.setInterval(() => {
      if (disposed) return
      const video = videoRef.current
      if (!video || !video.videoWidth || !video.videoHeight) return
      const rect = video.getBoundingClientRect ? video.getBoundingClientRect() : null
      if (!rect || rect.width < 2 || rect.height < 2) return
      window.clearInterval(bootTimer)
      displaySizeRef.current = { width: rect.width, height: rect.height }
      runningRef.current = true
      loopRef.current = createDetectionLoop({
        intervalMs: 120,
        tick: () => {
          if (!runningRef.current) return
          try {
            detectAndDraw()
          } catch {
            // Detection must never kill the camera.
          }
        }
      })
      loopRef.current.start()
      bootCleanup = () => runningRef.current = false
    }, 100)

    return () => {
      disposed = true
      window.clearInterval(bootTimer)
      if (bootCleanup) bootCleanup()
      stopCamera()
    }
  }, [isOpen, mode, cameraIndex])

  useEffect(() => {
    if (!isOpen) return undefined
    const onKey = (event) => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [isOpen, onClose])

  const handleRetake = () => {
    setMode('live')
    setCaptured(null)
    setManualCorners(NORMALIZED_DEFAULT_CORNERS)
    setDetectStatus('searching')
    setStatus(autoCaptureRef.current ? 'Point at the sheet' : 'Hold the sheet steady, then tap Capture')
    trackerRef.current = createAutoCaptureTracker({
      requiredHoldFrames: 5,
      movementThreshold: 4,
      resetFrames: 4
    })
  }

  const handleApplyCrop = async () => {
    if (!captured || busy) return
    setBusy(true)
    try {
      const videoCorners = manualCorners.map((p) => ({
        x: clamp01(p.x) * captured.width,
        y: clamp01(p.y) * captured.height
      }))
      const { straightenDocument } = await import('../utils/paperScanCamera')
      let result = captured.dataUrl
      try {
        const straightened = await straightenDocument({
          dataUrl: captured.dataUrl,
          corners: videoCorners,
          sourceWidth: captured.width,
          sourceHeight: captured.height
        })
        result = straightened || captured.dataUrl
      } catch {
        result = captured.dataUrl
      }
      onCaptured(result)
      onClose()
    } finally {
      setBusy(false)
    }
  }

  const handleManualCapture = () => {
    if (busy || mode !== 'live') return
    handleCaptureNow(detectionRef.current)
  }

  const toggleTorch = async () => {
    if (!trackRef.current) return
    const next = !torchOn
    if (await setTorch(trackRef.current, next)) setTorchOn(next)
  }

  const handleResetCorners = () => setManualCorners(NORMALIZED_DEFAULT_CORNERS)

  const handlePointerDown = (event, index) => {
    event.preventDefault()
    setDragIndex(index)
    try {
      event.currentTarget.setPointerCapture?.(event.pointerId)
    } catch {
      // Pointer capture is optional; dragging still works without it.
    }
  }
  const handlePointerMove = (event) => {
    if (dragIndex === null || !previewRef.current) return
    const rect = previewRef.current.getBoundingClientRect()
    if (!rect.width || !rect.height) return
    // PointerEvent carries clientX/Y in browsers; jsdom omits them, so fall back
    // to percent-based coordinates when available.
    const clientX = event.clientX ?? event.layerX
    const clientY = event.clientY ?? event.layerY
    if (clientX == null || clientY == null) return
    const nx = clamp01((clientX - rect.left) / rect.width)
    const ny = clamp01((clientY - rect.top) / rect.height)
    setManualCorners((prev) => prev.map((p, index) => (index === dragIndex ? { x: nx, y: ny } : p)))
  }
  const handlePointerUp = () => setDragIndex(null)

  const applyZoom = (delta) => {
    const track = trackRef.current
    if (!track?.applyConstraints || !track.getCapabilities) return
    let capabilities
    try {
      capabilities = track.getCapabilities()
    } catch {
      return
    }
    if (!capabilities?.zoom) return
    const value = capabilities.zoom.value ?? capabilities.zoom.min ?? 1
    const next = Math.max(capabilities.zoom.min ?? 1, Math.min(capabilities.zoom.max ?? 4, value + delta))
    track.applyConstraints({ advanced: [{ zoom: next }] }).catch(() => {})
  }

  const zoomEnabled = (() => {
    const track = trackRef.current
    if (!track?.getCapabilities) return false
    try {
      return Boolean(track.getCapabilities()?.zoom)
    } catch {
      return false
    }
  })()
  const torchAvailable = torchSupported(trackRef.current)

  if (!isOpen) return null

  return (
    <div
      className="fixed inset-0 z-[160] flex flex-col bg-black/90 backdrop-blur-xl"
      role="dialog"
      aria-modal="true"
      aria-label="Capture paper sheet"
    >
      <div className="flex items-center justify-between border-b border-white/10 px-4 py-3">
        <div className="flex items-center gap-3">
          <span className="grid h-10 w-10 place-items-center rounded-xl bg-orange-500/15 text-orange-300"><ScanLine className="h-5 w-5" /></span>
          <div>
            <p className="font-black">{mode === 'crop' ? 'Adjust the scan' : 'Document camera'}</p>
            <p className="text-xs text-white/50">Stays on this device until you run extraction</p>
          </div>
        </div>
        <button type="button" onClick={onClose} className="grid h-10 w-10 place-items-center rounded-full bg-white/8 text-white/80 transition hover:bg-white/15" aria-label="Close camera"><X className="h-5 w-5" /></button>
      </div>

      {mode === 'live' ? (
        <>
          <div className="relative min-h-0 flex-1 overflow-hidden bg-black">
            <video ref={videoRef} className="h-full w-full object-cover" muted playsInline />
            <canvas ref={overlayRef} className="pointer-events-none absolute inset-0 h-full w-full" aria-hidden="true" />
            {status === 'Starting camera...' && !error && (
              <div className="absolute inset-0 grid place-items-center"><Loader2 className="h-8 w-8 animate-spin text-orange-400" /></div>
            )}
            {error && (
              <div className="absolute inset-0 flex flex-col items-center justify-center gap-4 px-8 text-center">
                <span className="grid h-16 w-16 place-items-center rounded-2xl bg-red-500/15 text-red-300"><Camera className="h-8 w-8" /></span>
                <p className="max-w-xs font-bold">{error}</p>
              </div>
            )}
          </div>

          <div className="border-t border-white/10 px-4 py-2">
            {!error && (
              <div className="flex flex-col items-center gap-0.5">
                <p role="status" aria-live="polite" className="text-center text-sm font-bold text-white/90">
                  {detectStatus === 'holding' ? 'Hold steady…' : detectStatus === 'found' ? 'DOCUMENT FOUND' : 'SEARCHING FOR DOCUMENT'}
                </p>
                {status && status !== 'Starting camera...' && (
                  <p className="text-center text-xs font-medium text-white/50">{status}</p>
                )}
              </div>
            )}
          </div>

          <div className="flex flex-wrap items-center justify-between gap-2 border-t border-white/10 px-4 py-3 pb-[calc(1rem+env(safe-area-inset-bottom))]">
            <div className="flex flex-wrap items-center gap-2">
              <label className="grid h-11 w-11 cursor-pointer place-items-center rounded-full bg-white/10 text-white/80 transition hover:bg-white/20 hover:text-white" title="Upload a photo instead">
                <input
                  type="file"
                  accept="image/*"
                  aria-label="Upload photo instead"
                  className="sr-only"
                  onChange={(event) => {
                    const file = event.target.files?.[0]
                    event.target.value = ''
                    if (!file) return
                    const reader = new FileReader()
                    reader.onload = () => {
                      stopCamera()
                      onCaptured(reader.result)
                      onClose()
                    }
                    reader.readAsDataURL(file)
                  }}
                />
                <ChevronsUp className="h-5 w-5" />
              </label>
              {cameraCount > 1 && (
                <button
                  type="button"
                  onClick={() => setCameraIndex((index) => (index + 1) % cameraCount)}
                  aria-label="Switch camera"
                  className="grid h-11 w-11 place-items-center rounded-full bg-white/10 text-white/80 transition hover:bg-white/20 hover:text-white"
                >
                  <RefreshCcw className="h-5 w-5" />
                </button>
              )}
            </div>

            <button
              type="button"
              onClick={handleManualCapture}
              disabled={busy}
              aria-label="Capture sheet"
              className={`relative grid h-16 w-16 shrink-0 place-items-center rounded-full border-4 transition ${busy ? 'border-white/30' : 'border-white/70 hover:border-white'}`}
            >
              <span className={`grid h-14 w-14 place-items-center rounded-full ${busy ? 'bg-white/20' : 'bg-orange-500'}`}>
                {busy ? <Loader2 className="h-6 w-6 animate-spin text-white" /> : <Camera className="h-6 w-6 text-white" />}
              </span>
            </button>

            <div className="flex flex-wrap items-center gap-2">
              {torchAvailable && (
                <button
                  type="button"
                  onClick={toggleTorch}
                  aria-label={torchOn ? 'Turn flashlight off' : 'Turn flashlight on'}
                  className={`grid h-11 w-11 place-items-center rounded-full transition ${torchOn ? 'bg-orange-500 text-white' : 'bg-white/10 text-white/80 hover:bg-white/20'}`}
                >
                  {torchOn ? <Flashlight className="h-5 w-5" /> : <FlashlightOff className="h-5 w-5" />}
                </button>
              )}
              {zoomEnabled && (
                <>
                  <button type="button" onClick={() => applyZoom(1)} aria-label="Zoom in" className="grid h-11 w-11 place-items-center rounded-full bg-white/10 text-white/80 transition hover:bg-white/20"><ZoomIn className="h-5 w-5" /></button>
                  <button type="button" onClick={() => applyZoom(-1)} aria-label="Zoom out" className="grid h-11 w-11 place-items-center rounded-full bg-white/10 text-white/80 transition hover:bg-white/20"><ZoomOut className="h-5 w-5" /></button>
                </>
              )}
              <button
                type="button"
                onClick={() => setAutoCapture((value) => !value)}
                aria-pressed={autoCapture}
                className={`flex min-h-[44px] items-center rounded-full px-4 text-xs font-black transition ${autoCapture ? 'bg-orange-500/90 text-white' : 'bg-white/10 text-white/80 hover:bg-white/20'}`}
              >
                Auto capture: {autoCapture ? 'On' : 'Off'}
              </button>
            </div>
          </div>
        </>
      ) : (
        <>
          <div className="relative flex min-h-0 flex-1 items-center justify-center overflow-hidden bg-black p-4">
            <div
              ref={previewRef}
              className="relative max-h-full max-w-full touch-none"
              style={{ aspectRatio: captured ? `${captured.width} / ${captured.height}` : undefined }}
              onPointerMove={handlePointerMove}
              onPointerUp={handlePointerUp}
              onPointerLeave={handlePointerUp}
            >
              <img
                src={captured?.dataUrl}
                alt="Captured sheet for cropping"
                className="block max-h-full max-w-full"
              />
              {manualCorners.map((point, index) => (
                <button
                  key={index}
                  type="button"
                  onPointerDown={(event) => handlePointerDown(event, index)}
                  aria-label={`Corner ${index + 1}`}
                  className="absolute h-7 w-7 -translate-x-1/2 -translate-y-1/2 touch-none rounded-full border-2 border-white bg-orange-500/90 shadow"
                  style={{ left: `${(point.x * 100).toFixed(2)}%`, top: `${(point.y * 100).toFixed(2)}%` }}
                />
              ))}
            </div>
            <div className="pointer-events-none absolute inset-0" aria-hidden="true">
              <svg viewBox="0 0 100 100" preserveAspectRatio="none" className="h-full w-full" fill="none">
                <polygon
                  points={`${manualCorners.map((p) => `${(p.x * 100)},${(p.y * 100)}`).join(' ')}`}
                  stroke="white"
                  strokeWidth="1.5"
                />
              </svg>
            </div>
          </div>
          <div className="flex flex-wrap items-center justify-between gap-2 border-t border-white/10 px-4 py-4 pb-[calc(1rem+env(safe-area-inset-bottom))]">
            <div className="flex flex-wrap items-center gap-2">
              <button type="button" onClick={handleRetake} className="flex min-h-[44px] items-center gap-1.5 rounded-full bg-white/10 px-4 text-white/80 transition hover:bg-white/20">
                <RefreshCcw className="h-4 w-4" />
                Retake
              </button>
              <button type="button" onClick={handleResetCorners} className="flex min-h-[44px] items-center gap-1.5 rounded-full bg-white/10 px-4 text-white/80 transition hover:bg-white/20">
                <ChevronsDown className="h-4 w-4" />
                Reset
              </button>
              {status && <p className="min-w-0 max-w-[16rem] truncate text-xs font-semibold text-white/50">{status}</p>}
            </div>
            <button
              type="button"
              onClick={handleApplyCrop}
              disabled={busy || !captured}
              className="flex min-h-[44px] items-center justify-center gap-1.5 rounded-full bg-orange-500 px-5 font-black text-white transition hover:bg-orange-400 disabled:opacity-60"
            >
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              {busy ? 'Applying…' : 'Apply Crop'}
            </button>
          </div>
        </>
      )}
    </div>
  )
}

export default DocumentCameraModal