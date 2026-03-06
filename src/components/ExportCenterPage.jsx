import React, { useState, useMemo, useCallback } from 'react'
import {
    ChevronLeft,
    Download,
    Calendar,
    CheckCircle,
    FileSpreadsheet,
    GripVertical,
    Eye,
    Users,
    Loader2,
    ChevronDown,
    ChevronUp,
    X
} from 'lucide-react'
import { useApp } from '../context/AppContext'
import { supabase } from '../lib/supabase'
import { toast } from 'react-toastify'

const ExportCenterPage = ({ onBack }) => {
    const { monthlyTables, members, attendanceData, currentTable, isSupabaseConfigured, dataOwnerId } = useApp()
    const { user } = useApp()

    // Month selection
    const [selectedMonths, setSelectedMonths] = useState([])
    const [selectAll, setSelectAll] = useState(false)

    // Column order (drag-and-drop)
    const defaultColumns = [
        'Full Name',
        'Gender',
        'Phone Number',
        'Age',
        'Current Level',
        'Parent Name',
        'Parent Phone Number'
    ]
    const [columns, setColumns] = useState(defaultColumns)
    const [draggedIdx, setDraggedIdx] = useState(null)

    // Preview
    const [showPreview, setShowPreview] = useState(false)
    const [previewData, setPreviewData] = useState([])
    const [loadingPreview, setLoadingPreview] = useState(false)
    const [previewMode, setPreviewMode] = useState('standard') // 'standard' or 'archive'

    // Exporting
    const [isExporting, setIsExporting] = useState(false)
    const [exportMode, setExportMode] = useState('standard') // 'standard' or 'attendance-only'

    // Group months by year
    const monthsByYear = useMemo(() => {
        const grouped = {}
        ;(monthlyTables || []).forEach(t => {
            const [month, year] = t.split('_')
            if (!grouped[year]) grouped[year] = []
            grouped[year].push(t)
        })
        return grouped
    }, [monthlyTables])

    const years = useMemo(() => Object.keys(monthsByYear).sort((a, b) => parseInt(b) - parseInt(a)), [monthsByYear])

    // Toggle month selection
    const toggleMonth = (table) => {
        setSelectedMonths(prev =>
            prev.includes(table) ? prev.filter(t => t !== table) : [...prev, table]
        )
    }

    // Select/deselect all
    const handleSelectAll = () => {
        if (selectAll) {
            setSelectedMonths([])
        } else {
            setSelectedMonths([...(monthlyTables || [])])
        }
        setSelectAll(!selectAll)
    }

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
    }

    // Fetch preview data for selected months
    const fetchPreview = useCallback(async () => {
        if (selectedMonths.length === 0) {
            toast.info('Select at least one month to preview')
            return
        }
        setLoadingPreview(true)
        setShowPreview(true)
        try {
            let allRows = []
            for (const table of selectedMonths) {
                if (!isSupabaseConfigured()) {
                    // Demo mode: use current members
                    allRows = allRows.concat(members.map(m => ({ ...m, _month: table })))
                } else {
                    const { data, error } = await supabase.from(table).select('*')
                    if (!error && data) {
                        allRows = allRows.concat(data.map(m => ({ ...m, _month: table })))
                    }
                }
            }
            setPreviewData(allRows)
        } catch (err) {
            console.error('Preview fetch error:', err)
            toast.error('Failed to load preview')
        } finally {
            setLoadingPreview(false)
        }
    }, [selectedMonths, isSupabaseConfigured, members])

    // Compute summary stats
    const summary = useMemo(() => {
        const total = previewData.length
        const boys = previewData.filter(m => (m.Gender || m.gender || '').toLowerCase() === 'male').length
        const girls = previewData.filter(m => (m.Gender || m.gender || '').toLowerCase() === 'female').length
        const monthsCount = selectedMonths.length
        return { total, boys, girls, monthsCount }
    }, [previewData, selectedMonths])

    // Extract attendance date columns (like ArchiveMonthModal does)
    const dateColumns = useMemo(() => {
        const cols = new Set()
        previewData.forEach(row => {
            Object.keys(row).forEach(key => {
                const keyLower = key.toLowerCase()
                // Match attendance columns: attendance_YYYY_MM_DD or Attendance DD or YYYY-MM-DD
                if (key.startsWith('Attendance ')) cols.add(key)
                else if (/^attendance_\d{4}_\d{2}_\d{2}$/.test(keyLower)) cols.add(key)
                else if (/^\d{4}-\d{2}-\d{2}$/.test(key)) cols.add(key)
            })
        })
        return [...cols].sort()
    }, [previewData])

    // Get attendance counts for a row
    const getAttendanceCounts = useCallback((row) => {
        let present = 0
        let absent = 0
        dateColumns.forEach(date => {
            const val = row[date]
            if (val === 'Present' || val === true) present++
            else if (val === 'Absent' || val === false) absent++
        })
        return { present, absent }
    }, [dateColumns])

    // Export to CSV
    const handleExport = useCallback(() => {
        if (previewData.length === 0) {
            toast.info('No data to export. Load preview first.')
            return
        }
        setIsExporting(true)
        try {
            // Build CSV header
            const header = [...columns, 'Month']
            const colCount = header.length

            // Pad a row to match column count
            const padRow = (cells) => {
                const padded = [...cells]
                while (padded.length < colCount) padded.push('')
                return padded.map(c => `"${String(c).replace(/"/g, '""')}"`).join(',')
            }

            // Helper to format phone numbers - use ="0..." so Google Sheets preserves leading zeros
            const formatPhone = (val) => {
                if (!val) return ''
                const str = String(val).trim()
                if (!str) return ''
                const digits = str.replace(/\D/g, '')
                if (!digits) return str
                const withZero = digits.startsWith('0') ? digits : '0' + digits
                return `="${withZero}"`
            }

            // Helper to normalize gender values
            const normalizeGender = (val) => {
                if (!val) return ''
                const str = String(val).trim().toLowerCase()
                if (str === 'm' || str === 'male') return 'Male'
                if (str === 'f' || str === 'female') return 'Female'
                return val
            }

            const lines = []

            // Summary section - clean cells, no # comments
            const monthsList = selectedMonths.map(m => m.replace('_', ' ')).join(', ')
            lines.push(padRow([`EXPORT: ${monthsList}`, '', '', `Generated: ${new Date().toLocaleDateString()}`]))
            lines.push(padRow([]))
            lines.push(padRow(['Total Members', summary.total, '', 'Male', summary.boys, '', 'Female', summary.girls]))
            lines.push(padRow([]))

            // Column headers
            lines.push(header.map(h => `"${h}"`).join(','))

            // Data rows
            previewData.forEach(row => {
                const cells = columns.map(col => {
                    let v = row[col] ?? row[col.toLowerCase().replace(/ /g, '_')] ?? ''

                    if (col === 'Phone Number' || col === 'Parent Phone Number') {
                        return formatPhone(v)
                    }

                    if (col === 'Gender') {
                        v = normalizeGender(v)
                    }

                    if (typeof v === 'string') v = v.replace(/"/g, '""')
                    return `"${v}"`
                })
                cells.push(`"${(row._month || '').replace('_', ' ')}"`)
                lines.push(cells.join(','))
            })

            const csvContent = lines.join('\n')

            // Download
            const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' })
            const url = URL.createObjectURL(blob)
            const link = document.createElement('a')
            link.href = url
            link.download = `export_${selectedMonths.length > 1 ? 'multiple_months' : selectedMonths[0] || 'data'}.csv`
            document.body.appendChild(link)
            link.click()
            document.body.removeChild(link)
            URL.revokeObjectURL(url)

            toast.success(`Exported ${previewData.length} records`)
        } catch (err) {
            console.error('Export error:', err)
            toast.error('Export failed')
        } finally {
            setIsExporting(false)
        }
    }, [previewData, columns, selectedMonths, summary])

    // Export attendance-only (present/absent only, no nulls)
    const handleExportAttendanceOnly = useCallback(() => {
        if (selectedMonths.length === 0) {
            toast.info('Select at least one month to export')
            return
        }
        setIsExporting(true)
        try {
            const lines = []
            
            // Summary section
            const monthsList = selectedMonths.map(m => m.replace('_', ' ')).join(', ')
            lines.push(`"ATTENDANCE EXPORT: ${monthsList}","","","Generated: ${new Date().toLocaleDateString()}"`)
            lines.push('')
            lines.push(`"Total Records","${previewData.length}"`)
            lines.push('')

            // Headers: Name, Date, Status
            lines.push('"Member Name","Date","Status"')

            // Collect all attendance records (present/absent only, exclude nulls)
            const attendanceRecords = []
            
            previewData.forEach(row => {
                const memberName = row['full_name'] || row['Full Name'] || row.name || 'Unknown'
                const month = row._month || ''
                
                // Iterate through all columns to find attendance columns
                Object.keys(row).forEach(key => {
                    const keyLower = key.toLowerCase()
                    // Match attendance columns: attendance_YYYY_MM_DD or Attendance DD
                    const isAttendanceCol = /^attendance_\d{4}_\d{2}_\d{2}$/.test(keyLower) || /^attendance\s+\d+/.test(key)
                    
                    if (isAttendanceCol) {
                        const value = row[key]
                        // Only include if it's explicitly true (present) or false (absent)
                        if (value === true || value === 'Present' || value === 'P') {
                            const dateStr = keyLower.includes('_') 
                                ? keyLower.replace('attendance_', '').replace(/_/g, '-')
                                : key.replace(/^Attendance\s+/, '')
                            attendanceRecords.push({
                                name: memberName,
                                date: dateStr,
                                status: 'Present'
                            })
                        } else if (value === false || value === 'Absent' || value === 'A') {
                            const dateStr = keyLower.includes('_')
                                ? keyLower.replace('attendance_', '').replace(/_/g, '-')
                                : key.replace(/^Attendance\s+/, '')
                            attendanceRecords.push({
                                name: memberName,
                                date: dateStr,
                                status: 'Absent'
                            })
                        }
                        // Null, undefined, empty string, or '-' are excluded
                    }
                })
            })

            // Sort by name, then by date
            attendanceRecords.sort((a, b) => {
                if (a.name !== b.name) return a.name.localeCompare(b.name)
                return a.date.localeCompare(b.date)
            })

            // Add data rows
            attendanceRecords.forEach(record => {
                lines.push(`"${record.name.replace(/"/g, '""')}","${record.date}","${record.status}"`)
            })

            const csvContent = lines.join('\n')

            // Download
            const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' })
            const url = URL.createObjectURL(blob)
            const link = document.createElement('a')
            link.href = url
            link.download = `attendance_only_${selectedMonths.length > 1 ? 'multiple_months' : selectedMonths[0] || 'data'}.csv`
            document.body.appendChild(link)
            link.click()
            document.body.removeChild(link)
            URL.revokeObjectURL(url)

            toast.success(`Exported ${attendanceRecords.length} attendance records (present/absent only)`)
        } catch (err) {
            console.error('Attendance export error:', err)
            toast.error('Export failed')
        } finally {
            setIsExporting(false)
        }
    }, [previewData, selectedMonths])

    return (
        <div className="min-h-screen bg-gray-50 dark:bg-gray-900 pb-24">
            {/* Header */}
            <div className="sticky top-0 z-30 bg-white dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700 px-4 py-3 flex items-center gap-3">
                <button
                    onClick={onBack}
                    className="p-2 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
                >
                    <ChevronLeft className="w-5 h-5 text-gray-600 dark:text-gray-300" />
                </button>
                <div className="flex items-center gap-2">
                    <FileSpreadsheet className="w-5 h-5 text-orange-600 dark:text-orange-400" />
                    <h1 className="text-lg font-semibold text-gray-900 dark:text-white">Export Center</h1>
                </div>
            </div>

            <div className="max-w-7xl mx-auto p-4 lg:p-6 space-y-6">
                {/* Month Selection */}
                <section className="bg-white dark:bg-gray-800 rounded-xl shadow p-4 lg:p-6">
                    <div className="flex items-center justify-between mb-3">
                        <h2 className="font-semibold text-gray-900 dark:text-white flex items-center gap-2">
                            <Calendar className="w-4 h-4 text-orange-500" /> Select Months
                        </h2>
                        <button
                            onClick={handleSelectAll}
                            className="text-xs px-2 py-1 rounded bg-orange-100 dark:bg-orange-900/30 text-orange-700 dark:text-orange-300 hover:bg-orange-200 dark:hover:bg-orange-800/40 transition-colors"
                        >
                            {selectAll ? 'Deselect All' : 'Select All'}
                        </button>
                    </div>
                    <div className="space-y-3 max-h-56 overflow-y-auto pr-1">
                        {years.map(year => (
                            <div key={year}>
                                <div className="text-xs font-bold text-gray-500 dark:text-gray-400 mb-1">{year}</div>
                                <div className="flex flex-wrap gap-2">
                                    {(monthsByYear[year] || []).map(table => {
                                        const selected = selectedMonths.includes(table)
                                        return (
                                            <button
                                                key={table}
                                                onClick={() => toggleMonth(table)}
                                                className={`px-3 py-1 rounded-full text-sm font-medium border transition-colors ${selected
                                                    ? 'bg-orange-600 text-white border-orange-600'
                                                    : 'bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-200 border-gray-200 dark:border-gray-600 hover:border-orange-400'
                                                    }`}
                                            >
                                                {table.replace('_', ' ')}
                                            </button>
                                        )
                                    })}
                                </div>
                            </div>
                        ))}
                        {years.length === 0 && (
                            <p className="text-gray-400 text-sm">No months available</p>
                        )}
                    </div>
                </section>

                {/* Column Order */}
                <section className="bg-white dark:bg-gray-800 rounded-xl shadow p-4 lg:p-6">
                    <h2 className="font-semibold text-gray-900 dark:text-white mb-2 flex items-center gap-2">
                        <GripVertical className="w-4 h-4 text-gray-400" /> Column Order
                    </h2>
                    <p className="text-xs text-gray-500 dark:text-gray-400 mb-2">Drag to reorder • Click X to remove</p>
                    <div className="grid grid-cols-1 lg:grid-cols-2 gap-2">
                        {columns.map((col, idx) => (
                            <div
                                key={col}
                                draggable
                                onDragStart={() => handleDragStart(idx)}
                                onDragOver={handleDragOver}
                                onDrop={() => handleDrop(idx)}
                                className={`flex items-center gap-2 px-3 py-2 rounded-lg bg-gray-50 dark:bg-gray-700 border border-gray-200 dark:border-gray-600 cursor-grab select-none ${draggedIdx === idx ? 'opacity-50' : ''
                                    }`}
                            >
                                <GripVertical className="w-4 h-4 text-gray-400" />
                                <span className="flex-1 text-sm text-gray-800 dark:text-gray-100">{col}</span>
                                <button
                                    onClick={(e) => {
                                        e.stopPropagation()
                                        setColumns(prev => prev.filter((_, i) => i !== idx))
                                    }}
                                    className="p-1 hover:bg-red-100 dark:hover:bg-red-900/30 rounded transition-colors"
                                    title="Remove column"
                                >
                                    <X className="w-4 h-4 text-gray-400 hover:text-red-600 dark:hover:text-red-400" />
                                </button>
                            </div>
                        ))}
                    </div>
                </section>

                {/* Preview Button */}
                <button
                    onClick={fetchPreview}
                    disabled={selectedMonths.length === 0 || loadingPreview}
                    className="w-full flex items-center justify-center gap-2 py-3 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white font-semibold transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                >
                    {loadingPreview ? <Loader2 className="w-5 h-5 animate-spin" /> : <Eye className="w-5 h-5" />}
                    {loadingPreview ? 'Loading Preview...' : 'Preview Data'}
                </button>

                {/* Preview Section */}
                {showPreview && (
                    <section className="bg-white dark:bg-gray-800 rounded-xl shadow p-4 lg:p-6">
                        <div className="flex items-center justify-between mb-3">
                            <h2 className="font-semibold text-gray-900 dark:text-white flex items-center gap-2">
                                <Users className="w-4 h-4 text-green-500" /> Preview
                            </h2>
                            <span className="text-xs text-gray-500 dark:text-gray-400">{previewData.length} records</span>
                        </div>

                        {/* Summary Stats */}
                        <div className="bg-gradient-to-br from-orange-50 to-indigo-50 dark:from-orange-900/20 dark:to-indigo-900/20 rounded-xl p-4 lg:p-6 mb-6 border border-orange-200 dark:border-orange-800">
                            <h3 className="text-sm font-bold text-gray-700 dark:text-gray-200 mb-3 flex items-center gap-2">
                                <FileSpreadsheet className="w-4 h-4 text-orange-600 dark:text-orange-400" />
                                Export Summary
                            </h3>
                            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                                <div className="bg-white dark:bg-gray-800 rounded-xl p-3 lg:p-4 shadow-sm border border-orange-100 dark:border-orange-800">
                                    <div className="text-2xl lg:text-3xl font-bold text-orange-600 dark:text-orange-400">{summary.monthsCount}</div>
                                    <div className="text-xs lg:text-sm text-gray-600 dark:text-gray-300 font-medium">Month{summary.monthsCount !== 1 ? 's' : ''} Selected</div>
                                </div>
                                <div className="bg-white dark:bg-gray-800 rounded-xl p-3 lg:p-4 shadow-sm border border-green-100 dark:border-green-800">
                                    <div className="text-2xl lg:text-3xl font-bold text-green-600 dark:text-green-400">{summary.total}</div>
                                    <div className="text-xs lg:text-sm text-gray-600 dark:text-gray-300 font-medium">Total Members</div>
                                </div>
                                <div className="bg-white dark:bg-gray-800 rounded-xl p-3 lg:p-4 shadow-sm border border-indigo-100 dark:border-indigo-800">
                                    <div className="text-2xl lg:text-3xl font-bold text-indigo-600 dark:text-indigo-400">{summary.boys}</div>
                                    <div className="text-xs lg:text-sm text-gray-600 dark:text-gray-300 font-medium">Male Members</div>
                                </div>
                                <div className="bg-white dark:bg-gray-800 rounded-xl p-3 lg:p-4 shadow-sm border border-pink-100 dark:border-pink-800">
                                    <div className="text-2xl lg:text-3xl font-bold text-pink-600 dark:text-pink-400">{summary.girls}</div>
                                    <div className="text-xs lg:text-sm text-gray-600 dark:text-gray-300 font-medium">Female Members</div>
                                </div>
                            </div>
                            <div className="mt-4 pt-4 border-t border-orange-200 dark:border-orange-800">
                                <p className="text-xs lg:text-sm text-gray-600 dark:text-gray-400">
                                    <strong>Ready to export:</strong> {summary.total} member{summary.total !== 1 ? 's' : ''} from {summary.monthsCount} month{summary.monthsCount !== 1 ? 's' : ''} 
                                    ({summary.boys} male, {summary.girls} female). All phone numbers will be formatted with leading zero. Gender values normalized to "Male"/"Female".
                                </p>
                            </div>
                        </div>

                        {/* Preview Mode Toggle */}
                        <div className="flex gap-2 mb-4">
                            <button
                                onClick={() => setPreviewMode('standard')}
                                className={`flex-1 py-2 px-3 rounded-lg font-medium text-sm transition-all ${previewMode === 'standard'
                                    ? 'bg-orange-600 text-white shadow-md'
                                    : 'bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-200 hover:bg-gray-200 dark:hover:bg-gray-600'
                                    }`}
                            >
                                Standard View
                            </button>
                            <button
                                onClick={() => setPreviewMode('archive')}
                                className={`flex-1 py-2 px-3 rounded-lg font-medium text-sm transition-all ${previewMode === 'archive'
                                    ? 'bg-amber-600 text-white shadow-md'
                                    : 'bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-200 hover:bg-gray-200 dark:hover:bg-gray-600'
                                    }`}
                            >
                                Archive View
                            </button>
                        </div>

                        {/* Table Preview */}
                        <div className="overflow-x-auto max-h-96 lg:max-h-[600px] border border-gray-200 dark:border-gray-700 rounded-lg">
                            <table className="min-w-full text-xs lg:text-sm">
                                <thead className="bg-gray-100 dark:bg-gray-700 sticky top-0 z-10">
                                    <tr>
                                        {previewMode === 'standard' ? (
                                            <>
                                                {columns.map(col => (
                                                    <th key={col} className="px-3 lg:px-4 py-2 lg:py-3 text-left text-gray-700 dark:text-gray-200 font-semibold whitespace-nowrap">{col}</th>
                                                ))}
                                                <th className="px-3 lg:px-4 py-2 lg:py-3 text-left text-gray-700 dark:text-gray-200 font-semibold whitespace-nowrap">Month</th>
                                            </>
                                        ) : (
                                            <>
                                                <th className="px-3 lg:px-4 py-2 lg:py-3 text-left text-gray-700 dark:text-gray-200 font-semibold whitespace-nowrap">Full Name</th>
                                                {dateColumns.map(col => {
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
                                                <th className="px-3 py-2 text-left text-gray-700 dark:text-gray-200 font-semibold whitespace-nowrap">Present</th>
                                                <th className="px-3 py-2 text-left text-gray-700 dark:text-gray-200 font-semibold whitespace-nowrap">Absent</th>
                                            </>
                                        )}
                                    </tr>
                                </thead>
                                <tbody>
                                    {previewMode === 'standard' ? (
                                        previewData.slice(0, 100).map((row, i) => (
                                            <tr key={i} className="border-t border-gray-100 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-700/50 transition-colors">
                                                {columns.map(col => (
                                                    <td key={col} className="px-3 lg:px-4 py-2 text-gray-800 dark:text-gray-100 whitespace-nowrap">
                                                        {row[col] ?? row[col.toLowerCase().replace(/ /g, '_')] ?? '-'}
                                                    </td>
                                                ))}
                                                <td className="px-3 lg:px-4 py-2 text-gray-500 dark:text-gray-400 whitespace-nowrap">{(row._month || '').replace('_', ' ')}</td>
                                            </tr>
                                        ))
                                    ) : (
                                        previewData.slice(0, 100).map((row, i) => {
                                            const counts = getAttendanceCounts(row)
                                            return (
                                                <tr key={i} className="border-t border-gray-100 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-700/50 transition-colors">
                                                    <td className="px-3 py-2 text-gray-800 dark:text-gray-100 whitespace-nowrap font-medium">
                                                        {row['full_name'] || row['Full Name'] || row.name || 'Unknown'}
                                                    </td>
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
                                                    <td className="px-3 py-2 text-gray-800 dark:text-gray-100 whitespace-nowrap font-semibold">{counts.present}</td>
                                                    <td className="px-3 py-2 text-gray-800 dark:text-gray-100 whitespace-nowrap font-semibold">{counts.absent}</td>
                                                </tr>
                                            )
                                        })
                                    )}
                                    {previewData.length > 100 && (
                                        <tr>
                                            <td colSpan={previewMode === 'standard' ? columns.length + 1 : dateColumns.length + 3} className="px-3 py-3 text-center text-gray-400 text-xs lg:text-sm bg-gray-50 dark:bg-gray-700/50">
                                                ...and {previewData.length - 100} more rows (all will be included in export)
                                            </td>
                                        </tr>
                                    )}
                                    {previewData.length === 0 && (
                                        <tr>
                                            <td colSpan={previewMode === 'standard' ? columns.length + 1 : dateColumns.length + 3} className="px-2 py-4 text-center text-gray-400">No data</td>
                                        </tr>
                                    )}
                                </tbody>
                            </table>
                        </div>
                    </section>
                )}

                {/* Export Mode Selection */}
                <div className="flex gap-3 mb-4">
                    <button
                        onClick={() => setExportMode('standard')}
                        className={`flex-1 py-3 px-4 rounded-lg font-semibold transition-all ${exportMode === 'standard'
                            ? 'bg-orange-600 text-white shadow-md'
                            : 'bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-200 hover:bg-gray-200 dark:hover:bg-gray-600'
                            }`}
                    >
                        Standard Export
                    </button>
                    <button
                        onClick={() => setExportMode('attendance-only')}
                        className={`flex-1 py-3 px-4 rounded-lg font-semibold transition-all ${exportMode === 'attendance-only'
                            ? 'bg-purple-600 text-white shadow-md'
                            : 'bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-200 hover:bg-gray-200 dark:hover:bg-gray-600'
                            }`}
                    >
                        Attendance Only
                    </button>
                </div>

                {/* Export Mode Description */}
                <div className="bg-gray-50 dark:bg-gray-700/30 border border-gray-200 dark:border-gray-700 rounded-lg p-3 mb-4">
                    <p className="text-xs lg:text-sm text-gray-600 dark:text-gray-300">
                        {exportMode === 'standard'
                            ? '📋 Standard Export: Includes all member data with attendance columns (P/A/-)'
                            : '✓ Attendance Only: Exports only Present/Absent records, excludes nulls and unmarked entries. Format: Member Name, Date, Status'}
                    </p>
                </div>

                {/* Export Button */}
                <button
                    onClick={exportMode === 'standard' ? handleExport : handleExportAttendanceOnly}
                    disabled={previewData.length === 0 || isExporting}
                    className="w-full flex items-center justify-center gap-2 py-4 lg:py-5 rounded-xl text-white text-base lg:text-lg font-bold shadow-lg hover:shadow-xl transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                    style={{
                        backgroundColor: exportMode === 'standard' ? '#16a34a' : '#9333ea',
                    }}
                    onMouseEnter={(e) => {
                        e.currentTarget.style.backgroundColor = exportMode === 'standard' ? '#15803d' : '#7e22ce'
                    }}
                    onMouseLeave={(e) => {
                        e.currentTarget.style.backgroundColor = exportMode === 'standard' ? '#16a34a' : '#9333ea'
                    }}
                >
                    {isExporting ? <Loader2 className="w-6 h-6 animate-spin" /> : <Download className="w-6 h-6" />}
                    {isExporting ? 'Exporting...' : `Export ${exportMode === 'standard' ? 'to CSV for Google Sheets' : 'Attendance Records'}`}
                </button>

                <p className="text-xs text-gray-400 dark:text-gray-500 text-center">
                    {exportMode === 'standard'
                        ? 'The exported CSV includes a summary header and can be imported directly into Google Sheets.'
                        : 'Exports only Present/Absent records with member name, date, and status. Perfect for attendance reports.'}
                </p>
                <div className="bg-orange-50 dark:bg-orange-900/20 border border-orange-200 dark:border-orange-800 rounded-lg p-3 mt-3">
                    <p className="text-xs text-orange-600 dark:text-orange-400 text-center">
                        This export keeps your data in the database. To free up storage space, use <strong>Archive Month</strong> in Settings → Data Management.
                    </p>
                </div>
            </div>
        </div>
    )
}

export default ExportCenterPage
