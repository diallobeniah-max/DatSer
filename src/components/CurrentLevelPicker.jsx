import React, { useEffect, useMemo, useRef, useState } from 'react'
import { BookOpen, Check, ChevronDown, Pencil, X } from 'lucide-react'

const useIsMobilePicker = () => {
  const [isMobile, setIsMobile] = useState(() => (
    typeof window !== 'undefined'
      ? window.matchMedia('(max-width: 640px)').matches
      : false
  ))

  useEffect(() => {
    if (typeof window === 'undefined') return undefined
    const query = window.matchMedia('(max-width: 640px)')
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
  const isMobile = useIsMobilePicker()
  const [isOpen, setIsOpen] = useState(false)
  const [draftLevel, setDraftLevel] = useState(value || '')
  const [dragOffset, setDragOffset] = useState(0)
  const dragStateRef = useRef({ active: false, startY: 0 })

  useEffect(() => {
    if (isOpen) setDraftLevel(value || '')
  }, [isOpen, value])

  const normalizedLevels = useMemo(() => (
    Array.from(new Set(levels.filter(Boolean)))
  ), [levels])

  const openPicker = () => {
    onOpen?.()
    setIsOpen(true)
  }

  const closePicker = () => {
    setDragOffset(0)
    setIsOpen(false)
    onClose?.()
  }

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
    if (!isMobile) return
    dragStateRef.current = {
      active: true,
      startY: event.clientY || event.touches?.[0]?.clientY || 0
    }
    event.currentTarget.setPointerCapture?.(event.pointerId)
  }

  const moveDrag = (event) => {
    if (!dragStateRef.current.active || !isMobile) return
    const nextY = event.clientY || event.touches?.[0]?.clientY || 0
    const offset = Math.max(0, nextY - dragStateRef.current.startY)
    setDragOffset(Math.min(offset, 220))
  }

  const endDrag = () => {
    if (!dragStateRef.current.active || !isMobile) return
    dragStateRef.current.active = false
    if (dragOffset > 86) {
      closePicker()
      return
    }
    setDragOffset(0)
  }

  const triggerClassName = `w-full pl-3 pr-4 py-2 text-left rounded-lg focus:outline-none focus:ring-1 bg-white dark:bg-gray-700 text-gray-900 dark:text-white transition-colors duration-200 border flex items-center justify-between ${error ? 'border-red-500 ring-1 ring-red-400' : 'border-gray-300 dark:border-gray-600 focus:ring-primary-500'}`

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

      {isOpen && !isMobile && (
        <div className="fixed inset-0 z-[130] flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm current-level-sheet-backdrop" onClick={closePicker}>
          <div
            className="current-level-desktop-panel w-[min(28rem,calc(100vw-2rem))] overflow-hidden rounded-[1.35rem] border border-white/10 bg-[#2f3030] text-white shadow-2xl"
            onClick={(event) => event.stopPropagation()}
            role="dialog"
            aria-modal="true"
            aria-label="Select Current Level"
          >
            <div className="flex justify-center pt-3 pb-2">
              <span className="h-1.5 w-14 rounded-full bg-white/25" />
            </div>
            <div className="flex items-start justify-between px-5 pb-4">
              <div>
                <h3 className="text-lg font-black">Select Current Level</h3>
                <p className="mt-1 text-sm text-white/70">Pick the member&apos;s class or stage</p>
              </div>
              <button
                type="button"
                onClick={closePicker}
                className="grid h-9 w-9 place-items-center rounded-full bg-white/10 text-white/80 transition hover:bg-white/15"
                aria-label="Close current level picker"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="border-y border-white/10 bg-[#252626] px-5 py-3 text-center text-sm font-black uppercase tracking-wide text-white">
              Level
            </div>

            <div className="max-h-[38vh] overflow-y-auto bg-[#303131] px-4 py-3 current-level-options">
              <div className="space-y-2">
                {normalizedLevels.map((level) => (
                  <button
                    key={level}
                    type="button"
                    data-testid={`${testIdPrefix}-${level.toLowerCase()}`}
                    onClick={() => setDraftLevel(level)}
                    className={`flex min-h-[46px] w-full items-center justify-between rounded-2xl px-4 text-left text-base transition ${draftLevel === level
                      ? 'bg-orange-500 text-white shadow-lg shadow-orange-950/25'
                      : 'bg-white/5 text-white/90 hover:bg-white/10'
                    }`}
                  >
                    <span>{level}</span>
                    {draftLevel === level && <Check className="h-5 w-5" />}
                  </button>
                ))}
              </div>

              <div className="mt-4 rounded-2xl border border-white/10 bg-black/15 p-3">
                <label className="flex items-center gap-2 pb-2 text-xs font-black uppercase tracking-wide text-white/60">
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
                    className="min-w-0 flex-1 rounded-xl border border-white/10 bg-black/25 px-3 py-3 text-base text-white placeholder:text-white/40 outline-none focus:ring-2 focus:ring-orange-400"
                  />
                  <button
                    type="button"
                    onClick={applyCustom}
                    disabled={!customLevelValue.trim()}
                    data-testid={`${testIdPrefix}-custom-add`}
                    className="rounded-xl bg-orange-500 px-4 text-sm font-black text-white transition hover:bg-orange-600 disabled:opacity-40"
                  >
                    Add
                  </button>
                </div>
              </div>
            </div>

            <div className="flex items-center justify-between border-t border-white/10 bg-[#2f3030] px-5 py-4">
              <button type="button" onClick={closePicker} className="rounded-2xl bg-black/25 px-6 py-3 text-sm font-black text-white/80 transition hover:bg-black/35">
                Cancel
              </button>
              <button type="button" onClick={() => commitLevel()} disabled={!draftLevel} className="rounded-2xl px-6 py-3 text-sm font-black text-white transition enabled:bg-orange-500 enabled:hover:bg-orange-600 disabled:text-white/35">
                Save
              </button>
            </div>
          </div>
        </div>
      )}

      {isOpen && isMobile && (
        <div className="fixed inset-0 z-[130] flex items-end bg-black/55 backdrop-blur-sm current-level-sheet-backdrop" onClick={closePicker}>
          <div
            className="current-level-sheet w-full overflow-hidden rounded-t-[1.6rem] border border-white/10 bg-[#2f3030] text-white shadow-2xl"
            style={{ transform: dragOffset ? `translate3d(0, ${dragOffset}px, 0)` : undefined }}
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
              <span className="h-1.5 w-14 rounded-full bg-white/25" />
            </button>
            <div className="flex items-start justify-between px-6 pb-4">
              <div>
                <h3 className="text-xl font-black">Select Current Level</h3>
                <p className="mt-1 text-sm text-white/70">Pick the member&apos;s class or stage</p>
              </div>
              <button
                type="button"
                onClick={closePicker}
                className="grid h-10 w-10 place-items-center rounded-full bg-white/10 text-white/80 transition hover:bg-white/15"
                aria-label="Close current level picker"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="border-y border-white/10 bg-[#252626] px-6 py-3 text-center text-sm font-black uppercase tracking-wide text-white">
              Level
            </div>

            <div className="max-h-[42vh] overflow-y-auto bg-[#303131] px-4 py-3 current-level-options">
              <div className="space-y-2">
                {normalizedLevels.map((level) => (
                  <button
                    key={level}
                    type="button"
                    data-testid={`${testIdPrefix}-${level.toLowerCase()}`}
                    onClick={() => setDraftLevel(level)}
                    className={`flex min-h-[52px] w-full items-center justify-between rounded-2xl px-4 text-left text-lg transition ${draftLevel === level
                      ? 'bg-orange-500 text-white shadow-lg shadow-orange-950/25'
                      : 'bg-white/5 text-white/90 hover:bg-white/10'
                    }`}
                  >
                    <span>{level}</span>
                    {draftLevel === level && <Check className="h-5 w-5" />}
                  </button>
                ))}
              </div>

              <div className="mt-4 rounded-2xl border border-white/10 bg-black/15 p-3">
                <label className="flex items-center gap-2 pb-2 text-xs font-black uppercase tracking-wide text-white/60">
                  <Pencil className="h-3.5 w-3.5" />
                  Custom level
                </label>
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={customLevelValue}
                    onChange={(event) => onCustomLevelChange?.(event.target.value)}
                    placeholder="Type level"
                    data-testid={`${testIdPrefix}-custom-input`}
                    className="min-w-0 flex-1 rounded-xl border border-white/10 bg-black/25 px-3 py-3 text-base text-white placeholder:text-white/40 outline-none focus:ring-2 focus:ring-orange-400"
                  />
                  <button
                    type="button"
                    onClick={applyCustom}
                    disabled={!customLevelValue.trim()}
                    data-testid={`${testIdPrefix}-custom-add`}
                    className="rounded-xl bg-orange-500 px-4 text-sm font-black text-white transition hover:bg-orange-600 disabled:opacity-40"
                  >
                    Add
                  </button>
                </div>
              </div>
            </div>

            <div className="flex items-center justify-between border-t border-white/10 bg-[#2f3030] px-6 py-4" style={{ paddingBottom: 'max(16px, env(safe-area-inset-bottom, 16px))' }}>
              <button
                type="button"
                onClick={closePicker}
                className="rounded-2xl bg-black/25 px-6 py-3 text-base font-black text-white/80 transition hover:bg-black/35"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => commitLevel()}
                disabled={!draftLevel}
                className="rounded-2xl px-6 py-3 text-base font-black text-white transition enabled:bg-orange-500 enabled:hover:bg-orange-600 disabled:text-white/35"
              >
                Save
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

export default CurrentLevelPicker
