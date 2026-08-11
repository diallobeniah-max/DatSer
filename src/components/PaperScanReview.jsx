import React, { useEffect, useMemo, useRef, useState } from 'react'
import {
  ArrowLeft,
  Camera,
  Check,
  ImagePlus,
  Layers,
  Loader2,
  RefreshCw,
  ScanLine,
  ShieldCheck,
  Sparkles,
  Trash2,
  Upload,
  X
} from 'lucide-react'
import {
  ENHANCEMENT_PRESETS,
  PRESET_DEFAULT_INTENSITY,
  applyEnhancement,
  canvasToDataUrl,
  loadImageElement,
  readFileAsDataUrl,
  validateImageFile
} from '../utils/paperScanImage'
import { getQrCameraConstraintCandidates } from '../utils/qrCheckIn'

const PRESET_ICON_LABEL = {
  original: 'Original capture',
  grayscale: 'Removes color to reduce glare',
  'high-contrast': 'Boldens ink against the page',
  'darken-handwriting': 'Darkens handwritten marks for clarity',
  sharpen: 'Tightens edges for sharper text'
}

const PROCESSING_PHASES = [
  { label: 'Preparing images...', progress: 25 },
  { label: 'Enhancing sheets...', progress: 55 },
  { label: 'Encoding local previews...', progress: 80 },
  { label: 'Ready for AI connection', progress: 100 }
]

// Coalesce slider-driven preview re-renders; only the latest intensity is processed.
const PREVIEW_DEBOUNCE_MS = 130

const createSheetId = () => `sheet-${Date.now()}-${Math.random().toString(16).slice(2)}`

const CameraCaptureModal = ({ isOpen, onClose, onCaptured }) => {
  const videoRef = useRef(null)
  const trackRef = useRef(null)
  const [status, setStatus] = useState('Starting camera...')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [cameraIndex, setCameraIndex] = useState(0)

  useEffect(() => {
    if (!isOpen) return undefined
    let disposed = false
    setError('')
    setStatus('Starting camera...')
    setBusy(false)

    const start = async () => {
      if (!navigator.mediaDevices?.getUserMedia) {
        setError('Camera capture is not supported in this browser. You can still upload an image.')
        return
      }
      let candidates = getQrCameraConstraintCandidates([])
      try {
        trackRef.current?.stop()
        trackRef.current = null
        const videoDevices = navigator.mediaDevices?.enumerateDevices
          ? (await navigator.mediaDevices.enumerateDevices()).filter((device) => device.kind === 'videoinput')
          : []
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
          setStatus('Hold the sheet steady, then tap Capture')
        } catch (playError) {
          if (disposed) return
          setStatus('')
          setError('The camera feed opened but playback failed. You can retry, switch sheets, or upload an image instead.')
        }
      } catch (cameraError) {
        if (cameraError?.name !== 'NotAllowedError' && cameraIndex < candidates.length - 1) {
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
    return () => {
      disposed = true
      trackRef.current?.stop()
      trackRef.current = null
      if (videoRef.current) videoRef.current.srcObject = null
    }
  }, [cameraIndex, isOpen])

  const captureFrame = () => {
    const video = videoRef.current
    if (!video || !video.videoWidth) return
    setBusy(true)
    try {
      const canvas = document.createElement('canvas')
      canvas.width = video.videoWidth
      canvas.height = video.videoHeight
      const context = canvas.getContext('2d')
      if (!context) {
        setError('Could not prepare the camera frame.')
        setBusy(false)
        return
      }
      context.drawImage(video, 0, 0, canvas.width, canvas.height)
      const dataUrl = canvasToDataUrl(canvas)
      if (!dataUrl) {
        setError('Could not encode the camera frame.')
        setBusy(false)
        return
      }
      trackRef.current?.stop()
      onCaptured(dataUrl)
      onClose()
    } catch {
      setError('Could not capture the camera frame. Try again.')
      setBusy(false)
    }
  }

  if (!isOpen) return null

  return (
    <div className="fixed inset-0 z-[160] flex items-center justify-center bg-black/85 p-3 backdrop-blur-xl" role="dialog" aria-modal="true" aria-label="Capture paper sheet">
      <div className="relative flex h-[min(88vh,46rem)] w-full max-w-lg flex-col overflow-hidden rounded-[1.75rem] border border-orange-400/35 bg-[#090b0d] text-white shadow-[0_30px_100px_rgba(0,0,0,0.65)]">
        <div className="flex items-center justify-between border-b border-white/10 px-4 py-3">
          <div className="flex items-center gap-3">
            <span className="grid h-10 w-10 place-items-center rounded-xl bg-orange-500/15 text-orange-300"><ScanLine className="h-5 w-5" /></span>
            <div><p className="font-black">Capture paper sheet</p><p className="text-xs text-white/50">Stay local — the photo never leaves this device</p></div>
          </div>
          <button type="button" onClick={onClose} className="grid h-10 w-10 place-items-center rounded-full bg-white/8 text-white/80 transition hover:bg-white/15" aria-label="Close camera"><X className="h-5 w-5" /></button>
        </div>

        <div className="relative min-h-0 flex-1 overflow-hidden bg-black">
          <video ref={videoRef} className="h-full w-full object-cover" muted playsInline />
          {status === 'Starting camera...' && !error && <div className="absolute inset-0 grid place-items-center"><Loader2 className="h-8 w-8 animate-spin text-orange-400" /></div>}
          {error && <div className="absolute inset-0 flex flex-col items-center justify-center gap-4 px-8 text-center"><span className="grid h-16 w-16 place-items-center rounded-2xl bg-red-500/15 text-red-300"><Camera className="h-8 w-8" /></span><p className="max-w-xs font-bold">{error}</p></div>}
        </div>

        <div className="flex items-center gap-3 border-t border-white/10 px-4 py-4">
          {!error && (
            <button
              type="button"
              onClick={captureFrame}
              disabled={busy}
              className="flex min-h-[48px] flex-1 items-center justify-center gap-2 rounded-2xl bg-orange-500 px-4 py-3 font-black text-white transition hover:bg-orange-400 disabled:opacity-60"
            >
              {busy ? <Loader2 className="h-5 w-5 animate-spin" /> : <Camera className="h-5 w-5" />}
              {busy ? 'Capturing...' : 'Capture sheet'}
            </button>
          )}
          <p className="min-w-0 flex-1 text-sm font-semibold text-white/70" aria-live="polite">{error || status}</p>
        </div>
      </div>
    </div>
  )
}

const PaperScanReview = ({ onBack }) => {
  const [sheets, setSheets] = useState([])
  const [activeSheetId, setActiveSheetId] = useState(null)
  const [isScanning, setIsScanning] = useState(false)
  const [processing, setProcessing] = useState(false)
  const [error, setError] = useState('')
  const [showCamera, setShowCamera] = useState(false)
  const [stage, setStage] = useState('idle') // idle | processing | ready
  const [phaseIndex, setPhaseIndex] = useState(0)
  const fileInputRef = useRef(null)
  const phaseTimerRef = useRef(null)
  const scanTimerRef = useRef(null)
  const previewTimerRef = useRef(null)
  const pendingPreviewRef = useRef(null)

  const activeSheet = useMemo(
    () => sheets.find((sheet) => sheet.id === activeSheetId) || null,
    [sheets, activeSheetId]
  )

  const presetMeta = useMemo(() => ENHANCEMENT_PRESETS, [])

  useEffect(() => () => {
    if (phaseTimerRef.current) window.clearTimeout(phaseTimerRef.current)
    if (scanTimerRef.current) window.clearTimeout(scanTimerRef.current)
    if (previewTimerRef.current) window.clearTimeout(previewTimerRef.current)
  }, [])

  const cancelScanTimer = () => {
    if (scanTimerRef.current) {
      window.clearTimeout(scanTimerRef.current)
      scanTimerRef.current = null
    }
  }

  const cancelPendingPreview = () => {
    if (previewTimerRef.current) {
      window.clearTimeout(previewTimerRef.current)
      previewTimerRef.current = null
    }
    pendingPreviewRef.current = null
  }

  // Schedule a coalesced preview re-render; only the latest requested intensity wins.
  const schedulePreview = (sheetId, presetId, intensity) => {
    cancelPendingPreview()
    pendingPreviewRef.current = { sheetId, presetId, intensity }
    previewTimerRef.current = window.setTimeout(() => {
      const pending = pendingPreviewRef.current
      previewTimerRef.current = null
      pendingPreviewRef.current = null
      if (!pending) return
      setSheets((prev) =>
        prev.map((sheet) => {
          if (sheet.id !== pending.sheetId) return sheet
          const preview = renderEnhanced(sheet, pending.presetId, pending.intensity)
          return { ...sheet, preview }
        })
      )
    }, PREVIEW_DEBOUNCE_MS)
  }

  const selectSheet = (sheetId) => {
    cancelPendingPreview()
    cancelScanTimer()
    setActiveSheetId(sheetId)
    setIsScanning(false)
  }

  const renderEnhanced = (sheet, presetId, intensity) => {
    try {
      const canvas = applyEnhancement(sheet.image, presetId, { intensity })
      const preview = canvasToDataUrl(canvas)
      return preview || sheet.dataUrl
    } catch {
      return sheet.dataUrl
    }
  }

  const addSheet = async (dataUrl, sourceLabel) => {
    setProcessing(true)
    setError('')
    try {
      const image = await loadImageElement(dataUrl)
      const sheet = {
        id: createSheetId(),
        dataUrl,
        source: sourceLabel,
        image,
        preset: 'original',
        intensity: PRESET_DEFAULT_INTENSITY.original,
        preview: dataUrl
      }
      setSheets((prev) => [...prev, sheet])
      setActiveSheetId(sheet.id)
      setIsScanning(true)
      cancelScanTimer()
      scanTimerRef.current = window.setTimeout(() => setIsScanning(false), 2400)
    } catch (loadError) {
      setError(loadError?.message || 'Could not load this image.')
    } finally {
      setProcessing(false)
    }
  }

  const handleFileSelected = async (event) => {
    const files = Array.from(event.target.files || [])
    event.target.value = ''
    if (!files.length) return
    setError('')
    let added = 0
    let skipped = 0
    let skippedReason = ''
    for (const file of files) {
      const validation = validateImageFile(file)
      if (!validation.ok) {
        skipped += 1
        skippedReason = validation.reason
        continue
      }
      try {
        const dataUrl = await readFileAsDataUrl(file)
        await addSheet(dataUrl, file.name)
        added += 1
      } catch (readError) {
        skipped += 1
        skippedReason = readError?.message || 'The selected image could not be read.'
      }
    }
    if (skipped > 0) {
      setError(`${skipped} file${skipped === 1 ? ' was' : 's were'} skipped (${skippedReason || 'not a supported image'}). ${added} file${added === 1 ? ' was' : 's were'} added.`)
    }
  }

  const handleCaptured = async (dataUrl) => {
    await addSheet(dataUrl, 'Camera capture')
  }

  const handlePresetChange = async (presetId) => {
    if (!activeSheet) return
    cancelPendingPreview()
    const intensity = PRESET_DEFAULT_INTENSITY[presetId]
    setSheets((prev) =>
      prev.map((sheet) => {
        if (sheet.id !== activeSheet.id) return sheet
        const preview = renderEnhanced(sheet, presetId, intensity)
        return { ...sheet, preset: presetId, intensity, preview }
      })
    )
    setPhaseIndex(0)
  }

  const handleIntensityChange = (intensity) => {
    if (!activeSheet || activeSheet.preset === 'original') return
    const amount = Number(intensity)
    const sheetId = activeSheet.id
    const presetId = activeSheet.preset
    setSheets((prev) =>
      prev.map((sheet) => {
        if (sheet.id !== sheetId) return sheet
        return { ...sheet, intensity: amount }
      })
    )
    schedulePreview(sheetId, presetId, amount)
  }

  const handleRemoveSheet = (id) => {
    cancelPendingPreview()
    cancelScanTimer()
    const next = sheets.filter((sheet) => sheet.id !== id)
    setSheets(next)
    if (activeSheetId === id) {
      const fallback = next[next.length - 1]
      setActiveSheetId(fallback ? fallback.id : null)
      setIsScanning(false)
    }
  }

  const handleContinue = () => {
    if (!sheets.length || stage !== 'idle') return
    cancelPendingPreview()
    cancelScanTimer()
    setStage('processing')
    setPhaseIndex(0)
    let index = 0
    const advance = () => {
      if (index >= PROCESSING_PHASES.length) {
        setStage('ready')
        return
      }
      setPhaseIndex(index)
      const phase = PROCESSING_PHASES[index]
      index += 1
      phaseTimerRef.current = window.setTimeout(advance, index === 1 ? 500 : phase.progress === 100 ? 600 : 700)
    }
    phaseTimerRef.current = window.setTimeout(advance, 300)
  }

  const handleBackToEditing = () => {
    if (phaseTimerRef.current) window.clearTimeout(phaseTimerRef.current)
    setStage('idle')
    setPhaseIndex(0)
  }

  const phase = PROCESSING_PHASES[phaseIndex] || PROCESSING_PHASES[PROCESSING_PHASES.length - 1]

  return (
    <div className="mx-auto w-full max-w-7xl px-3 py-4 sm:px-4 sm:py-6">
      <CameraCaptureModal
        isOpen={showCamera}
        onClose={() => setShowCamera(false)}
        onCaptured={handleCaptured}
      />

      {/* Header */}
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="grid h-11 w-11 place-items-center rounded-2xl bg-orange-100 text-orange-600 dark:bg-orange-950/60 dark:text-orange-400">
            <ScanLine className="h-5 w-5" />
          </div>
          <div>
            <h1 className="text-lg font-black text-gray-900 dark:text-white">Paper Scan Review</h1>
            <p className="text-xs font-medium text-gray-500 dark:text-gray-400">Capture paper attendance sheets, enhance them locally, and prepare them for review</p>
          </div>
        </div>
        <button
          type="button"
          onClick={onBack}
          className="inline-flex items-center gap-1.5 rounded-xl border border-gray-200 bg-white px-3 py-2 text-xs font-bold text-gray-700 transition-colors hover:border-orange-300 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-200"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          Back to Admin
        </button>
      </div>

      {/* Phase notice */}
      <div className="mb-4 flex items-center gap-2 rounded-2xl border border-orange-200 bg-orange-50/70 px-4 py-3 dark:border-orange-900/40 dark:bg-orange-950/20">
        <ShieldCheck className="h-4 w-4 shrink-0 text-orange-600 dark:text-orange-300" />
        <p className="text-xs font-bold text-orange-800 dark:text-orange-200">
          Everything stays on this device. No images are uploaded or sent anywhere.
        </p>
      </div>

      {stage !== 'idle' ? (
        /* Processing / ready view */
        <div className="rounded-2xl border border-gray-200 bg-white p-6 shadow-sm dark:border-gray-700 dark:bg-gray-800">
          <div className="mb-5 flex items-center gap-3">
            <span className="grid h-12 w-12 place-items-center rounded-2xl bg-orange-100 text-orange-600 dark:bg-orange-950/60 dark:text-orange-400">
              <Layers className="h-6 w-6" />
            </span>
            <div>
              <p className="text-sm font-black text-gray-900 dark:text-white">
                {stage === 'ready' ? 'Processing complete' : 'Processing sheets...'}
              </p>
              <p className="text-xs font-medium text-gray-500 dark:text-gray-400">
                {sheets.length} {sheets.length === 1 ? 'sheet' : 'sheets'} in this batch
              </p>
            </div>
          </div>

          <div className="mb-2 flex items-center justify-between gap-3">
            <p className="text-sm font-bold text-orange-700 dark:text-orange-300" aria-live="polite">
              {stage === 'ready' && phaseIndex >= PROCESSING_PHASES.length ? 'Ready for AI connection' : phase.label}
            </p>
            <p className="text-xs font-black tabular-nums text-gray-500 dark:text-gray-400">{phase.progress}%</p>
          </div>
          <div className="h-2.5 w-full overflow-hidden rounded-full bg-gray-100 dark:bg-gray-700">
            <div
              className="h-full rounded-full bg-orange-500 transition-all duration-500 ease-out"
              style={{ width: `${phase.progress}%` }}
            />
          </div>

          {stage === 'ready' && (
            <div className="mt-5 rounded-2xl border border-orange-200 bg-orange-50/70 p-4 dark:border-orange-900/40 dark:bg-orange-950/20">
              <p className="text-xs font-bold leading-relaxed text-orange-800 dark:text-orange-200">
                Ready for AI connection — OCR/AI analysis is not connected yet. All {sheets.length} enhanced sheet
                {sheets.length === 1 ? '' : 's'} are prepared on this device and will be handed to the AI pipeline in
                the next phase. Nothing has been uploaded or sent anywhere.
              </p>
            </div>
          )}

          <div className="mt-6 flex flex-wrap items-center justify-between gap-3">
            {stage !== 'ready' && (
              <p className="text-xs font-medium text-gray-500 dark:text-gray-400">Preparing local previews only — no network calls.</p>
            )}
            <button
              type="button"
              onClick={handleBackToEditing}
              className="inline-flex min-h-[44px] items-center gap-2 rounded-2xl border border-gray-200 bg-white px-5 py-2.5 text-sm font-black text-gray-700 transition-colors hover:border-orange-300 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-200"
            >
              <ArrowLeft className="h-4 w-4" />
              {stage === 'ready' ? 'Back to editing' : 'Cancel processing'}
            </button>
          </div>
        </div>
      ) : (
        <>
          {/* Capture / upload */}
          <div className="mb-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
            <button
              type="button"
              onClick={() => setShowCamera(true)}
              disabled={processing}
              className="flex min-h-[120px] flex-col items-center justify-center gap-2 rounded-2xl border border-gray-200 bg-white p-4 text-gray-700 transition-colors hover:border-orange-300 disabled:opacity-50 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-200"
            >
              <span className="grid h-12 w-12 place-items-center rounded-2xl bg-orange-100 text-orange-600 dark:bg-orange-950/60 dark:text-orange-400">
                <Camera className="h-6 w-6" />
              </span>
              <span className="text-sm font-black">Take a photo</span>
              <span className="text-xs font-medium text-gray-500 dark:text-gray-400">{sheets.length ? 'Add another sheet' : 'Use the device camera'}</span>
            </button>

            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              disabled={processing}
              className="flex min-h-[120px] flex-col items-center justify-center gap-2 rounded-2xl border border-gray-200 bg-white p-4 text-gray-700 transition-colors hover:border-orange-300 disabled:opacity-50 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-200"
            >
              <span className="grid h-12 w-12 place-items-center rounded-2xl bg-orange-100 text-orange-600 dark:bg-orange-950/60 dark:text-orange-400">
                <Upload className="h-6 w-6" />
              </span>
              <span className="text-sm font-black">Upload an image</span>
              <span className="text-xs font-medium text-gray-500 dark:text-gray-400">{sheets.length ? 'Add another sheet' : 'From this device'}</span>
            </button>
          </div>

          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            multiple
            onChange={handleFileSelected}
            className="hidden"
            aria-label="Upload an image"
          />

          {/* Validation / load error */}
          {error && (
            <div className="mb-4 flex items-center gap-2 rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-bold text-red-700 dark:border-red-900/40 dark:bg-red-950/20 dark:text-red-300" role="alert">
              <X className="h-4 w-4 shrink-0" />
              {error}
            </div>
          )}

          {/* Thumbnail strip */}
          {sheets.length > 0 && (
            <div className="mb-4 rounded-2xl border border-gray-200 bg-white p-4 shadow-sm dark:border-gray-700 dark:bg-gray-800">
              <p className="mb-3 flex items-center gap-1.5 text-xs font-black uppercase tracking-wider text-gray-500 dark:text-gray-400">
                <Layers className="h-3.5 w-3.5" />
                Sheets ({sheets.length})
              </p>
              <div className="flex gap-3 overflow-x-auto pb-1">
                {sheets.map((sheet, index) => (
                  <div
                    key={sheet.id}
                    className={`group relative w-24 shrink-0 overflow-hidden rounded-xl border-2 text-left transition-colors ${
                      sheet.id === activeSheetId
                        ? 'border-orange-400'
                        : 'border-gray-200 hover:border-orange-300 dark:border-gray-700'
                    }`}
                  >
                    <button
                      type="button"
                      onClick={() => selectSheet(sheet.id)}
                      className="block h-full w-full"
                      aria-label={`Select sheet ${index + 1}: ${sheet.source}`}
                      aria-pressed={sheet.id === activeSheetId}
                    >
                      <img src={sheet.preview || sheet.dataUrl} alt={`Sheet ${index + 1} preview`} className="h-20 w-24 object-cover" />
                      <span className="absolute bottom-0 left-0 right-0 truncate bg-black/60 px-1.5 py-0.5 text-[10px] font-bold text-white">
                        {index + 1}. {sheet.source}
                      </span>
                    </button>
                    <button
                      type="button"
                      onClick={(event) => {
                        event.stopPropagation()
                        handleRemoveSheet(sheet.id)
                      }}
                      className="absolute right-1 top-1 grid h-5 w-5 place-items-center rounded-full bg-black/70 text-white opacity-0 transition-opacity group-hover:opacity-100"
                      aria-label={`Remove sheet ${index + 1}`}
                    >
                      <Trash2 className="h-3 w-3" />
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Preview + enhancement */}
          {activeSheet && (
            <div className="mb-4 grid grid-cols-1 gap-4 lg:grid-cols-3">
              <div className="lg:col-span-2">
                <div className="overflow-hidden rounded-2xl border border-gray-200 bg-gray-950 shadow-sm dark:border-gray-700">
                  <div className="relative">
                    <img
                      src={activeSheet.preview || activeSheet.dataUrl}
                      alt="Captured paper sheet preview"
                      className="max-h-[520px] w-full object-contain"
                    />
                    {isScanning && (
                      <div className="pointer-events-none absolute inset-0">
                        <div className="paper-scan-line" />
                      </div>
                    )}
                    {processing && (
                      <div className="absolute inset-0 grid place-items-center bg-black/25">
                        <div className="flex items-center gap-2 rounded-full bg-black/70 px-4 py-2 text-xs font-bold text-white"><Loader2 className="h-4 w-4 animate-spin" /> Loading sheet...</div>
                      </div>
                    )}
                  </div>
                </div>
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  <span className="inline-flex items-center gap-1.5 rounded-full bg-orange-100 px-3 py-1 text-xs font-black text-orange-700 dark:bg-orange-950/50 dark:text-orange-300">
                    <ImagePlus className="h-3.5 w-3.5" />
                    {activeSheet.source}
                  </span>
                  <button
                    type="button"
                    onClick={() => {
                      cancelScanTimer()
                      setIsScanning(true)
                    }}
                    onAnimationEnd={() => setIsScanning(false)}
                    className="inline-flex items-center gap-1.5 rounded-full border border-gray-200 bg-white px-3 py-1 text-xs font-bold text-gray-700 transition-colors hover:border-orange-300 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-200"
                    title="Play the scanning animation"
                  >
                    <RefreshCw className="h-3.5 w-3.5" />
                    Replay scan
                  </button>
                </div>
              </div>

              <div>
                <div className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm dark:border-gray-700 dark:bg-gray-800">
                  <p className="mb-3 flex items-center gap-1.5 text-xs font-black uppercase tracking-wider text-gray-500 dark:text-gray-400">
                    <Sparkles className="h-3.5 w-3.5" />
                    Enhancement presets
                  </p>
                  <div className="space-y-2">
                    {presetMeta.map((preset) => (
                      <button
                        key={preset.id}
                        type="button"
                        onClick={() => handlePresetChange(preset.id)}
                        aria-pressed={activeSheet.preset === preset.id}
                        className={`flex w-full items-center justify-between gap-2 rounded-xl border px-3 py-2.5 text-left text-sm font-bold transition-colors ${
                          activeSheet.preset === preset.id
                            ? 'border-orange-400 bg-orange-50 text-orange-800 dark:border-orange-700 dark:bg-orange-950/40 dark:text-orange-200'
                            : 'border-gray-200 bg-white text-gray-700 hover:border-orange-300 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-200'
                        }`}
                      >
                        <span className="min-w-0">
                          <span className="block font-black">{preset.label}</span>
                          <span className="block text-xs font-medium text-gray-500 dark:text-gray-400">{PRESET_ICON_LABEL[preset.id]}</span>
                        </span>
                        {activeSheet.preset === preset.id && <Check className="h-4 w-4 shrink-0 text-orange-600 dark:text-orange-300" />}
                      </button>
                    ))}
                  </div>

                  {activeSheet.preset !== 'original' && (
                    <div className="mt-4 rounded-xl border border-gray-200 bg-gray-50 p-3 dark:border-gray-700 dark:bg-gray-900/40">
                      <div className="mb-2 flex items-center justify-between gap-2">
                        <label htmlFor="paper-scan-intensity" className="text-xs font-black text-gray-700 dark:text-gray-300">
                          Intensity
                        </label>
                        <span className="text-xs font-black tabular-nums text-orange-700 dark:text-orange-300">
                          {activeSheet.intensity ?? PRESET_DEFAULT_INTENSITY[activeSheet.preset]}%
                        </span>
                      </div>
                      <input
                        id="paper-scan-intensity"
                        type="range"
                        min="0"
                        max="100"
                        step="1"
                        value={activeSheet.intensity ?? PRESET_DEFAULT_INTENSITY[activeSheet.preset]}
                        onChange={(event) => handleIntensityChange(event.target.value)}
                        className="w-full accent-orange-500"
                        aria-label="Enhancement intensity"
                      />
                      <p className="mt-1 text-[11px] font-medium text-gray-500 dark:text-gray-400">
                        Blend the {PRESET_ICON_LABEL[activeSheet.preset].toLowerCase()} effect back toward the original.
                      </p>
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}

          {/* Continue */}
          <div className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm dark:border-gray-700 dark:bg-gray-800">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="min-w-0">
                <p className="text-sm font-black text-gray-900 dark:text-white">Ready to continue?</p>
                <p className="text-xs font-medium text-gray-500 dark:text-gray-400">
                  {sheets.length
                    ? `${sheets.length} ${sheets.length === 1 ? 'sheet' : 'sheets'} ready. OCR/AI analysis is coming in the next phase.`
                    : 'Capture or upload a paper sheet first.'}
                </p>
              </div>
              <button
                type="button"
                onClick={handleContinue}
                disabled={!sheets.length}
                className="inline-flex min-h-[44px] items-center gap-2 rounded-2xl bg-orange-600 px-5 py-2.5 text-sm font-black text-white transition-colors hover:bg-orange-700 disabled:cursor-not-allowed disabled:opacity-40"
              >
                <ScanLine className="h-4 w-4" />
                Continue
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  )
}

export default PaperScanReview
