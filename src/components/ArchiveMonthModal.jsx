import React, { useState, useEffect, useMemo, useCallback } from 'react'
import {
    Archive,
    Download,
    Trash2,
    Users,
    ChevronDown,
    ChevronUp,
    ChevronLeft,
    Loader2,
    X,
    AlertTriangle,
    CheckCircle,
    ExternalLink,
    FileSpreadsheet,
    Info,
    GripVertical,
    Eye
} from 'lucide-react'
import { useApp } from '../context/AppContext'
import { supabase } from '../lib/supabase'
import { toast } from 'react-toastify'

// Hide scrollbar styles
const scrollbarHideStyle = `
  .archive-preview-table::-webkit-scrollbar {
    display: none;
  }
  .archive-preview-table {
    -ms-overflow-style: none;
    scrollbar-width: none;
  }
`

const DEFAULT_COLUMNS = [
    'Full Name',
    'Gender',
    'Phone Number',
    'Age',
    'Current Level',
    'Parent Name',
    'Parent Phone Number'
]

const ArchiveMonthModal = ({ isOpen, onClose, tableName, onArchiveComplete }) => {
    const { members, deleteMonthTable, isSupabaseConfigured } = useApp()

    const [step, setStep] = useState('summary') // 'summary' | 'confirm' | 'archiving' | 'done'
    const [monthData, setMonthData] = useState([])
    const [loading, setLoading] = useState(true)
    const [csvBlob, setCsvBlob] = useState(null)
    const [downloaded, setDownloaded] = useState(false)
    const [showDetails, setShowDetails] = useState(false)
    const [archiveError, setArchiveError] = useState(null)

    // Export Center features
    const [columns, setColumns] = useState(DEFAULT_COLUMNS)
    const [draggedIdx, setDraggedIdx] = useState(null)
    const [showPreview, setShowPreview] = useState(false)

    const label = tableName ? tableName.replace('_', ' ') : ''

    // Fetch all data for this month
    useEffect(() => {
        if (!isOpen || !tableName) return
        setStep('summary')
        setDownloaded(false)
        setCsvBlob(null)
        setArchiveError(null)
        setShowPreview(false)
        setColumns(DEFAULT_COLUMNS)
        setLoading(true)

        const fetchData = async () => {
            try {
                if (!isSupabaseConfigured()) {
                    setMonthData(members || [])
                    setLoading(false)
                    return
                }

                let allRows = []
                let offset = 0
                const PAGE = 1000
                while (true) {
                    const { data, error } = await supabase
                        .from(tableName)
                        .select('*')
                        .range(offset, offset + PAGE - 1)
                    if (error) throw error
                    if (!data || data.length === 0) break
                    allRows = allRows.concat(data)
                    if (data.length < PAGE) break
                    offset += PAGE
                }
                setMonthData(allRows)
            } catch (err) {
                console.error('Failed to fetch month data for archive:', err)
                toast.error('Failed to load month data')
                setMonthData([])
            } finally {
                setLoading(false)
            }
        }

        fetchData()
    }, [isOpen, tableName, isSupabaseConfigured, members])

    // Compute summary stats
    const stats = useMemo(() => {
        const total = monthData.length
        const males = monthData.filter(m => {
            const g = (m.Gender || m.gender || '').toLowerCase()
            return g === 'male' || g === 'm'
        }).length
        const females = monthData.filter(m => {
            const g = (m.Gender || m.gender || '').toLowerCase()
            return g === 'female' || g === 'f'
        }).length

        // Age breakdown
        const ages = {}
        monthData.forEach(m => {
            const age = parseInt(m.Age || m.age || '0', 10)
            if (age > 0) {
                let bracket
                if (age <= 12) bracket = '12 & under'
                else if (age <= 15) bracket = '13-15'
                else if (age <= 18) bracket = '16-18'
                else if (age <= 25) bracket = '19-25'
                else bracket = '26+'
                ages[bracket] = (ages[bracket] || 0) + 1
            }
        })

        // Level breakdown
        const levels = {}
        monthData.forEach(m => {
            const level = m['Current Level'] || m.current_level || ''
            if (level) {
                levels[level] = (levels[level] || 0) + 1
            }
        })

        const sortedLevels = Object.entries(levels)
            .sort((a, b) => b[1] - a[1])
            .slice(0, 8)

        return { total, males, females, ages, levels: sortedLevels }
    }, [monthData])

    // Drag-and-drop column reorder
    const handleDragStart = (idx) => setDraggedIdx(idx)
    const handleDragOver = (e) => e.preventDefault()
    const handleDrop = (idx) => {
        if (draggedIdx === null || draggedIdx === idx) return
        const newCols = [...columns]
        const [removed] = newCols.splice(draggedIdx, 1)
        newCols.splice(idx, 0, removed)
        setColumns(newCols)
        setDraggedIdx(null)
        setCsvBlob(null)
    }

    // Helper: format phone for display
    const formatPhoneDisplay = (val) => {
        if (!val) return ''
        const str = String(val).trim()
        const digits = str.replace(/\D/g, '')
        if (!digits) return str
        return digits.startsWith('0') ? digits : '0' + digits
    }

    // Helper: normalize gender for display
    const normalizeGender = (val) => {
        if (!val) return ''
        const str = String(val).trim().toLowerCase()
        if (str === 'm' || str === 'male') return 'Male'
        if (str === 'f' || str === 'female') return 'Female'
        return val
    }

    // Find attendance date columns - support OLD (Attendance 7th) and NEW (attendance_2025_01_07) formats
    const dateColumns = useMemo(() => {
        const cols = new Set()
        monthData.forEach(row => {
            Object.keys(row).forEach(key => {
                const keyLower = key.toLowerCase()
                // OLD format: Attendance 7th, Attendance 14th, etc.
                if (key.startsWith('Attendance ')) cols.add(key)
                // NEW format: attendance_2025_01_07
                else if (/^attendance_\d{4}_\d{2}_\d{2}$/.test(keyLower)) cols.add(key)
                // Also catch raw YYYY-MM-DD date columns just in case
                else if (/^\d{4}-\d{2}-\d{2}$/.test(key)) cols.add(key)
            })
        })
        return [...cols].sort()
    }, [monthData])

    // Compute present/absent counts for a row
    const getAttendanceCounts = useCallback((row) => {
        let present = 0
        let absent = 0
        let hasAny = false
        dateColumns.forEach(date => {
            const val = row[date]
            if (val === 'Present' || val === true) {
                present++
                hasAny = true
            } else if (val === 'Absent' || val === false) {
                absent++
                hasAny = true
            }
        })
        return { present, absent, hasAny }
    }, [dateColumns])

    // Get cell value for display
    const getCellValue = (row, col) => {
        if (col === 'Present') {
            const counts = getAttendanceCounts(row)
            return counts.hasAny ? counts.present : null
        }
        if (col === 'Absent') {
            const counts = getAttendanceCounts(row)
            return counts.hasAny ? counts.absent : null
        }
        let v = row[col] ?? row[col.toLowerCase().replace(/ /g, '_')] ?? ''
        if (col === 'Phone Number' || col === 'Parent Phone Number') return formatPhoneDisplay(v)
        if (col === 'Gender') return normalizeGender(v)
        return v || '-'
    }

    // Generate CSV - clean format optimized for Google Sheets
    const generateCSV = useCallback(() => {
        const allColumns = [...columns, 'Present', 'Absent', ...dateColumns]
        const colCount = allColumns.length

        const padRow = (cells) => {
            const padded = [...cells]
            while (padded.length < colCount) padded.push('')
            return padded.map(c => `"${String(c).replace(/"/g, '""')}"`).join(',')
        }

        const formatPhoneCSV = (val) => {
            if (!val) return ''
            const str = String(val).trim()
            const digits = str.replace(/\D/g, '')
            if (!digits) return str
            const withZero = digits.startsWith('0') ? digits : '0' + digits
            return `="${withZero}"`
        }

        const lines = []

        // Summary section
        lines.push(padRow([`ARCHIVE: ${label}`, '', '', `Archived: ${new Date().toLocaleDateString()}`]))
        lines.push(padRow([]))
        lines.push(padRow(['Total Members', stats.total, '', 'Male', stats.males, '', 'Female', stats.females]))
        lines.push(padRow([]))

        // Column headers
        lines.push(allColumns.map(h => `"${h}"`).join(','))

        // Data rows
        monthData.forEach(row => {
            const cells = allColumns.map(col => {
                let v = row[col] ?? row[col.toLowerCase().replace(/ /g, '_')] ?? ''

                if (col === 'Present') {
                    const counts = getAttendanceCounts(row)
                    return `"${counts.present}"`
                }
                if (col === 'Absent') {
                    const counts = getAttendanceCounts(row)
                    return `"${counts.absent}"`
                }
                if (col === 'Phone Number' || col === 'Parent Phone Number') {
                    return formatPhoneCSV(v)
                }
                if (col === 'Gender') {
                    v = normalizeGender(v)
                }

                if (typeof v === 'string') v = v.replace(/"/g, '""')
                return `"${v}"`
            })
            lines.push(cells.join(','))
        })

        const csvContent = lines.join('\n')
        const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' })
        setCsvBlob(blob)
        return blob
    }, [monthData, columns, dateColumns, label, stats, getAttendanceCounts])

    // Download CSV
    const handleDownload = useCallback(() => {
        const blob = csvBlob || generateCSV()
        const url = URL.createObjectURL(blob)
        const link = document.createElement('a')
        link.href = url
        link.download = `archive_${tableName}.csv`
        document.body.appendChild(link)
        link.click()
        document.body.removeChild(link)
        URL.revokeObjectURL(url)
        setDownloaded(true)
        toast.success('CSV downloaded successfully!')
    }, [csvBlob, generateCSV, tableName])

    // Open Google Sheets
    const handleOpenSheets = () => {
        window.open('https://sheets.google.com/create', '_blank')
    }

    // Archive (delete from Supabase)
    const handleArchive = async () => {
        setStep('archiving')
        setArchiveError(null)
        try {
            await deleteMonthTable(tableName)
            setStep('done')
            if (onArchiveComplete) onArchiveComplete(tableName)
        } catch (err) {
            console.error('Archive failed:', err)
            setArchiveError(err?.message || 'Failed to archive month')
            setStep('confirm')
        }
    }

    if (!isOpen) return null

    return (
        <>
            <style>{scrollbarHideStyle}</style>
            <div className="fixed inset-0 z-[100] flex items-center justify-center p-0 sm:p-4">
            {/* Backdrop */}
            <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={onClose} />

            {/* Modal - full width on mobile, max-w-4xl on desktop */}
            <div className="relative bg-white dark:bg-gray-800 sm:rounded-2xl shadow-2xl w-full sm:max-w-4xl h-full sm:h-auto sm:max-h-[92vh] overflow-y-auto">
                {/* Header */}
                <div className="sticky top-0 bg-white dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700 px-4 sm:px-5 py-3 sm:py-4 flex items-center justify-between sm:rounded-t-2xl z-10">
                    <div className="flex items-center gap-3">
                        <button onClick={onClose} className="p-2 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg transition-colors sm:hidden">
                            <ChevronLeft className="w-5 h-5 text-gray-600 dark:text-gray-300" />
                        </button>
                        <div className="p-2 bg-amber-100 dark:bg-amber-900/30 rounded-lg">
                            <Archive className="w-5 h-5 text-amber-600 dark:text-amber-400" />
                        </div>
                        <div>
                            <h2 className="text-lg font-semibold text-gray-900 dark:text-white">Archive Month</h2>
                            <p className="text-sm text-gray-500 dark:text-gray-400">{label}</p>
                        </div>
                    </div>
                    <button onClick={onClose} className="p-2 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg transition-colors hidden sm:block">
                        <X className="w-5 h-5 text-gray-500" />
                    </button>
                </div>

                <div className="p-4 sm:p-5 space-y-5">
                    {/* Loading */}
                    {loading && (
                        <div className="flex flex-col items-center justify-center py-12 gap-3">
                            <Loader2 className="w-8 h-8 text-orange-500 animate-spin" />
                            <p className="text-sm text-gray-500 dark:text-gray-400">Loading month data...</p>
                        </div>
                    )}

                    {/* Summary Step */}
                    {!loading && step === 'summary' && (
                        <>
                            {/* Info Banner */}
                            <div className="bg-orange-50 dark:bg-orange-900/20 border border-orange-200 dark:border-orange-800 rounded-xl p-3 sm:p-4">
                                <div className="flex gap-3">
                                    <Info className="w-5 h-5 text-orange-500 flex-shrink-0 mt-0.5" />
                                    <div>
                                        <p className="text-sm font-medium text-orange-800 dark:text-orange-300">What does archiving do?</p>
                                        <p className="text-xs text-orange-600 dark:text-orange-400 mt-1">
                                            Archiving exports your data as a CSV file and removes it from the database to free up storage space.
                                            You can import the CSV into Google Sheets to keep it accessible.
                                        </p>
                                    </div>
                                </div>
                            </div>

                            {/* Summary Stats */}
                            <div className="bg-gradient-to-br from-orange-50 to-indigo-50 dark:from-orange-900/20 dark:to-indigo-900/20 rounded-xl p-4 sm:p-6 border border-orange-200 dark:border-orange-800">
                                <h3 className="text-sm font-bold text-gray-700 dark:text-gray-200 mb-3 flex items-center gap-2">
                                    <FileSpreadsheet className="w-4 h-4 text-orange-600 dark:text-orange-400" />
                                    Archive Summary
                                </h3>
                                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                                    <div className="bg-white dark:bg-gray-800 rounded-xl p-3 shadow-sm border border-orange-100 dark:border-orange-800">
                                        <div className="text-2xl font-bold text-orange-600 dark:text-orange-400">{stats.total}</div>
                                        <div className="text-xs text-gray-600 dark:text-gray-300 font-medium">Total People</div>
                                    </div>
                                    <div className="bg-white dark:bg-gray-800 rounded-xl p-3 shadow-sm border border-indigo-100 dark:border-indigo-800">
                                        <div className="text-2xl font-bold text-indigo-600 dark:text-indigo-400">{stats.males}</div>
                                        <div className="text-xs text-gray-600 dark:text-gray-300 font-medium">Male</div>
                                    </div>
                                    <div className="bg-white dark:bg-gray-800 rounded-xl p-3 shadow-sm border border-pink-100 dark:border-pink-800">
                                        <div className="text-2xl font-bold text-pink-600 dark:text-pink-400">{stats.females}</div>
                                        <div className="text-xs text-gray-600 dark:text-gray-300 font-medium">Female</div>
                                    </div>
                                    <div className="bg-white dark:bg-gray-800 rounded-xl p-3 shadow-sm border border-green-100 dark:border-green-800">
                                        <div className="text-2xl font-bold text-green-600 dark:text-green-400">{dateColumns.length}</div>
                                        <div className="text-xs text-gray-600 dark:text-gray-300 font-medium">Attendance Dates</div>
                                    </div>
                                </div>

                                {/* Expandable Details */}
                                <button
                                    onClick={() => setShowDetails(!showDetails)}
                                    className="mt-4 w-full flex items-center justify-between px-3 py-2 bg-white/60 dark:bg-gray-800/60 rounded-lg text-xs font-medium text-gray-600 dark:text-gray-400 hover:bg-white dark:hover:bg-gray-800 transition-colors"
                                >
                                    <span>Age & Level Breakdown</span>
                                    {showDetails ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
                                </button>

                                {showDetails && (
                                    <div className="mt-3 grid grid-cols-1 sm:grid-cols-2 gap-4">
                                        {Object.keys(stats.ages).length > 0 && (
                                            <div>
                                                <h4 className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase mb-2">Age Groups</h4>
                                                <div className="space-y-1">
                                                    {Object.entries(stats.ages).map(([bracket, count]) => (
                                                        <div key={bracket} className="flex items-center justify-between px-3 py-1.5 bg-white dark:bg-gray-800 rounded-lg">
                                                            <span className="text-xs text-gray-700 dark:text-gray-300">{bracket}</span>
                                                            <span className="text-xs font-semibold text-gray-900 dark:text-white">{count}</span>
                                                        </div>
                                                    ))}
                                                </div>
                                            </div>
                                        )}
                                        {stats.levels.length > 0 && (
                                            <div>
                                                <h4 className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase mb-2">Top Levels</h4>
                                                <div className="space-y-1">
                                                    {stats.levels.map(([level, count]) => (
                                                        <div key={level} className="flex items-center justify-between px-3 py-1.5 bg-white dark:bg-gray-800 rounded-lg">
                                                            <span className="text-xs text-gray-700 dark:text-gray-300 truncate">{level}</span>
                                                            <span className="text-xs font-semibold text-gray-900 dark:text-white">{count}</span>
                                                        </div>
                                                    ))}
                                                </div>
                                            </div>
                                        )}
                                    </div>
                                )}
                            </div>

                            {/* Column Order (drag-and-drop) */}
                            <section className="bg-white dark:bg-gray-800 rounded-xl shadow border border-gray-200 dark:border-gray-700 p-4">
                                <h3 className="font-semibold text-gray-900 dark:text-white mb-1 flex items-center gap-2 text-sm">
                                    <GripVertical className="w-4 h-4 text-gray-400" /> Column Order
                                </h3>
                                <p className="text-xs text-gray-500 dark:text-gray-400 mb-3">Drag to reorder • Click X to remove</p>
                                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                                    {columns.map((col, idx) => (
                                        <div
                                            key={col}
                                            draggable
                                            onDragStart={() => handleDragStart(idx)}
                                            onDragOver={handleDragOver}
                                            onDrop={() => handleDrop(idx)}
                                            className={`flex items-center gap-2 px-3 py-2 rounded-lg bg-gray-50 dark:bg-gray-700 border border-gray-200 dark:border-gray-600 cursor-grab select-none ${draggedIdx === idx ? 'opacity-50' : ''}`}
                                        >
                                            <GripVertical className="w-4 h-4 text-gray-400 flex-shrink-0" />
                                            <span className="flex-1 text-sm text-gray-800 dark:text-gray-100">{col}</span>
                                            <button
                                                onClick={(e) => {
                                                    e.stopPropagation()
                                                    setColumns(prev => prev.filter((_, i) => i !== idx))
                                                    setCsvBlob(null)
                                                }}
                                                className="p-1 hover:bg-red-100 dark:hover:bg-red-900/30 rounded transition-colors"
                                                title="Remove column"
                                            >
                                                <X className="w-4 h-4 text-gray-400 hover:text-red-600 dark:hover:text-red-400" />
                                            </button>
                                        </div>
                                    ))}
                                </div>
                                {columns.length < DEFAULT_COLUMNS.length && (
                                    <button
                                        onClick={() => { setColumns(DEFAULT_COLUMNS); setCsvBlob(null) }}
                                        className="mt-2 text-xs text-orange-600 dark:text-orange-400 hover:underline"
                                    >
                                        Reset columns
                                    </button>
                                )}
                            </section>

                            {/* Preview Button */}
                            <button
                                onClick={() => setShowPreview(!showPreview)}
                                className="w-full flex items-center justify-center gap-2 py-3 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white font-semibold transition-colors"
                            >
                                <Eye className="w-5 h-5" />
                                {showPreview ? 'Hide Preview' : 'Preview Data'}
                            </button>

                            {/* Data Preview Table */}
                            {showPreview && (
                                <section className="bg-white dark:bg-gray-800 rounded-xl shadow border border-gray-200 dark:border-gray-700 p-4">
                                    <div className="flex items-center justify-between mb-3">
                                        <h3 className="font-semibold text-gray-900 dark:text-white flex items-center gap-2 text-sm">
                                            <Users className="w-4 h-4 text-green-500" /> Preview
                                        </h3>
                                        <span className="text-xs text-gray-500 dark:text-gray-400">{monthData.length} records</span>
                                    </div>

                                    <div className="border border-gray-200 dark:border-gray-700 rounded-t-2xl rounded-br-2xl overflow-hidden">
                                        <div className="archive-preview-table overflow-auto max-h-80 sm:max-h-96">
                                        <table className="min-w-full text-xs sm:text-sm">
                                            <thead className="bg-gray-100 dark:bg-gray-700 sticky top-0 z-10">
                                                <tr>
                                                    {columns.map(col => (
                                                        <th key={col} className="px-3 py-2 text-left text-gray-700 dark:text-gray-200 font-semibold whitespace-nowrap">{col}</th>
                                                    ))}
                                                    {dateColumns.map(col => {
                                                        // Format header: "Attendance 7th" → "7th", "attendance_2025_01_07" → "Jan 7", "2025-01-07" → "Jan 7"
                                                        let label = col
                                                        if (col.startsWith('Attendance ')) {
                                                            label = col.replace('Attendance ', '')
                                                        } else if (/^attendance_\d{4}_\d{2}_\d{2}$/i.test(col)) {
                                                            const parts = col.split('_')
                                                            const d = new Date(+parts[1], +parts[2] - 1, +parts[3])
                                                            label = d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
                                                        } else if (/^\d{4}-\d{2}-\d{2}$/.test(col)) {
                                                            const d = new Date(col + 'T00:00:00')
                                                            label = d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
                                                        }
                                                        return (
                                                            <th key={col} className="px-3 py-2 text-left text-gray-600 dark:text-gray-300 font-semibold whitespace-nowrap text-xs bg-gray-50 dark:bg-gray-600">
                                                                {label}
                                                            </th>
                                                        )
                                                    })}
                                                </tr>
                                            </thead>
                                            <tbody>
                                                {monthData.slice(0, 50).map((row, i) => {
                                                    const counts = getAttendanceCounts(row)
                                                    return (
                                                    <tr key={i} className="border-t border-gray-100 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-700/50 transition-colors">
                                                        {columns.map(col => (
                                                            <td key={col} className="px-3 py-2 text-gray-800 dark:text-gray-100 whitespace-nowrap">
                                                                {getCellValue(row, col)}
                                                            </td>
                                                        ))}
                                                        {dateColumns.map(date => {
                                                            const val = row[date]
                                                            const isPresent = val === 'Present' || val === true
                                                            const isAbsent = val === 'Absent' || val === false
                                                            return (
                                                                <td key={date} className={`px-3 py-2 whitespace-nowrap text-xs font-medium ${isPresent ? 'text-green-600 dark:text-green-400 font-bold' : isAbsent ? 'text-red-500 dark:text-red-400 font-bold' : 'text-gray-300 dark:text-gray-600'}`}>
                                                                    {isPresent ? 'P' : isAbsent ? 'A' : '-'}
                                                                </td>
                                                            )
                                                        })}
                                                    </tr>
                                                    )
                                                })}
                                                {monthData.length > 50 && (
                                                    <tr>
                                                        <td colSpan={columns.length + dateColumns.length} className="px-3 py-3 text-center text-gray-400 text-xs bg-gray-50 dark:bg-gray-700/50">
                                                            ...and {monthData.length - 50} more rows (all will be included in export)
                                                        </td>
                                                    </tr>
                                                )}
                                                {monthData.length === 0 && (
                                                    <tr>
                                                        <td colSpan={columns.length + dateColumns.length} className="px-2 py-4 text-center text-gray-400">No data</td>
                                                    </tr>
                                                )}
                                            </tbody>
                                        </table>
                                        </div>
                                    </div>
                                </section>
                            )}

                            {/* Actions */}
                            <div className="space-y-3 pt-2">
                                {/* Download CSV */}
                                <button
                                    onClick={handleDownload}
                                    className="w-full flex items-center justify-center gap-2 py-3.5 rounded-xl bg-green-600 hover:bg-green-700 text-white font-bold shadow-lg hover:shadow-xl transition-all"
                                >
                                    <Download className="w-5 h-5" />
                                    {downloaded ? 'Download Again' : 'Export to CSV for Google Sheets'}
                                </button>

                                {/* Open Google Sheets */}
                                {downloaded && (
                                    <button
                                        onClick={handleOpenSheets}
                                        className="w-full flex items-center justify-center gap-2 py-3 rounded-xl bg-white dark:bg-gray-700 border-2 border-green-500 text-green-700 dark:text-green-400 font-medium hover:bg-green-50 dark:hover:bg-green-900/20 transition-colors"
                                    >
                                        <FileSpreadsheet className="w-5 h-5" />
                                        Open Google Sheets
                                        <ExternalLink className="w-4 h-4" />
                                    </button>
                                )}

                                {/* Archive & Delete */}
                                <button
                                    onClick={() => setStep('confirm')}
                                    className="w-full flex items-center justify-center gap-2 py-3 rounded-xl bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 text-red-600 dark:text-red-400 font-medium hover:bg-red-100 dark:hover:bg-red-900/30 transition-colors"
                                >
                                    <Trash2 className="w-5 h-5" />
                                    Archive & Delete from Database
                                </button>

                                {!downloaded && (
                                    <p className="text-xs text-amber-600 dark:text-amber-400 text-center flex items-center justify-center gap-1">
                                        <AlertTriangle className="w-3 h-3" />
                                        We recommend downloading the CSV before deleting
                                    </p>
                                )}

                                <p className="text-xs text-gray-400 dark:text-gray-500 text-center">
                                    The exported CSV includes a summary header and can be imported directly into Google Sheets.
                                </p>
                            </div>
                        </>
                    )}

                    {/* Confirm Step */}
                    {!loading && step === 'confirm' && (
                        <div className="space-y-4">
                            <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-xl p-4">
                                <div className="flex gap-3">
                                    <AlertTriangle className="w-6 h-6 text-red-500 flex-shrink-0" />
                                    <div>
                                        <p className="font-semibold text-red-800 dark:text-red-300">Are you sure?</p>
                                        <p className="text-sm text-red-600 dark:text-red-400 mt-1">
                                            This will permanently delete <strong>{label}</strong> and all <strong>{stats.total} records</strong> from the database.
                                            This action cannot be undone.
                                        </p>
                                        {!downloaded && (
                                            <p className="text-sm text-red-700 dark:text-red-300 mt-2 font-medium">
                                                You haven't downloaded the CSV yet!
                                            </p>
                                        )}
                                    </div>
                                </div>
                            </div>

                            {archiveError && (
                                <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg p-3">
                                    <p className="text-sm text-red-600 dark:text-red-400">{archiveError}</p>
                                </div>
                            )}

                            <div className="flex gap-3">
                                <button
                                    onClick={() => setStep('summary')}
                                    className="flex-1 py-3 rounded-xl bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 font-medium hover:bg-gray-200 dark:hover:bg-gray-600 transition-colors"
                                >
                                    Go Back
                                </button>
                                <button
                                    onClick={handleArchive}
                                    className="flex-1 py-3 rounded-xl bg-red-600 hover:bg-red-700 text-white font-medium transition-colors"
                                >
                                    Yes, Delete Forever
                                </button>
                            </div>

                            {!downloaded && (
                                <button
                                    onClick={() => { handleDownload(); setStep('summary') }}
                                    className="w-full py-2.5 rounded-xl bg-green-600 hover:bg-green-700 text-white font-medium transition-colors flex items-center justify-center gap-2"
                                >
                                    <Download className="w-4 h-4" />
                                    Download CSV First
                                </button>
                            )}
                        </div>
                    )}

                    {/* Archiving Step */}
                    {step === 'archiving' && (
                        <div className="flex flex-col items-center justify-center py-12 gap-4">
                            <Loader2 className="w-10 h-10 text-red-500 animate-spin" />
                            <p className="text-sm font-medium text-gray-700 dark:text-gray-300">Archiving {label}...</p>
                            <p className="text-xs text-gray-500 dark:text-gray-400">Removing data from database</p>
                        </div>
                    )}

                    {/* Done Step */}
                    {step === 'done' && (
                        <div className="flex flex-col items-center justify-center py-8 gap-4">
                            <div className="p-3 bg-green-100 dark:bg-green-900/30 rounded-full">
                                <CheckCircle className="w-10 h-10 text-green-600 dark:text-green-400" />
                            </div>
                            <div className="text-center">
                                <p className="text-lg font-semibold text-gray-900 dark:text-white">Archived Successfully!</p>
                                <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
                                    {label} has been removed from the database.
                                    {downloaded && ' Your CSV backup is saved.'}
                                </p>
                            </div>

                            <div className="w-full space-y-3 pt-2">
                                {downloaded && (
                                    <button
                                        onClick={handleOpenSheets}
                                        className="w-full flex items-center justify-center gap-2 py-3 rounded-xl bg-green-600 hover:bg-green-700 text-white font-medium transition-colors"
                                    >
                                        <FileSpreadsheet className="w-5 h-5" />
                                        Import to Google Sheets
                                        <ExternalLink className="w-4 h-4" />
                                    </button>
                                )}
                                <button
                                    onClick={onClose}
                                    className="w-full py-3 rounded-xl bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 font-medium hover:bg-gray-200 dark:hover:bg-gray-600 transition-colors"
                                >
                                    Done
                                </button>
                            </div>
                        </div>
                    )}
                </div>
            </div>
        </div>
        </>
    )
}

export default ArchiveMonthModal
