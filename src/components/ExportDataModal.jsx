import React, { useState } from 'react'
import { X, Download, Users, Calendar, FileSpreadsheet, CheckCircle, Database } from 'lucide-react'
import { useApp } from '../context/AppContext'
import { toast } from 'react-toastify'

const ExportDataModal = ({ isOpen, onClose }) => {
    const { members, attendanceData, currentTable, availableTables } = useApp()
    const [selectedOption, setSelectedOption] = useState('all')
    const [selectedMonth, setSelectedMonth] = useState(currentTable || '')
    const [isExporting, setIsExporting] = useState(false)

    if (!isOpen) return null

    const exportOptions = [
        {
            id: 'all',
            title: 'Export Everything',
            description: 'All members with attendance data for current month',
            icon: Database,
            color: 'blue'
        },
        {
            id: 'members',
            title: 'Members Only',
            description: 'Export member list without attendance',
            icon: Users,
            color: 'green'
        },
        {
            id: 'attendance',
            title: 'Attendance Only',
            description: 'Export attendance records for current month',
            icon: Calendar,
            color: 'purple'
        },
        {
            id: 'summary',
            title: 'Attendance Summary',
            description: 'Summary statistics per member',
            icon: FileSpreadsheet,
            color: 'orange'
        }
    ]

    const generateSundayDates = (table) => {
        if (!table) return []
        try {
            const [monthName, yearStr] = table.split('_')
            const year = parseInt(yearStr)
            const months = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']
            const idx = months.indexOf(monthName)
            if (idx === -1) return []
            const res = []
            const d = new Date(year, idx, 1)
            while (d.getDay() !== 0) d.setDate(d.getDate() + 1)
            while (d.getMonth() === idx) {
                res.push(d.toISOString().split('T')[0])
                d.setDate(d.getDate() + 7)
            }
            return res
        } catch {
            return []
        }
    }

    const handleExport = () => {
        setIsExporting(true)

        try {
            let csvContent = ''
            let filename = ''
            const sundayDates = generateSundayDates(currentTable)

            switch (selectedOption) {
                case 'all': {
                    // Full export with attendance
                    const headers = ['Name', 'Gender', 'Phone', ...sundayDates.map(d => {
                        const date = new Date(d)
                        return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
                    }), 'Total Present', 'Attendance Rate']

                    csvContent = headers.join(',') + '\n'

                    members.forEach(member => {
                        let presentCount = 0
                        const attendanceValues = sundayDates.map(date => {
                            const status = attendanceData[date]?.[member.id]
                            if (status === true) {
                                presentCount++
                                return 'Present'
                            } else if (status === false) {
                                return 'Absent'
                            }
                            return 'Not Marked'
                        })

                        const rate = sundayDates.length > 0 ? ((presentCount / sundayDates.length) * 100).toFixed(1) + '%' : '0%'

                        const row = [
                            `"${member.name || ''}"`,
                            member.gender || '',
                            member.phone || '',
                            ...attendanceValues,
                            presentCount,
                            rate
                        ]
                        csvContent += row.join(',') + '\n'
                    })

                    filename = `full_export_${currentTable || 'data'}.csv`
                    break
                }

                case 'members': {
                    // Members only
                    csvContent = 'Name,Gender,Phone,Created Date\n'
                    members.forEach(member => {
                        const row = [
                            `"${member.name || ''}"`,
                            member.gender || '',
                            member.phone || '',
                            member.created_at ? new Date(member.created_at).toLocaleDateString() : ''
                        ]
                        csvContent += row.join(',') + '\n'
                    })
                    filename = `members_${new Date().toISOString().split('T')[0]}.csv`
                    break
                }

                case 'attendance': {
                    // Attendance only
                    csvContent = 'Member Name,Date,Status\n'
                    members.forEach(member => {
                        sundayDates.forEach(date => {
                            const status = attendanceData[date]?.[member.id]
                            if (status !== undefined) {
                                const row = [
                                    `"${member.name || ''}"`,
                                    date,
                                    status === true ? 'Present' : 'Absent'
                                ]
                                csvContent += row.join(',') + '\n'
                            }
                        })
                    })
                    filename = `attendance_${currentTable || 'data'}.csv`
                    break
                }

                case 'summary': {
                    // Summary statistics
                    csvContent = 'Member Name,Gender,Total Sundays,Present,Absent,Not Marked,Attendance Rate\n'
                    members.forEach(member => {
                        let present = 0
                        let absent = 0
                        let notMarked = 0

                        sundayDates.forEach(date => {
                            const status = attendanceData[date]?.[member.id]
                            if (status === true) present++
                            else if (status === false) absent++
                            else notMarked++
                        })

                        const rate = sundayDates.length > 0 ? ((present / sundayDates.length) * 100).toFixed(1) + '%' : '0%'

                        const row = [
                            `"${member.name || ''}"`,
                            member.gender || '',
                            sundayDates.length,
                            present,
                            absent,
                            notMarked,
                            rate
                        ]
                        csvContent += row.join(',') + '\n'
                    })
                    filename = `summary_${currentTable || 'data'}.csv`
                    break
                }

                default:
                    throw new Error('Invalid export option')
            }

            // Download the file
            const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' })
            const url = URL.createObjectURL(blob)
            const link = document.createElement('a')
            link.href = url
            link.download = filename
            document.body.appendChild(link)
            link.click()
            document.body.removeChild(link)
            URL.revokeObjectURL(url)

            toast.success(`Exported ${members.length} records to ${filename}`)
            onClose()
        } catch (error) {
            console.error('Export error:', error)
            toast.error('Failed to export data')
        } finally {
            setIsExporting(false)
        }
    }

    const getColorClasses = (color, isSelected) => {
        const colors = {
            blue: isSelected
                ? 'bg-orange-100 dark:bg-orange-900/30 border-orange-500 ring-2 ring-orange-500'
                : 'bg-white dark:bg-gray-800 border-gray-200 dark:border-gray-700 hover:border-orange-300',
            green: isSelected
                ? 'bg-green-100 dark:bg-green-900/30 border-green-500 ring-2 ring-green-500'
                : 'bg-white dark:bg-gray-800 border-gray-200 dark:border-gray-700 hover:border-green-300',
            purple: isSelected
                ? 'bg-purple-100 dark:bg-purple-900/30 border-purple-500 ring-2 ring-purple-500'
                : 'bg-white dark:bg-gray-800 border-gray-200 dark:border-gray-700 hover:border-purple-300',
            orange: isSelected
                ? 'bg-orange-100 dark:bg-orange-900/30 border-orange-500 ring-2 ring-orange-500'
                : 'bg-white dark:bg-gray-800 border-gray-200 dark:border-gray-700 hover:border-orange-300'
        }
        return colors[color] || colors.blue
    }

    const getIconColorClasses = (color) => {
        const colors = {
            blue: 'text-orange-600 dark:text-orange-400',
            green: 'text-green-600 dark:text-green-400',
            purple: 'text-purple-600 dark:text-purple-400',
            orange: 'text-orange-600 dark:text-orange-400'
        }
        return colors[color] || colors.blue
    }

    return (
        <div className="fixed inset-0 z-[60] flex items-center justify-center p-4">
            {/* Backdrop */}
            <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={onClose} />

            {/* Modal */}
            <div className="relative w-full max-w-md bg-white dark:bg-gray-800 rounded-2xl shadow-2xl overflow-hidden">
                {/* Header */}
                <div className="flex items-center justify-between p-4 border-b border-gray-200 dark:border-gray-700">
                    <div className="flex items-center gap-3">
                        <div className="p-2 bg-orange-100 dark:bg-orange-900/30 rounded-lg">
                            <Download className="w-5 h-5 text-orange-600 dark:text-orange-400" />
                        </div>
                        <div>
                            <h2 className="text-lg font-semibold text-gray-900 dark:text-white">Export Data</h2>
                            <p className="text-xs text-gray-500 dark:text-gray-400">Choose what to export</p>
                        </div>
                    </div>
                    <button
                        onClick={onClose}
                        className="p-2 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
                    >
                        <X className="w-5 h-5 text-gray-500" />
                    </button>
                </div>

                {/* Content */}
                <div className="p-4 space-y-3">
                    {/* Current context info */}
                    <div className="flex items-center gap-2 p-2 bg-gray-50 dark:bg-gray-900/50 rounded-lg text-sm text-gray-600 dark:text-gray-400">
                        <Calendar className="w-4 h-4" />
                        <span>Current: <strong className="text-gray-900 dark:text-white">{currentTable?.replace('_', ' ') || 'No table selected'}</strong></span>
                        <span className="text-gray-400">•</span>
                        <span>{members?.length || 0} members</span>
                    </div>

                    {/* Export options */}
                    <div className="space-y-2">
                        {exportOptions.map((option) => {
                            const Icon = option.icon
                            const isSelected = selectedOption === option.id

                            return (
                                <button
                                    key={option.id}
                                    onClick={() => setSelectedOption(option.id)}
                                    className={`w-full flex items-center gap-3 p-3 rounded-xl border transition-all ${getColorClasses(option.color, isSelected)}`}
                                >
                                    <div className={`p-2 rounded-lg ${isSelected ? 'bg-white dark:bg-gray-800' : 'bg-gray-100 dark:bg-gray-700'}`}>
                                        <Icon className={`w-5 h-5 ${getIconColorClasses(option.color)}`} />
                                    </div>
                                    <div className="flex-1 text-left">
                                        <p className="font-medium text-gray-900 dark:text-white">{option.title}</p>
                                        <p className="text-xs text-gray-500 dark:text-gray-400">{option.description}</p>
                                    </div>
                                    {isSelected && (
                                        <CheckCircle className={`w-5 h-5 ${getIconColorClasses(option.color)}`} />
                                    )}
                                </button>
                            )
                        })}
                    </div>
                </div>

                {/* Footer */}
                <div className="flex items-center justify-end gap-3 p-4 border-t border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900/50">
                    <button
                        onClick={onClose}
                        className="px-4 py-2 text-sm font-medium text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg transition-colors"
                    >
                        Cancel
                    </button>
                    <button
                        onClick={handleExport}
                        disabled={isExporting || !members?.length}
                        className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-orange-600 hover:bg-orange-700 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                        {isExporting ? (
                            <>
                                <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                                Exporting...
                            </>
                        ) : (
                            <>
                                <Download className="w-4 h-4" />
                                Export CSV
                            </>
                        )}
                    </button>
                </div>
            </div>
        </div>
    )
}

export default ExportDataModal
