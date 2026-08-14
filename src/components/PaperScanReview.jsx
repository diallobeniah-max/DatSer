import React, { useEffect, useMemo, useRef, useState } from 'react'
import {
  AlertTriangle,
  ArrowLeft,
  Bot,
  Camera,
  Check,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Eye,
  ImagePlus,
  Layers,
  Loader2,
  Maximize2,
  Pencil,
  RefreshCw,
  RefreshCcw,
  Save,
  ScanLine,
  ShieldCheck,
  Sparkles,
  Trash2,
  Upload,
  UserPlus,
  X,
  ZoomIn,
  ZoomOut
} from 'lucide-react'
import { extractSheetWithGemini } from '../services/paperScanExtraction'
import {
  createSavedScanId,
  createScanName,
  createSheetImageSignedUrl,
  deleteSavedScan,
  excludedIndicesFromSavedScan,
  getSavedScan,
  listSavedScans,
  renameSavedScan,
  savePaperScan,
  usageMetadataFromSavedScan
} from '../services/paperScanSavedScans'
import {
  FINAL_SAVE_STATUS,
  buildFinalSavePlan,
  buildSaveResultMetadata,
  detectNewMemberDuplicates,
  executeFinalSave,
  finalSaveResultFromOperation,
  getDurableSaveOperation,
  previewFinalSave,
  retryPersistedFinalSave,
  summarizeFinalSaveMembers
} from '../services/paperScanFinalSave'
import {
  COMPARE_FIELDS,
  FIELD_STATES,
  MATCH_STATUSES,
  REVIEW_SOURCES,
  getEffectiveValue,
  getExistingValue,
  matchGeminiRowToMember,
  summarizeRowCompare
} from '../utils/paperScanCompare'
import {
  ATTENDANCE_CONVENTIONS,
  ATTENDANCE_CONVENTION_OPTIONS,
  ATTENDANCE_STATUS,
  attendanceColumnNameForDate,
  interpretAttendanceMark,
  mapAttendanceColumns,
  missingMonthsInYear,
  monthKeyFromDate,
  monthKeyFromTableName,
  monthKeyLabel,
  monthTableExists,
  monthTablesInYear,
  monthYearFromKey,
  parseMonthKey,
  resolveAttendanceEntries
} from '../utils/paperScanAttendance'
import {
  ENHANCEMENT_PRESETS,
  PRESET_DEFAULT_INTENSITY,
  applyEnhancement,
  canvasToDataUrl,
  fitSheetForUpload,
  loadImageElement,
  readFileAsDataUrl,
  validateImageDimensions,
  validateImageFile
} from '../utils/paperScanImage'
import { useApp } from '../context/AppContext'
import { useAuth } from '../context/AuthContext'
import { supabase } from '../lib/supabase'
import DocumentCameraModal from './DocumentCameraModal'

const PRESET_ICON_LABEL = {
  original: 'Original capture',
  auto: 'Balances lighting and firms up faint ink',
  grayscale: 'Removes color to reduce glare',
  'black-white': 'Adaptive threshold for clean text, safe on faint strokes',
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

const FIELD_STATE_META = {
  [FIELD_STATES.SAME]: { label: 'Same', className: 'bg-green-100 text-green-700 dark:bg-green-950/50 dark:text-green-300' },
  [FIELD_STATES.DIFFERENT]: { label: 'Different', className: 'bg-orange-100 text-orange-700 dark:bg-orange-950/50 dark:text-orange-300' },
  [FIELD_STATES.MISSING]: { label: 'Missing', className: 'bg-gray-100 text-gray-500 dark:bg-gray-800 dark:text-gray-400' },
  [FIELD_STATES.LOW_CONFIDENCE]: { label: 'Low confidence', className: 'bg-red-100 text-red-700 dark:bg-red-950/50 dark:text-red-300' }
}

const MATCH_META = {
  matched: { label: 'Matched', className: 'bg-green-100 text-green-700 dark:bg-green-950/50 dark:text-green-300' },
  possible: { label: 'Possible match', className: 'bg-amber-100 text-amber-700 dark:bg-amber-950/50 dark:text-amber-300' },
  none: { label: 'No match', className: 'bg-red-100 text-red-700 dark:bg-red-950/50 dark:text-red-300' }
}

const DECISION_SOURCE_LABEL = {
  [REVIEW_SOURCES.SCAN]: 'From scan',
  [REVIEW_SOURCES.DATSER]: 'Kept from DatSer',
  [REVIEW_SOURCES.EDITED]: 'Edited'
}

// Coalesce slider-driven preview re-renders; only the latest intensity is processed.
const PREVIEW_DEBOUNCE_MS = 130

const createSheetId = () => `sheet-${Date.now()}-${Math.random().toString(16).slice(2)}`

// One id per extraction attempt. Kept if a request may have reached the server
// but the response was lost, so re-sending the same attempt cannot double-spend
// a Gemini call (the server answers 409 duplicate for the same id). A brand-new
// attempt (e.g. an explicit Retry) generates a fresh id so an intentional
// re-scan is never blocked by idempotency.
const createRequestId = () => `extract-${Date.now()}-${Math.random().toString(16).slice(2)}`

// Honours an explicit reviewer decision (create-new / choose-different member)
// over the automatic search-based match, without ever writing to DatSer.
const computeRowMatch = (row, members) => {
  if (row?.memberAction === 'create-new') {
    return { status: MATCH_STATUSES.NONE, member: null, query: '' }
  }
  if (row?.selectedMemberId) {
    const selected = (Array.isArray(members) ? members : []).find((member) => String(member.id) === String(row.selectedMemberId))
    if (selected) return { status: MATCH_STATUSES.MATCHED, member: selected, query: '' }
  }
  return matchGeminiRowToMember(row, members)
}

const markSymbolFor = (markToken) => (markToken === 'tick' ? '✓' : markToken === 'x' ? '✗' : markToken === 'blank' ? '·' : '?')

// New-member writes require explicit approval for every field; Gemini is only
// a suggestion until the reviewer chooses it.
const profileForNewMember = (row) => {
  const profile = {}
  for (const { key } of COMPARE_FIELDS) {
    const decision = row?.reviewedValues?.[key]
    profile[key] = decision?.value || ''
  }
  return profile
}


const ImageViewerModal = ({ isOpen, onClose, originalSrc, enhancedSrc, initialMode = 'original' }) => {
  const [mode, setMode] = useState(initialMode)
  const [zoom, setZoom] = useState(1)
  const [pan, setPan] = useState({ x: 0, y: 0 })
  const dragRef = useRef(null)
  const trackRef = useRef(null)
  const zoomRef = useRef(1)
  const panRef = useRef({ x: 0, y: 0 })
  const wheelAccumRef = useRef(1)
  const wheelRafRef = useRef(null)
  const wheelPointRef = useRef({ px: 0, py: 0 })

  useEffect(() => { zoomRef.current = zoom }, [zoom])
  useEffect(() => { panRef.current = pan }, [pan])

  useEffect(() => {
    if (!isOpen) return undefined
    setMode(initialMode)
    setZoom(1)
    setPan({ x: 0, y: 0 })
    const onKey = (event) => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [isOpen, initialMode, onClose])

  // Native non-passive wheel listener: React attaches wheel passively at the
  // root, so a synthetic onWheel can never preventDefault and stop page scroll.
  // This listener also anchors the zoom at the cursor and coalesces events per
  // animation frame for smooth continuous zooming.
  useEffect(() => {
    if (!isOpen) return undefined
    const el = trackRef.current
    if (!el) return undefined
    const onWheel = (event) => {
      event.preventDefault()
      const rect = el.getBoundingClientRect()
      wheelPointRef.current = { px: event.clientX - rect.left, py: event.clientY - rect.top }
      let factor = Math.pow(1.0016, -event.deltaY)
      factor = Math.max(0.7, Math.min(1.5, factor))
      wheelAccumRef.current *= factor
      if (wheelRafRef.current) return
      wheelRafRef.current = requestAnimationFrame(() => {
        wheelRafRef.current = null
        const current = zoomRef.current
        const next = Math.min(4, Math.max(1, current * wheelAccumRef.current))
        wheelAccumRef.current = 1
        if (Math.abs(next - current) < 0.0001) return
        const { px, py } = wheelPointRef.current
        const rect = el.getBoundingClientRect()
        const cx = rect.width / 2
        const cy = rect.height / 2
        const ratio = next / current
        const pan = panRef.current
        setPan({ x: (pan.x - (px - cx)) * ratio + (px - cx), y: (pan.y - (py - cy)) * ratio + (py - cy) })
        setZoom(next)
      })
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => {
      el.removeEventListener('wheel', onWheel)
      if (wheelRafRef.current) cancelAnimationFrame(wheelRafRef.current)
    }
  }, [isOpen])

  if (!isOpen) return null

  const src = mode === 'enhanced' ? enhancedSrc || originalSrc : originalSrc
  const reset = () => {
    setZoom(1)
    setPan({ x: 0, y: 0 })
  }
  const zoomBy = (factor) => setZoom((value) => Math.min(4, Math.max(1, Number((value * factor).toFixed(2)))))

  const handlePointerDown = (event) => {
    dragRef.current = { startX: event.clientX, startY: event.clientY, panX: pan.x, panY: pan.y }
  }
  const handlePointerMove = (event) => {
    if (!dragRef.current) return
    setPan({
      x: dragRef.current.panX + event.clientX - dragRef.current.startX,
      y: dragRef.current.panY + event.clientY - dragRef.current.startY
    })
  }
  const endDrag = () => { dragRef.current = null }

  return (
    <div
      className="fixed inset-0 z-[180] flex flex-col bg-black/95 backdrop-blur-xl"
      role="dialog"
      aria-modal="true"
      aria-label="Sheet photo viewer"
      onPointerUp={endDrag}
      onPointerLeave={endDrag}
    >
      <div className="flex items-center justify-between gap-2 border-b border-white/10 px-3 py-3">
        <div className="flex items-center gap-2">
          <div className="flex overflow-hidden rounded-xl border border-white/15">
            <button
              type="button"
              onClick={() => setMode('original')}
              aria-pressed={mode === 'original'}
              className={`px-3 py-2 text-xs font-black transition-colors ${mode === 'original' ? 'bg-orange-500 text-white' : 'bg-white/5 text-white/60 hover:text-white'}`}
            >
              Original
            </button>
            <button
              type="button"
              onClick={() => setMode('enhanced')}
              aria-pressed={mode === 'enhanced'}
              className={`px-3 py-2 text-xs font-black transition-colors ${mode === 'enhanced' ? 'bg-orange-500 text-white' : 'bg-white/5 text-white/60 hover:text-white'}`}
            >
              Enhanced
            </button>
          </div>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close photo viewer"
          className="grid h-10 w-10 place-items-center rounded-full bg-white/10 text-white/80 transition hover:bg-white/20 hover:text-white"
        >
          <X className="h-5 w-5" />
        </button>
      </div>

      <div
        ref={trackRef}
        className="relative min-h-0 flex-1 touch-none overflow-hidden"
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
      >
        <img
          src={src}
          alt="Attendance sheet"
          draggable={false}
          className="absolute left-1/2 top-1/2 max-h-full max-w-full origin-center select-none"
          style={{ transform: `translate(calc(-50% + ${pan.x}px), calc(-50% + ${pan.y}px)) scale(${zoom})` }}
        />
      </div>

      <div className="flex items-center justify-center gap-2 border-t border-white/10 px-3 py-3">
        <button
          type="button"
          onClick={() => zoomBy(0.85)}
          disabled={zoom <= 1}
          aria-label="Zoom out"
          className="grid h-11 w-11 place-items-center rounded-xl bg-white/10 text-white transition hover:bg-white/20 disabled:opacity-40"
        >
          <ZoomOut className="h-5 w-5" />
        </button>
        <span className="w-12 text-center text-xs font-black tabular-nums text-white/70">{Math.round(zoom * 100)}%</span>
        <button
          type="button"
          onClick={() => zoomBy(1.15)}
          disabled={zoom >= 4}
          aria-label="Zoom in"
          className="grid h-11 w-11 place-items-center rounded-xl bg-white/10 text-white transition hover:bg-white/20 disabled:opacity-40"
        >
          <ZoomIn className="h-5 w-5" />
        </button>
        <button
          type="button"
          onClick={reset}
          disabled={zoom === 1 && pan.x === 0 && pan.y === 0}
          aria-label="Reset zoom"
          className="grid h-11 w-11 place-items-center rounded-xl bg-white/10 text-white transition hover:bg-white/20 disabled:opacity-40"
        >
          <Maximize2 className="h-5 w-5" />
        </button>
      </div>
    </div>
  )
}

// Inline review-image pane for the split Compare & Correct workspace. Keeps the
// photographed/uploaded sheet visible on the LEFT while the review stays on the
// RIGHT, with zoom / pan / fit / reset / original|enhanced / full-screen tools.
// Pure-ish: pan and zoom are component state; everything else is props + DOM.
const ReviewImagePane = ({
  originalSrc,
  enhancedSrc,
  sourceLabel,
  onOpenFullscreen,
  activeLabel = '',
  fillHeight = false
}) => {
  const [mode, setMode] = useState('original')
  const [zoom, setZoom] = useState(1)
  const [pan, setPan] = useState({ x: 0, y: 0 })
  const [naturalSize, setNaturalSize] = useState(null)
  const dragRef = useRef(null)
  const pointersRef = useRef({})
  const trackRef = useRef(null)
  const pinchRef = useRef(null)
  const zoomRef = useRef(1)
  const panRef = useRef({ x: 0, y: 0 })
  const wheelAccumRef = useRef(1)
  const wheelRafRef = useRef(null)
  const wheelPointRef = useRef({ px: 0, py: 0 })

  useEffect(() => { zoomRef.current = zoom }, [zoom])
  useEffect(() => { panRef.current = pan }, [pan])

  // Native non-passive wheel listener with cursor-anchored, frame-coalesced
  // zoom, so the page never scrolls while the reviewer zooms the sheet.
  useEffect(() => {
    const el = trackRef.current
    if (!el) return undefined
    const onWheel = (event) => {
      event.preventDefault()
      const rect = el.getBoundingClientRect()
      wheelPointRef.current = { px: event.clientX - rect.left, py: event.clientY - rect.top }
      let factor = Math.pow(1.0016, -event.deltaY)
      factor = Math.max(0.7, Math.min(1.5, factor))
      wheelAccumRef.current *= factor
      if (wheelRafRef.current) return
      wheelRafRef.current = requestAnimationFrame(() => {
        wheelRafRef.current = null
        const current = zoomRef.current
        const next = Math.min(4, Math.max(0.5, current * wheelAccumRef.current))
        wheelAccumRef.current = 1
        if (Math.abs(next - current) < 0.0001) return
        const { px, py } = wheelPointRef.current
        const rect = el.getBoundingClientRect()
        const cx = rect.width / 2
        const cy = rect.height / 2
        const ratio = next / current
        const pan = panRef.current
        setPan({ x: (pan.x - (px - cx)) * ratio + (px - cx), y: (pan.y - (py - cy)) * ratio + (py - cy) })
        setZoom(next)
      })
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => {
      el.removeEventListener('wheel', onWheel)
      if (wheelRafRef.current) cancelAnimationFrame(wheelRafRef.current)
    }
  }, [])

  const reset = () => {
    setZoom(1)
    setPan({ x: 0, y: 0 })
  }
  const zoomBy = (factor) => setZoom((value) => Math.min(4, Math.max(0.5, Number((value * factor).toFixed(2)))))

  const src = mode === 'enhanced' ? enhancedSrc || originalSrc : originalSrc

  // Fit page: choose the largest scale that keeps the whole sheet on screen and
  // centers it, so the active member band never scrolls off the pane.
  const fitToPage = () => {
    if (!naturalSize) {
      reset()
      return
    }
    const rect = trackRef.current?.getBoundingClientRect()
    const containerWidth = rect?.width || 560
    const containerHeight = rect?.height || 400
    const scale = Math.min(
      containerWidth / Math.max(naturalSize.width, 1),
      containerHeight / Math.max(naturalSize.height, 1),
      3
    )
    setZoom(Number(Math.max(0.5, scale).toFixed(2)))
    setPan({ x: 0, y: 0 })
  }

  const handlePointerDown = (event) => {
    event.currentTarget.setPointerCapture?.(event.pointerId)
    pointersRef.current[event.pointerId] = { x: event.clientX, y: event.clientY }
    if (Object.keys(pointersRef.current).length === 1) {
      dragRef.current = {
        startX: event.clientX,
        startY: event.clientY,
        panX: pan.x,
        panY: pan.y
      }
      return
    }
    dragRef.current = null
    const ids = Object.keys(pointersRef.current)
    if (ids.length === 2) {
      const a = pointersRef.current[ids[0]]
      const b = pointersRef.current[ids[1]]
      pinchRef.current = {
        distance: Math.hypot(b.x - a.x, b.y - a.y),
        zoom: zoom,
        midX: (a.x + b.x) / 2,
        midY: (a.y + b.y) / 2,
        pan: pan
      }
    }
  }

  const handlePointerMove = (event) => {
    const clientX = event.clientX ?? event.layerX
    const clientY = event.clientY ?? event.layerY
    if (clientX == null || clientY == null) return
    const point = pointersRef.current[event.pointerId]
    if (point) {
      point.x = clientX
      point.y = clientY
    }
    const ids = Object.keys(pointersRef.current)
    if (ids.length >= 2) {
      // Pinch zoom: scale by the change in pointer separation around the midpoint.
      if (ids.length === 2) {
        const a = pointersRef.current[ids[0]]
        const b = pointersRef.current[ids[1]]
        const distance = Math.hypot(b.x - a.x, b.y - a.y)
        const last = pinchRef.current
        if (last && last.distance > 0) {
          setZoom((value) => Math.min(4, Math.max(0.5, Number((value * distance / last.distance).toFixed(2)))))
          setPan({ x: last.pan.x + (a.x + b.x) / 2 - last.midX, y: last.pan.y + (a.y + b.y) / 2 - last.midY })
        }
        pinchRef.current = {
          distance,
          zoom,
          midX: (a.x + b.x) / 2,
          midY: (a.y + b.y) / 2,
          pan
        }
      }
      return
    }
    if (!dragRef.current) return
    setPan({
      x: dragRef.current.panX + clientX - dragRef.current.startX,
      y: dragRef.current.panY + clientY - dragRef.current.startY
    })
  }
  const endPointer = (event) => {
    const moved = dragRef.current
    dragRef.current = null
    pinchRef.current = null
    delete pointersRef.current[event.pointerId]
    // A light tap with no pan/zoom intent opens the full-screen viewer (mobile).
    if (moved && zoom === 1 && pan.x === 0 && pan.y === 0 && !Object.keys(pointersRef.current).length) {
      onOpenFullscreen?.()
    }
  }

  return (
    <div className={`overflow-hidden rounded-2xl border border-gray-200 bg-gray-900 dark:border-gray-700 ${fillHeight ? 'flex h-full flex-col' : ''}`}>
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-white/10 px-3 py-2">
        <p className="flex min-w-0 items-center gap-1.5 text-xs font-bold text-white/80">
          <ImagePlus className="h-3.5 w-3.5 shrink-0 text-orange-400" />
          <span className="truncate">Sheet photo{sourceLabel ? ` · ${sourceLabel}` : ''}</span>
        </p>
        <div className="flex items-center gap-1">
          <div className="flex overflow-hidden rounded-lg border border-white/15">
            <button
              type="button"
              onClick={() => setMode('original')}
              aria-pressed={mode === 'original'}
              className={`px-2.5 py-1.5 text-[11px] font-black transition-colors ${mode === 'original' ? 'bg-orange-500 text-white' : 'bg-white/5 text-white/60 hover:text-white'}`}
            >
              Original
            </button>
            <button
              type="button"
              onClick={() => setMode('enhanced')}
              aria-pressed={mode === 'enhanced'}
              className={`px-2.5 py-1.5 text-[11px] font-black transition-colors ${mode === 'enhanced' ? 'bg-orange-500 text-white' : 'bg-white/5 text-white/60 hover:text-white'}`}
            >
              Enhanced
            </button>
          </div>
          <button
            type="button"
            onClick={onOpenFullscreen}
            aria-label="Open full screen photo"
            className="grid h-8 w-8 place-items-center rounded-lg bg-white/10 text-white/80 transition hover:bg-white/20 hover:text-white"
          >
            <Maximize2 className="h-4 w-4" />
          </button>
        </div>
      </div>

      <div
        ref={trackRef}
        className={`relative touch-none overflow-hidden ${fillHeight ? 'min-h-0 flex-1' : 'h-[300px] sm:h-[400px]'}`}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={endPointer}
        onPointerCancel={endPointer}
        onPointerLeave={endPointer}
      >
        {src ? (
          <img
            src={src}
            alt="Attendance sheet for review"
            draggable={false}
            className="pointer-events-none absolute left-1/2 top-1/2 max-h-full max-w-full select-none"
            style={{ transform: `translate(calc(-50% + ${pan.x}px), calc(-50% + ${pan.y}px)) scale(${zoom})` }}
            onLoad={(event) => setNaturalSize({ width: event.target.naturalWidth, height: event.target.naturalHeight })}
          />
        ) : (
          <div className="absolute inset-0 grid place-items-center text-xs font-medium text-white/40">No photo for this sheet</div>
        )}
        {activeLabel && (
          <span className="pointer-events-none absolute left-2 top-2 rounded-full bg-orange-500/90 px-2.5 py-1 text-[11px] font-black text-white shadow">
            {activeLabel}
          </span>
        )}
      </div>

      <div className="flex flex-wrap items-center justify-center gap-1.5 border-t border-white/10 px-2 py-2">
        <button
          type="button"
          onClick={() => zoomBy(0.85)}
          disabled={zoom <= 0.5}
          aria-label="Zoom out"
          className="grid h-9 w-9 place-items-center rounded-lg bg-white/10 text-white transition hover:bg-white/20 disabled:opacity-40"
        >
          <ZoomOut className="h-4 w-4" />
        </button>
        <button
          type="button"
          onClick={() => zoomBy(1.15)}
          disabled={zoom >= 4}
          aria-label="Zoom in"
          className="grid h-9 w-9 place-items-center rounded-lg bg-white/10 text-white transition hover:bg-white/20 disabled:opacity-40"
        >
          <ZoomIn className="h-4 w-4" />
        </button>
        <span className="w-10 text-center text-xs font-black tabular-nums text-white/70">{Math.round(zoom * 100)}%</span>
        <button
          type="button"
          onClick={fitToPage}
          aria-label="Fit page"
          className="inline-flex h-9 items-center gap-1 rounded-lg bg-white/10 px-2.5 text-[11px] font-bold text-white transition hover:bg-white/20"
        >
          <Maximize2 className="h-3.5 w-3.5" />
          Fit page
        </button>
        <button
          type="button"
          onClick={reset}
          disabled={zoom === 1 && pan.x === 0 && pan.y === 0}
          aria-label="Reset view"
          className="grid h-9 w-9 place-items-center rounded-lg bg-white/10 text-white transition hover:bg-white/20 disabled:opacity-40"
        >
          <RefreshCcw className="h-4 w-4" />
        </button>
      </div>
    </div>
  )
}


const PaperScanReview = ({ onBack }) => {
  const { dataOwnerId, currentTable, monthlyTables = [], updateMember, refreshSyncedDataInBackground, loadAllAttendanceData, fetchMembers, isOnline, offlineMode } = useApp()
  const { user } = useAuth()
  const [sheets, setSheets] = useState([])
  const [activeSheetId, setActiveSheetId] = useState(null)
  const [isScanning, setIsScanning] = useState(false)
  const [processing, setProcessing] = useState(false)
  const [error, setError] = useState('')
  const [showCamera, setShowCamera] = useState(false)
  const [stage, setStage] = useState('idle') // idle | processing | ready | extracting | review
  const [phaseIndex, setPhaseIndex] = useState(0)
  const [resultsBySheet, setResultsBySheet] = useState({}) // sheetId -> extraction result
  const [reviewActiveId, setReviewActiveId] = useState(null)
  const [reviewIndex, setReviewIndex] = useState(0)
  const [extractStatus, setExtractStatus] = useState({ index: 0, total: 0, message: '' })
  const [globalExtractionError, setGlobalExtractionError] = useState('')
  const [retryPending, setRetryPending] = useState(false)
  const [currentMembers, setCurrentMembers] = useState([])
  const [membersStatus, setMembersStatus] = useState('idle') // idle | loading | ready | failed
  const [editingField, setEditingField] = useState(null) // { sheetId, rowIndex, field }
  const [attendanceMonths, setAttendanceMonths] = useState({}) // sheetId -> 'YYYY-MM'
  const [attendanceConventions, setAttendanceConventions] = useState({}) // sheetId -> convention id
  const [choosingMember, setChoosingMember] = useState(null) // { sheetId, rowIndex } for the choose-different picker
  const [viewer, setViewer] = useState(null) // { sheetId, mode: 'original' | 'enhanced' }
  const [showChanges, setShowChanges] = useState(false)
  const [showOriginalPreview, setShowOriginalPreview] = useState(false)
  const [editDraft, setEditDraft] = useState('')
  const [showSavedScans, setShowSavedScans] = useState(false)
  const [savedScans, setSavedScans] = useState([])
  const [savedScansStatus, setSavedScansStatus] = useState('idle') // idle | loading | ready | error
  const [savedScansError, setSavedScansError] = useState('')
  const [scanThumbnails, setScanThumbnails] = useState({}) // scanId -> signed thumbnail url
  const [renamingScanId, setRenamingScanId] = useState(null)
  const [renameDraft, setRenameDraft] = useState('')
  const [confirmDeleteId, setConfirmDeleteId] = useState(null)
  const [saving, setSaving] = useState(false)
  const [saveMessage, setSaveMessage] = useState('')
  const [savedScanRecord, setSavedScanRecord] = useState(null) // { id, name, savedAt } for the active session
  const [finalSaving, setFinalSaving] = useState(false)
  const [finalSaveResult, setFinalSaveResult] = useState(null) // { summary, members, savedAt } or the restored metadata
  const [finalSaveProgress, setFinalSaveProgress] = useState(0)
  const [pendingDuplicates, setPendingDuplicates] = useState(null) // { entries } awaiting explicit confirmation
  const [confirmedDuplicateKeys, setConfirmedDuplicateKeys] = useState([])
  const finalSaveInFlightRef = useRef(false)
  const savedScanIdRef = useRef(null)
  const savedScanNameRef = useRef('')
  const memberFetchRef = useRef(false)
  const extractionCancelledRef = useRef(false)
  const extractionActiveRef = useRef(false)
  const retryActiveRef = useRef(false)
  const activeAbortRef = useRef(null)
  const fileInputRef = useRef(null)
  const phaseTimerRef = useRef(null)
  const scanTimerRef = useRef(null)
  const previewTimerRef = useRef(null)
  const pendingPreviewRef = useRef(null)

  const workspaceId = dataOwnerId || user?.id

  const getSessionToken = async () => {
    const { data } = await supabase.auth.getSession()
    return data?.session?.access_token || ''
  }

  const activeSheet = useMemo(
    () => sheets.find((sheet) => sheet.id === activeSheetId) || null,
    [sheets, activeSheetId]
  )

  const presetMeta = useMemo(() => ENHANCEMENT_PRESETS, [])

  useEffect(() => () => {
    if (phaseTimerRef.current) window.clearTimeout(phaseTimerRef.current)
    if (scanTimerRef.current) window.clearTimeout(scanTimerRef.current)
    if (previewTimerRef.current) window.clearTimeout(previewTimerRef.current)
    extractionCancelledRef.current = true
    activeAbortRef.current?.abort()
  }, [])

  // Read-only: pulls the current month's member rows (the same source the rest
  // of the app reviews against) so every scanned row can be compared to what
  // DatSer already knows. Never writes back.
  useEffect(() => {
    if (stage !== 'review' || memberFetchRef.current) return undefined
    memberFetchRef.current = true
    if (!currentTable) {
      setMembersStatus('failed')
      return undefined
    }
    let cancelled = false
    setMembersStatus('loading')
    const run = async () => {
      try {
        const { data, error } = await supabase.from(currentTable).select('*')
        if (cancelled) return
        if (error) {
          setMembersStatus('failed')
          return
        }
        setCurrentMembers(Array.isArray(data) ? data : [])
        setMembersStatus('ready')
      } catch {
        if (cancelled) return
        setMembersStatus('failed')
      }
    }
    run()
    return () => { cancelled = true }
  }, [stage, currentTable])

  useEffect(() => {
    setReviewIndex(0)
    setEditingField(null)
  }, [reviewActiveId])

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
    setShowOriginalPreview(false)
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
      const dimensionCheck = validateImageDimensions(image)
      if (!dimensionCheck.ok) {
        throw new Error(dimensionCheck.reason)
      }
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

  // Fits the sheet to the Vercel-safe upload budget locally (downscale +
  // re-compress) before anything is sent. Throws a friendly error when even the
  // smallest acceptable encoding cannot fit, so the browser never hands Vercel
  // a payload it will reject before our handler runs.
  const prepareSheetUpload = (sheet) => {
    const dataUrl = fitSheetForUpload({
      image: sheet.image,
      presetId: sheet.preset,
      intensity: sheet.intensity,
      existingPreview: sheet.preview || sheet.dataUrl
    })
    if (!dataUrl) throw new Error('That image is too large to upload. Try a smaller or clearer photo.')
    return dataUrl
  }

  // Keeps the untouched Gemini read alongside any later review choices, so a
  // decision never destroys evidence of what the sheet actually said.
  const snapshotOriginalValues = (rows) => rows.map((row) => ({
    ...row,
    originalGeminiValue: {
      full_name: row.full_name,
      phone_number: row.phone_number,
      gender: row.gender,
      current_level: row.current_level
    }
  }))

  const runExtraction = async () => {
    if (extractionActiveRef.current) return
    extractionActiveRef.current = true
    extractionCancelledRef.current = false
    const controller = new AbortController()
    activeAbortRef.current = controller
    const target = sheets.slice()
    const bearerToken = await getSessionToken()
    if (!bearerToken) {
      extractionActiveRef.current = false
      activeAbortRef.current = null
      setGlobalExtractionError('Your sign-in session expired. Sign in again and retry.')
      setStage('ready')
      return
    }
    setGlobalExtractionError('')
    setStage('extracting')
    setResultsBySheet({})
    setExtractStatus({ index: 0, total: target.length, message: 'Starting local extraction...' })
    const results = {}
    try {
      for (let i = 0; i < target.length; i += 1) {
        if (extractionCancelledRef.current) break
        const sheet = target[i]
        setExtractStatus({ index: i + 1, total: target.length, message: `Reading sheet ${i + 1} of ${target.length}...` })
        const requestId = createRequestId()
        results[sheet.id] = { status: 'pending', sheetId: sheet.id, source: sheet.source, error: '', excludedIndices: [] }
        try {
          const dataUrl = prepareSheetUpload(sheet)
          const payload = await extractSheetWithGemini({ dataUrl, workspaceId, bearerToken, signal: controller.signal, requestId })
          results[sheet.id] = { status: 'ok', sheetId: sheet.id, source: sheet.source, error: '', excludedIndices: [], payload: { ...payload, extractedAt: new Date().toISOString(), rows: snapshotOriginalValues(payload.rows) } }
        } catch (extractError) {
          if (extractError?.name === 'AbortError') {
            break
          }
          results[sheet.id] = { status: 'failed', sheetId: sheet.id, source: sheet.source, error: extractError?.message || 'Extraction failed.', retryable: extractError?.retryable === true, excludedIndices: [] }
        }
      }
      if (extractionCancelledRef.current) return
      setResultsBySheet(results)
      const firstWithData = target.find((sheet) => results[sheet.id]?.status === 'ok') || target[0]
      setReviewActiveId(firstWithData ? firstWithData.id : null)
      setStage('review')
    } finally {
      extractionActiveRef.current = false
      activeAbortRef.current = null
    }
  }

  const handleRetrySheet = async (sheetId) => {
    // Guard BEFORE token retrieval, requestId generation, or fetch: a second
    // retry click must not issue another request while one is in flight.
    if (retryActiveRef.current) return
    retryActiveRef.current = true
    setRetryPending(true)
    const sheet = sheets.find((entry) => entry.id === sheetId)
    if (!sheet) {
      retryActiveRef.current = false
      setRetryPending(false)
      return
    }
    const bearerToken = await getSessionToken()
    if (!bearerToken) {
      retryActiveRef.current = false
      setRetryPending(false)
      setGlobalExtractionError('Unable to authenticate your session. Please sign out and sign in again.')
      setResultsBySheet((prev) => ({ ...prev, [sheetId]: { ...(prev[sheetId] || {}), status: 'failed', error: 'Unable to authenticate your session. Please sign out and sign in again.' } }))
      return
    }
    setResultsBySheet((prev) => ({ ...prev, [sheetId]: { ...(prev[sheetId] || {}), status: 'pending', error: '' } }))
    setExtractStatus({ index: 1, total: 1, message: 'Retrying extraction…' })
    const controller = new AbortController()
    activeAbortRef.current = controller
    try {
const payload = await extractSheetWithGemini({ dataUrl: prepareSheetUpload(sheet), workspaceId, bearerToken, signal: controller.signal, requestId: createRequestId() })
      if (activeAbortRef.current !== controller) return
      setResultsBySheet((prev) => ({ ...prev, [sheetId]: { status: 'ok', sheetId, source: sheet.source, error: '', excludedIndices: prev[sheetId]?.excludedIndices || [], payload: { ...payload, extractedAt: new Date().toISOString(), rows: snapshotOriginalValues(payload.rows) } } }))
    } catch (extractError) {
      if (extractError?.name === 'AbortError' || activeAbortRef.current !== controller) return
      setResultsBySheet((prev) => ({ ...prev, [sheetId]: { ...(prev[sheetId] || {}), status: 'failed', error: extractError?.message || 'Extraction failed.', retryable: extractError?.retryable === true } }))
    } finally {
      if (activeAbortRef.current === controller) activeAbortRef.current = null
      retryActiveRef.current = false
      setRetryPending(false)
    }
  }

  // Explicit per-field choices, never silent overwrites. Every decision keeps
  // the Gemini original untouched and records where the chosen value came from.
  const handleRowDecision = (sheetId, rowIndex, field, decision) => {
    setResultsBySheet((prev) => {
      const result = prev[sheetId]
      if (!result || result.status !== 'ok') return prev
      const rows = result.payload.rows.map((row, index) => (index === rowIndex
        ? { ...row, reviewedValues: { ...(row.reviewedValues || {}), [field]: decision } }
        : row))
      return { ...prev, [sheetId]: { ...result, payload: { ...result.payload, rows } } }
    })
    setEditingField(null)
  }

  const handleClearDecision = (sheetId, rowIndex, field) => {
    setResultsBySheet((prev) => {
      const result = prev[sheetId]
      if (!result || result.status !== 'ok') return prev
      const rows = result.payload.rows.map((row, index) => {
        if (index !== rowIndex || !row.reviewedValues?.[field]) return row
        const reviewedValues = { ...row.reviewedValues }
        delete reviewedValues[field]
        return { ...row, reviewedValues }
      })
      return { ...prev, [sheetId]: { ...result, payload: { ...result.payload, rows } } }
    })
    setEditingField(null)
  }

  const handleCommitEdit = () => {
    if (!editingField) return
    const value = editDraft.trim()
    if (value) {
      handleRowDecision(editingField.sheetId, editingField.rowIndex, editingField.field, { value, source: REVIEW_SOURCES.EDITED })
    } else {
      setEditingField(null)
    }
  }

  const handleToggleExcludeRow = (sheetId, rowIndex) => {
    setResultsBySheet((prev) => {
      const result = prev[sheetId]
      if (!result) return prev
      const excludedIndices = result.excludedIndices.includes(rowIndex)
        ? result.excludedIndices.filter((index) => index !== rowIndex)
        : [...result.excludedIndices, rowIndex]
      return { ...prev, [sheetId]: { ...result, excludedIndices } }
    })
  }

  const updateSheetMeta = (sheetId, patch) => {
    setResultsBySheet((prev) => {
      const result = prev[sheetId]
      if (!result) return prev
      return { ...prev, [sheetId]: { ...result, payload: { ...result.payload, sheet: { ...(result.payload.sheet || {}), ...patch } } } }
    })
  }

  const handleAttendanceMonthChange = (sheetId, month) => {
    setAttendanceMonths((prev) => ({ ...prev, [sheetId]: month }))
    updateSheetMeta(sheetId, { attendance_month: month })
    // Month is sheet-scoped and every decision is keyed by Sunday date, so a
    // new month never reuses decisions from another month.
    setEditingField(null)
  }

  const handleAttendanceConventionChange = (sheetId, convention) => {
    setAttendanceConventions((prev) => ({ ...prev, [sheetId]: convention }))
    updateSheetMeta(sheetId, { attendance_convention: convention })
  }

  // Decides this row is a brand-new member, prefilled from the reviewed scan
  // values. Nothing is written to DatSer here — the decision travels on the row
  // and is only acted on by a future final-save pass.
  const handleAddAsNewMember = (sheetId, rowIndex) => {
    setResultsBySheet((prev) => {
      const result = prev[sheetId]
      if (!result || result.status !== 'ok') return prev
      const rows = result.payload.rows.map((row, index) => {
        if (index !== rowIndex) return row
        return {
          ...row,
          memberAction: 'create-new',
          newMemberProfile: profileForNewMember(row),
          newMemberTarget: {
            mode: 'this-month',
            monthKey: getAttendanceSettings(sheetId).month || monthKeyFromDate(new Date())
          },
          selectedMemberId: undefined
        }
      })
      return { ...prev, [sheetId]: { ...result, payload: { ...result.payload, rows } } }
    })
    setChoosingMember(null)
  }

  // Reverts a create-new / choose-different decision back to the automatic match.
  const handleUseMatch = (sheetId, rowIndex) => {
    setResultsBySheet((prev) => {
      const result = prev[sheetId]
      if (!result || result.status !== 'ok') return prev
      const rows = result.payload.rows.map((row, index) => (index === rowIndex
        ? { ...row, memberAction: undefined, newMemberProfile: undefined, newMemberTarget: undefined, selectedMemberId: undefined }
        : row))
      return { ...prev, [sheetId]: { ...result, payload: { ...result.payload, rows } } }
    })
    setChoosingMember(null)
  }

  const handleChooseDifferentMember = (sheetId, rowIndex, memberId) => {
    setResultsBySheet((prev) => {
      const result = prev[sheetId]
      if (!result || result.status !== 'ok') return prev
      const rows = result.payload.rows.map((row, index) => (index === rowIndex
        ? { ...row, selectedMemberId: memberId, memberAction: undefined, newMemberProfile: undefined, newMemberTarget: undefined }
        : row))
      return { ...prev, [sheetId]: { ...result, payload: { ...result.payload, rows } } }
    })
    setChoosingMember(null)
  }

  const handleNewMemberTargetChange = (sheetId, rowIndex, patch) => {
    setResultsBySheet((prev) => {
      const result = prev[sheetId]
      if (!result || result.status !== 'ok') return prev
      const rows = result.payload.rows.map((row, index) => (index === rowIndex
        ? { ...row, newMemberTarget: { ...(row.newMemberTarget || {}), ...patch } }
        : row))
      return { ...prev, [sheetId]: { ...result, payload: { ...result.payload, rows } } }
    })
  }

  const handleAttendanceDecision = (sheetId, rowIndex, dateKey, decision) => {
    setResultsBySheet((prev) => {
      const result = prev[sheetId]
      if (!result || result.status !== 'ok') return prev
      const rows = result.payload.rows.map((row, index) => (
        index === rowIndex
          ? { ...row, reviewedAttendance: { ...(row.reviewedAttendance || {}), [dateKey]: decision } }
          : row
      ))
      return { ...prev, [sheetId]: { ...result, payload: { ...result.payload, rows } } }
    })
  }

  const handleClearAttendanceDecision = (sheetId, rowIndex, dateKey) => {
    setResultsBySheet((prev) => {
      const result = prev[sheetId]
      if (!result || result.status !== 'ok') return prev
      const rows = result.payload.rows.map((row, index) => {
        if (index !== rowIndex || !row.reviewedAttendance?.[dateKey]) return row
        const reviewedAttendance = { ...row.reviewedAttendance }
        delete reviewedAttendance[dateKey]
        return { ...row, reviewedAttendance }
      })
      return { ...prev, [sheetId]: { ...result, payload: { ...result.payload, rows } } }
    })
  }

  const loadSavedScans = async () => {
    setSavedScansStatus('loading')
    setSavedScansError('')
    try {
      const rows = await listSavedScans({ supabase, ownerId: workspaceId })
      setSavedScans(rows)
      setSavedScansStatus('ready')
      const entries = {}
      for (const scan of rows) {
        const first = Array.isArray(scan.sheet_images) ? scan.sheet_images[0] : null
        if (!first?.path) continue
        try {
          const url = await createSheetImageSignedUrl({ supabase, path: first.path })
          if (url) entries[scan.id] = url
        } catch {
          // A broken thumbnail is fine; the scan still opens from its record.
        }
      }
      if (Object.keys(entries).length) setScanThumbnails((prev) => ({ ...prev, ...entries }))
    } catch (error) {
      setSavedScansStatus('error')
      setSavedScansError(error?.message || 'Saved scans could not be loaded.')
    }
  }

  const toggleSavedScans = () => {
    setSaveMessage('')
    setSavedScansError('')
    const next = !showSavedScans
    setShowSavedScans(next)
    if (next) loadSavedScans()
  }

  // Re-opens a saved extraction directly into Compare & Correct. No Gemini
  // request is issued anywhere on this path.
  const handleOpenScan = async (scan) => {
    setSavedScansError('')
    try {
      const record = await getSavedScan({ supabase, id: scan.id })
      if (!record) throw new Error('The saved scan could not be found.')
      const images = Array.isArray(record.sheet_images) ? record.sheet_images : []
      if (!images.length) throw new Error('This scan has no saved sheets.')
      const sheetList = []
      const results = {}
      let firstId = null
      for (const image of images) {
        const url = await createSheetImageSignedUrl({ supabase, path: image.path })
        const sheetId = image.sheetId
        sheetList.push({
          id: sheetId,
          dataUrl: url,
          source: image.source || record.name,
          preset: 'original',
          intensity: PRESET_DEFAULT_INTENSITY.original,
          preview: url,
          image: null,
          storedPath: image.path
        })
        const snapshot = record.extraction?.[sheetId] || {}
        results[sheetId] = {
          status: 'ok',
          sheetId,
          source: image.source || record.name,
          error: '',
          excludedIndices: excludedIndicesFromSavedScan(record, sheetId),
          payload: {
            sheet: snapshot.sheet || { detected_headers: [], attendance_dates: [] },
            rows: Array.isArray(snapshot.rows) ? snapshot.rows : [],
            warnings: Array.isArray(snapshot.warnings) ? snapshot.warnings : [],
            extractedAt: snapshot.extractedAt || null,
            usageMetadata: usageMetadataFromSavedScan(record, sheetId)
          }
        }
        if (!firstId) firstId = sheetId
      }
      savedScanIdRef.current = record.id
      savedScanNameRef.current = record.name
      setSavedScanRecord({ id: record.id, name: record.name, savedAt: record.updated_at || record.created_at })
      // Recovery is read-only and comes from durable operation/step records.
      // save_result is only a legacy display cache and never authorizes retry.
      const operation = await getDurableSaveOperation({
        supabase,
        ownerId: workspaceId,
        savedScanId: record.id,
        operationId: null
      })
      setFinalSaveResult(operation ? finalSaveResultFromOperation(operation) : null)
      setPendingDuplicates(null)
      setSheets(sheetList)
      setIsScanning(false)
      setShowSavedScans(false)
      setResultsBySheet(results)
      setReviewIndex(0)
      setEditingField(null)
      setReviewActiveId(firstId)
      setStage('review')
    } catch (error) {
      setSavedScansError(error?.message || 'The saved scan could not be opened.')
    }
  }
  // Saves the current session's extraction privately and idempotently. The
  // first Save generates the scan id; every later Save UPSERTs the same row
  // and overwrites the same storage objects, so Gemini is never re-charged.
  const handleSaveScan = async () => {
    const okSheets = sheets.filter((sheet) => resultsBySheet[sheet.id]?.status === 'ok')
    if (!okSheets.length || saving) return
    setSaving(true)
    setSaveMessage('')
    setSavedScansError('')
    try {
      const scanId = savedScanIdRef.current || createSavedScanId()
      savedScanIdRef.current = scanId
      const name = savedScanNameRef.current || createScanName(okSheets.length)
      savedScanNameRef.current = name
      await savePaperScan({
        supabase,
        scanId,
        userId: user.id,
        ownerId: workspaceId,
        name,
        sheets,
        resultsBySheet,
        storedSheetImages: okSheets
          .map((sheet) => (sheet.storedPath ? { sheetId: sheet.id, path: sheet.storedPath } : null))
          .filter(Boolean)
      })
      setSavedScanRecord({ id: scanId, name, savedAt: new Date().toISOString() })
      setSaveMessage('Scan saved — reopening it will not use Gemini again.')
    } catch (error) {
      setSavedScansError(error?.message || 'The scan could not be saved.')
    } finally {
      setSaving(false)
    }
  }

  // Builds the current final-save plan from the live review state. Pure: it
  // only reads, and is used for both the confirmation summary and the save.
  const buildFinalSavePlanNow = () => {
    const settingsBySheet = {}
    sheets.forEach((sheet) => {
      settingsBySheet[sheet.id] = getAttendanceSettings(sheet.id)
    })
    return buildFinalSavePlan({
      sheets,
      resultsBySheet,
      currentMembers,
      monthlyTables,
      settingsBySheet
    })
  }

  // Persists the final-save result into the Saved Scan row (idempotent upsert
  // on the same scan id) so reopening shows the same summary without Gemini.
  const persistFinalSaveMetadata = async (metadata) => {
    const okSheets = sheets.filter((sheet) => resultsBySheet[sheet.id]?.status === 'ok')
    const scanId = savedScanIdRef.current || createSavedScanId()
    savedScanIdRef.current = scanId
    const name = savedScanNameRef.current || createScanName(okSheets.length)
    savedScanNameRef.current = name
    const meta = { ...(metadata || {}), scanId, name }
    await savePaperScan({
      supabase,
      scanId,
      userId: user.id,
      ownerId: workspaceId,
      name,
      sheets,
      resultsBySheet,
      storedSheetImages: okSheets
        .map((sheet) => (sheet.storedPath ? { sheetId: sheet.id, path: sheet.storedPath } : null))
        .filter(Boolean),
      extraMeta: meta
    })
    setSavedScanRecord({ id: scanId, name, savedAt: meta.savedAt })
    return { id: scanId, name }
  }

  // Post-save canonical refresh: attendance first, then the background member/
  // badge refresh. Never blocks the save result on the refresh succeeding.
  const triggerPostSaveRefresh = async () => {
    try {
      await loadAllAttendanceData?.({ forceOnline: true })
    } catch (error) {
      console.warn('Final save: attendance refresh failed:', error)
    }
    try {
      if (typeof fetchMembers === 'function') {
        await fetchMembers(currentTable, { forceRefresh: true, forceOnline: true })
      }
    } catch (error) {
      console.warn('Final save: member list refresh failed:', error)
    }
    try {
      await refreshSyncedDataInBackground?.('paper-scan-final-save', { force: true })
    } catch (error) {
      console.warn('Final save: background refresh failed:', error)
    }
  }

  // Durable retry context derived from the persisted save result: the stable
  // operation id and each row's canonical member id. A retry reuses both so a
  // partial earlier attempt can never duplicate a created member.
  const durableSaveContext = () => {
    const persistedMemberIds = {}
    ;(finalSaveResult?.members || []).forEach((member) => {
      if (member?.memberId) {
        persistedMemberIds[`${member.sheetId}:${member.rowIndex}`] = member.memberId
      }
    })
    return { operationId: finalSaveResult?.operationId || null, persistedMemberIds }
  }

  // Runs the controlled save. Double-save protection is both a state flag and a
  // ref so two rapid Confirm clicks can never start two passes.
  const runFinalSave = async ({ confirmedKeys, plan: frozenPlan = null }) => {
    if (finalSaveInFlightRef.current || finalSaving) return null
    finalSaveInFlightRef.current = true
    setFinalSaving(true)
    setFinalSaveProgress(0)
    setPendingDuplicates(null)
    setSavedScansError('')
    try {
      const plan = frozenPlan || buildFinalSavePlanNow()
      const priorOperation = durableSaveContext().operationId
      const operationId = priorOperation || createSavedScanId()
      // This upsert is a required precondition, not best-effort audit logging:
      // a durable scan id + operation id exists before Final Save may mutate.
      const saved = await persistFinalSaveMetadata({
        operationId,
        status: 'pending',
        savedAt: new Date().toISOString()
      })
      const result = await executeFinalSave({
        plan,
        confirmedDuplicateKeys: confirmedKeys || confirmedDuplicateKeys,
        deps: {
          supabase,
          updateMember,
          currentMembers,
          monthlyTables,
          currentTable,
          dataOwnerId: workspaceId,
          user,
          workspaceName: user?.app_metadata?.workspace_name || null,
          isOnline,
          offlineMode,
          operationId,
          savedScanId: saved.id
        }
      })
      setFinalSaveProgress(1)

      if (result.blockedDuplicates.length > 0) {
        // STOP: a likely duplicate needs explicit confirmation before any write.
        setPendingDuplicates({ entries: result.blockedDuplicates, plan })
        return null
      }

      setFinalSaveResult(result)
      try {
        const { id, name } = await persistFinalSaveMetadata(buildSaveResultMetadata({ result }))
        setFinalSaveResult((prev) => ({ ...prev, savedScan: { id, name } }))
      } catch (persistError) {
        console.warn('Final save result could not be persisted to the saved scan:', persistError)
      }
      await triggerPostSaveRefresh()
      return result
    } catch (error) {
      setSavedScansError(error?.message || 'The final save could not be completed.')
      return null
    } finally {
      finalSaveInFlightRef.current = false
      setFinalSaving(false)
    }
  }

  const handleConfirmFinalSave = () => {
    if (finalSaving) return
    // Refresh the member snapshot so the save-time duplicate check runs against
    // the latest data. Likely duplicates STOP the save before any write; the
    // user must explicitly confirm before a new member is created.
    const settingsBySheet = {}
    sheets.forEach((sheet) => {
      settingsBySheet[sheet.id] = getAttendanceSettings(sheet.id)
    })
    const preview = previewFinalSave({ sheets, resultsBySheet, currentMembers, monthlyTables, settingsBySheet })
    if (preview.duplicates.length > 0) {
      setPendingDuplicates({ entries: preview.duplicates, plan: preview.plan })
      return
    }
    runFinalSave({ confirmedKeys: [], plan: preview.plan })
  }

  const handleConfirmDuplicateAndContinue = () => {
    if (!pendingDuplicates) return
    const keys = pendingDuplicates.entries.map((entry) => ({ sheetId: entry.sheetId, rowIndex: entry.rowIndex }))
    setConfirmedDuplicateKeys((prev) => {
      const merged = [...prev]
      keys.forEach((key) => {
        const exists = merged.some((existing) => existing.sheetId === key.sheetId && existing.rowIndex === key.rowIndex)
        if (!exists) merged.push(key)
      })
      return merged
    })
    const plan = pendingDuplicates.plan
    setPendingDuplicates(null)
    runFinalSave({ confirmedKeys: [...confirmedDuplicateKeys, ...keys], plan })
  }

  const handleCancelDuplicateConfirm = () => {
    setPendingDuplicates(null)
  }

  // Retries ONLY the rows that failed in the previous pass. Every write is
  // idempotent, so re-applying an already-succeeded profile/attendance value is
  // safe (the server UPDATE still affects the row). The combined result is
  // recomputed from the merged per-member list.
  const handleRetryFailedSave = () => {
    if (finalSaveInFlightRef.current || finalSaving || !finalSaveResult) return
    if (!finalSaveResult.members.some((member) => member.status === FINAL_SAVE_STATUS.FAILED)) return
    const run = async () => {
      if (finalSaveInFlightRef.current) return
finalSaveInFlightRef.current = true
      setFinalSaving(true)
      setFinalSaveProgress(0)
      setSavedScansError('')
      try {
        const { operationId } = durableSaveContext()
        const retry = await retryPersistedFinalSave({
          operationId,
          deps: { supabase, dataOwnerId: workspaceId, user, isOnline, offlineMode, savedScanId: savedScanIdRef.current }
        })
        setFinalSaveProgress(1)
        const retried = new Map(retry.members.map((member) => [`${member.sheetId}:${member.rowIndex}`, member]))
        const mergedMembers = finalSaveResult.members.map((member) => (
          retried.get(`${member.sheetId}:${member.rowIndex}`) || member
        ))
        const summary = summarizeFinalSaveMembers(mergedMembers)
        const nextResult = { ...finalSaveResult, summary, members: mergedMembers, savedAt: new Date().toISOString() }
        setFinalSaveResult(nextResult)
        if (retry.blockedDuplicates.length === 0) {
          try {
            await persistFinalSaveMetadata(buildSaveResultMetadata({ result: nextResult }))
          } catch (persistError) {
            console.warn('Retry result could not be persisted to the saved scan:', persistError)
          }
          await triggerPostSaveRefresh()
        } else {
          setPendingDuplicates({ entries: retry.blockedDuplicates, plan: null })
        }
      } catch (error) {
        setSavedScansError(error?.message || 'The retry could not be completed.')
      } finally {
        finalSaveInFlightRef.current = false
        setFinalSaving(false)
      }
    }
    run()
  }

  const handleDismissSaveResult = () => {
    setFinalSaveResult(null)
    setPendingDuplicates(null)
    setConfirmedDuplicateKeys([])
  }

  const handleDeleteScan = async (scan) => {
    setSavedScansError('')
    try {
      await deleteSavedScan({ supabase, scan })
      setSavedScans((prev) => prev.filter((row) => row.id !== scan.id))
      setScanThumbnails((prev) => {
        const next = { ...prev }
        delete next[scan.id]
        return next
      })
      if (savedScanIdRef.current === scan.id) {
        savedScanIdRef.current = null
        setSavedScanRecord(null)
      }
    } catch (error) {
      setSavedScansError(error?.message || 'The scan could not be deleted.')
    }
  }

  const startRename = (scan) => {
    setRenamingScanId(scan.id)
    setRenameDraft(scan.name || '')
  }

  const cancelRename = () => {
    setRenamingScanId(null)
    setRenameDraft('')
  }

  const commitRename = async (scan) => {
    const trimmed = renameDraft.trim()
    if (!trimmed) {
      cancelRename()
      return
    }
    setSavedScansError('')
    try {
      const updated = await renameSavedScan({ supabase, id: scan.id, name: trimmed })
      const newName = updated?.name || trimmed
      setSavedScans((prev) => prev.map((row) => (row.id === scan.id ? { ...row, name: newName } : row)))
      if (savedScanIdRef.current === scan.id) {
        savedScanNameRef.current = newName
        setSavedScanRecord((prev) => (prev ? { ...prev, name: newName } : prev))
      }
      setRenamingScanId(null)
      setRenameDraft('')
    } catch (error) {
      setSavedScansError(error?.message || 'The scan could not be renamed.')
    }
  }

  const phase = PROCESSING_PHASES[phaseIndex] || PROCESSING_PHASES[PROCESSING_PHASES.length - 1]

  const reviewResult = reviewActiveId ? resultsBySheet[reviewActiveId] : null
  const reviewSheet = sheets.find((sheet) => sheet.id === reviewActiveId) || null
  const reviewRows = reviewResult?.status === 'ok' ? reviewResult.payload.rows : []
  const reviewWarnings = reviewResult?.status === 'ok' ? reviewResult.payload.warnings : []

  // Per scanned row: how it matches existing member data and how each field
  // compares to what DatSer already holds. Derived from the app's own member
  // search, never from a second matching implementation.
  const rowReviewData = useMemo(
    () => reviewRows.map((row) => {
      const match = computeRowMatch(row, currentMembers)
      return { row, match, summary: summarizeRowCompare(row, match.member) }
    }),
    [reviewRows, currentMembers]
  )

  const getAttendanceSettings = (sheetId) => {
    const sheetMeta = resultsBySheet[sheetId]?.payload?.sheet || {}
    const month = attendanceMonths[sheetId]
      || sheetMeta.attendance_month
      || (sheetMeta.attendance_dates?.[0]?.slice(0, 7))
      || monthKeyFromTableName(currentTable)
      || monthKeyFromDate(new Date())
    const convention = attendanceConventions[sheetId]
      || sheetMeta.attendance_convention
      || ATTENDANCE_CONVENTIONS.TICK_X
    const firstRow = resultsBySheet[sheetId]?.payload?.rows?.[0]
    const numericColumns = firstRow?.attendance && typeof firstRow.attendance === 'object' && !Array.isArray(firstRow.attendance)
      ? Object.keys(firstRow.attendance).reduce((max, key) => {
          const parsed = Number(key)
          if (Number.isInteger(parsed) && parsed > max) return parsed
          return max
        }, 0)
      : 0
    const columnCount = Number(sheetMeta.attendance_column_count)
      || firstRow?.attendance_column_count
      || numericColumns
      || (Array.isArray(sheetMeta.attendance_dates) ? sheetMeta.attendance_dates.length : 0)
      || 0
    return { month, convention, columnCount }
  }

  const attendanceSettings = reviewActiveId ? getAttendanceSettings(reviewActiveId) : { month: '', convention: ATTENDANCE_CONVENTIONS.TICK_X, columnCount: 0 }

  const renderReviewPanel = () => {
    const excludedSet = new Set(reviewResult?.excludedIndices || [])
    const okCount = sheets.filter((sheet) => resultsBySheet[sheet.id]?.status === 'ok').length
    const failedCount = sheets.filter((sheet) => resultsBySheet[sheet.id]?.status === 'failed').length
    const allRowData = sheets.flatMap((sheet) => {
      const result = resultsBySheet[sheet.id]
      if (result?.status !== 'ok') return []
      return result.payload.rows.map((row, index) => {
        const match = computeRowMatch(row, currentMembers)
        return { sheetId: sheet.id, sheetSource: sheet.source, row, index, match, summary: summarizeRowCompare(row, match.member) }
      })
    })
    const totalRows = allRowData.length
    const excludedRows = allRowData.filter(({ sheetId, index }) => (resultsBySheet[sheetId]?.excludedIndices || []).includes(index)).length
    const includedRows = totalRows - excludedRows
    const differingTotal = allRowData.reduce((sum, entry) => sum + entry.summary.totals.different + entry.summary.totals['low-confidence'], 0)
    const unresolvedTotal = allRowData.reduce((sum, entry) => sum + entry.summary.totals.unresolved, 0)
    const safeRowIndex = Math.min(reviewIndex, Math.max(rowReviewData.length - 1, 0))
    const activeRowData = rowReviewData[safeRowIndex] || null
    const changesEntries = allRowData.filter((entry) => entry.summary.totals.unresolved > 0 || entry.summary.totals.resolved > 0)

    // Final Review plan preview: what WOULD be written on Confirm Save, plus
    // any likely-duplicate rows that would block creation until confirmed.
    const settingsBySheet = {}
    sheets.forEach((sheet) => {
      settingsBySheet[sheet.id] = getAttendanceSettings(sheet.id)
    })
    const finalPreview = previewFinalSave({ sheets, resultsBySheet, currentMembers, monthlyTables, settingsBySheet })

    const renderDuplicateConfirm = ({ entries }) => (
      <div className="mt-4 rounded-2xl border border-amber-300 bg-amber-50 p-4 dark:border-amber-700 dark:bg-amber-950/30" role="dialog" aria-label="Possible duplicate confirmation">
        <div className="flex items-center gap-2 text-sm font-black text-amber-800 dark:text-amber-200">
          <AlertTriangle className="h-4 w-4 shrink-0" />
          Possible duplicate{entries.length > 1 ? 's' : ''} found
        </div>
        <p className="mt-1 text-xs font-medium text-amber-800/80 dark:text-amber-200/80">
          The saved review matches an existing member. Creating a new member is paused — confirm to continue, or cancel to fix the match.
        </p>
        <ul className="mt-3 space-y-2">
          {entries.map((entry) => (
            <li key={`${entry.sheetId}-${entry.rowIndex}`} className="rounded-xl border border-amber-200 bg-white p-3 text-xs dark:border-amber-800 dark:bg-gray-800">
              <p className="font-black text-gray-900 dark:text-white">{entry.name}</p>
              {entry.matches.map((member) => (
                <p key={member.id} className="mt-1 font-medium text-gray-600 dark:text-gray-300">
                  Matches existing: {member.full_name || member['Full Name'] || 'Unnamed'}
                  {(member['Phone Number'] || member.phone_number) ? ` · ${member['Phone Number'] || member.phone_number}` : ''}
                </p>
              ))}
            </li>
          ))}
        </ul>
        <div className="mt-4 flex flex-wrap gap-2">
          <button
            type="button"
            onClick={handleConfirmDuplicateAndContinue}
            disabled={finalSaving}
            data-testid="confirm-duplicate-continue"
            className="inline-flex min-h-[44px] items-center gap-2 rounded-xl bg-amber-600 px-4 py-2 text-xs font-black text-white transition-colors hover:bg-amber-700 disabled:cursor-not-allowed disabled:opacity-60"
          >
            <ShieldCheck className="h-4 w-4" />
            Continue anyway
          </button>
          <button
            type="button"
            onClick={handleCancelDuplicateConfirm}
            disabled={finalSaving}
            className="inline-flex min-h-[44px] items-center gap-2 rounded-xl border border-gray-200 bg-white px-4 py-2 text-xs font-black text-gray-700 transition-colors hover:border-amber-400 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-200"
          >
            Cancel
          </button>
        </div>
      </div>
    )

    const renderSaveResultSummary = (result) => {
      const summary = result.summary || {}
      const failures = result.members?.filter((member) => member.status === FINAL_SAVE_STATUS.FAILED) || []
      const skipped = result.members?.filter((member) => member.status === FINAL_SAVE_STATUS.SKIPPED) || []
      return (
        <div className="mt-4 rounded-2xl border border-green-300 bg-green-50 p-4 dark:border-green-700 dark:bg-green-950/30" role="status" aria-live="polite" data-testid="final-save-result">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <span className="grid h-10 w-10 place-items-center rounded-xl bg-green-600 text-white">
                <ShieldCheck className="h-5 w-5" />
              </span>
              <div>
                <p className="text-sm font-black text-green-900 dark:text-green-100">Saved to DatSer</p>
                <p className="text-xs font-medium text-green-800/80 dark:text-green-200/80">
                  {result.savedAt ? `Completed ${new Date(result.savedAt).toLocaleString()}` : 'Completed'}
                </p>
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={handleDismissSaveResult}
                className="inline-flex min-h-[44px] items-center gap-2 rounded-xl border border-green-300 bg-white px-4 py-2 text-xs font-black text-green-800 transition-colors hover:border-green-500 dark:border-green-700 dark:bg-gray-800 dark:text-green-200"
              >
                <ArrowLeft className="h-4 w-4" />
                Back to Review
              </button>
              <button
                type="button"
                onClick={handleRetryFailedSave}
                disabled={finalSaving || failures.length === 0}
                data-testid="retry-failed-items"
                className="inline-flex min-h-[44px] items-center gap-2 rounded-xl bg-orange-600 px-4 py-2 text-xs font-black text-white transition-colors hover:bg-orange-700 disabled:cursor-not-allowed disabled:opacity-45"
              >
                {finalSaving ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCcw className="h-4 w-4" />}
                {finalSaving ? 'Retrying…' : `Retry Failed${failures.length > 0 ? ` (${failures.length})` : ''}`}
              </button>
              <button
                type="button"
                onClick={onBack}
                className="inline-flex min-h-[44px] items-center gap-2 rounded-xl bg-green-700 px-4 py-2 text-xs font-black text-white transition-colors hover:bg-green-800"
              >
                <Check className="h-4 w-4" />
                Done
              </button>
            </div>
          </div>
          <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3">
            <span className="rounded-xl border border-green-200 bg-white px-3 py-2 text-xs dark:border-green-800 dark:bg-gray-800">
              <span data-testid="final-stat-saved" className="block font-black text-green-700 dark:text-green-300">{summary.saved || 0}</span>
              <span className="font-semibold text-gray-500 dark:text-gray-400">Saved successfully</span>
            </span>
            <span className="rounded-xl border border-green-200 bg-white px-3 py-2 text-xs dark:border-green-800 dark:bg-gray-800">
              <span data-testid="final-stat-created" className="block font-black text-green-700 dark:text-green-300">{summary.newMembersCreated || 0}</span>
              <span className="font-semibold text-gray-500 dark:text-gray-400">New members created</span>
            </span>
            <span className="rounded-xl border border-green-200 bg-white px-3 py-2 text-xs dark:border-green-800 dark:bg-gray-800">
              <span data-testid="final-stat-profile" className="block font-black text-green-700 dark:text-green-300">{summary.profileChanges || 0}</span>
              <span className="font-semibold text-gray-500 dark:text-gray-400">Profile changes</span>
            </span>
            <span className="rounded-xl border border-green-200 bg-white px-3 py-2 text-xs dark:border-green-800 dark:bg-gray-800">
              <span data-testid="final-stat-attendance" className="block font-black text-green-700 dark:text-green-300">{summary.attendanceUpdated || 0}</span>
              <span className="font-semibold text-gray-500 dark:text-gray-400">Attendance records updated</span>
            </span>
            <span className="rounded-xl border border-amber-200 bg-white px-3 py-2 text-xs dark:border-amber-800 dark:bg-gray-800">
              <span data-testid="final-stat-skipped" className="block font-black text-amber-700 dark:text-amber-300">{summary.skippedUnresolved || 0}</span>
              <span className="font-semibold text-gray-500 dark:text-gray-400">Skipped unresolved</span>
            </span>
            <span className={`rounded-xl border bg-white px-3 py-2 text-xs dark:bg-gray-800 ${summary.failed > 0 ? 'border-red-300 dark:border-red-800' : 'border-green-200 dark:border-green-800'}`}>
              <span data-testid="final-stat-failed" className={`block font-black ${summary.failed > 0 ? 'text-red-600 dark:text-red-400' : 'text-green-700 dark:text-green-300'}`}>{summary.failed || 0}</span>
              <span className="font-semibold text-gray-500 dark:text-gray-400">Failed</span>
            </span>
          </div>
          {summary.skippedMissingTable > 0 && (
            <p className="mt-2 text-xs font-medium text-amber-800/80 dark:text-amber-200/80">
              {summary.skippedMissingTable} attendance record{summary.skippedMissingTable === 1 ? '' : 's'} skipped because the month table does not exist (no table was created).
            </p>
          )}
          {failures.length > 0 && (
            <div className="mt-3 rounded-xl border border-red-200 bg-white p-3 dark:border-red-800 dark:bg-gray-800">
              <p className="text-[11px] font-black uppercase tracking-wider text-red-700 dark:text-red-300">Failed items</p>
              <ul className="mt-2 space-y-1.5">
                {failures.map((member) => (
                  <li key={`${member.sheetId}-${member.rowIndex}`} className="text-xs font-medium text-gray-700 dark:text-gray-300">
                    <span className="font-black text-gray-900 dark:text-white">{member.name}</span>
                    <span className="text-gray-400 dark:text-gray-500"> — </span>
                    {member.reason || 'Save failed.'}
                  </li>
                ))}
              </ul>
            </div>
          )}
          {skipped.length > 0 && (
            <p className="mt-2 text-xs font-medium text-gray-500 dark:text-gray-400">
              {skipped.length} {skipped.length === 1 ? 'row' : 'rows'} had no approved changes to write.
            </p>
          )}
        </div>
      )
    }

    return (
      <div className="rounded-2xl border border-gray-200 bg-white p-6 shadow-sm dark:border-gray-700 dark:bg-gray-800">
        <div className="mb-4 flex items-center gap-3">
          <span className="grid h-12 w-12 place-items-center rounded-2xl bg-orange-100 text-orange-600 dark:bg-orange-950/60 dark:text-orange-400">
            <Bot className="h-6 w-6" />
          </span>
          <div>
            <p className="text-sm font-black text-gray-900 dark:text-white">Review extracted data</p>
            <p className="text-xs font-medium text-gray-500 dark:text-gray-400">
              AI read {okCount} of {sheets.length} sheets. Correct anything wrong, then confirm before saving.
            </p>
          </div>
        </div>

        {/* Sheet tabs */}
        {sheets.length > 1 && (
          <div className="mb-4 flex gap-2 overflow-x-auto pb-1">
            {sheets.map((sheet, index) => {
              const status = resultsBySheet[sheet.id]?.status || 'pending'
              return (
                <button
                  key={sheet.id}
                  type="button"
                  onClick={() => setReviewActiveId(sheet.id)}
                  aria-pressed={reviewActiveId === sheet.id}
                  className={`inline-flex shrink-0 items-center gap-2 rounded-xl border px-3 py-2 text-xs font-bold transition-colors ${
                    reviewActiveId === sheet.id
                      ? 'border-orange-400 bg-orange-50 text-orange-800 dark:border-orange-700 dark:bg-orange-950/40 dark:text-orange-200'
                      : 'border-gray-200 bg-white text-gray-700 hover:border-orange-300 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-200'
                  }`}
                >
                  <span className="max-w-28 truncate">{index + 1}. {sheet.source}</span>
                  <span className={`rounded-full px-2 py-0.5 text-[10px] font-black ${
                    status === 'ok'
                      ? 'bg-green-100 text-green-700 dark:bg-green-950/50 dark:text-green-300'
                      : status === 'failed'
                        ? 'bg-red-100 text-red-700 dark:bg-red-950/50 dark:text-red-300'
                        : 'bg-gray-100 text-gray-500 dark:bg-gray-800 dark:text-gray-400'
                  }`}>
                    {status === 'ok' ? `${resultsBySheet[sheet.id].payload.rows.length} rows` : status === 'failed' ? 'Failed' : 'Pending'}
                  </span>
                </button>
              )
            })}
          </div>
        )}

        {!reviewResult ? (
          <p className="text-sm font-medium text-gray-500 dark:text-gray-400">No extraction results yet.</p>
        ) : reviewResult.status === 'pending' ? (
          <div className="flex items-center gap-2 rounded-2xl border border-orange-200 bg-orange-50/70 px-4 py-3 dark:border-orange-900/40 dark:bg-orange-950/20">
            <Loader2 className="h-4 w-4 shrink-0 animate-spin text-orange-600 dark:text-orange-300" />
            <p className="text-xs font-bold text-orange-800 dark:text-orange-200">Reading this sheet again...</p>
          </div>
        ) : reviewResult.status === 'failed' ? (
          <div className="rounded-2xl border border-red-200 bg-red-50 p-4 dark:border-red-900/40 dark:bg-red-950/20">
            <div className="flex items-center gap-2 text-sm font-black text-red-700 dark:text-red-300">
              <AlertTriangle className="h-4 w-4 shrink-0" />
              Extraction failed
            </div>
            <p className="mt-1 text-xs font-medium text-red-700/80 dark:text-red-300/80">{reviewResult.error || 'The sheet could not be read.'}</p>
            {reviewResult.retryable && (
              <p className="mt-1 text-xs font-medium text-orange-700/80 dark:text-orange-300/80">This looks like a temporary hiccup — retrying is safe.</p>
            )}
            <div className="mt-3 flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => handleRetrySheet(reviewResult.sheetId)}
                disabled={retryPending}
                className="inline-flex min-h-[44px] items-center gap-2 rounded-xl bg-orange-600 px-4 py-2 text-xs font-black text-white transition-colors hover:bg-orange-700 disabled:cursor-not-allowed disabled:opacity-60"
              >
                <RefreshCcw className="h-4 w-4" />
                Retry this sheet
              </button>
              <button
                type="button"
                onClick={handleBackToEditing}
                className="inline-flex min-h-[44px] items-center gap-2 rounded-xl border border-gray-200 bg-white px-4 py-2 text-xs font-black text-gray-700 transition-colors hover:border-orange-300 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-200"
              >
                <ArrowLeft className="h-4 w-4" />
                Back to editing
              </button>
            </div>
          </div>
        ) : (
          <>
            {reviewSheet && (
              <div className="mb-4 flex flex-wrap items-center gap-2">
                <span className="inline-flex items-center gap-1.5 rounded-full bg-orange-100 px-3 py-1 text-xs font-black text-orange-700 dark:bg-orange-950/50 dark:text-orange-300">
                  <ImagePlus className="h-3.5 w-3.5" />
                  {reviewSheet.source}
                </span>
                <span className="rounded-full bg-green-100 px-3 py-1 text-xs font-black text-green-700 dark:bg-green-950/50 dark:text-green-300">Read successfully</span>
              </div>
            )}

            {reviewWarnings.length > 0 && (
              <div className="mb-4 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 dark:border-amber-900/40 dark:bg-amber-950/20">
                <p className="text-xs font-black text-amber-800 dark:text-amber-200">Sheet-level notes</p>
                <ul className="mt-1 list-inside list-disc text-xs font-medium text-amber-800/80 dark:text-amber-200/80">
                  {reviewWarnings.map((warning, index) => <li key={index}>{warning}</li>)}
                </ul>
              </div>
            )}

            {(() => {
              const mappedColumns = mapAttendanceColumns({ month: attendanceSettings.month, columnCount: attendanceSettings.columnCount })
              const sundays = mappedColumns.filter((entry) => !entry.unused)
              const unused = mappedColumns.filter((entry) => entry.unused)
              const monthLabel = monthKeyLabel(attendanceSettings.month)
              return (
                <div className="mb-4 rounded-2xl border border-gray-200 bg-white p-4 dark:border-gray-700 dark:bg-gray-800">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-sm font-black text-gray-900 dark:text-white">Attendance month</p>
                      <p className="mt-0.5 text-xs font-medium text-gray-500 dark:text-gray-400">
                        Choose the month this attendance sheet belongs to.
                      </p>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      <label className="flex items-center gap-1.5 text-[11px] font-bold text-gray-500 dark:text-gray-400">
                        Month
                        <input
                          type="month"
                          value={attendanceSettings.month}
                          onChange={(event) => handleAttendanceMonthChange(reviewActiveId, event.target.value)}
                          aria-label="Attendance month"
                          className="h-9 rounded-lg border border-gray-200 bg-white px-2 text-[11px] font-bold text-gray-900 outline-none focus:border-orange-400 dark:border-gray-700 dark:bg-gray-800 dark:text-white"
                        />
                      </label>
                      <label className="flex items-center gap-1.5 text-[11px] font-bold text-gray-500 dark:text-gray-400">
                        How marks work
                        <select
                          value={attendanceSettings.convention}
                          onChange={(event) => handleAttendanceConventionChange(reviewActiveId, event.target.value)}
                          aria-label="Attendance convention"
                          className="h-9 rounded-lg border border-gray-200 bg-white px-2 text-[11px] font-bold text-gray-900 outline-none focus:border-orange-400 dark:border-gray-700 dark:bg-gray-800 dark:text-white"
                        >
                          {ATTENDANCE_CONVENTION_OPTIONS.map((option) => (
                            <option key={option.id} value={option.id}>{option.label}</option>
                          ))}
                        </select>
                      </label>
                    </div>
                  </div>
                  {attendanceSettings.month && (
                    <div className="mt-3 rounded-xl border border-gray-100 bg-gray-50 px-3 py-2 dark:border-gray-800 dark:bg-gray-900/40">
                      <p className="text-xs font-bold text-gray-700 dark:text-gray-300">
                        {sundays.length
                          ? `Columns 1–${sundays.length} are the Sundays for ${monthLabel}:`
                          : `No Sunday columns map to ${monthLabel}.`}
                      </p>
                      {sundays.length > 0 && (
                        <ul className="mt-1.5 flex flex-wrap gap-x-4 gap-y-1">
                          {sundays.map((entry) => {
                            const date = new Date(`${entry.dateKey}T00:00:00`)
                            const label = Number.isNaN(date.getTime()) ? entry.dateKey : date.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })
                            return (
                              <li key={entry.column} className="text-xs font-medium text-gray-600 dark:text-gray-300">
                                Col {entry.column} · {label}
                              </li>
                            )
                          })}
                        </ul>
                      )}
                      {unused.length > 0 && (
                        <p className="mt-1.5 text-xs font-medium text-gray-400 dark:text-gray-500">
                          Column{unused.length > 1 ? 's' : ''} {unused.map((entry) => entry.column).join(', ')} — Unused (no Sunday in {monthLabel}).
                        </p>
                      )}
                    </div>
                  )}
                </div>
              )
            })()}

            {reviewRows.length === 0 ? (
              <p className="rounded-2xl border border-dashed border-gray-200 px-4 py-6 text-center text-sm font-medium text-gray-500 dark:border-gray-700 dark:text-gray-400">
                No readable rows were found in this sheet.
              </p>
            ) : (
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                {/* LEFT: the photographed/uploaded sheet stays put on desktop
                    while members change; on mobile it leads the stacked layout.
                    Both panes share the same viewport height on md+ so the
                    workspace reads as one equal-height screen. */}
                <div className="min-w-0 md:sticky md:top-24 md:h-[calc(100vh-220px)] md:self-start">
                  <ReviewImagePane
                    fillHeight
                    originalSrc={reviewSheet?.dataUrl || ''}
                    enhancedSrc={reviewSheet?.preview || reviewSheet?.dataUrl || ''}
                    sourceLabel={reviewSheet?.source}
                    onOpenFullscreen={() => setViewer({ sheetId: reviewActiveId, mode: 'original' })}
                    activeLabel={activeRowData ? `Member ${safeRowIndex + 1} of ${rowReviewData.length}` : ''}
                  />
                </div>
                <div className="flex min-w-0 flex-col md:h-[calc(100vh-220px)]">
                {/* Member navigation stays at the top of the review column. */}
                <div className="mb-3 shrink-0 rounded-2xl border border-gray-200 bg-white/95 px-2 py-1.5 shadow-sm dark:border-gray-700 dark:bg-gray-900/95">
                  <div className="flex items-center justify-between gap-2">
                    <button
                      type="button"
                      onClick={() => setReviewIndex((index) => Math.max(0, index - 1))}
                      disabled={safeRowIndex === 0}
                      aria-label="Previous member"
                      className="inline-flex min-h-[44px] items-center gap-1 rounded-xl border border-gray-200 bg-white px-3 py-2 text-xs font-black text-gray-700 transition-colors hover:border-orange-300 disabled:cursor-not-allowed disabled:opacity-45 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-200"
                    >
                      <ChevronLeft className="h-4 w-4" />
                      Prev
                    </button>
                    <p role="status" className="text-xs font-black tabular-nums text-gray-900 dark:text-white">
                      Member {safeRowIndex + 1} of {rowReviewData.length}
                    </p>
                    <button
                      type="button"
                      onClick={() => setReviewIndex((index) => Math.min(rowReviewData.length - 1, index + 1))}
                      disabled={safeRowIndex >= rowReviewData.length - 1}
                      aria-label="Next member"
                      className="inline-flex min-h-[44px] items-center gap-1 rounded-xl border border-gray-200 bg-white px-3 py-2 text-xs font-black text-gray-700 transition-colors hover:border-orange-300 disabled:cursor-not-allowed disabled:opacity-45 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-200"
                    >
                      Next
                      <ChevronRight className="h-4 w-4" />
                    </button>
                  </div>
                </div>

                <div className="min-w-0 md:min-h-0 md:flex-1 md:overflow-y-auto md:pr-1">
                {activeRowData && (
                  <div className="rounded-2xl border border-gray-200 bg-white p-4 dark:border-gray-700 dark:bg-gray-800">
                    {/* Identity header */}
                    <div className="flex items-start gap-3">
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-1.5">
                          <p className="truncate text-base font-black text-gray-900 dark:text-white">
                            {activeRowData.row.full_name || `Member ${safeRowIndex + 1}`}
                          </p>
                          <span className={`rounded-full px-2 py-0.5 text-[10px] font-black ${MATCH_META[activeRowData.match.status].className}`}>
                            {MATCH_META[activeRowData.match.status].label}
                          </span>
                          {activeRowData.row.memberAction === 'create-new' && (
                            <span className="rounded-full bg-orange-600 px-2 py-0.5 text-[10px] font-black text-white">New member</span>
                          )}
                        </div>
                        <p className="mt-0.5 text-xs font-medium text-gray-500 dark:text-gray-400">
                          {activeRowData.row.memberAction === 'create-new'
                            ? 'This row will be added as a new member. Nothing is written until you confirm at final save.'
                            : activeRowData.match.member
                              ? `Matched to ${activeRowData.match.member.full_name || activeRowData.match.member['Full Name'] || 'a current member'}`
                              : activeRowData.match.status === 'possible'
                                ? 'Possible match — check this row before saving.'
                                : 'No existing DatSer member matches this row — add it as a new member.'}
                        </p>
                        <div className="mt-2 flex flex-wrap items-center gap-2">
                          {activeRowData.row.memberAction === 'create-new' || activeRowData.row.selectedMemberId ? (
                            <button
                              type="button"
                              onClick={() => handleUseMatch(reviewActiveId, safeRowIndex)}
                              className="inline-flex min-h-[36px] items-center gap-1 rounded-lg border border-gray-200 bg-white px-2.5 py-1.5 text-[11px] font-black text-gray-700 transition-colors hover:border-orange-300 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-200"
                            >
                              Use Match
                            </button>
                          ) : (
                            <button
                              type="button"
                              onClick={() => setChoosingMember({ sheetId: reviewActiveId, rowIndex: safeRowIndex })}
                              aria-expanded={choosingMember?.sheetId === reviewActiveId && choosingMember?.rowIndex === safeRowIndex}
                              className="inline-flex min-h-[36px] items-center gap-1 rounded-lg border border-gray-200 bg-white px-2.5 py-1.5 text-[11px] font-black text-gray-700 transition-colors hover:border-orange-300 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-200"
                            >
                              Choose Different Member
                            </button>
                          )}
                          <button
                            type="button"
                            onClick={() => handleAddAsNewMember(reviewActiveId, safeRowIndex)}
                            className="inline-flex min-h-[36px] items-center gap-1 rounded-lg bg-orange-600 px-2.5 py-1.5 text-[11px] font-black text-white transition-colors hover:bg-orange-700"
                          >
                            <UserPlus className="h-3.5 w-3.5" />
                            Add as New Member
                          </button>
                        </div>

                        {choosingMember?.sheetId === reviewActiveId && choosingMember?.rowIndex === safeRowIndex && (
                          <div className="mt-3 rounded-xl border border-gray-200 bg-gray-50 p-3 dark:border-gray-700 dark:bg-gray-900/40">
                            <p className="mb-2 text-xs font-black text-gray-700 dark:text-gray-300">Pick the member this row matches</p>
                            {currentMembers.length === 0 ? (
                              <p className="text-xs font-medium text-gray-500 dark:text-gray-400">No member data is loaded to choose from.</p>
                            ) : (
                              <ul className="max-h-48 space-y-1 overflow-y-auto">
                                {currentMembers.slice(0, 50).map((member) => (
                                  <li key={member.id}>
                                    <button
                                      type="button"
                                      onClick={() => handleChooseDifferentMember(reviewActiveId, safeRowIndex, member.id)}
                                      className="w-full rounded-lg px-2.5 py-1.5 text-left text-xs font-semibold text-gray-700 transition-colors hover:bg-orange-50 dark:text-gray-300 dark:hover:bg-orange-950/30"
                                    >
                                      {member.full_name || member['Full Name'] || member.id}
                                    </button>
                                  </li>
                                ))}
                              </ul>
                            )}
                          </div>
                        )}
                      </div>
                      <div className="flex shrink-0 flex-col items-end gap-2">
                        <button
                          type="button"
                          onClick={() => setViewer({ sheetId: reviewActiveId, mode: 'original' })}
                          aria-label="View photo"
                          className="grid h-10 w-10 place-items-center rounded-xl border border-gray-200 bg-white text-gray-600 transition-colors hover:border-orange-300 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-300"
                        >
                          <Eye className="h-4 w-4" />
                        </button>
                        <input
                          type="checkbox"
                          checked={!excludedSet.has(safeRowIndex)}
                          onChange={() => handleToggleExcludeRow(reviewActiveId, safeRowIndex)}
                          className="h-4 w-4 accent-orange-600"
                          aria-label={excludedSet.has(safeRowIndex)
                            ? `Keep ${activeRowData.row.full_name || `row ${safeRowIndex + 1}`}`
                            : `Exclude ${activeRowData.row.full_name || `row ${safeRowIndex + 1}`}`}
                        />
                      </div>
                    </div>

                    {activeRowData.row.memberAction === 'create-new' && (
                      <div className="mt-4 rounded-xl border border-orange-200 bg-orange-50/60 p-3 dark:border-orange-900/30 dark:bg-orange-950/20">
                        <p className="text-xs font-black text-orange-800 dark:text-orange-200">New member profile — prefilled from your reviewed scan values</p>
                        <div className="mt-2 grid grid-cols-2 gap-2 text-xs">
                          {COMPARE_FIELDS.map(({ key, label }) => (
                            <div key={key} className="rounded-lg border border-orange-100 bg-white px-2.5 py-2 dark:border-orange-900/40 dark:bg-gray-900/50">
                              <p className="text-[10px] font-black uppercase tracking-wider text-gray-400">{label}</p>
                              <p className="mt-0.5 truncate font-bold text-gray-900 dark:text-white">
                                {activeRowData.row.newMemberProfile?.[key] || '—'}
                              </p>
                            </div>
                          ))}
                        </div>
                        {(() => {
                          const target = activeRowData.row.newMemberTarget || {}
                          const monthKey = target.monthKey || attendanceSettings.month || monthKeyFromDate(new Date())
                          const year = monthYearFromKey(monthKey)
                          const mode = target.mode === 'all-year' ? 'all-year' : 'this-month'
                          const yearTables = year ? monthTablesInYear(monthlyTables, year) : []
                          const existingTarget = mode === 'all-year'
                            ? yearTables
                            : yearTables.filter((table) => monthKeyFromTableName(table) === monthKey)
                          const missing = mode === 'all-year' && year
                            ? missingMonthsInYear(monthlyTables, year)
                            : (existingTarget.length === 0 && monthKey ? [monthKey] : [])
                          return (
                            <>
                              <p className="mt-3 text-xs font-black text-orange-800 dark:text-orange-200">Add this member to</p>
                              <div className="mt-1.5 flex flex-wrap gap-3">
                                <label className="flex items-center gap-1.5 text-xs font-semibold text-gray-700 dark:text-gray-300">
                                  <input
                                    type="radio"
                                    checked={mode === 'this-month'}
                                    onChange={() => handleNewMemberTargetChange(reviewActiveId, safeRowIndex, { mode: 'this-month' })}
                                    className="h-3.5 w-3.5 accent-orange-600"
                                  />
                                  This month only
                                </label>
                                <label className="flex items-center gap-1.5 text-xs font-semibold text-gray-700 dark:text-gray-300">
                                  <input
                                    type="radio"
                                    checked={mode === 'all-year'}
                                    onChange={() => handleNewMemberTargetChange(reviewActiveId, safeRowIndex, { mode: 'all-year' })}
                                    className="h-3.5 w-3.5 accent-orange-600"
                                  />
                                  All months in {year || 'this year'}
                                </label>
                                <label className="flex items-center gap-1.5 text-xs font-semibold text-gray-700 dark:text-gray-300">
                                  Month
                                  <input
                                    type="month"
                                    value={monthKey}
                                    onChange={(event) => handleNewMemberTargetChange(reviewActiveId, safeRowIndex, { monthKey: event.target.value })}
                                    aria-label="New member target month"
                                    className="h-8 rounded-lg border border-orange-200 bg-white px-2 text-[11px] font-bold text-gray-900 outline-none focus:border-orange-400 dark:border-gray-700 dark:bg-gray-800 dark:text-white"
                                  />
                                </label>
                              </div>
                              <div className="mt-2 space-y-1.5 text-xs font-medium text-gray-700 dark:text-gray-300">
                                <p>
                                  {existingTarget.length > 0
                                    ? <>Will be added to: <span className="font-black">{existingTarget.map((table) => table.replace(/_/g, ' ')).join(' · ')}</span></>
                                    : 'This member has no existing month table in the target range yet.'}
                                </p>
                                {missing.length > 0 && (
                                  <p className="text-amber-700 dark:text-amber-300">
                                    No table for {missing.map((key) => monthKeyLabel(key)).join(' · ')} — it will be listed as a missing month at final save. Not created in this pass.
                                  </p>
                                )}
                              </div>
                            </>
                          )
                        })()}
                      </div>
                    )}

                    {membersStatus === 'failed' && (
                      <p className="mt-3 rounded-xl border border-gray-200 bg-gray-50 px-3 py-2 text-xs font-medium text-gray-500 dark:border-gray-700 dark:bg-gray-900/40 dark:text-gray-400">
                        Current member data could not be loaded — matching is disabled for this batch. You can still correct the scan.
                      </p>
                    )}

                    {/* Per-field comparison */}
                    <ul className="mt-4 divide-y divide-gray-100 dark:divide-gray-800">
                      {COMPARE_FIELDS.map(({ key, label }) => {
                        const compare = activeRowData.summary.compares.find((entry) => entry.field === key)
                        const meta = FIELD_STATE_META[compare.state]
                        const geminiValue = activeRowData.row.originalGeminiValue?.[key] ?? activeRowData.row[key]
                        const existingValue = getExistingValue(activeRowData.match.member, key)
                        const decision = activeRowData.row.reviewedValues?.[key]
                        const isEditing = editingField?.sheetId === reviewActiveId && editingField?.rowIndex === safeRowIndex && editingField?.field === key
                        const effectiveValue = getEffectiveValue({ field: key, compare, row: activeRowData.row, member: activeRowData.match.member })
                        return (
                          <li key={key} className="py-3">
                            <div className="flex flex-wrap items-center justify-between gap-1.5">
                              <p className="text-[11px] font-black uppercase tracking-wider text-gray-500 dark:text-gray-400">{label}</p>
                              <span className={`rounded-full px-2 py-0.5 text-[10px] font-black ${meta.className}`}>{meta.label}</span>
                            </div>

                            {decision ? (
                              <div className="mt-2 flex flex-wrap items-center gap-2">
                                <span className="text-sm font-bold text-gray-900 dark:text-white">{decision.value || '—'}</span>
                                <span className="rounded-full bg-gray-100 px-2 py-0.5 text-[10px] font-black text-gray-600 dark:bg-gray-800 dark:text-gray-300">
                                  {DECISION_SOURCE_LABEL[decision.source] || decision.source}
                                </span>
                                <button
                                  type="button"
                                  onClick={() => handleClearDecision(reviewActiveId, safeRowIndex, key)}
                                  aria-label={`Clear ${label} decision`}
                                  className="grid h-8 w-8 place-items-center rounded-lg text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-700 dark:hover:bg-gray-700 dark:hover:text-gray-200"
                                >
                                  <X className="h-4 w-4" />
                                </button>
                              </div>
                            ) : isEditing ? (
                              <div className="mt-2 flex gap-2">
                                <input
                                  type="text"
                                  value={editDraft}
                                  onChange={(event) => setEditDraft(event.target.value)}
                                  onKeyDown={(event) => {
                                    if (event.key === 'Enter') handleCommitEdit()
                                    if (event.key === 'Escape') setEditingField(null)
                                  }}
                                  autoFocus
                                  aria-label={`Edit ${label}`}
                                  className="min-w-0 flex-1 rounded-lg border border-gray-200 bg-white px-2.5 py-1.5 text-sm font-medium text-gray-900 outline-none focus:border-orange-400 dark:border-gray-700 dark:bg-gray-900 dark:text-white"
                                />
                                <button
                                  type="button"
                                  onClick={handleCommitEdit}
                                  aria-label={`Confirm ${label} edit`}
                                  className="grid h-10 w-10 shrink-0 place-items-center rounded-lg bg-orange-600 text-white transition-colors hover:bg-orange-700"
                                >
                                  <Check className="h-4 w-4" />
                                </button>
                                <button
                                  type="button"
                                  onClick={() => setEditingField(null)}
                                  aria-label={`Cancel ${label} edit`}
                                  className="grid h-10 w-10 shrink-0 place-items-center rounded-lg border border-gray-200 bg-white text-gray-600 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-300"
                                >
                                  <X className="h-4 w-4" />
                                </button>
                              </div>
                            ) : (
                              <>
                                <div className="mt-2 grid grid-cols-3 gap-2 text-xs">
                                  <div className="min-w-0 rounded-xl border border-gray-100 bg-gray-50 p-2 dark:border-gray-800 dark:bg-gray-900/40">
                                    <p className="text-[10px] font-black uppercase tracking-wider text-gray-400 dark:text-gray-500">AI read</p>
                                    <p className={`mt-0.5 truncate font-semibold ${geminiValue ? 'text-gray-900 dark:text-white' : 'text-gray-400 dark:text-gray-500'}`}>
                                      {geminiValue || '—'}
                                    </p>
                                  </div>
                                  <div className="min-w-0 rounded-xl border border-gray-100 bg-gray-50 p-2 dark:border-gray-800 dark:bg-gray-900/40">
                                    <p className="text-[10px] font-black uppercase tracking-wider text-gray-400 dark:text-gray-500">In DatSer</p>
                                    <p className={`mt-0.5 truncate font-semibold ${existingValue ? 'text-gray-900 dark:text-white' : 'text-gray-400 dark:text-gray-500'}`}>
                                      {existingValue || (activeRowData.match.member ? '—' : 'no member')}
                                    </p>
                                  </div>
                                  <div className="min-w-0 rounded-xl border border-orange-100 bg-orange-50/60 p-2 dark:border-orange-900/30 dark:bg-orange-950/20">
                                    <p className="text-[10px] font-black uppercase tracking-wider text-orange-500 dark:text-orange-300">Final</p>
                                    <p className={`mt-0.5 truncate font-semibold ${effectiveValue ? 'text-gray-900 dark:text-white' : 'text-gray-400 dark:text-gray-500'}`}>
                                      {effectiveValue || '—'}
                                    </p>
                                  </div>
                                </div>
                                {(compare.state === FIELD_STATES.DIFFERENT || compare.state === FIELD_STATES.LOW_CONFIDENCE) && (
                                  <div className="mt-2 flex flex-wrap gap-2">
                                    <button
                                      type="button"
                                      onClick={() => handleRowDecision(reviewActiveId, safeRowIndex, key, { value: geminiValue, source: REVIEW_SOURCES.SCAN })}
                                      aria-label={`Use scan for ${label}`}
                                      className="inline-flex min-h-[44px] items-center gap-1.5 rounded-xl bg-orange-600 px-3 py-2 text-xs font-black text-white transition-colors hover:bg-orange-700"
                                    >
                                      <ScanLine className="h-3.5 w-3.5" />
                                      Use Scan
                                    </button>
                                    <button
                                      type="button"
                                      onClick={() => handleRowDecision(reviewActiveId, safeRowIndex, key, { value: existingValue, source: REVIEW_SOURCES.DATSER })}
                                      disabled={!activeRowData.match.member || !existingValue}
                                      aria-label={`Keep DatSer ${label}`}
                                      className="inline-flex min-h-[44px] items-center gap-1.5 rounded-xl border border-gray-200 bg-white px-3 py-2 text-xs font-black text-gray-700 transition-colors hover:border-orange-300 disabled:cursor-not-allowed disabled:opacity-45 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-200"
                                    >
                                      <ShieldCheck className="h-3.5 w-3.5" />
                                      Keep DatSer
                                    </button>
                                    <button
                                      type="button"
                                      onClick={() => {
                                        setEditingField({ sheetId: reviewActiveId, rowIndex: safeRowIndex, field: key })
                                        setEditDraft(geminiValue || existingValue)
                                      }}
                                      aria-label={`Edit ${label}`}
                                      className="inline-flex min-h-[44px] items-center gap-1.5 rounded-xl border border-gray-200 bg-white px-3 py-2 text-xs font-black text-gray-700 transition-colors hover:border-orange-300 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-200"
                                    >
                                      <Pencil className="h-3.5 w-3.5" />
                                      Edit
                                    </button>
                                  </div>
                                )}
                              </>
                            )}
                          </li>
                        )
                      })}
                    </ul>

                    {/* Attendance — month-specific Sundays, raw marks preserved */}
                    <div className="mt-4 rounded-xl border border-gray-100 bg-gray-50 p-3 dark:border-gray-800 dark:bg-gray-900/40">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <p className="text-[11px] font-black uppercase tracking-wider text-gray-500 dark:text-gray-400">
                          Attendance{monthKeyLabel(attendanceSettings.month) ? ` — ${monthKeyLabel(attendanceSettings.month).toUpperCase()}` : ''}
                        </p>
                      </div>
                      {!attendanceSettings.month ? (
                        <p className="mt-2 text-xs font-medium text-gray-500 dark:text-gray-400">Choose the month this attendance sheet belongs to.</p>
                      ) : (() => {
                        const attendanceEntries = resolveAttendanceEntries({
                          attendance: activeRowData.row.attendance,
                          month: attendanceSettings.month,
                          columnCount: attendanceSettings.columnCount,
                          convention: attendanceSettings.convention
                        })
                        const hasMarks = attendanceEntries.some((entry) => entry.dateKey && Boolean(entry.rawMark))
                        const mapped = attendanceEntries.filter((entry) => entry.dateKey)
                        const unused = attendanceEntries.filter((entry) => !entry.dateKey)
                        return (
                          <div className="mt-2 space-y-3">
                            {!hasMarks && (
                              <p className="text-xs font-medium text-gray-500 dark:text-gray-400">
                                No attendance marks were detected for this member. Review the Sundays below.
                              </p>
                            )}
                            {mapped.map((entry) => {
                              const decision = activeRowData.row.reviewedAttendance?.[entry.dateKey]
                              const final = decision?.value || entry.interpreted.status
                              const datserValue = activeRowData.match.member
                                ? getExistingValue(activeRowData.match.member, attendanceColumnNameForDate(entry.dateKey))
                                : ''
                              const sameAsDatser = Boolean(datserValue) && final === datserValue
                              const needsReview = entry.interpreted.needsReview || (decision && !sameAsDatser)
                              const date = new Date(`${entry.dateKey}T00:00:00`)
                              const dateLabel = Number.isNaN(date.getTime())
                                ? entry.dateKey
                                : date.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })
                              const setValue = (value) => {
                                const source = entry.interpreted.status === value && value !== ATTENDANCE_STATUS.NEEDS_REVIEW ? REVIEW_SOURCES.SCAN : REVIEW_SOURCES.EDITED
                                handleAttendanceDecision(reviewActiveId, safeRowIndex, entry.dateKey, { value, source })
                              }
                              return (
                                <div key={entry.column} className="rounded-xl border border-gray-100 bg-white p-2.5 dark:border-gray-700 dark:bg-gray-800">
                                  <div className="flex flex-wrap items-center justify-between gap-1.5">
                                    <p className="text-xs font-black text-gray-900 dark:text-white">{dateLabel}</p>
                                    <span className={`rounded-full px-2 py-0.5 text-[10px] font-black ${needsReview
                                      ? 'bg-amber-100 text-amber-700 dark:bg-amber-950/50 dark:text-amber-300'
                                      : sameAsDatser
                                        ? 'bg-green-100 text-green-700 dark:bg-green-950/50 dark:text-green-300'
                                        : 'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-300'}`}
                                    >
                                      {needsReview ? ATTENDANCE_STATUS.NEEDS_REVIEW : sameAsDatser ? 'Same' : 'New'}
                                    </span>
                                  </div>
                                  <div className="mt-1.5 grid grid-cols-3 gap-2 text-xs">
                                    <div className="min-w-0 rounded-lg border border-gray-100 bg-gray-50 p-1.5 dark:border-gray-700 dark:bg-gray-900/40">
                                      <p className="text-[10px] font-black uppercase tracking-wider text-gray-400 dark:text-gray-500">Paper</p>
                                      <p className="truncate font-bold text-gray-900 dark:text-white">
                                        {markSymbolFor(entry.markToken)}
                                      </p>
                                    </div>
                                    <div className="min-w-0 rounded-lg border border-gray-100 bg-gray-50 p-1.5 dark:border-gray-700 dark:bg-gray-900/40">
                                      <p className="text-[10px] font-black uppercase tracking-wider text-gray-400 dark:text-gray-500">AI</p>
                                      <p className="truncate font-semibold text-gray-900 dark:text-white">{entry.interpreted.status}</p>
                                    </div>
                                    <div className="min-w-0 rounded-lg border border-orange-100 bg-orange-50/60 p-1.5 dark:border-orange-900/30 dark:bg-orange-950/20">
                                      <p className="text-[10px] font-black uppercase tracking-wider text-orange-500 dark:text-orange-300">Final</p>
                                      <p className="truncate font-semibold text-gray-900 dark:text-white">{final || '—'}</p>
                                    </div>
                                  </div>
                                  {entry.interpreted.needsReview && (
                                    <p className="mt-1.5 text-[11px] font-medium text-amber-700 dark:text-amber-300">
                                      This mark needs your review.
                                    </p>
                                  )}
                                  <div className="mt-2 flex flex-wrap items-center gap-1.5">
                                    <button
                                      type="button"
                                      onClick={() => setValue(ATTENDANCE_STATUS.PRESENT)}
                                      aria-label={`Mark ${dateLabel} as Present`}
                                      className="inline-flex min-h-[32px] items-center gap-1 rounded-lg bg-orange-600 px-2.5 py-1 text-[11px] font-black text-white transition-colors hover:bg-orange-700"
                                    >
                                      Present
                                    </button>
                                    <button
                                      type="button"
                                      onClick={() => setValue(ATTENDANCE_STATUS.ABSENT)}
                                      aria-label={`Mark ${dateLabel} as Absent`}
                                      className="inline-flex min-h-[32px] items-center gap-1 rounded-lg border border-gray-200 bg-white px-2.5 py-1 text-[11px] font-black text-gray-700 transition-colors hover:border-orange-300 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-200"
                                    >
                                      Absent
                                    </button>
                                    <button
                                      type="button"
                                      onClick={() => setValue(ATTENDANCE_STATUS.NEEDS_REVIEW)}
                                      aria-label={`Mark ${dateLabel} as Needs Review`}
                                      className="inline-flex min-h-[32px] items-center gap-1 rounded-lg border border-gray-200 bg-white px-2.5 py-1 text-[11px] font-black text-gray-700 transition-colors hover:border-orange-300 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-200"
                                    >
                                      Needs Review
                                    </button>
                                    {decision && (
                                      <button
                                        type="button"
                                        onClick={() => handleClearAttendanceDecision(reviewActiveId, safeRowIndex, entry.dateKey)}
                                        aria-label={`Clear ${dateLabel} attendance decision`}
                                        className="grid h-8 w-8 place-items-center rounded-lg text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-700 dark:hover:bg-gray-700 dark:hover:text-gray-200"
                                      >
                                        <X className="h-4 w-4" />
                                      </button>
                                    )}
                                  </div>
                                </div>
                              )
                            })}
                            {unused.length > 0 && (
                              <div className="space-y-1">
                                {unused.map((entry) => (
                                  <p key={entry.column} className="text-xs font-medium text-gray-400 dark:text-gray-500">
                                    Col {entry.column} — Unused (no Sunday in {monthKeyLabel(attendanceSettings.month)}).
                                  </p>
                                ))}
                              </div>
                            )}
                          </div>
                        )
                      })()}
                    </div>

                    {activeRowData.row.warnings?.length > 0 && (
                      <div className="mt-3 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 dark:border-amber-900/40 dark:bg-amber-950/20">
                        <ul className="list-inside list-disc text-xs font-medium text-amber-800/80 dark:text-amber-200/80">
                          {activeRowData.row.warnings.map((warning, warningIndex) => <li key={warningIndex}>{warning}</li>)}
                        </ul>
                      </div>
                    )}
                  </div>
                )}
                </div>
                </div>
              </div>
            )}

            {reviewSheet && (
              <div className="mt-4 rounded-xl border border-gray-200 bg-gray-50 p-3 dark:border-gray-700 dark:bg-gray-900/40">
                <p className="text-[11px] font-black uppercase tracking-wider text-gray-500 dark:text-gray-400">Detected headers</p>
                <div className="mt-1.5 flex flex-wrap gap-1.5">
                  {reviewResult.payload.sheet.detected_headers.length ? (
                    reviewResult.payload.sheet.detected_headers.map((header, index) => (
                      <span key={index} className="rounded-full bg-gray-100 px-2.5 py-0.5 text-[11px] font-bold text-gray-600 dark:bg-gray-800 dark:text-gray-300">{header}</span>
                    ))
                  ) : (
                    <span className="text-xs font-medium text-gray-400 dark:text-gray-500">None detected</span>
                  )}
                </div>
              </div>
            )}

            {/* Footer */}
            <div className="mt-6 rounded-2xl border border-gray-200 bg-gray-50 px-4 py-3 dark:border-gray-700 dark:bg-gray-900/40">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-sm font-black text-gray-900 dark:text-white">
                    {includedRows} of {totalRows} rows will be saved
                    {differingTotal > 0 ? ` · ${differingTotal} differing fields` : ''}
                  </p>
                  <p className="text-xs font-medium text-gray-500 dark:text-gray-400">
                    {excludedRows > 0 ? `${excludedRows} ${excludedRows === 1 ? 'row' : 'rows'} excluded. ` : ''}
                    {failedCount > 0 ? `${failedCount} ${failedCount === 1 ? 'sheet' : 'sheets'} failed extraction. ` : ''}
                    {unresolvedTotal > 0 ? `${unresolvedTotal} unresolved field${unresolvedTotal === 1 ? '' : 's'} need a choice. ` : ''}
                    Final review is next — nothing is written until you confirm.
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setShowChanges((open) => !open)}
                    aria-expanded={showChanges}
                    className="inline-flex min-h-[44px] items-center gap-2 rounded-2xl border border-orange-200 bg-white px-4 py-2.5 text-xs font-black text-orange-700 transition-colors hover:border-orange-400 dark:border-orange-800 dark:bg-gray-800 dark:text-orange-300"
                  >
                    <CheckCircle2 className="h-4 w-4" />
                    Review Changes{unresolvedTotal > 0 ? ` (${unresolvedTotal} unresolved)` : ''}
                  </button>
                  <button
                    type="button"
                    onClick={handleConfirmFinalSave}
                    disabled={finalSaving || saving || totalRows === 0}
                    data-testid="confirm-save-to-datser"
                    className="inline-flex min-h-[44px] items-center gap-2 rounded-2xl bg-green-600 px-4 py-2.5 text-xs font-black text-white transition-colors hover:bg-green-700 disabled:cursor-not-allowed disabled:opacity-45"
                  >
                    {finalSaving
                      ? <Loader2 className="h-4 w-4 animate-spin" />
                      : <ShieldCheck className="h-4 w-4" />}
                    {finalSaving ? 'Saving to DatSer…' : 'Confirm Save to DatSer'}
                  </button>
                  <button
                    type="button"
                    onClick={handleSaveScan}
                    disabled={saving || totalRows === 0}
                    className="inline-flex min-h-[44px] items-center gap-2 rounded-2xl bg-orange-600 px-4 py-2.5 text-xs font-black text-white transition-colors hover:bg-orange-700 disabled:cursor-not-allowed disabled:opacity-45"
                  >
                    {saving
                      ? <Loader2 className="h-4 w-4 animate-spin" />
                      : <Save className="h-4 w-4" />}
                    {saving ? 'Saving scan…' : savedScanRecord ? 'Save scan again' : 'Save scan'}
                  </button>
                </div>
                {finalSaving && (
                  <div className="flex w-full items-center gap-2" role="status" aria-live="polite">
                    <Loader2 className="h-4 w-4 shrink-0 animate-spin text-green-700 dark:text-green-400" />
                    <p className="text-xs font-bold text-green-800 dark:text-green-300">
                      {finalSaveProgress === 0 ? 'Reviewing the approved changes…' : 'Writing approved changes to DatSer…'}
                    </p>
                  </div>
                )}
                {saveMessage && (
                  <p className="mt-2 text-xs font-bold text-green-700 dark:text-green-300">{saveMessage}</p>
                )}
                {savedScansError && (
                  <p role="alert" className="mt-2 text-xs font-bold text-red-700 dark:text-red-300">{savedScansError}</p>
                )}
              </div>

              {showChanges && (
                <div className="mt-4 border-t border-gray-200 pt-3 dark:border-gray-700">
                  <p className="text-[11px] font-black uppercase tracking-wider text-gray-500 dark:text-gray-400">Pending review choices</p>
                  {changesEntries.length === 0 ? (
                    <p className="mt-2 text-xs font-medium text-gray-500 dark:text-gray-400">
                      No conflicting fields — every scanned value already matches DatSer.
                    </p>
                  ) : (
                    <ul className="mt-2 space-y-2">
                      {changesEntries.map((entry) => (
                        <li key={`${entry.sheetId}-${entry.index}`} className="rounded-xl border border-gray-200 bg-white p-3 text-xs dark:border-gray-700 dark:bg-gray-800">
                          <p className="font-black text-gray-900 dark:text-white">
                            {entry.row.full_name || `Member ${entry.index + 1}`}
                            <span className="font-semibold text-gray-400 dark:text-gray-500"> · {entry.sheetSource}</span>
                          </p>
                          {entry.summary.compares.filter((compare) => compare.state === FIELD_STATES.DIFFERENT || compare.state === FIELD_STATES.LOW_CONFIDENCE).map((compare) => {
                            const fieldMeta = COMPARE_FIELDS.find((field) => field.key === compare.field)
                            const decision = entry.row.reviewedValues?.[compare.field]
                            const geminiValue = entry.row.originalGeminiValue?.[compare.field] ?? entry.row[compare.field]
                            const existingValue = getExistingValue(entry.match.member, compare.field)
                            return (
                              <p key={compare.field} className="mt-1 font-medium leading-relaxed text-gray-600 dark:text-gray-300">
                                {fieldMeta?.label}: {decision ? (
                                  <span className="font-black text-green-700 dark:text-green-400">
                                    → {decision.value || '—'} ({DECISION_SOURCE_LABEL[decision.source] || decision.source})
                                  </span>
                                ) : (
                                  <span className="font-black text-orange-700 dark:text-orange-400">
                                    needs a choice — scan: {geminiValue || '—'} · DatSer: {existingValue || '—'}
                                  </span>
                                )}
                              </p>
                            )
                          })}
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              )}
            </div>

            {pendingDuplicates && renderDuplicateConfirm(pendingDuplicates)}
            {finalSaveResult && renderSaveResultSummary(finalSaveResult)}
          </>
        )}
      </div>
    )
  }

  const renderSavedScansPanel = () => {
    const totalTokens = savedScans.reduce((sum, scan) => {
      const total = scan.usage_metadata?._total
      return sum + (total ? (Number(total.promptTokenCount) || 0) + (Number(total.candidatesTokenCount) || 0) : 0)
    }, 0)

    return (
      <div className="rounded-2xl border border-gray-200 bg-white p-6 shadow-sm dark:border-gray-700 dark:bg-gray-800">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <span className="grid h-12 w-12 place-items-center rounded-2xl bg-orange-100 text-orange-600 dark:bg-orange-950/60 dark:text-orange-400">
              <ScanLine className="h-6 w-6" />
            </span>
            <div>
              <p className="text-sm font-black text-gray-900 dark:text-white">Saved scans</p>
              <p className="text-xs font-medium text-gray-500 dark:text-gray-400">
                {savedScans.length} {savedScans.length === 1 ? 'scan' : 'scans'} · opening never re-bills Gemini
                {totalTokens > 0 ? ` · ${totalTokens} tokens used` : ''}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={toggleSavedScans}
            className="inline-flex min-h-[44px] items-center gap-1.5 rounded-xl border border-gray-200 bg-white px-3 py-2 text-xs font-bold text-gray-700 transition-colors hover:border-orange-300 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-200"
          >
            <X className="h-3.5 w-3.5" />
            Close
          </button>
        </div>

        {savedScansError && (
          <div role="alert" className="mb-4 rounded-2xl border border-red-200 bg-red-50/70 px-4 py-3 text-xs font-bold text-red-700 dark:border-red-900/40 dark:bg-red-950/20 dark:text-red-300">
            {savedScansError}
          </div>
        )}

        {savedScansStatus === 'loading' && (
          <div className="flex items-center gap-2 rounded-2xl border border-orange-200 bg-orange-50/70 px-4 py-3 dark:border-orange-900/40 dark:bg-orange-950/20">
            <Loader2 className="h-4 w-4 shrink-0 animate-spin text-orange-600 dark:text-orange-300" />
            <p className="text-xs font-bold text-orange-800 dark:text-orange-200">Loading saved scans...</p>
          </div>
        )}

        {savedScansStatus === 'error' && (
          <div className="mt-4 flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={loadSavedScans}
              className="inline-flex min-h-[44px] items-center gap-2 rounded-xl bg-orange-600 px-4 py-2 text-xs font-black text-white transition-colors hover:bg-orange-700"
            >
              <RefreshCw className="h-4 w-4" />
              Try again
            </button>
          </div>
        )}

        {savedScansStatus === 'ready' && savedScans.length === 0 && (
          <div className="rounded-2xl border border-dashed border-gray-200 px-4 py-8 text-center dark:border-gray-700">
            <p className="text-sm font-black text-gray-900 dark:text-white">No saved scans yet</p>
            <p className="mt-1 text-xs font-medium text-gray-500 dark:text-gray-400">
              Finish an extraction, review it, then choose Save scan here — the scan reopens without charging another Gemini request.
            </p>
          </div>
        )}

        {savedScansStatus === 'ready' && savedScans.length > 0 && (
          <ul className="space-y-3">
            {savedScans.map((scan) => {
              const sheetCount = Array.isArray(scan.sheet_images) ? scan.sheet_images.length : 0
              const tokens = scan.usage_metadata?._total
              const tokenCount = tokens ? (Number(tokens.promptTokenCount) || 0) + (Number(tokens.candidatesTokenCount) || 0) : 0
              const isRenaming = renamingScanId === scan.id
              const isConfirming = confirmDeleteId === scan.id
              const thumb = scanThumbnails[scan.id]
              const updatedLabel = scan.updated_at
                ? new Date(scan.updated_at).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })
                : ''
              return (
                <li key={scan.id} className="flex flex-wrap items-center gap-3 rounded-2xl border border-gray-200 bg-white p-3 dark:border-gray-700 dark:bg-gray-800">
                  <div className="grid h-16 w-16 shrink-0 place-items-center overflow-hidden rounded-xl border border-gray-200 bg-gray-50 dark:border-gray-700 dark:bg-gray-900/40">
                    {thumb ? (
                      <img src={thumb} alt={`${scan.name} thumbnail`} className="h-full w-full object-cover" />
                    ) : (
                      <ScanLine className="h-6 w-6 text-gray-400 dark:text-gray-500" />
                    )}
                  </div>
                  <div className="min-w-0 flex-1">
                    {isRenaming ? (
                      <div className="flex items-center gap-2">
                        <input
                          type="text"
                          value={renameDraft}
                          onChange={(event) => setRenameDraft(event.target.value)}
                          onKeyDown={(event) => {
                            if (event.key === 'Enter') commitRename(scan)
                            if (event.key === 'Escape') cancelRename()
                          }}
                          autoFocus
                          aria-label={`Rename ${scan.name}`}
                          className="min-w-0 flex-1 rounded-lg border border-gray-200 bg-white px-2.5 py-1.5 text-sm font-medium text-gray-900 outline-none focus:border-orange-400 dark:border-gray-700 dark:bg-gray-900 dark:text-white"
                        />
                        <button
                          type="button"
                          onClick={() => commitRename(scan)}
                          aria-label={`Confirm rename of ${scan.name}`}
                          className="grid h-10 w-10 shrink-0 place-items-center rounded-lg bg-orange-600 text-white transition-colors hover:bg-orange-700"
                        >
                          <Check className="h-4 w-4" />
                        </button>
                        <button
                          type="button"
                          onClick={cancelRename}
                          aria-label="Cancel rename"
                          className="grid h-10 w-10 shrink-0 place-items-center rounded-lg border border-gray-200 bg-white text-gray-600 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-300"
                        >
                          <X className="h-4 w-4" />
                        </button>
                      </div>
                    ) : (
                      <p className="truncate text-sm font-black text-gray-900 dark:text-white">{scan.name}</p>
                    )}
                    <p className="mt-0.5 text-xs font-medium text-gray-500 dark:text-gray-400">
                      {sheetCount} sheet{sheetCount === 1 ? '' : 's'}
                      {updatedLabel ? ` · saved ${updatedLabel}` : ''}
                      {tokenCount > 0 ? ` · ${tokenCount} tokens` : ''}
                    </p>
                  </div>
                  <div className="flex shrink-0 flex-wrap items-center gap-2">
                    <button
                      type="button"
                      onClick={() => handleOpenScan(scan)}
                      aria-label={`Open ${scan.name}`}
                      className="inline-flex min-h-[44px] items-center gap-1.5 rounded-xl bg-orange-600 px-3 py-2 text-xs font-black text-white transition-colors hover:bg-orange-700"
                    >
                      <ScanLine className="h-3.5 w-3.5" />
                      Open
                    </button>
                    <button
                      type="button"
                      onClick={() => startRename(scan)}
                      aria-label={`Rename ${scan.name}`}
                      className="inline-flex min-h-[44px] items-center gap-1.5 rounded-xl border border-gray-200 bg-white px-3 py-2 text-xs font-black text-gray-700 transition-colors hover:border-orange-300 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-200"
                    >
                      <Pencil className="h-3.5 w-3.5" />
                      Rename
                    </button>
                    {isConfirming ? (
                      <button
                        type="button"
                        onClick={() => handleDeleteScan(scan)}
                        aria-label={`Confirm delete ${scan.name}`}
                        className="inline-flex min-h-[44px] items-center gap-1.5 rounded-xl bg-red-600 px-3 py-2 text-xs font-black text-white transition-colors hover:bg-red-700"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                        Confirm
                      </button>
                    ) : (
                      <button
                        type="button"
                        onClick={() => {
                          if (confirmDeleteId && confirmDeleteId !== scan.id) setConfirmDeleteId(null)
                          setConfirmDeleteId(scan.id)
                        }}
                        aria-label={`Delete ${scan.name}`}
                        className="inline-flex min-h-[44px] items-center gap-1.5 rounded-xl border border-red-200 bg-white px-3 py-2 text-xs font-black text-red-600 transition-colors hover:border-red-400 hover:bg-red-50 dark:border-red-900/40 dark:bg-gray-800 dark:text-red-300"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                        Delete
                      </button>
                    )}
                  </div>
                </li>
              )
            })}
          </ul>
        )}

        <p className="mt-4 rounded-xl border border-gray-100 bg-gray-50 px-3 py-2 text-[11px] font-medium text-gray-500 dark:border-gray-800 dark:bg-gray-900/40 dark:text-gray-400">
          Saved scans stay private to your account and workspace. Sheet images are stored in a private bucket and only ever opened with signed links. Deleting a scan removes its sheet images and this record — never member or attendance data.
        </p>
      </div>
    )
  }

  return (
    <div className="mx-auto w-full max-w-7xl px-3 py-4 sm:px-4 sm:py-6">
      <DocumentCameraModal
        isOpen={showCamera}
        onClose={() => setShowCamera(false)}
        onCaptured={handleCaptured}
      />

      {viewer && (() => {
        const sheet = sheets.find((entry) => entry.id === viewer.sheetId)
        if (!sheet) return null
        return (
          <ImageViewerModal
            isOpen
            onClose={() => setViewer(null)}
            originalSrc={sheet.dataUrl}
            enhancedSrc={sheet.preview || sheet.dataUrl}
            initialMode={viewer.mode}
          />
        )
      })()}

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
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={toggleSavedScans}
            aria-pressed={showSavedScans}
            className="inline-flex items-center gap-1.5 rounded-xl border border-gray-200 bg-white px-3 py-2 text-xs font-bold text-gray-700 transition-colors hover:border-orange-300 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-200"
          >
            <Save className="h-3.5 w-3.5" />
            Saved scans
          </button>
          <button
            type="button"
            onClick={onBack}
            className="inline-flex items-center gap-1.5 rounded-xl border border-gray-200 bg-white px-3 py-2 text-xs font-bold text-gray-700 transition-colors hover:border-orange-300 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-200"
          >
            <ArrowLeft className="h-3.5 w-3.5" />
            Back to Admin
          </button>
        </div>
      </div>

      {savedScanRecord && (
        <div className="mb-4 flex items-center gap-2 rounded-2xl border border-green-200 bg-green-50/70 px-4 py-3 dark:border-green-900/40 dark:bg-green-950/20">
          <ShieldCheck className="h-4 w-4 shrink-0 text-green-700 dark:text-green-300" />
          <p className="text-xs font-bold text-green-800 dark:text-green-200">
            This scan is saved — reopening it will not charge Gemini again. Re-save to keep newer corrections.
          </p>
        </div>
      )}

      {/* Phase notice */}
      <div className="mb-4 flex items-center gap-2 rounded-2xl border border-orange-200 bg-orange-50/70 px-4 py-3 dark:border-orange-900/40 dark:bg-orange-950/20">
        <ShieldCheck className="h-4 w-4 shrink-0 text-orange-600 dark:text-orange-300" />
        <p className="text-xs font-bold text-orange-800 dark:text-orange-200">
          Capture and enhancement stay on this device. Your images are only sent anywhere when you run extraction.
        </p>
      </div>

      {showSavedScans ? (
        renderSavedScansPanel()
      ) : stage === 'review' ? (
        renderReviewPanel()
      ) : stage !== 'idle' ? (
        /* Processing / ready / extracting view */
        <div className="rounded-2xl border border-gray-200 bg-white p-6 shadow-sm dark:border-gray-700 dark:bg-gray-800">
          <div className="mb-5 flex items-center gap-3">
            <span className="grid h-12 w-12 place-items-center rounded-2xl bg-orange-100 text-orange-600 dark:bg-orange-950/60 dark:text-orange-400">
              <Layers className="h-6 w-6" />
            </span>
            <div>
              <p className="text-sm font-black text-gray-900 dark:text-white">
                {stage === 'ready' ? 'Processing complete' : stage === 'extracting' ? 'Extracting attendance data...' : 'Processing sheets...'}
              </p>
              <p className="text-xs font-medium text-gray-500 dark:text-gray-400">
                {stage === 'extracting'
                  ? `${extractStatus.index} of ${extractStatus.total} sheets read so far`
                  : `${sheets.length} ${sheets.length === 1 ? 'sheet' : 'sheets'} in this batch`}
              </p>
            </div>
          </div>

          <div className="mb-2 flex items-center justify-between gap-3">
            <p className="text-sm font-bold text-orange-700 dark:text-orange-300" aria-live="polite">
              {stage === 'ready'
                ? 'Ready for AI extraction'
                : stage === 'extracting'
                  ? extractStatus.message
                  : phase.label}
            </p>
            <p className="text-xs font-black tabular-nums text-gray-500 dark:text-gray-400">
              {stage === 'extracting'
                ? `${Math.round((extractStatus.index / Math.max(extractStatus.total, 1)) * 100)}%`
                : `${phase.progress}%`}
            </p>
          </div>
          <div className="h-2.5 w-full overflow-hidden rounded-full bg-gray-100 dark:bg-gray-700">
            <div
              className="h-full rounded-full bg-orange-500 transition-all duration-500 ease-out"
              style={{ width: `${stage === 'extracting' ? Math.round((extractStatus.index / Math.max(extractStatus.total, 1)) * 100) : phase.progress}%` }}
            />
          </div>

          {stage === 'extracting' && (
            <div className="mt-5 flex items-center gap-2 rounded-2xl border border-orange-200 bg-orange-50/70 px-4 py-3 dark:border-orange-900/40 dark:bg-orange-950/20">
              <Loader2 className="h-4 w-4 shrink-0 animate-spin text-orange-600 dark:text-orange-300" />
              <p className="text-xs font-bold text-orange-800 dark:text-orange-200">
                Sending enhanced sheets to the DatSer server, which forwards them to Google&apos;s Gemini API for AI reading. No other party sees your images.
              </p>
            </div>
          )}

          {globalExtractionError && (
            <div role="alert" className="mt-5 rounded-2xl border border-red-200 bg-red-50/70 px-4 py-3 dark:border-red-900/40 dark:bg-red-950/20">
              <p className="text-xs font-bold leading-relaxed text-red-700 dark:text-red-300">{globalExtractionError}</p>
            </div>
          )}

          {stage === 'ready' && (
            <div className="mt-5 rounded-2xl border border-orange-200 bg-orange-50/70 p-4 dark:border-orange-900/40 dark:bg-orange-950/20">
              <p className="text-xs font-bold leading-relaxed text-orange-800 dark:text-orange-200">
                All {sheets.length} enhanced sheet{sheets.length === 1 ? '' : 's'} are ready. Extract will send these to the DatSer server, which forwards them to Google&apos;s Gemini API. The Gemini API key lives server-side — never in your browser.
              </p>
              <button
                type="button"
                onClick={runExtraction}
                className="mt-3 inline-flex min-h-[44px] items-center gap-2 rounded-2xl bg-orange-600 px-5 py-2.5 text-sm font-black text-white transition-colors hover:bg-orange-700"
              >
                <Bot className="h-4 w-4" />
                Extract with Gemini
              </button>
            </div>
          )}

          <div className="mt-6 flex flex-wrap items-center justify-between gap-3">
            {stage !== 'ready' && (
              <p className="text-xs font-medium text-gray-500 dark:text-gray-400">
                {stage === 'extracting'
                  ? 'Extraction runs through the DatSer server. You can cancel and review results so far.'
                  : 'Preparing local previews only — no network calls.'}
              </p>
            )}
            <button
              type="button"
              onClick={() => {
                if (stage === 'extracting') {
                  extractionCancelledRef.current = true
                  activeAbortRef.current?.abort()
                  handleBackToEditing()
                } else {
                  handleBackToEditing()
                }
              }}
              className="inline-flex min-h-[44px] items-center gap-2 rounded-2xl border border-gray-200 bg-white px-5 py-2.5 text-sm font-black text-gray-700 transition-colors hover:border-orange-300 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-200"
            >
              <ArrowLeft className="h-4 w-4" />
              {stage === 'ready' ? 'Back to editing' : stage === 'extracting' ? 'Cancel extraction' : 'Cancel processing'}
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
                      src={showOriginalPreview ? activeSheet.dataUrl : (activeSheet.preview || activeSheet.dataUrl)}
                      alt={showOriginalPreview ? 'Original captured photo' : 'Enhanced sheet preview'}
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
                    onClick={() => setShowOriginalPreview((value) => !value)}
                    aria-pressed={showOriginalPreview}
                    className="inline-flex items-center gap-1.5 rounded-full border border-gray-200 bg-white px-3 py-1 text-xs font-bold text-gray-700 transition-colors hover:border-orange-300 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-200"
                    title="Compare the enhanced preview against the original capture"
                  >
                    <Eye className="h-3.5 w-3.5" />
                    {showOriginalPreview ? 'Enhanced' : 'Before / After'}
                  </button>
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

                  {activeSheet.preset !== 'original' && activeSheet.preset !== 'auto' && (
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
                    ? `${sheets.length} ${sheets.length === 1 ? 'sheet' : 'sheets'} ready. Continue to prepare, then extract attendance data with AI.`
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
