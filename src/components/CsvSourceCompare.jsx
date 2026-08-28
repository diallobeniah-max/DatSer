import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ChevronLeft, ChevronRight, Image as ImageIcon, Maximize2, Minus, Move, Plus, RotateCcw, X } from 'lucide-react'

const clamp = (value, min, max) => Math.min(max, Math.max(min, value))

const resolveSource = (image) => {
  if (typeof image === 'string') return { url: image, revoke: false }
  if (image?.previewUrl) return { url: image.previewUrl, revoke: false }
  if (image && typeof URL !== 'undefined' && URL.createObjectURL) return { url: URL.createObjectURL(image), revoke: true }
  return { url: '', revoke: false }
}

export default function CsvSourceCompare({ sheets, sheetImages, activeSheet, onSheetChange, onClose, children }) {
  const availableSheets = useMemo(() => Array.from(new Set([...(sheets || []), ...Object.keys(sheetImages || {})])), [sheetImages, sheets])
  const selectedSheet = availableSheets.includes(activeSheet) ? activeSheet : availableSheets[0]
  const images = sheetImages?.[selectedSheet] || []
  const [imageIndex, setImageIndex] = useState(0)
  const [zoom, setZoom] = useState(1)
  const [pan, setPan] = useState({ x: 0, y: 0 })
  const dragRef = useRef(null)
  const viewportRef = useRef(null)

  const source = useMemo(() => resolveSource(images[imageIndex]), [images, imageIndex])
  useEffect(() => () => { if (source.revoke) URL.revokeObjectURL(source.url) }, [source])
  useEffect(() => { setImageIndex(0); setZoom(1); setPan({ x: 0, y: 0 }) }, [selectedSheet])
  useEffect(() => { if (imageIndex >= images.length) setImageIndex(Math.max(0, images.length - 1)) }, [imageIndex, images.length])

  const resetView = useCallback(() => { setZoom(1); setPan({ x: 0, y: 0 }) }, [])
  const setBoundedZoom = useCallback((next) => {
    setZoom((current) => clamp(typeof next === 'function' ? next(current) : next, 0.5, 4))
    setPan({ x: 0, y: 0 })
  }, [])
  const onPointerDown = useCallback((event) => {
    if (!source.url) return
    event.preventDefault()
    event.currentTarget.setPointerCapture?.(event.pointerId)
    dragRef.current = { x: event.clientX, y: event.clientY, panX: pan.x, panY: pan.y }
  }, [pan, source.url])
  const onPointerMove = useCallback((event) => {
    if (!dragRef.current) return
    const bounds = viewportRef.current?.getBoundingClientRect()
    const maxX = Math.max(0, (bounds?.width || 0) * (zoom - 1) / 2)
    const maxY = Math.max(0, (bounds?.height || 0) * (zoom - 1) / 2)
    setPan({
      x: clamp(dragRef.current.panX + event.clientX - dragRef.current.x, -maxX, maxX),
      y: clamp(dragRef.current.panY + event.clientY - dragRef.current.y, -maxY, maxY),
    })
  }, [zoom])
  const stopPan = useCallback(() => { dragRef.current = null }, [])

  return (
    <div className="fixed inset-0 z-[180] bg-[#08110d] lg:relative lg:inset-auto lg:z-auto lg:grid lg:grid-cols-[minmax(320px,42fr)_minmax(0,58fr)] lg:gap-4 lg:rounded-[1.75rem] lg:bg-emerald-950/20 lg:p-3">
      <section className="flex h-[100dvh] min-h-0 flex-col overflow-hidden bg-[#0b1511] text-white lg:sticky lg:top-3 lg:h-[calc(100dvh-8rem)] lg:rounded-[1.4rem] lg:border lg:border-emerald-900/70" aria-label="CSV source image comparison">
        <header className="flex items-start justify-between gap-3 border-b border-emerald-900/60 px-4 py-3">
          <div className="min-w-0"><p className="text-[10px] font-black uppercase tracking-[0.16em] text-emerald-400">Compare source</p><p className="truncate text-sm font-black">{selectedSheet || 'No sheet selected'}</p></div>
          <button type="button" onClick={onClose} className="rounded-xl p-2 text-gray-300 hover:bg-white/10 hover:text-white" aria-label="Close source comparison"><X className="h-5 w-5" /></button>
        </header>

        {availableSheets.length > 1 && <div className="flex gap-1.5 overflow-x-auto border-b border-emerald-900/50 p-2" aria-label="Source image sheets">{availableSheets.map((sheet) => <button key={sheet} type="button" onClick={() => onSheetChange(sheet)} className={`shrink-0 rounded-lg px-3 py-1.5 text-xs font-bold ${sheet === selectedSheet ? 'bg-emerald-500 text-white' : 'bg-white/5 text-gray-300 hover:bg-white/10'}`}>{sheet}</button>)}</div>}

        <div ref={viewportRef} className="relative min-h-0 flex-1 cursor-grab touch-none select-none overflow-hidden bg-[radial-gradient(circle_at_center,rgba(16,185,129,0.09),transparent_60%)] active:cursor-grabbing" onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={stopPan} onPointerCancel={stopPan}>
          {source.url ? <img src={source.url} alt={`Source for ${selectedSheet}`} draggable="false" className="pointer-events-none h-full w-full object-contain p-3 will-change-transform" style={{ transform: `translate3d(${pan.x}px, ${pan.y}px, 0) scale(${zoom})` }} /> : <div className="flex h-full flex-col items-center justify-center p-8 text-center"><ImageIcon className="h-9 w-9 text-emerald-700"/><p className="mt-3 text-sm font-black">No source image for this sheet</p><p className="mt-1 max-w-xs text-xs text-gray-400">Attach an image to this sheet, then retry the history save. Member and attendance writes will not run again.</p></div>}
          {source.url && <div className="pointer-events-none absolute left-3 top-3 inline-flex items-center gap-1 rounded-full bg-black/65 px-2 py-1 text-[10px] font-bold text-gray-200"><Move className="h-3 w-3"/>Drag to pan</div>}
        </div>

        <footer className="flex flex-wrap items-center justify-between gap-2 border-t border-emerald-900/60 p-3">
          <div className="flex items-center gap-1">
            <button type="button" onClick={() => setImageIndex((value) => Math.max(0, value - 1))} disabled={imageIndex === 0} className="rounded-lg p-2 hover:bg-white/10 disabled:opacity-30" aria-label="Previous source image"><ChevronLeft className="h-4 w-4"/></button>
            <span className="min-w-14 text-center text-[11px] font-bold text-gray-300">{images.length ? `${imageIndex + 1} / ${images.length}` : '0 / 0'}</span>
            <button type="button" onClick={() => setImageIndex((value) => Math.min(images.length - 1, value + 1))} disabled={!images.length || imageIndex >= images.length - 1} className="rounded-lg p-2 hover:bg-white/10 disabled:opacity-30" aria-label="Next source image"><ChevronRight className="h-4 w-4"/></button>
          </div>
          <div className="flex items-center gap-1 rounded-xl bg-white/5 p-1">
            <button type="button" onClick={() => setBoundedZoom((value) => value - 0.25)} className="rounded-lg p-2 hover:bg-white/10" aria-label="Zoom out"><Minus className="h-4 w-4"/></button>
            <span className="w-12 text-center text-[11px] font-black">{Math.round(zoom * 100)}%</span>
            <button type="button" onClick={() => setBoundedZoom((value) => value + 0.25)} className="rounded-lg p-2 hover:bg-white/10" aria-label="Zoom in"><Plus className="h-4 w-4"/></button>
            <button type="button" onClick={() => setBoundedZoom(1)} className="rounded-lg p-2 hover:bg-white/10" aria-label="Fit image"><Maximize2 className="h-4 w-4"/></button>
            <button type="button" onClick={resetView} className="rounded-lg p-2 hover:bg-white/10" aria-label="Reset image view"><RotateCcw className="h-4 w-4"/></button>
          </div>
        </footer>
      </section>
      <div className="hidden min-w-0 lg:block">{children}</div>
    </div>
  )
}
