import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react'
import { X, Lock, Calendar, Check } from 'lucide-react'
import { useApp } from '../context/AppContext'
import { useAuth } from '../context/AuthContext'
import { supabase } from '../lib/supabase'
import { toast } from 'react-toastify'

const MONTHS = [
    { value: 1, label: 'January' },
    { value: 2, label: 'February' },
    { value: 3, label: 'March' },
    { value: 4, label: 'April' },
    { value: 5, label: 'May' },
    { value: 6, label: 'June' },
    { value: 7, label: 'July' },
    { value: 8, label: 'August' },
    { value: 9, label: 'September' },
    { value: 10, label: 'October' },
    { value: 11, label: 'November' },
    { value: 12, label: 'December' }
]

const AdminControlsModal = ({ isOpen, onClose }) => {
    const { user } = useAuth()
    const { monthlyTables, isSupabaseConfigured, setCurrentTable, setSelectedAttendanceDate } = useApp()

    const [loading, setLoading] = useState(false)
    const [stickyMonth, setStickyMonth] = useState('')
    const [stickySundays, setStickySundays] = useState([])
    const [selectedYear, setSelectedYear] = useState(new Date().getFullYear())
    const [initialized, setInitialized] = useState(false)
    
    const hasLoadedRef = useRef(false)

    const currentYear = new Date().getFullYear()
    const years = [currentYear, currentYear + 1, currentYear + 2, currentYear + 3, currentYear + 4]

    // Get Sundays for selected month/year
    const sundaysInMonth = useMemo(() => {
        const monthNum = parseInt(stickyMonth)
        if (!monthNum || !selectedYear) return []
        
        const sundays = []
        const date = new Date(selectedYear, monthNum - 1, 1)

        // Find first Sunday
        while (date.getDay() !== 0) {
            date.setDate(date.getDate() + 1)
        }

        // Collect all Sundays
        while (date.getMonth() === monthNum - 1) {
            sundays.push({
                date: new Date(date),
                formatted: date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
            })
            date.setDate(date.getDate() + 7)
        }

        return sundays
    }, [stickyMonth, selectedYear])

    // Load current admin settings from database - only once when modal opens
    useEffect(() => {
        if (!isOpen) {
            hasLoadedRef.current = false
            setInitialized(false)
            return
        }
        
        if (hasLoadedRef.current) return
        hasLoadedRef.current = true

        const loadSettings = async () => {
            if (!user?.id || !isSupabaseConfigured()) {
                setInitialized(true)
                return
            }
            
            try {
                const { data, error } = await supabase
                    .from('user_preferences')
                    .select('admin_sticky_month, admin_sticky_year, admin_sticky_sundays')
                    .eq('user_id', user.id)
                    .single()
                
                if (error && error.code !== 'PGRST116') {
                    console.error('Error loading admin settings:', error)
                }
                
                if (data) {
                    // Parse admin_sticky_month (e.g., "January_2026") to get month number
                    if (data.admin_sticky_month) {
                        const [monthName, yearStr] = data.admin_sticky_month.split('_')
                        const monthObj = MONTHS.find(m => m.label === monthName)
                        if (monthObj) {
                            setStickyMonth(String(monthObj.value))
                        }
                        if (yearStr) {
                            setSelectedYear(parseInt(yearStr))
                        }
                    }
                    
                    if (data.admin_sticky_sundays) {
                        setStickySundays(data.admin_sticky_sundays)
                    }
                }
            } catch (err) {
                console.error('Error loading admin settings:', err)
            } finally {
                setInitialized(true)
            }
        }
        
        loadSettings()
    }, [isOpen, user?.id, isSupabaseConfigured])

    const handleSetStickyMonth = async () => {
        if (!stickyMonth || !selectedYear) {
            toast.error('Please select a month and year')
            return
        }

        setLoading(true)
        try {
            const monthName = MONTHS.find(m => m.value === parseInt(stickyMonth))?.label
            const monthIdentifier = `${monthName}_${selectedYear}`

            // Save to admin preferences in database
            if (isSupabaseConfigured()) {
                const { error: prefError } = await supabase
                    .from('user_preferences')
                    .upsert({
                        user_id: user.id,
                        admin_sticky_month: monthIdentifier,
                        admin_sticky_year: selectedYear,
                        updated_at: new Date().toISOString()
                    }, {
                        onConflict: 'user_id'
                    })

                if (prefError) {
                    console.error('Error saving admin preferences:', prefError)
                    toast.error('Failed to save sticky month')
                    return
                }

                // Apply to all collaborators
                const { error } = await supabase.rpc('set_collaborators_default_month', {
                    p_owner_id: user.id,
                    p_month_table: monthIdentifier
                })

                if (error) {
                    console.error('Error setting collaborators default month:', error)
                    toast.warning('Sticky month saved, but could not apply to all collaborators')
                } else {
                    toast.success(`Sticky month set to ${monthIdentifier} for all collaborators`)
                }
                
                // Apply to admin immediately
                setCurrentTable(monthIdentifier)
            } else {
                toast.success(`Sticky month set to ${monthIdentifier} (Demo mode)`)
            }
        } catch (err) {
            console.error('Error setting sticky month:', err)
            toast.error('Failed to set sticky month')
        } finally {
            setLoading(false)
        }
    }

    const handleSetStickySundays = async () => {
        if (stickySundays.length === 0) {
            toast.error('Please select at least one Sunday')
            return
        }

        setLoading(true)
        try {
            // Save to admin preferences in database
            if (isSupabaseConfigured()) {
                const { error: prefError } = await supabase
                    .from('user_preferences')
                    .upsert({
                        user_id: user.id,
                        admin_sticky_sundays: stickySundays,
                        updated_at: new Date().toISOString()
                    }, {
                        onConflict: 'user_id'
                    })

                if (prefError) {
                    console.error('Error saving admin preferences:', prefError)
                    toast.error('Failed to save sticky Sundays')
                    return
                }

                // Apply to all collaborators
                const { error } = await supabase.rpc('set_collaborators_default_sundays', {
                    p_owner_id: user.id,
                    p_sunday_dates: stickySundays
                })

                if (error) {
                    console.error('Error setting collaborators default Sundays:', error)
                    toast.warning('Sticky Sundays saved, but could not apply to all collaborators')
                } else {
                    toast.success(`Sticky Sundays set for all collaborators (${stickySundays.length} selected)`)
                }
                
                // Apply to admin immediately
                if (stickySundays.length > 0) {
                    setSelectedAttendanceDate(stickySundays[0])
                }
            } else {
                toast.success(`Sticky Sundays set (${stickySundays.length} selected) - Demo mode`)
            }
        } catch (err) {
            console.error('Error setting sticky Sundays:', err)
            toast.error('Failed to set sticky Sundays')
        } finally {
            setLoading(false)
        }
    }

    const toggleSunday = (dateStr) => {
        setStickySundays(prev => 
            prev.includes(dateStr) 
                ? prev.filter(d => d !== dateStr)
                : [...prev, dateStr]
        )
    }

    if (!isOpen) return null

    return (
        <div className="fixed inset-0 bg-black bg-opacity-50 backdrop-blur-sm flex items-center justify-center p-4 z-[60]">
            <div className="bg-white dark:bg-gray-800 rounded-xl shadow-2xl max-w-2xl w-full max-h-[90vh] overflow-y-auto">
                {/* Header */}
                <div className="sticky top-0 bg-white dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700 p-6 flex items-center justify-between z-10">
                    <div className="flex items-center gap-3">
                        <div className="p-2 bg-purple-100 dark:bg-purple-900/30 rounded-lg">
                            <Lock className="w-5 h-5 text-purple-600 dark:text-purple-400" />
                        </div>
                        <div>
                            <h2 className="text-xl font-semibold text-gray-900 dark:text-white">Admin Controls</h2>
                            <p className="text-sm text-gray-500 dark:text-gray-400">Set defaults for all collaborators</p>
                        </div>
                    </div>
                    <button
                        onClick={onClose}
                        className="p-2 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg transition-colors"
                    >
                        <X className="w-5 h-5 text-gray-500 dark:text-gray-400" />
                    </button>
                </div>

                <div className="p-6 space-y-6">
                    {/* Sticky Month Section */}
                    <section className="bg-gradient-to-br from-blue-50 to-indigo-50 dark:from-blue-900/20 dark:to-indigo-900/20 rounded-xl p-4 border border-blue-200 dark:border-blue-800">
                        <div className="flex items-center gap-2 mb-3">
                            <Calendar className="w-5 h-5 text-blue-600 dark:text-blue-400" />
                            <h3 className="font-semibold text-gray-900 dark:text-white">Sticky Month</h3>
                        </div>
                        <p className="text-sm text-gray-600 dark:text-gray-400 mb-4">
                            Set a default month that all collaborators will see when they log in. This will persist until you change it.
                        </p>

                        <div className="space-y-3">
                            <div className="grid grid-cols-2 gap-3">
                                <div>
                                    <label className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1">Month</label>
                                    <select
                                        value={stickyMonth}
                                        onChange={(e) => setStickyMonth(e.target.value)}
                                        className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-blue-500"
                                    >
                                        <option value="">Select month...</option>
                                        {MONTHS.map(m => (
                                            <option key={m.value} value={m.value}>{m.label}</option>
                                        ))}
                                    </select>
                                </div>
                                <div>
                                    <label className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1">Year</label>
                                    <select
                                        value={selectedYear}
                                        onChange={(e) => setSelectedYear(parseInt(e.target.value))}
                                        className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-blue-500"
                                    >
                                        {years.map(y => (
                                            <option key={y} value={y}>{y}</option>
                                        ))}
                                    </select>
                                </div>
                            </div>

                            <button
                                onClick={handleSetStickyMonth}
                                disabled={!stickyMonth || loading}
                                className="w-full px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                            >
                                <Lock className="w-4 h-4" />
                                {loading ? 'Setting...' : 'Set Sticky Month for All Collaborators'}
                            </button>
                        </div>
                    </section>

                    {/* Sticky Sundays Section */}
                    <section className="bg-gradient-to-br from-green-50 to-emerald-50 dark:from-green-900/20 dark:to-emerald-900/20 rounded-xl p-4 border border-green-200 dark:border-green-800">
                        <div className="flex items-center gap-2 mb-3">
                            <Calendar className="w-5 h-5 text-green-600 dark:text-green-400" />
                            <h3 className="font-semibold text-gray-900 dark:text-white">Sticky Sunday Dates</h3>
                        </div>
                        <p className="text-sm text-gray-600 dark:text-gray-400 mb-4">
                            Select which Sundays should be used for attendance tracking. All collaborators will use these dates.
                        </p>

                        {stickyMonth && selectedYear ? (
                            <div className="space-y-3">
                                <div className="bg-white dark:bg-gray-800 rounded-lg p-3 border border-gray-200 dark:border-gray-700">
                                    <p className="text-xs font-medium text-gray-500 dark:text-gray-400 mb-2">
                                        Sundays in {MONTHS.find(m => m.value === parseInt(stickyMonth))?.label} {selectedYear}
                                    </p>
                                    <div className="space-y-2">
                                        {sundaysInMonth.map((sunday, idx) => {
                                            const dateStr = sunday.date.toISOString().split('T')[0]
                                            const isSelected = stickySundays.includes(dateStr)
                                            return (
                                                <button
                                                    key={idx}
                                                    onClick={() => toggleSunday(dateStr)}
                                                    className={`w-full px-3 py-2 rounded-lg border-2 transition-all flex items-center justify-between ${
                                                        isSelected
                                                            ? 'border-green-500 bg-green-50 dark:bg-green-900/30'
                                                            : 'border-gray-200 dark:border-gray-600 hover:border-green-300 dark:hover:border-green-700'
                                                    }`}
                                                >
                                                    <span className="text-sm font-medium text-gray-900 dark:text-white">
                                                        {sunday.formatted}
                                                    </span>
                                                    {isSelected && <Check className="w-4 h-4 text-green-600 dark:text-green-400" />}
                                                </button>
                                            )
                                        })}
                                    </div>
                                </div>

                                <button
                                    onClick={handleSetStickySundays}
                                    disabled={stickySundays.length === 0 || loading}
                                    className="w-full px-4 py-2 bg-green-600 hover:bg-green-700 text-white rounded-lg font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                                >
                                    <Lock className="w-4 h-4" />
                                    {loading ? 'Setting...' : `Set ${stickySundays.length} Sunday(s) for All Collaborators`}
                                </button>
                            </div>
                        ) : (
                            <div className="bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-800 rounded-lg p-3">
                                <p className="text-sm text-yellow-800 dark:text-yellow-200">
                                    Please select a month and year above to see available Sundays
                                </p>
                            </div>
                        )}
                    </section>

                    {/* Info */}
                    <div className="bg-gray-50 dark:bg-gray-700/50 rounded-lg p-4 border border-gray-200 dark:border-gray-600">
                        <p className="text-xs text-gray-600 dark:text-gray-400">
                            <strong>Note:</strong> These settings will apply to all current and future collaborators. 
                            They will see the selected month and Sunday dates by default when they access the app.
                        </p>
                    </div>
                </div>
            </div>
        </div>
    )
}

export default AdminControlsModal
