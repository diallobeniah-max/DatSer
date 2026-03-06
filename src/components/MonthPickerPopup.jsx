import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Check, Calendar, X, Plus } from 'lucide-react'
import { useApp } from '../context/AppContext'
import useHapticFeedback from '../hooks/useHapticFeedback'

const MonthPickerPopup = ({ isOpen, onClose, anchorRef, onCreateMonth }) => {
    const { monthlyTables, currentTable, setCurrentTable, isCollaborator, selectedAttendanceDate, setAndSaveAttendanceDate, getSundaysInMonth, ownerStickySundays } = useApp()
    const { selection } = useHapticFeedback()
    const popupRef = useRef(null)
    const [previewTable, setPreviewTable] = useState(currentTable)

    const handleClose = useCallback(() => {
        selection()
        onClose()
    }, [selection, onClose])

    useEffect(() => {
        if (isOpen) {
            setPreviewTable(currentTable)
        }
    }, [isOpen, currentTable])

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
        selection()
        setCurrentTable(table)
        setPreviewTable(table)
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
                .sort()
            : []
        if (stickyInMonth.length > 0) return stickyInMonth
        return getSundaysInMonth(monthName, yearNum).map(toDateKey)
    }, [previewTable, getSundaysInMonth, isCollaborator, ownerStickySundays])

    const selectedDateKey = selectedAttendanceDate
        ? `${selectedAttendanceDate.getFullYear()}-${String(selectedAttendanceDate.getMonth() + 1).padStart(2, '0')}-${String(selectedAttendanceDate.getDate()).padStart(2, '0')}`
        : null

    const handleSelectSunday = (dateStr) => {
        const [y, m, d] = dateStr.split('-').map(Number)
        if (Number.isNaN(y) || Number.isNaN(m) || Number.isNaN(d)) return
        selection()
        if (previewTable && previewTable !== currentTable) {
            setCurrentTable(previewTable)
        }
        setAndSaveAttendanceDate(new Date(y, m - 1, d))
        onClose()
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
                className="fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 z-[9999] w-[300px] max-w-[90vw] max-h-[70vh] bg-white dark:bg-gray-800 rounded-2xl shadow-2xl border border-gray-200 dark:border-gray-700 overflow-hidden"
                style={{ transform: 'translate(-50%, -50%)' }}
            >
                {/* Header */}
                <div className="flex items-center justify-between px-4 py-3 border-b border-gray-200/50 dark:border-gray-700/50 bg-gray-50/80 dark:bg-gray-900/50">
                    <div className="flex items-center gap-2">
                        <Calendar className="w-4 h-4 text-orange-500" />
                        <span className="text-sm font-semibold text-gray-900 dark:text-white">
                            Select Month
                        </span>
                    </div>
                    <button
                        onClick={handleClose}
                        className="p-1 hover:bg-gray-200 dark:hover:bg-gray-700 rounded-full transition-colors btn-press"
                    >
                        <X className="w-4 h-4 text-gray-500" />
                    </button>
                </div>

                {/* Month list */}
                <div className="max-h-[50vh] overflow-y-auto overscroll-contain">
                    {Object.entries(tablesByYear).sort((a, b) => b[0] - a[0]).map(([year, tables]) => (
                        <div key={year}>
                            {/* Year header */}
                            <div className="sticky top-0 px-4 py-2 text-xs font-bold uppercase tracking-wider text-gray-500 dark:text-gray-400 bg-gray-100/90 dark:bg-gray-900/90 backdrop-blur-sm">
                                {year}
                            </div>

                            {/* Month buttons */}
                            <div className="p-2 grid grid-cols-3 gap-1.5">
                                {tables.map((table) => {
                                    const isSelected = table === currentTable
                                    return (
                                        <button
                                            key={table}
                                            onClick={() => handleSelectMonth(table)}
                                            className={`relative flex flex-col items-center justify-center p-3 rounded-xl text-sm font-medium btn-press transition-all duration-200 ${isSelected
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
                    <div className="px-3 py-3 border-t border-gray-200 dark:border-gray-700 bg-gray-50/70 dark:bg-gray-900/40">
                        <div className="text-[11px] font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400 mb-2">Sundays</div>
                        <div className="flex flex-wrap gap-1.5">
                            {previewSundays.map((dateStr) => {
                                const [y, m, d] = dateStr.split('-').map(Number)
                                const label = new Date(y, m - 1, d).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
                                const isSelected = selectedDateKey === dateStr
                                return (
                                    <button
                                        key={dateStr}
                                        onClick={() => handleSelectSunday(dateStr)}
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

                {/* Create New Month Button (Owner only) */}
                {!isCollaborator && (
                    <div className="p-3 border-t border-gray-200 dark:border-gray-700 bg-gray-50/80 dark:bg-gray-900/50 backdrop-blur-sm">
                        <button
                            onClick={() => {
                                selection()
                                onClose()
                                if (onCreateMonth) onCreateMonth()
                            }}
                            className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl bg-orange-600 hover:bg-orange-700 text-white font-medium transition-colors text-sm shadow-sm btn-press"
                        >
                            <Plus className="w-4 h-4" />
                            Create New Month
                        </button>
                    </div>
                )}
            </div>
        </>,
        document.body
    )
}

export default MonthPickerPopup

