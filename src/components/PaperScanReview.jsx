import React, { useEffect, useMemo, useRef, useState } from 'react'
import {
  AlertTriangle,
  ArrowLeft,
  Bot,
  Camera,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  Eye,
  ImageIcon,
  ImagePlus,
  Layers,
  Loader2,
  Maximize2,
  Menu,
  Pencil,
  RefreshCw,
  RefreshCcw,
  Save,
  ScanLine,
  Search,
  ShieldCheck,
  Sparkles,
  Table2,
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
  durableSheetIdsFromScan,
  excludedIndicesFromSavedScan,
  getSavedScan,
  isStagingRecord,
  listSavedScans,
  mergeStagedSheet,
  removeStagedSheet,
  renameSavedScan,
  savePaperScan,
  uploadSheetImage,
  usageMetadataFromSavedScan,
  deriveBatchTitle
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
  getCrossMonthMatchCandidates,
  getEffectiveValue,
  getExistingValue,
  getMatchCandidates,
  matchGeminiRowToMember,
  summarizeRowCompare
} from '../utils/paperScanCompare'
import {
  ATTENDANCE_CONVENTIONS,
  ATTENDANCE_STATUS,
  attendanceColumnNameForDate,
  formatDateKey,
  getSundaysForMonth,
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
  decodeOrientedImage,
  loadImageElement,
  prepareSheetForUpload,
  readFileAsDataUrl,
  validateImageDimensions,
  validateImageFile
} from '../utils/paperScanImage'
import { useApp } from '../context/AppContext'
import { useAuth } from '../context/AuthContext'
import { supabase } from '../lib/supabase'
import DocumentCameraModal from './DocumentCameraModal'
import AttendanceChoice from './AttendanceChoice'

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

const STAGED_SAVE_CONCURRENCY = 3

const createLimitedTaskQueue = (limit) => {
  let active = 0
  const pending = []
  const runNext = () => {
    if (active >= limit || pending.length === 0) return
    const next = pending.shift()
    active += 1
    Promise.resolve()
      .then(next.task)
      .then(next.resolve, next.reject)
      .finally(() => {
        active -= 1
        runNext()
      })
  }
  return (task) => new Promise((resolve, reject) => {
    pending.push({ task, resolve, reject })
    runNext()
  })
}

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
  const { dataOwnerId, currentTable, monthlyTables = [], updateMember, refreshSyncedDataInBackground, loadAllAttendanceData, fetchMembers, searchMemberAcrossAllTables, isOnline, offlineMode, memberCodeMap = {} } = useApp() || {}
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
  const [attendanceMonths, setAttendanceMonths] = useState({}) // sheetId -> ['YYYY-MM', ...] selected months
  const [attendanceSundays, setAttendanceSundays] = useState({}) // sheetId -> { monthKey: ['YYYY-MM-DD', ...] } chosen Sundays
  const [attendanceConventions] = useState({}) // sheetId -> convention id (read for saved-scan meta; no selector surfaces it anymore)
  const [memberSearchQuery, setMemberSearchQuery] = useState('') // filters the database search bar
  const [possibleMatchesOpen, setPossibleMatchesOpen] = useState(false) // accordion for possible matches
  const [crossMonthCandidates, setCrossMonthCandidates] = useState([]) // { sheetId, rowIndex, candidates } from other months
  const [finalViewMode, setFinalViewMode] = useState('table') // table | attention | cards on the final review step
  const [expandedFinalRows, setExpandedFinalRows] = useState(() => new Set()) // expanded keys on the final card view
  const [viewer, setViewer] = useState(null) // { sheetId, mode: 'original' | 'enhanced' }
  const [showChanges, setShowChanges] = useState(false)
  const [showOriginalPreview, setShowOriginalPreview] = useState(false)
  const [editDraft, setEditDraft] = useState('')
  const [showSavedScans, setShowSavedScans] = useState(false)
  const [savedScans, setSavedScans] = useState([])
  const [savedScansStatus, setSavedScansStatus] = useState('idle') // idle | loading | ready | error
  const [savedScansError, setSavedScansError] = useState('')
  const [scanThumbnails, setScanThumbnails] = useState({}) // scanId -> signed thumbnail url
  const [expandedScanIds, setExpandedScanIds] = useState(() => new Set()) // scanId -> batch expanded
  const [sheetThumbnails, setSheetThumbnails] = useState({}) // `${scanId}:${sheetId}` -> signed url
  const [renamingScanId, setRenamingScanId] = useState(null)
  const [renameDraft, setRenameDraft] = useState('')
  const [confirmDeleteId, setConfirmDeleteId] = useState(null)
  const [saving, setSaving] = useState(false)
  const [saveMessage, setSaveMessage] = useState('')
  const [reviewStep, setReviewStep] = useState('members') // members | attendance | final
  const [monthAddDraft, setMonthAddDraft] = useState('')
  const [savedScanRecord, setSavedScanRecord] = useState(null) // { id, name, savedAt } for the active session
  const [finalSaving, setFinalSaving] = useState(false)
  const [finalSaveResult, setFinalSaveResult] = useState(null) // { summary, members, savedAt } or the restored metadata
  const [finalSaveProgress, setFinalSaveProgress] = useState(0)
  const [pendingDuplicates, setPendingDuplicates] = useState(null) // { entries } awaiting explicit confirmation
  const [confirmedDuplicateKeys, setConfirmedDuplicateKeys] = useState([])
  const [rightPanelView, setRightPanelView] = useState('details') // 'details' | 'names'
  const [sheetRailExpanded, setSheetRailExpanded] = useState(false)
  const [sheetSelectorDropdownOpen, setSheetSelectorDropdownOpen] = useState(false)
  const [groupedNotificationExpanded, setGroupedNotificationExpanded] = useState(false)
  const [selectedBatchSheetIds, setSelectedBatchSheetIds] = useState(() => new Set())
  const [memberListSearch, setMemberListSearch] = useState('')
  const [completedSheets, setCompletedSheets] = useState(() => new Set())
  const [finalEditingRowKey, setFinalEditingRowKey] = useState(null)
  // Only rows changed inside the Final Review spreadsheet belong to this
  // correction pass. The primary save action uses this to avoid replaying a
  // whole batch when an operator is fixing one person or one Sunday.
  const [finalEditedRowKeys, setFinalEditedRowKeys] = useState(() => new Set())
  const [finalEditedChanges, setFinalEditedChanges] = useState({})
  const [applySundaysToast, setApplySundaysToast] = useState('')
  const finalSaveInFlightRef = useRef(false)
  // Process-one must carry its target synchronously through the local
  // preparation timer. React state alone would not be available to the
  // immediately-following handleContinue call.
  const extractionTargetSheetIdsRef = useRef(null)
  const savedScanIdRef = useRef(null)
  const savedScanNameRef = useRef('')
  const stagedSaveQueueRef = useRef(null)
  const stagedSaveTasksRef = useRef(new Map())
  const stagedSheetImagesRef = useRef(new Map())
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
  const pendingReviewIndexRef = useRef(null)

  if (!stagedSaveQueueRef.current) {
    stagedSaveQueueRef.current = createLimitedTaskQueue(STAGED_SAVE_CONCURRENCY)
  }

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
    setReviewIndex(pendingReviewIndexRef.current ?? 0)
    pendingReviewIndexRef.current = null
    setEditingField(null)
    setMemberSearchQuery('')
    setPossibleMatchesOpen(false)
    setRightPanelView('details')
    setMemberListSearch('')
    setFinalEditingRowKey(null)
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

  const persistStagedSheet = async (sheet) => {
    if (!user?.id) {
      setSheets((prev) => prev.map((s) => (s.id === sheet.id ? { ...s, saveState: 'local' } : s)))
      return
    }
    const scanId = savedScanIdRef.current || createSavedScanId()
    savedScanIdRef.current = scanId
    try {
      const prior = stagedSheetImagesRef.current.get(sheet.id)
      let path = prior?.path || ''
      if (!prior?.path) {
        const prepared = await prepareSheetForUpload({
          image: sheet.image,
          presetId: 'original',
          intensity: PRESET_DEFAULT_INTENSITY.original
        })
        if (!prepared || prepared.error) {
          throw new Error(prepared?.error || 'That image is too large to save. Try a smaller or clearer photo.')
        }
        path = await uploadSheetImage({
          supabase,
          userId: user.id,
          scanId,
          sheetId: sheet.id,
          dataUrl: prepared.dataUrl,
          blob: prepared.blob
        })
        // Record the stable path immediately: if the metadata merge below
        // fails, a Retry reuses this exact object path and re-merges only —
        // never duplicating the object or uploading twice.
        stagedSheetImagesRef.current.set(sheet.id, { sheetId: sheet.id, source: sheet.source || '', path })
      }
      const name = savedScanNameRef.current || createScanName(stagedSheetImagesRef.current.size + 1)
      savedScanNameRef.current = name
      // Atomic server-side merge: the RPC locks the Saved Scan row, reads the
      // LATEST sheet_images, merges exactly this sheet, and returns the durable
      // row. Concurrent staging saves serialize on the database, never on stale
      // client state, so a successful sheet can never be dropped by another
      // task finishing later.
      const durable = await mergeStagedSheet({
        supabase,
        scanId,
        ownerId: workspaceId,
        name,
        sheet: { sheetId: sheet.id, source: sheet.source || '', path }
      })
      // SAVED is truthful only when BOTH the storage upload succeeded AND the
      // latest durable metadata actually contains this sheet's reference.
      const durableIds = durableSheetIdsFromScan(durable)
      if (!durableIds.has(sheet.id)) {
        throw new Error('The sheet was saved to storage but could not be confirmed in the saved scan metadata.')
      }
      setSavedScanRecord({ id: scanId, name: durable?.name || name, savedAt: new Date().toISOString() })
      setSheets((prev) => prev.map((s) => (s.id === sheet.id ? { ...s, saveState: 'saved', storedPath: path, saveError: '' } : s)))
    } catch (err) {
      setSheets((prev) => prev.map((s) => (s.id === sheet.id ? { ...s, saveState: 'save_failed', saveError: err?.message || 'Save failed' } : s)))
    }
  }

  const queueStagedSheetSave = (sheet) => {
    const existing = stagedSaveTasksRef.current.get(sheet.id)
    if (existing) return existing
    const task = stagedSaveQueueRef.current(() => persistStagedSheet(sheet))
    stagedSaveTasksRef.current.set(sheet.id, task)
    task.finally(() => {
      if (stagedSaveTasksRef.current.get(sheet.id) === task) {
        stagedSaveTasksRef.current.delete(sheet.id)
      }
    })
    return task
  }

  const handleRetrySaveSheet = async (sheetId) => {
    const sheet = sheets.find((s) => s.id === sheetId)
    if (!sheet) return
    setSheets((prev) => prev.map((s) => (s.id === sheetId ? { ...s, saveState: 'saving', saveError: '' } : s)))
    await queueStagedSheetSave(sheet)
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
      // Apply EXIF orientation once at capture time so both the local preview
      // and the later JPEG upload render phone captures upright.
      const oriented = await decodeOrientedImage(image)
      const sheetImage = oriented || image
      const sheet = {
        id: createSheetId(),
        dataUrl,
        source: sourceLabel,
        image: sheetImage,
        preset: 'original',
        intensity: PRESET_DEFAULT_INTENSITY.original,
        preview: dataUrl,
        saveState: user?.id ? 'saving' : 'local',
        saveError: '',
        storedPath: null
      }
      setSheets((prev) => [...prev, sheet])
      setActiveSheetId(sheet.id)
      setIsScanning(true)
      cancelScanTimer()
      scanTimerRef.current = window.setTimeout(() => setIsScanning(false), 2400)
      if (user?.id) {
        queueStagedSheetSave(sheet)
      }
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

  const handleRemoveSheet = async (id) => {
    cancelPendingPreview()
    cancelScanTimer()
    const sheet = sheets.find((s) => s.id === id)
    const task = stagedSaveTasksRef.current.get(id)
    const mayBeDurable = Boolean(sheet?.storedPath) || stagedSheetImagesRef.current.has(id) || Boolean(task)
    stagedSheetImagesRef.current.delete(id)
    stagedSaveTasksRef.current.delete(id)
    const next = sheets.filter((entry) => entry.id !== id)
    setSheets(next)
    if (activeSheetId === id) {
      const fallback = next[next.length - 1]
      setActiveSheetId(fallback ? fallback.id : null)
      setIsScanning(false)
    }
    // Wait for any in-flight save of this sheet so its merge cannot re-add the
    // reference after the durable removal below.
    if (task) {
      try {
        await task
      } catch {
        // The upload itself failed; nothing was durably added.
      }
      stagedSheetImagesRef.current.delete(id)
    }
    // Removing from the current batch updates durable staging metadata ONLY —
    // the remote storage object is never deleted here. Destructive deletion
    // stays the separate, confirmed "Delete Saved Scan" action.
    const scanId = savedScanIdRef.current
    if (scanId && mayBeDurable) {
      try {
        await removeStagedSheet({ supabase, scanId, ownerId: workspaceId, sheetId: id })
      } catch (err) {
        setError(err?.message || 'The sheet was removed from this batch, but its saved-scan reference could not be updated.')
      }
    }
  }

  const handleMoveSheetUp = (index) => {
    if (index <= 0) return
    setSheets((prev) => {
      const next = [...prev]
      const temp = next[index - 1]
      next[index - 1] = next[index]
      next[index - 1] = temp
      return next
    })
  }

  const handleMoveSheetDown = (index) => {
    if (index >= sheets.length - 1) return
    setSheets((prev) => {
      const next = [...prev]
      const temp = next[index + 1]
      next[index + 1] = next[index]
      next[index] = temp
      return next
    })
  }

  const handleApplyEnhancementToAll = () => {
    if (!activeSheet) return
    cancelPendingPreview()
    const { preset, intensity } = activeSheet
    setSheets((prev) =>
      prev.map((sheet) => {
        const preview = renderEnhanced(sheet, preset, intensity)
        return { ...sheet, preset, intensity, preview }
      })
    )
  }

  const handleApplyEnhancementToSelected = () => {
    if (!activeSheet || selectedBatchSheetIds.size === 0) return
    cancelPendingPreview()
    const { preset, intensity } = activeSheet
    setSheets((prev) =>
      prev.map((sheet) => {
        if (!selectedBatchSheetIds.has(sheet.id)) return sheet
        const preview = renderEnhanced(sheet, preset, intensity)
        return { ...sheet, preset, intensity, preview }
      })
    )
  }

  const handleToggleSelectBatchSheet = (sheetId) => {
    setSelectedBatchSheetIds((prev) => {
      const next = new Set(prev)
      if (next.has(sheetId)) next.delete(sheetId)
      else next.add(sheetId)
      return next
    })
  }

  const handleProcessSingleSheet = (sheetId) => {
    if (!sheetId) return
    selectSheet(sheetId)
    handleContinue(new Set([sheetId]))
  }

  const handleToggleSheetCompleted = (sheetId) => {
    setCompletedSheets((prev) => {
      const next = new Set(prev)
      if (next.has(sheetId)) next.delete(sheetId)
      else next.add(sheetId)
      return next
    })
  }

  const handleReviewNextSheet = () => {
    const nextUnfinished = sheets.find(
      (s) => s.id !== reviewActiveId && !completedSheets.has(s.id) && resultsBySheet[s.id]?.status === 'ok'
    )
    if (nextUnfinished) {
      setReviewActiveId(nextUnfinished.id)
      setReviewIndex(0)
    } else {
      const anyOtherOk = sheets.find((s) => s.id !== reviewActiveId && resultsBySheet[s.id]?.status === 'ok')
      if (anyOtherOk) {
        setReviewActiveId(anyOtherOk.id)
        setReviewIndex(0)
      }
    }
  }

  const handleContinue = async (requestedTargetIds = null) => {
    if (!sheets.length || stage !== 'idle') return
    const targetIds = requestedTargetIds instanceof Set ? requestedTargetIds : null
    extractionTargetSheetIdsRef.current = targetIds
    const extractionTargets = targetIds
      ? sheets.filter((sheet) => targetIds.has(sheet.id))
      : sheets
    if (!extractionTargets.length) return
    if (user?.id) {
      await Promise.allSettled(Array.from(stagedSaveTasksRef.current.values()))
      // Process One / Process All must PROVE durability: a sheet only counts
      // as Saved when the latest durable Saved Scan metadata actually contains
      // its reference. Local state alone is never trusted here.
      let durable = null
      const scanId = savedScanIdRef.current
      if (scanId) {
        try {
          durable = await getSavedScan({ supabase, id: scanId })
        } catch {
          durable = null
        }
      }
      const durableIds = durableSheetIdsFromScan(durable)
      const missing = extractionTargets.filter((sheet) => !durableIds.has(sheet.id))
      if (missing.length) {
        setSheets((prev) => prev.map((s) => (
          !durableIds.has(s.id) && s.saveState !== 'local'
            ? { ...s, saveState: 'save_failed', saveError: 'The sheet was not confirmed in the saved scan metadata. Retry to save it again.' }
            : s
        )))
        setError(`${missing.length} sheet${missing.length === 1 ? ' needs' : 's need'} to finish saving before processing. Use Retry for the failed upload${missing.length === 1 ? '' : 's'}.`)
        return
      }
    }
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
      // This sequence only reports local preparation that is already complete.
      // Keep the feedback, but never make the reviewer wait on decorative timers.
      phaseTimerRef.current = window.setTimeout(advance, 90)
    }
    phaseTimerRef.current = window.setTimeout(advance, 40)
  }

  const handleBackToEditing = () => {
    if (phaseTimerRef.current) window.clearTimeout(phaseTimerRef.current)
    extractionTargetSheetIdsRef.current = null
    setStage('idle')
    setPhaseIndex(0)
  }

  // Fits the sheet to the Vercel-safe upload budget locally (downscale +
  // re-compress to image/jpeg) before anything is sent. Throws a friendly
  // error when even the smallest acceptable encoding cannot fit, so the
  // browser never hands Vercel a payload it will reject before our handler
  // runs.
  const prepareSheetUpload = async (sheet) => {
    const prepared = await prepareSheetForUpload({
      image: sheet.image,
      presetId: sheet.preset,
      intensity: sheet.intensity
    })
    if (!prepared || prepared.error) {
      throw new Error(prepared?.error || 'That image is too large to upload. Try a smaller or clearer photo.')
    }
    return prepared.dataUrl
  }

  // Keeps the untouched Gemini read alongside any later review choices, so a
  // decision never destroys evidence of what the sheet actually said.
  const snapshotOriginalValues = (rows) => rows.map((row) => ({
    ...row,
    originalGeminiValue: {
      full_name: row.full_name,
      phone_number: row.phone_number,
      gender: row.gender,
      age: row.age,
      current_level: row.current_level
    }
  }))

  const runExtraction = async () => {
    if (extractionActiveRef.current) return
    extractionActiveRef.current = true
    extractionCancelledRef.current = false
    const controller = new AbortController()
    activeAbortRef.current = controller
    const targetIds = extractionTargetSheetIdsRef.current
    const target = targetIds ? sheets.filter((sheet) => targetIds.has(sheet.id)) : sheets.slice()
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
          const dataUrl = await prepareSheetUpload(sheet)
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
      setAttendanceMonths({})
      setAttendanceSundays({})
      setFinalEditedRowKeys(new Set())
      setFinalEditedChanges({})
      setFinalViewMode('table')
      setReviewStep('members')
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
const payload = await extractSheetWithGemini({ dataUrl: await prepareSheetUpload(sheet), workspaceId, bearerToken, signal: controller.signal, requestId: createRequestId() })
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

  // Sheet-scoped multi-month selection. Every decision stays keyed by Sunday
  // date, so months never share decisions; removing a month also drops every
  // pending attendance write whose date belongs to that month.
  const defaultSundaysForMonth = (monthKey) => getSundaysForMonth(monthKey).map(formatDateKey)

  const addAttendanceMonth = (sheetId, monthKey) => {
    if (!monthKey) return
    const currentMonths = Array.isArray(attendanceMonths[sheetId]) ? attendanceMonths[sheetId] : getAttendanceSettings(sheetId).months
    const nextMonths = [...new Set([...currentMonths, monthKey])]
    setAttendanceMonths((prev) => ({ ...prev, [sheetId]: nextMonths }))
    setAttendanceSundays((prev) => {
      const byMonth = prev[sheetId] && typeof prev[sheetId] === 'object' ? prev[sheetId] : {}
      if (byMonth[monthKey]) return prev
      return { ...prev, [sheetId]: { ...byMonth, [monthKey]: defaultSundaysForMonth(monthKey) } }
    })
    updateSheetMeta(sheetId, { attendance_month: monthKey, attendance_months: nextMonths })
    setEditingField(null)
  }

  const removeAttendanceMonth = (sheetId, monthKey) => {
    const currentMonths = Array.isArray(attendanceMonths[sheetId]) ? attendanceMonths[sheetId] : getAttendanceSettings(sheetId).months
    const nextMonths = currentMonths.filter((month) => month !== monthKey)
    setAttendanceMonths((prev) => ({ ...prev, [sheetId]: nextMonths }))
    setAttendanceSundays((prev) => {
      const byMonth = prev[sheetId] && typeof prev[sheetId] === 'object' ? prev[sheetId] : {}
      if (!byMonth[monthKey]) return prev
      const next = { ...byMonth }
      delete next[monthKey]
      return { ...prev, [sheetId]: next }
    })
    // Removing a month must remove all pending attendance writes for that month.
    setResultsBySheet((prev) => {
      const result = prev[sheetId]
      if (!result || result.status !== 'ok') return prev
      const rows = result.payload.rows.map((row) => {
        const reviewedAttendance = row.reviewedAttendance && typeof row.reviewedAttendance === 'object' ? row.reviewedAttendance : {}
        const next = Object.fromEntries(Object.entries(reviewedAttendance).filter(([dateKey]) => !dateKey.startsWith(monthKey)))
        return { ...row, reviewedAttendance: next }
      })
      return { ...prev, [sheetId]: { ...result, payload: { ...result.payload, rows } } }
    })
    updateSheetMeta(sheetId, { attendance_months: nextMonths })
    setEditingField(null)
  }

  const toggleAttendanceSunday = (sheetId, monthKey, dateKey) => {
    const byMonth = attendanceSundays[sheetId] && typeof attendanceSundays[sheetId] === 'object' ? attendanceSundays[sheetId] : {}
    const current = Array.isArray(byMonth[monthKey]) ? byMonth[monthKey] : defaultSundaysForMonth(monthKey)
    const selected = current.includes(dateKey)
    const nextSundays = selected ? current.filter((date) => date !== dateKey) : [...current, dateKey]
    setAttendanceSundays((prev) => ({
      ...prev,
      [sheetId]: { ...(prev[sheetId] || {}), [monthKey]: nextSundays.sort() }
    }))
    updateSheetMeta(sheetId, { attendance_sundays: { ...(byMonth || {}), [monthKey]: nextSundays.sort() } })
    // Deselecting a Sunday drops its pending attendance decisions.
    if (selected) {
      setResultsBySheet((prev) => {
        const result = prev[sheetId]
        if (!result || result.status !== 'ok') return prev
        const rows = result.payload.rows.map((row) => {
          const reviewedAttendance = row.reviewedAttendance && typeof row.reviewedAttendance === 'object' ? row.reviewedAttendance : {}
          if (!reviewedAttendance[dateKey]) return row
          const next = { ...reviewedAttendance }
          delete next[dateKey]
          return { ...row, reviewedAttendance: next }
        })
        return { ...prev, [sheetId]: { ...result, payload: { ...result.payload, rows } } }
      })
    }
    setEditingField(null)
  }

  // The convention is no longer surfaced as a review-step selector; it still
  // feeds the mark interpreter via getAttendanceSettings (defaults to tick_x).

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

  const markFinalRowEdited = (sheetId, rowIndex, kind, value) => {
    const rowKey = `${sheetId}:${rowIndex}`
    setFinalEditedRowKeys((previous) => {
      const next = new Set(previous)
      next.add(rowKey)
      return next
    })
    setFinalEditedChanges((previous) => {
      const current = previous[rowKey] || { fields: [], attendanceDates: [] }
      const fields = new Set(current.fields)
      const attendanceDates = new Set(current.attendanceDates)
      if (kind === 'field') fields.add(value)
      if (kind === 'attendance') attendanceDates.add(value)
      return { ...previous, [rowKey]: { fields: [...fields], attendanceDates: [...attendanceDates] } }
    })
  }

  // Final Review has its own edit scope. These wrappers preserve the same
  // durable review decision while marking the row for an edited-rows-only save.
  const handleFinalRowDecision = (sheetId, rowIndex, field, decision) => {
    markFinalRowEdited(sheetId, rowIndex, 'field', field)
    handleRowDecision(sheetId, rowIndex, field, decision)
  }

  const handleFinalAttendanceDecision = (sheetId, rowIndex, dateKey, decision) => {
    markFinalRowEdited(sheetId, rowIndex, 'attendance', dateKey)
    handleAttendanceDecision(sheetId, rowIndex, dateKey, decision)
  }

  const handleFinalClearAttendanceDecision = (sheetId, rowIndex, dateKey) => {
    markFinalRowEdited(sheetId, rowIndex, 'attendance', dateKey)
    handleClearAttendanceDecision(sheetId, rowIndex, dateKey)
  }

  // One deliberate reviewer action accepts the AI's readable values, maps
  // unambiguous attendance marks, and chooses the best existing current-month
  // match when one is available. It never writes to DatSer or invents a new
  // member; Final Review remains the single confirmation point.
  const handleApplyAiResultsAndOpenFinalReview = () => {
    const settingsBySheet = Object.fromEntries(sheets.map((sheet) => [sheet.id, getAttendanceSettings(sheet.id)]))
    setResultsBySheet((prev) => {
      const next = { ...prev }
      Object.entries(prev).forEach(([sheetId, result]) => {
        if (result?.status !== 'ok') return
        const settings = settingsBySheet[sheetId]
        const selectedDatesByMonth = new Map((settings?.months || []).map((month) => [
          month,
          new Set(Array.isArray(settings?.sundays?.[month]) ? settings.sundays[month] : defaultSundaysForMonth(month))
        ]))
        const rows = result.payload.rows.map((row, rowIndex) => {
          if (result.excludedIndices?.includes(rowIndex)) return row
          const reviewedValues = { ...(row.reviewedValues || {}) }
          COMPARE_FIELDS.forEach(({ key }) => {
            const value = String(row?.[key] ?? '').trim()
            if (value) reviewedValues[key] = { value, source: REVIEW_SOURCES.SCAN }
          })

          const reviewedAttendance = { ...(row.reviewedAttendance || {}) }
          selectedDatesByMonth.forEach((selectedDates, month) => {
            resolveAttendanceEntries({
              attendance: row.attendance,
              month,
              columnCount: settings.columnCount,
              convention: settings.convention
            }).forEach((entry) => {
              if (!entry.dateKey || !selectedDates.has(entry.dateKey) || entry.interpreted.needsReview) return
              if (entry.interpreted.status === ATTENDANCE_STATUS.PRESENT || entry.interpreted.status === ATTENDANCE_STATUS.ABSENT) {
                reviewedAttendance[entry.dateKey] = { value: entry.interpreted.status, source: REVIEW_SOURCES.SCAN }
              }
            })
          })

          const automaticMatch = !row.memberAction && !row.selectedMemberId
            ? computeRowMatch(row, currentMembers).member
            : null
          return {
            ...row,
            reviewedValues,
            reviewedAttendance,
            ...(automaticMatch?.id ? { selectedMemberId: automaticMatch.id } : {})
          }
        })
        next[sheetId] = { ...result, payload: { ...result.payload, rows } }
      })
      return next
    })
    setReviewStep('final')
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

  // Batch title derived from the DURABLE sheet set. A legacy `name` may embed a
  // stale "(N sheets)" count (e.g. created when extraction-ok count differed
  // from the durably staged count). The authoritative count is always
  // sheet_images.length; we never trust the name's embedded count.
  const batchTitleFor = (scan) => deriveBatchTitle(scan)

  // Lazy-loads one signed thumbnail per sheet when a batch is expanded. Uses
  // signed URLs so no full-resolution image is downloaded merely by expanding.
  const loadSheetThumbnails = async (scan) => {
    const images = Array.isArray(scan?.sheet_images) ? scan.sheet_images : []
    const missing = images.filter((image) => image?.path && !sheetThumbnails[`${scan.id}:${image.sheetId}`])
    if (!missing.length) return
    const entries = {}
    await Promise.all(missing.map(async (image) => {
      try {
        const url = await createSheetImageSignedUrl({ supabase, path: image.path })
        if (url) entries[`${scan.id}:${image.sheetId}`] = url
      } catch {
        // thumbnail failure is non-fatal; filename/status still show
      }
    }))
    if (Object.keys(entries).length) {
      setSheetThumbnails((prev) => ({ ...prev, ...entries }))
    }
  }

  const toggleScanExpanded = (scan) => {
    setExpandedScanIds((prev) => {
      const next = new Set(prev)
      if (next.has(scan.id)) next.delete(scan.id)
      else {
        next.add(scan.id)
        void loadSheetThumbnails(scan)
      }
      return next
    })
  }

  // Re-opens a saved scan. A staging batch (review_state._staging) returns to
  // batch preparation with only its genuinely persisted state restored — it is
  // NOT an extracted batch and never fabricates extraction results. A full
  // saved scan opens directly into Compare & Correct. No Gemini request is
  // issued anywhere on this path.
  const handleOpenScan = async (scan) => {
    setSavedScansError('')
    try {
      const record = await getSavedScan({ supabase, id: scan.id })
      if (!record) throw new Error('The saved scan could not be found.')
      const images = Array.isArray(record.sheet_images) ? record.sheet_images : []
      if (!images.length) throw new Error('This scan has no saved sheets.')

      savedScanIdRef.current = record.id
      savedScanNameRef.current = record.name
      stagedSheetImagesRef.current.clear()
      for (const image of images) {
        if (image?.sheetId && image?.path) {
          stagedSheetImagesRef.current.set(image.sheetId, { sheetId: image.sheetId, source: image.source || '', path: image.path })
        }
      }
      setSavedScanRecord({ id: record.id, name: record.name, savedAt: record.updated_at || record.created_at })

      if (isStagingRecord(record)) {
        // Restore only genuine persisted state: saved sheets, filenames,
        // paths, order, and save status. Unprocessed sheets stay ready for
        // processing; no extraction state is invented.
        const sheetList = []
        let firstId = null
        for (const image of images) {
          const sheetId = image.sheetId
          let url = ''
          try {
            url = await createSheetImageSignedUrl({ supabase, path: image.path })
          } catch {
            url = ''
          }
          let img = null
          if (url) {
            try {
              img = await loadImageElement(url)
            } catch {
              img = null
            }
          }
          sheetList.push({
            id: sheetId,
            dataUrl: url,
            source: image.source || record.name,
            preset: 'original',
            intensity: PRESET_DEFAULT_INTENSITY.original,
            preview: url,
            image: img,
            storedPath: image.path,
            saveState: url ? 'saved' : 'save_failed',
            saveError: url ? '' : 'The saved sheet image could not be reopened.'
          })
          if (!firstId) firstId = sheetId
        }
        setSheets(sheetList)
        setResultsBySheet({})
        setActiveSheetId(firstId)
        setReviewActiveId(null)
        setIsScanning(false)
        setShowSavedScans(false)
        setStage('idle')
        return
      }

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
      setReviewStep('members')
      setAttendanceMonths({})
      setAttendanceSundays({})
      setFinalEditedRowKeys(new Set())
      setFinalEditedChanges({})
      setFinalViewMode('table')
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
        // Reuse the already-normalized, byte-bounded durable objects from
        // staging instead of re-uploading raw previews (which could exceed the
        // Storage limit). Every ok sheet was durably staged before review.
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
  const buildFinalSavePlanNow = ({ onlyRowKeys = null, onlyEditedChanges = null } = {}) => {
    const settingsBySheet = {}
    sheets.forEach((sheet) => {
      settingsBySheet[sheet.id] = getAttendanceSettings(sheet.id)
    })
    return buildFinalSavePlan({
      sheets,
      resultsBySheet,
      currentMembers,
      monthlyTables,
      settingsBySheet,
      onlyRowKeys,
      onlyEditedChanges
    })
  }

  // Fresh authoritative active-member snapshot for the final duplicate decision.
  // The review uses the cached currentMembers for speed, but creation authorization
  // must reflect server state as it is at save time — never the review-start snapshot.
  const fetchFreshMembersForFinalSave = async () => {
    try {
      const { data, error } = await supabase.from(currentTable).select('*')
      if (error) throw error
      return Array.isArray(data) ? data : []
    } catch (error) {
      // Fail closed: if we cannot see current server state we must not authorize
      // creation against a stale snapshot. The caller surfaces the message.
      throw new Error(`Unable to refresh the member list before Final Save: ${error?.message || 'unknown error'}`)
    }
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
  const runFinalSave = async ({ confirmedKeys, plan: frozenPlan = null, editedRowKeys = null, editedChanges = null }) => {
    if (finalSaveInFlightRef.current || finalSaving) return null
    finalSaveInFlightRef.current = true
    setFinalSaving(true)
    setFinalSaveProgress(0)
    setPendingDuplicates(null)
    setSavedScansError('')
    try {
      const plan = frozenPlan || buildFinalSavePlanNow({ onlyRowKeys: editedRowKeys, onlyEditedChanges: editedChanges })
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
          savedScanId: saved.id,
          fetchFreshMembers: fetchFreshMembersForFinalSave
        }
      })
      setFinalSaveProgress(1)

      if (result.blockedDuplicates.length > 0) {
        // STOP: a likely duplicate needs explicit confirmation before any write.
        setPendingDuplicates({ entries: result.blockedDuplicates, plan, editedRowKeys, editedChanges })
        return null
      }

      setFinalSaveResult(result)
      if (editedRowKeys) {
        const completedKeys = new Set((result.members || [])
          .filter((member) => member.status === FINAL_SAVE_STATUS.SAVED || member.status === FINAL_SAVE_STATUS.CREATED)
          .map((member) => `${member.sheetId}:${member.rowIndex}`))
        if (completedKeys.size > 0) {
          setFinalEditedRowKeys((previous) => new Set([...previous].filter((key) => !completedKeys.has(key))))
          setFinalEditedChanges((previous) => Object.fromEntries(Object.entries(previous).filter(([key]) => !completedKeys.has(key))))
        }
      }
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

  const handleConfirmFinalSave = ({ editedOnly = false } = {}) => {
    if (finalSaving) return
    // Refresh the member snapshot so the save-time duplicate check runs against
    // the latest data. Likely duplicates STOP the save before any write; the
    // user must explicitly confirm before a new member is created.
    const settingsBySheet = {}
    sheets.forEach((sheet) => {
      settingsBySheet[sheet.id] = getAttendanceSettings(sheet.id)
    })
    const editedRowKeys = editedOnly ? new Set(finalEditedRowKeys) : null
    const editedChanges = editedOnly ? finalEditedChanges : null
    const preview = previewFinalSave({
      sheets,
      resultsBySheet,
      currentMembers,
      monthlyTables,
      settingsBySheet,
      onlyRowKeys: editedRowKeys,
      onlyEditedChanges: editedChanges
    })
    if (preview.plan.rows.length === 0) {
      setSavedScansError(editedOnly
        ? 'None of the edited rows is ready to save yet. Review the highlighted row first.'
        : 'There are no approved rows ready to save yet.')
      return
    }
    if (preview.duplicates.length > 0) {
      setPendingDuplicates({ entries: preview.duplicates, plan: preview.plan, editedRowKeys, editedChanges })
      return
    }
    runFinalSave({ confirmedKeys: [], plan: preview.plan, editedRowKeys, editedChanges })
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
    runFinalSave({ confirmedKeys: [...confirmedDuplicateKeys, ...keys], plan, editedRowKeys: pendingDuplicates.editedRowKeys || null, editedChanges: pendingDuplicates.editedChanges || null })
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

  // Cross-month Possible Matches. The review snapshot is intentionally month-local,
  // so a person already present in another month must still surface here instead
  // of silently becoming a brand-new UUID. Uses DatSer's existing historical search
  // RPC (narrow phone/name lookups; never whole-month downloads). Matches are shown
  // with their source month and can be selected as the existing identity.
  const crossMonthSearchRef = useRef(searchMemberAcrossAllTables)
  useEffect(() => {
    crossMonthSearchRef.current = searchMemberAcrossAllTables
  }, [searchMemberAcrossAllTables])
  useEffect(() => {
    const safeIndex = Math.min(reviewIndex, Math.max(reviewRows.length - 1, 0))
    const activeRow = reviewRows[safeIndex]
    const searchFn = crossMonthSearchRef.current
    if (!activeRow || typeof searchFn !== 'function' || !currentTable) {
      setCrossMonthCandidates([])
      return undefined
    }
    let cancelled = false
    const lookup = async () => {
      const queries = [activeRow?.phone_number, activeRow?.full_name].map((value) => String(value || '').trim()).filter(Boolean)
      const results = []
      for (const query of queries.slice(0, 2)) {
        if (cancelled) return
        const rows = await searchFn(query).catch(() => [])
        if (cancelled) return
        if (Array.isArray(rows) && rows.length) results.push(...rows)
      }
      if (cancelled) return
      // Tag each result so the UI can label it with its source month.
      const tagged = results.map((entry) => ({
        member: {
          id: entry?.canonical_member_id || entry?.member_id,
          full_name: entry?.full_name || '',
          phone_number: entry?.phone_number || '',
          'Full Name': entry?.full_name || '',
          'Phone Number': entry?.phone_number || '',
          Gender: entry?.gender || '',
          'Current Level': entry?.current_level || ''
        },
        source_table: entry?.source_table || entry?.source_month_label || null,
        source_month_label: entry?.source_month_label || null
      }))
      const candidates = getCrossMonthMatchCandidates(activeRow, tagged)
      if (!cancelled) setCrossMonthCandidates(candidates)
    }
    lookup()
    return () => { cancelled = true }
  }, [reviewActiveId, reviewIndex, reviewRows, currentTable])

  const getAttendanceSettings = (sheetId) => {
    const sheetMeta = resultsBySheet[sheetId]?.payload?.sheet || {}
    const storedMonths = attendanceMonths[sheetId]
    const metaMonths = Array.isArray(sheetMeta.attendance_months)
      ? sheetMeta.attendance_months
      : (sheetMeta.attendance_month ? [sheetMeta.attendance_month] : [])
    const months = Array.isArray(storedMonths) && storedMonths.length
      ? storedMonths
      : metaMonths.length
        ? metaMonths
        : [
            (sheetMeta.attendance_dates?.[0]?.slice(0, 7))
              || monthKeyFromTableName(currentTable)
              || monthKeyFromDate(new Date())
          ]
    const convention = attendanceConventions[sheetId]
      || sheetMeta.attendance_convention
      || ATTENDANCE_CONVENTIONS.TICK_X
    const sundays = attendanceSundays[sheetId] && typeof attendanceSundays[sheetId] === 'object'
      ? attendanceSundays[sheetId]
      : (sheetMeta.attendance_sundays && typeof sheetMeta.attendance_sundays === 'object' ? sheetMeta.attendance_sundays : {})
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
    return { months, month: months[0] || '', convention, columnCount, sundays }
  }

  const attendanceSettings = reviewActiveId ? getAttendanceSettings(reviewActiveId) : { months: [], month: '', convention: ATTENDANCE_CONVENTIONS.TICK_X, columnCount: 0, sundays: {} }

  // Standard dashboard month selection: workspace month tables grouped by year,
  // mirroring the header month picker so the review flow reuses the app's own
  // month-selection look and feel.
  const monthOptionsByYear = useMemo(() => {
    const grouped = {}
    ;(Array.isArray(monthlyTables) ? monthlyTables : []).forEach((table) => {
      const key = monthKeyFromTableName(table)
      if (!key) return
      const year = key.slice(0, 4)
      if (!grouped[year]) grouped[year] = []
      grouped[year].push({ key, label: monthKeyLabel(key).split(' ')[0] })
    })
    return Object.entries(grouped)
      .sort(([yearA], [yearB]) => yearB.localeCompare(yearA))
      .map(([year, months]) => [year, months.sort((a, b) => a.key.localeCompare(b.key))])
  }, [monthlyTables])

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

    // Database search results for the member search bar on the active row.
    const query = memberSearchQuery.trim().toLowerCase()
    const memberSearchResults = query
      ? (currentMembers || []).filter((member) => {
          const name = String(member?.full_name || member?.['Full Name'] || '').toLowerCase()
          const phone = String(member?.phone_number || member?.['Phone Number'] || '')
          return name.includes(query) || phone.includes(query)
        }).slice(0, 8)
      : []
    const possibleCandidates = activeRowData ? getMatchCandidates(activeRowData.row, currentMembers) : []
    const mergedPossibleCandidates = [
      ...possibleCandidates,
      ...crossMonthCandidates.map((candidate) => ({
        member: candidate.member,
        query: candidate.query || '',
        reason: candidate.reason || 'cross-month',
        sourceTable: candidate.sourceTable || candidate.source_table || null,
        sourceMonthLabel: candidate.sourceMonthLabel || candidate.source_month_label || null,
        fromOtherMonth: true
      }))
    ]

    const memberListTerm = memberListSearch.trim().toLowerCase()
    const filteredRowReviewData = rowReviewData.map((data, index) => ({ ...data, index })).filter(({ row, index }) => {
      if (!memberListTerm) return true
      const name = String(row.full_name || '').toLowerCase()
      const phone = String(row.phone_number || '')
      const num = String(index + 1)
      return name.includes(memberListTerm) || phone.includes(memberListTerm) || num.includes(memberListTerm)
    })

    // Final Review plan preview: what WOULD be written on Confirm Save, plus
    // any likely-duplicate rows that would block creation until confirmed.
    const settingsBySheet = {}
    sheets.forEach((sheet) => {
      settingsBySheet[sheet.id] = getAttendanceSettings(sheet.id)
    })
    const finalPreview = previewFinalSave({ sheets, resultsBySheet, currentMembers, monthlyTables, settingsBySheet })
    const editedRowsPreview = finalEditedRowKeys.size > 0
      ? previewFinalSave({
          sheets,
          resultsBySheet,
          currentMembers,
          monthlyTables,
          settingsBySheet,
          onlyRowKeys: finalEditedRowKeys,
          onlyEditedChanges: finalEditedChanges
        })
      : null

    // Union of every Sunday the selected months map to — the horizontal table
    // mirrors the physical sheet, so each Sunday becomes a column.
    const finalSundayDates = []
    const finalSeenDates = new Set()
    sheets.forEach((sheet) => {
      const settings = getAttendanceSettings(sheet.id)
      ;(settings.months || []).forEach((month) => {
        const sundays = Array.isArray(settings.sundays?.[month])
          ? settings.sundays[month]
          : defaultSundaysForMonth(month)
        ;(sundays || []).forEach((dateKey) => {
          if (dateKey && !finalSeenDates.has(dateKey)) {
            finalSeenDates.add(dateKey)
            finalSundayDates.push(dateKey)
          }
        })
      })
    })
    finalSundayDates.sort()

    const finalProfileValue = (entry, key) => {
      if (entry.memberAction === 'create-new') {
        return entry.createProfile?.[key] ?? entry.row?.reviewedValues?.[key]?.value ?? entry.row?.newMemberProfile?.[key] ?? entry.row?.[key] ?? ''
      }
      if (entry.profileUpdates?.[key]) return entry.profileUpdates[key]
      if (entry.row?.reviewedValues?.[key]?.value !== undefined) return entry.row.reviewedValues[key].value
      if (entry.member) return getExistingValue(entry.member, key) || ''
      return entry.row?.[key] ?? entry.row?.originalGeminiValue?.[key] ?? ''
    }
    const finalAttendanceMap = (entry) => {
      const map = {}
      ;(entry.attendance || []).forEach((item) => { map[item.dateKey] = item.value })
      return map
    }
    const finalRowKey = (entry) => `${entry.sheetId}-${entry.rowIndex}`

    // ---- Workflow state / save gating ------------------------------------
    // A scanned row still needs an explicit member decision when it has no
    // confident match and the reviewer hasn't chosen another member or created
    // a new one. Weak matches are never silently picked.
    const memberBlocking = allRowData.filter(({ row, match }) => {
      if (row.memberAction === 'create-new') return false
      if (row.selectedMemberId) return false
      return match.status === 'possible' || match.status === 'none'
    }).length

    const countAttendanceBlocking = (sheetId, row) => {
      const settings = getAttendanceSettings(sheetId)
      let count = 0
      settings.months.forEach((month) => {
        const selected = settings.sundays?.[month]
        const selectedSet = new Set(Array.isArray(selected) ? selected : defaultSundaysForMonth(month))
        const entries = resolveAttendanceEntries({ attendance: row?.attendance, month, columnCount: settings.columnCount, convention: settings.convention })
        entries.forEach((entry) => {
          if (!entry.dateKey || !selectedSet.has(entry.dateKey)) return
          const decision = row?.reviewedAttendance?.[entry.dateKey]
          const final = decision?.value || entry.interpreted.status
          if (entry.interpreted.needsReview || final === ATTENDANCE_STATUS.NEEDS_REVIEW) count += 1
        })
      })
      return count
    }
    const attendanceBlocking = allRowData.reduce((sum, entry) => sum + countAttendanceBlocking(entry.sheetId, entry.row), 0)
    const blockingCount = unresolvedTotal + memberBlocking + attendanceBlocking
    const existingMemberCount = allRowData.filter(({ row, match }) => row.memberAction !== 'create-new' && (row.selectedMemberId || match.status === 'matched')).length
    const newMemberCount = allRowData.filter(({ row }) => row.memberAction === 'create-new').length

    // Keep the work DatSer cannot safely apply out of the ready-to-save table.
    // The attention view makes every reason visible and offers a direct return
    // to the exact row, rather than leaving a single confusing total.
    const finalAttentionRows = allRowData.flatMap((entry) => {
      if ((resultsBySheet[entry.sheetId]?.excludedIndices || []).includes(entry.index)) return []
      const reasons = []
      const profileCount = entry.summary.totals.unresolved || 0
      const attendanceCount = countAttendanceBlocking(entry.sheetId, entry.row)
      const needsMember = entry.row.memberAction !== 'create-new' && !entry.row.selectedMemberId && (entry.match.status === MATCH_STATUSES.POSSIBLE || entry.match.status === MATCH_STATUSES.NONE)
      const reviewedNewName = entry.row.newMemberProfile?.full_name || entry.row.reviewedValues?.full_name?.value
      if (needsMember) reasons.push('Choose the correct member')
      if (entry.row.memberAction === 'create-new' && !String(reviewedNewName || '').trim()) reasons.push('Approve a name for the new member')
      if (profileCount > 0) reasons.push(`${profileCount} profile value${profileCount === 1 ? '' : 's'} need review`)
      if (attendanceCount > 0) reasons.push(`${attendanceCount} attendance mark${attendanceCount === 1 ? '' : 's'} need review`)
      return reasons.length ? [{ ...entry, reasons, attendanceCount }] : []
    })

    const openFinalAttentionRow = (entry) => {
      if (entry.sheetId === reviewActiveId) {
        setReviewIndex(entry.index)
      } else {
        pendingReviewIndexRef.current = entry.index
        setReviewActiveId(entry.sheetId)
      }
      setReviewStep(entry.attendanceCount > 0 ? 'attendance' : 'members')
    }

    const jumpToFirstBlocking = () => {
      const rowIndex = allRowData.findIndex((entry) => {
        const memberBlock = entry.row.memberAction !== 'create-new' && !entry.row.selectedMemberId && (entry.match.status === 'possible' || entry.match.status === 'none')
        return entry.summary.totals.unresolved > 0 || memberBlock || countAttendanceBlocking(entry.sheetId, entry.row) > 0
      })
      if (rowIndex >= 0 && allRowData[rowIndex].sheetId === reviewActiveId) setReviewIndex(allRowData[rowIndex].index)
      if (attendanceBlocking > 0) setReviewStep('attendance')
      else setReviewStep('members')
    }

    // Detected headers — relocated to the top of the review panel for visibility.
    // Detected headers — sleek compact chip strip
    const detectedHeadersBar = reviewSheet && reviewResult?.payload?.sheet ? (
      <div className="mb-3.5 flex flex-wrap items-center gap-1.5 text-xs text-stone-500 dark:text-stone-400">
        <span className="text-[11px] font-black uppercase tracking-wider text-stone-400 dark:text-stone-500">Detected headers:</span>
        {reviewResult.payload.sheet.detected_headers.length ? (
          reviewResult.payload.sheet.detected_headers.map((header, index) => (
            <span key={index} className="rounded-lg bg-stone-100 dark:bg-stone-800/90 border border-stone-200/60 dark:border-stone-700/60 px-2 py-0.5 text-[11px] font-mono font-bold text-stone-700 dark:text-stone-300 shadow-2xs">
              {header}
            </span>
          ))
        ) : (
          <span className="text-xs font-medium text-stone-400 dark:text-stone-500">None detected</span>
        )}
      </div>
    ) : null

    // Review status panel — sleek single-bar status
    const reviewStatusPanel = (
      <div className="mb-4 rounded-2xl border border-stone-200/90 bg-white/95 dark:border-stone-800/90 dark:bg-stone-900/90 p-3.5 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <p className="text-xs font-black text-stone-900 dark:text-white uppercase tracking-wider">Review status</p>
              {blockingCount > 0 ? (
                <span className="rounded-full bg-amber-100 px-2.5 py-0.5 text-[10px] font-black text-amber-800 dark:bg-amber-950/60 dark:text-amber-300">
                  {blockingCount} items still need review
                </span>
              ) : (
                <span className="rounded-full bg-emerald-100 px-2.5 py-0.5 text-[10px] font-black text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300">
                  Ready
                </span>
              )}
            </div>
            <ul className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs font-medium text-stone-600 dark:text-stone-300">
              <li>{includedRows} people found</li>
              <li>{existingMemberCount} existing members</li>
              <li>{newMemberCount} new members</li>
              <li className="hidden sm:inline">{Math.max(0, differingTotal - unresolvedTotal)} profile differences resolved</li>
              {attendanceBlocking > 0 && <li className="text-amber-700 dark:text-amber-300">{attendanceBlocking} attendance marks need review</li>}
            </ul>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={handleApplyAiResultsAndOpenFinalReview}
              data-testid="apply-ai-results-final-review"
              className="inline-flex min-h-[38px] items-center gap-1.5 rounded-xl bg-emerald-600 px-3.5 py-1.5 text-xs font-black text-white transition-colors hover:bg-emerald-700 shadow-sm"
            >
              <Sparkles className="h-3.5 w-3.5" />
              Use AI results &amp; review final
            </button>
            <button
              type="button"
              onClick={() => setReviewStep('final')}
              data-testid="open-final-review"
              className="inline-flex min-h-[38px] items-center gap-1.5 rounded-xl border border-emerald-300 bg-emerald-50 px-3.5 py-1.5 text-xs font-black text-emerald-800 transition-colors hover:border-emerald-500 dark:border-emerald-800 dark:bg-emerald-950/30 dark:text-emerald-200"
            >
              <Table2 className="h-3.5 w-3.5" />
              Open final preview
            </button>
            {blockingCount > 0 ? (
              <button
                type="button"
                onClick={jumpToFirstBlocking}
                data-testid="review-remaining-items"
                className="inline-flex min-h-[36px] items-center gap-1.5 rounded-xl bg-amber-500 hover:bg-amber-600 px-3 py-1.5 text-xs font-bold text-white transition-colors shadow-sm"
              >
                <AlertTriangle className="h-3.5 w-3.5" />
                Review {blockingCount} remaining {blockingCount === 1 ? 'item' : 'items'}
              </button>
            ) : null}
            <button
              type="button"
              onClick={() => setShowChanges((open) => !open)}
              aria-expanded={showChanges}
              className="inline-flex min-h-[36px] items-center gap-1.5 rounded-xl border border-stone-200 bg-white px-3 py-1.5 text-xs font-bold text-stone-700 transition-colors hover:border-orange-300 dark:border-stone-700 dark:bg-stone-800 dark:text-stone-200"
            >
              <CheckCircle2 className="h-3.5 w-3.5 text-orange-600" />
              Review Changes{unresolvedTotal > 0 ? ` (${unresolvedTotal} unresolved)` : ''}
            </button>
            <button
              type="button"
              onClick={handleSaveScan}
              disabled={saving || totalRows === 0}
              className="inline-flex min-h-[36px] items-center gap-1.5 rounded-xl bg-orange-600 px-3 py-1.5 text-xs font-bold text-white transition-colors hover:bg-orange-700 disabled:cursor-not-allowed disabled:opacity-45 shadow-sm"
            >
              {saving
                ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                : <Save className="h-3.5 w-3.5" />}
              {saving ? 'Saving…' : savedScanRecord ? 'Save scan again' : 'Save scan'}
            </button>
          </div>
          {finalSaving && (
            <div className="flex w-full items-center gap-2 pt-1" role="status" aria-live="polite">
              <Loader2 className="h-4 w-4 shrink-0 animate-spin text-emerald-700 dark:text-emerald-400" />
              <p className="text-xs font-bold text-emerald-800 dark:text-emerald-300">
                {finalSaveProgress === 0 ? 'Reviewing approved changes…' : 'Writing approved changes to DatSer…'}
              </p>
            </div>
          )}
          {saveMessage && (
            <p className="mt-1 text-xs font-bold text-emerald-700 dark:text-emerald-300">{saveMessage}</p>
          )}
          {savedScansError && (
            <p role="alert" className="mt-1 text-xs font-bold text-rose-700 dark:text-rose-300">{savedScansError}</p>
          )}
        </div>

        {showChanges && (
          <div className="mt-4 border-t border-stone-200 pt-3 dark:border-stone-700">
            <p className="text-[11px] font-black uppercase tracking-wider text-stone-500 dark:text-stone-400">Pending review choices</p>
            {changesEntries.length === 0 ? (
              <p className="mt-2 text-xs font-medium text-stone-500 dark:text-stone-400">
                No conflicting fields — every scanned value already matches DatSer.
              </p>
            ) : (
              <ul className="mt-2 space-y-2">
                {changesEntries.map((entry) => (
                  <li key={`${entry.sheetId}-${entry.index}`} className="rounded-xl border border-stone-200 bg-white p-3 text-xs dark:border-stone-700 dark:bg-stone-800">
                    <p className="font-black text-stone-900 dark:text-white">
                      {entry.row.full_name || `Member ${entry.index + 1}`}
                      <span className="font-semibold text-stone-400 dark:text-stone-500"> · {entry.sheetSource}</span>
                    </p>
                    {entry.summary.compares.filter((compare) => compare.state === FIELD_STATES.DIFFERENT || compare.state === FIELD_STATES.LOW_CONFIDENCE).map((compare) => {
                      const fieldMeta = COMPARE_FIELDS.find((field) => field.key === compare.field)
                      const decision = entry.row.reviewedValues?.[compare.field]
                      const geminiValue = entry.row.originalGeminiValue?.[compare.field] ?? entry.row[compare.field]
                      const existingValue = getExistingValue(entry.match.member, compare.field)
                      return (
                        <p key={compare.field} className="mt-1 font-medium leading-relaxed text-stone-600 dark:text-stone-300">
                          {fieldMeta?.label}: {decision ? (
                            <span className="font-black text-emerald-700 dark:text-emerald-400">
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
    )

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
              AI finished reading this sheet. Review the people below before attendance is saved. Nothing is written until you confirm at final save.
            </p>
          </div>
        </div>

        {/* Sheet navigator & batch controls */}
        {sheets.length > 0 && (
          <div className="mb-4 rounded-2xl border border-stone-200/90 bg-white/95 p-3.5 shadow-sm dark:border-stone-800 dark:bg-stone-900/95">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={() => setSheetRailExpanded((prev) => !prev)}
                  aria-label="Toggle sheet navigation rail"
                  aria-expanded={sheetRailExpanded}
                  className="grid h-8 w-8 place-items-center rounded-xl border border-stone-200 bg-stone-50 text-stone-600 hover:border-orange-300 hover:text-stone-900 dark:border-stone-700 dark:bg-stone-800 dark:text-stone-400 dark:hover:text-white transition-colors"
                >
                  <Menu className="h-4 w-4" />
                </button>
                <span className="text-xs font-black uppercase tracking-wider text-stone-400 dark:text-stone-500">
                  Sheets ({sheets.length}):
                </span>
                <div className="flex flex-wrap gap-1.5">
                  {sheets.map((sheet, index) => {
                    const status = resultsBySheet[sheet.id]?.status || 'pending'
                    const isCompleted = completedSheets.has(sheet.id)
                    const isActive = reviewActiveId === sheet.id
                    return (
                      <button
                        key={sheet.id}
                        type="button"
                        onClick={() => {
                          setReviewActiveId(sheet.id)
                          setReviewIndex(0)
                        }}
                        aria-pressed={isActive}
                        aria-label={`Select sheet ${index + 1}: ${sheet.source}`}
                        className={`inline-flex items-center gap-1.5 rounded-xl border px-3 py-1.5 text-xs font-black transition-all ${
                          isActive
                            ? 'border-orange-500 bg-orange-500 text-white shadow-sm shadow-orange-500/20'
                            : isCompleted
                              ? 'border-emerald-300 bg-emerald-50 text-emerald-800 hover:border-emerald-400 dark:border-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300'
                              : 'border-stone-200 bg-white text-stone-700 hover:border-orange-300 dark:border-stone-700 dark:bg-stone-800 dark:text-stone-200'
                        }`}
                      >
                        {isCompleted ? (
                          <Check className="h-3.5 w-3.5 text-emerald-600 dark:text-emerald-400 shrink-0" />
                        ) : (
                          <span className="font-mono text-stone-400 dark:text-stone-500">{index + 1}.</span>
                        )}
                        <span className="max-w-28 truncate">{sheet.source}</span>
                        {isCompleted && (
                          <span className="rounded-full bg-emerald-200/80 px-1.5 py-0.2 text-[9px] font-black text-emerald-900 dark:bg-emerald-900 dark:text-emerald-200">
                            Done
                          </span>
                        )}
                        {status === 'failed' && (
                          <span className="rounded-full bg-red-100 px-1.5 py-0.2 text-[9px] font-black text-red-700 dark:bg-red-950/60 dark:text-red-300">
                            Failed
                          </span>
                        )}
                      </button>
                    )
                  })}
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={() => handleToggleSheetCompleted(reviewActiveId)}
                  className={`inline-flex min-h-[36px] items-center gap-1.5 rounded-xl border px-3 py-1.5 text-xs font-black transition-colors ${
                    completedSheets.has(reviewActiveId)
                      ? 'border-emerald-300 bg-emerald-50 text-emerald-800 dark:border-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300'
                      : 'border-stone-200 bg-white text-stone-700 hover:border-emerald-400 dark:border-stone-700 dark:bg-stone-800 dark:text-stone-200'
                  }`}
                  title="Mark this sheet as completed"
                >
                  <Check className="h-3.5 w-3.5 text-emerald-600 dark:text-emerald-400" />
                  {completedSheets.has(reviewActiveId) ? '✓ Sheet Completed' : 'Mark Sheet as Completed'}
                </button>

                <button
                  type="button"
                  onClick={handleReviewNextSheet}
                  className="inline-flex min-h-[36px] items-center gap-1.5 rounded-xl border border-stone-200 bg-white px-3 py-1.5 text-xs font-black text-stone-700 hover:border-orange-300 dark:border-stone-700 dark:bg-stone-800 dark:text-stone-200 shadow-2xs"
                  title="Move to the next unfinished sheet"
                >
                  <span>Review next sheet</span>
                  <ChevronRight className="h-3.5 w-3.5" />
                </button>
              </div>
            </div>

            {/* Expanded Sheet Drawer */}
            {sheetRailExpanded && (
              <div className="mt-3 pt-3 border-t border-stone-200/80 dark:border-stone-800 grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-2">
                {sheets.map((sheet, index) => {
                  const status = resultsBySheet[sheet.id]?.status || 'pending'
                  const isCompleted = completedSheets.has(sheet.id)
                  const isActive = reviewActiveId === sheet.id
                  const memberCount = resultsBySheet[sheet.id]?.payload?.rows?.length || 0

                  return (
                    <button
                      key={sheet.id}
                      type="button"
                      onClick={() => {
                        setReviewActiveId(sheet.id)
                        setReviewIndex(0)
                        setRightPanelView('details')
                      }}
                      className={`flex items-center gap-2.5 p-2.5 rounded-xl border text-left text-xs transition-all ${
                        isActive
                          ? 'border-2 border-orange-500 bg-orange-50/80 text-orange-950 dark:border-orange-500 dark:bg-orange-950/40 dark:text-orange-200 font-bold shadow-2xs'
                          : isCompleted
                            ? 'border-emerald-300 bg-emerald-50 text-emerald-800 dark:border-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300'
                            : 'border-stone-200 bg-white text-stone-700 hover:border-orange-300 dark:border-stone-700 dark:bg-stone-800 dark:text-stone-200'
                      }`}
                    >
                      <div className={`grid h-7 w-7 shrink-0 place-items-center rounded-lg font-mono font-black ${
                        isCompleted ? 'bg-emerald-200 text-emerald-900' : 'bg-stone-100 dark:bg-stone-700 text-stone-700 dark:text-stone-200'
                      }`}>
                        {isCompleted ? <Check className="h-3.5 w-3.5" /> : index + 1}
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="truncate font-black text-stone-900 dark:text-white">{sheet.source}</p>
                        <p className="text-[10px] text-stone-400 dark:text-stone-500">
                          {isCompleted ? '✓ Completed' : status === 'failed' ? 'Failed' : `${memberCount} people`}
                        </p>
                      </div>
                    </button>
                  )
                })}
              </div>
            )}
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

            {/* Detected headers + review status live at the top for immediate visibility */}
            {detectedHeadersBar}
            {reviewStatusPanel}

            {/* Step indicator */}
            <div className="mb-5 inline-flex p-1 rounded-2xl bg-stone-200/70 dark:bg-stone-800/70 gap-1 overflow-x-auto max-w-full" role="tablist" aria-label="Review steps">
              {[
                { id: 'members', label: '1. People & profile' },
                { id: 'attendance', label: '2. Attendance' },
                { id: 'final', label: '3. Final review' }
              ].map((step) => {
                const isActive = reviewStep === step.id
                return (
                  <button
                    key={step.id}
                    type="button"
                    role="tab"
                    aria-selected={isActive}
                    onClick={() => setReviewStep(step.id)}
                    className={`inline-flex shrink-0 items-center gap-2 rounded-xl px-4 py-2 text-xs font-bold transition-all ${
                      isActive
                        ? 'bg-orange-600 text-white shadow-md shadow-orange-600/25 font-black'
                        : 'text-stone-700 dark:text-stone-300 hover:text-stone-950 dark:hover:text-white hover:bg-white/40 dark:hover:bg-stone-700/40'
                    }`}
                  >
                    <span>{step.label}</span>
                    {step.id === 'final' && blockingCount > 0 ? (
                      <span className={`rounded-full px-2 py-0.5 text-[10px] font-black ${isActive ? 'bg-white/20 text-white' : 'bg-amber-100 text-amber-800 dark:bg-amber-950/60 dark:text-amber-300'}`}>
                        {blockingCount}
                      </span>
                    ) : null}
                  </button>
                )
              })}
            </div>

            {reviewStep === 'final' ? (
              /* STEP 3: FINAL REVIEW */
              <div className="rounded-3xl border border-stone-200/90 bg-white/95 p-5 sm:p-6 shadow-sm dark:border-stone-800 dark:bg-stone-900/95" data-testid="final-review-screen">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <h2 className="text-base font-black text-stone-900 dark:text-white">Final review</h2>
                    <p className="text-xs font-medium text-stone-500 dark:text-stone-400">
                      Save the approved items now. Anything still needing review stays here for you to finish later.
                    </p>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    {blockingCount > 0 && (
                      <button
                        type="button"
                        onClick={jumpToFirstBlocking}
                        className="inline-flex min-h-[40px] items-center gap-2 rounded-xl bg-amber-600 px-4 py-2 text-xs font-black text-white transition-colors hover:bg-amber-700 shadow-sm"
                      >
                        <AlertTriangle className="h-4 w-4" />
                        Review {blockingCount} remaining {blockingCount === 1 ? 'item' : 'items'}
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => handleConfirmFinalSave({ editedOnly: finalEditedRowKeys.size > 0 })}
                      disabled={finalSaving || saving || (finalEditedRowKeys.size > 0 ? editedRowsPreview?.plan.rows.length === 0 : finalPreview.plan.rows.length === 0)}
                      data-testid="confirm-save-to-datser"
                      className="inline-flex min-h-[40px] items-center gap-2 rounded-xl bg-emerald-600 px-4 py-2 text-xs font-black text-white transition-colors hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-45 shadow-sm"
                    >
                      {finalSaving
                        ? <Loader2 className="h-4 w-4 animate-spin" />
                        : <ShieldCheck className="h-4 w-4" />}
                      {finalSaving
                        ? 'Saving to DatSer…'
                        : finalEditedRowKeys.size > 0
                          ? `Save edited rows (${editedRowsPreview?.plan.rows.length || 0})`
                          : 'Confirm Save to DatSer'}
                    </button>
                  </div>
                </div>

                {finalPreview.plan.rows.length === 0 ? (
                  <p className="mt-4 rounded-2xl border border-dashed border-stone-200 p-8 text-center text-sm font-medium text-stone-500 dark:border-stone-800 dark:text-stone-400">
                    Nothing to save — add a month or resolve the rows first.
                  </p>
                ) : (
                  <>
                    <div className="mt-4 flex items-center justify-between gap-3">
                      <p className="text-xs font-black uppercase tracking-wider text-stone-500 dark:text-stone-400">
                        {finalEditedRowKeys.size > 0
                          ? `${editedRowsPreview?.plan.rows.length || 0} edited ${editedRowsPreview?.plan.rows.length === 1 ? 'member' : 'members'} ready to save`
                          : `${finalPreview.plan.rows.length} ${finalPreview.plan.rows.length === 1 ? 'member' : 'members'} ready to save`}
                      </p>
                      <div className="inline-flex rounded-xl border border-stone-200/80 bg-stone-100 p-1 dark:border-stone-700 dark:bg-stone-800/80" role="group" aria-label="Final review view">
                        <button
                          type="button"
                          onClick={() => setFinalViewMode('table')}
                          aria-pressed={finalViewMode === 'table'}
                          className={`inline-flex min-h-[34px] items-center gap-1.5 rounded-lg px-3 py-1 text-xs font-black transition-colors ${
                            finalViewMode === 'table'
                              ? 'bg-white text-stone-900 shadow-sm dark:bg-stone-700 dark:text-white'
                              : 'text-stone-500 hover:text-stone-800 dark:text-stone-400 dark:hover:text-stone-200'
                          }`}
                        >
                          <Table2 className="h-3.5 w-3.5" />
                          Spreadsheet
                        </button>
                        <button
                          type="button"
                          onClick={() => setFinalViewMode('cards')}
                          aria-pressed={finalViewMode === 'cards'}
                          className={`inline-flex min-h-[34px] items-center gap-1.5 rounded-lg px-3 py-1 text-xs font-black transition-colors ${
                            finalViewMode === 'cards'
                              ? 'bg-white text-stone-900 shadow-sm dark:bg-stone-700 dark:text-white'
                              : 'text-stone-500 hover:text-stone-800 dark:text-stone-400 dark:hover:text-stone-200'
                          }`}
                        >
                          <Layers className="h-3.5 w-3.5" />
                          Cards
                        </button>
                        <button
                          type="button"
                          onClick={() => setFinalViewMode('attention')}
                          aria-pressed={finalViewMode === 'attention'}
                          className={`inline-flex min-h-[34px] items-center gap-1.5 rounded-lg px-3 py-1 text-xs font-black transition-colors ${
                            finalViewMode === 'attention'
                              ? 'bg-amber-500 text-white shadow-sm'
                              : 'text-amber-700 hover:text-amber-800 dark:text-amber-300 dark:hover:text-amber-200'
                          }`}
                        >
                          <AlertTriangle className="h-3.5 w-3.5" />
                          Needs attention ({blockingCount})
                        </button>
                      </div>
                    </div>

                    {blockingCount > 0 && (
                      <p className="mt-2 text-xs font-semibold text-amber-700 dark:text-amber-300">
                        {blockingCount} item{blockingCount === 1 ? '' : 's'} need attention. Open the separate Needs attention view to see exactly why each row was not included.
                      </p>
                    )}

                    {finalViewMode === 'table' ? (
                      /* Spreadsheet / table view — mirrors the physical sheet */
                      <div className="mt-4 max-h-[58dvh] overflow-auto rounded-2xl border border-stone-200 bg-white dark:border-stone-800 dark:bg-stone-900 shadow-2xs">
                        <table className="min-w-full text-left text-xs" data-testid="final-table-view">
                          <thead>
                            <tr className="border-b border-stone-200 bg-stone-50/80 dark:border-stone-800 dark:bg-stone-800/50">
                              <th scope="col" className="whitespace-nowrap px-3.5 py-2.5 font-black uppercase tracking-wider text-stone-500 dark:text-stone-400 w-10">
                                #
                              </th>
                              {COMPARE_FIELDS.map(({ key, label }) => (
                                <th key={key} scope="col" className="whitespace-nowrap px-3.5 py-2.5 font-black uppercase tracking-wider text-stone-500 dark:text-stone-400">
                                  {key === 'current_level' ? 'Educational level' : label}
                                </th>
                              ))}
                              {finalSundayDates.map((dateKey) => {
                                const date = new Date(`${dateKey}T00:00:00`)
                                const label = Number.isNaN(date.getTime()) ? dateKey : date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
                                return (
                                  <th key={dateKey} scope="col" className="whitespace-nowrap px-3.5 py-2.5 text-center font-black uppercase tracking-wider text-stone-500 dark:text-stone-400">
                                    {label}
                                  </th>
                                )
                              })}
                              <th scope="col" className="whitespace-nowrap px-3.5 py-2.5 text-right font-black uppercase tracking-wider text-stone-500 dark:text-stone-400 w-16">
                                <span className="inline-flex items-center gap-1"><Pencil className="h-3.5 w-3.5" /> Edit</span>
                              </th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-stone-100 dark:divide-stone-800/60">
                            {finalPreview.plan.rows.map((entry, index) => {
                              const rowKey = finalRowKey(entry)
                              const isEditingThis = finalEditingRowKey === rowKey
                              const wasEditedInThisPass = finalEditedRowKeys.has(rowKey)
                              const attendanceMap = finalAttendanceMap(entry)
                              const isNew = entry.memberAction === 'create-new'
                              const name = isNew
                                ? (entry.createProfile?.full_name || 'New member')
                                : (entry.member?.full_name || entry.member?.['Full Name'] || entry.row?.full_name || 'Member')

                              return (
                                <React.Fragment key={rowKey}>
                                  <tr className={`hover:bg-stone-50/70 dark:hover:bg-stone-800/40 transition-colors ${
                                    isEditingThis
                                      ? 'bg-orange-50/70 dark:bg-orange-950/20'
                                      : wasEditedInThisPass
                                        ? 'bg-emerald-50/70 dark:bg-emerald-950/20'
                                        : ''
                                  }`}>
                                    <td className="whitespace-nowrap px-3.5 py-2.5 font-mono text-[11px] text-stone-400">
                                      {index + 1}
                                    </td>
                                    {COMPARE_FIELDS.map(({ key }) => (
                                      <td key={key} className="whitespace-nowrap px-3.5 py-2.5 font-medium text-stone-900 dark:text-white">
                                        {finalProfileValue(entry, key) || '—'}
                                      </td>
                                    ))}
                                    {finalSundayDates.map((dateKey) => {
                                      const value = attendanceMap[dateKey]
                                      return (
                                        <td key={dateKey} className="whitespace-nowrap px-3.5 py-2.5 text-center">
                                          {value === ATTENDANCE_STATUS.PRESENT ? (
                                            <span className="inline-block px-2 py-0.5 rounded-md bg-emerald-100 dark:bg-emerald-950/60 text-emerald-800 dark:text-emerald-300 font-black text-[11px]">P</span>
                                          ) : value === ATTENDANCE_STATUS.ABSENT ? (
                                            <span className="inline-block px-2 py-0.5 rounded-md bg-rose-100 dark:bg-rose-950/60 text-rose-800 dark:text-rose-300 font-black text-[11px]">A</span>
                                          ) : (
                                            <span className="text-stone-300 dark:text-stone-600 font-bold">—</span>
                                          )}
                                        </td>
                                      )
                                    })}
                                    <td className="whitespace-nowrap px-3.5 py-2.5 text-right">
                                      <button
                                        type="button"
                                        onClick={() => setFinalEditingRowKey(isEditingThis ? null : rowKey)}
                                        aria-label={`Edit ${name}`}
                                        title={`Edit ${name} in the spreadsheet`}
                                        className={`inline-flex min-h-[32px] items-center gap-1 rounded-lg px-2 py-1 text-xs font-bold transition-colors ${
                                          isEditingThis
                                            ? 'bg-orange-600 text-white'
                                            : 'border border-stone-200 bg-white text-stone-700 hover:border-orange-300 dark:border-stone-700 dark:bg-stone-800 dark:text-stone-200'
                                        }`}
                                      >
                                        <Pencil className="h-3 w-3" />
                                        <span>{isEditingThis ? 'Done' : wasEditedInThisPass ? 'Edited' : 'Edit'}</span>
                                      </button>
                                    </td>
                                  </tr>
                                  {isEditingThis && (
                                    <tr className="bg-orange-50/50 dark:bg-stone-900/90">
                                      <td colSpan={1 + COMPARE_FIELDS.length + finalSundayDates.length + 1} className="p-4">
                                        <div className="rounded-2xl border border-orange-200/90 bg-white p-4 shadow-sm dark:border-stone-700 dark:bg-stone-900">
                                          <div className="flex items-center justify-between gap-2 border-b border-stone-100 pb-2.5 dark:border-stone-800">
                                            <p className="text-xs font-black text-stone-900 dark:text-white">
                                              Editing details for <span className="text-orange-600 dark:text-orange-400">{name}</span>
                                            </p>
                                            <button
                                              type="button"
                                              onClick={() => setFinalEditingRowKey(null)}
                                              className="inline-flex items-center gap-1 rounded-xl bg-orange-600 px-3 py-1.5 text-xs font-black text-white hover:bg-orange-700 shadow-sm"
                                            >
                                              <Check className="h-3.5 w-3.5" />
                                              Done Editing
                                            </button>
                                          </div>

                                          <div className="mt-3 grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-3">
                                            {COMPARE_FIELDS.map(({ key, label }) => {
                                              const currentValue = finalProfileValue(entry, key)
                                              return (
                                                <div key={key}>
                                                  <label className="block text-[10px] font-black uppercase tracking-wider text-stone-400 dark:text-stone-500 mb-1">
                                                    {key === 'current_level' ? 'Educational level' : label}
                                                  </label>
                                                  <input
                                                    type="text"
                                                    value={currentValue}
                                                    onChange={(e) => handleFinalRowDecision(entry.sheetId, entry.rowIndex, key, { value: e.target.value, source: REVIEW_SOURCES.EDITED })}
                                                    aria-label={`Edit ${key === 'current_level' ? 'Educational level' : label}`}
                                                    className="w-full rounded-xl border border-stone-200 bg-stone-50 px-2.5 py-1.5 text-xs font-bold text-stone-900 outline-none focus:border-orange-500 focus:bg-white dark:border-stone-700 dark:bg-stone-800 dark:text-white"
                                                  />
                                                </div>
                                              )
                                            })}
                                          </div>

                                          {finalSundayDates.length > 0 && (
                                            <div className="mt-3.5 pt-3 border-t border-stone-100 dark:border-stone-800">
                                              <p className="text-[10px] font-black uppercase tracking-wider text-stone-400 dark:text-stone-500 mb-2">Sunday Attendance</p>
                                              <div className="flex flex-wrap gap-2.5">
                                                {finalSundayDates.map((dateKey) => {
                                                  const date = new Date(`${dateKey}T00:00:00`)
                                                  const label = Number.isNaN(date.getTime()) ? dateKey : date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
                                                  const value = attendanceMap[dateKey]
                                                  const choiceValue = value === ATTENDANCE_STATUS.PRESENT ? true : value === ATTENDANCE_STATUS.ABSENT ? false : null
                                                  return (
                                                    <div key={dateKey} className="flex items-center gap-2 rounded-xl border border-stone-200 bg-stone-50 px-2.5 py-1 dark:border-stone-700 dark:bg-stone-800/60">
                                                      <span className="text-xs font-black uppercase text-stone-700 dark:text-stone-300">{label}</span>
                                                      <AttendanceChoice
                                                        compact
                                                        value={choiceValue}
                                                        onChange={(next) => {
                                                          if (next === true) handleFinalAttendanceDecision(entry.sheetId, entry.rowIndex, dateKey, { value: ATTENDANCE_STATUS.PRESENT, source: REVIEW_SOURCES.EDITED })
                                                          else if (next === false) handleFinalAttendanceDecision(entry.sheetId, entry.rowIndex, dateKey, { value: ATTENDANCE_STATUS.ABSENT, source: REVIEW_SOURCES.EDITED })
                                                          else handleFinalClearAttendanceDecision(entry.sheetId, entry.rowIndex, dateKey)
                                                        }}
                                                        ariaLabel={`Attendance for ${label}`}
                                                      />
                                                    </div>
                                                  )
                                                })}
                                              </div>
                                            </div>
                                          )}
                                        </div>
                                      </td>
                                    </tr>
                                  )}
                                </React.Fragment>
                              )
                            })}
                          </tbody>
                        </table>
                      </div>
                    ) : finalViewMode === 'attention' ? (
                      <div className="mt-4 overflow-hidden rounded-2xl border border-amber-200 bg-amber-50/40 dark:border-amber-900/50 dark:bg-amber-950/10" data-testid="final-attention-view">
                        <div className="border-b border-amber-200/80 px-4 py-3 dark:border-amber-900/50">
                          <p className="text-sm font-black text-amber-900 dark:text-amber-100">Needs attention</p>
                          <p className="mt-0.5 text-xs font-medium text-amber-800/80 dark:text-amber-200/80">
                            These rows are not included in the ready-to-save count. Open one to choose a member, confirm the profile, or settle the attendance mark.
                          </p>
                        </div>
                        {finalAttentionRows.length === 0 ? (
                          <p className="p-6 text-center text-sm font-medium text-amber-800 dark:text-amber-200">Nothing is waiting for review.</p>
                        ) : (
                          <div className="max-h-[58dvh] overflow-auto divide-y divide-amber-100 dark:divide-amber-900/40">
                            {finalAttentionRows.map((entry) => {
                              const name = entry.row.full_name || entry.row.originalGeminiValue?.full_name || `Person ${entry.index + 1}`
                              return (
                                <div key={`${entry.sheetId}:${entry.index}`} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
                                  <div className="min-w-0">
                                    <p className="truncate text-sm font-black text-stone-900 dark:text-white">{name}</p>
                                    <p className="mt-1 text-xs font-semibold text-amber-800 dark:text-amber-200">{entry.reasons.join(' · ')}</p>
                                  </div>
                                  <button
                                    type="button"
                                    onClick={() => openFinalAttentionRow(entry)}
                                    className="inline-flex min-h-[36px] shrink-0 items-center gap-1.5 rounded-xl bg-amber-600 px-3 py-1.5 text-xs font-black text-white transition-colors hover:bg-amber-700"
                                  >
                                    <Pencil className="h-3.5 w-3.5" />
                                    Review row
                                  </button>
                                </div>
                              )
                            })}
                          </div>
                        )}
                      </div>
                    ) : (
                      /* Card view — genuine responsive card grid inspired by the reference */
                      <div className="mt-4 grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
                        {finalPreview.plan.rows.map((entry) => {
                          const isNew = entry.memberAction === 'create-new'
                          const name = isNew
                            ? (entry.createProfile?.full_name || 'New member')
                            : (entry.member?.full_name || entry.member?.['Full Name'] || entry.row?.full_name || 'Member')
                          const rowKey = finalRowKey(entry)
                          const isOpen = expandedFinalRows.has(rowKey)
                          const isEditingThis = finalEditingRowKey === rowKey
                          const wasEditedInThisPass = finalEditedRowKeys.has(rowKey)
                          const profileChanges = Object.entries(entry.profileUpdates || {})
                          const attendanceMap = finalAttendanceMap(entry)
                          const memberId = entry.member?.id || entry.member?.member_uuid
                          const memberCode = memberCodeMap[memberId] || entry.member?.member_code || entry.member?.['Member Code'] || entry.row?.member_code || ''
                          const phone = finalProfileValue(entry, 'phone_number')
                          const age = finalProfileValue(entry, 'age')

                          const presentCount = Object.values(attendanceMap).filter((v) => v === ATTENDANCE_STATUS.PRESENT).length
                          const absentCount = Object.values(attendanceMap).filter((v) => v === ATTENDANCE_STATUS.ABSENT).length
                          const summaryText = `${presentCount} Present · ${absentCount} Absent`

                          return (
                            <div
                              key={rowKey}
                              className={`rounded-2xl border bg-white p-4 shadow-sm hover:shadow-md transition-all duration-200 dark:bg-stone-900/90 flex flex-col justify-between ${
                                isEditingThis
                                  ? 'border-orange-500 ring-1 ring-orange-500/30'
                                  : wasEditedInThisPass
                                    ? 'border-emerald-500 ring-1 ring-emerald-500/30'
                                  : isOpen
                                    ? 'border-orange-300 dark:border-orange-800/80 ring-1 ring-orange-400/20'
                                    : 'border-stone-200/90 dark:border-stone-800'
                              }`}
                            >
                              <div>
                                <button
                                  type="button"
                                  onClick={() => setExpandedFinalRows((prev) => {
                                    const next = new Set(prev)
                                    if (next.has(rowKey)) next.delete(rowKey)
                                    else next.add(rowKey)
                                    return next
                                  })}
                                  aria-expanded={isOpen}
                                  className="w-full text-left focus:outline-none"
                                >
                                  <div className="flex items-start justify-between gap-2">
                                    <h3 className="text-base font-black text-stone-900 dark:text-white leading-snug truncate">
                                      {name}
                                    </h3>
                                    {memberCode && (
                                      <span className="shrink-0 px-2 py-0.5 rounded-lg bg-stone-100 dark:bg-stone-800 text-stone-700 dark:text-stone-300 text-xs font-mono font-black border border-stone-200/60 dark:border-stone-700/60">
                                        {memberCode}
                                      </span>
                                    )}
                                  </div>

                                  <div className="mt-2 flex flex-wrap items-center gap-2">
                                    {phone && (
                                      <span className="text-xs font-medium text-stone-600 dark:text-stone-300">
                                        {phone}
                                      </span>
                                    )}
                                    {age && (
                                      <span className="text-xs font-medium text-stone-500 dark:text-stone-400">
                                        · Age: <span className="font-bold text-stone-700 dark:text-stone-200">{age}</span>
                                      </span>
                                    )}
                                    <span className={`rounded-full px-2.5 py-0.5 text-[10px] font-black ${
                                      isNew
                                        ? 'bg-orange-100 text-orange-700 dark:bg-orange-950/50 dark:text-orange-300'
                                        : 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-300'
                                    }`}>
                                      {isNew ? 'New member' : 'Existing member'}
                                    </span>
                                  </div>

                                  {/* Attendance Summary */}
                                  <div className="mt-3.5 rounded-xl bg-stone-50 dark:bg-stone-800/60 p-2.5 border border-stone-100 dark:border-stone-800/60">
                                    <p className="text-[10px] font-black uppercase tracking-wider text-stone-400 dark:text-stone-500">Attendance</p>
                                    <p className="mt-0.5 text-xs font-bold text-stone-800 dark:text-stone-200">{summaryText}</p>
                                  </div>
                                </button>
                              </div>

                              {/* Card Footer Actions: Edit Pencil + Expand/Collapse */}
                              <div className="mt-4 flex items-center justify-between border-t border-stone-100 dark:border-stone-800 pt-3">
                                <button
                                  type="button"
                                  onClick={() => setFinalEditingRowKey(isEditingThis ? null : rowKey)}
                                  aria-label="Edit member"
                                  title={`Edit ${name}`}
                                  className={`inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-xs font-black transition-colors ${
                                    isEditingThis
                                      ? 'bg-orange-600 text-white shadow-sm'
                                      : 'border border-stone-200 bg-white text-stone-700 hover:border-orange-300 dark:border-stone-700 dark:bg-stone-800 dark:text-stone-200'
                                  }`}
                                >
                                  <Pencil className="h-3.5 w-3.5" />
                                  <span>{isEditingThis ? 'Done' : wasEditedInThisPass ? 'Edited' : 'Edit'}</span>
                                </button>

                                <button
                                  type="button"
                                  onClick={() => setExpandedFinalRows((prev) => {
                                    const next = new Set(prev)
                                    if (next.has(rowKey)) next.delete(rowKey)
                                    else next.add(rowKey)
                                    return next
                                  })}
                                  aria-expanded={isOpen}
                                  className="inline-flex items-center gap-1.5 text-xs font-black text-orange-600 dark:text-orange-400 hover:text-orange-700 transition-colors ml-auto"
                                >
                                  <span>{isOpen ? 'Collapse' : 'Expand'}</span>
                                  <ChevronDown className={`h-4 w-4 transition-transform duration-200 ${isOpen ? 'rotate-180' : ''}`} />
                                </button>
                              </div>

                              {/* In-Card Editing Panel */}
                              {isEditingThis && (
                                <div className="mt-3 pt-3 border-t border-orange-200 dark:border-stone-700 space-y-3">
                                  <div>
                                    <p className="text-[11px] font-black uppercase tracking-wider text-orange-600 dark:text-orange-400 mb-2">Edit Profile Details</p>
                                    <div className="space-y-2">
                                      {COMPARE_FIELDS.map(({ key, label }) => {
                                        const currentValue = finalProfileValue(entry, key)
                                        return (
                                          <div key={key}>
                                            <label className="block text-[10px] font-black uppercase tracking-wider text-stone-400 dark:text-stone-500 mb-0.5">
                                              {key === 'current_level' ? 'Educational level' : label}
                                            </label>
                                            <input
                                              type="text"
                                              value={currentValue}
                                              onChange={(e) => handleFinalRowDecision(entry.sheetId, entry.rowIndex, key, { value: e.target.value, source: REVIEW_SOURCES.EDITED })}
                                              aria-label={`Edit ${key === 'current_level' ? 'Educational level' : label}`}
                                              className="w-full rounded-xl border border-stone-200 bg-stone-50 px-2.5 py-1.5 text-xs font-bold text-stone-900 outline-none focus:border-orange-500 focus:bg-white dark:border-stone-700 dark:bg-stone-800 dark:text-white"
                                            />
                                          </div>
                                        )
                                      })}
                                    </div>
                                  </div>

                                  {finalSundayDates.length > 0 && (
                                    <div>
                                      <p className="text-[11px] font-black uppercase tracking-wider text-orange-600 dark:text-orange-400 mb-2">Edit Sunday Attendance</p>
                                      <div className="grid grid-cols-1 gap-1.5">
                                        {finalSundayDates.map((dateKey) => {
                                          const date = new Date(`${dateKey}T00:00:00`)
                                          const label = Number.isNaN(date.getTime()) ? dateKey : date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
                                          const value = attendanceMap[dateKey]
                                          const choiceValue = value === ATTENDANCE_STATUS.PRESENT ? true : value === ATTENDANCE_STATUS.ABSENT ? false : null
                                          return (
                                            <div key={dateKey} className="flex items-center justify-between gap-2 rounded-xl border border-stone-100 bg-stone-50 p-2 dark:border-stone-800 dark:bg-stone-800/60">
                                              <span className="text-xs font-black uppercase text-stone-700 dark:text-stone-300">{label}</span>
                                              <AttendanceChoice
                                                compact
                                                value={choiceValue}
                                                onChange={(next) => {
                                                  if (next === true) handleFinalAttendanceDecision(entry.sheetId, entry.rowIndex, dateKey, { value: ATTENDANCE_STATUS.PRESENT, source: REVIEW_SOURCES.EDITED })
                                                  else if (next === false) handleFinalAttendanceDecision(entry.sheetId, entry.rowIndex, dateKey, { value: ATTENDANCE_STATUS.ABSENT, source: REVIEW_SOURCES.EDITED })
                                                  else handleFinalClearAttendanceDecision(entry.sheetId, entry.rowIndex, dateKey)
                                                }}
                                                ariaLabel={`Attendance for ${label}`}
                                              />
                                            </div>
                                          )
                                        })}
                                      </div>
                                    </div>
                                  )}
                                </div>
                              )}

                              {/* In-Card Read-Only Inspection Panel */}
                              {isOpen && !isEditingThis && (
                                <div className="mt-3 pt-3 border-t border-stone-100 dark:border-stone-800 space-y-3">
                                  {/* Profile Section */}
                                  <div>
                                    <p className="text-[11px] font-black uppercase tracking-wider text-stone-400 dark:text-stone-500 mb-1.5">Profile</p>
                                    <div className="grid grid-cols-2 gap-2 text-xs">
                                      {COMPARE_FIELDS.map(({ key, label }) => (
                                        <div key={key} className="rounded-xl bg-stone-50 dark:bg-stone-800/80 p-2 border border-stone-100 dark:border-stone-800/60">
                                          <p className="text-[10px] font-black uppercase text-stone-400 dark:text-stone-500">
                                            {key === 'current_level' ? 'Educational level' : label}
                                          </p>
                                          <p className="mt-0.5 font-bold text-stone-900 dark:text-white truncate">
                                            {finalProfileValue(entry, key) || '—'}
                                          </p>
                                        </div>
                                      ))}
                                    </div>
                                    {profileChanges.length > 0 && (
                                      <div className="mt-2 space-y-1 text-xs">
                                        {profileChanges.map(([field, value]) => {
                                          const fieldMeta = COMPARE_FIELDS.find((fieldEntry) => fieldEntry.key === field)
                                          const oldValue = getExistingValue(entry.member, field)
                                          return (
                                            <p key={field} className="font-medium text-stone-600 dark:text-stone-300">
                                              {field === 'current_level' ? 'Educational level' : fieldMeta?.label}: <span className="font-semibold text-stone-400 line-through">{oldValue || '—'}</span> → <span className="font-black text-emerald-700 dark:text-emerald-400">{value}</span>
                                            </p>
                                          )
                                        })}
                                      </div>
                                    )}
                                  </div>

                                  {/* Attendance Section */}
                                  {finalSundayDates.length > 0 && (
                                    <div>
                                      <p className="text-[11px] font-black uppercase tracking-wider text-stone-400 dark:text-stone-500 mb-1.5">Sundays</p>
                                      <div className="grid grid-cols-2 sm:grid-cols-3 gap-1.5">
                                        {finalSundayDates.map((dateKey) => {
                                          const date = new Date(`${dateKey}T00:00:00`)
                                          const label = Number.isNaN(date.getTime()) ? dateKey : date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
                                          const value = attendanceMap[dateKey]
                                          return (
                                            <div key={dateKey} className="rounded-lg border border-stone-100 bg-stone-50 p-2 text-center dark:border-stone-800 dark:bg-stone-800/50">
                                              <p className="text-[10px] font-semibold text-stone-500 dark:text-stone-400">{label}</p>
                                              <p className={`mt-0.5 text-xs font-black ${
                                                value === ATTENDANCE_STATUS.PRESENT
                                                  ? 'text-emerald-700 dark:text-emerald-400'
                                                  : value === ATTENDANCE_STATUS.ABSENT
                                                    ? 'text-rose-700 dark:text-rose-400'
                                                    : 'text-stone-300 dark:text-stone-600'
                                              }`}>
                                                {value === ATTENDANCE_STATUS.PRESENT ? 'P' : value === ATTENDANCE_STATUS.ABSENT ? 'A' : '—'}
                                              </p>
                                            </div>
                                          )
                                        })}
                                      </div>
                                    </div>
                                  )}
                                </div>
                              )}
                            </div>
                          )
                        })}
                      </div>
                    )}
                  </>
                )}

                <div className="mt-4 flex items-center border-t border-stone-100 pt-4 dark:border-stone-800">
                  <button
                    type="button"
                    onClick={() => setReviewStep('members')}
                    className="inline-flex min-h-[40px] items-center gap-2 rounded-xl border border-stone-200 bg-white px-4 py-2 text-xs font-black text-stone-700 transition-colors hover:border-orange-300 dark:border-stone-700 dark:bg-stone-800 dark:text-stone-200"
                  >
                    <ArrowLeft className="h-4 w-4" />
                    Back to review
                  </button>
                </div>
              </div>
            ) : (
              <>
                {reviewStep === 'attendance' && (
                  <div className="mb-5 rounded-3xl border border-stone-200/90 bg-white/95 p-5 shadow-sm dark:border-stone-800 dark:bg-stone-900/95">
                    {/* Months — standard dashboard month selection, one or more months */}
                    <div>
                      <div className="flex flex-wrap items-center justify-between gap-3">
                        <div className="min-w-0">
                          <h2 className="text-base font-black text-stone-900 dark:text-white">Apply this sheet to:</h2>
                          <p className="mt-0.5 text-xs font-medium text-stone-500 dark:text-stone-400">
                            Pick one or more months. Each month keeps its own Sundays.
                          </p>
                        </div>
                        <div className="flex items-center gap-2">
                          <input
                            type="month"
                            value={monthAddDraft}
                            onChange={(event) => setMonthAddDraft(event.target.value)}
                            aria-label="Add a month"
                            className="h-9 rounded-xl border border-stone-200 bg-white px-2.5 text-xs font-bold text-stone-900 outline-none focus:border-orange-500 focus:ring-1 focus:ring-orange-500 dark:border-stone-700 dark:bg-stone-800 dark:text-white"
                          />
                          <button
                            type="button"
                            onClick={() => {
                              if (monthAddDraft) {
                                addAttendanceMonth(reviewActiveId, monthAddDraft)
                                setMonthAddDraft('')
                              }
                            }}
                            disabled={!monthAddDraft}
                            aria-label="Add month"
                            className="inline-flex min-h-[38px] items-center gap-1.5 rounded-xl bg-orange-600 px-3.5 py-1.5 text-xs font-black text-white transition-colors hover:bg-orange-700 disabled:cursor-not-allowed disabled:opacity-40 shadow-sm"
                          >
                            <CheckCircle2 className="h-4 w-4" />
                            Add month
                          </button>
                        </div>
                      </div>

                      {/* Standard dashboard month selection grid */}
                      {monthOptionsByYear.length > 0 && (
                        <div className="mt-3.5 rounded-2xl border border-stone-200/80 bg-stone-50/80 p-3.5 dark:border-stone-800 dark:bg-stone-800/40">
                          <p className="mb-2 text-[11px] font-black uppercase tracking-wider text-stone-400 dark:text-stone-500">Quick pick</p>
                          {monthOptionsByYear.map(([year, months]) => (
                            <div key={year} className="mb-3 last:mb-0">
                              <p className="mb-1.5 text-[11px] font-black uppercase tracking-wider text-stone-400 dark:text-stone-500">{year}</p>
                              <div className="grid grid-cols-3 gap-1.5 sm:grid-cols-6">
                                {months.map(({ key, label }) => {
                                  const isSelected = attendanceSettings.months.includes(key)
                                  return (
                                    <button
                                      key={key}
                                      type="button"
                                      onClick={() => (isSelected
                                        ? removeAttendanceMonth(reviewActiveId, key)
                                        : addAttendanceMonth(reviewActiveId, key))}
                                      aria-pressed={isSelected}
                                      aria-label={`${isSelected ? 'Remove' : 'Add'} ${label}`}
                                      className={`relative flex items-center justify-center gap-1.5 rounded-xl px-2.5 py-2.5 text-xs font-black transition-all ${isSelected
                                        ? 'bg-orange-600 text-white shadow-md shadow-orange-600/30'
                                        : 'bg-white text-stone-700 hover:bg-orange-50 dark:bg-stone-800 dark:text-stone-300 dark:hover:bg-stone-700/80 border border-stone-200/60 dark:border-stone-700/60'}`}
                                    >
                                      {isSelected && <Check className="h-3.5 w-3.5" />}
                                      {label}
                                    </button>
                                  )
                                })}
                              </div>
                            </div>
                          ))}
                        </div>
                      )}

                      {attendanceSettings.months.length === 0 ? (
                        <p className="mt-3.5 rounded-2xl border border-dashed border-stone-200 p-6 text-center text-xs font-medium text-stone-500 dark:border-stone-800 dark:text-stone-400">
                          No month selected yet — add a month to map its Sundays to this sheet.
                        </p>
                      ) : (
                        <div className="mt-3.5 grid grid-cols-1 gap-3 sm:grid-cols-2">
                          {attendanceSettings.months.map((monthKey) => {
                            const selectedSundays = Array.isArray(attendanceSettings.sundays?.[monthKey])
                              ? attendanceSettings.sundays[monthKey]
                              : defaultSundaysForMonth(monthKey)
                            const mappedColumns = mapAttendanceColumns({ month: monthKey, columnCount: attendanceSettings.columnCount })
                            const allSundays = getSundaysForMonth(monthKey)
                            const usableColumns = mappedColumns.filter((entry) => !entry.unused)
                            const maxColumn = usableColumns.length
                            return (
                              <div key={monthKey} className="rounded-2xl border border-stone-200/90 bg-white p-3.5 shadow-2xs dark:border-stone-800 dark:bg-stone-900">
                                <div className="flex items-center justify-between gap-2">
                                  <p className="text-xs font-black uppercase tracking-wider text-stone-900 dark:text-white">
                                    {monthKeyLabel(monthKey)}
                                  </p>
                                  <button
                                    type="button"
                                    onClick={() => removeAttendanceMonth(reviewActiveId, monthKey)}
                                    aria-label={`Remove ${monthKeyLabel(monthKey)}`}
                                    className="grid h-7 w-7 place-items-center rounded-lg text-stone-400 transition-colors hover:bg-stone-100 hover:text-stone-700 dark:hover:bg-stone-700 dark:hover:text-stone-200"
                                  >
                                    <X className="h-4 w-4" />
                                  </button>
                                </div>
                                <p className="mt-0.5 text-[11px] font-medium text-stone-500 dark:text-stone-400">
                                  {allSundays.length} Sunday{allSundays.length === 1 ? '' : 's'} · sheet covers {maxColumn} column{maxColumn === 1 ? '' : 's'}
                                </p>
                                <div className="mt-2.5 flex flex-wrap gap-x-4 gap-y-1.5">
                                  {allSundays.map((date, index) => {
                                    const dateKey = formatDateKey(date)
                                    const column = index + 1
                                    const hasColumn = column <= maxColumn
                                    const checked = selectedSundays.includes(dateKey)
                                    const dateLabel = date.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })
                                    return (
                                      <label
                                        key={dateKey}
                                        className={`flex items-center gap-1.5 text-xs font-semibold ${hasColumn ? 'text-stone-700 dark:text-stone-300' : 'text-stone-400 dark:text-stone-500'}`}
                                      >
                                        <input
                                          type="checkbox"
                                          checked={checked && hasColumn}
                                          disabled={!hasColumn}
                                          onChange={() => toggleAttendanceSunday(reviewActiveId, monthKey, dateKey)}
                                          aria-label={`Include ${dateLabel} in ${monthKeyLabel(monthKey)}`}
                                          className="h-4 w-4 accent-orange-600"
                                        />
                                        {dateLabel}
                                        {!hasColumn && <span className="text-[10px] font-medium">(no column)</span>}
                                      </label>
                                    )
                                  })}
                                </div>
                                {(() => {
                                  const unusedColumns = mappedColumns.filter((entry) => entry.unused)
                                  return unusedColumns.length > 0 ? (
                                    <p className="mt-2 text-[11px] font-medium text-stone-400 dark:text-stone-500">
                                      Column{unusedColumns.length > 1 ? 's' : ''} {unusedColumns.map((entry) => entry.column).join(', ')} — Unused (no Sunday in {monthKeyLabel(monthKey)}).
                                    </p>
                                  ) : null
                                })()}
                                {/* Apply Sundays to all action */}
                                <div className="mt-3.5 flex flex-wrap items-center gap-2.5 pt-3 border-t border-stone-100 dark:border-stone-800">
                                  <button
                                    type="button"
                                    onClick={() => {
                                      setApplySundaysToast(`Sunday date mapping active for all ${rowReviewData.length} members`)
                                      setTimeout(() => setApplySundaysToast(''), 4000)
                                    }}
                                    className="inline-flex min-h-[36px] items-center gap-1.5 rounded-xl border border-stone-200 bg-white px-3.5 py-1.5 text-xs font-black text-stone-700 transition-colors hover:border-orange-300 dark:border-stone-700 dark:bg-stone-800 dark:text-stone-200 shadow-2xs"
                                    title="Apply this month & Sunday date mapping to all members in this sheet"
                                  >
                                    <Check className="h-3.5 w-3.5 text-emerald-600 dark:text-emerald-400" />
                                    Apply Sundays to all
                                  </button>
                                  {applySundaysToast && (
                                    <span className="text-xs font-bold text-emerald-700 dark:text-emerald-400">
                                      {applySundaysToast}
                                    </span>
                                  )}
                                </div>
                              </div>
                            )
                          })}
                        </div>
                      )}
                    </div>
                  </div>
                )}

                {/* Member navigation stays at the top of the review column. */}
                {reviewRows.length === 0 ? (
                  <p className="rounded-3xl border border-dashed border-stone-200 p-8 text-center text-sm font-medium text-stone-500 dark:border-stone-800 dark:text-stone-400">
                    No readable rows were found in this sheet.
                  </p>
                ) : (
                  <div className="grid grid-cols-1 gap-5 lg:grid-cols-12">
                    {/* LEFT (58%): Scanned Sheet / Integrated Media Viewer */}
                    <div className="min-w-0 lg:col-span-7 lg:sticky lg:top-24 lg:h-[calc(100vh-220px)] lg:self-start">
                      <ReviewImagePane
                        fillHeight
                        originalSrc={reviewSheet?.dataUrl || ''}
                        enhancedSrc={reviewSheet?.preview || reviewSheet?.dataUrl || ''}
                        sourceLabel={reviewSheet?.source}
                        onOpenFullscreen={() => setViewer({ sheetId: reviewActiveId, mode: 'original' })}
                        activeLabel={activeRowData ? `Member ${safeRowIndex + 1} of ${rowReviewData.length}` : ''}
                      />
                    </div>

                    {/* RIGHT (42%): Profile Review / Attendance Review Pane */}
                    <div className="flex min-w-0 flex-col lg:col-span-5 lg:h-[calc(100vh-220px)]">
                      {/* Compact Sheet Selector Bar (Directly Above Member Navigation) */}
                      {sheets.length > 1 && (
                        <div className="mb-2 shrink-0 rounded-2xl border border-stone-200/90 bg-white/95 px-3 py-2 shadow-xs dark:border-stone-800 dark:bg-stone-900/95">
                          <div className="flex items-center justify-between gap-2">
                            <div className="relative min-w-0 flex-1">
                              <button
                                type="button"
                                onClick={() => setSheetSelectorDropdownOpen((open) => !open)}
                                aria-expanded={sheetSelectorDropdownOpen}
                                aria-haspopup="listbox"
                                aria-label={`Sheet ${sheets.findIndex(s => s.id === reviewActiveId) + 1} of ${sheets.length}: ${reviewSheet?.source || 'Attendance Sheet'}`}
                                className="flex w-full items-center justify-between gap-2 rounded-xl border border-stone-200/80 bg-stone-50 px-3 py-1.5 text-xs font-black text-stone-900 transition-colors hover:border-orange-300 hover:bg-white dark:border-stone-700 dark:bg-stone-800 dark:text-white dark:hover:bg-stone-700 shadow-2xs"
                              >
                                <div className="flex min-w-0 items-center gap-1.5 truncate">
                                  {completedSheets.has(reviewActiveId) ? (
                                    <Check className="h-3.5 w-3.5 shrink-0 text-emerald-600 dark:text-emerald-400" />
                                  ) : (
                                    <span className="h-2 w-2 shrink-0 rounded-full bg-orange-500" />
                                  )}
                                  <span className="truncate">
                                    Sheet {sheets.findIndex(s => s.id === reviewActiveId) + 1} of {sheets.length} · {reviewSheet?.source || 'Sheet'} · {completedSheets.has(reviewActiveId) ? 'Completed' : 'Reviewing'}
                                  </span>
                                </div>
                                <ChevronDown className={`h-3.5 w-3.5 shrink-0 text-stone-500 transition-transform dark:text-stone-400 ${sheetSelectorDropdownOpen ? 'rotate-180' : ''}`} />
                              </button>

                              {sheetSelectorDropdownOpen && (
                                <div
                                  role="listbox"
                                  aria-label="Sheets list"
                                  className="absolute left-0 right-0 top-full z-30 mt-1.5 max-h-60 overflow-y-auto rounded-2xl border border-stone-200 bg-white p-1.5 shadow-xl dark:border-stone-700 dark:bg-stone-900"
                                >
                                  {sheets.map((sheet, idx) => {
                                    const sheetCompleted = completedSheets.has(sheet.id)
                                    const isSelected = reviewActiveId === sheet.id
                                    const sheetStatus = resultsBySheet[sheet.id]?.status || 'pending'
                                    const sheetRows = resultsBySheet[sheet.id]?.payload?.rows?.length || 0

                                    let statusDot = '○'
                                    let statusText = 'Waiting'
                                    if (sheetCompleted) {
                                      statusDot = '✓'
                                      statusText = 'Completed'
                                    } else if (isSelected) {
                                      statusDot = '●'
                                      statusText = 'Reviewing'
                                    } else if (sheetStatus === 'ready' || sheetRows > 0) {
                                      statusDot = '○'
                                      statusText = 'AI Ready'
                                    } else if (sheetStatus === 'failed') {
                                      statusDot = '!'
                                      statusText = 'Failed'
                                    }

                                    return (
                                      <button
                                        key={sheet.id}
                                        type="button"
                                        role="option"
                                        aria-selected={isSelected}
                                        onClick={() => {
                                          setReviewActiveId(sheet.id)
                                          setReviewIndex(0)
                                          setRightPanelView('details')
                                          setSheetSelectorDropdownOpen(false)
                                        }}
                                        className={`flex w-full items-center justify-between gap-2 rounded-xl px-3 py-2 text-left text-xs font-black transition-colors ${
                                          isSelected
                                            ? 'bg-orange-50 text-orange-900 dark:bg-orange-950/40 dark:text-orange-200'
                                            : 'text-stone-700 hover:bg-stone-50 dark:text-stone-300 dark:hover:bg-stone-800'
                                        }`}
                                      >
                                        <div className="flex min-w-0 items-center gap-2">
                                          <span className={`font-mono text-[11px] ${sheetCompleted ? 'text-emerald-600 dark:text-emerald-400 font-bold' : isSelected ? 'text-orange-600 font-bold' : 'text-stone-400'}`}>
                                            {statusDot} Sheet {idx + 1}
                                          </span>
                                          <span className="truncate text-stone-900 dark:text-white">{sheet.source}</span>
                                        </div>
                                        <span className={`text-[10px] font-black uppercase tracking-wider shrink-0 ${
                                          sheetCompleted
                                            ? 'text-emerald-600 dark:text-emerald-400'
                                            : isSelected
                                            ? 'text-orange-600 dark:text-orange-400'
                                            : 'text-stone-400 dark:text-stone-500'
                                        }`}>
                                          {statusText}
                                        </span>
                                      </button>
                                    )
                                  })}
                                </div>
                              )}
                            </div>

                            <button
                              type="button"
                              onClick={() => setSheetRailExpanded((prev) => !prev)}
                              aria-label="Toggle expanded sheet manager"
                              aria-expanded={sheetRailExpanded}
                              className="grid h-8 w-8 shrink-0 place-items-center rounded-xl border border-stone-200 bg-stone-50 text-stone-600 hover:border-orange-300 hover:text-stone-900 dark:border-stone-700 dark:bg-stone-800 dark:text-stone-400 dark:hover:text-white transition-colors"
                            >
                              <Menu className="h-4 w-4" />
                            </button>
                          </div>
                        </div>
                      )}

                      <div className="mb-3 shrink-0 rounded-2xl border border-stone-200/90 bg-white/95 px-3 py-2 shadow-xs dark:border-stone-800 dark:bg-stone-900/95">
                        <div className="flex items-center justify-between gap-2">
                          <button
                            type="button"
                            onClick={() => {
                              setMemberSearchQuery('')
                              setPossibleMatchesOpen(false)
                              setReviewIndex((index) => Math.max(0, index - 1))
                              setRightPanelView('details')
                            }}
                            disabled={safeRowIndex === 0}
                            aria-label="Previous member"
                            className="inline-flex min-h-[38px] items-center gap-1 rounded-xl border border-stone-200 bg-white px-3 py-1.5 text-xs font-black text-stone-700 transition-colors hover:border-orange-300 disabled:cursor-not-allowed disabled:opacity-40 dark:border-stone-700 dark:bg-stone-800 dark:text-stone-200 shadow-2xs"
                          >
                            <ChevronLeft className="h-4 w-4" />
                            Prev
                          </button>

                          {/* Member X of Y Button — Toggles right panel between Details and Names view */}
                          <button
                            type="button"
                            onClick={() => setRightPanelView((prev) => (prev === 'names' ? 'details' : 'names'))}
                            aria-expanded={rightPanelView === 'names'}
                            aria-haspopup="listbox"
                            aria-label={`Member ${safeRowIndex + 1} of ${rowReviewData.length}, open member list`}
                            className="inline-flex items-center gap-1.5 rounded-xl border border-stone-200/80 bg-stone-50 px-3 py-1.5 text-xs font-black tabular-nums text-stone-900 transition-colors hover:border-orange-300 hover:bg-white dark:border-stone-700 dark:bg-stone-800 dark:text-white dark:hover:bg-stone-700 shadow-2xs"
                          >
                            <span role="status">Member {safeRowIndex + 1} of {rowReviewData.length}</span>
                            <ChevronDown className={`h-3.5 w-3.5 text-stone-500 transition-transform dark:text-stone-400 ${rightPanelView === 'names' ? 'rotate-180' : ''}`} />
                          </button>

                          <button
                            type="button"
                            onClick={() => {
                              setMemberSearchQuery('')
                              setPossibleMatchesOpen(false)
                              setReviewIndex((index) => Math.min(rowReviewData.length - 1, index + 1))
                              setRightPanelView('details')
                            }}
                            disabled={safeRowIndex >= rowReviewData.length - 1}
                            aria-label="Next member"
                            className="inline-flex min-h-[38px] items-center gap-1 rounded-xl border border-stone-200 bg-white px-3 py-1.5 text-xs font-black text-stone-700 transition-colors hover:border-orange-300 disabled:cursor-not-allowed disabled:opacity-40 dark:border-stone-700 dark:bg-stone-800 dark:text-stone-200 shadow-2xs"
                          >
                            Next
                            <ChevronRight className="h-4 w-4" />
                          </button>
                        </div>
                      </div>

                      <div className="min-w-0 lg:min-h-0 lg:flex-1 lg:overflow-y-auto lg:pr-1">
                        {reviewStep === 'members' && rightPanelView === 'names' ? (
                          /* INLINE MEMBER NAMES VIEW IN RIGHT PANEL */
                          <div
                            className="rounded-3xl border border-stone-200/90 bg-white/95 p-5 shadow-sm dark:border-stone-800 dark:bg-stone-900/95"
                            role="listbox"
                            aria-label="Scanned members list"
                          >
                            <div className="mb-3 flex items-center justify-between gap-2 border-b border-stone-100 dark:border-stone-800 pb-3">
                              <div>
                                <h3 className="text-sm font-black text-stone-900 dark:text-white">People on this sheet</h3>
                                <p className="text-xs font-medium text-stone-500 dark:text-stone-400">
                                  {rowReviewData.length} people extracted · Click any person to review details
                                </p>
                              </div>
                            </div>

                            {/* Search input */}
                            <div className="relative mb-3">
                              <Search className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-stone-400 dark:text-stone-500" />
                              <input
                                type="text"
                                value={memberListSearch}
                                onChange={(e) => setMemberListSearch(e.target.value)}
                                placeholder="Search people..."
                                aria-label="Search people"
                                autoFocus
                                className="w-full rounded-xl border border-stone-200 bg-stone-50 py-2 pl-9 pr-3 text-xs font-medium text-stone-900 outline-none transition-colors focus:border-orange-500 focus:bg-white dark:border-stone-700 dark:bg-stone-800 dark:text-white dark:focus:border-orange-500"
                              />
                            </div>

                            {/* Names list / grid */}
                            <div className="max-h-[calc(100vh-340px)] overflow-y-auto space-y-1.5 pr-0.5">
                              {filteredRowReviewData.length === 0 ? (
                                <p className="p-4 text-center text-xs font-medium text-stone-400 dark:text-stone-500">
                                  No people match &quot;{memberListSearch}&quot;.
                                </p>
                              ) : (
                                filteredRowReviewData.map(({ row, match, index }) => {
                                  const name = row.full_name || `Member ${index + 1}`
                                  const isSelected = index === safeRowIndex
                                  const isNew = row.memberAction === 'create-new'
                                  const statusLabel = isNew ? 'New' : match.status === 'matched' ? 'Matched' : match.status === 'possible' ? 'Possible' : 'No match'
                                  const statusColor = isNew
                                    ? 'bg-orange-100 text-orange-700 dark:bg-orange-950/60 dark:text-orange-300'
                                    : match.status === 'matched'
                                      ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300'
                                      : match.status === 'possible'
                                        ? 'bg-amber-100 text-amber-800 dark:bg-amber-950/60 dark:text-amber-300'
                                        : 'bg-rose-100 text-rose-800 dark:bg-rose-950/60 dark:text-rose-300'

                                  return (
                                    <button
                                      key={`${reviewActiveId}-${index}`}
                                      type="button"
                                      role="option"
                                      aria-label={`${index + 1}. ${name}`}
                                      aria-selected={isSelected}
                                      onClick={() => {
                                        setReviewIndex(index)
                                        setRightPanelView('details')
                                        setMemberListSearch('')
                                      }}
                                      className={`flex w-full items-center justify-between gap-2.5 rounded-xl px-3 py-2.5 text-left text-xs transition-all ${
                                        isSelected
                                          ? 'border-2 border-orange-500 bg-orange-50/80 font-black text-orange-950 dark:border-orange-500 dark:bg-orange-950/40 dark:text-orange-200 shadow-2xs'
                                          : 'border border-stone-200/70 bg-stone-50/50 text-stone-700 hover:border-orange-300 hover:bg-white dark:border-stone-800 dark:bg-stone-800/50 dark:text-stone-300 dark:hover:bg-stone-800 font-medium'
                                      }`}
                                    >
                                      <span className="min-w-0 truncate font-semibold text-stone-900 dark:text-white">
                                        <span className="text-stone-400 dark:text-stone-500 font-mono mr-1.5">{index + 1}.</span>
                                        {name}
                                      </span>
                                      <span className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-black ${statusColor}`}>
                                        {statusLabel}
                                      </span>
                                    </button>
                                  )
                                })
                              )}
                            </div>
                          </div>
                        ) : activeRowData && (
                          <div className="rounded-3xl border border-stone-200/90 bg-white/95 p-5 shadow-sm dark:border-stone-800 dark:bg-stone-900/95">
                            {/* Back to people navigation button */}
                            {reviewStep === 'members' && (
                              <div className="mb-4 pb-3 border-b border-stone-100 dark:border-stone-800 flex items-center justify-between gap-2">
                                <button
                                  type="button"
                                  onClick={() => setRightPanelView('names')}
                                  className="inline-flex items-center gap-1.5 text-xs font-black text-orange-600 dark:text-orange-400 hover:text-orange-700 dark:hover:text-orange-300 transition-colors"
                                  aria-label="Back to people"
                                >
                                  <ArrowLeft className="h-4 w-4" />
                                  <span>Back to people</span>
                                </button>
                                <span className="text-[11px] font-mono font-bold text-stone-400 dark:text-stone-500">
                                  Member {safeRowIndex + 1} of {rowReviewData.length}
                                </span>
                              </div>
                            )}

                            {/* Member identity header */}
                            <div className="flex items-start justify-between gap-3">
                              <div className="min-w-0 flex-1">
                                <div className="flex flex-wrap items-center gap-2">
                                  <h3 className="truncate text-base font-black text-stone-900 dark:text-white">
                                    {activeRowData.row.full_name || `Member ${safeRowIndex + 1}`}
                                  </h3>
                                  {activeRowData.row.memberAction === 'create-new' ? (
                                    <span className="rounded-full bg-orange-600 px-2.5 py-0.5 text-[10px] font-black text-white shadow-2xs">New member</span>
                                  ) : (
                                    <span className={`rounded-full px-2.5 py-0.5 text-[10px] font-black ${MATCH_META[activeRowData.match.status].className}`}>
                                      {MATCH_META[activeRowData.match.status].label}
                                    </span>
                                  )}
                                </div>
                                <p className="mt-1 text-xs font-medium text-stone-500 dark:text-stone-400">
                                  {activeRowData.row.memberAction === 'create-new'
                                    ? 'This row will be added as a new member. Nothing is written until you confirm at final save.'
                                    : activeRowData.match.member
                                      ? `Matched to ${activeRowData.match.member.full_name || activeRowData.match.member['Full Name'] || 'a current member'}`
                                      : activeRowData.match.status === 'possible'
                                        ? 'Possible match — check this row before saving.'
                                        : 'No existing DatSer member matches this row — add it as a new member.'}
                                </p>

                                {/* Match decision — shown on People & profile step only (ZERO matching UI in Attendance step) */}
                                {reviewStep !== 'attendance' && (
                                  <>
                                    {activeRowData.row.memberAction === 'create-new' || activeRowData.row.selectedMemberId ? (
                                      <div className="mt-3.5 rounded-2xl border border-orange-200/80 bg-orange-50/70 p-3.5 dark:border-orange-900/30 dark:bg-orange-950/20">
                                        <p className="flex items-center gap-1.5 text-xs font-black text-orange-800 dark:text-orange-200">
                                          <UserPlus className="h-4 w-4" />
                                          {activeRowData.row.memberAction === 'create-new' ? 'New member (pending)' : 'Member chosen'}
                                        </p>
                                        <p className="mt-0.5 text-xs font-medium text-orange-800/80 dark:text-orange-200/80">
                                          {activeRowData.row.memberAction === 'create-new'
                                            ? 'The reviewed profile below becomes the proposed new member. Creation happens only during final save.'
                                            : `Using: ${activeRowData.match.member?.full_name || activeRowData.match.member?.['Full Name'] || 'selected member'}`}
                                        </p>
                                        <button
                                          type="button"
                                          onClick={() => handleUseMatch(reviewActiveId, safeRowIndex)}
                                          className="mt-2.5 inline-flex min-h-[36px] items-center gap-1.5 rounded-xl border border-stone-200 bg-white px-3 py-1.5 text-xs font-black text-stone-700 transition-colors hover:border-orange-300 dark:border-stone-700 dark:bg-stone-800 dark:text-stone-200 shadow-2xs"
                                        >
                                          Use Match
                                        </button>
                                      </div>
                                    ) : activeRowData.match.status === 'possible' ? (
                                      /* Combined compact possible matches accordion */
                                      <div className="mt-3.5 rounded-2xl border border-amber-200/80 bg-amber-50/70 p-3.5 dark:border-amber-900/30 dark:bg-amber-950/20">
                                        <div className="flex flex-wrap items-center justify-between gap-2">
                                          <button
                                            type="button"
                                            onClick={() => setPossibleMatchesOpen((open) => !open)}
                                            aria-expanded={possibleMatchesOpen}
                                            className="inline-flex items-center gap-1.5 text-xs font-black text-amber-800 hover:text-amber-900 dark:text-amber-200 dark:hover:text-amber-100"
                                          >
                                            <AlertTriangle className="h-4 w-4" />
                                            <span>Possible matches · {mergedPossibleCandidates.length}</span>
                                            <ChevronDown className={`h-3.5 w-3.5 transition-transform ${possibleMatchesOpen ? 'rotate-180' : ''}`} />
                                          </button>
                                          <button
                                            type="button"
                                            onClick={() => handleAddAsNewMember(reviewActiveId, safeRowIndex)}
                                            className="inline-flex min-h-[34px] items-center gap-1.5 rounded-xl bg-orange-600 px-3 py-1 text-xs font-black text-white transition-colors hover:bg-orange-700 shadow-2xs"
                                          >
                                            <UserPlus className="h-3.5 w-3.5" />
                                            Add as New Member
                                          </button>
                                        </div>

                                        {possibleMatchesOpen && (
                                          <div className="mt-3 space-y-2 pt-2.5 border-t border-amber-200/60 dark:border-amber-900/40">
                                            <div className="relative">
                                              <Search className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-stone-400" />
                                              <input
                                                type="text"
                                                value={memberSearchQuery}
                                                onChange={(event) => setMemberSearchQuery(event.target.value)}
                                                placeholder="Search members by name or phone number..."
                                                aria-label="Search members"
                                                className="w-full rounded-xl border border-stone-200 bg-white py-1.5 pl-8 pr-3 text-xs font-medium text-stone-900 outline-none transition-colors focus:border-orange-500 dark:border-stone-700 dark:bg-stone-900 dark:text-white"
                                              />
                                            </div>

                                            <div className="space-y-1.5 max-h-48 overflow-y-auto">
                                              {mergedPossibleCandidates.map((candidate) => (
                                                <button
                                                  key={`${candidate.sourceMonthLabel || 'current'}-${candidate.member.id}`}
                                                  type="button"
                                                  onClick={() => handleChooseDifferentMember(reviewActiveId, safeRowIndex, candidate.member.id)}
                                                  className="flex w-full items-center justify-between gap-2 rounded-xl border border-amber-200 bg-white p-2.5 text-left text-xs font-semibold text-stone-700 transition-colors hover:border-amber-400 dark:border-amber-800 dark:bg-stone-800 dark:text-stone-200 shadow-2xs"
                                                >
                                                  <span className="min-w-0 truncate">{candidate.member.full_name || candidate.member['Full Name'] || 'Unnamed'}</span>
                                                  <span className="flex shrink-0 items-center gap-1.5">
                                                    {candidate.fromOtherMonth && candidate.sourceMonthLabel ? (
                                                      <span className="rounded-md bg-stone-200 px-1.5 py-0.5 text-[10px] font-bold text-stone-600 dark:bg-stone-700 dark:text-stone-300">
                                                        Found in {candidate.sourceMonthLabel.replace('_', ' ')}
                                                      </span>
                                                    ) : null}
                                                    <span className="inline-flex min-h-[30px] items-center rounded-lg bg-amber-600 px-2.5 text-[11px] font-black text-white transition-colors hover:bg-amber-700 shadow-2xs">
                                                      Use this member
                                                    </span>
                                                  </span>
                                                </button>
                                              ))}

                                              {memberSearchQuery.trim() && memberSearchResults.map((member) => (
                                                <button
                                                  key={member.id}
                                                  type="button"
                                                  onClick={() => {
                                                    handleChooseDifferentMember(reviewActiveId, safeRowIndex, member.id)
                                                    setMemberSearchQuery('')
                                                  }}
                                                  className="flex w-full items-center justify-between gap-2 rounded-xl border border-stone-200 bg-white p-2.5 text-left text-xs font-semibold text-stone-700 transition-colors hover:border-orange-300 dark:border-stone-700 dark:bg-stone-800 dark:text-stone-200 shadow-2xs"
                                                >
                                                  <span className="min-w-0 truncate">{member.full_name || member['Full Name'] || 'Unnamed'}</span>
                                                  <span className="inline-flex min-h-[30px] shrink-0 items-center rounded-lg bg-orange-600 px-2.5 text-[11px] font-black text-white transition-colors hover:bg-orange-700 shadow-2xs">
                                                    Use this member
                                                  </span>
                                                </button>
                                              ))}
                                            </div>
                                          </div>
                                        )}
                                      </div>
                                    ) : activeRowData.match.status === 'matched' && activeRowData.match.member ? (
                                      <div className="mt-3.5 rounded-2xl border border-emerald-200/80 bg-emerald-50/70 p-3.5 dark:border-emerald-900/30 dark:bg-emerald-950/20">
                                        <div className="flex flex-wrap items-center justify-between gap-2">
                                          <div>
                                            <p className="flex items-center gap-1.5 text-xs font-black text-emerald-800 dark:text-emerald-200">
                                              <Check className="h-4 w-4" />
                                              Existing member found
                                            </p>
                                            <p className="mt-0.5 text-xs font-medium text-emerald-800/80 dark:text-emerald-200/80">
                                              Matched to: {activeRowData.match.member.full_name || activeRowData.match.member['Full Name'] || 'a current member'}
                                            </p>
                                          </div>
                                          <button
                                            type="button"
                                            onClick={() => handleAddAsNewMember(reviewActiveId, safeRowIndex)}
                                            className="inline-flex min-h-[34px] items-center gap-1.5 rounded-xl bg-orange-600 px-3 py-1 text-xs font-black text-white transition-colors hover:bg-orange-700 shadow-2xs"
                                          >
                                            <UserPlus className="h-3.5 w-3.5" />
                                            Add as New Member
                                          </button>
                                        </div>
                                      </div>
                                    ) : (
                                      <div className="mt-3.5 rounded-2xl border border-rose-200/80 bg-rose-50/70 p-3.5 dark:border-rose-900/30 dark:bg-rose-950/20">
                                        <div className="flex flex-wrap items-center justify-between gap-2">
                                          <div>
                                            <p className="text-xs font-black text-rose-800 dark:text-rose-200">No existing member found</p>
                                            <p className="mt-0.5 text-xs font-medium text-rose-800/80 dark:text-rose-200/80">
                                              No sensible DatSer member matches this row. Add it as a new member — creation happens only during final save.
                                            </p>
                                          </div>
                                          <button
                                            type="button"
                                            onClick={() => handleAddAsNewMember(reviewActiveId, safeRowIndex)}
                                            className="inline-flex min-h-[34px] items-center gap-1.5 rounded-xl bg-orange-600 px-3 py-1 text-xs font-black text-white transition-colors hover:bg-orange-700 shadow-2xs"
                                          >
                                            <UserPlus className="h-3.5 w-3.5" />
                                            Add as New Member
                                          </button>
                                        </div>
                                        <div className="mt-2.5">
                                          <div className="relative">
                                            <Search className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-stone-400" />
                                            <input
                                              type="text"
                                              value={memberSearchQuery}
                                              onChange={(event) => setMemberSearchQuery(event.target.value)}
                                              placeholder="Search members by name or phone number..."
                                              aria-label="Search members"
                                              className="w-full rounded-xl border border-stone-200 bg-white py-1.5 pl-8 pr-3 text-xs font-medium text-stone-900 outline-none transition-colors focus:border-orange-500 dark:border-stone-700 dark:bg-stone-900 dark:text-white"
                                            />
                                          </div>
                                          {memberSearchQuery.trim() && memberSearchResults.length > 0 && (
                                            <div className="mt-2 space-y-1.5 max-h-40 overflow-y-auto">
                                              {memberSearchResults.map((member) => (
                                                <button
                                                  key={member.id}
                                                  type="button"
                                                  onClick={() => {
                                                    handleChooseDifferentMember(reviewActiveId, safeRowIndex, member.id)
                                                    setMemberSearchQuery('')
                                                  }}
                                                  className="flex w-full items-center justify-between gap-2 rounded-xl border border-stone-200 bg-white p-2.5 text-left text-xs font-semibold text-stone-700 transition-colors hover:border-orange-300 dark:border-stone-700 dark:bg-stone-800 dark:text-stone-200 shadow-2xs"
                                                >
                                                  <span className="min-w-0 truncate">{member.full_name || member['Full Name'] || 'Unnamed'}</span>
                                                  <span className="inline-flex min-h-[30px] shrink-0 items-center rounded-lg bg-orange-600 px-2.5 text-[11px] font-black text-white transition-colors hover:bg-orange-700 shadow-2xs">
                                                    Use this member
                                                  </span>
                                                </button>
                                              ))}
                                            </div>
                                          )}
                                        </div>
                                      </div>
                                    )}
                                  </>
                                )}
                              </div>
                              <div className="flex shrink-0 flex-col items-end gap-2">
                                <button
                                  type="button"
                                  onClick={() => setViewer({ sheetId: reviewActiveId, mode: 'original' })}
                                  aria-label="View photo"
                                  className="grid h-9 w-9 place-items-center rounded-xl border border-stone-200 bg-white text-stone-600 transition-colors hover:border-orange-300 dark:border-stone-700 dark:bg-stone-800 dark:text-stone-300 shadow-2xs"
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

                            {activeRowData.row.memberAction === 'create-new' && reviewStep !== 'attendance' && (
                              <div className="mt-4 rounded-2xl border border-orange-200/80 bg-orange-50/60 p-3.5 dark:border-orange-900/30 dark:bg-orange-950/20">
                                <p className="text-xs font-black text-orange-800 dark:text-orange-200">New member profile — prefilled from your reviewed scan values</p>
                                <div className="mt-2.5 grid grid-cols-2 gap-2 text-xs">
                                  {COMPARE_FIELDS.map(({ key, label }) => (
                                    <div key={key} className="rounded-xl border border-orange-100 bg-white p-2.5 dark:border-orange-900/40 dark:bg-stone-900/50">
                                      <p className="text-[10px] font-black uppercase tracking-wider text-stone-400">{key === 'current_level' ? 'Educational level' : label}</p>
                                      <p className="mt-0.5 truncate font-bold text-stone-900 dark:text-white">
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
                                      <p className="mt-3.5 text-xs font-black text-orange-800 dark:text-orange-200">Add this member to</p>
                                      <div className="mt-1.5 flex flex-wrap gap-3">
                                        <label className="flex items-center gap-1.5 text-xs font-semibold text-stone-700 dark:text-stone-300">
                                          <input
                                            type="radio"
                                            checked={mode === 'this-month'}
                                            onChange={() => handleNewMemberTargetChange(reviewActiveId, safeRowIndex, { mode: 'this-month' })}
                                            className="h-3.5 w-3.5 accent-orange-600"
                                          />
                                          This month only
                                        </label>
                                        <label className="flex items-center gap-1.5 text-xs font-semibold text-stone-700 dark:text-stone-300">
                                          <input
                                            type="radio"
                                            checked={mode === 'all-year'}
                                            onChange={() => handleNewMemberTargetChange(reviewActiveId, safeRowIndex, { mode: 'all-year' })}
                                            className="h-3.5 w-3.5 accent-orange-600"
                                          />
                                          All months in {year || 'this year'}
                                        </label>
                                        <label className="flex items-center gap-1.5 text-xs font-semibold text-stone-700 dark:text-stone-300">
                                          Month
                                          <input
                                            type="month"
                                            value={monthKey}
                                            onChange={(event) => handleNewMemberTargetChange(reviewActiveId, safeRowIndex, { monthKey: event.target.value })}
                                            aria-label="New member target month"
                                            className="h-8 rounded-lg border border-orange-200 bg-white px-2 text-[11px] font-bold text-stone-900 outline-none focus:border-orange-500 dark:border-stone-700 dark:bg-stone-800 dark:text-white"
                                          />
                                        </label>
                                      </div>
                                      <div className="mt-2 space-y-1 text-xs font-medium text-stone-700 dark:text-stone-300">
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
                              <p className="mt-3.5 rounded-2xl border border-stone-200 bg-stone-50 px-3.5 py-2.5 text-xs font-medium text-stone-500 dark:border-stone-700 dark:bg-stone-800/40 dark:text-stone-400">
                                Current member data could not be loaded — matching is disabled for this batch. You can still correct the scan.
                              </p>
                            )}

                            {/* Full profile details with Age & Edit support — shown on the People & profile step only */}
                            {reviewStep !== 'attendance' && (
                              <div className="mt-5">
                                <p className="text-[11px] font-black uppercase tracking-wider text-stone-400 dark:text-stone-500 mb-2">Profile</p>
                                <ul className="space-y-2.5">
                                {COMPARE_FIELDS.map(({ key, label: origLabel }) => {
                                  const label = key === 'current_level' ? 'Educational level' : origLabel
                                  const compare = activeRowData.summary.compares.find((entry) => entry.field === key)
                                  const geminiValue = activeRowData.row.originalGeminiValue?.[key] ?? activeRowData.row[key]
                                  const existingValue = getExistingValue(activeRowData.match.member, key)
                                  const decision = activeRowData.row.reviewedValues?.[key]
                                  const isEditing = editingField?.sheetId === reviewActiveId && editingField?.rowIndex === safeRowIndex && editingField?.field === key
                                  const effectiveValue = getEffectiveValue({ field: key, compare, row: activeRowData.row, member: activeRowData.match.member })
                                  const conflict = compare.state === FIELD_STATES.DIFFERENT || compare.state === FIELD_STATES.LOW_CONFIDENCE
                                  const needsChoice = conflict && !decision
                                  return (
                                    <li key={key} className="rounded-2xl border border-stone-100 bg-stone-50/70 p-3 dark:border-stone-800 dark:bg-stone-900/90">
                                      {!conflict && !decision ? (
                                        <div className="flex items-center justify-between gap-2">
                                          <p className="flex flex-wrap items-center gap-1.5 text-xs font-medium text-stone-600 dark:text-stone-300">
                                            <span className="font-black uppercase tracking-wider text-stone-400">{label}:</span>
                                            <span className="font-bold text-stone-900 dark:text-white">{effectiveValue || '—'}</span>
                                            {compare.state === FIELD_STATES.SAME && <Check className="h-3.5 w-3.5 text-emerald-600 dark:text-emerald-400" />}
                                          </p>
                                          <button
                                            type="button"
                                            onClick={() => {
                                              setEditingField({ sheetId: reviewActiveId, rowIndex: safeRowIndex, field: key })
                                              setEditDraft(effectiveValue || geminiValue || existingValue || '')
                                            }}
                                            aria-label={`Edit ${label}`}
                                            className="inline-flex items-center gap-1 rounded-lg border border-stone-200 bg-white px-2.5 py-1 text-[11px] font-black text-stone-700 hover:border-orange-300 dark:border-stone-700 dark:bg-stone-800 dark:text-stone-200 shadow-2xs transition-colors"
                                          >
                                            <Pencil className="h-3 w-3" />
                                            Edit
                                          </button>
                                        </div>
                                      ) : decision ? (
                                        <div className="flex flex-wrap items-center justify-between gap-2">
                                          <div className="flex flex-wrap items-center gap-2">
                                            <p className="text-xs font-bold text-stone-900 dark:text-white">
                                              <span className="font-black uppercase tracking-wider text-stone-400">{label}:</span> {decision.value || '—'}
                                            </p>
                                            <span className="rounded-full bg-emerald-100 px-2.5 py-0.5 text-[10px] font-black text-emerald-800 dark:bg-emerald-950/50 dark:text-emerald-300">
                                              <Check className="mr-0.5 inline h-3 w-3" />{DECISION_SOURCE_LABEL[decision.source] || decision.source}
                                            </span>
                                          </div>
                                          <div className="flex items-center gap-1">
                                            <button
                                              type="button"
                                              onClick={() => {
                                                setEditingField({ sheetId: reviewActiveId, rowIndex: safeRowIndex, field: key })
                                                setEditDraft(decision.value || '')
                                              }}
                                              aria-label={`Edit ${label}`}
                                              className="grid h-7 w-7 place-items-center rounded-lg text-stone-400 transition-colors hover:bg-stone-200/60 hover:text-stone-700 dark:hover:bg-stone-700 dark:hover:text-stone-200"
                                            >
                                              <Pencil className="h-3.5 w-3.5" />
                                            </button>
                                            <button
                                              type="button"
                                              onClick={() => handleClearDecision(reviewActiveId, safeRowIndex, key)}
                                              aria-label={`Clear ${label} decision`}
                                              className="grid h-7 w-7 place-items-center rounded-lg text-stone-400 transition-colors hover:bg-stone-200/60 hover:text-stone-700 dark:hover:bg-stone-700 dark:hover:text-stone-200"
                                            >
                                              <X className="h-4 w-4" />
                                            </button>
                                          </div>
                                        </div>
                                      ) : isEditing ? (
                                        <div className="flex gap-2">
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
                                            className="min-w-0 flex-1 rounded-xl border border-stone-200 bg-white px-3 py-1.5 text-sm font-medium text-stone-900 outline-none focus:border-orange-500 dark:border-stone-700 dark:bg-stone-900 dark:text-white"
                                          />
                                          <button
                                            type="button"
                                            onClick={handleCommitEdit}
                                            aria-label={`Confirm ${label} edit`}
                                            className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-orange-600 text-white transition-colors hover:bg-orange-700 shadow-sm"
                                          >
                                            <Check className="h-4 w-4" />
                                          </button>
                                          <button
                                            type="button"
                                            onClick={() => setEditingField(null)}
                                            aria-label={`Cancel ${label} edit`}
                                            className="grid h-9 w-9 shrink-0 place-items-center rounded-xl border border-stone-200 bg-white text-stone-600 dark:border-stone-700 dark:bg-stone-800 dark:text-stone-300"
                                          >
                                            <X className="h-4 w-4" />
                                          </button>
                                        </div>
                                      ) : (
                                        <div>
                                          <p className="text-[11px] font-black uppercase tracking-wider text-stone-400">{label}</p>
                                          <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-2">
                                            <div className="rounded-xl border border-orange-200/80 bg-orange-50/70 p-2.5 dark:border-orange-900/30 dark:bg-orange-950/20">
                                              <p className="text-[10px] font-black uppercase tracking-wider text-orange-600 dark:text-orange-300">Scan</p>
                                              <p className="truncate text-sm font-bold text-stone-900 dark:text-white">{geminiValue || '—'}</p>
                                            </div>
                                            <div className="rounded-xl border border-stone-200/80 bg-white p-2.5 dark:border-stone-700 dark:bg-stone-800">
                                              <p className="text-[10px] font-black uppercase tracking-wider text-stone-400">DatSer</p>
                                              <p className="truncate text-sm font-bold text-stone-900 dark:text-white">{existingValue || (activeRowData.match.member ? '—' : 'no member')}</p>
                                            </div>
                                          </div>
                                          {needsChoice && (
                                            <div className="mt-2.5 flex flex-wrap gap-2">
                                              <button
                                                type="button"
                                                onClick={() => handleRowDecision(reviewActiveId, safeRowIndex, key, { value: geminiValue, source: REVIEW_SOURCES.SCAN })}
                                                aria-label={`Use scan for ${label}`}
                                                className="inline-flex min-h-[38px] items-center gap-1.5 rounded-xl bg-orange-600 px-3.5 py-1.5 text-xs font-black text-white transition-colors hover:bg-orange-700 shadow-sm"
                                              >
                                                <ScanLine className="h-3.5 w-3.5" />
                                                Use Scan
                                              </button>
                                              <button
                                                type="button"
                                                onClick={() => handleRowDecision(reviewActiveId, safeRowIndex, key, { value: existingValue, source: REVIEW_SOURCES.DATSER })}
                                                disabled={!activeRowData.match.member || !existingValue}
                                                aria-label={`Keep DatSer ${label}`}
                                                className="inline-flex min-h-[38px] items-center gap-1.5 rounded-xl border border-stone-200 bg-white px-3.5 py-1.5 text-xs font-black text-stone-700 transition-colors hover:border-orange-300 disabled:cursor-not-allowed disabled:opacity-40 dark:border-stone-700 dark:bg-stone-800 dark:text-stone-200 shadow-2xs"
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
                                                className="inline-flex min-h-[38px] items-center gap-1.5 rounded-xl border border-stone-200 bg-white px-3.5 py-1.5 text-xs font-black text-stone-700 transition-colors hover:border-orange-300 dark:border-stone-700 dark:bg-stone-800 dark:text-stone-200 shadow-2xs"
                                              >
                                                <Pencil className="h-3.5 w-3.5" />
                                                Edit
                                              </button>
                                            </div>
                                          )}
                                        </div>
                                      )}
                                    </li>
                                  )
                                })}
                              </ul>
                              </div>
                            )}

                            {/* Attendance review per selected month — compact 2-column Sunday attendance grid */}
                            {reviewStep === 'attendance' && (
                              <div className="mt-5 rounded-2xl border border-stone-200/80 bg-stone-50/80 p-4 dark:border-stone-800 dark:bg-stone-900/90">
                                <p className="text-[11px] font-black uppercase tracking-wider text-stone-400 dark:text-stone-500 mb-2">Attendance</p>
                                {attendanceSettings.months.length === 0 ? (
                                  <p className="mt-2 text-xs font-medium text-stone-500 dark:text-stone-400">Add a month above to review this member&apos;s attendance.</p>
                                ) : (
                                  attendanceSettings.months.map((monthKey) => {
                                    const selectedSundays = Array.isArray(attendanceSettings.sundays?.[monthKey])
                                      ? attendanceSettings.sundays[monthKey]
                                      : defaultSundaysForMonth(monthKey)
                                    const attendanceEntries = resolveAttendanceEntries({
                                      attendance: activeRowData.row.attendance,
                                      month: monthKey,
                                      columnCount: attendanceSettings.columnCount,
                                      convention: attendanceSettings.convention
                                    }).filter((entry) => entry.dateKey && selectedSundays.includes(entry.dateKey))
                                    const hasMarks = attendanceEntries.some((entry) => Boolean(entry.rawMark))
                                    return (
                                      <div key={monthKey} className="mt-3.5 first:mt-0">
                                        <p className="text-xs font-black uppercase tracking-wider text-stone-800 dark:text-stone-200 mb-2">{monthKeyLabel(monthKey)}</p>
                                        {attendanceEntries.length === 0 || !hasMarks ? (
                                          <p className="mt-1 text-xs font-medium text-stone-500 dark:text-stone-400">
                                            No attendance marks were detected for this member. Review the Sundays below.
                                          </p>
                                        ) : null}
                                        <div className="mt-2 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2.5">
                                          {attendanceEntries.map((entry) => {
                                            const decision = activeRowData.row.reviewedAttendance?.[entry.dateKey]
                                            const final = decision?.value || entry.interpreted.status
                                            const datserValue = activeRowData.match.member
                                              ? getExistingValue(activeRowData.match.member, attendanceColumnNameForDate(entry.dateKey))
                                              : ''
                                            const sameAsDatser = Boolean(datserValue) && final === datserValue
                                            const needsReview = entry.interpreted.needsReview || (decision && decision.value === ATTENDANCE_STATUS.NEEDS_REVIEW)
                                            const date = new Date(`${entry.dateKey}T00:00:00`)
                                            const dateLabel = Number.isNaN(date.getTime())
                                              ? entry.dateKey
                                              : date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
                                            const attendanceValue = final === ATTENDANCE_STATUS.PRESENT ? true : final === ATTENDANCE_STATUS.ABSENT ? false : null
                                            const setValue = (value) => {
                                              const source = entry.interpreted.status === value && value !== ATTENDANCE_STATUS.NEEDS_REVIEW ? REVIEW_SOURCES.SCAN : REVIEW_SOURCES.EDITED
                                              handleAttendanceDecision(reviewActiveId, safeRowIndex, entry.dateKey, { value, source })
                                            }
                                            const handleChoice = (next) => {
                                              if (next === true) setValue(ATTENDANCE_STATUS.PRESENT)
                                              else if (next === false) setValue(ATTENDANCE_STATUS.ABSENT)
                                              else handleClearAttendanceDecision(reviewActiveId, safeRowIndex, entry.dateKey)
                                            }
                                            return (
                                              <div
                                                key={entry.dateKey}
                                                className={`flex flex-col justify-between gap-2.5 p-3 rounded-2xl border transition-all ${
                                                  needsReview
                                                    ? 'border-amber-300/90 bg-amber-50/40 dark:border-amber-700/60 dark:bg-amber-950/20 shadow-xs'
                                                    : 'border-stone-200/90 bg-white dark:border-stone-800 dark:bg-stone-900 shadow-xs'
                                                }`}
                                              >
                                                {/* Top Header: Sunday Label + Column ordinal on left, Dedicated Review Badge on right */}
                                                <div className="flex items-center justify-between gap-1.5">
                                                  <div className="min-w-0 flex items-center gap-1.5 truncate">
                                                    <span className="text-xs font-black uppercase text-stone-900 dark:text-white truncate">{dateLabel}</span>
                                                    {entry.column && (
                                                      <span className="text-[10px] font-mono font-bold text-stone-400 dark:text-stone-500">
                                                        ({entry.column}{entry.column === 1 ? 'st' : entry.column === 2 ? 'nd' : entry.column === 3 ? 'rd' : 'th'} col)
                                                      </span>
                                                    )}
                                                  </div>

                                                  <div className="flex items-center gap-1 shrink-0">
                                                    <span
                                                      className={`inline-flex items-center gap-0.5 rounded-md px-1.5 py-0.5 text-[10px] font-black ${
                                                        needsReview
                                                          ? 'bg-amber-100 text-amber-900 border border-amber-300/80 dark:bg-amber-950/80 dark:text-amber-300 dark:border-amber-800/80'
                                                          : 'bg-stone-100 text-stone-700 dark:bg-stone-800 dark:text-stone-300'
                                                      }`}
                                                      title={entry.interpreted.status}
                                                    >
                                                      <span aria-hidden="true">{markSymbolFor(entry.markToken)}</span>
                                                      <span>{entry.interpreted.status}</span>
                                                    </span>
                                                    {sameAsDatser && !needsReview && (
                                                      <span className="rounded-md bg-emerald-100 px-1.5 py-0.5 text-[10px] font-black text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300">
                                                        Match
                                                      </span>
                                                    )}
                                                  </div>
                                                </div>

                                                {/* Dedicated P / A / C segmented control row */}
                                                <div className="w-full pt-2 border-t border-stone-100 dark:border-stone-800/80">
                                                  <AttendanceChoice
                                                    compact
                                                    className="w-full"
                                                    value={attendanceValue}
                                                    onChange={handleChoice}
                                                    testIdPrefix={`attendance-review-${entry.dateKey}`}
                                                    ariaLabel={`Attendance for ${dateLabel}`}
                                                  />
                                                </div>
                                              </div>
                                            )
                                          })}
                                        </div>
                                      </div>
                                    )
                                  })
                                )}
                              </div>
                            )}

                            {activeRowData.row.warnings?.length > 0 && (
                              <div className="mt-4 rounded-2xl border border-amber-200 bg-amber-50/70 p-3.5 dark:border-amber-900/40 dark:bg-amber-950/20">
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
              </>
            )}

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
                {savedScans.length} saved {savedScans.length === 1 ? 'batch' : 'batches'} · each batch holds 1 or more sheets · opening never re-bills Gemini
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
              const batchTitle = batchTitleFor(scan)
              const isExpanded = expandedScanIds.has(scan.id)
              const sheetImages = Array.isArray(scan.sheet_images) ? scan.sheet_images : []
              const allSheetsSaved = sheetImages.length > 0 && sheetImages.every((image) => Boolean(image?.path))
              return (
                <li key={scan.id} className="overflow-hidden rounded-2xl border border-gray-200 bg-white dark:border-gray-700 dark:bg-gray-800">
                  <div className="flex flex-wrap items-center gap-3 p-3">
                    <div className="grid h-16 w-16 shrink-0 place-items-center overflow-hidden rounded-xl border border-gray-200 bg-gray-50 dark:border-gray-700 dark:bg-gray-900/40">
                      {thumb ? (
                        <img src={thumb} alt={`${batchTitle} thumbnail`} className="h-full w-full object-cover" />
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
                        <p className="truncate text-sm font-black text-gray-900 dark:text-white">{batchTitle}</p>
                      )}
                      <div className="mt-0.5 flex flex-wrap items-center gap-2">
                        <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-black ${sheetCount > 0 ? 'bg-orange-100 text-orange-800 dark:bg-orange-900/40 dark:text-orange-200' : 'bg-gray-100 text-gray-500 dark:bg-gray-700 dark:text-gray-300'}`}>
                          <Layers className="h-3 w-3" />
                          {sheetCount} sheet{sheetCount === 1 ? '' : 's'}
                        </span>
                        {allSheetsSaved ? (
                          <span className="inline-flex items-center gap-1 rounded-full bg-emerald-100 px-2 py-0.5 text-[11px] font-black text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300">
                            <CheckCircle2 className="h-3 w-3" />
                            ✓ {sheetCount} of {sheetCount} sheets safely saved
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-black text-amber-800 dark:bg-amber-900/35 dark:text-amber-200">
                            <AlertTriangle className="h-3 w-3" />
                            {sheetCount} sheet{sheetCount === 1 ? '' : 's'} staged
                          </span>
                        )}
                        {updatedLabel ? <span className="text-xs font-medium text-gray-500 dark:text-gray-400">saved {updatedLabel}</span> : null}
                        {tokenCount > 0 ? <span className="text-xs font-medium text-gray-500 dark:text-gray-400">{tokenCount} tokens</span> : null}
                      </div>
                    </div>
                    <div className="flex shrink-0 flex-wrap items-center gap-2">
                      <button
                        type="button"
                        onClick={() => toggleScanExpanded(scan)}
                        aria-expanded={isExpanded}
                        aria-label={isExpanded ? `Collapse ${batchTitle}` : `Expand ${batchTitle} to see all ${sheetCount} sheets`}
                        className="inline-flex min-h-[44px] items-center gap-1.5 rounded-xl border border-gray-200 bg-white px-3 py-2 text-xs font-black text-gray-700 transition-colors hover:border-orange-300 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-200"
                      >
                        {isExpanded ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
                        {isExpanded ? 'Collapse' : 'Sheets'}
                      </button>
                      <button
                        type="button"
                        onClick={() => handleOpenScan(scan)}
                        aria-label={`Open ${batchTitle}`}
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
                  </div>

                  {isExpanded && sheetImages.length > 0 && (
                    <div className="border-t border-gray-100 bg-gray-50/60 px-3 py-3 dark:border-gray-800 dark:bg-gray-900/40">
                      <p className="mb-2 text-[11px] font-black uppercase tracking-wide text-gray-500 dark:text-gray-400">All {sheetImages.length} sheets in this batch</p>
                      <ul className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
                        {sheetImages.map((image, index) => {
                          const thumbUrl = sheetThumbnails[`${scan.id}:${image.sheetId}`]
                          const sourceName = String(image.source || `Sheet ${index + 1}`)
                          return (
                            <li key={image.sheetId || index} className="flex min-w-0 items-center gap-2 rounded-xl border border-gray-200 bg-white p-2 dark:border-gray-700 dark:bg-gray-800">
                              <div className="grid h-12 w-12 shrink-0 place-items-center overflow-hidden rounded-lg border border-gray-200 bg-gray-50 dark:border-gray-700 dark:bg-gray-900/50">
                                {thumbUrl ? (
                                  <img src={thumbUrl} alt={sourceName} className="h-full w-full object-cover" />
                                ) : (
                                  <ImageIcon className="h-4 w-4 text-gray-400 dark:text-gray-500" />
                                )}
                              </div>
                              <div className="min-w-0">
                                <p className="truncate text-xs font-semibold text-gray-900 dark:text-white" title={sourceName}>{sourceName}</p>
                                <p className="text-[11px] font-medium text-emerald-600 dark:text-emerald-400">
                                  {image.path ? 'Saved' : 'Pending'}
                                </p>
                              </div>
                            </li>
                          )
                        })}
                      </ul>
                    </div>
                  )}
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
    <div className="mx-auto w-full max-w-7xl px-3 py-4 sm:px-6 sm:py-6">
      <div className="rounded-[2.5rem] border border-stone-200/90 bg-[#FAF8F5] p-4 sm:p-7 shadow-xl dark:border-stone-800 dark:bg-[#181614]">
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
        <div className="mb-6 flex flex-wrap items-center justify-between gap-4 border-b border-stone-200/80 pb-5 dark:border-stone-800">
          <div className="flex items-center gap-3.5">
            <div className="grid h-12 w-12 place-items-center rounded-2xl bg-orange-500/10 text-orange-600 dark:bg-orange-500/20 dark:text-orange-400 shadow-2xs">
              <ScanLine className="h-6 w-6" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-xl font-black text-stone-900 dark:text-white tracking-tight">Paper Scan</h1>
                {sheets.length > 0 && (
                  <span className="rounded-full bg-stone-200/80 dark:bg-stone-800 px-2.5 py-0.5 text-xs font-mono font-bold text-stone-700 dark:text-stone-300">
                    {sheets.length} {sheets.length === 1 ? 'sheet' : 'sheets'}
                  </span>
                )}
              </div>
              <p className="text-xs font-medium text-stone-500 dark:text-stone-400">Capture paper attendance sheets, enhance locally, and review before saving to DatSer</p>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={toggleSavedScans}
              aria-pressed={showSavedScans}
              className="inline-flex min-h-[40px] items-center gap-2 rounded-2xl border border-stone-200 bg-white px-4 py-2 text-xs font-bold text-stone-700 transition-colors hover:border-orange-300 dark:border-stone-700 dark:bg-stone-800 dark:text-stone-200 shadow-2xs"
            >
              <Save className="h-4 w-4 text-orange-600 dark:text-orange-400" />
              Saved scans
            </button>
            <button
              type="button"
              onClick={onBack}
              className="inline-flex min-h-[40px] items-center gap-2 rounded-2xl border border-stone-200 bg-white px-4 py-2 text-xs font-bold text-stone-700 transition-colors hover:border-orange-300 dark:border-stone-700 dark:bg-stone-800 dark:text-stone-200 shadow-2xs"
            >
              <ArrowLeft className="h-4 w-4" />
              Back to Admin
            </button>
          </div>
        </div>

        {savedScanRecord && (
          <div className="mb-5 flex items-center gap-2.5 rounded-2xl border border-emerald-200 bg-emerald-50/80 px-4 py-3 dark:border-emerald-900/40 dark:bg-emerald-950/20 shadow-2xs">
            <ShieldCheck className="h-4 w-4 shrink-0 text-emerald-700 dark:text-emerald-300" />
            <p className="text-xs font-bold text-emerald-800 dark:text-emerald-200">
              This scan is saved — reopening it will not charge Gemini again. Re-save to keep newer corrections.
            </p>
          </div>
        )}

        {/* Phase notice */}
        <div className="mb-5 flex items-center gap-2.5 rounded-2xl border border-orange-200/80 bg-orange-50/70 px-4 py-3 dark:border-orange-900/40 dark:bg-orange-950/20 shadow-2xs">
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
                  : `${extractionTargetSheetIdsRef.current?.size || sheets.length} ${(extractionTargetSheetIdsRef.current?.size || sheets.length) === 1 ? 'sheet' : 'sheets'} in this batch`}
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
                All {extractionTargetSheetIdsRef.current?.size || sheets.length} enhanced sheet{(extractionTargetSheetIdsRef.current?.size || sheets.length) === 1 ? '' : 's'} are ready. Extract will send these to the DatSer server, which forwards them to Google&apos;s Gemini API. The Gemini API key lives server-side — never in your browser.
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
          <div className="mb-4 grid grid-cols-1 gap-3">
            <div
              onDragOver={(e) => { e.preventDefault(); e.stopPropagation() }}
              onDrop={(e) => {
                e.preventDefault()
                e.stopPropagation()
                if (e.dataTransfer?.files?.length) {
                  handleFileSelected({ target: { files: e.dataTransfer.files } })
                }
              }}
              className="relative flex flex-col items-center justify-center gap-3 rounded-3xl border-2 border-dashed border-stone-300 dark:border-stone-700 bg-white/70 dark:bg-stone-900/70 p-7 sm:p-9 text-center transition-colors hover:border-orange-400 dark:hover:border-orange-500 shadow-sm"
            >
              <span className="grid h-14 w-14 place-items-center rounded-2xl bg-orange-100 text-orange-600 dark:bg-orange-950/60 dark:text-orange-400 shadow-2xs">
                <Upload className="h-7 w-7" />
              </span>
              <div>
                <h2 className="text-base font-black text-stone-900 dark:text-white">
                  Upload attendance sheets
                </h2>
                <p className="mt-1 text-xs font-medium text-stone-500 dark:text-stone-400 max-w-sm">
                  Drop multiple images here or choose files from your device. Supported: JPG, PNG, WEBP, PDF.
                </p>
              </div>
              <div className="flex flex-wrap items-center justify-center gap-2 mt-1">
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  disabled={processing}
                  className="inline-flex min-h-[42px] items-center gap-2 rounded-2xl bg-orange-600 px-5 py-2.5 text-xs font-black text-white hover:bg-orange-700 disabled:opacity-50 transition-colors shadow-2xs"
                >
                  <Upload className="h-4 w-4" />
                  Choose files
                </button>
                <button
                  type="button"
                  onClick={() => setShowCamera(true)}
                  disabled={processing}
                  className="inline-flex min-h-[42px] items-center gap-2 rounded-2xl border border-stone-200 bg-white px-5 py-2.5 text-xs font-black text-stone-700 hover:border-orange-300 dark:border-stone-700 dark:bg-stone-800 dark:text-stone-200 disabled:opacity-50 transition-colors shadow-2xs"
                >
                  <Camera className="h-4 w-4" />
                  Take a photo
                </button>
              </div>
            </div>
          </div>

          <input
            ref={fileInputRef}
            type="file"
            accept="image/*,application/pdf"
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

          {/* Grouped Notification Stack for Batch Upload / Save */}
          {sheets.length > 0 && (
            <div className="mb-4 rounded-2xl border border-stone-200 bg-white/95 p-3 shadow-xs dark:border-stone-800 dark:bg-stone-900/95">
              <button
                type="button"
                onClick={() => setGroupedNotificationExpanded((prev) => !prev)}
                aria-expanded={groupedNotificationExpanded}
                aria-label="Upload notification status"
                className="flex w-full items-center justify-between gap-3 text-left text-xs font-black text-stone-900 dark:text-white"
              >
                <div className="flex items-center gap-2">
                  {sheets.some((s) => s.saveState === 'saving') ? (
                    <Loader2 className="h-4 w-4 shrink-0 animate-spin text-orange-600 dark:text-orange-400" />
                  ) : sheets.some((s) => s.saveState === 'save_failed') ? (
                    <AlertTriangle className="h-4 w-4 shrink-0 text-red-600 dark:text-red-400" />
                  ) : (
                    <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-600 dark:text-emerald-400" />
                  )}
                  <span>
                    {sheets.some((s) => s.saveState === 'saving')
                      ? `Uploading sheets · ${sheets.filter((s) => s.saveState === 'saved').length} of ${sheets.length} saved`
                      : sheets.some((s) => s.saveState === 'save_failed')
                      ? `Uploads · ${sheets.filter((s) => s.saveState === 'saved').length} saved · ${sheets.filter((s) => s.saveState === 'save_failed').length} failed`
                      : `✓ ${sheets.length} ${sheets.length === 1 ? 'sheet' : 'sheets'} saved`}
                  </span>
                </div>
                <div className="flex items-center gap-1 text-stone-400 dark:text-stone-500">
                  <span className="text-[11px] font-bold">{groupedNotificationExpanded ? 'Collapse' : 'Details'}</span>
                  <ChevronDown className={`h-4 w-4 transition-transform ${groupedNotificationExpanded ? 'rotate-180' : ''}`} />
                </div>
              </button>

              {groupedNotificationExpanded && (
                <div className="mt-3 space-y-1.5 border-t border-stone-100 pt-2.5 dark:border-stone-800">
                  {sheets.map((sheet, index) => (
                    <div key={sheet.id} className="flex items-center justify-between gap-2 py-1 text-xs">
                      <div className="flex min-w-0 items-center gap-2">
                        <span className="font-mono text-stone-400">{index + 1}.</span>
                        <span className="truncate text-stone-800 dark:text-stone-200">{sheet.source}</span>
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        {sheet.saveState === 'saved' ? (
                          <span className="inline-flex items-center gap-1 rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-black text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300">
                            <Check className="h-3 w-3" />
                            Saved
                          </span>
                        ) : sheet.saveState === 'saving' ? (
                          <span className="inline-flex items-center gap-1 rounded-full bg-orange-100 px-2 py-0.5 text-[10px] font-black text-orange-800 dark:bg-orange-950/60 dark:text-orange-300">
                            <Loader2 className="h-3 w-3 animate-spin" />
                            Saving...
                          </span>
                        ) : sheet.saveState === 'save_failed' ? (
                          <div className="flex items-center gap-1.5">
                            <span className="rounded-full bg-red-100 px-2 py-0.5 text-[10px] font-black text-red-700 dark:bg-red-950/60 dark:text-red-300">
                              Save failed
                            </span>
                            <button
                              type="button"
                              onClick={() => handleRetrySaveSheet(sheet.id)}
                              className="rounded-md border border-red-300 bg-white px-2 py-0.5 text-[10px] font-black text-red-700 hover:bg-red-50 dark:border-red-800 dark:bg-stone-800 dark:text-red-300"
                            >
                              Retry
                            </button>
                          </div>
                        ) : (
                          <span className="text-[10px] text-stone-400">Local</span>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Staging queue */}
          {sheets.length > 0 && (
            <div className="mb-4 rounded-2xl border border-stone-200 bg-white p-4 shadow-sm dark:border-stone-800 dark:bg-stone-900">
              <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                <p className="flex items-center gap-1.5 text-xs font-black uppercase tracking-wider text-stone-500 dark:text-stone-400">
                  <Layers className="h-3.5 w-3.5" />
                  Sheets ({sheets.length})
                </p>
                <p className="text-[11px] font-medium text-stone-400 dark:text-stone-500">
                  Click a sheet to preview/enhance · Use arrows to reorder
                </p>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
                {sheets.map((sheet, index) => {
                  const isChecked = selectedBatchSheetIds.has(sheet.id)
                  return (
                    <div
                      key={sheet.id}
                      className={`relative flex flex-col rounded-2xl border-2 p-2 transition-all ${
                        sheet.id === activeSheetId
                          ? 'border-orange-500 bg-orange-50/40 dark:border-orange-500 dark:bg-orange-950/20 shadow-sm'
                          : 'border-stone-200 bg-stone-50/50 hover:border-orange-300 dark:border-stone-800 dark:bg-stone-800/60'
                      }`}
                    >
                      <div className="flex items-start gap-2 w-full">
                        <input
                          type="checkbox"
                          checked={isChecked}
                          onChange={(e) => {
                            e.stopPropagation()
                            handleToggleSelectBatchSheet(sheet.id)
                          }}
                          aria-label={`Select ${sheet.source}`}
                          className="mt-1.5 h-4 w-4 rounded accent-orange-600 cursor-pointer"
                        />
                        <button
                          type="button"
                          onClick={() => selectSheet(sheet.id)}
                          className="flex items-center gap-2.5 text-left min-w-0 flex-1"
                          aria-label={`Select sheet ${index + 1}: ${sheet.source}`}
                          aria-pressed={sheet.id === activeSheetId}
                        >
                          <img
                            src={sheet.preview || sheet.dataUrl}
                            alt={`Sheet ${index + 1} preview`}
                            className="h-16 w-16 shrink-0 rounded-xl object-cover border border-stone-200/80 dark:border-stone-700 bg-black"
                          />
                          <div className="min-w-0 flex-1">
                            <span className="block truncate text-xs font-black text-stone-900 dark:text-white">
                              <span className="text-stone-400 font-mono mr-1">{index + 1}.</span>
                              {sheet.source}
                            </span>
                            {sheet.saveState === 'saved' ? (
                              <span className="mt-1 inline-flex items-center gap-1 rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-black text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300">
                                <Check className="h-2.5 w-2.5" />
                                Saved
                              </span>
                            ) : sheet.saveState === 'saving' ? (
                              <span className="mt-1 inline-flex items-center gap-1 rounded-full bg-orange-100 px-2 py-0.5 text-[10px] font-black text-orange-800 dark:bg-orange-950/60 dark:text-orange-300">
                                <Loader2 className="h-2.5 w-2.5 animate-spin" />
                                Saving...
                              </span>
                            ) : sheet.saveState === 'save_failed' ? (
                              <span className="mt-1 inline-flex items-center rounded-full bg-red-100 px-1.5 py-0.2 text-[9px] font-black text-red-700 dark:bg-red-950/60 dark:text-red-300">
                                Save failed
                              </span>
                            ) : (
                              <span className="mt-1 inline-flex items-center gap-1 rounded-full bg-stone-100 px-2 py-0.5 text-[10px] font-black text-stone-700 dark:bg-stone-800 dark:text-stone-300">
                                Ready
                              </span>
                            )}
                          </div>
                        </button>
                      </div>

                      <div className="mt-2.5 flex items-center justify-between border-t border-stone-200/60 dark:border-stone-700/60 pt-2">
                        <div className="flex items-center gap-1">
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation()
                              handleMoveSheetUp(index)
                            }}
                            disabled={index === 0}
                            aria-label={`Move sheet ${index + 1} up`}
                            className="grid h-7 w-7 place-items-center rounded-lg border border-stone-200 bg-white text-stone-600 hover:border-orange-300 disabled:opacity-30 dark:border-stone-700 dark:bg-stone-800 dark:text-stone-300 transition-colors"
                          >
                            <ChevronUp className="h-3.5 w-3.5" />
                          </button>
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation()
                              handleMoveSheetDown(index)
                            }}
                            disabled={index === sheets.length - 1}
                            aria-label={`Move sheet ${index + 1} down`}
                            className="grid h-7 w-7 place-items-center rounded-lg border border-stone-200 bg-white text-stone-600 hover:border-orange-300 disabled:opacity-30 dark:border-stone-700 dark:bg-stone-800 dark:text-stone-300 transition-colors"
                          >
                            <ChevronDown className="h-3.5 w-3.5" />
                          </button>
                        </div>

                        <div className="flex items-center gap-1">
                          {sheet.saveState === 'save_failed' && (
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation()
                                handleRetrySaveSheet(sheet.id)
                              }}
                              className="rounded-md border border-orange-200 bg-orange-50 px-2 py-0.5 text-[10px] font-black text-orange-700 hover:bg-orange-100 dark:border-orange-800 dark:bg-stone-800 dark:text-orange-300"
                            >
                              Retry
                            </button>
                          )}
                          <button
                            type="button"
                            onClick={(event) => {
                              event.stopPropagation()
                              handleRemoveSheet(sheet.id)
                            }}
                            className="grid h-7 w-7 place-items-center rounded-lg text-rose-500 hover:bg-rose-50 hover:text-rose-700 dark:hover:bg-rose-950/40 transition-colors"
                            aria-label={`Remove sheet ${index + 1}`}
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
          )}

          {/* Preview + enhancement */}
          {activeSheet && (
            <div className="mb-4 grid grid-cols-1 gap-4 lg:grid-cols-3">
              <div className="lg:col-span-2">
                <div className="overflow-hidden rounded-2xl border border-stone-200 bg-gray-950 shadow-sm dark:border-stone-800">
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
                    className="inline-flex items-center gap-1.5 rounded-full border border-stone-200 bg-white px-3 py-1 text-xs font-bold text-stone-700 transition-colors hover:border-orange-300 dark:border-stone-700 dark:bg-stone-800 dark:text-stone-200"
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
                    className="inline-flex items-center gap-1.5 rounded-full border border-stone-200 bg-white px-3 py-1 text-xs font-bold text-stone-700 transition-colors hover:border-orange-300 dark:border-stone-700 dark:bg-stone-800 dark:text-stone-200"
                    title="Play the scanning animation"
                  >
                    <RefreshCw className="h-3.5 w-3.5" />
                    Replay scan
                  </button>
                </div>
              </div>

              <div>
                <div className="rounded-2xl border border-stone-200 bg-white p-4 shadow-sm dark:border-stone-800 dark:bg-stone-900">
                  <div className="mb-3 flex items-center justify-between gap-2">
                    <p className="flex items-center gap-1.5 text-xs font-black uppercase tracking-wider text-stone-500 dark:text-stone-400">
                      <Sparkles className="h-3.5 w-3.5" />
                      Enhancement presets
                    </p>
                    {sheets.length > 1 && (
                      <div className="flex flex-wrap items-center gap-1.5">
                        <button
                          type="button"
                          onClick={handleApplyEnhancementToAll}
                          className="inline-flex items-center gap-1 rounded-lg border border-orange-200 bg-orange-50 px-2.5 py-1 text-[11px] font-black text-orange-700 hover:bg-orange-100 dark:border-orange-800 dark:bg-orange-950/40 dark:text-orange-300 transition-colors"
                          title="Apply active enhancement to all staged sheets"
                        >
                          <Check className="h-3 w-3" />
                          Apply to all
                        </button>
                        {selectedBatchSheetIds.size > 0 && (
                          <button
                            type="button"
                            onClick={handleApplyEnhancementToSelected}
                            className="inline-flex items-center gap-1 rounded-lg border border-stone-200 bg-white px-2.5 py-1 text-[11px] font-black text-stone-700 hover:border-orange-300 dark:border-stone-700 dark:bg-stone-800 dark:text-stone-300 transition-colors"
                            title="Apply active enhancement to selected staged sheets"
                          >
                            <Check className="h-3 w-3" />
                            Apply to selected ({selectedBatchSheetIds.size})
                          </button>
                        )}
                      </div>
                    )}
                  </div>
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
                            : 'border-stone-200 bg-white text-stone-700 hover:border-orange-300 dark:border-stone-700 dark:bg-stone-800 dark:text-stone-200'
                        }`}
                      >
                        <span className="min-w-0">
                          <span className="block font-black">{preset.label}</span>
                          <span className="block text-xs font-medium text-stone-500 dark:text-stone-400">{PRESET_ICON_LABEL[preset.id]}</span>
                        </span>
                        {activeSheet.preset === preset.id && <Check className="h-4 w-4 shrink-0 text-orange-600 dark:text-orange-300" />}
                      </button>
                    ))}
                  </div>

                  {activeSheet.preset !== 'original' && activeSheet.preset !== 'auto' && (
                    <div className="mt-4 rounded-xl border border-stone-200 bg-stone-50 p-3 dark:border-stone-700 dark:bg-stone-800/50">
                      <div className="mb-2 flex items-center justify-between gap-2">
                        <label htmlFor="paper-scan-intensity" className="text-xs font-black text-stone-700 dark:text-stone-300">
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
                      <p className="mt-1 text-[11px] font-medium text-stone-500 dark:text-stone-400">
                        Blend the {PRESET_ICON_LABEL[activeSheet.preset].toLowerCase()} effect back toward the original.
                      </p>
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}

          {/* Continue / Process all sheets */}
          <div className="rounded-2xl border border-stone-200 bg-white p-4 shadow-sm dark:border-stone-800 dark:bg-stone-900">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="min-w-0">
                <p className="text-sm font-black text-stone-900 dark:text-white">
                  {sheets.length > 1 ? 'Process all sheets' : 'Ready to continue?'}
                </p>
                <p className="text-xs font-medium text-stone-500 dark:text-stone-400">
                  {sheets.length
                    ? `${sheets.length} ${sheets.length === 1 ? 'sheet' : 'sheets'} staged. Continue to prepare, then extract attendance data with AI.`
                    : 'Capture or upload a paper sheet first.'}
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                {sheets.length > 1 && (
                  <button
                    type="button"
                    onClick={() => handleProcessSingleSheet(activeSheetId)}
                    className="inline-flex min-h-[44px] items-center gap-2 rounded-2xl border border-stone-200 bg-white px-4 py-2.5 text-sm font-black text-stone-700 hover:border-orange-300 dark:border-stone-700 dark:bg-stone-800 dark:text-stone-200 transition-colors shadow-2xs"
                  >
                    <ScanLine className="h-4 w-4 text-orange-600 dark:text-orange-400" />
                    Process this sheet
                  </button>
                )}
                <button
                  type="button"
                  onClick={handleContinue}
                  disabled={!sheets.length}
                  className="inline-flex min-h-[44px] items-center gap-2 rounded-2xl bg-orange-600 px-5 py-2.5 text-sm font-black text-white transition-colors hover:bg-orange-700 disabled:cursor-not-allowed disabled:opacity-40 shadow-sm"
                >
                  <ScanLine className="h-4 w-4" />
                  {sheets.length > 1 ? 'Process all sheets (Continue)' : 'Continue'}
                </button>
              </div>
            </div>
          </div>
        </>
      )}
      </div>
    </div>
  )
}

export default PaperScanReview
