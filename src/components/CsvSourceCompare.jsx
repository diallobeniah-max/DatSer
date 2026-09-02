import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  ChevronLeft, ChevronRight, Image as ImageIcon, Maximize2, Minus,
  Move, Plus, RotateCcw, X, Columns, LayoutGrid, LayoutTemplate, MousePointer
} from 'lucide-react'

const MIN_ZOOM = 0.5
const MAX_ZOOM = 4
const clamp = (value, min, max) => Math.min(max, Math.max(min, value))
const distance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y)
const midpoint = (a, b) => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 })
const pointerPosition = (event) => ({
  x: Number.isFinite(event.clientX) ? event.clientX : 0,
  y: Number.isFinite(event.clientY) ? event.clientY : 0,
})
const scheduleFrame = (callback) => (
  typeof requestAnimationFrame === 'function' ? requestAnimationFrame(callback) : setTimeout(callback, 0)
)
const cancelFrame = (frame) => {
  if (typeof cancelAnimationFrame === 'function') cancelAnimationFrame(frame)
  else clearTimeout(frame)
}

const localSource = (image) => {
  if (typeof image === 'string') return { url: image, revoke: false }
  if (image?.previewUrl) return { url: image.previewUrl, revoke: false }
  if (image && !image.path && typeof URL !== 'undefined' && URL.createObjectURL) return { url: URL.createObjectURL(image), revoke: true }
  return { url: '', revoke: false }
}

export default function CsvSourceCompare({
  sheets,
  sheetImages,
  activeSheet,
  onSheetChange,
  onClose,
  resolveSourceUrl,
  onNextSheet,
  onPrevSheet,
  batchContext,
  children
}) {
  const availableSheets = useMemo(() => Array.from(new Set([...(sheets || []), ...Object.keys(sheetImages || {})])), [sheetImages, sheets])
  const selectedSheet = availableSheets.includes(activeSheet) ? activeSheet : availableSheets[0]
  const images = sheetImages?.[selectedSheet] || []
  const [imageIndex, setImageIndex] = useState(0)
  const [view, setView] = useState({ zoom: 1, pan: { x: 0, y: 0 } })
  const [sourceUrl, setSourceUrl] = useState('')
  const [sourceError, setSourceError] = useState('')
  const [splitRatio, setSplitRatio] = useState('data-focus') // 'data-focus' (30/70), 'balanced' (40/60), 'image-focus' (50/50)

  const viewportRef = useRef(null)
  const pointersRef = useRef(new Map())
  const gestureRef = useRef(null)
  const viewBySheetRef = useRef({})
  const viewRef = useRef(view)
  const frameRef = useRef(null)
  const pendingViewRef = useRef(null)

  const sheetHeaderRef = useRef(null)
  const imagePaginationRef = useRef(null)
  const lastImageWheelTimeRef = useRef(0)
  const lastSheetWheelTimeRef = useRef(0)

  const image = images[imageIndex]
  const sheetViewKey = `${selectedSheet || 'sheet'}:${imageIndex}`

  const commitView = useCallback((nextView, { immediate = false } = {}) => {
    const bounded = { zoom: clamp(nextView.zoom, MIN_ZOOM, MAX_ZOOM), pan: nextView.pan }
    viewRef.current = bounded
    viewBySheetRef.current[sheetViewKey] = bounded
    if (immediate) {
      if (frameRef.current) cancelFrame(frameRef.current)
      frameRef.current = null
      setView(bounded)
      return
    }
    pendingViewRef.current = bounded
    if (!frameRef.current) {
      frameRef.current = scheduleFrame(() => {
        frameRef.current = null
        setView(pendingViewRef.current)
      })
    }
  }, [sheetViewKey])

  useEffect(() => () => { if (frameRef.current) cancelFrame(frameRef.current) }, [])
  useEffect(() => { setImageIndex(0) }, [selectedSheet])
  useEffect(() => { if (imageIndex >= images.length) setImageIndex(Math.max(0, images.length - 1)) }, [imageIndex, images.length])
  useEffect(() => {
    const restored = viewBySheetRef.current[sheetViewKey] || { zoom: 1, pan: { x: 0, y: 0 } }
    viewRef.current = restored
    setView(restored)
  }, [sheetViewKey])

  useEffect(() => {
    let cancelled = false
    const resolved = localSource(image)
    setSourceError('')
    if (resolved.url) {
      setSourceUrl(resolved.url)
      return () => { if (resolved.revoke) URL.revokeObjectURL(resolved.url) }
    }
    setSourceUrl('')
    if (!image || !resolveSourceUrl) return undefined
    resolveSourceUrl(image)
      .then((url) => { if (!cancelled) setSourceUrl(url || '') })
      .catch(() => { if (!cancelled) setSourceError('Could not load this private source image. Retry from Saved Imports if it has expired.') })
    return () => { cancelled = true }
  }, [image, resolveSourceUrl])

  const boundedPan = useCallback((pan, zoom = viewRef.current.zoom) => {
    const bounds = viewportRef.current?.getBoundingClientRect()
    const maxX = Math.max(0, (bounds?.width || 0) * (zoom - 1) / 2)
    const maxY = Math.max(0, (bounds?.height || 0) * (zoom - 1) / 2)
    return { x: clamp(pan.x, -maxX, maxX), y: clamp(pan.y, -maxY, maxY) }
  }, [])

  const zoomAt = useCallback((nextZoom, point, { immediate = false } = {}) => {
    const current = viewRef.current
    const zoom = clamp(nextZoom, MIN_ZOOM, MAX_ZOOM)
    const bounds = viewportRef.current?.getBoundingClientRect()
    const origin = point && bounds ? { x: point.x - bounds.left - bounds.width / 2, y: point.y - bounds.top - bounds.height / 2 } : { x: 0, y: 0 }
    const pan = boundedPan({
      x: current.pan.x + origin.x * (current.zoom - zoom),
      y: current.pan.y + origin.y * (current.zoom - zoom),
    }, zoom)
    commitView({ zoom, pan }, { immediate })
  }, [boundedPan, commitView])

  const resetView = useCallback(() => commitView({ zoom: 1, pan: { x: 0, y: 0 } }, { immediate: true }), [commitView])
  const onPointerDown = useCallback((event) => {
    if (!sourceUrl) return
    event.currentTarget.setPointerCapture?.(event.pointerId)
    pointersRef.current.set(event.pointerId, pointerPosition(event))
    const pointers = [...pointersRef.current.values()]
    if (pointers.length === 1) gestureRef.current = { type: 'pan', start: pointers[0], startPan: viewRef.current.pan }
    if (pointers.length === 2) gestureRef.current = { type: 'pinch', startDistance: distance(pointers[0], pointers[1]), startZoom: viewRef.current.zoom, startMidpoint: midpoint(pointers[0], pointers[1]), startPan: viewRef.current.pan }
  }, [sourceUrl])
  const onPointerMove = useCallback((event) => {
    if (!pointersRef.current.has(event.pointerId)) return
    pointersRef.current.set(event.pointerId, pointerPosition(event))
    const pointers = [...pointersRef.current.values()]
    const gesture = gestureRef.current
    if (!gesture) return
    if (pointers.length >= 2 && gesture.type === 'pinch') {
      const nextMidpoint = midpoint(pointers[0], pointers[1])
      const nextZoom = clamp(gesture.startZoom * (distance(pointers[0], pointers[1]) / Math.max(1, gesture.startDistance)), MIN_ZOOM, MAX_ZOOM)
      const bounds = viewportRef.current?.getBoundingClientRect()
      const center = bounds ? { x: bounds.left + bounds.width / 2, y: bounds.top + bounds.height / 2 } : { x: 0, y: 0 }
      const startOffset = { x: gesture.startMidpoint.x - center.x, y: gesture.startMidpoint.y - center.y }
      const midpointDelta = { x: nextMidpoint.x - gesture.startMidpoint.x, y: nextMidpoint.y - gesture.startMidpoint.y }
      commitView({ zoom: nextZoom, pan: boundedPan({ x: gesture.startPan.x + midpointDelta.x + startOffset.x * (gesture.startZoom - nextZoom), y: gesture.startPan.y + midpointDelta.y + startOffset.y * (gesture.startZoom - nextZoom) }, nextZoom) })
      return
    }
    if (pointers.length === 1 && gesture.type === 'pan') {
      const point = pointers[0]
      commitView({ zoom: viewRef.current.zoom, pan: boundedPan({ x: gesture.startPan.x + point.x - gesture.start.x, y: gesture.startPan.y + point.y - gesture.start.y }) })
    }
  }, [boundedPan, commitView])
  const stopPointer = useCallback((event) => {
    if (event.currentTarget.hasPointerCapture?.(event.pointerId)) event.currentTarget.releasePointerCapture?.(event.pointerId)
    pointersRef.current.delete(event.pointerId)
    const pointers = [...pointersRef.current.values()]
    if (pointers.length === 1) gestureRef.current = { type: 'pan', start: pointers[0], startPan: viewRef.current.pan }
    else if (!pointers.length) gestureRef.current = null
  }, [])
  const onViewportWheel = useCallback((event) => {
    const viewport = viewportRef.current
    // Zoom is scoped to the image itself. This leaves the review pane and the
    // sheet-navigation header free to retain their own scroll behavior.
    if (!sourceUrl || !viewport || !viewport.contains(event.target)) return
    event.preventDefault()
    const normalized = event.deltaMode === 1 ? event.deltaY * 16 : event.deltaY
    const adjustment = clamp(normalized, -120, 120) * -0.0015
    zoomAt(viewRef.current.zoom * Math.exp(adjustment), { x: event.clientX, y: event.clientY })
  }, [sourceUrl, zoomAt])

  useEffect(() => {
    const viewport = viewportRef.current
    if (!viewport) return undefined
    viewport.addEventListener('wheel', onViewportWheel, { passive: false })
    return () => viewport.removeEventListener('wheel', onViewportWheel)
  }, [onViewportWheel])

  // ─── Mouse wheel sheet switcher over the sheet header only ─────────────────
  useEffect(() => {
    const headerElement = sheetHeaderRef.current
    if (!headerElement || availableSheets.length <= 1) return undefined

    const handleWheelSheet = (event) => {
      const delta = event.deltaY || event.deltaX
      if (Math.abs(delta) < 15) return

      const now = Date.now()
      if (now - lastSheetWheelTimeRef.current < 160) {
        event.preventDefault()
        return
      }

      event.preventDefault()
      lastSheetWheelTimeRef.current = now

      if (delta > 0) {
        // Scroll down: Next sheet
        if (typeof onNextSheet === 'function') {
          onNextSheet()
        } else if (availableSheets.length > 1) {
          const currentIndex = availableSheets.indexOf(selectedSheet)
          if (currentIndex >= 0 && currentIndex < availableSheets.length - 1) {
            onSheetChange?.(availableSheets[currentIndex + 1])
          }
        }
      } else if (delta < 0) {
        // Scroll up: Previous sheet
        if (typeof onPrevSheet === 'function') {
          onPrevSheet()
        } else if (availableSheets.length > 1) {
          const currentIndex = availableSheets.indexOf(selectedSheet)
          if (currentIndex > 0) {
            onSheetChange?.(availableSheets[currentIndex - 1])
          }
        }
      }
    }

    headerElement.addEventListener('wheel', handleWheelSheet, { passive: false })
    return () => headerElement.removeEventListener('wheel', handleWheelSheet)
  }, [availableSheets, selectedSheet, onSheetChange, onNextSheet, onPrevSheet])

  // ─── Mouse wheel image switcher over image pagination footer ──────────────
  useEffect(() => {
    const footerElement = imagePaginationRef.current
    if (!footerElement || images.length <= 1) return undefined

    const handleWheelImage = (event) => {
      const delta = event.deltaY || event.deltaX
      if (Math.abs(delta) < 15) return

      const now = Date.now()
      if (now - lastImageWheelTimeRef.current < 160) {
        event.preventDefault()
        return
      }

      event.preventDefault()
      lastImageWheelTimeRef.current = now

      if (delta > 0) {
        setImageIndex((value) => Math.min(images.length - 1, value + 1))
      } else if (delta < 0) {
        setImageIndex((value) => Math.max(0, value - 1))
      }
    }

    footerElement.addEventListener('wheel', handleWheelImage, { passive: false })
    return () => footerElement.removeEventListener('wheel', handleWheelImage)
  }, [images.length])

  // ─── Resizable Left/Right Split Pane ──────────────────────────────────────
  const [imagePaneWidth, setImagePaneWidth] = useState(22) // compact default: source stays visible without crowding review
  const [isResizingPane, setIsResizingPane] = useState(false)
  const containerRef = useRef(null)
  const reviewContainerRef = useRef(null)

  const beginPaneResize = useCallback((event) => {
    event.preventDefault()
    setIsResizingPane(true)

    const startX = event.clientX
    const container = containerRef.current
    if (!container) return
    const containerRect = container.getBoundingClientRect()
    const startWidthPx = (imagePaneWidth / 100) * containerRect.width

    const onPointerMove = (moveEvent) => {
      const deltaX = moveEvent.clientX - startX
      const nextWidthPx = startWidthPx + deltaX
      const nextPercent = clamp((nextWidthPx / containerRect.width) * 100, 14, 45)
      setImagePaneWidth(Math.round(nextPercent))
    }

    const onPointerUp = () => {
      setIsResizingPane(false)
      window.removeEventListener('pointermove', onPointerMove)
      window.removeEventListener('pointerup', onPointerUp)
    }

    window.addEventListener('pointermove', onPointerMove)
    window.addEventListener('pointerup', onPointerUp)
  }, [imagePaneWidth])

  return (
    <div
      ref={containerRef}
      className={`fixed inset-0 z-[180] flex min-h-0 flex-col bg-[#08110d] lg:relative lg:inset-auto lg:z-auto lg:h-[calc(100dvh-5rem)] lg:flex-row lg:overflow-hidden lg:rounded-[1.75rem] lg:bg-emerald-950/20 lg:p-2 transition-all ${
        isResizingPane ? 'select-none cursor-col-resize' : ''
      }`}
    >
      {/* Left side: Source Image Section */}
      <section
        style={{ width: undefined }}
        className="flex min-h-0 flex-[0_0_38dvh] flex-col overflow-hidden bg-[#0b1511] text-white lg:sticky lg:top-2 lg:h-full lg:flex-[0_0_auto] lg:rounded-[1.4rem] lg:border lg:border-emerald-900/70 shadow-xl lg:w-[var(--left-pane-width)] shrink-0"
        aria-label="CSV source image comparison"
      >
        <div style={{ display: 'none' }}>
          {/* CSS variable for responsive width */}
        </div>
        <style>{`
          @media (min-width: 1024px) {
            section[aria-label="CSV source image comparison"] {
              width: ${imagePaneWidth}% !important;
              min-width: 200px;
              max-width: 45%;
            }
          }
        `}</style>

        {/* Header with sheet info & navigation */}
        <header ref={sheetHeaderRef} className="flex flex-col border-b border-emerald-900/60 bg-[#0c1813] px-3 py-2 select-none" title="Hover and scroll up or down to switch sheets">
          <div className="flex items-center justify-between gap-2">
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-1.5">
                <p className="text-[10px] font-black uppercase tracking-[0.16em] text-emerald-400">Compare source</p>
                  <span className="hidden sm:inline-flex items-center gap-0.5 rounded bg-emerald-950/80 px-1.5 py-0.2 text-[9px] font-bold text-emerald-300/90" title="Hover this header and scroll to switch sheets. Scroll the image to zoom.">
                  <MousePointer className="h-2.5 w-2.5 inline" /> Scroll to switch
                </span>
              </div>
              <p className="truncate text-xs font-black text-gray-100 flex items-center gap-1.5 mt-0.5">
                {selectedSheet || 'No sheet selected'}
                {batchContext && (
                  <span className="text-[10px] font-normal text-gray-400">
                    ({batchContext.index + 1} of {batchContext.total})
                  </span>
                )}
              </p>
            </div>

            <button
              type="button"
              onClick={onClose}
              className="rounded-lg p-1 text-gray-400 hover:bg-white/10 hover:text-white transition-colors shrink-0"
              aria-label="Close source comparison"
              title="Close side compare view"
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          {/* Sheet tabs bar with horizontal scroll & mouse-wheel navigation */}
          {availableSheets.length > 1 && (
            <div className="mt-1.5 flex gap-1 overflow-x-auto pt-0.5 pb-0.5 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden" aria-label="Source image sheets">
              {availableSheets.map((sheet) => (
                <button
                  key={sheet}
                  type="button"
                  onClick={() => onSheetChange?.(sheet)}
                  className={`shrink-0 rounded-lg px-2 py-0.5 text-[11px] font-bold transition-colors ${
                    sheet === selectedSheet
                      ? 'bg-emerald-500 text-white shadow-sm'
                      : 'bg-white/5 text-gray-300 hover:bg-white/10'
                  }`}
                >
                  {sheet}
                </button>
              ))}
            </div>
          )}
        </header>

        {/* Viewport for image pan/zoom */}
        <div
          ref={viewportRef}
          data-source-image-viewport
          className="relative min-h-0 flex-1 cursor-grab touch-none select-none overflow-hidden bg-[radial-gradient(circle_at_center,rgba(16,185,129,0.09),transparent_60%)] active:cursor-grabbing"
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={stopPointer}
          onPointerCancel={stopPointer}
        >
          {sourceUrl ? (
            <img
              src={sourceUrl}
              alt={`Source for ${selectedSheet}`}
              draggable="false"
              className="pointer-events-none h-full w-full object-contain p-2 will-change-transform"
              style={{ transform: `translate3d(${view.pan.x}px, ${view.pan.y}px, 0) scale(${view.zoom})` }}
            />
          ) : (
            <div className="flex h-full flex-col items-center justify-center p-6 text-center">
              <ImageIcon className="h-8 w-8 text-emerald-700" />
              <p className="mt-2 text-xs font-black">{sourceError || (image ? 'Loading source image…' : 'No source image for this sheet')}</p>
              <p className="mt-1 max-w-xs text-[10px] text-gray-400">
                {image ? 'Only the current source image is loaded.' : 'Attach an image to this sheet, then retry the history save.'}
              </p>
            </div>
          )}
          {sourceUrl && (
            <div className="pointer-events-none absolute left-2.5 top-2.5 inline-flex items-center gap-1 rounded-full bg-black/65 px-2 py-0.5 text-[9px] font-bold text-gray-200 backdrop-blur-xs">
              <Move className="h-2.5 w-2.5" /> Wheel to zoom · drag to pan
            </div>
          )}
        </div>

        {/* Footer with image pager & zoom controls */}
        <footer className="flex flex-wrap items-center justify-between gap-1.5 border-t border-emerald-900/60 bg-[#0c1813] p-2 text-xs">
          <div ref={imagePaginationRef} className="flex items-center gap-0.5" title="Hover & scroll wheel to switch images">
            <button
              type="button"
              onClick={() => setImageIndex((value) => Math.max(0, value - 1))}
              disabled={imageIndex === 0}
              className="rounded p-1 hover:bg-white/10 disabled:opacity-30 transition-colors"
              aria-label="Previous source image"
            >
              <ChevronLeft className="h-3.5 w-3.5" />
            </button>
            <span className="min-w-10 text-center text-[10px] font-bold text-gray-300">
              {images.length ? `${imageIndex + 1} / ${images.length}` : '0 / 0'}
            </span>
            <button
              type="button"
              onClick={() => setImageIndex((value) => Math.min(images.length - 1, value + 1))}
              disabled={!images.length || imageIndex >= images.length - 1}
              className="rounded p-1 hover:bg-white/10 disabled:opacity-30 transition-colors"
              aria-label="Next source image"
            >
              <ChevronRight className="h-3.5 w-3.5" />
            </button>
          </div>

          <div className="flex items-center gap-0.5 rounded-lg bg-white/5 p-0.5">
            <button
              type="button"
              onClick={() => zoomAt(viewRef.current.zoom - 0.25, null, { immediate: true })}
              className="rounded p-1 hover:bg-white/10 transition-colors"
              aria-label="Zoom out"
              title="Zoom out"
            >
              <Minus className="h-3 w-3" />
            </button>
            <span className="w-8 text-center text-[10px] font-black">
              {Math.round(view.zoom * 100)}%
            </span>
            <button
              type="button"
              onClick={() => zoomAt(viewRef.current.zoom + 0.25, null, { immediate: true })}
              className="rounded p-1 hover:bg-white/10 transition-colors"
              aria-label="Zoom in"
              title="Zoom in"
            >
              <Plus className="h-3 w-3" />
            </button>
            <button
              type="button"
              onClick={resetView}
              className="rounded p-1 hover:bg-white/10 transition-colors"
              aria-label="Fit image"
              title="Fit to 100%"
            >
              <Maximize2 className="h-3 w-3" />
            </button>
            <button
              type="button"
              onClick={resetView}
              className="rounded p-1 hover:bg-white/10 transition-colors"
              aria-label="Reset image view"
              title="Reset pan and zoom"
            >
              <RotateCcw className="h-3 w-3" />
            </button>
          </div>
        </footer>
      </section>

      {/* Slim, elegant resizer divider line between image pane and review pane */}
      <div
        role="separator"
        aria-orientation="vertical"
        aria-label="Drag to resize source image and review panels"
        tabIndex={0}
        onPointerDown={beginPaneResize}
        onKeyDown={(event) => {
          if (event.key === 'ArrowLeft') setImagePaneWidth((w) => Math.max(14, w - 2))
          if (event.key === 'ArrowRight') setImagePaneWidth((w) => Math.min(45, w + 2))
        }}
        className="group hidden lg:flex w-2.5 shrink-0 cursor-col-resize touch-none items-center justify-center select-none px-0.5"
        title="Drag left/right to resize panels"
      >
        <div
          className={`h-full w-1 rounded-full transition-all ${
            isResizingPane
              ? 'bg-emerald-400 w-1.5 shadow-[0_0_8px_rgba(52,211,153,0.5)]'
              : 'bg-emerald-900/50 group-hover:bg-emerald-400 group-hover:w-1.5'
          }`}
        />
      </div>

      {/* Review area (right side) */}
      <div
        ref={reviewContainerRef}
        data-review-vertical-scroll-owner
        className="min-h-0 flex-1 overflow-y-auto overscroll-contain bg-white p-2.5 dark:bg-[#111a16] lg:rounded-[1.4rem] lg:border lg:border-emerald-900/50 shadow-sm"
      >
        {children}
      </div>
    </div>
  )
}
