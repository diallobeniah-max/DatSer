import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { BookOpen, Check, ChevronDown, Pencil, X } from 'lucide-react'

const useIsMobilePicker = () => {
  const [isMobile, setIsMobile] = useState(() => (
    typeof window !== 'undefined'
      ? window.matchMedia('(max-width: 1024px)').matches
      : false
  ))

  useEffect(() => {
    if (typeof window === 'undefined') return undefined
    const query = window.matchMedia('(max-width: 1024px)')
    const update = () => setIsMobile(query.matches)
    update()
    query.addEventListener?.('change', update)
    return () => query.removeEventListener?.('change', update)
  }, [])

  return isMobile
}

const CurrentLevelPicker = ({
  value = '',
  levels = [],
  onChange,
  error = false,
  testIdPrefix = 'member-form-level',
  customLevelValue = '',
  onCustomLevelChange,
  onCustomLevelApply,
  onOpen,
  onClose
}) => {
  const isSheetViewport = useIsMobilePicker()
  const [isOpen, setIsOpen] = useState(false)
  const [draftLevel, setDraftLevel] = useState(value || '')
  const [dragOffset, setDragOffset] = useState(0)
  const dragStateRef = useRef({ active: false, startY: 0 })

  const normalizedLevels = useMemo(() => (
    Array.from(new Set(levels.filter(Boolean)))
  ), [levels])

  useEffect(() => {
    if (isOpen) setDraftLevel(value || '')
  }, [isOpen, value])

  const openPicker = () => {
    onOpen?.()
    setIsOpen(true)
  }

  const closePicker = useCallback(() => {
    setDragOffset(0)
    setIsOpen(false)
    onClose?.()
  }, [onClose])

  useEffect(() => {
    if (!isOpen || typeof document === 'undefined') return undefined

    const previousOverflow = document.body.style.overflow
    const handleKeyDown = (event) => {
      if (event.key === 'Escape') closePicker()
    }

    document.body.style.overflow = 'hidden'
    window.addEventListener('keydown', handleKeyDown)

    return () => {
      document.body.style.overflow = previousOverflow
      window.removeEventListener('keydown', handleKeyDown)
    }
  }, [closePicker, isOpen])

  const commitLevel = (nextLevel = draftLevel) => {
    if (!nextLevel) return
    onChange?.(nextLevel)
    closePicker()
  }

  const applyCustom = () => {
    const next = customLevelValue.trim().toUpperCase()
    if (!next) return
    onCustomLevelApply?.()
    onChange?.(next)
    closePicker()
  }

  const startDrag = (event) => {
    if (!isSheetViewport) return
    dragStateRef.current = {
      active: true,
      startY: event.clientY || event.touches?.[0]?.clientY || 0
    }
    event.currentTarget.setPointerCapture?.(event.pointerId)
  }

  const moveDrag = (event) => {
    if (!dragStateRef.current.active || !isSheetViewport) return
    const nextY = event.clientY || event.touches?.[0]?.clientY || 0
    const offset = Math.max(0, nextY - dragStateRef.current.startY)
    setDragOffset(Math.min(offset, 220))
  }

  const endDrag = () => {
    if (!dragStateRef.current.active || !isSheetViewport) return
    dragStateRef.current.active = false
    if (dragOffset > 86) {
      closePicker()
      return
    }
    setDragOffset(0)
  }

  const triggerClassName = `w-full pl-3 pr-4 py-2 text-left rounded-lg focus:outline-none focus:ring-1 bg-white dark:bg-gray-700 text-gray-900 dark:text-white transition-colors duration-200 border flex items-center justify-between ${error ? 'border-red-500 ring-1 ring-red-400' : 'border-gray-300 dark:border-gray-600 focus:ring-primary-500'}`
  const optionClassName = (level) => `flex min-h-[44px] w-full items-center justify-between rounded-xl px-3 text-left text-[16px] transition ${draftLevel === level
    ? 'border border-orange-200 bg-orange-100 font-bold text-orange-700 shadow-sm transition-none dark:border-orange-400/25 dark:bg-orange-500/15 dark:text-orange-300'
    : 'text-gray-700 hover:bg-orange-50 dark:text-gray-300 dark:hover:bg-orange-500/10'
  }`

  const picker = isOpen && typeof document !== 'undefined' ? createPortal(
    <div
      className={`fixed inset-0 z-[1000010] bg-black/70 backdrop-blur-md current-level-sheet-backdrop ${isSheetViewport ? 'flex items-end' : 'flex items-center justify-center p-4'}`}
      style={{ zIndex: 1000010 }}
      onClick={closePicker}
    >
      <div
        className={`picker-surface current-level-sheet overflow-hidden border border-gray-200 bg-white text-gray-900 shadow-2xl dark:border-gray-700/70 dark:bg-[#2F3030] dark:text-gray-100 ${isSheetViewport ? 'w-full rounded-t-2xl' : 'w-[min(340px,calc(100vw-2rem))] rounded-xl current-level-desktop-panel'}`}
        style={isSheetViewport && dragOffset ? { zIndex: 1000011, transform: `translate3d(0, ${dragOffset}px, 0)` } : { zIndex: 1000011 }}
        onClick={(event) => event.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label="Select Current Level"
      >
        {isSheetViewport && (
          <button
            type="button"
            className="mobile-sheet-drag-zone flex w-full touch-none justify-center pt-3 pb-1 flex-shrink-0 bg-white dark:bg-[#2F3030]"
            onPointerDown={startDrag}
            onPointerMove={moveDrag}
            onPointerUp={endDrag}
            onPointerCancel={endDrag}
            aria-label="Drag down to close current level picker"
          >
            <span className="h-1.5 w-10 rounded-full bg-gray-300 dark:bg-gray-600" />
          </button>
        )}

        <div className="flex items-start justify-between gap-3 border-b border-gray-200 px-4 py-3 dark:border-gray-800/60">
          <div>
            <h3 className="text-[16px] font-semibold leading-tight text-gray-900 dark:text-gray-100">Select Current Level</h3>
            <p className="mt-0.5 text-xs text-gray-500 dark:text-gray-400">Pick the member&apos;s class or stage</p>
          </div>
          <button
            type="button"
            onClick={closePicker}
            className="date-picker-close-button"
            aria-label="Close current level picker"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="picker-section-header border-b border-gray-100 bg-gray-50 px-2 py-2 text-center text-[11px] font-bold uppercase tracking-wide text-gray-500 dark:border-gray-800/60 dark:bg-[#252626] dark:text-gray-300">
          Level
        </div>

        <div className={`current-level-options overflow-y-auto bg-white p-2 dark:bg-[#151515] ${isSheetViewport ? 'max-h-[42vh]' : 'max-h-[260px]'}`}>
          <div className="space-y-1">
            {normalizedLevels.map((level) => (
              <button
                key={level}
                type="button"
                data-testid={`${testIdPrefix}-${level.toLowerCase()}`}
                onClick={() => setDraftLevel(level)}
                className={optionClassName(level)}
              >
                <span>{level}</span>
                {draftLevel === level && <Check className="h-5 w-5" />}
              </button>
            ))}
          </div>

          <div className="mt-3 rounded-xl border border-gray-200 bg-gray-50 p-3 dark:border-white/10 dark:bg-white/5">
            <label className="flex items-center gap-2 pb-2 text-[11px] font-bold uppercase tracking-wide text-gray-500 dark:text-gray-400">
              <Pencil className="h-3.5 w-3.5" />
              Custom level
            </label>
            <div className="flex gap-2">
              <input
                type="text"
                value={customLevelValue}
                onChange={(event) => onCustomLevelChange?.(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') {
                    event.preventDefault()
                    applyCustom()
                  }
                }}
                placeholder="Type level"
                data-testid={`${testIdPrefix}-custom-input`}
                className="min-w-0 flex-1 rounded-xl border border-gray-200 bg-white px-3 py-2.5 text-[16px] text-gray-900 placeholder:text-gray-400 outline-none focus:ring-2 focus:ring-orange-400 dark:border-white/10 dark:bg-[#202121] dark:text-white dark:placeholder:text-white/40"
              />
              <button
                type="button"
                onClick={applyCustom}
                disabled={!customLevelValue.trim()}
                data-testid={`${testIdPrefix}-custom-add`}
                className="rounded-xl bg-orange-600 px-4 text-sm font-semibold text-white transition hover:bg-orange-700 disabled:opacity-40"
              >
                Add
              </button>
            </div>
          </div>
        </div>

        <div
          className="flex items-center justify-between border-t border-gray-100 bg-gray-50/50 px-6 py-4 dark:border-gray-800/60 dark:bg-[#1a1a1c]"
          style={isSheetViewport ? { paddingBottom: 'max(16px, env(safe-area-inset-bottom, 16px))' } : undefined}
        >
          <button
            type="button"
            onClick={closePicker}
            className="rounded-xl bg-gray-200/50 px-4 py-2 text-[17px] font-medium text-gray-600 transition hover:text-gray-900 dark:bg-gray-800/50 dark:text-gray-400 dark:hover:text-gray-100"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => commitLevel()}
            disabled={!draftLevel}
            className="rounded-xl px-8 py-2 text-[17px] font-semibold text-white transition enabled:bg-orange-600 enabled:shadow-sm enabled:shadow-black/20 enabled:hover:bg-orange-700 disabled:cursor-not-allowed disabled:bg-gray-500/40 disabled:text-white disabled:opacity-70 dark:disabled:bg-gray-700/70"
          >
            Save
          </button>
        </div>
      </div>
    </div>,
    document.body
  ) : null

  return (
    <div className="relative">
      <button
        type="button"
        onClick={openPicker}
        data-testid={`${testIdPrefix}-toggle`}
        className={triggerClassName}
      >
        <div className="flex items-center">
          <BookOpen className="w-4 h-4 text-gray-500 dark:text-gray-400 mr-2" />
          <span className={!value ? 'text-gray-500 dark:text-gray-400' : ''}>
            {value || 'Select level'}
          </span>
        </div>
        <ChevronDown className={`w-4 h-4 text-gray-500 dark:text-gray-400 transition-transform duration-200 ${isOpen ? 'rotate-180' : ''}`} />
      </button>

      {picker}
    </div>
  )
}

export default CurrentLevelPicker
