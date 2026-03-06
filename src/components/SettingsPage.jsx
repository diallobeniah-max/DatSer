import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react'
import {
    User,
    Building2,
    Users,
    Database,
    Palette,
    AlertTriangle,
    ChevronLeft,
    ChevronRight,
    Lock,
    Mail,
    Download,
    Upload,
    Trash2,
    UserPlus,
    Calendar,
    Moon,
    Sun,
    Laptop,
    CheckCircle,
    Shield,
    RefreshCw,
    Pencil,
    HelpCircle,
    ChevronDown,
    X,
    Loader2,
    Search,
    ClipboardList,
    Zap,
    Eye,
    Monitor,
    RotateCcw,
    Sparkles,
    Plus,
    List,
    Archive
} from 'lucide-react'
import { useAuth } from '../context/AuthContext'
import { useTheme } from '../context/ThemeContext'
import { useApp } from '../context/AppContext'
import { toast } from 'react-toastify'
import ShareAccessModal from './ShareAccessModal'
import { supabase } from '../lib/supabase'
import WorkspaceSettingsModal from './WorkspaceSettingsModal'
import DeleteAccountModal from './DeleteAccountModal'
import ExportDataModal from './ExportDataModal'
import ProfilePhotoEditor from './ProfilePhotoEditor'
import HelpCenterPage from './HelpCenterPage'
import ActivityLogViewer from './ActivityLogViewer'
import ExportCenterPage from './ExportCenterPage'
import ConfirmModal from './ConfirmModal'
import AdminControlsModal from './AdminControlsModal'
import ArchiveMonthModal from './ArchiveMonthModal'
import useHapticFeedback from '../hooks/useHapticFeedback'

const SettingsPage = ({ onBack, navigateToSection, onCreateMonth }) => {
    const { user, signOut, preferences, resetPassword } = useAuth()
    const { isDarkMode, toggleTheme, themeMode, setThemeMode, commandKEnabled, setCommandKEnabled } = useTheme()
    const { members, monthlyTables, currentTable, setCurrentTable, isSupabaseConfigured, createNewMonth, deleteMonthTable, isCollaborator, dataOwnerId, lockedDefaultDate, saveLockedDefaultDate } = useApp()
    const { selection } = useHapticFeedback()

    const [activeSection, setActiveSection] = useState(null) // null = show main list
    const [showHelpCenter, setShowHelpCenter] = useState(false)
    const [archiveMonth, setArchiveMonth] = useState(null) // table name to archive

    // Handle navigation from command palette
    useEffect(() => {
        if (navigateToSection) {
            setActiveSection(navigateToSection)
        }
    }, [navigateToSection])

    const [autoAllDatesEnabled, setAutoAllDatesEnabled] = useState(() => {
        return localStorage.getItem('autoAllDatesEnabled') === 'true'
    })
    useEffect(() => {
        const scrollToTop = () => {
            try {
                window.scrollTo({ top: 0, left: 0, behavior: 'auto' })
            } catch {
                window.scrollTo(0, 0)
            }
        }
        scrollToTop()
        const raf1 = requestAnimationFrame(() => {
            const raf2 = requestAnimationFrame(scrollToTop)
            return () => cancelAnimationFrame(raf2)
        })
        return () => cancelAnimationFrame(raf1)
    }, [activeSection, showHelpCenter])


    const toggleAutoAllDates = () => {
        const newValue = !autoAllDatesEnabled
        setAutoAllDatesEnabled(newValue)
        localStorage.setItem('autoAllDatesEnabled', newValue.toString())
        if (newValue) {
            toast.success('Auto-All-Dates enabled: will auto-mark all dates to present day')
        } else {
            toast.info('Auto-All-Dates disabled')
        }
    }


    // Quick Attendance Access toggle removed

    const [isShareModalOpen, setIsShareModalOpen] = useState(false)
    const [collaborators, setCollaborators] = useState([])
    const [fetchingCollaborators, setFetchingCollaborators] = useState(false)
    const [isWorkspaceModalOpen, setIsWorkspaceModalOpen] = useState(false)
    const [isDeleteAccountOpen, setIsDeleteAccountOpen] = useState(false)
    const [isExportModalOpen, setIsExportModalOpen] = useState(false)
    const [showExportCenter, setShowExportCenter] = useState(false)
    const [isPhotoEditorOpen, setIsPhotoEditorOpen] = useState(false)
    const [isAdminControlsOpen, setIsAdminControlsOpen] = useState(false)
    const [deletingCollaboratorId, setDeletingCollaboratorId] = useState(null)
    const [pendingRemoval, setPendingRemoval] = useState(null)
    const [monthViewMode, setMonthViewMode] = useState('list') // 'list' | 'calendar'
    const [selectedYear, setSelectedYear] = useState(new Date().getFullYear())
    const [showMonthDropdown, setShowMonthDropdown] = useState(false)
    const [deletingTable, setDeletingTable] = useState(null)
    const [deletePrompt, setDeletePrompt] = useState({
        isOpen: false,
        tableName: null,
        label: ''
    })

    // ── Database Usage (real query) ──
    const [dbUsage, setDbUsage] = useState(null)
    const [dbLoading, setDbLoading] = useState(false)
    const DB_LIMIT_MB = 500 // Supabase free tier

    const fetchDbUsage = useCallback(async () => {
        if (!isSupabaseConfigured) return
        setDbLoading(true)
        try {
            const { data, error } = await supabase.rpc('get_database_usage')
            if (error) throw error
            setDbUsage(data)
        } catch (err) {
            console.error('Failed to fetch DB usage:', err)
        } finally {
            setDbLoading(false)
        }
    }, [isSupabaseConfigured])

    useEffect(() => { fetchDbUsage() }, [fetchDbUsage])

    // Find oldest monthly table for archive recommendation
    const oldestMonthTable = useMemo(() => {
        if (!dbUsage?.tables) return null
        const monthTables = dbUsage.tables.filter(t =>
            /^[A-Z][a-z]+_\d{4}$/.test(t.table_name)
        )
        if (monthTables.length <= 1) return null
        // Sort by size descending, recommend the largest old one
        return monthTables[monthTables.length - 1] || monthTables[0]
    }, [dbUsage])

    // ── Email Rate Tracking ──
    const EMAIL_RATE_LIMIT = 3 // Supabase free tier: 3 emails per hour
    const EMAIL_WINDOW_MS = 60 * 60 * 1000 // 1 hour

    const getEmailSends = useCallback(() => {
        try {
            const raw = localStorage.getItem('email_send_timestamps')
            if (!raw) return []
            const timestamps = JSON.parse(raw)
            const cutoff = Date.now() - EMAIL_WINDOW_MS
            return timestamps.filter(ts => ts > cutoff)
        } catch { return [] }
    }, [])

    const [emailSends, setEmailSends] = useState(() => {
        try {
            const raw = localStorage.getItem('email_send_timestamps')
            if (!raw) return []
            const timestamps = JSON.parse(raw)
            const cutoff = Date.now() - EMAIL_WINDOW_MS
            return timestamps.filter(ts => ts > cutoff)
        } catch { return [] }
    })
    const [emailCountdown, setEmailCountdown] = useState('')

    // Refresh email sends and countdown every second
    useEffect(() => {
        const tick = () => {
            const current = getEmailSends()
            setEmailSends(current)
            if (current.length >= EMAIL_RATE_LIMIT && current.length > 0) {
                const oldest = Math.min(...current)
                const resetAt = oldest + EMAIL_WINDOW_MS
                const remaining = resetAt - Date.now()
                if (remaining > 0) {
                    const mins = Math.floor(remaining / 60000)
                    const secs = Math.floor((remaining % 60000) / 1000)
                    setEmailCountdown(`${mins}m ${secs}s`)
                } else {
                    setEmailCountdown('')
                }
            } else {
                setEmailCountdown('')
            }
        }
        tick()
        const interval = setInterval(tick, 1000)
        return () => clearInterval(interval)
    }, [getEmailSends])

    const emailsRemaining = Math.max(0, EMAIL_RATE_LIMIT - emailSends.length)
    const emailPct = Math.round((emailSends.length / EMAIL_RATE_LIMIT) * 100)

    const [removeDelay, setRemoveDelay] = useState(0)
    const [isRemovingCollaborator, setIsRemovingCollaborator] = useState(false)
    const [isExportingCollaborator, setIsExportingCollaborator] = useState(false)
    const removeTimerRef = useRef(null)
    const removeCountdownRef = useRef(null)
    const [removeCountdownMs, setRemoveCountdownMs] = useState(0)
    const [searchQuery, setSearchQuery] = useState('')
    const [showUsageDetails, setShowUsageDetails] = useState(false)
    const [showStorageLimits, setShowStorageLimits] = useState(false)

    const handleInteractionFeedback = useCallback((event) => {
        if (event.defaultPrevented) return
        const target = event.target instanceof Element
            ? event.target.closest('button, a, [role="button"], summary, input[type="checkbox"], input[type="radio"], input[type="range"]')
            : null
        if (!target) return
        if (target.matches(':disabled')) return
        selection()
    }, [selection])

    // Fetch collaborators for Team section display
    useEffect(() => {
        const fetchCollaborators = async () => {
            if (!user?.id || !isSupabaseConfigured) return

            setFetchingCollaborators(true)
            try {
                const { data, error } = await supabase
                    .from('collaborators')
                    .select('*')
                    .eq('owner_id', user.id)
                    .order('created_at', { ascending: false })

                if (!error && data) {
                    setCollaborators(data)
                } else if (error) {
                    console.error('Error fetching collaborators:', error)
                }
            } catch (err) {
                console.error('Error in fetchCollaborators:', err)
            } finally {
                setFetchingCollaborators(false)
            }
        }
        fetchCollaborators()
    }, [user?.id, isSupabaseConfigured])

    // Refresh collaborators when modal closes
    const handleShareModalClose = async () => {
        setIsShareModalOpen(false)
        if (user && isSupabaseConfigured) {
            try {
                const { data } = await supabase
                    .from('collaborators')
                    .select('*')
                    .eq('owner_id', user.id)
                    .order('created_at', { ascending: false })
                if (data) setCollaborators(data)
            } catch (err) {
                console.error('Error refreshing collaborators:', err)
            }
        }
    }

    const requestDeleteTable = (tableName) => {
        if (!tableName) return
        setDeletePrompt({
            isOpen: true,
            tableName,
            label: tableName.replace('_', ' ')
        })
    }

    const handleDeleteTable = async () => {
        const tableName = deletePrompt.tableName
        if (!tableName) return
        try {
            setDeletingTable(tableName)
            await deleteMonthTable(tableName)
        } catch (error) {
            console.error('Failed to delete month table:', error)
        } finally {
            setDeletingTable(null)
            setDeletePrompt({ isOpen: false, tableName: null, label: '' })
        }
    }

    const handleSignOut = async () => {
        try {
            await signOut()
            toast.success('Signed out successfully')
        } catch (error) {
            toast.error('Failed to sign out')
        }
    }

    const handleDeleteCollaborator = (collaboratorId) => {
        if (!user || !isSupabaseConfigured) {
            toast.error('Not authorized')
            return
        }
        const target = collaborators.find(c => c.id === collaboratorId)
        setPendingRemoval(target || null)
        setRemoveDelay(0)
    }

    const performCollaboratorDeletion = async (target) => {
        setDeletingCollaboratorId(target.id)
        try {
            const { error } = await supabase
                .from('collaborators')
                .delete()
                .eq('id', target.id)
                .eq('owner_id', user.id)
            if (error) throw error
            setCollaborators(prev => prev.filter(c => c.id !== target.id))
            toast.success(`Removed access for ${target.email}`)
        } catch (err) {
            console.error('Error deleting collaborator:', err)
            toast.error('Failed to remove collaborator from database')
        } finally {
            setDeletingCollaboratorId(null)
            setIsRemovingCollaborator(false)
            setPendingRemoval(null)
        }
    }

    const confirmRemoveCollaborator = async () => {
        if (!pendingRemoval) return
        setIsRemovingCollaborator(true)
        if (removeDelay > 0) {
            toast.info(`Will remove ${pendingRemoval.email} in ${removeDelay} minutes`)
        }
        const totalMs = removeDelay * 60 * 1000
        setRemoveCountdownMs(totalMs)
        const start = Date.now()
        if (removeCountdownRef.current) clearInterval(removeCountdownRef.current)
        removeCountdownRef.current = setInterval(() => {
            const elapsed = Date.now() - start
            const remaining = Math.max(totalMs - elapsed, 0)
            setRemoveCountdownMs(remaining)
        }, 1000)
        removeTimerRef.current = setTimeout(() => performCollaboratorDeletion(pendingRemoval), totalMs || 0)
    }

    const handleExportCollaboratorData = async () => {
        setIsExportingCollaborator(true)
        try {
            toast.info('Export collaborator data: please export from Supabase (not implemented here).')
        } finally {
            setIsExportingCollaborator(false)
        }
    }

    const closeRemoveModal = () => {
        if (removeTimerRef.current) clearTimeout(removeTimerRef.current)
        if (removeCountdownRef.current) clearInterval(removeCountdownRef.current)
        setPendingRemoval(null)
        setIsRemovingCollaborator(false)
        setRemoveCountdownMs(0)
    }

    useEffect(() => {
        return () => {
            if (removeTimerRef.current) clearTimeout(removeTimerRef.current)
            if (removeCountdownRef.current) clearInterval(removeCountdownRef.current)
        }
    }, [])

    // Get preview text for each section
    const getSectionPreview = (sectionId) => {
        switch (sectionId) {
            case 'account':
                return user?.email || 'Manage your account'
            case 'workspace':
                return preferences?.workspace_name || 'TMH Teen Ministry'
            case 'team':
                return `${collaborators.length} collaborator${collaborators.length !== 1 ? 's' : ''}`
            case 'data':
                return `${members?.length || 0} members`
            case 'appearance':
                return themeMode === 'system' ? 'Auto' : themeMode === 'dark' ? 'Dark' : 'Light'
            case 'accessibility':
                return 'Command Menu'
            case 'help':
                return 'Get help & support'
            case 'danger':
                return 'Delete account'
            default:
                return ''
        }
    }

    // Helper function to get month display name from table name
    const getMonthDisplayName = (tableName) => {
        // Convert table name like "October_2025" to "October 2025"
        return tableName.replace('_', ' ')
    }

    const calendarCurrentYear = new Date().getFullYear()

    // Helper to group tables by year
    const groupTablesByYear = useMemo(() => {
        const grouped = {}
        monthlyTables.forEach(table => {
            const [month, year] = table.split('_')
            if (!grouped[year]) grouped[year] = []
            grouped[year].push({ month, table })
        })
        return grouped
    }, [monthlyTables])

    const availableYears = useMemo(() => {
        const years = new Set(Object.keys(groupTablesByYear).map(year => parseInt(year, 10)))
        years.add(calendarCurrentYear)
        years.add(calendarCurrentYear + 1)
        return Array.from(years).sort((a, b) => a - b)
    }, [groupTablesByYear, calendarCurrentYear])

    useEffect(() => {
        if (availableYears.length === 0) return
        if (!availableYears.includes(selectedYear)) {
            setSelectedYear(availableYears[availableYears.length - 1])
        }
    }, [availableYears, selectedYear])

    useEffect(() => {
        setShowMonthDropdown(false)
    }, [monthViewMode])

    // Helper to get Sundays for a month
    const getSundaysInMonth = (monthName, year) => {
        const months = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']
        const monthIdx = months.indexOf(monthName)
        if (monthIdx === -1) return []
        const sundays = []
        const date = new Date(year, monthIdx, 1)
        while (date.getDay() !== 0) date.setDate(date.getDate() + 1)
        while (date.getMonth() === monthIdx) {
            sundays.push(new Date(date))
            date.setDate(date.getDate() + 7)
        }
        return sundays
    }

    // Quick create month helper
    const handleQuickCreateMonth = async (monthName, year) => {
        try {
            const months = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']
            const monthIdx = months.indexOf(monthName)
            if (monthIdx === -1) return
            const sundays = getSundaysInMonth(monthName, year)
            await createNewMonth({
                month: monthIdx + 1,
                year,
                monthName,
                sundays,
                copyMode: 'empty'
            })
        } catch (err) {
            console.error('Quick create month failed:', err)
        }
    }

    const renderAccountSection = () => (
        <div className="space-y-6">
            <div>
                <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-1">Account Settings</h3>
                <p className="text-sm text-gray-500 dark:text-gray-400">Manage your account information and security</p>
            </div>

            {/* Profile Card */}
            <div className="bg-gray-50 dark:bg-gray-700/50 rounded-xl p-4">
                <div className="flex items-center gap-4">
                    <div className="relative flex-shrink-0">
                        {(() => {
                            const localAvatar = typeof window !== 'undefined' ? localStorage.getItem('user_avatar_url') : null
                            const avatarUrl = localAvatar || user?.user_metadata?.avatar_url
                            return avatarUrl ? (
                                <img
                                    src={avatarUrl}
                                    alt="Profile"
                                    className="w-16 h-16 min-w-[64px] min-h-[64px] rounded-full object-cover border-2 border-white dark:border-gray-600 shadow-md"
                                />
                            ) : (
                                <div className="w-16 h-16 min-w-[64px] min-h-[64px] rounded-full bg-gradient-to-br from-orange-500 to-purple-600 flex items-center justify-center text-white text-2xl font-bold shadow-md">
                                    {user?.email?.[0]?.toUpperCase() || 'U'}
                                </div>
                            )
                        })()}
                        {/* Edit photo button - available for all users */}
                        <button
                            onClick={() => setIsPhotoEditorOpen(true)}
                            className="absolute -bottom-1 -right-1 p-1.5 bg-orange-600 hover:bg-orange-700 text-white rounded-full shadow-lg transition-colors btn-press"
                            title="Change photo"
                        >
                            <Pencil className="w-3 h-3" />
                        </button>
                    </div>
                    <div className="flex-1 min-w-0">
                        <h4 className="font-semibold text-gray-900 dark:text-white truncate">
                            {user?.user_metadata?.full_name || user?.email?.split('@')[0] || 'User'}
                        </h4>
                        <p className="text-sm text-gray-500 dark:text-gray-400 flex items-center gap-1 truncate">
                            <Mail className="w-3 h-3 flex-shrink-0" />
                            <span className="truncate">{user?.email}</span>
                        </p>
                        <p className="text-xs text-gray-400 dark:text-gray-500 mt-1">
                            {user?.app_metadata?.provider === 'google' ? '🔒 Signed in with Google' : '🔒 Email authentication'}
                        </p>
                    </div>
                </div>
            </div>

            {/* Security */}
            <div className="space-y-3">
                <h4 className="text-sm font-medium text-gray-700 dark:text-gray-300 flex items-center gap-2">
                    <Lock className="w-4 h-4" />
                    Security
                </h4>
                <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 divide-y divide-gray-200 dark:divide-gray-700">
                    <div className="p-4 flex items-center justify-between">
                        <div className="flex items-center gap-3">
                            <div>
                                <p className="font-medium text-gray-900 dark:text-white flex items-center gap-2">
                                    Password
                                    {window.__needsPasswordSetup && (
                                        <span className="inline-flex items-center px-2 py-0.5 text-xs font-medium bg-red-100 dark:bg-red-900/30 text-red-600 dark:text-red-400 rounded-full">
                                            Action needed
                                        </span>
                                    )}
                                </p>
                                <p className="text-sm text-gray-500 dark:text-gray-400">
                                    {user?.app_metadata?.provider === 'google'
                                        ? 'Managed by Google'
                                        : window.__needsPasswordSetup
                                        ? 'Set up a password for email login'
                                        : 'Change your password'}
                                </p>
                            </div>
                        </div>
                        <button
                            onClick={async () => {
                                if (user?.app_metadata?.provider === 'google') {
                                    toast.info('Your account is secured via Google. Manage it at myaccount.google.com')
                                } else if (window.__needsPasswordSetup && window.__openSetPassword) {
                                    window.__openSetPassword()
                                } else {
                                    try {
                                        await resetPassword(user?.email)
                                    } catch (err) {
                                        // Error toast is already shown by resetPassword
                                    }
                                }
                            }}
                            className={`px-3 py-1.5 text-sm rounded-lg transition-colors ${
                                window.__needsPasswordSetup
                                    ? 'bg-orange-600 text-white hover:bg-orange-700'
                                    : 'bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600'
                            }`}
                        >
                            {user?.app_metadata?.provider === 'google' ? 'View' : window.__needsPasswordSetup ? 'Set Up' : 'Change'}
                        </button>
                    </div>
                    {user?.app_metadata?.provider !== 'google' && (
                        <div className="p-4 flex items-center justify-between">
                            <div>
                                <p className="font-medium text-gray-900 dark:text-white">Create Password</p>
                                <p className="text-sm text-gray-500 dark:text-gray-400">Open the password setup screen</p>
                            </div>
                            <button
                                onClick={() => {
                                    if (window.__openSetPassword) {
                                        window.__openSetPassword()
                                    } else {
                                        toast.info('Password setup is not available right now')
                                    }
                                }}
                                className="px-3 py-1.5 text-sm bg-orange-600 text-white rounded-lg hover:bg-orange-700 transition-colors"
                            >
                                Create
                            </button>
                        </div>
                    )}
                    <div className="p-4 flex items-center justify-between">
                        <div>
                            <p className="font-medium text-gray-900 dark:text-white">Sign Out</p>
                            <p className="text-sm text-gray-500 dark:text-gray-400">Sign out of your account</p>
                        </div>
                        <button
                            onClick={handleSignOut}
                            className="px-3 py-1.5 text-sm bg-red-100 dark:bg-red-900/30 text-red-600 dark:text-red-400 rounded-lg hover:bg-red-200 dark:hover:bg-red-900/50 transition-colors"
                        >
                            Sign Out
                        </button>
                    </div>
                </div>
            </div>
        </div>
    )

    const renderWorkspaceSection = () => (
        <div className="space-y-6">
            <div>
                <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-1">Workspace Settings</h3>
                <p className="text-sm text-gray-500 dark:text-gray-400">Configure your workspace and organization</p>
            </div>

            {/* Current Workspace */}
            <div className="bg-gradient-to-r from-orange-500 to-purple-600 rounded-xl p-4 text-white">
                <div className="flex items-center gap-3">
                    <div className="p-2 bg-white/20 rounded-lg">
                        <Building2 className="w-6 h-6" />
                    </div>
                    <div>
                        <p className="text-sm opacity-80">Current Workspace</p>
                        <h4 className="font-semibold text-lg">{preferences?.workspace_name || 'TMH Teen Ministry'}</h4>
                    </div>
                </div>
            </div>

            {/* Workspace Options */}
            <div className="space-y-3">
                <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 divide-y divide-gray-200 dark:divide-gray-700">
                    {/* Auto-Sunday Settings */}
                    <div className="p-4 space-y-4">
                        <div className="flex items-center gap-3">
                            <div className="p-2 bg-purple-100 dark:bg-purple-900/30 rounded-lg">
                                <Zap className="w-5 h-5 text-purple-600 dark:text-purple-400" />
                            </div>
                            <div className="flex-1">
                                <p className="font-medium text-gray-900 dark:text-white">Automation Settings</p>
                                <p className="text-sm text-gray-500 dark:text-gray-400">Configure auto-selection and attendance behavior</p>
                            </div>
                        </div>

                        {/* Auto-All-Dates Toggle */}
                        <div className="flex items-center justify-between">
                            <div className="flex-1">
                                <label className="font-medium text-gray-900 dark:text-white flex items-center gap-2">
                                    Auto-All-Dates
                                    {autoAllDatesEnabled && (
                                        <span className="text-xs px-2 py-0.5 bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400 rounded-full">Active</span>
                                    )}
                                </label>
                                <p className="text-sm text-gray-600 dark:text-gray-400">
                                    When enabled, automatically mark all dates up to today as present
                                </p>
                            </div>
                            <button
                                onClick={toggleAutoAllDates}
                                disabled={isCollaborator && !autoAllDatesEnabled}
                                className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${isCollaborator && !autoAllDatesEnabled
                                        ? 'bg-gray-300 dark:bg-gray-600 cursor-not-allowed'
                                        : autoAllDatesEnabled
                                            ? 'bg-primary-600'
                                            : 'bg-gray-200 dark:bg-gray-600'
                                    }`}
                                title={isCollaborator && !autoAllDatesEnabled ? 'Auto-All-Dates is managed by workspace admin' : 'Toggle Auto-All-Dates'}
                            >
                                <span
                                    className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${autoAllDatesEnabled ? 'translate-x-6' : 'translate-x-1'
                                        }`}
                                />
                            </button>
                        </div>

                        {/* Collaborator Notice */}
                        {isCollaborator && !autoAllDatesEnabled && (
                            <div className="bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-lg p-3">
                                <div className="flex items-start gap-2">
                                    <AlertTriangle className="w-4 h-4 text-amber-600 dark:text-amber-400 mt-0.5 flex-shrink-0" />
                                    <div className="text-xs text-amber-700 dark:text-amber-300">
                                        <p className="font-medium mb-1">Workspace Admin Control</p>
                                        <p>Automation settings are managed by the workspace administrator. Contact your admin to enable these features.</p>
                                    </div>
                                </div>
                            </div>
                        )}

                    </div>

                    <button
                        onClick={() => setIsWorkspaceModalOpen(true)}
                        className="w-full p-4 flex items-center justify-between hover:bg-gray-50 dark:hover:bg-gray-700/50 transition-colors"
                    >
                        <div className="flex items-center gap-3">
                            <div className="p-2 bg-orange-100 dark:bg-orange-900/30 rounded-lg">
                                <Building2 className="w-5 h-5 text-orange-600 dark:text-orange-400" />
                            </div>
                            <div className="text-left">
                                <p className="font-medium text-gray-900 dark:text-white">Edit Workspace</p>
                                <p className="text-sm text-gray-500 dark:text-gray-400">Change name and preferences</p>
                            </div>
                        </div>
                        <ChevronLeft className="w-5 h-5 text-gray-400 rotate-180" />
                    </button>

                    <div className="p-4">
                        <div className="flex items-center justify-between mb-3">
                            <div className="flex items-center gap-3">
                                <div className="p-2 bg-green-100 dark:bg-green-900/30 rounded-lg">
                                    <Calendar className="w-5 h-5 text-green-600 dark:text-green-400" />
                                </div>
                                <div>
                                    <p className="font-medium text-gray-900 dark:text-white">Current Month</p>
                                    <p className="text-sm text-gray-500 dark:text-gray-400">Select active month database</p>
                                </div>
                            </div>
                            <button
                                onClick={() => setMonthViewMode(monthViewMode === 'list' ? 'calendar' : 'list')}
                                className="text-xs px-3 py-1.5 bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 dark:hover:bg-gray-600 rounded-lg transition-colors text-gray-700 dark:text-gray-300 flex items-center gap-1"
                            >
                                {monthViewMode === 'list' ? <Eye className="w-3 h-3" /> : <List className="w-3 h-3" />}
                                {monthViewMode === 'list' ? 'Calendar' : 'List'}
                            </button>
                        </div>

                        {monthViewMode === 'list' ? (
                            <>
                                <div className="relative">
                                <button
                                    type="button"
                                    onClick={() => setShowMonthDropdown(prev => !prev)}
                                    className="w-full flex items-center gap-3 px-4 py-3 bg-gradient-to-r from-white to-gray-50 dark:from-gray-900 dark:to-gray-800 border border-gray-200 dark:border-gray-700 rounded-2xl shadow-lg focus:outline-none focus:ring-4 focus:ring-orange-500/30 transition-all"
                                >
                                    <div className="flex items-center gap-3 flex-1">
                                        <div className="p-2 rounded-xl bg-orange-500/15 text-orange-600 dark:text-orange-300">
                                            <Calendar className="w-4 h-4" />
                                        </div>
                                        <div className="text-left">
                                            <p className="text-[11px] uppercase tracking-wide text-gray-500 dark:text-gray-400">Active Month</p>
                                            <p className="text-base font-semibold text-gray-900 dark:text-white">
                                                {currentTable ? currentTable.replace('_', ' ') : 'Select month'}
                                            </p>
                                        </div>
                                    </div>
                                    <ChevronDown
                                        className={`w-5 h-5 text-gray-500 dark:text-gray-300 transition-transform ${showMonthDropdown ? 'rotate-180' : ''}`}
                                    />
                                </button>
                                {showMonthDropdown && (
                                    <div className="absolute left-0 right-0 mt-2 z-30 max-h-72 overflow-y-auto rounded-2xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 shadow-2xl">
                                        {monthlyTables && monthlyTables.length > 0 ? (
                                            monthlyTables.map(table => {
                                                const isActive = currentTable === table
                                                return (
                                                    <button
                                                        key={table}
                                                        type="button"
                                                        onClick={() => {
                                                            setCurrentTable(table)
                                                            setShowMonthDropdown(false)
                                                        }}
                                                        className={`w-full flex items-center justify-between px-4 py-2.5 text-sm transition-colors ${isActive
                                                                ? 'bg-orange-50 dark:bg-orange-900/30 text-orange-700 dark:text-orange-200'
                                                                : 'text-gray-800 dark:text-gray-100 hover:bg-gray-50 dark:hover:bg-gray-700'
                                                            }`}
                                                    >
                                                        <span>{table.replace('_', ' ')}</span>
                                                        <div className="flex items-center gap-2">
                                                            {isActive && (
                                                                <span className="text-xs font-semibold text-orange-600 dark:text-orange-200">Current</span>
                                                            )}
                                                            <button
                                                                type="button"
                                                                onClick={(e) => {
                                                                    e.stopPropagation()
                                                                    requestDeleteTable(table)
                                                                }}
                                                                className="p-1 rounded-md text-gray-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/30 transition-colors"
                                                                disabled={deletingTable === table}
                                                                title={`Delete ${table.replace('_', ' ')}`}
                                                            >
                                                                <Trash2 className="w-3.5 h-3.5" />
                                                            </button>
                                                        </div>
                                                    </button>
                                                )
                                            })
                                        ) : (
                                            <div className="px-4 py-3 text-sm text-gray-500 dark:text-gray-400">No months available</div>
                                        )}
                                    </div>
                                )}
                                </div>
                                <button
                                    onClick={() => {
                                        selection()
                                        if (onCreateMonth) onCreateMonth()
                                    }}
                                    className="mt-3 w-full flex items-center justify-center gap-2 px-4 py-3 bg-orange-50 dark:bg-orange-900/20 hover:bg-orange-100 dark:hover:bg-orange-900/40 text-orange-600 dark:text-orange-400 border border-orange-200 dark:border-orange-800 rounded-xl font-medium transition-colors"
                                >
                                    <Plus className="w-4 h-4" />
                                    Create New Month
                                </button>
                            </>
                        ) : (
                            <div className="space-y-4">
                                {/* Year Tabs */}
                                <div className="flex flex-wrap gap-2">
                                    {availableYears.map(year => (
                                        <button
                                            key={year}
                                            onClick={() => setSelectedYear(year)}
                                            className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${selectedYear === year
                                                    ? 'bg-orange-600 text-white'
                                                    : 'bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600'
                                                }`}
                                        >
                                            {year}
                                        </button>
                                    ))}
                                </div>

                                {/* Calendar Grid for Selected Year */}
                                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                                    {['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'].map(month => {
                                        const table = groupTablesByYear[selectedYear]?.find(m => m.month === month)?.table
                                        const exists = Boolean(table)
                                        const sundays = getSundaysInMonth(month, selectedYear)
                                        const isCurrent = table === currentTable
                                        return (
                                            <div
                                                key={month}
                                                onClick={() => {
                                                    if (exists) {
                                                        setCurrentTable(table)
                                                    } else {
                                                        handleQuickCreateMonth(month, selectedYear)
                                                    }
                                                }}
                                                className={`relative p-4 rounded-2xl border transition-all cursor-pointer shadow-sm backdrop-blur-sm ${isCurrent
                                                        ? 'border-orange-400 bg-gradient-to-br from-orange-500/10 to-orange-600/10 dark:from-orange-500/20 dark:to-orange-700/20'
                                                        : exists
                                                            ? 'border-green-200/70 bg-gradient-to-br from-green-50 to-emerald-100 dark:from-green-900/20 dark:to-emerald-800/20 hover:border-green-400'
                                                            : 'border-dashed border-gray-300 dark:border-gray-600 bg-gray-50/60 dark:bg-gray-800/40 hover:border-gray-400 dark:hover:border-gray-500'
                                                    } hover:-translate-y-1 hover:shadow-lg`}
                                            >
                                                <div className="flex items-start justify-between mb-4">
                                                    <div>
                                                        <p className="text-[11px] uppercase tracking-wider text-gray-500 dark:text-gray-400">Month</p>
                                                        <p className={`text-lg font-semibold ${isCurrent
                                                                ? 'text-orange-700 dark:text-orange-200'
                                                                : exists
                                                                    ? 'text-emerald-800 dark:text-emerald-200'
                                                                    : 'text-gray-600 dark:text-gray-300'
                                                            }`}>
                                                            {month}
                                                        </p>
                                                    </div>
                                                    {exists ? (
                                                        <div className="flex items-center gap-2">
                                                            <span className={`text-[11px] font-semibold px-2 py-1 rounded-full ${isCurrent
                                                                    ? 'bg-orange-500/20 text-orange-700 dark:text-orange-200'
                                                                    : 'bg-emerald-500/20 text-emerald-700 dark:text-emerald-200'
                                                                }`}>
                                                                {isCurrent ? 'Active' : 'Saved'}
                                                            </span>
                                                            <button
                                                                onClick={(e) => {
                                                                    e.stopPropagation()
                                                                    requestDeleteTable(table)
                                                                }}
                                                                className={`p-1.5 rounded-full ${deletingTable === table
                                                                    ? 'bg-red-200/80 text-red-700 cursor-wait'
                                                                    : 'bg-red-50 text-red-600 hover:bg-red-100 dark:bg-red-900/20 dark:text-red-300 dark:hover:bg-red-900/40'
                                                                    } transition-colors`}
                                                                disabled={deletingTable === table}
                                                                title={`Delete ${month} ${selectedYear}`}
                                                            >
                                                                <Trash2 className="w-3.5 h-3.5" />
                                                            </button>
                                                        </div>
                                                    ) : (
                                                        <button
                                                            onClick={(e) => {
                                                                e.stopPropagation()
                                                                handleQuickCreateMonth(month, selectedYear)
                                                            }}
                                                            className="px-2 py-1 text-xs font-semibold rounded-full bg-orange-600 text-white hover:bg-orange-700 transition-colors flex items-center gap-1"
                                                            title={`Create ${month} ${selectedYear}`}
                                                        >
                                                            <Plus className="w-3 h-3" />
                                                            Create
                                                        </button>
                                                    )}
                                                </div>
                                                {/* Sunday badges — admin can tap to lock a date for collaborators */}
                                                <div className="grid grid-cols-3 gap-2">
                                                    {sundays.slice(0, 12).map((sunday, i) => {
                                                        const sundayDateStr = `${sunday.getFullYear()}-${String(sunday.getMonth() + 1).padStart(2, '0')}-${String(sunday.getDate()).padStart(2, '0')}`
                                                        const isLocked = lockedDefaultDate === sundayDateStr
                                                        return (
                                                            <div
                                                                key={`${month}-${i}`}
                                                                onClick={async (e) => {
                                                                    e.stopPropagation()
                                                                    if (isCollaborator) return
                                                                    if (!exists) return
                                                                    if (isLocked) {
                                                                        const ok = await saveLockedDefaultDate(null)
                                                                        if (ok) toast.info('Locked date removed')
                                                                    } else {
                                                                        const ok = await saveLockedDefaultDate(sundayDateStr)
                                                                        if (ok) toast.success(`Locked to ${month} ${sunday.getDate()}`)
                                                                    }
                                                                }}
                                                                className={`rounded-xl px-2 py-2 flex flex-col items-center text-center shadow-inner transition-all ${
                                                                    isLocked
                                                                        ? 'bg-orange-600 text-white border-2 border-orange-400 ring-2 ring-orange-300/50 shadow-md cursor-pointer'
                                                                        : exists
                                                                            ? isCurrent
                                                                                ? `bg-white/80 dark:bg-white/10 text-orange-700 dark:text-orange-200 border border-orange-200/60 dark:border-orange-400/30 ${!isCollaborator ? 'cursor-pointer hover:border-orange-400 hover:shadow-md' : ''}`
                                                                                : `bg-white/80 dark:bg-white/5 text-emerald-700 dark:text-emerald-200 border border-emerald-200/60 dark:border-emerald-400/30 ${!isCollaborator ? 'cursor-pointer hover:border-emerald-400 hover:shadow-md' : ''}`
                                                                            : 'bg-gray-100 dark:bg-gray-800 text-gray-400 border border-dashed border-gray-300 dark:border-gray-600'
                                                                }`}
                                                                title={isLocked ? `Locked: ${sunday.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })} — tap to unlock` : sunday.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' })}
                                                            >
                                                                {isLocked && <Lock className="w-3 h-3 mb-0.5" />}
                                                                <span className="text-[10px] uppercase tracking-wide opacity-70">Sun</span>
                                                                <span className="text-sm font-semibold leading-tight">{sunday.getDate()}</span>
                                                            </div>
                                                        )
                                                    })}
                                                </div>
                                                <p className="mt-4 text-xs text-gray-500 dark:text-gray-400">
                                                    {exists
                                                        ? isCollaborator
                                                            ? 'Tap to switch to this month.'
                                                            : 'Tap card to switch month. Tap a Sunday to lock it for collaborators.'
                                                        : 'Tap to create a fresh month with no data.'}
                                                </p>
                                            </div>
                                        )
                                    })}
                                </div>
                            </div>
                        )}
                    </div>
                </div>
            </div>

            {/* Stats */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 transition-all duration-500 ease-[cubic-bezier(0.4,0,0.2,1)] grid-animate">
                <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-4 text-center">
                    <p className="text-2xl font-bold text-orange-600 dark:text-orange-400">{members?.length || 0}</p>
                    <p className="text-sm text-gray-500 dark:text-gray-400">Total Members</p>
                </div>
                <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-4 text-center">
                    <p className="text-2xl font-bold text-green-600 dark:text-green-400">{monthlyTables?.length || 0}</p>
                    <p className="text-sm text-gray-500 dark:text-gray-400">Monthly Databases</p>
                </div>
            </div>
        </div>
    )

    const renderTeamSection = () => (
        <div className="space-y-6">
            <div>
                <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-1">Team & Sharing</h3>
                <p className="text-sm text-gray-500 dark:text-gray-400">Manage who has access to your workspace</p>
            </div>

            {/* Admin Controls Card - Only for owners */}
            {!isCollaborator && (
                <div className="bg-gradient-to-br from-purple-50 to-indigo-50 dark:from-purple-900/20 dark:to-indigo-900/20 rounded-xl border border-purple-200 dark:border-purple-800 p-4">
                    <div className="flex items-center gap-4 mb-4">
                        <div className="p-3 bg-purple-100 dark:bg-purple-900/30 rounded-xl">
                            <Lock className="w-6 h-6 text-purple-600 dark:text-purple-400" />
                        </div>
                        <div className="flex-1">
                            <h4 className="font-semibold text-gray-900 dark:text-white">Admin Controls</h4>
                            <p className="text-sm text-gray-500 dark:text-gray-400">Set sticky month and Sunday dates for all collaborators</p>
                        </div>
                    </div>
                    <button
                        onClick={() => setIsAdminControlsOpen(true)}
                        className="w-full py-2.5 bg-purple-600 hover:bg-purple-700 text-white font-medium rounded-lg transition-colors flex items-center justify-center gap-2"
                    >
                        <Lock className="w-4 h-4" />
                        Admin Controls
                    </button>
                </div>
            )}


            {/* Share Access Card */}
            <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-4">
                <div className="flex items-center gap-4 mb-4">
                    <div className="p-3 bg-orange-100 dark:bg-orange-900/30 rounded-xl">
                        <UserPlus className="w-6 h-6 text-orange-600 dark:text-orange-400" />
                    </div>
                    <div className="flex-1">
                        <h4 className="font-semibold text-gray-900 dark:text-white">Invite Team Members</h4>
                        <p className="text-sm text-gray-500 dark:text-gray-400">Share access to your workspace with others</p>
                    </div>
                </div>
                <button
                    onClick={() => setIsShareModalOpen(true)}
                    className="w-full py-2.5 bg-orange-600 hover:bg-orange-700 text-white font-medium rounded-lg transition-colors flex items-center justify-center gap-2"
                >
                    <UserPlus className="w-4 h-4" />
                    Share Access
                </button>
            </div>

            {/* Always Visible Collaborators List */}
            <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-4">
                <h4 className="font-medium text-gray-900 dark:text-white mb-3 flex items-center gap-2">
                    <Users className="w-4 h-4" />
                    People with Access ({collaborators.length})
                </h4>
                {fetchingCollaborators ? (
                    <div className="flex items-center justify-center py-4">
                        <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-orange-600"></div>
                    </div>
                ) : collaborators.length === 0 ? (
                    <div className="text-center py-4 text-gray-500 dark:text-gray-400">
                        <Users className="w-10 h-10 mx-auto mb-2 opacity-50" />
                        <p className="text-sm">No collaborators yet</p>
                        <p className="text-xs mt-1">Click "Share Access" to invite someone</p>
                    </div>
                ) : (
                    <div className="space-y-2">
                        {collaborators.map((collaborator) => (
                            <div
                                key={collaborator.id}
                                className="flex items-center gap-3 p-3 bg-gray-50 dark:bg-gray-700/50 rounded-lg w-full"
                            >
                                <div className="w-8 h-8 bg-orange-100 dark:bg-orange-900/30 rounded-full flex items-center justify-center flex-shrink-0">
                                    <span className="text-sm font-medium text-orange-600 dark:text-orange-400">
                                        {collaborator.email.charAt(0).toUpperCase()}
                                    </span>
                                </div>
                                <div className="flex-1 min-w-0">
                                    <p className="text-sm font-medium text-gray-900 dark:text-white truncate">
                                        {collaborator.email}
                                    </p>
                                    <span className={`text-xs px-2 py-0.5 rounded-full ${collaborator.status === 'accepted'
                                        ? 'bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400'
                                        : collaborator.status === 'rejected'
                                            ? 'bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-400'
                                            : 'bg-yellow-100 dark:bg-yellow-900/30 text-yellow-700 dark:text-yellow-400'
                                        }`}>
                                        {collaborator.status === 'accepted' ? 'Accepted' : collaborator.status === 'rejected' ? 'Rejected' : 'Pending'}
                                    </span>
                                </div>
                                <button
                                    onClick={() => handleDeleteCollaborator(collaborator.id)}
                                    disabled={deletingCollaboratorId === collaborator.id}
                                    className="px-3 py-1.5 text-xs font-semibold text-red-600 dark:text-red-400 border border-red-200 dark:border-red-700 rounded-lg hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors disabled:opacity-60"
                                >
                                    {deletingCollaboratorId === collaborator.id ? 'Removing...' : 'Remove'}
                                </button>
                            </div>
                        ))}
                    </div>
                )}
            </div>

            {/* Permissions Info */}
            <div className="bg-gray-50 dark:bg-gray-700/50 rounded-xl p-4">
                <h4 className="font-medium text-gray-900 dark:text-white mb-3 flex items-center gap-2">
                    <Shield className="w-4 h-4" />
                    Permission Levels
                </h4>
                <div className="space-y-2 text-sm">
                    <div className="flex items-center gap-2">
                        <CheckCircle className="w-4 h-4 text-green-500" />
                        <span className="text-gray-600 dark:text-gray-400"><strong>Owner:</strong> Full access, can delete workspace</span>
                    </div>
                    <div className="flex items-center gap-2">
                        <CheckCircle className="w-4 h-4 text-orange-500" />
                        <span className="text-gray-600 dark:text-gray-400"><strong>Editor:</strong> Can view and edit data</span>
                    </div>
                    <div className="flex items-center gap-2">
                        <CheckCircle className="w-4 h-4 text-gray-500" />
                        <span className="text-gray-600 dark:text-gray-400"><strong>Viewer:</strong> Read-only access</span>
                    </div>
                </div>
            </div>
        </div>
    )

    const renderDataSection = () => (
        <div className="space-y-6">
            <div>
                <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-1">Data Management</h3>
                <p className="text-sm text-gray-500 dark:text-gray-400">Export, import, and manage your data</p>
            </div>

            {/* Export/Import */}
            <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 divide-y divide-gray-200 dark:divide-gray-700">
                <button
                    onClick={() => setActiveSection('export')}
                    className="w-full p-4 flex items-center justify-between hover:bg-gray-50 dark:hover:bg-gray-700/50 transition-colors"
                >
                    <div className="flex items-center gap-3">
                        <div className="p-2 bg-green-100 dark:bg-green-900/30 rounded-lg">
                            <Download className="w-5 h-5 text-green-600 dark:text-green-400" />
                        </div>
                        <div className="text-left">
                            <p className="font-medium text-gray-900 dark:text-white">Export Center</p>
                            <p className="text-sm text-gray-500 dark:text-gray-400">Select months, preview, reorder columns, export CSV</p>
                        </div>
                    </div>
                    <ChevronLeft className="w-5 h-5 text-gray-400 rotate-180" />
                </button>

                <button
                    onClick={() => toast.info('Import feature coming soon!')}
                    className="w-full p-4 flex items-center justify-between hover:bg-gray-50 dark:hover:bg-gray-700/50 transition-colors"
                >
                    <div className="flex items-center gap-3">
                        <div className="p-2 bg-orange-100 dark:bg-orange-900/30 rounded-lg">
                            <Upload className="w-5 h-5 text-orange-600 dark:text-orange-400" />
                        </div>
                        <div className="text-left">
                            <p className="font-medium text-gray-900 dark:text-white">Import Data</p>
                            <p className="text-sm text-gray-500 dark:text-gray-400">Import members from CSV</p>
                        </div>
                    </div>
                    <span className="text-xs bg-yellow-100 dark:bg-yellow-900/30 text-yellow-700 dark:text-yellow-400 px-2 py-1 rounded">Soon</span>
                </button>

                <button
                    onClick={() => toast.info('Cleanup duplicates in Dashboard → Duplicates tab')}
                    className="w-full p-4 flex items-center justify-between hover:bg-gray-50 dark:hover:bg-gray-700/50 transition-colors"
                >
                    <div className="flex items-center gap-3">
                        <div className="p-2 bg-orange-100 dark:bg-orange-900/30 rounded-lg">
                            <RefreshCw className="w-5 h-5 text-orange-600 dark:text-orange-400" />
                        </div>
                        <div className="text-left">
                            <p className="font-medium text-gray-900 dark:text-white">Clean Duplicates</p>
                            <p className="text-sm text-gray-500 dark:text-gray-400">Find and merge duplicate members</p>
                        </div>
                    </div>
                    <ChevronLeft className="w-5 h-5 text-gray-400 rotate-180" />
                </button>
            </div>

            {/* Archive Months */}
            {monthlyTables && monthlyTables.length > 0 && (
                <div>
                    <h4 className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-2 flex items-center gap-2">
                        <Archive className="w-4 h-4 text-amber-500" />
                        Archive Months
                    </h4>
                    <p className="text-xs text-gray-500 dark:text-gray-400 mb-3">
                        Export data as CSV and remove from database to save storage space.
                        Use Export Center above if you just want a backup without deleting.
                    </p>
                    <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 divide-y divide-gray-200 dark:divide-gray-700">
                        {monthlyTables.map(table => {
                            const isCurrent = table === currentTable
                            return (
                                <div key={table} className="p-3 flex items-center justify-between">
                                    <div className="flex items-center gap-2">
                                        <span className="text-sm font-medium text-gray-900 dark:text-white">
                                            {table.replace('_', ' ')}
                                        </span>
                                        {isCurrent && (
                                            <span className="text-[10px] px-1.5 py-0.5 bg-orange-100 dark:bg-orange-900/30 text-orange-600 dark:text-orange-400 rounded-full font-medium">
                                                Current
                                            </span>
                                        )}
                                    </div>
                                    <button
                                        onClick={() => setArchiveMonth(table)}
                                        className="px-3 py-1.5 text-xs font-medium rounded-lg bg-amber-50 dark:bg-amber-900/20 text-amber-700 dark:text-amber-400 border border-amber-200 dark:border-amber-800 hover:bg-amber-100 dark:hover:bg-amber-900/30 transition-colors"
                                    >
                                        Archive
                                    </button>
                                </div>
                            )
                        })}
                    </div>
                </div>
            )}

            {/* Storage Info */}
            <div className="bg-gray-50 dark:bg-gray-700/50 rounded-xl p-4">
                <div className="flex items-center justify-between mb-2">
                    <span className="text-sm font-medium text-gray-700 dark:text-gray-300">Storage Used</span>
                    <span className="text-sm text-gray-500 dark:text-gray-400">{monthlyTables?.length || 0} months • {members?.length || 0} records</span>
                </div>
                <div className="w-full bg-gray-200 dark:bg-gray-600 rounded-full h-2">
                    <div
                        className="bg-orange-600 h-2 rounded-full transition-all"
                        style={{ width: `${Math.min((members?.length || 0) / 1000 * 100, 100)}%` }}
                    />
                </div>
                <p className="text-xs text-gray-500 dark:text-gray-400 mt-2">
                    Free tier: 500 MB database. Archive old months to stay within limits.
                </p>
            </div>
        </div>
    )

    const renderAppearanceSection = () => (
        <div className="space-y-6">
            <div>
                <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-1">Appearance</h3>
                <p className="text-sm text-gray-500 dark:text-gray-400">Customize how Datsar looks</p>
            </div>


            {/* Theme Selection */}
            <div className="space-y-3">
                <h4 className="text-sm font-medium text-gray-700 dark:text-gray-300">Theme</h4>
                <div className="grid grid-cols-3 gap-3 transition-all duration-500 ease-[cubic-bezier(0.4,0,0.2,1)] grid-animate">
                    {/* System Mode (Custom Slash) */}
                    <button
                        onClick={() => setThemeMode('system')}
                        className={`group p-4 rounded-xl border-2 transition-all flex flex-col items-center gap-3 ${themeMode === 'system'
                            ? 'border-orange-500 bg-orange-50 dark:bg-orange-900/20'
                            : 'border-transparent hover:bg-gray-50 dark:hover:bg-gray-800'
                            }`}
                    >
                        <div
                            className="w-16 h-16 rounded-2xl shadow-sm border border-gray-200 overflow-hidden"
                            style={{
                                background: 'linear-gradient(135deg, #ffffff 50%, #111827 50%)'
                            }}
                        />
                        <span className={`text-sm font-medium ${themeMode === 'system' ? 'text-orange-600 dark:text-orange-400' : 'text-gray-600 dark:text-gray-400'}`}>System mode</span>
                    </button>

                    {/* Dark Mode (Black) */}
                    <button
                        onClick={() => setThemeMode('dark')}
                        className={`group p-4 rounded-xl border-2 transition-all flex flex-col items-center gap-3 ${themeMode === 'dark'
                            ? 'border-orange-500 bg-orange-50 dark:bg-orange-900/20'
                            : 'border-transparent hover:bg-gray-50 dark:hover:bg-gray-800'
                            }`}
                    >
                        <div className="w-16 h-16 rounded-2xl bg-gray-900 border border-gray-700 shadow-sm" />
                        <span className={`text-sm font-medium ${themeMode === 'dark' ? 'text-orange-600 dark:text-orange-400' : 'text-gray-600 dark:text-gray-400'}`}>Dark mode</span>
                    </button>

                    {/* Light Mode (White) */}
                    <button
                        onClick={() => setThemeMode('light')}
                        className={`group p-4 rounded-xl border-2 transition-all flex flex-col items-center gap-3 ${themeMode === 'light'
                            ? 'border-orange-500 bg-orange-50 dark:bg-orange-900/20'
                            : 'border-transparent hover:bg-gray-50 dark:hover:bg-gray-800'
                            }`}
                    >
                        <div className="w-16 h-16 rounded-2xl bg-white border border-gray-200 shadow-sm" />
                        <span className={`text-sm font-medium ${themeMode === 'light' ? 'text-orange-600 dark:text-orange-400' : 'text-gray-600 dark:text-gray-400'}`}>Light mode</span>
                    </button>

                </div>
            </div>

            {/* Quick Attendance Access removed */}
        </div>
    )

    const renderAccessibilitySection = () => (
        <div className="space-y-6">
            {/* Command Menu Settings */}
            <div className="bg-white dark:bg-gray-800 rounded-xl shadow-md p-6">
                <div className="flex items-center gap-3 mb-4">
                    <Zap className="w-5 h-5 text-green-500" />
                    <h4 className="text-lg font-semibold text-gray-900 dark:text-white">Command Menu</h4>
                </div>

                <div className="space-y-4">
                    <div className="flex items-center justify-between">
                        <div>
                            <label className="font-medium text-gray-900 dark:text-white">Enable Command Menu</label>
                            <p className="text-sm text-gray-600 dark:text-gray-400">
                                Press {navigator.platform.includes('Mac') ? 'Cmd' : 'Ctrl'} + K to open quick navigation
                            </p>
                        </div>
                        <button
                            onClick={() => setCommandKEnabled(!commandKEnabled)}
                            className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${commandKEnabled ? 'bg-primary-600' : 'bg-gray-200 dark:bg-gray-600'
                                }`}
                        >
                            <span
                                className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${commandKEnabled ? 'translate-x-6' : 'translate-x-1'
                                    }`}
                            />
                        </button>
                    </div>

                    {commandKEnabled && (
                        <div className="mt-3 p-3 bg-orange-50 dark:bg-orange-900/20 rounded-lg">
                            <p className="text-sm text-orange-700 dark:text-orange-300 font-medium mb-1">💡 Pro Tip</p>
                            <p className="text-xs text-orange-600 dark:text-orange-400">
                                Use Command Menu to quickly navigate to any page, search members, or access settings without clicking through menus.
                            </p>
                        </div>
                    )}
                </div>
            </div>
        </div>
    )

    const renderDangerSection = () => (
        <div className="space-y-6">
            <div>
                <h3 className="text-lg font-semibold text-red-600 dark:text-red-400 mb-1">Danger Zone</h3>
                <p className="text-sm text-gray-500 dark:text-gray-400">Irreversible and destructive actions</p>
            </div>

            <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-xl p-4">
                <div className="flex items-start gap-3">
                    <div className="p-2 bg-red-100 dark:bg-red-900/30 rounded-lg">
                        <AlertTriangle className="w-5 h-5 text-red-600 dark:text-red-400" />
                    </div>
                    <div className="flex-1">
                        <h4 className="font-semibold text-red-700 dark:text-red-400">Delete Account</h4>
                        <p className="text-sm text-red-600/80 dark:text-red-400/80 mb-3">
                            Permanently delete your account and all associated data. This action cannot be undone.
                        </p>
                        <button
                            onClick={() => setIsDeleteAccountOpen(true)}
                            className="px-4 py-2 bg-red-600 hover:bg-red-700 text-white font-medium rounded-lg transition-colors flex items-center gap-2"
                        >
                            <Trash2 className="w-4 h-4" />
                            Delete Account
                        </button>
                    </div>
                </div>
            </div>
        </div>
    )

    const renderContent = () => {
        switch (activeSection) {
            case 'account': return renderAccountSection()
            case 'workspace': return renderWorkspaceSection()
            case 'team': return renderTeamSection()
            case 'data': return renderDataSection()
            case 'export': return <ExportCenterPage onBack={() => setActiveSection(null)} />
            case 'appearance': return renderAppearanceSection()
            case 'accessibility': return renderAccessibilitySection()
            case 'activity': return <ActivityLogViewer />
            case 'danger': return renderDangerSection()
            default: return renderAccountSection()
        }
    }



    // Section definitions with enhanced content for search
    const sections = [
        {
            id: 'account',
            label: 'Account',
            icon: User,
            color: 'blue',
            content: 'Manage your profile picture, email address, full name, password, and personal account settings. Update your avatar, change your email, modify your display name, and secure your account with password changes.',
            keywords: 'profile email avatar name personal information password security login sign in'
        },
        {
            id: 'workspace',
            label: 'Workspace',
            icon: Building2,
            color: 'purple',
            content: 'Configure your workspace name, organization settings, and ministry information. Set up your church or organization name and manage workspace preferences.',
            keywords: 'organization company ministry name settings workspace configuration'
        },
        {
            id: 'team',
            label: 'Team & Sharing',
            icon: Users,
            color: 'green',
            content: 'Add team members, invite collaborators, manage permissions, and control access to your workspace. Share your data with trusted team members and manage user roles.',
            keywords: 'collaborators sharing access members users permissions invitations team management'
        },
        {
            id: 'data',
            label: 'Data Management',
            icon: Database,
            color: 'orange',
            content: 'Export member data, import CSV files, backup your information, and manage member databases. Download attendance records, member lists, and save your data securely.',
            keywords: 'export import backup members data storage csv download upload database'
        },
        {
            id: 'appearance',
            label: 'Appearance',
            icon: Palette,
            color: 'pink',
            content: 'Customize theme, colors, and display settings. Switch between dark and light modes, adjust visual preferences, and personalize your interface.',
            keywords: 'theme dark light colors display visual interface'
        },
        {
            id: 'accessibility',
            label: 'Accessibility',
            icon: Zap,
            color: 'yellow',
            content: 'Command Menu settings. Enable or disable quick navigation with keyboard shortcuts.',
            keywords: 'command menu keyboard shortcuts navigation'
        },
        {
            id: 'help',
            label: 'Help Center',
            icon: HelpCircle,
            color: 'cyan',
            content: 'Get help and support, read documentation, view tutorials, and find answers to frequently asked questions. Learn how to use all features and troubleshoot issues.',
            keywords: 'support documentation tutorial guide FAQ help instructions getting started'
        },
        {
            id: 'activity',
            label: 'Activity Log',
            icon: ClipboardList,
            color: 'indigo',
            content: 'View a history of actions taken in your workspace. Monitor member additions, deletions, updates, and other important events.',
            keywords: 'audit logs history updates tracking activity actions events'
        },
        {
            id: 'danger',
            label: 'Danger Zone',
            icon: AlertTriangle,
            color: 'red',
            danger: true,
            content: 'Delete your account, remove all data, and perform destructive actions. Permanently erase your account and all associated information.',
            keywords: 'delete remove account danger destructive reset erase data clean slate'
        }
    ]

    // define all granular searchable items
    const allSearchableItems = useMemo(() => [
        // --- Account Section ---
        {
            id: 'profile_photo',
            section: 'account',
            label: 'Profile Photo',
            description: 'Change your profile picture',
            keywords: 'avatar image photo picture upload face',
            icon: User,
            action: () => { setActiveSection('account'); setIsPhotoEditorOpen(true) }
        },
        {
            id: 'account_name',
            section: 'account',
            label: 'Account Name',
            description: `Display name: ${user?.user_metadata?.full_name || 'User'}`,
            keywords: 'name full username display personal info',
            icon: User,
            action: () => setActiveSection('account')
        },
        {
            id: 'account_email',
            section: 'account',
            label: 'Email Address',
            description: `Current email: ${user?.email}`,
            keywords: 'email address mail contact',
            icon: Mail,
            action: () => setActiveSection('account')
        },
        {
            id: 'password',
            section: 'account',
            label: 'Password',
            description: 'Change or reset your password',
            keywords: 'password security reset change login',
            icon: Lock,
            action: () => setActiveSection('account')
        },
        {
            id: 'set_password',
            section: 'account',
            label: 'Create Password',
            description: 'Open password setup',
            keywords: 'password create set setup login',
            icon: Lock,
            action: () => {
                setActiveSection('account')
                if (window.__openSetPassword) {
                    window.__openSetPassword()
                } else {
                    toast.info('Password setup is not available right now')
                }
            }
        },
        {
            id: 'sign_out',
            section: 'account',
            label: 'Sign Out',
            description: 'Log out of your account',
            keywords: 'logout signout exit leave disconnect',
            icon: null, // special case, uses red styling
            isDestructive: true,
            action: handleSignOut
        },

        // --- Workspace Section ---
        {
            id: 'edit_workspace',
            section: 'workspace',
            label: 'Edit Workspace',
            description: 'Change workspace name and preferences',
            keywords: 'workspace name organization ministry rename',
            icon: Building2,
            action: () => { setActiveSection('workspace'); setIsWorkspaceModalOpen(true) }
        },
        {
            id: 'current_month',
            section: 'workspace',
            label: 'Current Month Database',
            description: `Active: ${currentTable?.replace('_', ' ') || 'None'}`,
            keywords: 'month database table select switch change',
            icon: Calendar,
            action: () => setActiveSection('workspace')
        },
        {
            id: 'workspace_stats',
            section: 'workspace',
            label: 'Workspace Stats',
            description: 'View total members and databases',
            keywords: 'stats statistics count numbers total',
            icon: Building2,
            action: () => setActiveSection('workspace')
        },

        // --- Team Section ---
        {
            id: 'invite_team',
            section: 'team',
            label: 'Invite Team Members',
            description: 'Share access with new collaborators',
            keywords: 'invite add share team member collaborator friend access',
            icon: UserPlus,
            action: () => { setActiveSection('team'); setIsShareModalOpen(true) }
        },
        {
            id: 'manage_team',
            section: 'team',
            label: 'Manage Team',
            description: 'View, manage, and remove collaborators',
            keywords: 'team list collaborators remove delete permissions roles',
            icon: Users,
            action: () => setActiveSection('team')
        },

        // --- Data Section ---
        {
            id: 'export_data',
            section: 'data',
            label: 'Export Data',
            description: 'Download your data as CSV',
            keywords: 'export download save backup csv excel',
            icon: Download,
            action: () => { setActiveSection('data'); setIsExportModalOpen(true) }
        },
        {
            id: 'import_data',
            section: 'data',
            label: 'Import Data',
            description: 'Import members from CSV (Coming Soon)',
            keywords: 'import upload restore csv add bulk',
            icon: Upload,
            action: () => { setActiveSection('data'); toast.info('Import feature coming soon!') }
        },
        {
            id: 'clean_duplicates',
            section: 'data',
            label: 'Clean Duplicates',
            description: 'Find and merge duplicate members',
            keywords: 'duplicates clean fix merge cleanup',
            icon: RefreshCw,
            action: () => { setActiveSection('data'); toast.info('Cleanup duplicates in Dashboard → Duplicates tab') }
        },

        // --- Appearance Section ---
        {
            id: 'theme_light',
            section: 'appearance',
            label: 'Light Mode',
            description: 'Switch to light theme',
            keywords: 'light day white bright theme',
            icon: Sun,
            action: () => { setActiveSection('appearance'); setThemeMode('light') }
        },
        {
            id: 'theme_dark',
            section: 'appearance',
            label: 'Dark Mode',
            description: 'Switch to dark theme',
            keywords: 'dark night black dim theme',
            icon: Moon,
            action: () => { setActiveSection('appearance'); setThemeMode('dark') }
        },
        {
            id: 'theme_auto',
            section: 'appearance',
            label: 'Auto Theme',
            description: 'Sync with system settings',
            keywords: 'system auto default theme',
            icon: Laptop,
            action: () => { setActiveSection('appearance'); setThemeMode('system') }
        },
        {
            id: 'quick_attendance',
            section: 'appearance',
            label: 'Quick Attendance Access',
            description: 'Show attendance button on main app (secondary option)',
            keywords: 'quick attendance access button calendar secondary fallback',
            icon: Calendar,
            action: () => setActiveSection('appearance')
        },

        {
            id: 'archive_month',
            section: 'data',
            label: 'Archive Month',
            description: 'Export and delete old months to save storage',
            keywords: 'archive month delete export csv storage space free cleanup',
            icon: Archive,
            action: () => setActiveSection('data')
        },

        // --- Help & Danger ---
        {
            id: 'help_center',
            section: 'help',
            label: 'Help Center',
            description: 'View documentation and support',
            keywords: 'help support guide docs tutorial manual faq',
            icon: HelpCircle,
            action: () => setShowHelpCenter(true)
        },
        {
            id: 'delete_account',
            section: 'danger',
            label: 'Delete Account',
            description: 'Permanently remove your account',
            keywords: 'delete remove destroy account danger kill',
            icon: Trash2,
            isDestructive: true,
            action: () => setIsDeleteAccountOpen(true)
        }
    ], [user, currentTable, handleSignOut, setActiveSection])

    // Filter items based on search query
    const searchResults = useMemo(() => {
        if (!searchQuery.trim()) return []

        const query = searchQuery.toLowerCase().trim()

        return allSearchableItems.filter(item => {
            // Check direct matches
            const labelMatch = item.label.toLowerCase().includes(query)
            const descMatch = item.description.toLowerCase().includes(query)
            const keywordMatch = item.keywords.toLowerCase().includes(query)

            return labelMatch || descMatch || keywordMatch
        })
    }, [searchQuery, allSearchableItems])

    const getIconBgColor = (color) => {
        const colors = {
            blue: 'bg-orange-100 dark:bg-orange-900/30',
            purple: 'bg-purple-100 dark:bg-purple-900/30',
            green: 'bg-green-100 dark:bg-green-900/30',
            orange: 'bg-orange-100 dark:bg-orange-900/30',
            pink: 'bg-pink-100 dark:bg-pink-900/30',
            cyan: 'bg-cyan-100 dark:bg-cyan-900/30',
            red: 'bg-red-100 dark:bg-red-900/30'
        }
        return colors[color] || colors.blue
    }

    const getIconColor = (color) => {
        const colors = {
            blue: 'text-orange-600 dark:text-orange-400',
            purple: 'text-purple-600 dark:text-purple-400',
            green: 'text-green-600 dark:text-green-400',
            orange: 'text-orange-600 dark:text-orange-400',
            pink: 'text-pink-600 dark:text-pink-400',
            cyan: 'text-cyan-600 dark:text-cyan-400',
            red: 'text-red-600 dark:text-red-400'
        }
        return colors[color] || colors.blue
    }

    // Show Help Center Page
    if (showHelpCenter) {
        return (
            <HelpCenterPage
                onBack={() => setShowHelpCenter(false)}
                onNavigate={(target, options) => {
                    setShowHelpCenter(false)
                    if (target === 'dashboard' || target === 'settings') {
                        onBack?.()
                    }
                }}
            />
        )
    }

    // Render main settings list (when no section is active)
    const renderMainList = () => (
        <div className="min-h-screen bg-gray-50 dark:bg-gray-900">
            {/* Header */}
            <div className="fixed top-[90px] sm:top-[76px] md:top-[48px] left-0 right-0 z-50 w-full bg-gray-100/95 dark:bg-gray-950/90 backdrop-blur-sm border-b border-gray-200 dark:border-gray-800 shadow-sm">
                <div className="max-w-4xl mx-auto w-full px-4 py-3 sm:py-4 flex items-center gap-3 sm:gap-4 font-[var(--font-family)]">
                    <button
                        onClick={onBack}
                        className="p-2 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg transition-colors touch-target"
                    >
                        <ChevronLeft className="w-5 h-5 text-gray-600 dark:text-gray-300" />
                    </button>
                    <h1 className="text-lg sm:text-xl font-bold text-gray-900 dark:text-white">Settings</h1>
                </div>
            </div>

            <div className="max-w-4xl mx-auto px-3 sm:px-4 pt-[56px] sm:pt-[52px] md:pt-[60px] pb-8 space-y-3">
                {/* Search Bar */}
                <div className="w-full bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-4 mb-4">
                    <div className="relative">
                        <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-5 h-5 text-gray-400" />
                        <input
                            type="text"
                            placeholder="Search settings... (e.g., 'change profile picture', 'make text bigger')"
                            value={searchQuery}
                            onChange={(e) => setSearchQuery(e.target.value)}
                            className="w-full pl-10 pr-4 py-2 bg-gray-50 dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded-lg focus:outline-none focus:ring-2 focus:ring-orange-500 focus:border-transparent text-gray-900 dark:text-white placeholder-gray-500 dark:placeholder-gray-400"
                        />
                        {searchQuery && (
                            <button
                                onClick={() => setSearchQuery('')}
                                className="absolute right-3 top-1/2 transform -translate-y-1/2 p-1 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300"
                            >
                                <X className="w-4 h-4" />
                            </button>
                        )}
                    </div>
                </div>

                {/* Usage / Free plan awareness */}
                <div className="w-full bg-white dark:bg-gray-800 rounded-xl border border-orange-200/70 dark:border-orange-900/50 shadow-sm overflow-hidden">
                    <button
                        onClick={() => setShowStorageLimits(prev => !prev)}
                        className="w-full flex items-center justify-between p-4 hover:bg-gray-50 dark:hover:bg-gray-700/50 transition-colors"
                    >
                        <div className="flex items-center gap-2">
                            <Database className="w-4 h-4 text-orange-500" />
                            <p className="text-sm font-semibold text-gray-900 dark:text-white">Storage & Limits</p>
                        </div>
                        <div className="flex items-center gap-2">
                            <span className="text-xs font-medium px-2 py-1 rounded-full bg-orange-100 dark:bg-orange-900/40 text-orange-700 dark:text-orange-300">Free Plan</span>
                            <ChevronDown className={`w-4 h-4 text-gray-400 transition-transform duration-200 ${showStorageLimits ? 'rotate-180' : ''}`} />
                        </div>
                    </button>

                    {showStorageLimits && (
                        <div className="px-4 pb-4 space-y-4">
                            {/* Database Size Bar */}
                            <div className="space-y-1.5">
                                <div className="flex items-center justify-between text-xs">
                                    <span className="font-semibold text-gray-800 dark:text-gray-200">Database Storage</span>
                                    {dbLoading ? (
                                        <span className="text-gray-400 flex items-center gap-1"><Loader2 className="w-3 h-3 animate-spin" /> Loading...</span>
                                    ) : dbUsage ? (
                                        <span className={`font-medium ${dbUsage.db_size_mb > DB_LIMIT_MB * 0.8 ? 'text-orange-600 dark:text-orange-400' : 'text-gray-700 dark:text-gray-200'}`}>
                                            {dbUsage.db_size_mb} / {DB_LIMIT_MB} MB ({Math.round((dbUsage.db_size_mb / DB_LIMIT_MB) * 100)}%)
                                        </span>
                                    ) : (
                                        <span className="text-gray-400">Unavailable</span>
                                    )}
                                </div>
                                <div className="h-3 rounded-full bg-gray-100 dark:bg-gray-700 overflow-hidden border border-gray-200 dark:border-gray-600">
                                    <div
                                        className={`h-full rounded-full transition-all ${
                                            dbUsage && dbUsage.db_size_mb > DB_LIMIT_MB * 0.8
                                                ? 'bg-gradient-to-r from-orange-400 to-red-500'
                                                : 'bg-gradient-to-r from-emerald-400 to-emerald-500'
                                        }`}
                                        style={{ width: `${dbUsage ? Math.max(1, Math.min(100, Math.round((dbUsage.db_size_mb / DB_LIMIT_MB) * 100))) : 0}%` }}
                                    />
                                </div>
                                {dbUsage && (
                                    <div className="flex items-center justify-between text-[11px]">
                                        <span className="text-emerald-600 dark:text-emerald-400 font-medium">
                                            {(DB_LIMIT_MB - dbUsage.db_size_mb).toFixed(1)} MB free
                                        </span>
                                        <button onClick={fetchDbUsage} className="text-orange-500 hover:text-orange-600 dark:hover:text-orange-400 flex items-center gap-1 transition-colors">
                                            <RefreshCw className={`w-3 h-3 ${dbLoading ? 'animate-spin' : ''}`} /> Refresh
                                        </button>
                                    </div>
                                )}
                            </div>

                            {/* Archive Recommendation */}
                            {oldestMonthTable && (
                                <div className="bg-amber-50 dark:bg-amber-900/15 border border-amber-200 dark:border-amber-800/50 rounded-lg p-2.5 flex items-start gap-2">
                                    <Archive className="w-3.5 h-3.5 text-amber-600 dark:text-amber-400 mt-0.5 flex-shrink-0" />
                                    <div className="flex-1 min-w-0">
                                        <p className="text-[11px] text-amber-800 dark:text-amber-300">
                                            <span className="font-semibold">Tip:</span> Archive <strong>{oldestMonthTable.table_name.replace('_', ' ')}</strong> ({oldestMonthTable.size_mb} MB) to free up space.
                                        </p>
                                    </div>
                                    <button
                                        onClick={() => { setActiveSection('data'); setArchiveMonth(oldestMonthTable.table_name) }}
                                        className="text-[11px] font-medium text-amber-700 dark:text-amber-300 hover:text-amber-900 dark:hover:text-amber-100 whitespace-nowrap underline"
                                    >
                                        Archive
                                    </button>
                                </div>
                            )}

                            {/* Divider */}
                            <div className="border-t border-gray-100 dark:border-gray-700" />

                            {/* Email Rate Limit Bar */}
                            <div className="space-y-1.5">
                                <div className="flex items-center justify-between text-xs">
                                    <span className="font-semibold text-gray-800 dark:text-gray-200 flex items-center gap-1.5">
                                        <Mail className="w-3.5 h-3.5 text-purple-500" />
                                        Auth Emails
                                    </span>
                                    <span className={`font-medium ${emailsRemaining === 0 ? 'text-red-600 dark:text-red-400' : 'text-gray-700 dark:text-gray-200'}`}>
                                        {emailSends.length} / {EMAIL_RATE_LIMIT} per hour
                                    </span>
                                </div>
                                <div className="h-3 rounded-full bg-gray-100 dark:bg-gray-700 overflow-hidden border border-gray-200 dark:border-gray-600">
                                    <div
                                        className={`h-full rounded-full transition-all ${
                                            emailsRemaining === 0
                                                ? 'bg-gradient-to-r from-red-400 to-red-500'
                                                : emailPct >= 66
                                                ? 'bg-gradient-to-r from-amber-400 to-orange-500'
                                                : 'bg-gradient-to-r from-purple-400 to-purple-500'
                                        }`}
                                        style={{ width: `${Math.max(emailPct > 0 ? 4 : 0, Math.min(100, emailPct))}%` }}
                                    />
                                </div>
                                <div className="flex items-center justify-between text-[11px]">
                                    {emailsRemaining > 0 ? (
                                        <span className="text-purple-600 dark:text-purple-400 font-medium">
                                            {emailsRemaining} email{emailsRemaining !== 1 ? 's' : ''} remaining
                                        </span>
                                    ) : (
                                        <span className="text-red-600 dark:text-red-400 font-medium flex items-center gap-1">
                                            Rate limit reached
                                        </span>
                                    )}
                                    {emailCountdown && (
                                        <span className="text-orange-600 dark:text-orange-400 font-medium flex items-center gap-1">
                                            <Loader2 className="w-3 h-3 animate-spin" />
                                            Resets in {emailCountdown}
                                        </span>
                                    )}
                                    {!emailCountdown && emailSends.length === 0 && (
                                        <span className="text-gray-400">No emails sent recently</span>
                                    )}
                                </div>
                            </div>

                            <p className="text-[10px] text-gray-400 dark:text-gray-500">
                                Includes magic links, password resets, and invites. Resets hourly.
                            </p>

                            {/* Brief explanation */}
                            <div className="pt-3 border-t border-gray-100 dark:border-gray-700 space-y-2">
                                <p className="text-xs text-gray-600 dark:text-gray-400 leading-relaxed">
                                    <strong className="text-gray-800 dark:text-gray-200">Database Storage</strong> is the space your member data, attendance records, and monthly tables use on the server.
                                    <strong className="text-gray-800 dark:text-gray-200"> Auth Emails</strong> are login-related emails (magic links, password resets, invites) — limited to 3 per hour on the free plan.
                                    Archiving old months exports them as CSV and removes them from the database, freeing up storage.
                                </p>

                                {/* Learn More dropdown */}
                                <button
                                    onClick={() => setShowUsageDetails(prev => !prev)}
                                    className="flex items-center gap-1.5 text-xs font-medium text-orange-600 dark:text-orange-400 hover:text-orange-700 dark:hover:text-orange-300 transition-colors"
                                >
                                    <ChevronDown className={`w-3.5 h-3.5 transition-transform ${showUsageDetails ? 'rotate-180' : ''}`} />
                                    {showUsageDetails ? 'Show less' : 'Learn more about how this works'}
                                </button>

                                {showUsageDetails && (
                                    <div className="bg-gray-50 dark:bg-gray-700/40 rounded-lg p-3 space-y-3 text-xs text-gray-600 dark:text-gray-400 leading-relaxed animate-in fade-in">

                                        {/* What is Supabase */}
                                        <div>
                                            <p className="font-semibold text-gray-800 dark:text-gray-200 mb-1 flex items-center gap-1.5">
                                                <Database className="w-3.5 h-3.5 text-emerald-500" />
                                                What powers this app?
                                            </p>
                                            <p>
                                                This app uses <strong>Supabase</strong> — an open-source backend platform — to store all your data securely in a real PostgreSQL database hosted in the cloud (EU-North region).
                                                Supabase handles your database, user authentication (login/signup), and secure access control so your data stays private and only accessible to you and your team.
                                            </p>
                                        </div>

                                        {/* Database Storage explained */}
                                        <div>
                                            <p className="font-semibold text-gray-800 dark:text-gray-200 mb-1 flex items-center gap-1.5">
                                                <Database className="w-3.5 h-3.5 text-orange-500" />
                                                Database Storage (500 MB limit)
                                            </p>
                                            <p>
                                                Every member you add, every attendance record you mark, and every monthly table you create takes up space in the database.
                                                On the <strong>free plan</strong>, you get <strong>500 MB</strong> of total database storage. The bar above shows how much you've used.
                                            </p>
                                            <p className="mt-1">
                                                For context, 500 MB can comfortably hold <strong>thousands of members</strong> across dozens of monthly tables.
                                                You'll likely never hit this limit with normal use, but it's good to keep an eye on it.
                                            </p>
                                        </div>

                                        {/* Why archive */}
                                        <div>
                                            <p className="font-semibold text-gray-800 dark:text-gray-200 mb-1 flex items-center gap-1.5">
                                                <Archive className="w-3.5 h-3.5 text-amber-500" />
                                                Why archive old months?
                                            </p>
                                            <p>
                                                Each monthly table (e.g. "January 2026") stores member names, attendance dates, and status for that month.
                                                Over time, old months you no longer need to edit just sit in the database taking up space.
                                            </p>
                                            <p className="mt-1">
                                                <strong>Archiving</strong> exports the month's data as a CSV file (which you download and keep), then deletes the table from the database.
                                                This frees up storage while keeping your records safe on your device. You can always re-import the CSV later if needed.
                                            </p>
                                            <p className="mt-1 text-amber-700 dark:text-amber-400">
                                                <strong>Recommendation:</strong> Archive months that are more than 2–3 months old, especially if you have many monthly tables.
                                            </p>
                                        </div>

                                        {/* Auth Emails explained */}
                                        <div>
                                            <p className="font-semibold text-gray-800 dark:text-gray-200 mb-1 flex items-center gap-1.5">
                                                <Mail className="w-3.5 h-3.5 text-purple-500" />
                                                Auth Emails (3 per hour limit)
                                            </p>
                                            <p>
                                                Supabase sends authentication emails on your behalf for:
                                            </p>
                                            <ul className="list-disc list-inside mt-1 space-y-0.5 ml-1">
                                                <li><strong>Magic links</strong> — passwordless login links sent to collaborators</li>
                                                <li><strong>Password resets</strong> — "forgot password" emails</li>
                                                <li><strong>Invites</strong> — when you invite a new team member</li>
                                                <li><strong>Signup confirmations</strong> — email verification for new accounts</li>
                                            </ul>
                                            <p className="mt-1">
                                                On the free plan, Supabase limits this to <strong>3 emails per hour</strong> to prevent abuse.
                                                The counter above tracks how many you've sent in the current hour. Once you hit 3, you'll need to wait for the timer to reset before sending more.
                                            </p>
                                            <p className="mt-1">
                                                This is a <strong>server-side limit</strong> set by Supabase — the countdown timer shows approximately when you can send again.
                                                Normal usage (occasional invites or password resets) will rarely hit this limit.
                                            </p>
                                        </div>

                                        {/* Free plan summary */}
                                        <div className="bg-orange-50 dark:bg-orange-900/20 border border-orange-200 dark:border-orange-800/50 rounded-lg p-2.5">
                                            <p className="font-semibold text-orange-800 dark:text-orange-300 mb-1 text-[11px]">Free Plan Summary</p>
                                            <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-[11px]">
                                                <span className="text-gray-600 dark:text-gray-400">Database</span>
                                                <span className="font-medium text-gray-800 dark:text-gray-200">500 MB</span>
                                                <span className="text-gray-600 dark:text-gray-400">Auth emails</span>
                                                <span className="font-medium text-gray-800 dark:text-gray-200">3 per hour</span>
                                                <span className="text-gray-600 dark:text-gray-400">File storage</span>
                                                <span className="font-medium text-gray-800 dark:text-gray-200">1 GB</span>
                                                <span className="text-gray-600 dark:text-gray-400">Realtime connections</span>
                                                <span className="font-medium text-gray-800 dark:text-gray-200">200 concurrent</span>
                                                <span className="text-gray-600 dark:text-gray-400">Edge functions</span>
                                                <span className="font-medium text-gray-800 dark:text-gray-200">500K invocations/month</span>
                                            </div>
                                        </div>
                                    </div>
                                )}
                            </div>
                        </div>
                    )}
                </div>

                {/* Profile Card */}
                <div className="w-full bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-4">
                    <div className="flex items-center gap-4">
                        <div className="relative flex-shrink-0">
                            {(() => {
                                const localAvatar = typeof window !== 'undefined' ? localStorage.getItem('user_avatar_url') : null
                                const avatarUrl = localAvatar || user?.user_metadata?.avatar_url
                                return avatarUrl ? (
                                    <img
                                        src={avatarUrl}
                                        alt="Profile"
                                        className="w-14 h-14 rounded-full object-cover border-2 border-white dark:border-gray-600 shadow-md"
                                    />
                                ) : (
                                    <div className="w-14 h-14 rounded-full bg-gradient-to-br from-orange-500 to-purple-600 flex items-center justify-center text-white text-xl font-bold shadow-md">
                                        {user?.email?.[0]?.toUpperCase() || 'U'}
                                    </div>
                                )
                            })()}
                            <button
                                onClick={() => setIsPhotoEditorOpen(true)}
                                className="absolute -bottom-1 -right-1 p-1 bg-orange-600 hover:bg-orange-700 text-white rounded-full shadow-lg transition-colors"
                            >
                                <Pencil className="w-2.5 h-2.5" />
                            </button>
                        </div>
                        <div className="flex-1 min-w-0">
                            <h4 className="font-semibold text-gray-900 dark:text-white truncate">
                                {user?.user_metadata?.full_name || user?.email?.split('@')[0] || 'User'}
                            </h4>
                            <p className="text-sm text-gray-500 dark:text-gray-400 truncate">{user?.email}</p>
                        </div>
                        <button
                            onClick={() => setActiveSection('account')}
                            className="p-2 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg"
                        >
                            <ChevronRight className="w-5 h-5 text-gray-400" />
                        </button>
                    </div>
                </div>

                {/* Tutorial / Onboarding */}
                <button
                    onClick={() => window.openOnboarding?.()}
                    className="w-full flex items-center gap-3 px-4 py-3.5 bg-gradient-to-r from-orange-500 to-purple-600 text-white rounded-xl shadow-sm hover:shadow-md transition-all"
                >
                    <div className="p-2 bg-white/20 rounded-lg">
                        <HelpCircle className="w-5 h-5 text-white" />
                    </div>
                    <div className="flex-1 text-left">
                        <p className="font-semibold">Show Tutorial</p>
                        <p className="text-sm text-white/80">Replay the getting started guide</p>
                    </div>
                    <ChevronRight className="w-5 h-5 text-white/70" />
                </button>

                {/* Content Area: Either Search Results or Section List */}
                <div className="w-full bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 overflow-hidden divide-y divide-gray-100 dark:divide-gray-700">
                    {searchQuery ? (
                        /* Search Results */
                        searchResults.length > 0 ? (
                            searchResults.map((item) => {
                                const Icon = item.icon || Search
                                const sectionColor = sections.find(s => s.id === item.section)?.color || 'blue'

                                return (
                                    <button
                                        key={item.id}
                                        onClick={() => {
                                            item.action()
                                        }}
                                        className="w-full flex items-center gap-3 px-4 py-3.5 hover:bg-gray-50 dark:hover:bg-gray-700/50 transition-colors text-left group"
                                    >
                                        <div className={`p-2 rounded-lg ${item.isDestructive ? 'bg-red-100 dark:bg-red-900/30' : getIconBgColor(sectionColor)}`}>
                                            <Icon className={`w-5 h-5 ${item.isDestructive ? 'text-red-600 dark:text-red-400' : getIconColor(sectionColor)}`} />
                                        </div>
                                        <div className="flex-1 min-w-0">
                                            <div className="flex items-center gap-2">
                                                <p className={`font-medium ${item.isDestructive ? 'text-red-600 dark:text-red-400' : 'text-gray-900 dark:text-white'}`}>
                                                    {item.label}
                                                </p>
                                                {/* Section Badge */}
                                                <span className="text-xs px-2 py-0.5 rounded-full bg-gray-100 dark:bg-gray-700 text-gray-500 dark:text-gray-400 border border-gray-200 dark:border-gray-600 truncate">
                                                    {sections.find(s => s.id === item.section)?.label}
                                                </span>
                                            </div>
                                            <p className="text-sm text-gray-500 dark:text-gray-400 truncate group-hover:text-gray-700 dark:group-hover:text-gray-300 transition-colors">
                                                {item.description}
                                            </p>
                                        </div>
                                        <ChevronRight className="w-5 h-5 text-gray-400 group-hover:text-orange-500 transition-colors" />
                                    </button>
                                )
                            })
                        ) : (
                            /* No Results */
                            <div className="p-8 text-center flex flex-col items-center justify-center">
                                <div className="p-3 bg-gray-100 dark:bg-gray-700 rounded-full mb-3">
                                    <Search className="w-6 h-6 text-gray-400" />
                                </div>
                                <p className="text-gray-900 dark:text-white font-medium mb-1">No settings found</p>
                                <p className="text-sm text-gray-500 dark:text-gray-400">
                                    No results for "{searchQuery}". Try different keywords.
                                </p>
                            </div>
                        )
                    ) : (
                        /* Default Section List */
                        sections.filter(s => s.id !== 'danger').map((section) => {
                            const Icon = section.icon
                            return (
                                <button
                                    key={section.id}
                                    onClick={() => {
                                        if (section.id === 'help') {
                                            setShowHelpCenter(true)
                                        } else {
                                            setActiveSection(section.id)
                                        }
                                    }}
                                    className="w-full flex items-center gap-3 px-4 py-3.5 hover:bg-gray-50 dark:hover:bg-gray-700/50 transition-colors group"
                                >
                                    <div className={`p-2 rounded-lg ${getIconBgColor(section.color)}`}>
                                        <Icon className={`w-5 h-5 ${getIconColor(section.color)}`} />
                                    </div>
                                    <div className="flex-1 text-left min-w-0">
                                        <p className="font-medium text-gray-900 dark:text-white">{section.label}</p>
                                        <p className="text-sm text-gray-500 dark:text-gray-400 truncate group-hover:text-gray-700 dark:group-hover:text-gray-300 transition-colors">
                                            {getSectionPreview(section.id)}
                                        </p>
                                    </div>
                                    <div className="flex items-center gap-2">
                                        {section.id === 'account' && window.__needsPasswordSetup && (
                                            <span className="relative flex h-5 w-5">
                                                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-400 opacity-75"></span>
                                                <span className="relative inline-flex items-center justify-center h-5 w-5 rounded-full bg-red-500 text-white text-[10px] font-bold">1</span>
                                            </span>
                                        )}
                                        {section.highlight && (
                                            <span className="text-xs bg-orange-100 dark:bg-orange-900/50 text-orange-600 dark:text-orange-400 px-2 py-0.5 rounded-full">
                                                New
                                            </span>
                                        )}
                                        <ChevronRight className="w-5 h-5 text-gray-400 group-hover:text-orange-500 transition-colors" />
                                    </div>
                                </button>
                            )
                        })
                    )}
                </div>

                {/* Danger Zone - Separate Card (Only show if no search or if matching) */}
                {!searchQuery && (
                    <div className="w-full bg-white dark:bg-gray-800 rounded-xl border border-red-200 dark:border-red-900/50 overflow-hidden mt-4">
                        <button
                            onClick={() => setActiveSection('danger')}
                            className="w-full flex items-center gap-3 px-4 py-3.5 hover:bg-red-50 dark:hover:bg-red-900/10 transition-colors group"
                        >
                            <div className="p-2 rounded-lg bg-red-100 dark:bg-red-900/30">
                                <AlertTriangle className="w-5 h-5 text-red-600 dark:text-red-400" />
                            </div>
                            <div className="flex-1 text-left">
                                <p className="font-medium text-red-600 dark:text-red-400">Danger Zone</p>
                                <p className="text-sm text-red-500/70 dark:text-red-400/70 group-hover:text-red-600 dark:group-hover:text-red-300 transition-colors">Delete account</p>
                            </div>
                            <ChevronRight className="w-5 h-5 text-red-400 group-hover:text-red-600 transition-colors" />
                        </button>
                    </div>
                )}

                {/* Sign Out Button */}
                <button
                    onClick={handleSignOut}
                    className="w-full mt-4 py-3 bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-300 font-medium rounded-xl border border-gray-200 dark:border-gray-700 hover:bg-gray-200 dark:hover:bg-gray-700 transition-colors"
                >
                    Sign Out
                </button>
            </div>
        </div>
    )

    // Render detail view (when a section is active)
    const renderDetailView = () => {
        const currentSection = sections.find(s => s.id === activeSection)
        const Icon = currentSection?.icon || User

        return (
            <div className="min-h-screen bg-gray-50 dark:bg-gray-900">
                {/* Sticky Header - stays visible when scrolling */}
                <div className="fixed top-[90px] sm:top-[76px] md:top-[48px] left-0 right-0 z-30 w-full bg-gray-100/95 dark:bg-gray-950/90 backdrop-blur-sm border-b border-gray-200 dark:border-gray-800 shadow-sm">
                    <div className="max-w-4xl mx-auto w-full px-3 sm:px-4 py-2.5 sm:py-3 font-[var(--font-family)]">
                        <div className="flex items-center gap-2 sm:gap-3">
                            <button
                                onClick={() => setActiveSection(null)}
                                className="p-2 hover:bg-gray-200 dark:hover:bg-gray-700 rounded-lg transition-colors bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 shadow-sm touch-target"
                            >
                                <ChevronLeft className="w-5 h-5 text-gray-600 dark:text-gray-300" />
                            </button>
                            <div className="flex items-center gap-2 flex-1 min-w-0">
                                <div className={`p-1.5 rounded-lg ${getIconBgColor(currentSection?.color || 'blue')}`}>
                                    <Icon className={`w-4 h-4 ${getIconColor(currentSection?.color || 'blue')}`} />
                                </div>
                                <h1 className="text-base sm:text-lg font-bold text-gray-900 dark:text-white truncate">{currentSection?.label || 'Settings'}</h1>
                            </div>
                        </div>
                    </div>
                </div>

                <div className="max-w-4xl mx-auto px-3 sm:px-4 pt-[70px] sm:pt-[68px] md:pt-[110px] pb-8 space-y-4">
                    {renderContent()}
                </div>
            </div>
        )
    }

    // Main render
    return (
        <div onClickCapture={handleInteractionFeedback}>
            {activeSection === null ? renderMainList() : renderDetailView()}

            {/* Modals */}
            <ShareAccessModal
                isOpen={isShareModalOpen}
                onClose={handleShareModalClose}
                user={user}
            />
            <WorkspaceSettingsModal
                isOpen={isWorkspaceModalOpen}
                onClose={() => setIsWorkspaceModalOpen(false)}
            />
            <DeleteAccountModal
                isOpen={isDeleteAccountOpen}
                onClose={() => setIsDeleteAccountOpen(false)}
            />
            <ExportDataModal
                isOpen={isExportModalOpen}
                onClose={() => setIsExportModalOpen(false)}
            />
            <ProfilePhotoEditor
                isOpen={isPhotoEditorOpen}
                onClose={() => setIsPhotoEditorOpen(false)}
                user={user}
            />

            {isAdminControlsOpen && (
                <AdminControlsModal
                    isOpen={isAdminControlsOpen}
                    onClose={() => setIsAdminControlsOpen(false)}
                />
            )}

            <ConfirmModal
                isOpen={deletePrompt.isOpen}
                onClose={() => setDeletePrompt({ isOpen: false, tableName: null, label: '' })}
                onConfirm={handleDeleteTable}
                title="Delete Month"
                confirmText={deletingTable ? 'Deleting...' : 'Delete'}
                confirmButtonClass={`bg-red-600 hover:bg-red-700 text-white ${deletingTable ? 'opacity-70 cursor-not-allowed' : ''}`}
                cancelText="Cancel"
                cancelButtonClass="bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600"
            >
                <p className="text-base text-gray-700 dark:text-gray-300">
                    Are you sure you want to delete <strong>{deletePrompt.label}</strong>? This will permanently remove the month's table and its data.
                </p>
                <p className="text-sm text-red-500 mt-3">
                    This action cannot be undone.
                </p>
            </ConfirmModal>

            {/* Remove Collaborator Modal */}
            {pendingRemoval && (
                <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
                    <div className={`w-full max-w-md rounded-2xl shadow-2xl overflow-hidden ${isDarkMode ? 'bg-gray-800' : 'bg-white'}`}>
                        {/* Header */}
                        <div className={`px-6 py-4 flex items-center justify-between border-b ${isDarkMode ? 'border-gray-700' : 'border-gray-200'}`}>
                            <div className="flex items-center gap-3">
                                <div className={`p-2 rounded-lg ${isDarkMode ? 'bg-red-900/30' : 'bg-red-50'}`}>
                                    <Trash2 className="w-5 h-5 text-red-600 dark:text-red-400" />
                                </div>
                                <div>
                                    <h2 className="text-lg font-semibold text-red-700 dark:text-red-300">Remove access?</h2>
                                    <p className="text-sm text-gray-500 dark:text-gray-400">{pendingRemoval.email}</p>
                                </div>
                            </div>
                            <button
                                onClick={closeRemoveModal}
                                className="p-2 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
                                aria-label="Close"
                            >
                                <X className="w-5 h-5 text-gray-400" />
                            </button>
                        </div>

                        {/* Content */}
                        <div className="px-6 py-4 space-y-4">
                            <div className={`p-3 rounded-xl ${isDarkMode ? 'bg-yellow-900/30 border border-yellow-800' : 'bg-yellow-50 border border-yellow-200'}`}>
                                <p className={`text-sm ${isDarkMode ? 'text-yellow-100' : 'text-yellow-800'}`}>
                                    This removes their workspace access. It does not delete their Supabase account.
                                </p>
                            </div>

                            <div className="space-y-2">
                                <p className={`text-sm font-medium ${isDarkMode ? 'text-gray-200' : 'text-gray-800'}`}>Wait time</p>
                                <div className="flex items-center gap-3">
                                    {[0, 5, 10].map((m) => (
                                        <label key={m} className="flex items-center gap-2 text-sm cursor-pointer">
                                            <input
                                                type="radio"
                                                name="removeDelay"
                                                value={m}
                                                checked={removeDelay === m}
                                                onChange={() => setRemoveDelay(m)}
                                                disabled={isRemovingCollaborator}
                                            />
                                            <span className={isDarkMode ? 'text-gray-200' : 'text-gray-700'}>
                                                {m === 0 ? 'No wait' : `${m} minutes`}
                                            </span>
                                        </label>
                                    ))}
                                </div>
                                {isRemovingCollaborator && removeDelay > 0 && (
                                    <p className={`text-xs ${isDarkMode ? 'text-yellow-200' : 'text-yellow-700'}`}>
                                        Scheduled... time left: {Math.ceil(removeCountdownMs / 1000)}s
                                    </p>
                                )}
                            </div>

                            <div className="space-y-2">
                                <p className={`text-sm font-medium ${isDarkMode ? 'text-gray-200' : 'text-gray-800'}`}>Export this collaborator’s data</p>
                                <button
                                    onClick={handleExportCollaboratorData}
                                    disabled={isExportingCollaborator}
                                    className="px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 text-sm font-medium bg-gray-50 dark:bg-gray-700 hover:bg-gray-100 dark:hover:bg-gray-600 transition-colors disabled:opacity-60"
                                >
                                    {isExportingCollaborator ? 'Preparing...' : 'Export to CSV (placeholder)'}
                                </button>
                            </div>
                        </div>

                        {/* Footer */}
                        <div className={`px-6 py-4 flex gap-3 border-t ${isDarkMode ? 'border-gray-700' : 'border-gray-200'}`}>
                            <button
                                onClick={closeRemoveModal}
                                disabled={isRemovingCollaborator}
                                className={`flex-1 py-3 rounded-xl font-medium transition-colors ${isDarkMode ? 'bg-gray-700 hover:bg-gray-600 text-white' : 'bg-gray-200 hover:bg-gray-300 text-gray-900'} disabled:opacity-50`}
                            >
                                Cancel
                            </button>
                            <button
                                onClick={confirmRemoveCollaborator}
                                disabled={isRemovingCollaborator}
                                className={`flex-1 py-3 rounded-xl font-medium transition-colors flex items-center justify-center gap-2 ${isRemovingCollaborator ? 'bg-gray-400 text-gray-700' : 'bg-red-600 hover:bg-red-700 text-white'}`}
                            >
                                {isRemovingCollaborator ? (
                                    <>
                                        <Loader2 className="w-4 h-4 animate-spin" />
                                        Removing...
                                    </>
                                ) : (
                                    <>
                                        <Trash2 className="w-4 h-4" />
                                        {removeDelay ? 'Schedule Remove' : 'Remove Now'}
                                    </>
                                )}
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* Archive Month Modal */}
            <ArchiveMonthModal
                isOpen={!!archiveMonth}
                onClose={() => setArchiveMonth(null)}
                tableName={archiveMonth}
                onArchiveComplete={(archivedTable) => {
                    setArchiveMonth(null)
                    toast.success(`${archivedTable.replace('_', ' ')} archived successfully!`)
                }}
            />
        </div>
    )
}

export default SettingsPage
