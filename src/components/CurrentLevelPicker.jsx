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
  const optionClassName = (level) => `flex min-h-[50px] w-full items-center justify-between rounded-2xl px-4 text-left text-base transition ${draftLevel === level
    ? 'bg-orange-600 text-white shadow-lg shadow-orange-600/20'
    : 'bg-gray-100 text-gray-800 hover:bg-gray-200 dark:bg-white/5 dark:text-gray-100 dark:hover:bg-white/10'
  }`

  const picker = isOpen && typeof document !== 'undefined' ? createPortal(
    <div
      className={`fixed inset-0 z-[1000000] bg-black/60 backdrop-blur-md current-level-sheet-backdrop ${isSheetViewport ? 'flex items-end' : 'flex items-center justify-center p-4'}`}
      onClick={closePicker}
    >
      <div
        className={`picker-surface current-level-sheet overflow-hidden border border-gray-200 bg-white text-gray-900 shadow-2xl dark:border-gray-700/70 dark:bg-gray-900 dark:text-gray-100 ${isSheetViewport ? 'w-full rounded-t-[1.6rem]' : 'w-[min(28rem,calc(100vw-2rem))] rounded-[1.35rem] current-level-desktop-panel'}`}
        style={isSheetViewport && dragOffset ? { transform: `translate3d(0, ${dragOffset}px, 0)` } : undefined}
        onClick={(event) => event.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label="Select Current Level"
      >
        <button
          type="button"
          className="flex w-full touch-none justify-center pt-3 pb-2"
          onPointerDown={startDrag}
          onPointerMove={moveDrag}
          onPointerUp={endDrag}
          onPointerCancel={endDrag}
          aria-label="Drag down to close current level picker"
        >
          <span className="h-1.5 w-14 rounded-full bg-gray-300 dark:bg-gray-600" />
        </button>

        <div className={`flex items-start justify-between gap-3 ${isSheetViewport ? 'px-6 pb-4' : 'px-5 pb-4'}`}>
          <div>
            <h3 className={`${isSheetViewport ? 'text-xl' : 'text-lg'} font-black tracking-tight`}>Select Current Level</h3>
            <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">Pick the member&apos;s class or stage</p>
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

        <div className={`border-y border-gray-100 bg-gray-50 py-3 text-center text-sm font-black uppercase tracking-wide text-gray-500 dark:border-gray-800/70 dark:bg-gray-800/80 dark:text-gray-300 ${isSheetViewport ? 'px-6' : 'px-5'}`}>
          Level
        </div>

        <div className={`current-level-options overflow-y-auto bg-white px-4 py-3 dark:bg-gray-950 ${isSheetViewport ? 'max-h-[42vh]' : 'max-h-[38vh]'}`}>
          <div className="space-y-2">
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

          <div className="mt-4 rounded-2xl border border-gray-200 bg-gray-50 p-3 dark:border-white/10 dark:bg-white/5">
            <label className="flex items-center gap-2 pb-2 text-xs font-black uppercase tracking-wide text-gray-500 dark:text-gray-400">
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
                className="min-w-0 flex-1 rounded-xl border border-gray-200 bg-white px-3 py-3 text-base text-gray-900 placeholder:text-gray-400 outline-none focus:ring-2 focus:ring-orange-400 dark:border-white/10 dark:bg-gray-950 dark:text-white dark:placeholder:text-white/40"
              />
              <button
                type="button"
                onClick={applyCustom}
                disabled={!customLevelValue.trim()}
                data-testid={`${testIdPrefix}-custom-add`}
                className="rounded-xl bg-orange-600 px-4 text-sm font-black text-white transition hover:bg-orange-700 disabled:opacity-40"
              >
                Add
              </button>
            </div>
          </div>
        </div>

        <div
          className={`flex items-center justify-between border-t border-gray-100 bg-gray-50/80 px-6 py-4 dark:border-gray-800/70 dark:bg-gray-900 ${isSheetViewport ? '' : 'px-5'}`}
          style={isSheetViewport ? { paddingBottom: 'max(16px, env(safe-area-inset-bottom, 16px))' } : undefined}
        >
          <button
            type="button"
            onClick={closePicker}
            className="rounded-2xl bg-gray-200/80 px-6 py-3 text-base font-black text-gray-700 transition hover:bg-gray-300 dark:bg-white/10 dark:text-gray-200 dark:hover:bg-white/15"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => commitLevel()}
            disabled={!draftLevel}
            className="rounded-2xl px-6 py-3 text-base font-black text-white transition enabled:bg-orange-600 enabled:hover:bg-orange-700 disabled:text-gray-400 dark:disabled:text-white/35"
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
