import React, { useCallback, useMemo, useState, useEffect, useRef, Suspense } from 'react'
import {
    ChevronLeft,
    Download,
    Calendar,
    FileSpreadsheet,
    GripVertical,
    Eye,
    Users,
    Loader2,
    X,
    Check,
    ClipboardList,
    Table2,
    Phone,
    MessageCircle,
    Copy,
    CheckSquare,
    Square,
    FileText,
    Layout,
    ArrowRight,
    UserCheck,
    Smartphone,
    BarChart3,
    SlidersHorizontal,
    Sparkles,
    TrendingUp
} from 'lucide-react'
import { useApp } from '../context/AppContext'
import { supabase } from '../lib/supabase'
import { toast } from 'react-toastify'
import lazyWithRetry from '../utils/lazyWithRetry'

const ExportContactsModal = lazyWithRetry(() => import('./ExportContactsModal'))

const MONTHS = [
    'January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December'
]

const defaultColumns = [
    'Full Name',
    'Gender',
    'Phone Number',
    'Age',
    'Current Level',
    'Parent Name',
    'Parent Phone Number'
]

const getOrdinalSuffix = (day) => {
    const value = Number(day)
    if (!Number.isFinite(value)) return 'th'
    if (value % 100 >= 11 && value % 100 <= 13) return 'th'
    switch (value % 10) {
        case 1:
            return 'st'
        case 2:
            return 'nd'
        case 3:
            return 'rd'
        default:
            return 'th'
    }
}

const parseTableName = (tableName) => {
    if (!tableName || typeof tableName !== 'string') return null
    const [monthName, yearValue] = tableName.split('_')
    const monthIndex = MONTHS.indexOf(monthName)
    const year = Number(yearValue)
    if (monthIndex < 0 || !Number.isFinite(year)) return null
    return { monthName, monthIndex, year }
}

const getLocalDateKey = (date) => {
    const year = date.getFullYear()
    const month = String(date.getMonth() + 1).padStart(2, '0')
    const day = String(date.getDate()).padStart(2, '0')
    return `${year}-${month}-${day}`
}

const getSundaysForTable = (tableName) => {
    const parsed = parseTableName(tableName)
    if (!parsed) return []

    const date = new Date(parsed.year, parsed.monthIndex, 1)
    while (date.getDay() !== 0) date.setDate(date.getDate() + 1)

    const sundays = []
    while (date.getMonth() === parsed.monthIndex) {
        const day = date.getDate()
        const dateKey = getLocalDateKey(date)
        sundays.push({
            table: tableName,
            dateKey,
            columnKey: `attendance_${dateKey.replace(/-/g, '_')}`,
            legacyColumnKey: `Attendance ${day}${getOrdinalSuffix(day)}`,
            label: date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
            weekdayLabel: date.toLocaleDateString('en-US', { weekday: 'short' }),
            day
        })
        date.setDate(date.getDate() + 7)
    }
    return sundays
}

const formatTableName = (tableName) => tableName ? tableName.replace('_', ' ') : ''

const getRowValue = (row, column) => {
    if (!row) return ''
    const snake = column.toLowerCase().replace(/ /g, '_')
    const aliases = {
        'Full Name': ['Full Name', 'full_name', 'name'],
        'Gender': ['Gender', 'gender'],
        'Phone Number': ['Phone Number', 'phone_number', 'phoneNumber', 'phone', 'Phone'],
        'Age': ['Age', 'age'],
        'Current Level': ['Current Level', 'current_level', 'currentLevel', 'age_group'],
        'Parent Name': ['Parent Name', 'parent_name', 'parent_name_1', 'parentName'],
        'Parent Phone Number': ['Parent Phone Number', 'parent_phone_number', 'parent_phone_1', 'parentPhone']
    }

    const keys = aliases[column] || [column, snake]
    for (const key of keys) {
        if (row[key] !== undefined && row[key] !== null) return row[key]
    }
    return ''
}

const normalizeGender = (value) => {
    if (value === undefined || value === null) return ''
    const normalized = String(value).trim().toLowerCase()
    if (normalized === 'm' || normalized === 'male') return 'Male'
    if (normalized === 'f' || normalized === 'female') return 'Female'
    return String(value).trim()
}

const normalizeLevel = (value) => {
    if (value === undefined || value === null) return ''
    return String(value).trim().toUpperCase()
}

const normalizePhone = (value) => {
    if (value === undefined || value === null) return ''
    const raw = String(value).trim()
    if (!raw) return ''

    const digits = raw.replace(/\D/g, '')
    if (!digits) return raw
    if (digits.startsWith('233') && digits.length >= 12) return `0${digits.slice(3)}`
    if (digits.startsWith('0')) return digits
    return `0${digits}`
}

const normalizeExportCell = (column, value, csvPhone = false) => {
    if (column === 'Gender') return normalizeGender(value)
    if (column === 'Current Level') return normalizeLevel(value)
    if (column === 'Phone Number' || column === 'Parent Phone Number') {
        const phone = normalizePhone(value)
        return csvPhone && phone ? `="${phone}"` : phone
    }
    return value ?? ''
}

const normalizeAttendanceValue = (value) => {
    if (value === true || value === false) return value
    if (typeof value !== 'string') return undefined
    const normalized = value.trim().toLowerCase()
    if (normalized === 'present' || normalized === 'p' || normalized === 'true') return true
    if (normalized === 'absent' || normalized === 'a' || normalized === 'false') return false
    return undefined
}

const resolveAttendanceForDate = (row, sunday, attendanceData = {}) => {
    if (!row || !sunday) return undefined

    const attendanceMap = attendanceData[sunday.dateKey] || {}
    if (row.id !== undefined && Object.prototype.hasOwnProperty.call(attendanceMap, row.id)) {
        const mapValue = normalizeAttendanceValue(attendanceMap[row.id])
        if (mapValue !== undefined) return mapValue
    }

    const possibleKeys = [
        sunday.columnKey,
        sunday.legacyColumnKey,
        sunday.dateKey,
        sunday.columnKey.toLowerCase(),
        sunday.legacyColumnKey.toLowerCase()
    ]

    for (const key of possibleKeys) {
        if (Object.prototype.hasOwnProperty.call(row, key)) {
            const rowValue = normalizeAttendanceValue(row[key])
            if (rowValue !== undefined) return rowValue
        }
    }

    for (const key in row) {
        const lower = key.toLowerCase()
        if (lower === sunday.columnKey || lower === sunday.legacyColumnKey.toLowerCase()) {
            const rowValue = normalizeAttendanceValue(row[key])
            if (rowValue !== undefined) return rowValue
        }
    }

    return undefined
}

const getAttendanceMark = (value) => {
    const normalized = normalizeAttendanceValue(value)
    if (normalized === true) return 'P'
    if (normalized === false) return 'A'
    return '-'
}

const csvCell = (value) => `"${String(value ?? '').replace(/"/g, '""')}"`

const escapeVCardValue = (value) => String(value ?? '')
    .replace(/\\/g, '\\\\')
    .replace(/\n/g, '\\n')
    .replace(/,/g, '\\,')
    .replace(/;/g, '\\;')

// --- Memoized Sub-components ---

const ExportStatCard = React.memo(({ label, value, tone = 'neutral', icon: Icon }) => {
    const toneClass = {
        neutral: 'border-gray-200 bg-white text-gray-950 dark:border-gray-800 dark:bg-gray-900 dark:text-white',
        orange: 'border-orange-200 bg-orange-50 text-orange-700 dark:border-orange-900/40 dark:bg-orange-950/20 dark:text-orange-300',
        green: 'border-green-200 bg-green-50 text-green-700 dark:border-green-900/40 dark:bg-green-950/20 dark:text-green-300',
        red: 'border-red-200 bg-red-50 text-red-700 dark:border-red-900/40 dark:bg-red-950/20 dark:text-red-300'
    }[tone] || ''

    return (
        <div className={`rounded-2xl border p-4 shadow-sm transition-transform duration-200 hover:-translate-y-0.5 ${toneClass}`}>
            <div className="flex items-center justify-between gap-3">
                <p className="text-[10px] font-black uppercase tracking-[0.18em] opacity-60">{label}</p>
                {Icon && <Icon className="h-4 w-4 opacity-70" />}
            </div>
            <p className="mt-2 text-2xl font-black leading-none">{value}</p>
        </div>
    )
})
ExportStatCard.displayName = 'ExportStatCard'

const formatAverage = (value) => {
    const number = Number(value)
    if (!Number.isFinite(number)) return '0'
    if (number === 0) return '0'
    return number % 1 === 0 ? String(number) : number.toFixed(1)
}

const MonthlyAttendanceInsights = React.memo(({ analytics, previewLoaded }) => {
    const hasMonths = analytics.months.length > 0

    return (
        <section className="export-center-card export-center-reveal overflow-hidden rounded-3xl border border-orange-200/70 bg-white shadow-sm dark:border-orange-900/40 dark:bg-gray-900">
            <div className="border-b border-orange-100 bg-gradient-to-r from-orange-50 via-white to-amber-50 p-4 dark:border-orange-900/30 dark:from-orange-950/20 dark:via-gray-900 dark:to-amber-950/10">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                    <div>
                        <div className="inline-flex items-center gap-2 rounded-full bg-orange-100 px-3 py-1 text-[10px] font-black uppercase tracking-[0.18em] text-orange-700 dark:bg-orange-900/30 dark:text-orange-300">
                            <BarChart3 className="h-3.5 w-3.5" />
                            Attendance Intelligence
                        </div>
                        <h2 className="mt-3 text-lg font-black tracking-tight text-gray-950 dark:text-white">Monthly averages before you export</h2>
                        <p className="mt-1 text-sm text-gray-600 dark:text-gray-400">
                            Uses the same selected Sundays and preview rows as the export, so the totals match the file you download.
                        </p>
                    </div>
                    <div className="rounded-2xl bg-gray-950 px-4 py-3 text-white shadow-lg shadow-black/10 dark:bg-white dark:text-gray-950">
                        <p className="text-[9px] font-black uppercase tracking-[0.16em] opacity-60">Overall weekly avg</p>
                        <p className="mt-1 text-2xl font-black leading-none">{formatAverage(analytics.overallAveragePresent)}</p>
                    </div>
                </div>
            </div>

            <div className="p-4">
                {!previewLoaded && (
                    <div className="mb-4 rounded-2xl border border-dashed border-orange-200 bg-orange-50/60 p-3 text-xs font-bold text-orange-800 dark:border-orange-900/50 dark:bg-orange-950/20 dark:text-orange-200">
                        Select a month, then tap Preview & Load to calculate attendance totals from live rows.
                    </div>
                )}

                <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
                    <div className="rounded-2xl border border-gray-200 bg-gray-50 p-3 dark:border-gray-800 dark:bg-gray-950/50">
                        <p className="text-[9px] font-black uppercase tracking-[0.16em] text-gray-400">Total present</p>
                        <p className="mt-1 text-2xl font-black text-gray-950 dark:text-white">{analytics.totalPresent}</p>
                    </div>
                    <div className="rounded-2xl border border-gray-200 bg-gray-50 p-3 dark:border-gray-800 dark:bg-gray-950/50">
                        <p className="text-[9px] font-black uppercase tracking-[0.16em] text-gray-400">Total marked</p>
                        <p className="mt-1 text-2xl font-black text-gray-950 dark:text-white">{analytics.totalMarked}</p>
                    </div>
                    <div className="rounded-2xl border border-gray-200 bg-gray-50 p-3 dark:border-gray-800 dark:bg-gray-950/50">
                        <p className="text-[9px] font-black uppercase tracking-[0.16em] text-gray-400">Avg Sunday attendance</p>
                        <p className="mt-1 text-2xl font-black text-green-700 dark:text-green-300">{formatAverage(analytics.overallAveragePresent)}</p>
                    </div>
                    <div className="rounded-2xl border border-gray-200 bg-gray-50 p-3 dark:border-gray-800 dark:bg-gray-950/50">
                        <p className="text-[9px] font-black uppercase tracking-[0.16em] text-gray-400">Sundays counted</p>
                        <p className="mt-1 text-2xl font-black text-orange-700 dark:text-orange-300">{analytics.totalSundays}</p>
                    </div>
                </div>

                <div className="mt-4 space-y-3">
                    {hasMonths ? analytics.months.map(month => (
                        <article key={month.table} className="rounded-2xl border border-gray-200 bg-white p-3 dark:border-gray-800 dark:bg-gray-950/40">
                            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                                <div>
                                    <h3 className="font-black text-gray-950 dark:text-white">{month.label}</h3>
                                    <p className="text-xs text-gray-500 dark:text-gray-400">
                                        {month.sundayCount} Sundays · {month.rowCount} preview rows
                                    </p>
                                </div>
                                <div className="grid grid-cols-3 gap-2 text-center sm:min-w-[22rem]">
                                    <div className="rounded-xl bg-green-50 p-2 dark:bg-green-950/20">
                                        <p className="text-[8px] font-black uppercase text-green-600 dark:text-green-300">Total</p>
                                        <p className="text-lg font-black text-green-700 dark:text-green-200">{month.totalPresent}</p>
                                    </div>
                                    <div className="rounded-xl bg-orange-50 p-2 dark:bg-orange-950/20">
                                        <p className="text-[8px] font-black uppercase text-orange-600 dark:text-orange-300">Avg / week</p>
                                        <p className="text-lg font-black text-orange-700 dark:text-orange-200">{formatAverage(month.averagePresent)}</p>
                                    </div>
                                    <div className="rounded-xl bg-gray-100 p-2 dark:bg-gray-800">
                                        <p className="text-[8px] font-black uppercase text-gray-500">Marked avg</p>
                                        <p className="text-lg font-black text-gray-900 dark:text-white">{formatAverage(month.averageMarked)}</p>
                                    </div>
                                </div>
                            </div>
                            <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
                                {month.sundays.map(day => (
                                    <div key={day.dateKey} className="rounded-xl bg-gray-50 p-2 dark:bg-gray-900">
                                        <p className="text-[10px] font-black text-gray-700 dark:text-gray-200">{day.label}</p>
                                        <p className="mt-1 text-[11px] font-bold text-gray-500">
                                            {day.present} present · {day.absent} absent
                                        </p>
                                    </div>
                                ))}
                            </div>
                        </article>
                    )) : (
                        <div className="rounded-2xl bg-gray-50 p-4 text-center text-sm font-bold text-gray-500 dark:bg-gray-950/50 dark:text-gray-400">
                            No month selected yet.
                        </div>
                    )}
                </div>
            </div>
        </section>
    )
})
MonthlyAttendanceInsights.displayName = 'MonthlyAttendanceInsights'

const MonthComparisonSection = React.memo(({
    monthlyTables,
    comparisonMonths,
    setComparisonMonths,
    comparisonData,
    loadingComparison,
    loadMonthComparison,
    allMonthSundays,
    formatTableName
}) => {
    const toggleComparisonMonth = (table) => {
        setComparisonMonths(prev => (
            prev.includes(table)
                ? prev.filter(item => item !== table)
                : [...prev, table]
        ))
    }

    return (
        <section className="export-center-card export-center-reveal rounded-3xl border border-orange-200/70 bg-gradient-to-br from-white via-orange-50/50 to-white p-4 shadow-sm dark:border-orange-900/40 dark:from-gray-950 dark:via-orange-950/10 dark:to-gray-950 md:p-5">
            <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                <div className="max-w-2xl">
                    <div className="inline-flex items-center gap-2 rounded-full bg-orange-100 px-3 py-1 text-[10px] font-black uppercase tracking-[0.18em] text-orange-700 dark:bg-orange-900/30 dark:text-orange-300">
                        <TrendingUp className="h-3.5 w-3.5" />
                        Month Comparison
                    </div>
                    <h2 className="mt-3 text-xl font-black text-gray-950 dark:text-white">Compare attendance patterns without loading everything first</h2>
                    <p className="mt-1 text-sm text-gray-600 dark:text-gray-400">
                        Pick two or more months, then load only those months to compare Sundays, present, absent, marked, and missing counts.
                    </p>
                </div>
                <button
                    type="button"
                    onClick={loadMonthComparison}
                    disabled={comparisonMonths.length < 2 || loadingComparison}
                    className="inline-flex min-h-[48px] items-center justify-center gap-2 rounded-2xl bg-gray-950 px-5 text-sm font-black text-white shadow-lg shadow-black/10 transition duration-200 hover:-translate-y-0.5 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-white dark:text-gray-950"
                >
                    {loadingComparison ? <Loader2 className="h-4 w-4 animate-spin" /> : <BarChart3 className="h-4 w-4" />}
                    {loadingComparison ? 'Loading comparison...' : 'Load comparison'}
                </button>
            </div>

            <div className="mt-5 flex gap-2 overflow-x-auto pb-2">
                {(monthlyTables || []).map(table => {
                    const selected = comparisonMonths.includes(table)
                    return (
                        <button
                            key={table}
                            type="button"
                            onClick={() => toggleComparisonMonth(table)}
                            className={`shrink-0 rounded-2xl border px-4 py-3 text-left transition duration-200 active:scale-[0.98] ${
                                selected
                                    ? 'border-orange-500 bg-orange-600 text-white shadow-lg shadow-orange-600/20'
                                    : 'border-gray-200 bg-white text-gray-700 hover:border-orange-300 dark:border-gray-800 dark:bg-gray-900 dark:text-gray-200'
                            }`}
                        >
                            <span className="block text-xs font-black">{formatTableName(table)}</span>
                            <span className="mt-1 block text-[10px] font-bold opacity-70">{(allMonthSundays[table] || []).length} Sundays</span>
                        </button>
                    )
                })}
            </div>

            {comparisonData.length > 0 && (
                <div className="mt-5 grid gap-4 lg:grid-cols-2">
                    {comparisonData.map(month => (
                        <article key={month.table} className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm dark:border-gray-800 dark:bg-gray-900">
                            <div className="flex items-center justify-between gap-3">
                                <div>
                                    <h3 className="font-black text-gray-950 dark:text-white">{formatTableName(month.table)}</h3>
                                    <p className="text-xs text-gray-500 dark:text-gray-400">{month.totalMembers} members checked across {month.sundays.length} Sundays</p>
                                </div>
                                <div className="rounded-2xl bg-orange-50 px-3 py-2 text-right dark:bg-orange-950/30">
                                    <p className="text-[10px] font-black uppercase text-orange-500">Marked</p>
                                    <p className="text-lg font-black text-orange-700 dark:text-orange-300">{month.markedTotal}</p>
                                </div>
                            </div>

                            <div className="mt-4 space-y-3">
                                {month.sundays.map(day => {
                                    const marked = day.present + day.absent
                                    const presentWidth = marked ? Math.round((day.present / marked) * 100) : 0
                                    const absentWidth = marked ? Math.round((day.absent / marked) * 100) : 0
                                    return (
                                        <div key={day.dateKey} className="rounded-2xl bg-gray-50 p-3 dark:bg-gray-950/50">
                                            <div className="flex items-center justify-between gap-3">
                                                <div>
                                                    <p className="text-sm font-black text-gray-900 dark:text-white">{day.label}</p>
                                                    <p className="text-[11px] text-gray-500">{day.dateKey}</p>
                                                </div>
                                                <p className="text-xs font-bold text-gray-500">{marked} marked · {day.missing} missing</p>
                                            </div>
                                            <div className="mt-3 flex h-2 overflow-hidden rounded-full bg-gray-200 dark:bg-gray-800">
                                                <span className="bg-green-500" style={{ width: `${presentWidth}%` }} />
                                                <span className="bg-red-500" style={{ width: `${absentWidth}%` }} />
                                            </div>
                                            <div className="mt-2 flex flex-wrap gap-2 text-[11px] font-bold">
                                                <span className="rounded-full bg-green-100 px-2 py-1 text-green-700 dark:bg-green-900/30 dark:text-green-300">{day.present} present</span>
                                                <span className="rounded-full bg-red-100 px-2 py-1 text-red-700 dark:bg-red-900/30 dark:text-red-300">{day.absent} absent</span>
                                                <span className="rounded-full bg-gray-100 px-2 py-1 text-gray-600 dark:bg-gray-800 dark:text-gray-300">{day.missing} unmarked</span>
                                            </div>
                                        </div>
                                    )
                                })}
                            </div>
                        </article>
                    ))}
                </div>
            )}
        </section>
    )
})
MonthComparisonSection.displayName = 'MonthComparisonSection'

const ServiceDatesSection = React.memo(({
    years,
    monthsByYear,
    selectedMonths,
    selectedDateKeys,
    allMonthSundays,
    toggleMonth,
    setMonthSundaySelection,
    toggleSunday,
    allMonthsSelected,
    handleSelectAllMonths,
    formatTableName
}) => {
    return (
        <section className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 shadow-sm overflow-hidden">
            <div className="p-5 border-b border-gray-100 dark:border-gray-800 flex items-center justify-between bg-gray-50/50 dark:bg-gray-800/30">
                <div className="flex items-center gap-3">
                    <div className="h-8 w-8 rounded-lg bg-orange-100 dark:bg-orange-900/40 flex items-center justify-center">
                        <Calendar className="w-4 h-4 text-orange-600 dark:text-orange-400" />
                    </div>
                    <h2 className="font-bold text-gray-900 dark:text-white">Service Dates</h2>
                </div>
                <button
                    onClick={handleSelectAllMonths}
                    className="text-xs font-bold px-3 py-1.5 rounded-full bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-300 hover:border-orange-500 transition-all active:scale-95"
                >
                    {allMonthsSelected ? 'Clear All' : 'Select All'}
                </button>
            </div>

            <div className="p-4 space-y-5 max-h-[560px] overflow-y-auto custom-scrollbar md:p-5">
                {years.map(year => (
                    <div key={year} className="space-y-4">
                        <div className="flex items-center gap-3">
                            <span className="text-[10px] font-black uppercase tracking-[0.2em] text-gray-400 dark:text-gray-500">{year}</span>
                            <div className="h-px flex-1 bg-gray-100 dark:bg-gray-800" />
                        </div>
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                            {(monthsByYear[year] || []).map(table => {
                                const selected = selectedMonths.includes(table)
                                const sundays = allMonthSundays[table] || []
                                const selectedCount = sundays.filter(sunday => selectedDateKeys.includes(sunday.dateKey)).length
                                const allSundaysSelected = selectedCount === sundays.length && sundays.length > 0

                                return (
                                    <div
                                        key={table}
                                        className={`rounded-xl border p-4 transition-all duration-300 ${selected
                                            ? 'border-orange-200 bg-orange-50/30 dark:border-orange-900/30 dark:bg-orange-950/10'
                                            : 'border-gray-100 bg-white dark:border-gray-800 dark:bg-gray-900/50 hover:border-gray-300 dark:hover:border-gray-700'
                                            }`}
                                    >
                                        <div className="flex items-center justify-between mb-4">
                                            <button
                                                onClick={() => toggleMonth(table)}
                                                className="flex items-center gap-3 group"
                                            >
                                                <div className={`h-5 w-5 rounded border flex items-center justify-center transition-all ${selected ? 'bg-orange-600 border-orange-600 text-white scale-110' : 'border-gray-300 dark:border-gray-600 group-hover:border-orange-400'}`}>
                                                    {selected && <Check className="w-3 h-3" />}
                                                </div>
                                                <span className={`font-bold text-sm ${selected ? 'text-gray-900 dark:text-white' : 'text-gray-500 dark:text-gray-400'}`}>{formatTableName(table)}</span>
                                            </button>
                                            <button
                                                onClick={() => setMonthSundaySelection(table, !allSundaysSelected)}
                                                className={`text-[10px] font-bold px-2 py-1 rounded-md transition-all ${allSundaysSelected ? 'bg-orange-100 text-orange-700 dark:bg-orange-900/40' : 'text-gray-400 hover:text-orange-500'}`}
                                            >
                                                {allSundaysSelected ? 'All Selected' : 'Select All'}
                                            </button>
                                        </div>

                                        <div className="grid grid-cols-2 gap-2">
                                            {sundays.map(sunday => {
                                                const isSelected = selectedDateKeys.includes(sunday.dateKey)
                                                return (
                                                    <button
                                                        key={sunday.dateKey}
                                                        onClick={() => toggleSunday(table, sunday.dateKey)}
                                                        className={`px-3 py-2 rounded-xl text-left border transition-all active:scale-95 ${isSelected
                                                            ? 'bg-orange-600 border-orange-600 text-white shadow-lg shadow-orange-600/20'
                                                            : 'bg-white dark:bg-gray-800 border-gray-100 dark:border-gray-700 text-gray-700 dark:text-gray-300 hover:border-orange-300'
                                                            }`}
                                                    >
                                                        <span className="block text-[9px] font-black uppercase opacity-60 leading-none mb-1">{sunday.weekdayLabel}</span>
                                                        <span className="block text-xs font-bold leading-none">{sunday.label}</span>
                                                    </button>
                                                )
                                            })}
                                        </div>
                                    </div>
                                )
                            })}
                        </div>
                    </div>
                ))}
            </div>
        </section>
    )
})
ServiceDatesSection.displayName = 'ServiceDatesSection'

const PreviewRow = React.memo(({ row, columns, selectedSundays, attendanceData, isSelected, toggleRowSelection, previewMode, normalizeExportCell, getRowValue, formatTableName, getAttendanceMark, resolveAttendanceForDate }) => {
    const rowKey = `${row.id}-${row._month}`
    return (
        <tr
            onClick={() => toggleRowSelection(rowKey)}
            className={`group cursor-pointer transition-all ${isSelected ? 'bg-orange-50/20 dark:bg-orange-950/5' : 'hover:bg-gray-50/50 dark:hover:bg-gray-800/30'}`}
        >
            <td className="px-4 py-3 sticky left-0 z-10 bg-inherit text-center">
                <div className={`h-4 w-4 rounded border-2 flex items-center justify-center transition-all ${isSelected ? 'bg-orange-600 border-orange-600 text-white scale-110' : 'border-gray-200 dark:border-gray-700 group-hover:border-orange-300'}`}>
                    {isSelected && <CheckSquare className="w-2.5 h-2.5" />}
                </div>
            </td>
            {previewMode === 'standard' ? (
                <>
                    {columns.map(col => (
                        <td key={col} className={`px-4 py-3 whitespace-nowrap font-medium ${isSelected ? 'text-gray-900 dark:text-white' : 'text-gray-500'}`}>
                            {normalizeExportCell(col, getRowValue(row, col)) || '-'}
                        </td>
                    ))}
                    <td className="px-4 py-3 text-gray-400 font-bold whitespace-nowrap">{formatTableName(row._month)}</td>
                    {selectedSundays.map(sunday => {
                        const mark = getAttendanceMark(resolveAttendanceForDate(row, sunday, attendanceData))
                        return (
                            <td key={`${sunday.table}-${sunday.dateKey}`} className="px-4 py-3 whitespace-nowrap">
                                <div className={`h-5 w-8 flex items-center justify-center rounded-md text-[9px] font-black ${mark === 'P'
                                    ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300'
                                    : mark === 'A'
                                        ? 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300'
                                        : 'bg-gray-50 text-gray-300 dark:bg-gray-800 dark:text-gray-600'
                                    }`}>
                                    {mark}
                                </div>
                            </td>
                        )
                    })}
                </>
            ) : (
                <>
                    <td className={`px-4 py-3 whitespace-nowrap font-bold ${isSelected ? 'text-gray-900 dark:text-white' : 'text-gray-500'}`}>{getRowValue(row, 'Full Name') || 'Unknown'}</td>
                    <td className="px-4 py-3 text-gray-400 font-bold whitespace-nowrap">{formatTableName(row._month)}</td>
                    {selectedSundays.map(sunday => {
                        const mark = getAttendanceMark(resolveAttendanceForDate(row, sunday, attendanceData))
                        return (
                            <td key={`${sunday.table}-${sunday.dateKey}`} className="px-4 py-3 whitespace-nowrap">
                                <div className={`h-5 w-8 flex items-center justify-center rounded-md text-[9px] font-black ${mark === 'P'
                                    ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300'
                                    : mark === 'A'
                                        ? 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300'
                                        : 'bg-gray-50 text-gray-300 dark:bg-gray-800 dark:text-gray-600'
                                    }`}>
                                    {mark}
                                </div>
                            </td>
                        )
                    })}
                </>
            )}
        </tr>
    )
})
PreviewRow.displayName = 'PreviewRow'

const PreviewTable = React.memo(({
    displayedPreviewData,
    selectedRows,
    columns,
    selectedSundays,
    attendanceData,
    previewMode,
    toggleRowSelection,
    handleSelectAllRows,
    handleClearRowSelection,
    selectedPreviewDataCount,
    normalizeExportCell,
    getRowValue,
    formatTableName,
    getAttendanceMark,
    resolveAttendanceForDate,
    setPreviewMode
}) => {
    return (
        <section className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 shadow-sm overflow-hidden">
            <div className="p-4 border-b border-gray-100 dark:border-gray-800 flex items-center justify-between">
                <div className="flex items-center gap-2.5">
                    <div className="h-7 w-7 rounded-lg bg-blue-100 dark:bg-blue-900/40 flex items-center justify-center">
                        <Layout className="w-3.5 h-3.5 text-blue-600 dark:text-blue-400" />
                    </div>
                    <h2 className="font-bold text-sm text-gray-900 dark:text-white">Detailed Preview</h2>
                </div>
                <div className="flex items-center gap-1.5 bg-gray-100 dark:bg-gray-800 p-1 rounded-lg">
                    <button
                        onClick={() => setPreviewMode('standard')}
                        className={`px-2.5 py-1 rounded-md text-[9px] font-black uppercase tracking-wider transition-all ${previewMode === 'standard' ? 'bg-white dark:bg-gray-900 text-gray-950 dark:text-white shadow-sm' : 'text-gray-500'}`}
                    >
                        Standard
                    </button>
                    <button
                        onClick={() => setPreviewMode('attendance')}
                        className={`px-2.5 py-1 rounded-md text-[9px] font-black uppercase tracking-wider transition-all ${previewMode === 'attendance' ? 'bg-white dark:bg-gray-900 text-gray-950 dark:text-white shadow-sm' : 'text-gray-500'}`}
                    >
                        Attendance
                    </button>
                </div>
            </div>

            <div className="bg-gray-50/50 dark:bg-gray-800/20 px-4 py-2.5 flex items-center justify-between border-b border-gray-100 dark:border-gray-800">
                <div className="flex gap-3">
                    <button onClick={handleSelectAllRows} className="text-[9px] font-black uppercase text-orange-600 hover:text-orange-700 transition-all">Select All</button>
                    <button onClick={handleClearRowSelection} className="text-[9px] font-black uppercase text-gray-400 hover:text-gray-600 transition-all">Deselect</button>
                </div>
                <p className="text-[9px] font-bold text-gray-500 uppercase">{selectedPreviewDataCount} rows selected</p>
            </div>

            <div className="overflow-x-auto max-h-[500px] custom-scrollbar">
                <table className="min-w-full text-[11px]">
                    <thead className="sticky top-0 z-10 bg-white dark:bg-gray-900 border-b border-gray-100 dark:border-gray-800">
                        <tr>
                            <th className="px-4 py-3 w-10 sticky left-0 z-20 bg-white dark:bg-gray-900" />
                            {previewMode === 'standard' ? (
                                <>
                                    {columns.map(col => (
                                        <th key={col} className="px-4 py-3 text-left text-[9px] font-black uppercase tracking-widest text-gray-400">{col}</th>
                                    ))}
                                    <th className="px-4 py-3 text-left text-[9px] font-black uppercase tracking-widest text-gray-400">Month</th>
                                    {selectedSundays.map(sunday => (
                                        <th key={`${sunday.table}-${sunday.dateKey}`} className="px-4 py-3 text-left text-[9px] font-black uppercase tracking-widest text-gray-400 whitespace-nowrap">
                                            {sunday.label}
                                        </th>
                                    ))}
                                </>
                            ) : (
                                <>
                                    <th className="px-4 py-3 text-left text-[9px] font-black uppercase tracking-widest text-gray-400">Full Name</th>
                                    <th className="px-4 py-3 text-left text-[9px] font-black uppercase tracking-widest text-gray-400">Month</th>
                                    {selectedSundays.map(sunday => (
                                        <th key={`${sunday.table}-${sunday.dateKey}`} className="px-4 py-3 text-left text-[9px] font-black uppercase tracking-widest text-gray-400 whitespace-nowrap">
                                            {sunday.label}
                                        </th>
                                    ))}
                                </>
                            )}
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-50 dark:divide-gray-800">
                        {displayedPreviewData.slice(0, 100).map((row, index) => (
                            <PreviewRow
                                key={`${row.id || index}-${row._month || ''}`}
                                row={row}
                                columns={columns}
                                selectedSundays={selectedSundays}
                                attendanceData={attendanceData}
                                isSelected={selectedRows.has(`${row.id}-${row._month}`)}
                                toggleRowSelection={toggleRowSelection}
                                previewMode={previewMode}
                                normalizeExportCell={normalizeExportCell}
                                getRowValue={getRowValue}
                                formatTableName={formatTableName}
                                getAttendanceMark={getAttendanceMark}
                                resolveAttendanceForDate={resolveAttendanceForDate}
                            />
                        ))}
                    </tbody>
                </table>
            </div>
        </section>
    )
})
PreviewTable.displayName = 'PreviewTable'

const ExportCenterPage = ({ onBack }) => {
    const { monthlyTables, members, attendanceData, currentTable, isSupabaseConfigured } = useApp()

    const [selectedMonths, setSelectedMonths] = useState([])
    const [selectedDateKeys, setSelectedDateKeys] = useState([])
    const [columns, setColumns] = useState(defaultColumns)
    const [draggedIdx, setDraggedIdx] = useState(null)
    const [showPreview, setShowPreview] = useState(false)
    const [previewData, setPreviewData] = useState([])
    const [loadingPreview, setLoadingPreview] = useState(false)
    const [previewMode, setPreviewMode] = useState('standard')
    const [isExporting, setIsExporting] = useState(false)
    const [exportMode, setExportMode] = useState('standard')
    const [reportNote, setReportNote] = useState('P means Present. A means Absent. Blank means no attendance was marked.')
    const [whatsAppMessage, setWhatsAppMessage] = useState('Please see the attendance update.')
    const [includeWhatsAppMessage, setIncludeWhatsAppMessage] = useState(false)
    const [summaryMode, setSummaryMode] = useState('all')
    const [summaryFields, setSummaryFields] = useState({
        month: true,
        total: true,
        male: true,
        female: true,
        present: true,
        absent: true,
        sundays: true,
        legend: true,
        note: true
    })
    const [isEditingWhatsAppDraft, setIsEditingWhatsAppDraft] = useState(false)
    const [whatsAppDraft, setWhatsAppDraft] = useState('')
    const [selectedRows, setSelectedRows] = useState(new Set())
    const [isExportContactsModalOpen, setIsExportContactsModalOpen] = useState(false)
    const [showAdvancedSettings, setShowAdvancedSettings] = useState(false)
    const [showMonthComparison, setShowMonthComparison] = useState(false)
    const [comparisonMonths, setComparisonMonths] = useState([])
    const [comparisonData, setComparisonData] = useState([])
    const [loadingComparison, setLoadingComparison] = useState(false)
    const workerRef = useRef(null)

    useEffect(() => {
        // Initialize worker
        try {
            workerRef.current = new Worker(new URL('../exportWorker.js', import.meta.url), { type: 'module' })
            workerRef.current.onmessage = (e) => {
                const { success, url, filename, error } = e.data
                if (success) {
                    const link = document.createElement('a')
                    link.href = url
                    link.download = filename
                    document.body.appendChild(link)
                    link.click()
                    document.body.removeChild(link)
                    // We don't revoke immediately to ensure download starts
                    setTimeout(() => URL.revokeObjectURL(url), 10000)
                    toast.success('Export completed successfully')
                } else {
                    toast.error(`Export failed: ${error}`)
                }
                setIsExporting(false)
            }
        } catch (err) {
            console.error('Failed to initialize export worker:', err)
        }

        return () => {
            if (workerRef.current) workerRef.current.terminate()
        }
    }, [])

    const allMonthSundays = useMemo(() => {
        const map = {}
        ;(monthlyTables || []).forEach(table => {
            map[table] = getSundaysForTable(table)
        })
        return map
    }, [monthlyTables])

    const monthsByYear = useMemo(() => {
        const grouped = {}
        ;(monthlyTables || []).forEach(table => {
            const parsed = parseTableName(table)
            const year = parsed?.year || 'Other'
            if (!grouped[year]) grouped[year] = []
            grouped[year].push(table)
        })

        Object.keys(grouped).forEach(year => {
            grouped[year].sort((a, b) => {
                const aParsed = parseTableName(a)
                const bParsed = parseTableName(b)
                return (aParsed?.monthIndex ?? 0) - (bParsed?.monthIndex ?? 0)
            })
        })

        return grouped
    }, [monthlyTables])

    const years = useMemo(() => (
        Object.keys(monthsByYear).sort((a, b) => Number(b) - Number(a))
    ), [monthsByYear])

    const selectedSundays = useMemo(() => (
        selectedMonths
            .flatMap(table => allMonthSundays[table] || [])
            .filter(sunday => selectedDateKeys.includes(sunday.dateKey))
            .sort((a, b) => a.dateKey.localeCompare(b.dateKey))
    ), [allMonthSundays, selectedDateKeys, selectedMonths])

    const totalAvailableSundays = useMemo(() => (
        selectedMonths.reduce((count, table) => count + (allMonthSundays[table]?.length || 0), 0)
    ), [allMonthSundays, selectedMonths])

    const toggleMonth = (table) => {
        const monthSundays = allMonthSundays[table] || []
        const monthDateKeys = monthSundays.map(sunday => sunday.dateKey)

        setSelectedMonths(prev => {
            const exists = prev.includes(table)
            return exists ? prev.filter(t => t !== table) : [...prev, table]
        })

        setSelectedDateKeys(prev => {
            const exists = selectedMonths.includes(table)
            if (exists) return prev.filter(dateKey => !monthDateKeys.includes(dateKey))
            return [...new Set([...prev, ...monthDateKeys])]
        })
    }

    const handleSelectAllMonths = () => {
        const allTables = monthlyTables || []
        const allSelected = selectedMonths.length === allTables.length && allTables.length > 0
        if (allSelected) {
            setSelectedMonths([])
            setSelectedDateKeys([])
            return
        }

        setSelectedMonths([...allTables])
        setSelectedDateKeys([...new Set(allTables.flatMap(table => (allMonthSundays[table] || []).map(sunday => sunday.dateKey)))])
    }

    const setMonthSundaySelection = (table, shouldSelectAll) => {
        const monthDateKeys = (allMonthSundays[table] || []).map(sunday => sunday.dateKey)
        setSelectedMonths(prev => {
            if (shouldSelectAll) return prev.includes(table) ? prev : [...prev, table]
            return prev.filter(item => item !== table)
        })
        setSelectedDateKeys(prev => {
            if (shouldSelectAll) return [...new Set([...prev, ...monthDateKeys])]
            return prev.filter(dateKey => !monthDateKeys.includes(dateKey))
        })
    }

    const toggleSunday = (table, dateKey) => {
        setSelectedMonths(prev => prev.includes(table) ? prev : [...prev, table])
        setSelectedDateKeys(prev => (
            prev.includes(dateKey) ? prev.filter(item => item !== dateKey) : [...prev, dateKey]
        ))
    }

    const handleDragStart = (idx) => setDraggedIdx(idx)
    const handleDragOver = (event) => event.preventDefault()
    const handleDrop = (idx) => {
        if (draggedIdx === null || draggedIdx === idx) return
        const newCols = [...columns]
        const [removed] = newCols.splice(draggedIdx, 1)
        newCols.splice(idx, 0, removed)
        setColumns(newCols)
        setDraggedIdx(null)
    }

    const fetchPreview = useCallback(async () => {
        if (selectedMonths.length === 0) {
            toast.info('Select at least one month to preview')
            return
        }
        if (selectedSundays.length === 0) {
            toast.info('Select at least one Sunday to include')
            return
        }

        setLoadingPreview(true)
        setShowPreview(true)
        try {
            let allRows = []
            for (const table of selectedMonths) {
                if (!isSupabaseConfigured()) {
                    allRows = allRows.concat(members.map(member => ({ ...member, _month: table })))
                } else {
                    let tableRows = []
                    let offset = 0
                    const pageSize = 1000
                    while (true) {
                        const { data, error } = await supabase
                            .from(table)
                            .select('*')
                            .range(offset, offset + pageSize - 1)

                        if (error) throw error
                        if (!data || data.length === 0) break
                        tableRows = tableRows.concat(data)
                        if (data.length < pageSize) break
                        offset += pageSize
                    }
                    allRows = allRows.concat(tableRows.map(row => ({ ...row, _month: table })))
                }
            }
            if (allRows.length === 0 && currentTable && selectedMonths.includes(currentTable) && members.length > 0) {
                allRows = members.map(member => ({ ...member, _month: currentTable }))
            }
            setPreviewData(allRows)
            setSelectedRows(new Set(allRows.map(row => `${row.id}-${row._month}`)))
        } catch (err) {
            console.error('Preview fetch error:', err)
            toast.error('Failed to load preview')
        } finally {
            setLoadingPreview(false)
        }
    }, [currentTable, isSupabaseConfigured, members, selectedMonths, selectedSundays.length])

    const toggleRowSelection = (rowKey) => {
        setSelectedRows(prev => {
            const next = new Set(prev)
            if (next.has(rowKey)) {
                next.delete(rowKey)
            } else {
                next.add(rowKey)
            }
            return next
        })
    }

    const handleSelectAllRows = () => {
        const rows = exportMode === 'marked-members' ? markedPreviewData : previewData
        setSelectedRows(new Set(rows.map(row => `${row.id}-${row._month}`)))
    }

    const handleClearRowSelection = () => {
        setSelectedRows(new Set())
    }

    const summary = useMemo(() => {
        const total = previewData.length
        const boys = previewData.filter(row => normalizeGender(getRowValue(row, 'Gender')) === 'Male').length
        const girls = previewData.filter(row => normalizeGender(getRowValue(row, 'Gender')) === 'Female').length
        const markedMembers = previewData.filter(row => (
            selectedSundays.some(sunday => resolveAttendanceForDate(row, sunday, attendanceData) !== undefined)
        )).length
        const markedAttendance = previewData.reduce((sum, row) => {
            return sum + selectedSundays.filter(sunday => resolveAttendanceForDate(row, sunday, attendanceData) !== undefined).length
        }, 0)
        return {
            total,
            boys,
            girls,
            markedMembers,
            monthsCount: selectedMonths.length,
            sundayCount: selectedSundays.length,
            markedAttendance
        }
    }, [attendanceData, previewData, selectedMonths.length, selectedSundays])

    const markedPreviewData = useMemo(() => (
        previewData.filter(row => (
            selectedSundays.some(sunday => resolveAttendanceForDate(row, sunday, attendanceData) !== undefined)
        ))
    ), [attendanceData, previewData, selectedSundays])

    const displayedPreviewData = exportMode === 'marked-members' ? markedPreviewData : previewData

    const selectedPreviewData = useMemo(() => (
        displayedPreviewData.filter(row => selectedRows.has(`${row.id}-${row._month}`))
    ), [displayedPreviewData, selectedRows])

    const displayedSummary = useMemo(() => ({
        total: selectedPreviewData.length,
        boys: selectedPreviewData.filter(row => normalizeGender(getRowValue(row, 'Gender')) === 'Male').length,
        girls: selectedPreviewData.filter(row => normalizeGender(getRowValue(row, 'Gender')) === 'Female').length
    }), [selectedPreviewData])

    const reportStats = useMemo(() => {
        let present = 0
        let absent = 0
        selectedPreviewData.forEach(row => {
            selectedSundays.forEach(sunday => {
                const value = resolveAttendanceForDate(row, sunday, attendanceData)
                if (value === true) present++
                if (value === false) absent++
            })
        })
        return {
            monthLabel: selectedMonths.map(formatTableName).join(', ') || 'No month selected',
            total: displayedSummary.total,
            male: displayedSummary.boys,
            female: displayedSummary.girls,
            present,
            absent,
            sundays: selectedSundays.length
        }
    }, [attendanceData, selectedPreviewData, displayedSummary, selectedMonths, selectedSundays])

    const attendanceAnalytics = useMemo(() => {
        const selectedMonthSet = new Set(selectedMonths)
        const monthRows = new Map()
        const loadedRows = selectedPreviewData.length > 0 ? selectedPreviewData : []

        selectedMonths.forEach(table => monthRows.set(table, []))
        loadedRows.forEach(row => {
            const table = row._month || currentTable
            if (!selectedMonthSet.has(table)) return
            if (!monthRows.has(table)) monthRows.set(table, [])
            monthRows.get(table).push(row)
        })

        let totalPresent = 0
        let totalAbsent = 0
        let totalMarked = 0
        let totalSundays = 0

        const months = selectedMonths.map(table => {
            const rows = monthRows.get(table) || []
            const sundays = selectedSundays.filter(sunday => sunday.table === table)
            let monthPresent = 0
            let monthAbsent = 0

            const sundayStats = sundays.map(sunday => {
                let present = 0
                let absent = 0
                rows.forEach(row => {
                    const value = resolveAttendanceForDate(row, sunday, attendanceData)
                    if (value === true) present += 1
                    if (value === false) absent += 1
                })
                monthPresent += present
                monthAbsent += absent
                return {
                    ...sunday,
                    present,
                    absent,
                    marked: present + absent
                }
            })

            const monthMarked = monthPresent + monthAbsent
            totalPresent += monthPresent
            totalAbsent += monthAbsent
            totalMarked += monthMarked
            totalSundays += sundays.length

            return {
                table,
                label: formatTableName(table),
                rowCount: rows.length,
                sundayCount: sundays.length,
                totalPresent: monthPresent,
                totalAbsent: monthAbsent,
                totalMarked: monthMarked,
                averagePresent: sundays.length ? monthPresent / sundays.length : 0,
                averageMarked: sundays.length ? monthMarked / sundays.length : 0,
                sundays: sundayStats
            }
        })

        return {
            months,
            totalPresent,
            totalAbsent,
            totalMarked,
            totalSundays,
            overallAveragePresent: totalSundays ? totalPresent / totalSundays : 0,
            overallAverageMarked: totalSundays ? totalMarked / totalSundays : 0
        }
    }, [attendanceData, currentTable, selectedMonths, selectedPreviewData, selectedSundays])

    const allReportHeaderLines = useMemo(() => ({
        month: `Month: ${reportStats.monthLabel}`,
        total: `Total Members: ${reportStats.total}`,
        male: `Male: ${reportStats.male}`,
        female: `Female: ${reportStats.female}`,
        present: `Total Present: ${reportStats.present}`,
        absent: `Total Absent: ${reportStats.absent}`,
        sundays: `Selected Sundays: ${reportStats.sundays}`,
        legend: 'Legend: P = Present, A = Absent',
        note: reportNote.trim() ? `Note: ${reportNote.trim()}` : ''
    }), [reportNote, reportStats])

    const reportHeaderLines = useMemo(() => (
        Object.keys(summaryFields)
            .filter(key => summaryFields[key] && allReportHeaderLines[key])
            .map(key => allReportHeaderLines[key])
    ), [allReportHeaderLines, summaryFields])

    const whatsAppSummaryLines = useMemo(() => {
        if (summaryMode === 'none') return []
        if (summaryMode === 'all') return Object.values(allReportHeaderLines).filter(Boolean)
        return reportHeaderLines
    }, [allReportHeaderLines, reportHeaderLines, summaryMode])

    const buildWhatsAppFullReport = useCallback(() => {
        const lines = [
            '*Attendance Export Summary*',
            ...whatsAppSummaryLines,
            '',
            '*Members*'
        ]

        selectedPreviewData.forEach((row, index) => {
            const name = getRowValue(row, 'Full Name') || 'Unknown'
            const phone = normalizePhone(getRowValue(row, 'Phone Number')) || 'No phone'
            const marks = selectedSundays.map(sunday => `${sunday.label}: ${getAttendanceMark(resolveAttendanceForDate(row, sunday, attendanceData))}`).join(', ')
            lines.push(`${index + 1}. ${name} | ${phone} | ${marks || 'No selected Sundays'}`)
        })

        if (selectedPreviewData.length === 0) {
            lines.push('No members selected for export.')
        }

        return lines.join('\n')
    }, [attendanceData, selectedPreviewData, selectedSundays, whatsAppSummaryLines])

    const buildWhatsAppPhoneList = useCallback(() => {
        const message = whatsAppMessage.trim()
        const lines = [
            '*Attendance Contact List*',
            ...whatsAppSummaryLines,
            includeWhatsAppMessage && message ? `Message: ${message}` : '',
            '',
            ...selectedPreviewData.map((row, index) => {
                const name = getRowValue(row, 'Full Name') || 'Unknown'
                const phone = normalizePhone(getRowValue(row, 'Phone Number')) || 'No phone'
                return `${index + 1}. ${name} - ${phone}${includeWhatsAppMessage && message ? ` - ${message}` : ''}`
            })
        ].filter(line => line !== '')

        if (selectedPreviewData.length === 0) {
            lines.push('No members selected.')
        }

        return lines.join('\n')
    }, [selectedPreviewData, includeWhatsAppMessage, whatsAppMessage, whatsAppSummaryLines])

    const generatedWhatsAppDraft = useMemo(() => buildWhatsAppFullReport(), [buildWhatsAppFullReport])
    const generatedPhoneDraft = useMemo(() => buildWhatsAppPhoneList(), [buildWhatsAppPhoneList])
    const activeWhatsAppText = isEditingWhatsAppDraft ? whatsAppDraft : generatedWhatsAppDraft

    const copyToClipboard = useCallback(async (text, successMessage) => {
        try {
            if (navigator.clipboard?.writeText) {
                await navigator.clipboard.writeText(text)
            } else {
                throw new Error('Clipboard API unavailable')
            }
            toast.success(successMessage)
        } catch (error) {
            try {
                const textarea = document.createElement('textarea')
                textarea.value = text
                textarea.setAttribute('readonly', '')
                textarea.style.position = 'fixed'
                textarea.style.left = '-9999px'
                document.body.appendChild(textarea)
                textarea.select()
                document.execCommand('copy')
                document.body.removeChild(textarea)
                toast.success(successMessage)
            } catch (fallbackError) {
                console.error('Clipboard copy failed:', error, fallbackError)
                toast.error('Could not copy to clipboard')
            }
        }
    }, [])

    const handleStartEditWhatsAppDraft = () => {
        setWhatsAppDraft(activeWhatsAppText)
        setIsEditingWhatsAppDraft(true)
    }

    const handleResetWhatsAppDraft = () => {
        setWhatsAppDraft('')
        setIsEditingWhatsAppDraft(false)
    }

    const downloadVCardContacts = useCallback(() => {
        const contactRows = selectedPreviewData
            .map(row => {
                const name = String(getRowValue(row, 'Full Name') || '').trim()
                const phone = normalizePhone(getRowValue(row, 'Phone Number'))
                return { name, phone }
            })
            .filter(contact => contact.name && contact.phone && contact.phone !== 'No phone')

        if (contactRows.length === 0) {
            toast.info('No selected contacts with phone numbers to export.')
            return
        }

        const vcfContent = contactRows.map(contact => [
            'BEGIN:VCARD',
            'VERSION:3.0',
            `FN:${escapeVCardValue(contact.name)}`,
            `N:${escapeVCardValue(contact.name)};;;;`,
            `TEL;TYPE=CELL:${contact.phone}`,
            'END:VCARD'
        ].join('\n')).join('\n')

        const blob = new Blob([vcfContent], { type: 'text/vcard;charset=utf-8;' })
        const url = URL.createObjectURL(blob)

        const isMobile = /iPhone|iPad|iPod|Android/i.test(navigator.userAgent)

        if (isMobile) {
            // On mobile, navigating directly to the blob URL often triggers the system's contact handler
            window.location.href = url
        } else {
            const link = document.createElement('a')
            link.href = url
            link.download = `contacts_${selectedMonths.length > 1 ? 'multiple_months' : selectedMonths[0] || 'export'}.vcf`
            document.body.appendChild(link)
            link.click()
            document.body.removeChild(link)
        }

        // Delay revocation to ensure the browser has handled the URL
        setTimeout(() => URL.revokeObjectURL(url), 10000)
        toast.success(`Exported ${contactRows.length} contacts`)
    }, [selectedPreviewData, selectedMonths])

    const downloadCSVContacts = useCallback(() => {
        const contactRows = selectedPreviewData
            .map(row => {
                const name = String(getRowValue(row, 'Full Name') || '').trim()
                const phone = normalizePhone(getRowValue(row, 'Phone Number'))
                return { name, phone }
            })
            .filter(contact => contact.name && contact.phone && contact.phone !== 'No phone')

        if (contactRows.length === 0) {
            toast.info('No selected contacts with phone numbers to export.')
            return
        }

        const header = ['Full Name', 'Phone Number']
        const csvContent = [
            header.join(','),
            ...contactRows.map(c => `${csvCell(c.name)},${csvCell(c.phone)}`)
        ].join('\n')

        const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' })
        const url = URL.createObjectURL(blob)
        const link = document.createElement('a')
        link.href = url
        link.download = `contacts_${selectedMonths.length > 1 ? 'multiple_months' : selectedMonths[0] || 'export'}.csv`
        document.body.appendChild(link)
        link.click()
        document.body.removeChild(link)
        URL.revokeObjectURL(url)
        toast.success(`Exported ${contactRows.length} contacts to CSV`)
    }, [selectedPreviewData, selectedMonths])

    const handleExport = useCallback(() => {
        const rowsToExport = selectedPreviewData

        if (selectedPreviewData.length === 0) {
            toast.info('No members selected to export.')
            return
        }
        if (selectedSundays.length === 0) {
            toast.info('Select at least one Sunday to export')
            return
        }

        setIsExporting(true)

        const filename = `${exportMode === 'marked-members' ? 'marked_members' : 'export'}_${selectedMonths.length > 1 ? 'multiple_months' : selectedMonths[0] || 'data'}.csv`

        if (workerRef.current) {
            workerRef.current.postMessage({
                type: 'fullExport',
                payload: {
                    rows: rowsToExport,
                    columns,
                    selectedMonths,
                    selectedSundays,
                    attendanceData,
                    reportHeaderLines,
                    summary,
                    exportMode,
                    filename
                }
            })
        } else {
            // Fallback to main thread if worker fails
            try {
                const attendanceHeaders = selectedSundays.map(sunday => `${formatTableName(sunday.table)} ${sunday.label}`)
                const header = [...columns, 'Month', ...attendanceHeaders]
                const monthsList = selectedMonths.map(formatTableName).join(', ')
                const lines = [
                    header.map(csvCell).join(','),
                    ...rowsToExport.map(row => {
                        const memberCells = columns.map(column => {
                            const value = normalizeExportCell(column, getRowValue(row, column), true)
                            return csvCell(value)
                        })
                        const attendanceCells = selectedSundays.map(sunday => (
                            csvCell(getAttendanceMark(resolveAttendanceForDate(row, sunday, attendanceData)))
                        ))
                        return [...memberCells, csvCell(formatTableName(row._month)), ...attendanceCells].join(',')
                    })
                ]

                lines.unshift('')
                lines.unshift(reportHeaderLines.map(csvCell).join(','))
                lines.unshift('')
                lines.unshift([
                    csvCell(`Members: ${rowsToExport.length}`),
                    csvCell(`Marked members: ${summary.markedMembers}`),
                    csvCell(`Attendance marks: ${summary.markedAttendance}`),
                    csvCell(`Sundays: ${summary.sundayCount}`),
                    csvCell(`Generated: ${new Date().toLocaleDateString()}`)
                ].join(','))
                lines.unshift([csvCell(`${exportMode === 'marked-members' ? 'MARKED MEMBERS EXPORT' : 'EXPORT'}: ${monthsList}`)].join(','))

                const csvContent = lines.join('\n')
                const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' })
                const url = URL.createObjectURL(blob)
                const link = document.createElement('a')
                link.href = url
                link.download = filename
                document.body.appendChild(link)
                link.click()
                document.body.removeChild(link)
                URL.revokeObjectURL(url)
                toast.success(`Exported ${rowsToExport.length} member records`)
                setIsExporting(false)
            } catch (err) {
                console.error('Export error:', err)
                toast.error('Export failed')
                setIsExporting(false)
            }
        }
    }, [attendanceData, columns, exportMode, selectedMonths, selectedSundays, summary, selectedPreviewData, reportHeaderLines])

    const handleExportAttendanceOnly = useCallback(() => {
        if (selectedPreviewData.length === 0) {
            toast.info('No members selected to export.')
            return
        }
        if (selectedSundays.length === 0) {
            toast.info('Select at least one Sunday to export')
            return
        }

        setIsExporting(true)
        const filename = `attendance_only_${selectedMonths.length > 1 ? 'multiple_months' : selectedMonths[0] || 'data'}.csv`

        if (workerRef.current) {
            workerRef.current.postMessage({
                type: 'attendanceOnly',
                payload: {
                    rows: selectedPreviewData,
                    selectedSundays,
                    attendanceData,
                    reportHeaderLines,
                    selectedMonths,
                    filename
                }
            })
        } else {
            try {
                const attendanceRecords = []
                selectedPreviewData.forEach(row => {
                    const memberName = getRowValue(row, 'Full Name') || 'Unknown'
                    selectedSundays.forEach(sunday => {
                        const value = resolveAttendanceForDate(row, sunday, attendanceData)
                        if (value === true || value === false) {
                            attendanceRecords.push({
                                name: memberName,
                                month: formatTableName(row._month || sunday.table),
                                date: sunday.dateKey,
                                status: value ? 'Present' : 'Absent'
                            })
                        }
                    })
                })

                attendanceRecords.sort((a, b) => {
                    if (a.date !== b.date) return a.date.localeCompare(b.date)
                    return a.name.localeCompare(b.name)
                })

                const monthsList = selectedMonths.map(formatTableName).join(', ')
                const lines = [
                    [csvCell(`ATTENDANCE EXPORT: ${monthsList}`), '', '', csvCell(`Generated: ${new Date().toLocaleDateString()}`)].join(','),
                    [csvCell(`Total Records`), csvCell(attendanceRecords.length)].join(','),
                    reportHeaderLines.map(csvCell).join(','),
                    '',
                    ['Member Name', 'Month', 'Date', 'Status'].map(csvCell).join(','),
                    ...attendanceRecords.map(record => (
                        [record.name, record.month, record.date, record.status].map(csvCell).join(',')
                    ))
                ]

                const csvContent = lines.join('\n')
                const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' })
                const url = URL.createObjectURL(blob)
                const link = document.createElement('a')
                link.href = url
                link.download = filename
                document.body.appendChild(link)
                link.click()
                document.body.removeChild(link)
                URL.revokeObjectURL(url)

                toast.success(`Exported ${attendanceRecords.length} attendance records`)
                setIsExporting(false)
            } catch (err) {
                console.error('Attendance export error:', err)
                toast.error('Export failed')
                setIsExporting(false)
            }
        }
    }, [attendanceData, selectedPreviewData, reportHeaderLines, selectedMonths, selectedSundays])

    const loadMonthComparison = useCallback(async () => {
        if (comparisonMonths.length < 2) {
            toast.info('Select at least two months to compare')
            return
        }

        setLoadingComparison(true)
        try {
            const nextComparison = []
            for (const table of comparisonMonths) {
                let rows = []
                if (!isSupabaseConfigured()) {
                    rows = currentTable === table ? members : []
                } else {
                    let offset = 0
                    const pageSize = 1000
                    while (true) {
                        const { data, error } = await supabase
                            .from(table)
                            .select('*')
                            .range(offset, offset + pageSize - 1)
                        if (error) throw error
                        if (!data || data.length === 0) break
                        rows = rows.concat(data)
                        if (data.length < pageSize) break
                        offset += pageSize
                    }
                }

                if (rows.length === 0 && currentTable === table && members.length > 0) {
                    rows = members
                }

                const sundays = (allMonthSundays[table] || []).map(sunday => {
                    let present = 0
                    let absent = 0
                    rows.forEach(row => {
                        const value = resolveAttendanceForDate(row, sunday, attendanceData)
                        if (value === true) present += 1
                        if (value === false) absent += 1
                    })
                    const marked = present + absent
                    return {
                        ...sunday,
                        present,
                        absent,
                        missing: Math.max(rows.length - marked, 0)
                    }
                })

                nextComparison.push({
                    table,
                    totalMembers: rows.length,
                    markedTotal: sundays.reduce((sum, sunday) => sum + sunday.present + sunday.absent, 0),
                    sundays
                })
            }
            setComparisonData(nextComparison)
            toast.success('Month comparison loaded')
        } catch (err) {
            console.error('Month comparison load failed:', err)
            toast.error(err?.message || 'Could not load month comparison')
        } finally {
            setLoadingComparison(false)
        }
    }, [allMonthSundays, attendanceData, comparisonMonths, currentTable, isSupabaseConfigured, members])

    const allMonthsSelected = selectedMonths.length === (monthlyTables || []).length && (monthlyTables || []).length > 0

    return (
        <div className="min-h-screen bg-transparent p-3 pb-24 font-sans selection:bg-orange-100 dark:selection:bg-orange-900/40 md:p-6 lg:p-8">
            <div className="export-center-shell overflow-hidden rounded-[1.75rem] border border-orange-100/80 bg-gradient-to-br from-white via-orange-50/35 to-white shadow-2xl dark:border-orange-900/30 dark:from-gray-950 dark:via-orange-950/10 dark:to-gray-950 md:rounded-[2rem]">
                {/* Simple Navigation Header */}
                <div className="flex-none border-b border-orange-100/70 bg-white/85 backdrop-blur-md dark:border-orange-900/30 dark:bg-gray-950/85">
                <div className="max-w-7xl mx-auto px-4 h-16 flex items-center justify-between">
                    <div className="flex items-center gap-4">
                        <button
                            onClick={onBack}
                            className="p-2 -ml-2 rounded-xl hover:bg-gray-100 dark:hover:bg-gray-800 text-gray-500 transition-all active:scale-95"
                        >
                            <ChevronLeft className="w-5 h-5" />
                        </button>
                        <div>
                            <h1 className="text-lg font-bold text-gray-900 dark:text-white leading-tight">Export Center</h1>
                            <div className="flex items-center gap-2 mt-0.5">
                                <span className="h-1.5 w-1.5 rounded-full bg-green-500 animate-pulse" />
                                <p className="text-[10px] font-bold uppercase tracking-wider text-gray-500 dark:text-gray-400">Ready to build</p>
                            </div>
                        </div>
                    </div>

                    <div className="flex items-center gap-2">
                        <div className="hidden sm:flex items-center bg-gray-100 dark:bg-gray-800 rounded-full px-3 py-1.5 gap-3">
                            <div className="flex items-center gap-1.5">
                                <div className="h-1.5 w-1.5 rounded-full bg-orange-500" />
                                <span className="text-[11px] font-bold text-gray-600 dark:text-gray-300 uppercase tracking-tight">{selectedSundays.length} Sundays</span>
                            </div>
                            <div className="h-3 w-px bg-gray-300 dark:bg-gray-700" />
                            <div className="flex items-center gap-1.5">
                                <div className="h-1.5 w-1.5 rounded-full bg-green-500" />
                                <span className="text-[11px] font-bold text-gray-600 dark:text-gray-300 uppercase tracking-tight">{selectedPreviewData.length} Selected</span>
                            </div>
                        </div>
                    </div>
                </div>
            </div>

                <div className="custom-scrollbar max-h-[calc(100vh-100px)] overflow-y-auto p-4 lg:p-7 space-y-6">
                    <section className="export-center-hero export-center-reveal rounded-[1.75rem] border border-orange-200/80 bg-gradient-to-br from-orange-600 via-orange-500 to-amber-400 p-5 text-white shadow-xl shadow-orange-500/20 md:p-6">
                        <div className="flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
                            <div className="max-w-2xl">
                                <div className="inline-flex items-center gap-2 rounded-full bg-white/15 px-3 py-1 text-[10px] font-black uppercase tracking-[0.18em]">
                                    <Sparkles className="h-3.5 w-3.5" />
                                    Export build desk
                                </div>
                                <h2 className="mt-3 text-2xl font-black tracking-tight md:text-3xl">Build clean attendance exports without guessing what is selected.</h2>
                                <p className="mt-2 max-w-xl text-sm font-medium text-white/85">
                                    Choose service dates, preview the exact rows, compare months only when needed, then download the export that matches your workflow.
                                </p>
                            </div>
                            <div className="grid grid-cols-3 gap-2 text-center sm:min-w-[22rem]">
                                <div className="rounded-2xl bg-white/15 p-3">
                                    <p className="text-[10px] font-black uppercase tracking-wide text-white/70">Months</p>
                                    <p className="text-2xl font-black">{selectedMonths.length}</p>
                                </div>
                                <div className="rounded-2xl bg-white/15 p-3">
                                    <p className="text-[10px] font-black uppercase tracking-wide text-white/70">Sundays</p>
                                    <p className="text-2xl font-black">{selectedSundays.length}</p>
                                </div>
                                <div className="rounded-2xl bg-white/15 p-3">
                                    <p className="text-[10px] font-black uppercase tracking-wide text-white/70">Rows</p>
                                    <p className="text-2xl font-black">{selectedPreviewData.length}</p>
                                </div>
                            </div>
                        </div>
                    </section>

                    {/* STEP 1: SERVICE DATES */}
                <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
                    <div className="lg:col-span-8 space-y-6">
                        <ServiceDatesSection
                            years={years}
                            monthsByYear={monthsByYear}
                            selectedMonths={selectedMonths}
                            selectedDateKeys={selectedDateKeys}
                            allMonthSundays={allMonthSundays}
                            toggleMonth={toggleMonth}
                            setMonthSundaySelection={setMonthSundaySelection}
                            toggleSunday={toggleSunday}
                            allMonthsSelected={allMonthsSelected}
                            handleSelectAllMonths={handleSelectAllMonths}
                            formatTableName={formatTableName}
                        />

                        <MonthlyAttendanceInsights
                            analytics={attendanceAnalytics}
                            previewLoaded={showPreview && previewData.length > 0}
                        />

                        <button
                            type="button"
                            onClick={() => setShowMonthComparison(prev => !prev)}
                            className="export-center-reveal flex w-full items-center justify-between rounded-3xl border border-orange-200/70 bg-white p-4 text-left shadow-sm transition duration-200 hover:-translate-y-0.5 hover:border-orange-300 dark:border-orange-900/40 dark:bg-gray-900"
                        >
                            <span className="flex items-center gap-3">
                                <span className="grid h-11 w-11 place-items-center rounded-2xl bg-orange-100 text-orange-600 dark:bg-orange-950/30 dark:text-orange-300">
                                    <BarChart3 className="h-5 w-5" />
                                </span>
                                <span>
                                    <span className="block font-black text-gray-950 dark:text-white">Month Comparison</span>
                                    <span className="block text-sm text-gray-500 dark:text-gray-400">Compare two or more months after choosing your service dates.</span>
                                </span>
                            </span>
                            <ArrowRight className={`h-4 w-4 text-gray-400 transition-transform ${showMonthComparison ? 'rotate-90' : ''}`} />
                        </button>

                        {showMonthComparison && (
                            <MonthComparisonSection
                                monthlyTables={monthlyTables}
                                comparisonMonths={comparisonMonths}
                                setComparisonMonths={setComparisonMonths}
                                comparisonData={comparisonData}
                                loadingComparison={loadingComparison}
                                loadMonthComparison={loadMonthComparison}
                                allMonthSundays={allMonthSundays}
                                formatTableName={formatTableName}
                            />
                        )}
                    </div>

                    <div className="lg:col-span-4 space-y-5">
                        {/* QUICK STATS */}
                        <div className="grid grid-cols-2 gap-3">
                            <ExportStatCard label="Total" value={reportStats.total} icon={Users} />
                            <ExportStatCard label="Present" value={reportStats.present} tone="green" icon={UserCheck} />
                            <ExportStatCard label="Absent" value={reportStats.absent} tone="red" icon={ClipboardList} />
                            <ExportStatCard label="Sundays" value={selectedSundays.length} tone="orange" icon={Calendar} />
                        </div>

                        {/* EXPORT MODE */}
                        <section className="rounded-2xl border border-gray-200 bg-white p-2 shadow-sm dark:border-gray-800 dark:bg-gray-900">
                            {[
                                { id: 'standard', label: 'All Members', icon: Users, desc: 'Full member list' },
                                { id: 'marked-members', label: 'Marked Only', icon: UserCheck, desc: 'Only P/A marks' },
                                { id: 'attendance-only', label: 'Attendance Log', icon: ClipboardList, desc: 'Simplified log' }
                            ].map(mode => (
                                <button
                                    key={mode.id}
                                    onClick={() => setExportMode(mode.id)}
                                    className={`flex items-center gap-3 p-2.5 rounded-xl transition-all ${exportMode === mode.id
                                        ? 'bg-gray-950 text-white dark:bg-white dark:text-gray-950 shadow-lg'
                                        : 'hover:bg-gray-50 dark:hover:bg-gray-800 text-gray-500'}`}
                                >
                                    <div className={`h-8 w-8 rounded-lg flex items-center justify-center ${exportMode === mode.id ? 'bg-orange-500 text-white' : 'bg-gray-100 dark:bg-gray-800'}`}>
                                        <mode.icon className="w-4 h-4" />
                                    </div>
                                    <div className="text-left">
                                        <p className="text-xs font-bold">{mode.label}</p>
                                        <p className="text-[9px] opacity-60">{mode.desc}</p>
                                    </div>
                                </button>
                            ))}
                        </section>

                        {/* ADVANCED TOGGLE */}
                        <button
                            onClick={() => setShowAdvancedSettings(!showAdvancedSettings)}
                            className="group w-full flex items-center justify-between rounded-2xl border border-gray-200 bg-white p-4 text-gray-800 shadow-sm transition duration-200 hover:-translate-y-0.5 hover:border-orange-300 dark:border-gray-800 dark:bg-gray-900 dark:text-gray-200"
                        >
                            <div className="flex items-center gap-2">
                                <span className="grid h-9 w-9 place-items-center rounded-xl bg-orange-50 text-orange-600 dark:bg-orange-950/30 dark:text-orange-300">
                                    <SlidersHorizontal className="w-4 h-4" />
                                </span>
                                <span className="text-left">
                                    <span className="block text-sm font-black">Advanced Options</span>
                                    <span className="block text-[11px] font-medium text-gray-500">Notes, columns, summaries</span>
                                </span>
                            </div>
                            <ArrowRight className={`w-3.5 h-3.5 transition-transform ${showAdvancedSettings ? 'rotate-90' : ''}`} />
                        </button>

                        {showAdvancedSettings && (
                            <div className="export-center-reveal space-y-4">
                                <section className="rounded-2xl border border-orange-200/70 bg-white p-4 shadow-xl shadow-orange-500/5 dark:border-orange-900/40 dark:bg-gray-900">
                                    <div className="space-y-2">
                                        <p className="text-[9px] font-black uppercase text-gray-400">Export Note</p>
                                        <textarea
                                            value={reportNote}
                                            onChange={(e) => setReportNote(e.target.value)}
                                            rows={2}
                                            className="w-full rounded-lg border border-gray-100 dark:border-gray-700 bg-gray-50 dark:bg-gray-950 p-2.5 text-[11px] focus:ring-2 focus:ring-orange-500 outline-none"
                                        />
                                    </div>
                                    <div className="space-y-2">
                                        <div className="flex items-center justify-between">
                                            <p className="text-[9px] font-black uppercase text-gray-400">Visible Columns</p>
                                            <button onClick={() => setColumns(defaultColumns)} className="text-[9px] font-bold text-orange-600 uppercase">Reset</button>
                                        </div>
                                        <div className="flex flex-wrap gap-1.5">
                                            {columns.map((col, idx) => (
                                                <div key={col} className="flex items-center gap-1 px-1.5 py-0.5 bg-gray-100 dark:bg-gray-800 rounded text-[9px] font-bold text-gray-600 dark:text-gray-300">
                                                    <span>{col}</span>
                                                    <button onClick={() => setColumns(prev => prev.filter((_, i) => i !== idx))}><X className="w-2.5 h-2.5 text-red-500" /></button>
                                                </div>
                                            ))}
                                        </div>
                                    </div>
                                </section>
                            </div>
                        )}

                        <button
                            onClick={fetchPreview}
                            disabled={selectedMonths.length === 0 || selectedSundays.length === 0 || loadingPreview}
                            className="w-full flex items-center justify-center gap-2.5 rounded-2xl bg-orange-600 py-4 text-sm font-black text-white shadow-lg shadow-orange-600/20 transition duration-200 hover:-translate-y-0.5 hover:bg-orange-700 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50"
                        >
                            {loadingPreview ? <Loader2 className="w-5 h-5 animate-spin" /> : <Eye className="w-5 h-5" />}
                            {loadingPreview ? 'Fetching...' : 'Preview & Load'}
                        </button>
                    </div>
                </div>

                {showPreview && (
                    <div className="space-y-5 export-center-reveal">
                        {/* STEP 2: WHATSAPP DRAWER */}
                        <section className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 shadow-sm overflow-hidden">
                            <div className="p-4 border-b border-gray-100 dark:border-gray-800 flex items-center justify-between bg-green-50/20 dark:bg-green-900/10">
                                <div className="flex items-center gap-2.5">
                                    <div className="h-7 w-7 rounded-lg bg-green-100 dark:bg-green-900/40 flex items-center justify-center">
                                        <MessageCircle className="w-3.5 h-3.5 text-green-600 dark:text-green-400" />
                                    </div>
                                    <h2 className="font-bold text-sm text-gray-900 dark:text-white">WhatsApp & Copy</h2>
                                </div>
                                <div className="flex items-center gap-2">
                                    <button
                                        onClick={() => copyToClipboard(activeWhatsAppText, 'Report copied')}
                                        className="text-[10px] font-black uppercase px-3 py-1.5 bg-green-600 text-white rounded-full hover:bg-green-700 transition-all shadow-md shadow-green-600/20 flex items-center gap-1.5"
                                    >
                                        <Copy className="w-3 h-3" /> Copy Report
                                    </button>
                                </div>
                            </div>

                            <div className="p-4 grid grid-cols-1 md:grid-cols-2 gap-5">
                                <div className="space-y-4">
                                    <div className="bg-gray-50 dark:bg-gray-800/50 p-4 rounded-xl space-y-3">
                                        <p className="text-[10px] font-black uppercase text-gray-400">Settings</p>
                                        <div className="flex flex-wrap gap-2">
                                            {['month', 'total', 'present', 'absent'].map(key => (
                                                <button
                                                    key={key}
                                                    onClick={() => setSummaryFields(p => ({ ...p, [key]: !p[key] }))}
                                                    className={`px-3 py-1.5 rounded-xl text-[10px] font-bold transition-all ${summaryFields[key] ? 'bg-green-100 text-green-700' : 'bg-gray-200 text-gray-500'}`}
                                                >
                                                    {key.charAt(0).toUpperCase() + key.slice(1)}
                                                </button>
                                            ))}
                                        </div>
                                        <label className="flex items-center gap-2 mt-2">
                                            <input
                                                type="checkbox"
                                                checked={includeWhatsAppMessage}
                                                onChange={(e) => setIncludeWhatsAppMessage(e.target.checked)}
                                                className="h-4 w-4 rounded-md border-gray-300 text-green-600 focus:ring-green-500"
                                            />
                                            <span className="text-xs font-bold text-gray-600 dark:text-gray-400 uppercase tracking-tight">Include message</span>
                                        </label>
                                    </div>

                                    <div className="flex gap-3">
                                        <button
                                            onClick={() => copyToClipboard(buildWhatsAppPhoneList(), 'Phones copied')}
                                            className="flex-1 flex items-center justify-center gap-2 py-4 bg-gray-900 text-white rounded-xl hover:bg-black transition-all font-bold text-xs"
                                        >
                                            <Phone className="w-4 h-4" /> Copy Phones
                                        </button>
                                        <button
                                            onClick={() => setIsExportContactsModalOpen(true)}
                                            className="flex-1 flex items-center justify-center gap-2 py-4 bg-orange-600 text-white rounded-xl hover:bg-orange-700 transition-all font-bold text-xs shadow-lg shadow-orange-600/20"
                                        >
                                            <Smartphone className="w-4 h-4" /> Export Phone
                                        </button>
                                    </div>
                                </div>

                                <div className="relative">
                                    <p className="text-[10px] font-black uppercase text-gray-400 mb-2">Message Preview</p>
                                    <textarea
                                        value={activeWhatsAppText}
                                        readOnly
                                        className="w-full h-40 bg-gray-50 dark:bg-gray-800/50 rounded-xl p-4 text-xs font-mono text-gray-700 dark:text-gray-300 border-none outline-none resize-none"
                                    />
                                </div>
                            </div>
                        </section>

                        {/* STEP 3: PREVIEW TABLE */}
                        <PreviewTable
                            displayedPreviewData={displayedPreviewData}
                            selectedRows={selectedRows}
                            columns={columns}
                            selectedSundays={selectedSundays}
                            attendanceData={attendanceData}
                            previewMode={previewMode}
                            toggleRowSelection={toggleRowSelection}
                            handleSelectAllRows={handleSelectAllRows}
                            handleClearRowSelection={handleClearRowSelection}
                            selectedPreviewDataCount={selectedPreviewData.length}
                            normalizeExportCell={normalizeExportCell}
                            getRowValue={getRowValue}
                            formatTableName={formatTableName}
                            getAttendanceMark={getAttendanceMark}
                            resolveAttendanceForDate={resolveAttendanceForDate}
                            setPreviewMode={setPreviewMode}
                        />

                        {/* FINAL ACTION BAR */}
                        <div className="bg-white dark:bg-gray-900 p-5 rounded-xl shadow-xl flex flex-col md:flex-row items-center justify-between gap-5">
                            <div className="text-center md:text-left">
                                <h3 className="text-base font-black text-gray-900 dark:text-white leading-none mb-1">Final Export</h3>
                                <p className="text-[10px] text-gray-500 font-medium">Ready to download the {exportMode.replace('-', ' ')} file.</p>
                            </div>

                            <div className="flex flex-col sm:flex-row gap-3.5 w-full md:w-auto">
                                <div className="text-center sm:text-right flex flex-col justify-center px-3">
                                    <span className="text-[9px] font-black uppercase text-orange-600">{selectedPreviewData.length} Rows</span>
                                    <span className="text-[8px] font-bold text-gray-400 uppercase">{selectedSundays.length} Sundays</span>
                                </div>
                                <button
                                    onClick={exportMode === 'attendance-only' ? handleExportAttendanceOnly : handleExport}
                                    disabled={previewData.length === 0 || selectedSundays.length === 0 || isExporting}
                                    className={`flex items-center justify-center gap-2.5 px-8 py-4 rounded-xl text-white font-black text-base shadow-xl transition-all active:scale-95 disabled:opacity-50 ${exportMode === 'standard'
                                        ? 'bg-gray-950 dark:bg-white dark:text-gray-950 shadow-black/10'
                                        : 'bg-green-700 shadow-green-700/10'
                                        }`}
                                >
                                    {isExporting ? <Loader2 className="w-5 h-5 animate-spin" /> : <Download className="w-5 h-5" />}
                                    <span>Download CSV</span>
                                </button>
                            </div>
                        </div>
                    </div>
                )}
            </div>

            <Suspense fallback={null}>
                <ExportContactsModal
                    isOpen={isExportContactsModalOpen}
                    onClose={() => setIsExportContactsModalOpen(false)}
                    onExportCSV={downloadCSVContacts}
                    onExportVCard={downloadVCardContacts}
                    contactCount={
                        selectedPreviewData.filter(row => {
                            const phone = normalizePhone(getRowValue(row, 'Phone Number'))
                            return phone && phone !== 'No phone'
                        }).length
                    }
                />
            </Suspense>
            </div>
        </div>
    )
}

export default ExportCenterPage
