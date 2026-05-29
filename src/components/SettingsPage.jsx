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
    Monitor,
    RotateCcw,
    Sparkles,
    Plus,
    Archive,
    BellRing,
    GripVertical,
    ArrowUp,
    ArrowDown
} from 'lucide-react'
import { useAuth } from '../context/AuthContext'
import { useTheme } from '../context/ThemeContext'
import { useApp } from '../context/AppContext'
import { toast } from 'react-toastify'
import { supabase } from '../lib/supabase'
import { executeSupabaseWrite } from '../utils/supabaseWrite'
import { GUIDED_FORM_FIELD_LABELS, GUIDED_FORM_FIELD_ORDER, normalizeGuidedOrder, sortGuidedSteps } from '../utils/guidedFormSettings'
import {
    getVisibleSettingsSearchItems,
    getVisibleSettingsSections,
    searchSettingsIndex
} from '../config/navigation.js'
import { getInstalledAppInfo } from '../utils/appUpdates.js'
import ConfirmModal from './ConfirmModal'
import useHapticFeedback from '../hooks/useHapticFeedback'

// Modals and heavy components are lazy-loaded for performance
const ShareAccessModal = React.lazy(() => import('./ShareAccessModal'))
const WorkspaceSettingsModal = React.lazy(() => import('./WorkspaceSettingsModal'))
const DeleteAccountModal = React.lazy(() => import('./DeleteAccountModal'))
const ExportDataModal = React.lazy(() => import('./ExportDataModal'))
const ProfilePhotoEditor = React.lazy(() => import('./ProfilePhotoEditor'))
const HelpCenterPage = React.lazy(() => import('./HelpCenterPage'))
const ActivityLogViewer = React.lazy(() => import('./ActivityLogViewer'))
const ExportCenterPage = React.lazy(() => import('./ExportCenterPage'))
const AdminControlsModal = React.lazy(() => import('./AdminControlsModal'))
const ArchiveMonthModal = React.lazy(() => import('./ArchiveMonthModal'))
const MonthPickerPopup = React.lazy(() => import('./MonthPickerPopup'))
const CombinedDatePicker = React.lazy(() => import('./CombinedDatePicker'))

// New extracted sections
const AccountSettingsSection = React.lazy(() => import('./AccountSettingsSection'))
const WorkspaceSettingsSection = React.lazy(() => import('./WorkspaceSettingsSection'))
const TeamSettingsSection = React.lazy(() => import('./TeamSettingsSection'))
const DataSettingsSection = React.lazy(() => import('./DataSettingsSection'))
const AppearanceSettingsSection = React.lazy(() => import('./AppearanceSettingsSection'))
const AccessibilitySettingsSection = React.lazy(() => import('./AccessibilitySettingsSection'))
const DangerSettingsSection = React.lazy(() => import('./DangerSettingsSection'))
const DeveloperToolsPanel = React.lazy(() => import('./DeveloperToolsPanel'))

const PreviewInput = ({ children, compact = false }) => (
    <div className={`guided-preview-input ${compact ? 'guided-preview-input-compact' : ''}`}>
        {children}
    </div>
)

const GuidedOrderPreview = ({ settings }) => {
    const orderedIds = useMemo(() => normalizeGuidedOrder(settings?.guidedOrder), [settings?.guidedOrder])
    const previewSteps = useMemo(() => sortGuidedSteps(
        orderedIds.map(id => ({
            id,
            enabled: !((id === 'tags' && !settings?.highlightTags) || (id === 'notes' && !settings?.highlightNotes))
        })),
        settings
    ), [orderedIds, settings])
    const guidableIds = useMemo(() => orderedIds.filter((id) => {
        if (id === 'tags') return settings?.highlightTags
        if (id === 'notes') return settings?.highlightNotes
        return true
    }), [orderedIds, settings?.highlightNotes, settings?.highlightTags])
    const [activeIndex, setActiveIndex] = useState(0)

    useEffect(() => {
        if (activeIndex >= guidableIds.length) setActiveIndex(0)
    }, [activeIndex, guidableIds.length])

    useEffect(() => {
        if (!settings?.enabled || guidableIds.length <= 1) return undefined
        const timer = setInterval(() => {
            setActiveIndex((current) => (current + 1) % guidableIds.length)
        }, 1700)
        return () => clearInterval(timer)
    }, [guidableIds.length, settings?.enabled])

    const activeId = settings?.enabled ? previewSteps.filter(step => step.enabled !== false)[activeIndex]?.id : null

    const renderPreviewSection = (id) => {
        const active = activeId === id
        const isSkipped = (id === 'tags' && !settings?.highlightTags) || (id === 'notes' && !settings?.highlightNotes)
        const wrapperClass = `guided-preview-section guided-form-field ${active ? 'guided-form-field-active' : ''} ${isSkipped ? 'guided-preview-section-muted' : ''}`

        const cue = active && settings?.showNextButton === true && (
            <div className={`guided-form-cue ${settings?.pulseNextButton === false ? '' : 'guided-form-cue-pulse'}`} aria-hidden="true">
                <span>→</span>
                <span>Next</span>
            </div>
        )

        if (id === 'full-name') {
            return (
                <div key={id} className={wrapperClass}>
                    {cue}
                    <label>Full Name *</label>
                    <PreviewInput>Enter full name</PreviewInput>
                </div>
            )
        }
        if (id === 'gender') {
            return (
                <div key={id} className={wrapperClass}>
                    {cue}
                    <label>Gender *</label>
                    <div className="grid grid-cols-2 gap-2">
                        <PreviewInput compact>Male</PreviewInput>
                        <PreviewInput compact>Female</PreviewInput>
                    </div>
                </div>
            )
        }
        if (id === 'phone') {
            return (
                <div key={id} className={wrapperClass}>
                    {cue}
                    <label>Phone Number</label>
                    <PreviewInput>
                        <span>598999819</span>
                        <span className="guided-preview-pill">No Phone</span>
                    </PreviewInput>
                </div>
            )
        }
        if (id === 'dob') {
            return (
                <div key={id} className={wrapperClass}>
                    {cue}
                    <label>Date of Birth</label>
                    <PreviewInput>Select date</PreviewInput>
                </div>
            )
        }
        if (id === 'age') {
            return (
                <div key={id} className={wrapperClass}>
                    {cue}
                    <label>Age</label>
                    <PreviewInput>Age</PreviewInput>
                </div>
            )
        }
        if (id === 'level') {
            return (
                <div key={id} className={wrapperClass}>
                    {cue}
                    <label>Current Level</label>
                    <PreviewInput>Select level</PreviewInput>
                </div>
            )
        }
        if (id === 'tags') {
            return (
                <div key={id} className={wrapperClass}>
                    {cue}
                    <label>Tags {isSkipped && <span className="guided-preview-muted-label">not highlighted</span>}</label>
                    <div className="flex flex-wrap gap-2">
                        {['Choir Department', 'Dance Department', 'Data Department', 'Media Department', 'Protocol Department', 'Ushering Department'].map(tag => (
                            <span key={tag} className="guided-preview-chip">{tag}</span>
                        ))}
                    </div>
                </div>
            )
        }
        if (id === 'attendance') {
            return (
                <div key={id} className={wrapperClass}>
                    {cue}
                    <label>May 2026 Sunday Attendance (Optional)</label>
                    <div className="space-y-2">
                        {[3, 10, 17, 24, 31].map(day => (
                            <div key={day} className="guided-preview-attendance-row">
                                <span>Sunday, May {day}, 2026</span>
                                <div className="flex gap-1">
                                    <span>Present</span>
                                    <span>Absent</span>
                                    <span>Clear</span>
                                </div>
                            </div>
                        ))}
                    </div>
                </div>
            )
        }
        if (id === 'parent') {
            return (
                <div key={id} className={wrapperClass}>
                    {cue}
                    <label>Parent/Guardian Info</label>
                    <div className="space-y-2">
                        <span className="guided-preview-subtitle">Parent/Guardian 1 *</span>
                        <PreviewInput>Name</PreviewInput>
                        <PreviewInput><span>Phone Number</span><span className="guided-preview-pill">No Phone</span></PreviewInput>
                        <span className="guided-preview-subtitle">Parent/Guardian 2 (Optional)</span>
                        <PreviewInput>Name</PreviewInput>
                        <PreviewInput><span>Phone Number</span><span className="guided-preview-pill">No Phone</span></PreviewInput>
                    </div>
                </div>
            )
        }
        if (id === 'notes') {
            return (
                <div key={id} className={wrapperClass}>
                    {cue}
                    <label>Notes (Optional) {isSkipped && <span className="guided-preview-muted-label">not highlighted</span>}</label>
                    <PreviewInput> </PreviewInput>
                </div>
            )
        }
        return null
    }

    return (
        <div className="guided-preview-panel">
            <div className="flex items-center justify-between gap-3 mb-3">
                <div>
                    <p className="text-sm font-semibold text-gray-900 dark:text-white">Live Preview</p>
                    <p className="text-xs text-gray-500 dark:text-gray-400">Preview only. It does not edit member data.</p>
                </div>
                <span className={`text-xs px-2 py-1 rounded-full ${settings?.enabled ? 'bg-orange-100 text-orange-700 dark:bg-orange-900/40 dark:text-orange-300' : 'bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-300'}`}>
                    {settings?.enabled ? 'Guide On' : 'Guide Off'}
                </span>
            </div>
            <div className="guided-preview-scroll">
                {orderedIds.map(renderPreviewSection)}
            </div>
        </div>
    )
}


const LazyPanelFallback = () => (
    <div className="flex items-center justify-center py-10">
        <Loader2 className="w-6 h-6 animate-spin text-orange-600 dark:text-orange-400" />
    </div>
)

const SettingsPage = ({ onBack, navigateToSection, onCreateMonth, onOpenAddMember }) => {
    const { user, signOut, preferences, resetPassword, saveUserPreferences, isDeveloperBypass } = useAuth()
    const { isDarkMode, toggleTheme, themeMode, setThemeMode, commandKEnabled, setCommandKEnabled } = useTheme()
    const { members, monthlyTables, currentTable, setCurrentTable, isSupabaseConfigured, createNewMonth, deleteMonthTable, isCollaborator, isAdminCollaborator, dataOwnerId, lockedDefaultDate, setCollaboratorOverride, selectedAttendanceDate, setAndSaveAttendanceDate, deleteMember, forceRefreshMembersSilent, loadAllAttendanceData, loadAllBadgeData, refreshSearch, validateMemberData, getPastSundays, getMissingAttendance, autoAllDatesEnabled, setAutoAllDatesEnabled, missingInfoPromptEnabled, setMissingInfoPromptEnabled, guidedFormSettings, setGuidedFormSetting, personalCalendarMode, isPersonalManualMode, manualMonthTable, manualSundayDate, manualOverrideUntil, setPersonalCalendarMode, isOnline, offlineMode, setOfflineMode, isOfflineModeActive, offlineModeStatus, offlineCacheMeta, pendingSyncCount, isPreparingOffline, isSyncingOffline, prepareOfflineData, clearOfflineCacheData, syncOfflineChanges } = useApp()
    const { selection } = useHapticFeedback()
    const isDeveloperToolsEnabled = import.meta.env.DEV

    const [activeSection, setActiveSection] = useState(null) // null = show main list
    const [searchQuery, setSearchQuery] = useState('')
    const [highlightedSettingId, setHighlightedSettingId] = useState(null)
    const [guidedOrderDragId, setGuidedOrderDragId] = useState(null)
    const highlightTimerRef = useRef(null)
    const [showHelpCenter, setShowHelpCenter] = useState(false)
    const [archiveMonth, setArchiveMonth] = useState(null) // table name to archive

    const focusSettingTarget = useCallback((settingId) => {
        if (!settingId || typeof window === 'undefined') return
        if (highlightTimerRef.current) {
            window.clearTimeout(highlightTimerRef.current)
        }
        setHighlightedSettingId(settingId)
        window.setTimeout(() => {
            const target = document.querySelector(`[data-setting-id="${settingId}"]`)
            if (target) {
                target.scrollIntoView({ behavior: 'smooth', block: 'center' })
                if (typeof target.focus === 'function') {
                    target.focus({ preventScroll: true })
                }
            }
        }, 120)
        highlightTimerRef.current = window.setTimeout(() => {
            setHighlightedSettingId(null)
            highlightTimerRef.current = null
        }, 1800)
    }, [])

    const navigateToSetting = useCallback((section, settingId = null) => {
        if (!section) return
        setSearchQuery('')
        if (section === 'help') {
            setShowHelpCenter(true)
            return
        }
        setActiveSection(section)
        if (settingId) {
            focusSettingTarget(settingId)
        }
    }, [focusSettingTarget])

    // Handle navigation from command palette
    useEffect(() => {
        if (navigateToSection) {
            if (typeof navigateToSection === 'string') {
                navigateToSetting(navigateToSection)
                return
            }
            navigateToSetting(navigateToSection.section, navigateToSection.settingId)
        }
    }, [navigateToSection, navigateToSetting])

    useEffect(() => () => {
        if (highlightTimerRef.current) {
            window.clearTimeout(highlightTimerRef.current)
        }
    }, [])

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
        if (newValue) {
            toast.success('Auto-All-Dates enabled: will auto-mark all dates to present day')
        } else {
            toast.info('Auto-All-Dates disabled')
        }
    }

    const toggleMissingInfoPrompt = () => {
        const newValue = !missingInfoPromptEnabled
        setMissingInfoPromptEnabled(newValue)
        if (newValue) {
            toast.success('Missing info popup enabled')
        } else {
            toast.info('Missing info popup disabled')
        }
    }

    const toggleGuidedFormSetting = (key, label) => {
        const newValue = !guidedFormSettings?.[key]
        setGuidedFormSetting(key, newValue)
        toast.info(`${label} ${newValue ? 'enabled' : 'disabled'}`)
    }

    const guidedOrder = useMemo(
        () => normalizeGuidedOrder(guidedFormSettings?.guidedOrder),
        [guidedFormSettings?.guidedOrder]
    )

    const saveGuidedOrder = useCallback((nextOrder) => {
        setGuidedFormSetting('guidedOrder', normalizeGuidedOrder(nextOrder))
    }, [setGuidedFormSetting])

    const moveGuidedOrderItem = useCallback((fieldId, direction) => {
        const currentIndex = guidedOrder.indexOf(fieldId)
        const nextIndex = currentIndex + direction
        if (currentIndex < 0 || nextIndex < 0 || nextIndex >= guidedOrder.length) return
        const nextOrder = [...guidedOrder]
        const [moved] = nextOrder.splice(currentIndex, 1)
        nextOrder.splice(nextIndex, 0, moved)
        saveGuidedOrder(nextOrder)
        selection()
    }, [guidedOrder, saveGuidedOrder, selection])

    const moveGuidedOrderItemTo = useCallback((fieldId, targetFieldId) => {
        if (!fieldId || !targetFieldId || fieldId === targetFieldId) return
        const nextOrder = [...guidedOrder]
        const fromIndex = nextOrder.indexOf(fieldId)
        const toIndex = nextOrder.indexOf(targetFieldId)
        if (fromIndex < 0 || toIndex < 0) return
        const [moved] = nextOrder.splice(fromIndex, 1)
        nextOrder.splice(toIndex, 0, moved)
        saveGuidedOrder(nextOrder)
        selection()
    }, [guidedOrder, saveGuidedOrder, selection])

    const resetGuidedOrder = useCallback(() => {
        saveGuidedOrder(GUIDED_FORM_FIELD_ORDER)
        toast.info('Guided order reset')
    }, [saveGuidedOrder])


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
    const monthViewMode = 'list'
    const [selectedYear, setSelectedYear] = useState(new Date().getFullYear())
    const [liveClock, setLiveClock] = useState(() => new Date())
    const [showMonthDropdown, setShowMonthDropdown] = useState(false)
    const monthDropdownRef = useRef(null)
    const [isDevMemberDropdownOpen, setIsDevMemberDropdownOpen] = useState(false)
    const devMemberDropdownRef = useRef(null)
    const [deletingTable, setDeletingTable] = useState(null)
    const [deletePrompt, setDeletePrompt] = useState({
        isOpen: false,
        tableName: null,
        label: ''
    })
    const [isOverrideSaving, setIsOverrideSaving] = useState(false)
    const [dob, setDob] = useState('')
    const [isDobSaving, setIsDobSaving] = useState(false)
    const [installedAppInfo, setInstalledAppInfo] = useState(null)

    useEffect(() => {
        if (user?.user_metadata?.date_of_birth) {
            setDob(user.user_metadata.date_of_birth)
        }
    }, [user])

    useEffect(() => {
        let cancelled = false
        getInstalledAppInfo().then((info) => {
            if (!cancelled) setInstalledAppInfo(info)
        })
        return () => {
            cancelled = true
        }
    }, [])

    const handleSaveDob = async () => {
        if (!user) return
        setIsDobSaving(true)
        try {
            const { error } = await supabase.auth.updateUser({
                data: { date_of_birth: dob }
            })
            if (error) throw error
            toast.success('Date of birth updated')
        } catch (error) {
            console.error('Error updating DOB:', error)
            toast.error('Failed to update date of birth')
        } finally {
            setIsDobSaving(false)
        }
    }
    const [showOverridePicker, setShowOverridePicker] = useState(false)
    const overrideButtonRef = useRef(null)
    const [showPersonalMonthPicker, setShowPersonalMonthPicker] = useState(false)
    const personalMonthButtonRef = useRef(null)
    const [workspacePanels, setWorkspacePanels] = useState({
        overview: true,
        controls: true,
        months: false
    })
    const updatePreferences = useCallback((nextPreferences) => {
        if (!nextPreferences || typeof nextPreferences !== 'object') return
        saveUserPreferences?.(nextPreferences)
    }, [saveUserPreferences])

    const toggleWorkspacePanel = useCallback((panelKey) => {
        selection()
        setWorkspacePanels((prev) => ({
            ...prev,
            [panelKey]: !prev[panelKey]
        }))
    }, [selection])

    const copyTextToClipboard = useCallback(async (text, successMessage = 'Copied to clipboard') => {
        try {
            await navigator.clipboard.writeText(text)
            toast.success(successMessage)
        } catch (error) {
            console.error('Clipboard copy failed:', error)
            toast.error('Failed to copy to clipboard')
        }
    }, [])

    useEffect(() => {
        const timer = setInterval(() => setLiveClock(new Date()), 30000)
        return () => clearInterval(timer)
    }, [])


    // QA logic has been moved to DeveloperToolsPanel.jsx


    useEffect(() => {
        const handleDocumentClick = (event) => {
            if (showMonthDropdown && monthDropdownRef.current && !monthDropdownRef.current.contains(event.target)) {
                setShowMonthDropdown(false)
            }
            if (isDevMemberDropdownOpen && devMemberDropdownRef.current && !devMemberDropdownRef.current.contains(event.target)) {
                setIsDevMemberDropdownOpen(false)
            }
        }
        document.addEventListener('mousedown', handleDocumentClick)
        return () => document.removeEventListener('mousedown', handleDocumentClick)
    }, [showMonthDropdown, isDevMemberDropdownOpen])

    // Database Usage (real query)
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

    // Email usage tracking for Supabase free-tier awareness
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
            if (!user?.id || isDeveloperBypass || !isSupabaseConfigured()) {
                setCollaborators([])
                return
            }

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
    }, [user?.id, isDeveloperBypass, isSupabaseConfigured])

    // Refresh collaborators when modal closes
    const handleShareModalClose = async () => {
        setIsShareModalOpen(false)
        if (user && !isDeveloperBypass && isSupabaseConfigured()) {
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

    // Helper function to get month display name from table name
    const getMonthDisplayName = (tableName) => {
        // Convert table name like "October_2025" to "October 2025"
        return tableName.replace('_', ' ')
    }

    const currentMonthTable = `${['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'][liveClock.getMonth()]}_${liveClock.getFullYear()}`
    const liveSundayDate = (() => {
        const today = new Date(liveClock.getFullYear(), liveClock.getMonth(), liveClock.getDate())
        const sunday = new Date(today)
        if (sunday.getDay() !== 0) {
            sunday.setDate(sunday.getDate() - sunday.getDay())
        }
        if (sunday.getMonth() !== today.getMonth()) {
            const firstSunday = new Date(today.getFullYear(), today.getMonth(), 1)
            while (firstSunday.getDay() !== 0) {
                firstSunday.setDate(firstSunday.getDate() + 1)
            }
            return firstSunday
        }
        return sunday
    })()
    const liveSundayDateKey = `${liveSundayDate.getFullYear()}-${String(liveSundayDate.getMonth() + 1).padStart(2, '0')}-${String(liveSundayDate.getDate()).padStart(2, '0')}`
    const selectedDateKey = selectedAttendanceDate
        ? `${selectedAttendanceDate.getFullYear()}-${String(selectedAttendanceDate.getMonth() + 1).padStart(2, '0')}-${String(selectedAttendanceDate.getDate()).padStart(2, '0')}`
        : null
    const isLiveNow = currentTable === currentMonthTable && selectedDateKey === liveSundayDateKey
    const liveMonthExists = monthlyTables.includes(currentMonthTable)
    const calendarCurrentYear = liveClock.getFullYear()

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

    const isOverrideActive = Boolean(lockedDefaultDate)
    const isAutoMode = !isOverrideActive
    const hasAdminAccess = !isCollaborator || isAdminCollaborator
    const isPersonalAutoMode = !isPersonalManualMode
    const personalModeDisabled = isCollaborator && isOverrideActive
    const manualExpiryDate = useMemo(() => {
        if (!manualOverrideUntil) return null
        const parsed = new Date(manualOverrideUntil)
        return Number.isNaN(parsed.getTime()) ? null : parsed
    }, [manualOverrideUntil])
    const manualModeCountdown = useMemo(() => {
        if (!manualExpiryDate || isPersonalAutoMode) return null
        const remainingMs = manualExpiryDate.getTime() - liveClock.getTime()
        if (remainingMs <= 0) return 'Ending now'
        const totalMinutes = Math.max(1, Math.ceil(remainingMs / 60000))
        const hours = Math.floor(totalMinutes / 60)
        const minutes = totalMinutes % 60
        if (hours <= 0) return `${minutes}m left`
        return `${hours}h ${minutes}m left`
    }, [manualExpiryDate, isPersonalAutoMode, liveClock])

    const getFallbackOverrideDate = useCallback((tableName) => {
        if (!tableName) return null
        const [monthName, yearStr] = tableName.split('_')
        const yearNum = parseInt(yearStr, 10)
        if (!monthName || Number.isNaN(yearNum)) return null
        const sundays = getSundaysInMonth(monthName, yearNum)
        return sundays.length > 0 ? sundays[0] : null
    }, [getSundaysInMonth])

    const handlePersonalModeToggle = useCallback(async () => {
        if (personalModeDisabled) {
            toast.info('The workspace owner override is active right now, so personal manual mode is temporarily locked.')
            return
        }

        if (isPersonalAutoMode) {
            const ok = await setPersonalCalendarMode({
                mode: 'manual',
                tableName: currentTable,
                date: selectedAttendanceDate || manualSundayDate || new Date()
            })
            if (ok) {
                toast.info('Manual mode is on for 12 hours. You can now choose a month and Sunday yourself.')
            }
            return
        }

        const ok = await setPersonalCalendarMode({ mode: 'auto' })
        if (ok) {
            toast.success('Auto mode is back on. Your month and Sunday will follow the live schedule again.')
        }
    }, [
        personalModeDisabled,
        isPersonalAutoMode,
        setPersonalCalendarMode,
        currentTable,
        selectedAttendanceDate,
        manualSundayDate
    ])

    const handlePersonalSundaySelection = useCallback(async ({ table, date }) => {
        if (personalModeDisabled) {
            toast.info('The workspace owner override is active right now, so personal manual mode is temporarily locked.')
            return
        }

        if (isPersonalAutoMode) {
            toast.info('Turn Auto off first before manually picking a month and Sunday.')
            return
        }

        setShowPersonalMonthPicker(false)
        const ok = await setPersonalCalendarMode({
            mode: 'manual',
            tableName: table || currentTable,
            date: date || selectedAttendanceDate || new Date(),
            silent: true
        })
        if (!ok) return

        toast.success('Manual month and Sunday updated.')
    }, [
        personalModeDisabled,
        isPersonalAutoMode,
        setPersonalCalendarMode,
        currentTable,
        selectedAttendanceDate
    ])

    const handleEnableOverride = async (tableName = currentTable, sundayDate = selectedAttendanceDate, options = {}) => {
        const { showToast = true } = options
        if (!hasAdminAccess) {
            console.log('[SETTINGS] handleEnableOverride: No admin access')
            return
        }
        const targetTable = tableName || currentTable
        const targetDate = sundayDate || selectedAttendanceDate || getFallbackOverrideDate(targetTable) || new Date()
        console.log('[SETTINGS] handleEnableOverride called:', { targetTable, targetDate, hasAdminAccess })
        setIsOverrideSaving(true)
        try {
            const ok = await setCollaboratorOverride({
                enabled: true,
                tableName: targetTable,
                date: targetDate
            })
            console.log('[SETTINGS] setCollaboratorOverride returned:', ok)
            if (ok) {
                if (showToast) {
                    toast.success('Override enabled for all collaborators')
                }
            } else {
                if (showToast) {
                    toast.error('Failed to enable override')
                }
            }
            return ok
        } catch (err) {
            console.error('[SETTINGS] Error in handleEnableOverride:', err)
            if (showToast) {
                toast.error('Error: ' + (err?.message || 'Failed to enable override'))
            }
        } finally {
            setIsOverrideSaving(false)
        }
    }

    const handleOverrideSundaySelect = useCallback(async ({ table, date }) => {
        if (!table || !date) return
        setShowOverridePicker(false)
        await handleEnableOverride(table, date)
    }, [handleEnableOverride])

    const handleDisableOverride = async () => {
        if (!hasAdminAccess) return
        setIsOverrideSaving(true)
        try {
            const ok = await setCollaboratorOverride({ enabled: false })
            if (ok) {
                toast.info('Override disabled. Returning to auto mode.')
            } else {
                toast.error('Failed to disable override')
            }
        } finally {
            setIsOverrideSaving(false)
        }
    }

    const handleAdminSundaySelection = async (sunday, table) => {
        if (!hasAdminAccess || !table) return
        if (!isOverrideActive) {
            toast.info('Enable Override All to change Sundays for everyone')
            return
        }
        if (table !== currentTable) {
            setCurrentTable(table)
        }
        if (isOverrideActive) {
            await handleEnableOverride(table, sunday, { showToast: false })
            return
        }
        setAndSaveAttendanceDate(sunday, table)
    }

    const renderContent = () => {
        switch (activeSection) {
            case 'account':
                return (
                    <React.Suspense fallback={<LazyPanelFallback />}>
                        <AccountSettingsSection
                            user={user}
                            dob={dob}
                            setDob={setDob}
                            handleSaveDob={handleSaveDob}
                            isDobSaving={isDobSaving}
                            installedAppInfo={installedAppInfo}
                            resetPassword={resetPassword}
                            handleSignOut={handleSignOut}
                            setIsPhotoEditorOpen={setIsPhotoEditorOpen}
                            getSettingTargetClass={getSettingTargetClass}
                        />
                    </React.Suspense>
                )
            case 'workspace':
                return (
                    <React.Suspense fallback={<LazyPanelFallback />}>
                        <WorkspaceSettingsSection
                            preferences={preferences}
                            isCollaborator={isCollaborator}
                            isAdminCollaborator={isAdminCollaborator}
                            currentTable={currentTable}
                            selectedAttendanceDate={selectedAttendanceDate}
                            lockedDefaultDate={lockedDefaultDate}
                            monthlyTables={monthlyTables}
                            isOverrideSaving={isOverrideSaving}
                            handleEnableOverride={handleEnableOverride}
                            handleDisableOverride={handleDisableOverride}
                            handleOverrideSundaySelect={handleOverrideSundaySelect}
                            toggleWorkspacePanel={toggleWorkspacePanel}
                            workspacePanels={workspacePanels}
                            getSettingTargetClass={getSettingTargetClass}
                            showOverridePicker={showOverridePicker}
                            setShowOverridePicker={setShowOverridePicker}
                            overrideButtonRef={overrideButtonRef}
                            isLiveNow={isLiveNow}
                            liveMonthExists={liveMonthExists}
                            liveSundayDateKey={liveSundayDateKey}
                            getMonthDisplayName={getMonthDisplayName}
                            handleQuickCreateMonth={handleQuickCreateMonth}
                        />
                    </React.Suspense>
                )
            case 'team':
                return (
                    <React.Suspense fallback={<LazyPanelFallback />}>
                        <TeamSettingsSection
                            collaborators={collaborators}
                            fetchingCollaborators={fetchingCollaborators}
                            isCollaborator={isCollaborator}
                            user={user}
                            setIsShareModalOpen={setIsShareModalOpen}
                            handleDeleteCollaborator={handleDeleteCollaborator}
                            pendingRemoval={pendingRemoval}
                            isRemovingCollaborator={isRemovingCollaborator}
                            deletingCollaboratorId={deletingCollaboratorId}
                            confirmRemoveCollaborator={confirmRemoveCollaborator}
                            closeRemoveModal={closeRemoveModal}
                            getSettingTargetClass={getSettingTargetClass}
                        />
                    </React.Suspense>
                )
            case 'data':
                return (
                    <React.Suspense fallback={<LazyPanelFallback />}>
                        <DataSettingsSection
                            isOnline={isOnline}
                            offlineMode={offlineMode}
                            setOfflineMode={setOfflineMode}
                            isOfflineModeActive={isOfflineModeActive}
                            offlineModeStatus={offlineModeStatus}
                            offlineCacheMeta={offlineCacheMeta}
                            pendingSyncCount={pendingSyncCount}
                            isPreparingOffline={isPreparingOffline}
                            isSyncingOffline={isSyncingOffline}
                            prepareOfflineData={prepareOfflineData}
                            clearOfflineCacheData={clearOfflineCacheData}
                            syncOfflineChanges={syncOfflineChanges}
                            setIsExportModalOpen={setIsExportModalOpen}
                            setShowExportCenter={setShowExportCenter}
                            oldestMonthTable={oldestMonthTable}
                            setArchiveMonth={setArchiveMonth}
                            getSettingTargetClass={getSettingTargetClass}
                        />
                    </React.Suspense>
                )
            case 'appearance':
                return (
                    <React.Suspense fallback={<LazyPanelFallback />}>
                        <AppearanceSettingsSection
                            themeMode={themeMode}
                            setThemeMode={setThemeMode}
                            isCollaborator={isCollaborator}
                            getSettingTargetClass={getSettingTargetClass}
                        />
                    </React.Suspense>
                )
            case 'accessibility':
                return (
                    <React.Suspense fallback={<LazyPanelFallback />}>
                        <AccessibilitySettingsSection
                            preferences={preferences}
                            updatePreferences={updatePreferences}
                            getSettingTargetClass={getSettingTargetClass}
                        />
                    </React.Suspense>
                )
            case 'guided_form':
                return (
                    <div className="space-y-6">
                        <div className="bg-white dark:bg-gray-800 rounded-2xl border border-gray-200 dark:border-gray-700 overflow-hidden">
                            <div className="p-4 flex items-center justify-between gap-4">
                                <div>
                                    <h4 className="font-semibold text-gray-900 dark:text-white">Tap Next Button</h4>
                                    <p className="text-xs text-gray-500 dark:text-gray-400">Show the floating Next shortcut while filling member forms.</p>
                                </div>
                                <button
                                    type="button"
                                    onClick={() => toggleGuidedFormSetting('showNextButton', 'Tap Next button')}
                                    aria-pressed={guidedFormSettings?.showNextButton === true}
                                    className={`relative inline-flex h-8 w-14 flex-shrink-0 items-center rounded-full transition-colors ${guidedFormSettings?.showNextButton === true ? 'bg-orange-600' : 'bg-gray-300 dark:bg-gray-700'}`}
                                >
                                    <span className={`inline-block h-6 w-6 rounded-full bg-white shadow transition-transform ${guidedFormSettings?.showNextButton === true ? 'translate-x-7' : 'translate-x-1'}`} />
                                </button>
                            </div>
                        </div>
                        <div className="bg-white dark:bg-gray-800 rounded-2xl border border-gray-200 dark:border-gray-700 overflow-hidden">
                            <div className="p-4 border-b border-gray-200 dark:border-gray-700">
                                <h4 className="font-semibold text-gray-900 dark:text-white">Guided Form Order</h4>
                                <p className="text-xs text-gray-500 dark:text-gray-400">Drag items to change the step order in the member forms</p>
                            </div>
                            <div className="p-4">
                                <div className="space-y-2">
                                    {guidedOrder.map((id, index) => (
                                        <div
                                            key={id}
                                            draggable
                                            onDragStart={() => setGuidedOrderDragId(id)}
                                            onDragOver={(e) => { e.preventDefault(); setGuidedOrderDragId(null) }}
                                            onDrop={() => moveGuidedOrderItemTo(guidedOrderDragId, id)}
                                            className="flex items-center justify-between p-3 bg-gray-50 dark:bg-gray-900/40 border border-gray-200 dark:border-gray-700 rounded-xl cursor-move group hover:border-orange-500/50 transition-colors"
                                        >
                                            <div className="flex items-center gap-3">
                                                <GripVertical className="w-4 h-4 text-gray-400 group-hover:text-orange-500" />
                                                <span className="text-sm font-medium text-gray-700 dark:text-gray-300">
                                                    {GUIDED_FORM_FIELD_LABELS[id] || id}
                                                </span>
                                            </div>
                                            <div className="flex items-center gap-1">
                                                <button onClick={() => moveGuidedOrderItem(id, -1)} disabled={index === 0} className="p-1.5 hover:bg-white dark:hover:bg-gray-800 rounded-lg disabled:opacity-30"><ArrowUp className="w-4 h-4" /></button>
                                                <button onClick={() => moveGuidedOrderItem(id, 1)} disabled={index === guidedOrder.length - 1} className="p-1.5 hover:bg-white dark:hover:bg-gray-800 rounded-lg disabled:opacity-30"><ArrowDown className="w-4 h-4" /></button>
                                            </div>
                                        </div>
                                    ))}
                                </div>
                                <button onClick={resetGuidedOrder} className="mt-4 w-full py-2 text-sm font-semibold text-gray-500 hover:text-orange-600 transition-colors flex items-center justify-center gap-2">
                                    <RotateCcw className="w-4 h-4" /> Reset to default
                                </button>
                            </div>
                        </div>
                        <GuidedOrderPreview settings={guidedFormSettings} />
                    </div>
                )
            case 'activity':
                return (
                    <React.Suspense fallback={<LazyPanelFallback />}>
                        <ActivityLogViewer />
                    </React.Suspense>
                )
            case 'danger':
                return (
                    <React.Suspense fallback={<LazyPanelFallback />}>
                        <DangerSettingsSection
                            user={user}
                            isCollaborator={isCollaborator}
                            handleSignOut={handleSignOut}
                            getSettingTargetClass={getSettingTargetClass}
                        />
                    </React.Suspense>
                )
            case 'developer':
                return (
                    <React.Suspense fallback={<LazyPanelFallback />}>
                        <DeveloperToolsPanel
                            user={user}
                            isDeveloperBypass={isDeveloperBypass}
                            dataOwnerId={dataOwnerId}
                            members={members}
                            currentTable={currentTable}
                            isSupabaseConfigured={isSupabaseConfigured}
                            forceRefreshMembersSilent={forceRefreshMembersSilent}
                            loadAllAttendanceData={loadAllAttendanceData}
                            loadAllBadgeData={loadAllBadgeData}
                            refreshSearch={refreshSearch}
                            validateMemberData={validateMemberData}
                            getPastSundays={getPastSundays}
                            getMissingAttendance={getMissingAttendance}
                            deleteMember={deleteMember}
                            onOpenAddMember={onOpenAddMember}
                            selection={selection}
                            copyTextToClipboard={copyTextToClipboard}
                        />
                    </React.Suspense>
                )
            default:
                return null
        }
    }




    // Settings sections and searchable items come from the shared registry used by Ctrl+K.
    const sections = useMemo(
        () => getVisibleSettingsSections(isDeveloperToolsEnabled),
        [isDeveloperToolsEnabled]
    )

    const visibleRegistryItems = useMemo(
        () => getVisibleSettingsSearchItems(isDeveloperToolsEnabled),
        [isDeveloperToolsEnabled]
    )

    const handleSettingsItemAction = useCallback((item) => {
        const preferredMonth = currentTable || oldestMonthTable?.table_name || monthlyTables?.[monthlyTables.length - 1] || null

        switch (item.id) {
            case 'profile_photo':
                navigateToSetting('account', item.id)
                setIsPhotoEditorOpen(true)
                return
            case 'set_password':
                navigateToSetting('account', item.id)
                window.setTimeout(() => {
                    if (window.__openSetPassword) {
                        window.__openSetPassword()
                    } else {
                        toast.info('Password setup is not available right now')
                    }
                }, 150)
                return
            case 'edit_workspace':
                navigateToSetting('workspace', item.id)
                setIsWorkspaceModalOpen(true)
                return
            case 'admin_controls':
                navigateToSetting('workspace', item.id)
                setIsAdminControlsOpen(true)
                return
            case 'invite_team':
                navigateToSetting('team', item.id)
                setIsShareModalOpen(true)
                return
            case 'export_data':
                navigateToSetting('data', item.id)
                setIsExportModalOpen(true)
                return
            case 'import_data':
                navigateToSetting('data', item.id)
                toast.info('Import feature coming soon!')
                return
            case 'clean_duplicates':
                navigateToSetting('data', item.id)
                toast.info('Duplicate cleanup is available from the Dashboard search tools.')
                return
            case 'archive_month':
                navigateToSetting('data', item.id)
                if (preferredMonth) setArchiveMonth(preferredMonth)
                return
            case 'storage_limits':
                navigateToSetting('data', item.id)
                setShowStorageLimits(true)
                setShowUsageDetails(true)
                return
            case 'theme_light':
                setThemeMode('light')
                navigateToSetting('appearance', item.id)
                return
            case 'theme_dark':
                setThemeMode('dark')
                navigateToSetting('appearance', item.id)
                return
            case 'theme_auto':
                setThemeMode('system')
                navigateToSetting('appearance', item.id)
                return
            case 'help_center':
                setShowHelpCenter(true)
                return
            case 'delete_account':
                navigateToSetting('danger', item.id)
                setIsDeleteAccountOpen(true)
                return
            default:
                navigateToSetting(item.section, item.id)
        }
    }, [
        currentTable,
        monthlyTables,
        navigateToSetting,
        oldestMonthTable,
        setThemeMode
    ])

    const dynamicItemDetails = useMemo(() => ({
        account_name: {
            description: 'Display name: ' + (user?.user_metadata?.full_name || 'User')
        },
        account_email: {
            description: 'Current email: ' + (user?.email || 'Not available')
        },
        app_version: {
            description: installedAppInfo
                ? 'Installed: ' + installedAppInfo.versionName + ' (' + (installedAppInfo.versionCode || 'web') + ') - ' + installedAppInfo.runtimeMode
                : 'View installed APK version and wrapper mode'
        },
        current_month: {
            description: 'Active: ' + (currentTable?.replace('_', ' ') || 'None')
        },
        offline_mode: {
            description: pendingSyncCount > 0
                ? 'Offline cache ready with ' + pendingSyncCount + ' pending change' + (pendingSyncCount === 1 ? '' : 's')
                : 'Download offline data, sync changes, or clear the local cache'
        },
        storage_limits: {
            description: dbUsage
                ? 'Database storage: ' + dbUsage.db_size_mb + ' / ' + DB_LIMIT_MB + ' MB'
                : 'Review database storage, free plan limits, and auth email limits'
        },
        command_menu: {
            description: 'Press ' + (navigator.platform.includes('Mac') ? 'Cmd' : 'Ctrl') + ' + K to open quick navigation'
        },
        manage_team: {
            description: 'View and manage ' + collaborators.length + ' collaborator' + (collaborators.length === 1 ? '' : 's')
        }
    }), [collaborators.length, currentTable, dbUsage, installedAppInfo, pendingSyncCount, user])

    const allSearchableItems = useMemo(() => visibleRegistryItems.map((item) => {
        const section = sections.find(candidate => candidate.id === item.section)
        const dynamic = dynamicItemDetails[item.id] || {}
        const merged = {
            ...item,
            ...dynamic,
            sectionLabel: section?.label || 'Settings',
            icon: item.icon || section?.icon || Search
        }
        return {
            ...merged,
            action: () => handleSettingsItemAction(merged)
        }
    }), [dynamicItemDetails, handleSettingsItemAction, sections, visibleRegistryItems])

    const searchResults = useMemo(() => {
        if (!searchQuery.trim()) return []
        return searchSettingsIndex(searchQuery, allSearchableItems, sections)
    }, [searchQuery, allSearchableItems, sections])

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

    const getSectionPreview = (sectionId) => {
        const section = sections.find(candidate => candidate.id === sectionId)
        if (!section?.content) return 'Open settings'
        return section.content.split('.')[0] || section.content
    }

    const getSettingTargetClass = (settingId) =>
        highlightedSettingId === settingId ? 'settings-search-target-highlight' : ''

    // Show Help Center Page
    if (showHelpCenter) {
        return (
            <React.Suspense fallback={<LazyPanelFallback />}>
                <HelpCenterPage
                    onBack={() => setShowHelpCenter(false)}
                    onNavigate={(target, options) => {
                        setShowHelpCenter(false)
                        if (target === 'dashboard' || target === 'settings') {
                            onBack?.()
                        }
                    }}
                />
            </React.Suspense>
        )
    }

    // Render main settings list (when no section is active)
    const renderMainList = () => (
        <div className="min-h-screen">
            {/* Header */}
            <div className="settings-detail-header-safe sticky z-30 w-full sm:-mx-4 sm:w-[calc(100%+2rem)] bg-white/85 dark:bg-gray-900/80 backdrop-blur-sm border-b border-gray-200/70 dark:border-gray-800/70 shadow-sm">
                <div className="max-w-4xl mx-auto w-full px-3 sm:px-8 py-2.5 sm:py-3 flex items-center gap-3 sm:gap-4 font-[var(--font-family)]">
                    <button
                        onClick={onBack}
                        className="p-2 hover:bg-gray-200 dark:hover:bg-gray-700 rounded-lg transition-colors bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 shadow-sm touch-target"
                    >
                        <ChevronLeft className="w-5 h-5 text-gray-600 dark:text-gray-300" />
                    </button>
                    <h1 className="text-lg sm:text-xl font-bold text-gray-900 dark:text-white">Settings</h1>
                </div>
            </div>

            <div className="max-w-4xl mx-auto px-3 sm:px-4 py-3 pb-8 space-y-3">
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
    <strong className="text-gray-800 dark:text-gray-200">Database Storage</strong> is the space your member data, attendance records, badges, tags, and monthly tables use on the server.{' '}
    <strong className="text-gray-800 dark:text-gray-200">Auth Emails</strong> are login-related emails such as magic links, password resets, and invites, and they are limited to 3 per hour on the free plan.{' '}
    Archiving old months exports them as CSV and removes them from the database, which frees up storage.
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
                                                This app uses <strong>Supabase</strong> for the hosted database and authentication.
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
                                                <strong>Recommendation:</strong> Archive months that are more than 2 months old when you no longer need to edit them.
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
                                                <li><strong>Magic links</strong> for passwordless login</li>
                                                <li><strong>Password resets</strong> for account recovery</li>
                                                <li><strong>Invites</strong> for shared workspace access</li>
                                                <li><strong>Signup confirmations</strong> for new accounts</li>
                                            </ul>
                                            <p className="mt-1">
                                                On the free plan, Supabase limits this to <strong>3 emails per hour</strong> to prevent abuse.
                                                The counter above tracks how many you've sent in the current hour. Once you hit 3, you'll need to wait for the timer to reset before sending more.
                                            </p>
                                            <p className="mt-1">
                                                This is a <strong>server-side limit</strong> set by Supabase.
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
            <div className="min-h-screen">
                {/* Sticky Header - full-bleed across the detail page */}
                <div className="settings-detail-header-safe sticky z-30 w-full sm:-mx-4 sm:w-[calc(100%+2rem)] bg-white/85 dark:bg-gray-900/80 backdrop-blur-sm border-b border-gray-200/70 dark:border-gray-800/70 shadow-sm">
                    <div className="max-w-4xl mx-auto w-full px-3 sm:px-8 py-2.5 sm:py-3 font-[var(--font-family)]">
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

                <div className="max-w-4xl mx-auto px-3 sm:px-4 py-3 pb-8 space-y-3">
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
            {isShareModalOpen && (
                <React.Suspense fallback={null}>
                    <ShareAccessModal
                        isOpen={isShareModalOpen}
                        onClose={handleShareModalClose}
                        user={user}
                    />
                </React.Suspense>
            )}
            {isWorkspaceModalOpen && (
                <React.Suspense fallback={null}>
                    <WorkspaceSettingsModal
                        isOpen={isWorkspaceModalOpen}
                        onClose={() => setIsWorkspaceModalOpen(false)}
                    />
                </React.Suspense>
            )}
            {isDeleteAccountOpen && (
                <React.Suspense fallback={null}>
                    <DeleteAccountModal
                        isOpen={isDeleteAccountOpen}
                        onClose={() => setIsDeleteAccountOpen(false)}
                    />
                </React.Suspense>
            )}
            {isExportModalOpen && (
                <React.Suspense fallback={null}>
                    <ExportDataModal
                        isOpen={isExportModalOpen}
                        onClose={() => setIsExportModalOpen(false)}
                    />
                </React.Suspense>
            )}
            {isPhotoEditorOpen && (
                <React.Suspense fallback={null}>
                    <ProfilePhotoEditor
                        isOpen={isPhotoEditorOpen}
                        onClose={() => setIsPhotoEditorOpen(false)}
                        user={user}
                    />
                </React.Suspense>
            )}

            {isAdminControlsOpen && (
                <React.Suspense fallback={null}>
                    <AdminControlsModal
                        isOpen={isAdminControlsOpen}
                        onClose={() => setIsAdminControlsOpen(false)}
                    />
                </React.Suspense>
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
                                <p className={`text-sm font-medium ${isDarkMode ? 'text-gray-200' : 'text-gray-800'}`}>Export this collaborator's access notes before removing them.</p>
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
            {!!archiveMonth && (
                <React.Suspense fallback={null}>
                    <ArchiveMonthModal
                        isOpen={!!archiveMonth}
                        onClose={() => setArchiveMonth(null)}
                        tableName={archiveMonth}
                        onArchiveComplete={(archivedTable) => {
                            setArchiveMonth(null)
                            toast.success(`${archivedTable.replace('_', ' ')} archived successfully!`)
                        }}
                    />
                </React.Suspense>
            )}

            {showPersonalMonthPicker && (
                <React.Suspense fallback={null}>
                    <MonthPickerPopup
                        isOpen={showPersonalMonthPicker}
                        onClose={() => setShowPersonalMonthPicker(false)}
                        anchorRef={personalMonthButtonRef}
                        onCreateMonth={onCreateMonth}
                        onSelectSunday={handlePersonalSundaySelection}
                        autoEnabled={isPersonalAutoMode}
                        onToggleAuto={handlePersonalModeToggle}
                        toggleLabel="Personal Auto"
                        manualModeDisabled={personalModeDisabled}
                        disabledReason="The workspace owner override is active right now, so your personal manual mode is temporarily locked."
                        manualStatus={isPersonalAutoMode
                            ? 'Auto is on. The app follows the live month and Sunday for you.'
                            : `Manual mode is active${manualModeCountdown ? ` - ${manualModeCountdown}` : ''}. Pick the exact month and Sunday you want to use.`}
                    />
                </React.Suspense>
            )}

            {showOverridePicker && (
                <React.Suspense fallback={null}>
                    <MonthPickerPopup
                        isOpen={showOverridePicker}
                        onClose={() => setShowOverridePicker(false)}
                        anchorRef={overrideButtonRef}
                        onCreateMonth={onCreateMonth}
                        onSelectSunday={handleOverrideSundaySelect}
                    />
                </React.Suspense>
            )}
        </div>
    )
}

export default SettingsPage
