import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Check, Calendar, X, Plus, Zap } from 'lucide-react'
import { useApp } from '../context/AppContext'
import useHapticFeedback from '../hooks/useHapticFeedback'

const MonthPickerPopup = ({
    isOpen,
    onClose,
    anchorRef,
    onCreateMonth,
    onSelectSunday,
    autoEnabled = null,
    onToggleAuto = null,
    toggleLabel = 'Auto',
    calendarMode = null,
    onCalendarModeChange = null,
    calendarModeSaving = false,
    manualModeDisabled = false,
    disabledReason = '',
    manualStatus = ''
}) => {
    const { monthlyTables, currentTable, setCurrentTable, isCollaborator, selectedAttendanceDate, setAndSaveAttendanceDate, getSundaysInMonth, ownerStickySundays, preferencesHydrated, preferencesLoading, preferencesError, retryPreferenceHydration, isOnline, shouldUseOfflineData } = useApp()
    const { selection } = useHapticFeedback()
    const popupRef = useRef(null)
    const [previewTable, setPreviewTable] = useState(currentTable)
    const [draftSundayDate, setDraftSundayDate] = useState(null)
    const showAutoToggle = typeof autoEnabled === 'boolean' && typeof onToggleAuto === 'function'
    const showCalendarModeControl = (calendarMode === 'auto' || calendarMode === 'manual') && typeof onCalendarModeChange === 'function'
    const [pendingCalendarMode, setPendingCalendarMode] = useState(calendarMode === 'manual' ? 'manual' : 'auto')
    const [isSavingSelection, setIsSavingSelection] = useState(false)
    // Synchronous ref guard: React state updates do not apply until the next
    // render, so two rapid clicks in the same tick would both see the state
    // as not-yet-saving. This ref flips instantly to prevent a duplicate save.
    const selectionSaveInFlightRef = useRef(false)
    const isCalendarSaving = calendarModeSaving || isSavingSelection

    // Local defaults and downloaded month metadata are enough to make a
    // calendar selection. Remote preference hydration is a background refresh,
    // never a gate that disables Manual mode.
    const isOfflineActive = isOnline === false || shouldUseOfflineData === true
    const calendarSettingsRefreshing = !preferencesHydrated && !isOfflineActive
    const selectionDisabled = manualModeDisabled || isSavingSelection || (showCalendarModeControl
        ? pendingCalendarMode !== 'manual'
        : (showAutoToggle ? autoEnabled : false))

    // Confirmed/current vs preview/manual table. Inside a Manual calendar the
    // orange highlight and checkmark must track the temporarily previewed
    // month (previewTable); the persisted/current month is only used for Auto
    // and legacy flows so a preview never looks bound to the confirmed table.
    const isManualPreview = showCalendarModeControl && pendingCalendarMode === 'manual'
    const activeDisplayTable = isManualPreview ? (previewTable || currentTable) : currentTable

    const handleClose = useCallback(() => {
        selection()
        onClose()
    }, [selection, onClose])

    useEffect(() => {
        if (isOpen) {
            setPreviewTable(currentTable)
            setPendingCalendarMode(calendarMode === 'manual' ? 'manual' : 'auto')
            setDraftSundayDate(null)
        }
    }, [isOpen, currentTable, calendarMode])

    const handleCalendarModeChange = async (nextMode) => {
        if (manualModeDisabled || isCalendarSaving) return
        selection()

        // Choosing Manual only prepares the picker. It is persisted exactly
        // once after the user chooses a Sunday.
        if (nextMode === 'manual') {
            setPendingCalendarMode('manual')
            return
        }

        if (calendarMode !== 'manual') {
            setPendingCalendarMode('auto')
            return
        }

        if (selectionSaveInFlightRef.current) return
        selectionSaveInFlightRef.current = true
        setIsSavingSelection(true)
        try {
            const saved = await onCalendarModeChange('auto')
            if (saved !== false) {
                setPendingCalendarMode('auto')
                onClose()
            }
        } finally {
            selectionSaveInFlightRef.current = false
            setIsSavingSelection(false)
        }
    }

    // Close on outside click
    useEffect(() => {
        const handleClickOutside = (e) => {
            if (popupRef.current && !popupRef.current.contains(e.target) &&
                anchorRef?.current && !anchorRef.current.contains(e.target)) {
                handleClose()
            }
        }
        if (isOpen) {
            document.addEventListener('mousedown', handleClickOutside)
            return () => document.removeEventListener('mousedown', handleClickOutside)
        }
    }, [isOpen, anchorRef, handleClose])

    // Close on escape
    useEffect(() => {
        const handleEsc = (e) => {
            if (e.key === 'Escape') handleClose()
        }
        if (isOpen) {
            document.addEventListener('keydown', handleEsc)
            return () => document.removeEventListener('keydown', handleEsc)
        }
    }, [isOpen, handleClose])

    const handleSelectMonth = (table) => {
        if (selectionDisabled) return
        selection()
        setPreviewTable(table)
        if (!onSelectSunday) {
            setCurrentTable(table, { persistPreference: true })
        }
    }

    const previewSundays = useMemo(() => {
        if (!previewTable) return []
        const [monthName, yearStr] = previewTable.split('_')
        const yearNum = parseInt(yearStr, 10)
        if (!monthName || Number.isNaN(yearNum)) return []
        const toDateKey = (date) => {
            const y = date.getFullYear()
            const m = String(date.getMonth() + 1).padStart(2, '0')
            const d = String(date.getDate()).padStart(2, '0')
            return `${y}-${m}-${d}`
        }
        const stickyInMonth = isCollaborator
            ? ownerStickySundays
                .filter((dateStr) => {
                    const [y, m] = dateStr.split('-').map(Number)
                    return y === yearNum && m === (new Date(`${monthName} 1, ${yearNum}`)).getMonth() + 1
                })
                .filter((dateStr) => {
                    const [y, m, d] = dateStr.split('-').map(Number)
                    const dateObj = new Date(y, m - 1, d)
                    return !Number.isNaN(dateObj.getTime()) && dateObj.getDay() === 0
                })
                .sort()
            : []
        if (stickyInMonth.length > 0) return stickyInMonth
        return getSundaysInMonth(monthName, yearNum).map(toDateKey)
    }, [previewTable, getSundaysInMonth, isCollaborator, ownerStickySundays])

    const selectedDateKey = selectedAttendanceDate
        ? `${selectedAttendanceDate.getFullYear()}-${String(selectedAttendanceDate.getMonth() + 1).padStart(2, '0')}-${String(selectedAttendanceDate.getDate()).padStart(2, '0')}`
        : null

    // Manual selection is deliberately a draft. Keep the currently applied
    // Sunday if it belongs to the previewed month; otherwise offer that
    // month's first valid Sunday. Nothing here mutates the active calendar.
    useEffect(() => {
        if (!isOpen || !isManualPreview) return
        setDraftSundayDate((previous) => {
            if (previous && previewSundays.includes(previous)) return previous
            if (selectedDateKey && previewSundays.includes(selectedDateKey)) return selectedDateKey
            return previewSundays[0] || null
        })
    }, [isOpen, isManualPreview, previewSundays, selectedDateKey])

    const handleSelectSunday = async (dateStr) => {
        if (selectionDisabled) return
        const [y, m, d] = dateStr.split('-').map(Number)
        if (Number.isNaN(y) || Number.isNaN(m) || Number.isNaN(d)) return
        selection()
        const selectedDate = new Date(y, m - 1, d)

        // In the explicit Manual workflow, choosing a Sunday only edits the
        // draft. The current attendance month/date stay applied until Apply.
        if (isManualPreview) {
            setDraftSundayDate(dateStr)
            return
        }

        if (onSelectSunday) {
            if (selectionSaveInFlightRef.current) return
            selectionSaveInFlightRef.current = true
            setIsSavingSelection(true)
            try {
                const saved = await onSelectSunday({
                    table: previewTable || currentTable,
                    date: selectedDate,
                    dateStr
                })
                if (saved !== false) onClose()
            } finally {
                selectionSaveInFlightRef.current = false
                setIsSavingSelection(false)
            }
            return
        }
        if (previewTable && previewTable !== currentTable) {
            setCurrentTable(previewTable, { persistPreference: true })
        }
        setAndSaveAttendanceDate(selectedDate)
        onClose()
    }

    const handleApplyManualSelection = async () => {
        if (selectionDisabled || !previewTable || !draftSundayDate || selectionSaveInFlightRef.current) return
        const [y, m, d] = draftSundayDate.split('-').map(Number)
        if (Number.isNaN(y) || Number.isNaN(m) || Number.isNaN(d)) return

        selection()
        selectionSaveInFlightRef.current = true
        setIsSavingSelection(true)
        try {
            const selectedDate = new Date(y, m - 1, d)
            if (onSelectSunday) {
                const saved = await onSelectSunday({
                    table: previewTable,
                    date: selectedDate,
                    dateStr: draftSundayDate
                })
                if (saved !== false) onClose()
                return
            }

            if (previewTable !== currentTable) {
                setCurrentTable(previewTable, { persistPreference: true })
            }
            setAndSaveAttendanceDate(selectedDate, previewTable)
            onClose()
        } finally {
            selectionSaveInFlightRef.current = false
            setIsSavingSelection(false)
        }
    }

    const getMonthShort = (tableName) => {
        if (!tableName) return ''
        const month = tableName.split('_')[0]
        return month.slice(0, 3)
    }

    const getYear = (tableName) => {
        if (!tableName) return ''
        return tableName.split('_')[1]
    }

    // Group tables by year
    const tablesByYear = monthlyTables?.reduce((acc, table) => {
        const year = getYear(table)
        if (!acc[year]) acc[year] = []
        acc[year].push(table)
        return acc
    }, {}) || {}

    if (!isOpen) return null

    return createPortal(
        <>
            {/* Backdrop with blur - very high z-index to cover everything */}
            <div
                className="fixed inset-0 bg-black/50 z-[9998] backdrop-blur-sm"
                onClick={handleClose}
            />

            {/* Popup */}
            <div
                ref={popupRef}
                role="dialog"
                aria-modal="true"
                aria-label="Select Month"
                data-testid="month-picker-popup"
                className="fixed left-1/2 top-1/2 z-[9999] flex w-[calc(100vw-1.5rem)] max-w-[31rem] max-h-[calc(100dvh-1.5rem)] -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-2xl dark:border-gray-700 dark:bg-gray-800 sm:w-[30rem] sm:max-h-[calc(100dvh-3rem)]"
                style={{ transform: 'translate(-50%, -50%)' }}
            >
                {/* Header */}
                <div className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-b border-gray-200/50 bg-gray-50/80 px-4 py-3 dark:border-gray-700/50 dark:bg-gray-900/50 sm:px-5">
                    <div className="ml-auto flex items-center gap-2">
                        <Calendar className="w-4 h-4 text-orange-500" />
                        <span className="text-sm font-semibold text-gray-900 dark:text-white">
                            Select Month
                        </span>
                    </div>
                    <div className="flex items-center gap-2">
                        {showCalendarModeControl ? (
                            <div className="inline-flex rounded-lg border border-gray-200 bg-white p-0.5 text-xs font-semibold dark:border-gray-700 dark:bg-gray-900" role="group" aria-label="Calendar mode">
                                {['auto', 'manual'].map((mode) => (
                                    <button
                                        key={mode}
                                        type="button"
                                        disabled={isCalendarSaving || (mode === 'manual' && manualModeDisabled)}
                                        onClick={() => handleCalendarModeChange(mode)}
                                        aria-pressed={pendingCalendarMode === mode}
                                        className={`rounded-md px-2.5 py-1.5 capitalize transition-colors disabled:cursor-not-allowed disabled:opacity-60 ${pendingCalendarMode === mode
                                            ? mode === 'manual'
                                                ? 'bg-indigo-600 text-white'
                                                : 'bg-orange-600 text-white'
                                            : 'text-gray-600 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-800'
                                            }`}
                                    >
                                        {mode}
                                    </button>
                                ))}
                            </div>
                        ) : showAutoToggle && (
                            <button
                                type="button"
                                onClick={onToggleAuto}
                                disabled={manualModeDisabled}
                                className={`inline-flex items-center gap-2 rounded-full px-2 py-1 text-[11px] font-semibold transition-colors disabled:opacity-60 disabled:cursor-not-allowed ${autoEnabled
                                        ? 'bg-emerald-600 text-white'
                                        : 'bg-red-600 text-white'
                                    }`}
                            >
                                <Zap className="w-3 h-3" />
                                <span>{toggleLabel}</span>
                                <span className={`inline-flex h-4 w-8 items-center rounded-full px-0.5 ${autoEnabled ? 'bg-emerald-500/60' : 'bg-red-500/60'}`}>
                                    <span className={`h-3 w-3 rounded-full bg-white transition-transform ${autoEnabled ? 'translate-x-4' : 'translate-x-0'}`} />
                                </span>
                            </button>
                        )}
                        <button
                            onClick={handleClose}
                            className="p-1 hover:bg-gray-200 dark:hover:bg-gray-700 rounded-full transition-colors btn-press"
                        >
                            <X className="w-4 h-4 text-gray-500" />
                        </button>
                    </div>
                </div>

                {showCalendarModeControl ? (
                    <div className={`shrink-0 border-b border-gray-200/60 px-4 py-3 dark:border-gray-700/60 sm:px-5 ${pendingCalendarMode === 'manual'
                        ? 'bg-indigo-50/80 dark:bg-indigo-900/20'
                        : 'bg-emerald-50/80 dark:bg-emerald-900/20'
                        }`}>
                        <p className={`text-xs font-semibold ${pendingCalendarMode === 'manual' ? 'text-indigo-800 dark:text-indigo-200' : 'text-emerald-800 dark:text-emerald-200'}`}>
                            {pendingCalendarMode === 'manual' ? 'Choose a month and Sunday' : 'Auto follows the live Sunday'}
                        </p>
                        <p className={`text-[11px] mt-1 ${pendingCalendarMode === 'manual' ? 'text-indigo-700/80 dark:text-indigo-300/80' : 'text-emerald-700/80 dark:text-emerald-300/80'}`}>
                            {manualModeDisabled
                                        ? disabledReason
                                        : pendingCalendarMode === 'manual'
                                            ? 'Choose a month and Sunday, then apply. Your current attendance month stays unchanged until you apply.'
                                            : (calendarSettingsRefreshing
                                                ? 'Refreshing calendar settings in the background.'
                                                : 'Choose Manual to select a historical month and Sunday.')}
                        </p>
                        {preferencesError && !isOfflineActive && (
                            <button
                                type="button"
                                onClick={() => retryPreferenceHydration?.()}
                                className="mt-2 inline-flex items-center gap-1.5 rounded-lg bg-indigo-600 px-3 py-1.5 text-[11px] font-semibold text-white transition-colors hover:bg-indigo-700 disabled:cursor-not-allowed disabled:opacity-60"
                            >
                                <svg className="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 12a9 9 0 1 1-2.64-6.36M21 3v6h-6" strokeLinecap="round" strokeLinejoin="round" /></svg>
                                Retry
                            </button>
                        )}
                    </div>
                ) : showAutoToggle && (
                    <div className={`shrink-0 border-b border-gray-200/60 px-4 py-3 dark:border-gray-700/60 sm:px-5 ${autoEnabled
                            ? 'bg-emerald-50/80 dark:bg-emerald-900/20'
                            : 'bg-red-50/80 dark:bg-red-900/20'
                        }`}>
                        <p className={`text-xs font-semibold ${autoEnabled ? 'text-emerald-800 dark:text-emerald-200' : 'text-red-800 dark:text-red-200'}`}>
                            {autoEnabled ? 'Auto is on' : 'Manual mode is on'}
                        </p>
                        <p className={`text-[11px] mt-1 ${autoEnabled ? 'text-emerald-700/80 dark:text-emerald-300/80' : 'text-red-700/80 dark:text-red-300/80'}`}>
                            {manualModeDisabled
                                ? disabledReason
                                : (manualStatus || (autoEnabled
                                    ? 'Turn Auto off before manually picking a month and Sunday.'
                                    : 'Choose the exact month and Sunday you want to use.'))}
                        </p>
                    </div>
                )}

                <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
                {/* Month list */}
                <div className={selectionDisabled ? 'opacity-70' : ''}>
                    {Object.entries(tablesByYear).sort((a, b) => b[0] - a[0]).map(([year, tables]) => (
                        <div key={year}>
                            {/* Year header */}
                            <div className="sticky top-0 px-4 py-2 text-xs font-bold uppercase tracking-wider text-gray-500 dark:text-gray-400 bg-gray-100/90 dark:bg-gray-900/90 backdrop-blur-sm">
                                {year}
                            </div>

                            {/* Month buttons */}
                            <div className="grid grid-cols-3 gap-2 p-3 sm:grid-cols-4 sm:p-4">
                                {tables.map((table) => {
                                    const isSelected = table === activeDisplayTable
                                    return (
                                        <button
                                            key={table}
                                            onClick={() => handleSelectMonth(table)}
                                            disabled={selectionDisabled}
                                            className={`relative flex min-h-12 flex-col items-center justify-center rounded-xl px-3 py-2.5 text-sm font-medium btn-press transition-all duration-200 ${isSelected
                                                ? 'bg-orange-500 text-white shadow-lg shadow-orange-500/30 scale-105'
                                                : 'bg-gray-100 dark:bg-gray-700/50 text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600'
                                                }`}
                                        >
                                            <span className="text-base font-semibold">
                                                {getMonthShort(table)}
                                            </span>
                                            {isSelected && (
                                                <Check className="absolute top-1 right-1 w-3 h-3" />
                                            )}
                                        </button>
                                    )
                                })}
                            </div>
                        </div>
                    ))}

                    {(!monthlyTables || monthlyTables.length === 0) && (
                        <div className="p-8 text-center text-gray-500 dark:text-gray-400 animate-fade-in">
                            <Calendar className="w-8 h-8 mx-auto mb-2 opacity-50" />
                            <p className="text-sm">
                                {isCollaborator
                                    ? "No months created by owner yet"
                                    : "No months available"
                                }
                            </p>
                            {isCollaborator && (
                                <p className="text-xs mt-1 text-gray-400 dark:text-gray-500">
                                    Ask the workspace owner to create a month first
                                </p>
                            )}
                        </div>
                    )}
                </div>
                {previewSundays.length > 0 && (
                    <div className="border-t border-gray-200 bg-gray-50/70 px-4 py-3 dark:border-gray-700 dark:bg-gray-900/40 sm:px-5">
                        <div className="text-[11px] font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400 mb-2">Sundays</div>
                        <div className="flex flex-wrap gap-1.5">
                            {previewSundays.map((dateStr) => {
                                const [y, m, d] = dateStr.split('-').map(Number)
                                const label = new Date(y, m - 1, d).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
                                const isSelected = (isManualPreview ? draftSundayDate : selectedDateKey) === dateStr
                                return (
                                    <button
                                        key={dateStr}
                                        onClick={() => handleSelectSunday(dateStr)}
                                        disabled={selectionDisabled}
                                        className={`px-2.5 py-1 rounded-full text-xs font-medium transition-colors ${isSelected
                                            ? 'bg-orange-600 text-white'
                                            : 'bg-white dark:bg-gray-700 text-gray-700 dark:text-gray-200 hover:bg-orange-50 dark:hover:bg-gray-600 border border-gray-200 dark:border-gray-600'
                                            }`}
                                    >
                                        {label}
                                    </button>
                                )
                            })}
                        </div>
                    </div>
                )}
                </div>

                {/* Applying Manual is separate from choosing it. This footer
                    stays visible on compact screens, while the picker itself
                    can still scroll through long month lists. */}
                {(isManualPreview || !isCollaborator) && (
                    <div className="shrink-0 border-t border-gray-200 bg-gray-50/90 p-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))] backdrop-blur-sm dark:border-gray-700 dark:bg-gray-900/70 sm:px-5">
                        {isManualPreview && (
                            <button
                                type="button"
                                onClick={handleApplyManualSelection}
                                disabled={selectionDisabled || !previewTable || !draftSundayDate}
                                className="flex min-h-11 w-full items-center justify-center gap-2 rounded-xl bg-indigo-600 px-4 py-2.5 text-sm font-bold text-white shadow-sm transition-colors hover:bg-indigo-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400 focus-visible:ring-offset-2 focus-visible:ring-offset-gray-50 disabled:cursor-not-allowed disabled:opacity-60 btn-press dark:focus-visible:ring-offset-gray-900"
                            >
                                <Check className="h-4 w-4" />
                                {isSavingSelection ? 'Applying…' : 'Apply month'}
                            </button>
                        )}
                        {!isCollaborator && (
                            <button
                                onClick={() => {
                                    selection()
                                    onClose()
                                    if (onCreateMonth) onCreateMonth()
                                }}
                                className={`flex min-h-11 w-full items-center justify-center gap-2 rounded-xl bg-orange-600 px-4 py-2.5 text-sm font-bold text-white shadow-sm transition-colors hover:bg-orange-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange-400 focus-visible:ring-offset-2 focus-visible:ring-offset-gray-50 btn-press dark:focus-visible:ring-offset-gray-900 ${isManualPreview ? 'mt-2' : ''}`}
                            >
                                <Plus className="w-4 h-4" />
                                Create New Month
                            </button>
                        )}
                    </div>
                )}
            </div>
        </>,
        document.body
    )
}

export default MonthPickerPopup

