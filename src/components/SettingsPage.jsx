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
    ArrowDown,
    Mic
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
import lazyWithRetry from '../utils/lazyWithRetry'
import LiveFeaturePreview from './LiveFeaturePreview'

// Modals and heavy components are lazy-loaded for performance
const ShareAccessModal = lazyWithRetry(() => import('./ShareAccessModal'))
const WorkspaceSettingsModal = lazyWithRetry(() => import('./WorkspaceSettingsModal'))
const DeleteAccountModal = lazyWithRetry(() => import('./DeleteAccountModal'))
const ExportDataModal = lazyWithRetry(() => import('./ExportDataModal'))
const ProfilePhotoEditor = lazyWithRetry(() => import('./ProfilePhotoEditor'))
const HelpCenterPage = lazyWithRetry(() => import('./HelpCenterPage'))
const ActivityLogViewer = lazyWithRetry(() => import('./ActivityLogViewer'))
const ExportCenterPage = lazyWithRetry(() => import('./ExportCenterPage'))
const AdminControlsModal = lazyWithRetry(() => import('./AdminControlsModal'))
const ArchiveMonthModal = lazyWithRetry(() => import('./ArchiveMonthModal'))
const MonthPickerPopup = lazyWithRetry(() => import('./MonthPickerPopup'))
const CombinedDatePicker = lazyWithRetry(() => import('./CombinedDatePicker'))

// New extracted sections
const AccountSettingsSection = lazyWithRetry(() => import('./AccountSettingsSection'))
const WorkspaceSettingsSection = lazyWithRetry(() => import('./WorkspaceSettingsSection'))
const TeamSettingsSection = lazyWithRetry(() => import('./TeamSettingsSection'))
const DataSettingsSection = lazyWithRetry(() => import('./DataSettingsSection'))
const AppearanceSettingsSection = lazyWithRetry(() => import('./AppearanceSettingsSection'))
const AccessibilitySettingsSection = lazyWithRetry(() => import('./AccessibilitySettingsSection'))
const MemberCodeSettingsSection = lazyWithRetry(() => import('./MemberCodeSettingsSection'))
const UpdatesSettingsSection = lazyWithRetry(() => import('./UpdatesSettingsSection'))
const DangerSettingsSection = lazyWithRetry(() => import('./DangerSettingsSection'))
const DeveloperToolsPanel = lazyWithRetry(() => import('./DeveloperToolsPanel'))

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

const WORKSPACE_MEMBER_CODE_PREFERENCE_KEYS = new Set([
    'workspace_member_codes_enabled',
    'member_code_quick_pass_enabled',
    'member_code_show_logo',
    'member_code_show_photo',
    'member_code_show_email',
    'member_code_auto_profile_enabled',
    'member_code_badge_style',
    'member_code_card_style',
    'member_code_church_name',
    'member_code_logo_url',
    'member_code_auto_cycle_minutes',
    'member_code_lookup_enabled',
    'member_code_share_message_template',
    'member_code_turbo_enabled',
    'member_code_turbo_notification_enabled'
])

const areMemberCodesVisible = (preferences = {}) => (
    preferences.workspace_member_codes_enabled !== false &&
    preferences.member_codes_enabled !== false
)

const SettingsPage = ({ onBack, navigateToSection, onCreateMonth, onOpenAddMember }) => {
    const { user, signOut, preferences, resetPassword, saveUserPreferences, updatePreference, isDeveloperBypass } = useAuth()
    const { isDarkMode, toggleTheme, themeMode, setThemeMode, commandKEnabled, setCommandKEnabled } = useTheme()
    const { members, monthlyTables, currentTable, setCurrentTable, isSupabaseConfigured, createNewMonth, deleteMonthTable, isCollaborator, isAdminCollaborator, dataOwnerId, lockedDefaultDate, setCollaboratorOverride, selectedAttendanceDate, setAndSaveAttendanceDate, deleteMember, forceRefreshMembersSilent, loadAllAttendanceData, loadAllBadgeData, refreshSearch, validateMemberData, getPastSundays, getMissingAttendance, autoAllDatesEnabled, setAutoAllDatesEnabled, missingInfoPromptEnabled, setMissingInfoPromptEnabled, guidedFormSettings, setGuidedFormSetting, personalCalendarMode, isPersonalManualMode, manualMonthTable, manualSundayDate, manualOverrideUntil, setPersonalCalendarMode, isOnline, offlineMode, setOfflineMode, isOfflineModeActive, offlineModeStatus, offlineCacheMeta, pendingSyncCount, offlineSaveNoticeThreshold, setOfflineSaveNoticeThreshold, notificationDurationMs, setNotificationDurationMs, searchSuggestionView, setSearchSuggestionView, isPreparingOffline, isSyncingOffline, prepareOfflineData, clearOfflineCacheData, syncOfflineChanges } = useApp()
    const { selection } = useHapticFeedback()
    const isDeveloperToolsEnabled = import.meta.env.DEV
    const hasAdminAccess = !isCollaborator || isAdminCollaborator

    const [activeSection, setActiveSection] = useState(null) // null = show main list
    const [searchQuery, setSearchQuery] = useState('')
    const [isSettingsSearchFocused, setIsSettingsSearchFocused] = useState(false)
    const [compactMode] = useState(true)
    const [isLivePreviewOpen, setIsLivePreviewOpen] = useState(false)
    const [settingsSidebarWidth, setSettingsSidebarWidth] = useState(() => {
        if (typeof window === 'undefined') return 380
        const saved = Number(window.localStorage.getItem('datser_settings_sidebar_width'))
        return Number.isFinite(saved) && saved >= 84 ? saved : 380
    })

    useEffect(() => {
        setIsLivePreviewOpen(false)
    }, [activeSection])
    const [settingsRailTooltip, setSettingsRailTooltip] = useState(null)
    const [lastSettingsPath, setLastSettingsPath] = useState(null)
    const settingsSearchScope = useMemo(() => dataOwnerId || user?.id || 'guest', [dataOwnerId, user?.id])
    const settingsSearchStorageKey = useMemo(() => `datser_recent_settings_searches:${settingsSearchScope}`, [settingsSearchScope])
    const [recentSettingsSearches, setRecentSettingsSearches] = useState([])
    const [highlightedSettingId, setHighlightedSettingId] = useState(null)
    const [quickSettingsSearchItem, setQuickSettingsSearchItem] = useState(null)
    const [profileSettingsArriving, setProfileSettingsArriving] = useState(false)
    const [optimisticPreferencePatch, setOptimisticPreferencePatch] = useState({})
    const effectivePreferences = useMemo(
        () => ({
            ...(preferences || {}),
            ...optimisticPreferencePatch
        }),
        [optimisticPreferencePatch, preferences]
    )
    const [guidedOrderDragId, setGuidedOrderDragId] = useState(null)
    const highlightTimerRef = useRef(null)
    const activeSectionRef = useRef(null)
    const showHelpCenterRef = useRef(false)
    const splitContainerRef = useRef(null)
    const resizeCleanupRef = useRef(null)
    const [showHelpCenter, setShowHelpCenter] = useState(false)
    const [archiveMonth, setArchiveMonth] = useState(null) // table name to archive
    const scrollPositionsRef = useRef({ main: 0 })

    useEffect(() => {
        if (typeof document === 'undefined') return undefined
        if (typeof window !== 'undefined' && !window.matchMedia('(min-width: 768px)').matches) return undefined
        const root = document.documentElement
        const body = document.body
        const previousRootOverflow = root.style.overflow
        const previousBodyOverflow = body.style.overflow
        root.style.overflow = 'hidden'
        body.style.overflow = 'hidden'
        return () => {
            root.style.overflow = previousRootOverflow
            body.style.overflow = previousBodyOverflow
        }
    }, [])

    useEffect(() => {
        if (typeof window === 'undefined') return undefined
        const marker = window.sessionStorage?.getItem('datser_profile_settings_motion')
        if (!marker) return undefined
        window.sessionStorage?.removeItem('datser_profile_settings_motion')
        setProfileSettingsArriving(true)
        const timer = window.setTimeout(() => setProfileSettingsArriving(false), 360)
        return () => window.clearTimeout(timer)
    }, [])

    useEffect(() => {
        if (typeof window === 'undefined') return
        window.localStorage.setItem('datser_settings_sidebar_width', String(Math.round(settingsSidebarWidth)))
    }, [settingsSidebarWidth])

    useEffect(() => {
        if (typeof window === 'undefined') return undefined

        const clampSidebarWidth = () => {
            const containerWidth = splitContainerRef.current?.getBoundingClientRect().width || window.innerWidth
            const isTabletWidth = containerWidth < 1180
            const minExpandedWidth = isTabletWidth ? 260 : 300
            const maxWidth = isTabletWidth
                ? Math.min(360, Math.max(minExpandedWidth, containerWidth * 0.36))
                : Math.min(540, Math.max(320, containerWidth * 0.42))

            setSettingsSidebarWidth((currentWidth) => {
                if (currentWidth <= 120) return currentWidth
                const nextWidth = Math.min(Math.max(currentWidth, minExpandedWidth), maxWidth)
                return Math.abs(nextWidth - currentWidth) < 1 ? currentWidth : nextWidth
            })
        }

        clampSidebarWidth()
        window.addEventListener('resize', clampSidebarWidth)
        return () => window.removeEventListener('resize', clampSidebarWidth)
    }, [])

    useEffect(() => {
        if (settingsSidebarWidth > 120 && settingsRailTooltip) {
            setSettingsRailTooltip(null)
        }
    }, [settingsSidebarWidth, settingsRailTooltip])

    const showSettingsRailTooltip = useCallback((label, event) => {
        if (settingsSidebarWidth > 120 || typeof window === 'undefined') return
        const rect = event.currentTarget.getBoundingClientRect()
        const top = Math.min(Math.max(rect.top + rect.height / 2, 28), window.innerHeight - 28)
        setSettingsRailTooltip({
            label,
            left: rect.right + 12,
            top
        })
    }, [settingsSidebarWidth])

    const hideSettingsRailTooltip = useCallback(() => {
        setSettingsRailTooltip(null)
    }, [])

    const getSettingsRailTooltipHandlers = useCallback((label) => ({
        onPointerEnter: (event) => showSettingsRailTooltip(label, event),
        onPointerMove: (event) => showSettingsRailTooltip(label, event),
        onMouseEnter: (event) => showSettingsRailTooltip(label, event),
        onFocus: (event) => showSettingsRailTooltip(label, event),
        onPointerLeave: hideSettingsRailTooltip,
        onMouseLeave: hideSettingsRailTooltip,
        onBlur: hideSettingsRailTooltip
    }), [hideSettingsRailTooltip, showSettingsRailTooltip])

    const beginSettingsResize = useCallback((event) => {
        event.preventDefault()
        event.stopPropagation()
        hideSettingsRailTooltip()
        const container = splitContainerRef.current
        if (!container || typeof window === 'undefined') return
        resizeCleanupRef.current?.()
        const pointerId = event.pointerId
        const previousCursor = document.body.style.cursor
        const previousUserSelect = document.body.style.userSelect
        const previousTouchAction = document.body.style.touchAction

        const updateWidth = (clientX) => {
            if (typeof clientX !== 'number') return
            const rect = container.getBoundingClientRect()
            const rawWidth = clientX - rect.left
            const isTabletWidth = rect.width < 1180
            const minExpandedWidth = isTabletWidth ? 260 : 300
            const maxWidth = isTabletWidth
                ? Math.min(360, Math.max(minExpandedWidth, rect.width * 0.36))
                : Math.min(540, Math.max(320, rect.width * 0.42))
            const nextWidth = rawWidth <= 132 ? 84 : Math.min(Math.max(rawWidth, minExpandedWidth), maxWidth)
            setSettingsSidebarWidth(nextWidth)
        }

        updateWidth(event.clientX)

        const handlePointerMove = (moveEvent) => {
            if (pointerId !== undefined && moveEvent.pointerId !== undefined && moveEvent.pointerId !== pointerId) return
            moveEvent.preventDefault()
            updateWidth(moveEvent.clientX)
        }
        const handleTouchMove = (moveEvent) => {
            moveEvent.preventDefault()
            const touch = moveEvent.touches?.[0] || moveEvent.changedTouches?.[0]
            updateWidth(touch?.clientX)
        }
        const handlePointerUp = (upEvent) => {
            upEvent?.preventDefault?.()
            resizeCleanupRef.current?.()
        }
        const cleanupResize = () => {
            document.body.style.cursor = previousCursor
            document.body.style.userSelect = previousUserSelect
            document.body.style.touchAction = previousTouchAction
            window.removeEventListener('pointermove', handlePointerMove)
            window.removeEventListener('pointerup', handlePointerUp)
            window.removeEventListener('pointercancel', handlePointerUp)
            window.removeEventListener('mouseup', handlePointerUp)
            window.removeEventListener('blur', handlePointerUp)
            document.removeEventListener('pointermove', handlePointerMove)
            document.removeEventListener('pointerup', handlePointerUp)
            document.removeEventListener('pointercancel', handlePointerUp)
            document.removeEventListener('touchmove', handleTouchMove)
            document.removeEventListener('touchend', handlePointerUp)
            document.removeEventListener('touchcancel', handlePointerUp)
            resizeCleanupRef.current = null
        }

        document.body.style.cursor = 'col-resize'
        document.body.style.userSelect = 'none'
        document.body.style.touchAction = 'none'
        resizeCleanupRef.current = cleanupResize
        try {
            event.currentTarget?.setPointerCapture?.(event.pointerId)
        } catch {
            // The global cleanup listeners below still release resize state.
        }
        window.addEventListener('pointermove', handlePointerMove)
        window.addEventListener('pointerup', handlePointerUp)
        window.addEventListener('pointercancel', handlePointerUp)
        window.addEventListener('mouseup', handlePointerUp)
        window.addEventListener('blur', handlePointerUp)
        document.addEventListener('pointermove', handlePointerMove, { passive: false })
        document.addEventListener('pointerup', handlePointerUp)
        document.addEventListener('pointercancel', handlePointerUp)
        document.addEventListener('touchmove', handleTouchMove, { passive: false })
        document.addEventListener('touchend', handlePointerUp, { passive: false })
        document.addEventListener('touchcancel', handlePointerUp, { passive: false })
    }, [hideSettingsRailTooltip])

    useEffect(() => () => {
        resizeCleanupRef.current?.()
    }, [])

    useEffect(() => {
        if (typeof window === 'undefined') return
        try {
            const scoped = window.localStorage.getItem(settingsSearchStorageKey)
            const legacy = window.localStorage.getItem('datser_recent_settings_searches')
            setRecentSettingsSearches(JSON.parse(scoped || legacy || '[]'))
        } catch {
            setRecentSettingsSearches([])
        }
    }, [settingsSearchStorageKey])

    useEffect(() => {
        if (typeof window === 'undefined') return
        window.localStorage.setItem(settingsSearchStorageKey, JSON.stringify(recentSettingsSearches.slice(0, 8)))
    }, [recentSettingsSearches, settingsSearchStorageKey])

    const rememberSettingsSearch = useCallback((value = searchQuery) => {
        const trimmed = String(value || '').trim()
        if (!trimmed) return
        setRecentSettingsSearches((current) => [
            trimmed,
            ...current.filter((item) => item.toLowerCase() !== trimmed.toLowerCase())
        ].slice(0, 8))
    }, [searchQuery])

    const getSettingsScrollKey = useCallback(() => (
        showHelpCenterRef.current ? 'help' : (activeSectionRef.current || 'main')
    ), [])

    const saveSettingsScroll = useCallback((key = getSettingsScrollKey()) => {
        if (typeof window === 'undefined') return
        scrollPositionsRef.current[key || 'main'] = window.scrollY || 0
    }, [getSettingsScrollKey])

    const restoreSettingsScroll = useCallback((key = getSettingsScrollKey()) => {
        if (typeof window === 'undefined') return
        const top = scrollPositionsRef.current[key || 'main'] || 0
        window.requestAnimationFrame(() => {
            window.scrollTo({ top, left: 0, behavior: 'auto' })
        })
    }, [getSettingsScrollKey])

    useEffect(() => {
        activeSectionRef.current = activeSection
    }, [activeSection])

    useEffect(() => {
        showHelpCenterRef.current = showHelpCenter
    }, [showHelpCenter])

    useEffect(() => {
        if (typeof window === 'undefined') return undefined

        const currentState = window.history.state || {}
        window.history.replaceState({
            ...currentState,
            datserView: 'settings',
            datserSettingsRoot: true,
            datserSettingsPanel: null
        }, '', window.location.href)

        const handlePopState = (event) => {
            const state = event.state || {}

            if (state.datserSettingsPanel === 'help') {
                saveSettingsScroll()
                setActiveSection(null)
                setShowHelpCenter(true)
                restoreSettingsScroll('help')
                return
            }

            if (state.datserSettingsPanel) {
                saveSettingsScroll()
                setShowHelpCenter(false)
                setActiveSection(state.datserSettingsPanel)
                restoreSettingsScroll(state.datserSettingsPanel)
                return
            }

            if (state.datserSettingsRoot) {
                saveSettingsScroll()
                setShowHelpCenter(false)
                setActiveSection(null)
                restoreSettingsScroll('main')
                return
            }

            if (showHelpCenterRef.current) {
                setShowHelpCenter(false)
                return
            }

            if (activeSectionRef.current) {
                saveSettingsScroll()
                setActiveSection(null)
                restoreSettingsScroll('main')
                return
            }

            onBack?.()
        }

        window.addEventListener('popstate', handlePopState)
        return () => window.removeEventListener('popstate', handlePopState)
    }, [onBack, restoreSettingsScroll, saveSettingsScroll])

    const openSettingsSection = useCallback((section) => {
        if (!section) return
        saveSettingsScroll()
        const wasInSection = Boolean(activeSectionRef.current || showHelpCenterRef.current)
        setActiveSection(section)
        setShowHelpCenter(false)
        restoreSettingsScroll(section)
        if (typeof window !== 'undefined') {
            const currentState = window.history.state || {}
            const nextState = {
                ...currentState,
                datserView: 'settings',
                datserSettingsRoot: false,
                datserSettingsPanel: section
            }
            if (wasInSection) {
                window.history.replaceState(nextState, '', window.location.href)
            } else {
                window.history.pushState(nextState, '', window.location.href)
            }
        }
    }, [restoreSettingsScroll, saveSettingsScroll])

    const closeSettingsPanel = useCallback(() => {
        saveSettingsScroll()
        setActiveSection(null)
        setShowHelpCenter(false)
        restoreSettingsScroll('main')
        if (typeof window !== 'undefined') {
            const currentState = window.history.state || {}
            window.history.replaceState({
                ...currentState,
                datserView: 'settings',
                datserSettingsRoot: true,
                datserSettingsPanel: null
            }, '', window.location.href)
        }
    }, [restoreSettingsScroll, saveSettingsScroll])

    const closeSettingsPage = useCallback(() => {
        onBack?.()
    }, [onBack])

    const openHelpCenter = useCallback(() => {
        saveSettingsScroll()
        const wasInSection = Boolean(activeSectionRef.current || showHelpCenterRef.current)
        setShowHelpCenter(true)
        setActiveSection(null)
        restoreSettingsScroll('help')
        if (typeof window !== 'undefined') {
            const currentState = window.history.state || {}
            const nextState = {
                ...currentState,
                datserView: 'settings',
                datserSettingsRoot: false,
                datserSettingsPanel: 'help'
            }
            if (wasInSection) {
                window.history.replaceState(nextState, '', window.location.href)
            } else {
                window.history.pushState(nextState, '', window.location.href)
            }
        }
    }, [restoreSettingsScroll, saveSettingsScroll])

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
        }, 180000)
    }, [])

    const navigateToSetting = useCallback((section, settingId = null) => {
        if (!section) return
        setSearchQuery('')
        if (section === 'help') {
            openHelpCenter()
            return
        }
        openSettingsSection(section)
        if (settingId) {
            focusSettingTarget(settingId)
        }
    }, [focusSettingTarget, openHelpCenter, openSettingsSection])

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
    const updatePreferences = useCallback(async (nextPreferences) => {
        if (!nextPreferences || typeof nextPreferences !== 'object') return
        const mergedPreferences = {
            ...effectivePreferences,
            ...nextPreferences
        }
        if (
            Object.prototype.hasOwnProperty.call(nextPreferences, 'member_codes_enabled') ||
            Object.prototype.hasOwnProperty.call(nextPreferences, 'workspace_member_codes_enabled')
        ) {
            const enabled = areMemberCodesVisible(mergedPreferences)
            window.localStorage.setItem('datser_member_codes_enabled', String(enabled))
            window.dispatchEvent(new CustomEvent('datser-member-codes-preference-changed', {
                detail: { enabled }
            }))
        }
        setOptimisticPreferencePatch((prev) => ({
            ...prev,
            ...nextPreferences
        }))
        const workspacePatch = Object.fromEntries(
            Object.entries(nextPreferences).filter(([key]) => WORKSPACE_MEMBER_CODE_PREFERENCE_KEYS.has(key))
        )
        if (isCollaborator && isAdminCollaborator && dataOwnerId && Object.keys(workspacePatch).length > 0) {
            try {
                const { data } = await executeSupabaseWrite(
                    () => supabase
                        .from('user_preferences')
                        .upsert({
                            user_id: dataOwnerId,
                            ...workspacePatch,
                            updated_at: new Date().toISOString()
                        }, {
                            onConflict: 'user_id'
                        })
                        .select()
                        .single(),
                    { action: 'Save workspace member-code preferences' }
                )
                return data
            } catch (error) {
                console.error('Could not save shared member-code preferences:', error)
                toast.error('Could not save this workspace setting')
                return null
            }
        }
        const entries = Object.entries(nextPreferences)
        if (entries.length === 1 && typeof updatePreference === 'function') {
            const [key, value] = entries[0]
            return updatePreference(key, value)
        }
        return saveUserPreferences?.(nextPreferences)
    }, [dataOwnerId, effectivePreferences, isAdminCollaborator, isCollaborator, saveUserPreferences, updatePreference])

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
                    .select('id,owner_id,collaborator_email,role,status,created_at,accepted_at,expires_at')
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
                    .select('id,owner_id,collaborator_email,role,status,created_at,accepted_at,expires_at')
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

    const renderContent = (sectionId = activeSection) => {
        switch (sectionId) {
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
                            preferences={effectivePreferences}
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
                            monthlyTables={monthlyTables}
                            currentTable={currentTable}
                            members={members}
                            setIsExportModalOpen={setIsExportModalOpen}
                            setShowExportCenter={setShowExportCenter}
                            oldestMonthTable={oldestMonthTable}
                            setArchiveMonth={setArchiveMonth}
                            getSettingTargetClass={getSettingTargetClass}
                        />
                    </React.Suspense>
                )
            case 'storage':
                return (
                    <div className="space-y-6">
                        <div>
                            <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-1">Storage & Limits</h3>
                            <p className="text-sm text-gray-500 dark:text-gray-400">Database usage, free-plan limits, and cleanup tools.</p>
                        </div>

                        <div data-setting-id="storage_limits" tabIndex={-1} className={`bg-white dark:bg-gray-800 rounded-2xl border border-gray-200 dark:border-gray-700 overflow-hidden ${getSettingTargetClass('storage_limits')}`}>
                            <div className="p-4 flex items-start justify-between gap-4 border-b border-gray-100 dark:border-gray-700">
                                <div>
                                    <h4 className="font-semibold text-gray-900 dark:text-white">Database Storage</h4>
                                    <p className="text-xs text-gray-500 dark:text-gray-400">Member data, attendance, badges, tags, and monthly tables.</p>
                                </div>
                                <span className="text-xs font-bold px-2.5 py-1 rounded-full bg-orange-100 dark:bg-orange-900/40 text-orange-700 dark:text-orange-300">Free Plan</span>
                            </div>
                            <div className="p-4 space-y-3">
                                <div className="flex items-center justify-between text-sm">
                                    <span className="font-semibold text-gray-800 dark:text-gray-200">Used</span>
                                    {dbLoading ? (
                                        <span className="text-gray-400 flex items-center gap-1"><Loader2 className="w-3 h-3 animate-spin" /> Loading...</span>
                                    ) : dbUsage ? (
                                        <span className={`font-bold ${dbUsage.db_size_mb > DB_LIMIT_MB * 0.8 ? 'text-orange-600 dark:text-orange-400' : 'text-gray-900 dark:text-white'}`}>
                                            {dbUsage.db_size_mb} / {DB_LIMIT_MB} MB
                                        </span>
                                    ) : (
                                        <span className="text-gray-400">Unavailable</span>
                                    )}
                                </div>
                                <div className="h-4 rounded-full bg-gray-100 dark:bg-gray-700 overflow-hidden border border-gray-200 dark:border-gray-600">
                                    <div
                                        className={`h-full rounded-full transition-all ${dbUsage && dbUsage.db_size_mb > DB_LIMIT_MB * 0.8 ? 'bg-gradient-to-r from-orange-400 to-red-500' : 'bg-gradient-to-r from-emerald-400 to-emerald-500'}`}
                                        style={{ width: `${dbUsage ? Math.max(1, Math.min(100, Math.round((dbUsage.db_size_mb / DB_LIMIT_MB) * 100))) : 0}%` }}
                                    />
                                </div>
                                <div className="flex items-center justify-between text-xs">
                                    <span className="text-emerald-600 dark:text-emerald-400 font-medium">
                                        {dbUsage ? `${(DB_LIMIT_MB - dbUsage.db_size_mb).toFixed(1)} MB free` : 'Run refresh to check usage'}
                                    </span>
                                    <button onClick={fetchDbUsage} className="text-orange-500 hover:text-orange-600 dark:hover:text-orange-400 flex items-center gap-1 transition-colors font-semibold">
                                        <RefreshCw className={`w-3 h-3 ${dbLoading ? 'animate-spin' : ''}`} /> Refresh
                                    </button>
                                </div>
                            </div>
                        </div>

                        <div className="bg-white dark:bg-gray-800 rounded-2xl border border-gray-200 dark:border-gray-700 overflow-hidden">
                            <div className="p-4 flex items-start justify-between gap-4 border-b border-gray-100 dark:border-gray-700">
                                <div>
                                    <h4 className="font-semibold text-gray-900 dark:text-white">Auth Emails</h4>
                                    <p className="text-xs text-gray-500 dark:text-gray-400">Magic links, password resets, invites, and signup confirmations.</p>
                                </div>
                                <span className={`text-xs font-bold px-2.5 py-1 rounded-full ${emailsRemaining === 0 ? 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-200' : 'bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-200'}`}>
                                    {emailSends.length} / {EMAIL_RATE_LIMIT}
                                </span>
                            </div>
                            <div className="p-4 space-y-3">
                                <div className="h-4 rounded-full bg-gray-100 dark:bg-gray-700 overflow-hidden border border-gray-200 dark:border-gray-600">
                                    <div
                                        className={`h-full rounded-full transition-all ${emailsRemaining === 0 ? 'bg-gradient-to-r from-red-400 to-red-500' : emailPct >= 66 ? 'bg-gradient-to-r from-amber-400 to-orange-500' : 'bg-gradient-to-r from-purple-400 to-purple-500'}`}
                                        style={{ width: `${Math.max(emailPct > 0 ? 4 : 0, Math.min(100, emailPct))}%` }}
                                    />
                                </div>
                                <div className="flex items-center justify-between text-xs">
                                    <span className={`${emailsRemaining === 0 ? 'text-red-600 dark:text-red-400' : 'text-purple-600 dark:text-purple-400'} font-medium`}>
                                        {emailsRemaining > 0 ? `${emailsRemaining} email${emailsRemaining !== 1 ? 's' : ''} remaining` : 'Rate limit reached'}
                                    </span>
                                    {emailCountdown ? (
                                        <span className="text-orange-600 dark:text-orange-400 font-medium">Resets in {emailCountdown}</span>
                                    ) : (
                                        <span className="text-gray-400">Resets hourly</span>
                                    )}
                                </div>
                            </div>
                        </div>

                        {oldestMonthTable && (
                            <div className="bg-amber-50 dark:bg-amber-900/15 border border-amber-200 dark:border-amber-800/50 rounded-2xl p-4 flex items-start gap-3">
                                <Archive className="w-5 h-5 text-amber-600 dark:text-amber-400 mt-0.5 flex-shrink-0" />
                                <div className="flex-1 min-w-0">
                                    <h4 className="font-semibold text-amber-900 dark:text-amber-200">Archive recommendation</h4>
                                    <p className="mt-1 text-sm text-amber-800 dark:text-amber-300">
                                        Archive <strong>{oldestMonthTable.table_name.replace('_', ' ')}</strong> ({oldestMonthTable.size_mb} MB) to free up space.
                                    </p>
                                    <button
                                        onClick={() => { openSettingsSection('data'); setArchiveMonth(oldestMonthTable.table_name) }}
                                        className="mt-3 rounded-xl bg-amber-600 px-4 py-2 text-sm font-bold text-white hover:bg-amber-700"
                                    >
                                        Archive Month
                                    </button>
                                </div>
                            </div>
                        )}

                        <div className="rounded-2xl border border-gray-200 bg-white dark:border-gray-700 dark:bg-gray-800 overflow-hidden">
                            <button
                                type="button"
                                onClick={() => setShowUsageDetails((current) => !current)}
                                className="w-full p-4 flex items-center justify-between gap-4 text-left hover:bg-gray-50 dark:hover:bg-gray-700/50 transition-colors"
                            >
                                <div>
                                    <h4 className="font-semibold text-gray-900 dark:text-white">Plan details</h4>
                                    <p className="text-xs text-gray-500 dark:text-gray-400">See what counts toward storage and when to archive old months.</p>
                                </div>
                                <ChevronDown className={`w-5 h-5 text-gray-400 transition-transform ${showUsageDetails ? 'rotate-180' : ''}`} />
                            </button>
                            {showUsageDetails && (
                                <div className="px-4 pb-4 space-y-3 text-sm text-gray-600 dark:text-gray-300">
                                    <div className="rounded-xl bg-gray-50 dark:bg-gray-900/40 border border-gray-200 dark:border-gray-700 p-3">
                                        Member records, attendance tables, tags, notes, and badges all count toward database storage.
                                    </div>
                                    <div className="rounded-xl bg-gray-50 dark:bg-gray-900/40 border border-gray-200 dark:border-gray-700 p-3">
                                        Archive older month tables when they are no longer actively edited. Exports stay available while the database gets lighter.
                                    </div>
                                    <div className="rounded-xl bg-gray-50 dark:bg-gray-900/40 border border-gray-200 dark:border-gray-700 p-3">
                                        Supabase auth emails reset on a rolling hourly window, so invites and password emails may pause until the limit refreshes.
                                    </div>
                                </div>
                            )}
                        </div>
                    </div>
                )
            case 'appearance':
                return (
                    <React.Suspense fallback={<LazyPanelFallback />}>
                        <AppearanceSettingsSection
                            themeMode={themeMode}
                            setThemeMode={setThemeMode}
                            preferences={effectivePreferences}
                            updatePreferences={updatePreferences}
                            isCollaborator={isCollaborator}
                            getSettingTargetClass={getSettingTargetClass}
                        />
                    </React.Suspense>
                )
            case 'member_codes':
                return (
                    <React.Suspense fallback={<LazyPanelFallback />}>
                        <MemberCodeSettingsSection
                            preferences={effectivePreferences}
                            updatePreferences={updatePreferences}
                            isAdminAccess={hasAdminAccess}
                            getSettingTargetClass={getSettingTargetClass}
                        />
                    </React.Suspense>
                )
            case 'updates':
                return (
                    <React.Suspense fallback={<LazyPanelFallback />}>
                        <UpdatesSettingsSection getSettingTargetClass={getSettingTargetClass} />
                    </React.Suspense>
                )
            case 'accessibility':
                return (
                    <React.Suspense fallback={<LazyPanelFallback />}>
                        <AccessibilitySettingsSection
                            preferences={preferences}
                            updatePreferences={updatePreferences}
                            offlineSaveNoticeThreshold={offlineSaveNoticeThreshold}
                            setOfflineSaveNoticeThreshold={setOfflineSaveNoticeThreshold}
                            notificationDurationMs={notificationDurationMs}
                            setNotificationDurationMs={setNotificationDurationMs}
                            searchSuggestionView={searchSuggestionView}
                            setSearchSuggestionView={setSearchSuggestionView}
                            getSettingTargetClass={getSettingTargetClass}
                        />
                    </React.Suspense>
                )
            case 'forms':
                return (
                    <div className="space-y-6">
                        <div>
                            <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-1">Forms & Workflow</h3>
                            <p className="text-sm text-gray-500 dark:text-gray-400">Member form helpers, attendance completion, and field navigation.</p>
                        </div>
                        <div className="bg-white dark:bg-gray-800 rounded-2xl border border-gray-200 dark:border-gray-700 overflow-hidden divide-y divide-gray-100 dark:divide-gray-700">
                            <div data-setting-id="auto_all_dates" tabIndex={-1} className={`p-4 flex items-center justify-between gap-4 ${getSettingTargetClass('auto_all_dates')}`}>
                                <div>
                                    <h4 className="font-semibold text-gray-900 dark:text-white">Auto-All-Dates</h4>
                                    <p className="text-xs text-gray-500 dark:text-gray-400">Automatically mark all Sundays up to today when attendance is saved.</p>
                                </div>
                                <button
                                    type="button"
                                    onClick={toggleAutoAllDates}
                                    aria-pressed={autoAllDatesEnabled === true}
                                    className={`relative inline-flex h-8 w-14 flex-shrink-0 items-center rounded-full transition-colors ${autoAllDatesEnabled === true ? 'bg-orange-600' : 'bg-gray-300 dark:bg-gray-700'}`}
                                >
                                    <span className={`inline-block h-6 w-6 rounded-full bg-white shadow transition-transform ${autoAllDatesEnabled === true ? 'translate-x-7' : 'translate-x-1'}`} />
                                </button>
                            </div>
                            <div data-setting-id="missing_info_prompt" tabIndex={-1} className={`p-4 flex items-center justify-between gap-4 ${getSettingTargetClass('missing_info_prompt')}`}>
                                <div>
                                    <h4 className="font-semibold text-gray-900 dark:text-white">Missing Info Popup</h4>
                                    <p className="text-xs text-gray-500 dark:text-gray-400">Warn before saving attendance when required member details are blank.</p>
                                </div>
                                <button
                                    type="button"
                                    onClick={toggleMissingInfoPrompt}
                                    aria-pressed={missingInfoPromptEnabled === true}
                                    className={`relative inline-flex h-8 w-14 flex-shrink-0 items-center rounded-full transition-colors ${missingInfoPromptEnabled === true ? 'bg-orange-600' : 'bg-gray-300 dark:bg-gray-700'}`}
                                >
                                    <span className={`inline-block h-6 w-6 rounded-full bg-white shadow transition-transform ${missingInfoPromptEnabled === true ? 'translate-x-7' : 'translate-x-1'}`} />
                                </button>
                            </div>
                        </div>
                        <div className="bg-white dark:bg-gray-800 rounded-2xl border border-gray-200 dark:border-gray-700 overflow-hidden">
                            <div data-setting-id="guided_form_assistant" tabIndex={-1} className={`p-4 flex items-center justify-between gap-4 ${getSettingTargetClass('guided_form_assistant')}`}>
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
                        <div data-setting-id="date_of_birth_picker" tabIndex={-1} className={`bg-white dark:bg-gray-800 rounded-2xl border border-gray-200 dark:border-gray-700 overflow-hidden ${getSettingTargetClass('date_of_birth_picker')}`}>
                            <div className="p-4 border-b border-gray-200 dark:border-gray-700">
                                <h4 className="font-semibold text-gray-900 dark:text-white">Date of Birth Picker</h4>
                                <p className="text-xs text-gray-500 dark:text-gray-400">Choose how the birthday picker opens inside member forms.</p>
                            </div>
                            <div className="p-4 space-y-4">
                                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                                    {[
                                        { value: 'combined', label: 'Day + month + year' },
                                        { value: 'month-year-first', label: 'Month/year first' }
                                    ].map((option) => (
                                        <button
                                            key={option.value}
                                            type="button"
                                            onClick={() => updatePreferences({ date_of_birth_picker_mode: option.value })}
                                            className={`px-3 py-2.5 rounded-xl border text-sm font-semibold transition-colors ${
                                                (effectivePreferences?.date_of_birth_picker_mode || 'combined') === option.value
                                                    ? 'border-orange-500 bg-orange-50 text-orange-800 dark:border-orange-400 dark:bg-orange-500/15 dark:text-orange-200'
                                                    : 'border-gray-200 bg-white text-gray-600 hover:border-orange-300 dark:border-gray-700 dark:bg-gray-900/40 dark:text-gray-300'
                                            }`}
                                        >
                                            {option.label}
                                        </button>
                                    ))}
                                </div>
                                <div className="rounded-2xl border border-orange-200/80 bg-orange-50/60 p-3 shadow-lg shadow-orange-500/10 dark:border-orange-500/25 dark:bg-[#2F3030] dark:shadow-black/30">
                                    <p className="text-xs font-semibold uppercase tracking-wide text-orange-700 dark:text-orange-300 mb-2">Preview</p>
                                    <React.Suspense fallback={<LazyPanelFallback />}>
                                        <CombinedDatePicker
                                            name="date_of_birth_workflow_preview"
                                            label="Date of Birth"
                                            value={dob}
                                            onChange={(event) => setDob(event.target.value)}
                                            placeholder="Tap to preview"
                                            birthDateMode={effectivePreferences?.date_of_birth_picker_mode || 'combined'}
                                        />
                                    </React.Suspense>
                                </div>
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
                setShowExportCenter(true)
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
                navigateToSetting('storage', item.id)
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
                openHelpCenter()
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
        openHelpCenter,
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
        android_apk: {
            description: installedAppInfo
                ? 'Installed: ' + installedAppInfo.versionName + ' (' + (installedAppInfo.versionCode || 'web') + ')'
                : 'Download the latest Android APK'
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
            action: () => {
                rememberSettingsSearch()
                setLastSettingsPath(merged)
                handleSettingsItemAction(merged)
            }
        }
    }), [dynamicItemDetails, handleSettingsItemAction, rememberSettingsSearch, sections, visibleRegistryItems])

    const searchResults = useMemo(() => {
        if (!searchQuery.trim()) return []
        return searchSettingsIndex(searchQuery, allSearchableItems, sections)
    }, [searchQuery, allSearchableItems, sections])

    const defaultSearchSuggestions = useMemo(() => {
        const preferredIds = [
            'guided_form_assistant',
            'date_of_birth_picker',
            'missing_info_prompt',
            'offline_mode',
            'notifications',
            'android_apk'
        ]
        return preferredIds
            .map((id) => allSearchableItems.find((item) => item.id === id))
            .filter(Boolean)
    }, [allSearchableItems])

    const getSettingPath = (item) => {
        const sectionLabel = item?.sectionLabel || sections.find(section => section.id === item?.section)?.label || 'Settings'
        const label = item?.label || 'Open'
        return `Settings / ${sectionLabel} / ${label}`
    }

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

    const handleSettingsSearchResultSelect = useCallback((item, rememberedTerm = searchQuery || item?.label) => {
        rememberSettingsSearch(rememberedTerm)
        setLastSettingsPath(item)
        setQuickSettingsSearchItem(null)
        item?.action?.()
        setIsSettingsSearchFocused(false)
    }, [rememberSettingsSearch, searchQuery])

    const reopenRecentSettingsSearch = useCallback((term) => {
        const rememberedTerm = String(term || '').trim()
        if (!rememberedTerm) return
        const first = searchSettingsIndex(rememberedTerm, allSearchableItems, sections)[0]
        if (first) {
            handleSettingsSearchResultSelect(first, rememberedTerm)
            return
        }
        setSearchQuery(rememberedTerm)
        setIsSettingsSearchFocused(true)
    }, [allSearchableItems, handleSettingsSearchResultSelect, sections])

    const openQuickSettingsSearchItem = useCallback(() => {
        if (!quickSettingsSearchItem) return
        quickSettingsSearchItem.action()
        setQuickSettingsSearchItem(null)
        setIsSettingsSearchFocused(false)
    }, [quickSettingsSearchItem])

    const handleSettingsSearchEnter = useCallback((event) => {
        if (event.key !== 'Enter') return
        const first = searchResults[0]
        if (!first) return
        event.preventDefault()
        handleSettingsSearchResultSelect(first)
    }, [handleSettingsSearchResultSelect, searchResults])

    // Show Help Center Page
    if (showHelpCenter) {
        return (
            <React.Suspense fallback={<LazyPanelFallback />}>
                <HelpCenterPage
                    onBack={closeSettingsPanel}
                    onNavigate={(target, options) => {
                        setShowHelpCenter(false)
                        if (target === 'dashboard' || target === 'settings') {
                            closeSettingsPage()
                        }
                    }}
                />
            </React.Suspense>
        )
    }

    // Render main settings list (when no section is active)
    const renderMainList = () => (
        <div className="min-h-0">
            <div className="max-w-4xl mx-auto px-3 sm:px-4 pt-5 pb-2 xl:pb-2 space-y-3">

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
                            onClick={() => openSettingsSection('account')}
                            className="p-2 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg"
                        >
                            <ChevronRight className="w-5 h-5 text-gray-400" />
                        </button>
                    </div>
                </div>

                <div className="hidden xl:block">
                    <div className="relative">
                        <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400" />
                        <input
                            type="text"
                            placeholder="Search settings"
                            value={searchQuery}
                            onChange={(e) => setSearchQuery(e.target.value)}
                            onKeyDown={handleSettingsSearchEnter}
                            onFocus={() => setIsSettingsSearchFocused(true)}
                            className="h-12 w-full rounded-2xl border border-gray-200/80 bg-white/70 pl-12 pr-4 text-base text-gray-900 outline-none shadow-inner backdrop-blur-2xl transition-all focus:border-orange-500 focus:bg-white/85 focus:ring-2 focus:ring-orange-500/20 dark:border-gray-700/80 dark:bg-white/6 dark:text-white dark:placeholder-gray-500 dark:focus:bg-white/10"
                        />
                    </div>
                </div>

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
                                        onClick={() => handleSettingsSearchResultSelect(item)}
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
                                            <p className="mt-0.5 text-[11px] font-medium text-orange-600 dark:text-orange-300 truncate">
                                                {getSettingPath(item)}
                                            </p>
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
                                            openHelpCenter()
                                        } else {
                                            openSettingsSection(section.id)
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
                    <div className="w-full bg-white dark:bg-gray-800 rounded-xl border border-red-200 dark:border-red-900/50 overflow-hidden mt-3">
                        <button
                            onClick={() => openSettingsSection('danger')}
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
                    className="w-full mt-3 py-3 bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-300 font-medium rounded-xl border border-gray-200 dark:border-gray-700 hover:bg-gray-200 dark:hover:bg-gray-700 transition-colors"
                >
                    Sign Out
                </button>
            </div>

            {isSettingsSearchFocused && (
                <div className="fixed inset-0 z-[90] bg-white/95 dark:bg-black/95 backdrop-blur-2xl overflow-y-auto overscroll-contain md:grid md:grid-cols-[minmax(300px,42vw)_minmax(420px,1fr)]">
                    <div className="hidden md:block" onClick={() => setIsSettingsSearchFocused(false)} />
                    <div className="flex min-h-screen flex-col gap-5 px-4 pb-28 pt-5 md:px-8 md:pt-6">
                        <div className="mb-1 hidden items-center gap-3 md:flex">
                            <button
                                type="button"
                                onClick={() => setIsSettingsSearchFocused(false)}
                                className="grid h-10 w-10 place-items-center rounded-full text-gray-700 transition hover:bg-gray-100 dark:text-gray-200 dark:hover:bg-white/10"
                                aria-label="Back to settings"
                            >
                                <ChevronLeft className="h-6 w-6" />
                            </button>
                            <div className="relative flex-1">
                                <input
                                    type="text"
                                    placeholder="Search"
                                    value={searchQuery}
                                    onChange={(e) => setSearchQuery(e.target.value)}
                                    onKeyDown={handleSettingsSearchEnter}
                                    autoFocus
                                    className="h-12 w-full rounded-2xl border border-transparent bg-transparent px-1 text-xl font-semibold text-gray-900 outline-none placeholder:text-gray-500 dark:text-white dark:placeholder:text-gray-400"
                                />
                            </div>
                            <Mic className="h-5 w-5 text-gray-500 dark:text-gray-300" />
                        </div>

                        {!searchQuery && (
                            <div className="order-3 rounded-[1.35rem] bg-gray-100 p-4 dark:bg-[#191919] md:order-1">
                                <p className="mb-3 text-xs font-semibold text-gray-500 dark:text-gray-400">Recent searches</p>
                                <div className="flex flex-wrap gap-2">
                                    {(recentSettingsSearches.length ? recentSettingsSearches : ['theme', 'offline', 'updates', 'password']).slice(0, 6).map((term) => (
                                        <button
                                            key={term}
                                            type="button"
                                            onClick={() => reopenRecentSettingsSearch(term)}
                                            className="inline-flex items-center gap-2 rounded-full bg-gray-200 px-4 py-2 text-sm font-semibold text-gray-700 transition hover:bg-gray-300 dark:bg-[#303030] dark:text-gray-200 dark:hover:bg-[#3a3a3a]"
                                        >
                                            {term}
                                            <X
                                                className="h-3.5 w-3.5 opacity-60"
                                                onClick={(event) => {
                                                    event.stopPropagation()
                                                    setRecentSettingsSearches((current) => current.filter((item) => item !== term))
                                                }}
                                            />
                                        </button>
                                    ))}
                                </div>
                            </div>
                        )}

                        {!searchQuery && (
                            <div className="order-2 rounded-[1.35rem] bg-gray-100 p-4 dark:bg-[#191919] md:order-2">
                                <p className="mb-3 text-xs font-semibold text-gray-500 dark:text-gray-400">Suggestions</p>
                                <div className="flex flex-wrap gap-2">
                                    {[
                                        ['#DarkMode', 'theme_dark'],
                                        ['#Notifications', 'notifications'],
                                        ['#Offline', 'offline_mode'],
                                        ['#Updates', 'android_apk'],
                                        ['#BirthDate', 'date_of_birth_picker']
                                    ].map(([label, id]) => {
                                        const item = allSearchableItems.find((candidate) => candidate.id === id)
                                        return (
                                            <button
                                                key={label}
                                                type="button"
                                                onClick={() => {
                                                    if (item) {
                                                        item.action()
                                                        setIsSettingsSearchFocused(false)
                                                    } else {
                                                        setSearchQuery(label.replace('#', ''))
                                                    }
                                                }}
                                                className="rounded-full border border-orange-500/70 px-4 py-2 text-sm font-bold text-orange-600 transition hover:bg-orange-50 dark:text-orange-300 dark:hover:bg-orange-500/10"
                                            >
                                                {label}
                                            </button>
                                        )
                                    })}
                                </div>
                            </div>
                        )}

                        <div className="order-1 md:order-3">
                            <p className="mb-3 text-sm font-semibold text-gray-500 dark:text-gray-400">
                                Results
                            </p>
                            <div className="overflow-hidden rounded-[1.35rem] border border-gray-200/80 bg-white/90 shadow-2xl shadow-black/10 backdrop-blur-xl divide-y divide-gray-100 dark:border-[#282828] dark:bg-[#121212]/95 dark:divide-[#242424] dark:shadow-black/40">
                                {(searchQuery ? searchResults : defaultSearchSuggestions).slice(0, 8).map((item) => {
                                    const Icon = item.icon || Search
                                    return (
                                        <button
                                            key={item.id}
                                            type="button"
                                            onClick={() => handleSettingsSearchResultSelect(item)}
                                            className="w-full flex items-center gap-3 px-4 py-3.5 text-left transition-colors hover:bg-gray-50 dark:hover:bg-white/5"
                                        >
                                            <div className="grid h-10 w-10 place-items-center rounded-xl bg-gray-100 dark:bg-[#242424]">
                                                <Icon className="w-5 h-5 text-gray-500 dark:text-gray-300" />
                                            </div>
                                            <div className="min-w-0 flex-1">
                                                <p className="font-semibold text-gray-900 dark:text-white truncate">{item.label}</p>
                                                <p className="text-xs text-gray-500 dark:text-gray-400 truncate">{getSettingPath(item)}</p>
                                            </div>
                                            <ChevronRight className="w-4 h-4 text-gray-400" />
                                        </button>
                                    )
                                })}
                                {searchQuery && searchResults.length === 0 && (
                                    <div className="p-6 text-center">
                                        <p className="font-semibold text-gray-900 dark:text-white">No settings found</p>
                                        <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">Try another word or open a section below.</p>
                                    </div>
                                )}
                            </div>
                        </div>
                    </div>
                </div>
            )}

            <div className="fixed inset-x-0 bottom-0 z-[100] border-t border-gray-200/60 dark:border-gray-800/60 bg-white/65 dark:bg-black/45 backdrop-blur-2xl px-3 py-2 shadow-[0_-18px_45px_rgba(0,0,0,0.16)] xl:hidden">
                <div className="max-w-4xl mx-auto flex items-center gap-3">
                    <div className={`relative flex-1 transition-all duration-300 ease-out ${isSettingsSearchFocused ? 'translate-x-0' : 'translate-x-0'}`}>
                        <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400" />
                        <input
                            type="text"
                            placeholder="Search settings"
                            value={searchQuery}
                            onChange={(e) => setSearchQuery(e.target.value)}
                            onKeyDown={handleSettingsSearchEnter}
                            onFocus={() => setIsSettingsSearchFocused(true)}
                            className="h-11 w-full rounded-2xl border border-gray-200/80 bg-white/58 pl-12 pr-4 text-base text-gray-900 outline-none shadow-inner backdrop-blur-2xl transition-all duration-300 ease-out focus:border-orange-500 focus:bg-white/75 focus:ring-2 focus:ring-orange-500/20 dark:border-gray-700/80 dark:bg-white/5 dark:text-white dark:placeholder-gray-500 dark:focus:bg-white/8"
                        />
                    </div>
                    <button
                        type="button"
                        onClick={() => {
                            setSearchQuery('')
                            setIsSettingsSearchFocused(false)
                        }}
                        className={`grid h-11 shrink-0 place-items-center rounded-full bg-gray-100 text-gray-600 transition-all duration-300 ease-out hover:bg-gray-200 dark:bg-gray-800 dark:text-gray-200 dark:hover:bg-gray-700 ${
                            isSettingsSearchFocused
                                ? 'w-11 translate-x-0 scale-100 opacity-100'
                                : 'w-0 translate-x-4 scale-75 opacity-0 pointer-events-none'
                        }`}
                        aria-label="Close settings search"
                    >
                        <X className="w-6 h-6" />
                    </button>
                </div>
            </div>
        </div>
    )

    // Render detail view (when a section is active)
    const renderDetailView = ({ embedded = false, sectionId = activeSection } = {}) => {
        const effectiveSection = sectionId || 'account'
        const currentSection = sections.find(s => s.id === effectiveSection)
        const Icon = currentSection?.icon || User

        return (
            <div className={embedded ? 'min-h-full bg-[#f7f7f5] dark:bg-[#121212]' : 'min-h-0'}>
                <div className={`${embedded ? 'max-w-none px-4 pb-4 bg-[#f7f7f5] dark:bg-[#121212]' : 'max-w-4xl mx-auto px-3 sm:px-4 pb-4'} pt-5`}>
                    <div className={`${embedded ? 'mb-2 border-b border-gray-200/70 pb-2 dark:border-white/10' : 'mb-2.5'} font-[var(--font-family)]`}>
                        <div className="flex min-w-0 items-center gap-2 sm:gap-3">
                            <button
                                onClick={closeSettingsPanel}
                                className={`${embedded ? 'hidden' : 'grid'} h-11 w-11 shrink-0 place-items-center rounded-2xl border border-gray-200 bg-white text-gray-600 shadow-sm transition-colors hover:bg-gray-100 active:scale-95 dark:border-white/10 dark:bg-[#202121] dark:text-gray-200 dark:hover:bg-white/10`}
                                aria-label={`Back from ${currentSection?.label || 'Settings'}`}
                            >
                                <ChevronLeft className="h-5 w-5" />
                            </button>
                            <div className="flex min-w-0 flex-1 items-center gap-2">
                                <div className={`grid h-10 w-10 shrink-0 place-items-center rounded-2xl ${getIconBgColor(currentSection?.color || 'blue')}`}>
                                    <Icon className={`h-5 w-5 ${getIconColor(currentSection?.color || 'blue')}`} />
                                </div>
                                <h1 className="truncate text-lg font-bold text-gray-900 dark:text-white sm:text-xl">{currentSection?.label || 'Settings'}</h1>
                            </div>
                            <button
                                type="button"
                                onClick={() => setIsLivePreviewOpen((value) => !value)}
                                className={`inline-flex shrink-0 items-center gap-2 rounded-xl border px-3 py-2 text-xs font-black transition-all duration-300 active:scale-95 ${isLivePreviewOpen
                                    ? 'border-orange-500 bg-orange-600 text-white shadow-lg shadow-orange-500/20'
                                    : 'border-orange-200 bg-orange-50 text-orange-700 hover:border-orange-400 hover:bg-orange-100 dark:border-orange-400/20 dark:bg-orange-500/10 dark:text-orange-200 dark:hover:bg-orange-500/15'
                                }`}
                                aria-expanded={isLivePreviewOpen}
                                aria-controls="settings-live-preview-drawer"
                                aria-label="Live Preview"
                            >
                                <Sparkles className="h-4 w-4" />
                                <span className="hidden sm:inline">Live Preview</span>
                            </button>
                        </div>
                    </div>

                    <div className={embedded ? '' : 'rounded-[1.35rem] border border-gray-200 bg-[#f7f7f5] p-2.5 shadow-xl shadow-black/8 dark:border-[#303030] dark:bg-[#1b1b1b] dark:shadow-black/30'}>
                        {renderContent(effectiveSection)}
                    </div>
                </div>
            </div>
        )
    }

    const renderSettingsSearchPanel = () => (
        <div className="min-h-0">
            <div className="relative z-30 w-full border-b border-gray-200/70 bg-white/85 shadow-sm backdrop-blur-sm dark:border-gray-800/70 dark:bg-[#121212]/90">
                <div className="w-full px-3 py-3 sm:px-8">
                    <div className="flex items-center gap-3">
                        <button
                            type="button"
                            onClick={() => setIsSettingsSearchFocused(false)}
                            className="grid h-10 w-10 place-items-center rounded-full text-gray-700 transition hover:bg-gray-100 dark:text-gray-200 dark:hover:bg-white/10"
                            aria-label="Back to settings"
                        >
                            <ChevronLeft className="h-6 w-6" />
                        </button>
                        <input
                            type="text"
                            placeholder="Search"
                            value={searchQuery}
                            onChange={(e) => setSearchQuery(e.target.value)}
                            onKeyDown={handleSettingsSearchEnter}
                            autoFocus
                            className="h-12 min-w-0 flex-1 rounded-2xl border border-transparent bg-transparent px-1 text-xl font-semibold text-gray-900 outline-none placeholder:text-gray-500 dark:text-white dark:placeholder:text-gray-400"
                        />
                        <Mic className="h-5 w-5 text-gray-500 dark:text-gray-300" />
                    </div>
                </div>
            </div>

            <div className="space-y-5 px-4 py-5 sm:px-8">
                {!searchQuery && (
                    <div className="rounded-[1.35rem] bg-gray-100 p-4 dark:bg-[#191919]">
                        <p className="mb-3 text-xs font-semibold text-gray-500 dark:text-gray-400">Recent searches</p>
                        <div className="flex flex-wrap gap-2">
                            {(recentSettingsSearches.length ? recentSettingsSearches : ['theme', 'offline', 'updates', 'password']).slice(0, 6).map((term) => (
                                <button
                                    key={term}
                                    type="button"
                                    onClick={() => reopenRecentSettingsSearch(term)}
                                    className="inline-flex items-center gap-2 rounded-full bg-gray-200 px-4 py-2 text-sm font-semibold text-gray-700 transition hover:bg-gray-300 dark:bg-[#303030] dark:text-gray-200 dark:hover:bg-[#3a3a3a]"
                                >
                                    {term}
                                    <X
                                        className="h-3.5 w-3.5 opacity-60"
                                        onClick={(event) => {
                                            event.stopPropagation()
                                            setRecentSettingsSearches((current) => current.filter((item) => item !== term))
                                        }}
                                    />
                                </button>
                            ))}
                        </div>
                    </div>
                )}

                {!searchQuery && (
                    <div className="rounded-[1.35rem] bg-gray-100 p-4 dark:bg-[#191919]">
                        <p className="mb-3 text-xs font-semibold text-gray-500 dark:text-gray-400">Suggestions</p>
                        <div className="flex flex-wrap gap-2">
                            {[
                                ['#DarkMode', 'theme_dark'],
                                ['#Notifications', 'notifications'],
                                ['#Offline', 'offline_mode'],
                                ['#Updates', 'android_apk'],
                                ['#BirthDate', 'date_of_birth_picker']
                            ].map(([label, id]) => {
                                const item = allSearchableItems.find((candidate) => candidate.id === id)
                                return (
                                    <button
                                        key={label}
                                        type="button"
                                        onClick={() => {
                                            if (item) {
                                                item.action()
                                                setIsSettingsSearchFocused(false)
                                            } else {
                                                setSearchQuery(label.replace('#', ''))
                                            }
                                        }}
                                        className="rounded-full border border-orange-500/70 px-4 py-2 text-sm font-bold text-orange-600 transition hover:bg-orange-50 dark:text-orange-300 dark:hover:bg-orange-500/10"
                                    >
                                        {label}
                                    </button>
                                )
                            })}
                        </div>
                    </div>
                )}

                <div>
                    <p className="mb-3 text-sm font-semibold text-gray-500 dark:text-gray-400">Results</p>
                    <div className="overflow-hidden rounded-[1.35rem] border border-gray-200/80 bg-white/90 shadow-2xl shadow-black/10 backdrop-blur-xl divide-y divide-gray-100 dark:border-[#282828] dark:bg-[#121212]/95 dark:divide-[#242424] dark:shadow-black/40">
                        {(searchQuery ? searchResults : defaultSearchSuggestions).slice(0, 8).map((item) => {
                            const Icon = item.icon || Search
                            return (
                                <button
                                    key={item.id}
                                    type="button"
                                    onClick={() => handleSettingsSearchResultSelect(item)}
                                    className="flex w-full items-center gap-3 px-4 py-3.5 text-left transition-colors hover:bg-gray-50 dark:hover:bg-white/5"
                                >
                                    <div className="grid h-10 w-10 place-items-center rounded-xl bg-gray-100 dark:bg-[#242424]">
                                        <Icon className="h-5 w-5 text-gray-500 dark:text-gray-300" />
                                    </div>
                                    <div className="min-w-0 flex-1">
                                        <p className="truncate font-semibold text-gray-900 dark:text-white">{item.label}</p>
                                        <p className="truncate text-xs text-gray-500 dark:text-gray-400">{getSettingPath(item)}</p>
                                    </div>
                                    <ChevronRight className="h-4 w-4 text-gray-400" />
                                </button>
                            )
                        })}
                        {searchQuery && searchResults.length === 0 && (
                            <div className="p-6 text-center">
                                <p className="font-semibold text-gray-900 dark:text-white">No settings found</p>
                                <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">Try another word or open a section below.</p>
                            </div>
                        )}
                    </div>
                </div>
            </div>
        </div>
    )

    const renderSplitSettingsView = () => {
        const visibleSections = sections.filter(section => section.id !== 'danger')
        const effectiveSection = activeSection || 'account'
        const isSidebarCollapsed = settingsSidebarWidth <= 120
        return (
            <>
                <div className="hidden h-[calc(100vh-var(--app-settings-main-top-offset,64px))] overflow-hidden px-4 py-4 md:flex md:flex-col">
                    <div
                        ref={splitContainerRef}
                        className="settings-live-preview-grid grid min-h-0 flex-1"
                        style={{ '--settings-sidebar-width': `${settingsSidebarWidth}px` }}
                    >
                    <aside className="h-full overflow-y-auto overscroll-contain no-scrollbar rounded-2xl border border-gray-200 bg-white/90 shadow-sm backdrop-blur-xl transition-[width] duration-150 dark:!border-[#333] dark:!bg-[#121212]">
                        <div className={`sticky top-0 z-10 border-b border-gray-200 bg-white/95 py-4 backdrop-blur-xl dark:!border-[#333] dark:!bg-[#121212] ${isSidebarCollapsed ? 'px-2' : 'px-4'}`}>
                            <div className={`flex items-center ${isSidebarCollapsed ? 'flex-col gap-2' : 'gap-3'}`}>
                                <div className={isSidebarCollapsed ? 'hidden' : ''}>
                                    <h1 className="text-xl font-bold text-gray-900 dark:text-white">Settings</h1>
                                    <p className="text-xs text-gray-500 dark:text-gray-400">Compact split view</p>
                                </div>
                                <button
                                    type="button"
                                    onClick={() => setIsSettingsSearchFocused(true)}
                                    {...getSettingsRailTooltipHandlers('Search')}
                                    className={`${isSidebarCollapsed ? '' : 'ml-auto'} group relative grid h-10 w-10 place-items-center rounded-full text-gray-600 transition hover:bg-gray-100 dark:text-gray-200 dark:hover:bg-white/10`}
                                    aria-label="Search settings"
                                >
                                    <Search className="h-5 w-5" />
                                </button>
                            </div>
                        </div>
                        <div className={isSidebarCollapsed ? 'p-2' : 'p-3'}>
                            <div className="overflow-hidden rounded-2xl border border-gray-200 bg-white dark:!border-[#303030] dark:!bg-[#1f1f1f]">
                                {visibleSections.map((section) => {
                                    const Icon = section.icon
                                    const isActive = effectiveSection === section.id
                                    return (
                                        <button
                                            key={section.id}
                                            type="button"
                                            onClick={() => {
                                                hideSettingsRailTooltip()
                                                if (section.id === 'help') {
                                                    openHelpCenter()
                                                } else {
                                                    openSettingsSection(section.id)
                                                }
                                            }}
                                            {...getSettingsRailTooltipHandlers(section.label)}
                                            title={isSidebarCollapsed ? section.label : undefined}
                                            className={`group relative flex w-full items-center border-b border-gray-100 text-left transition-colors last:border-b-0 dark:border-gray-800 ${
                                                isSidebarCollapsed ? 'justify-center px-2 py-3' : 'gap-3 px-4 py-3.5'
                                            } ${
                                                isActive
                                                    ? 'bg-orange-50 text-orange-700 dark:!bg-[#3a2419] dark:!text-orange-100'
                                                    : 'bg-transparent text-gray-900 hover:bg-gray-50 dark:!text-white dark:hover:!bg-white/5'
                                            }`}
                                        >
                                            <div className={`grid h-10 w-10 shrink-0 place-items-center rounded-xl ${isActive ? 'bg-orange-100 dark:!bg-orange-500/20' : getIconBgColor(section.color)}`}>
                                                <Icon className={`h-5 w-5 ${isActive ? 'text-orange-600 dark:text-orange-300' : getIconColor(section.color)}`} />
                                            </div>
                                            <div className={`min-w-0 flex-1 ${isSidebarCollapsed ? 'hidden' : ''}`}>
                                                <p className="font-semibold truncate">{section.label}</p>
                                                <p className="mt-0.5 truncate text-xs text-gray-500 dark:text-gray-400">{getSectionPreview(section.id)}</p>
                                            </div>
                                            {!isSidebarCollapsed && <ChevronRight className={`h-5 w-5 ${isActive ? 'text-orange-500' : 'text-gray-400'}`} />}
                                        </button>
                                    )
                                })}
                            </div>
                            <button
                                type="button"
                                onClick={() => {
                                    hideSettingsRailTooltip()
                                    openSettingsSection('danger')
                                }}
                                {...getSettingsRailTooltipHandlers('Danger Zone')}
                                title={isSidebarCollapsed ? 'Danger Zone' : undefined}
                                className={`group relative mt-3 flex w-full items-center rounded-2xl border border-red-200 bg-white text-left text-red-600 transition-colors hover:bg-red-50 dark:!border-red-900/50 dark:!bg-[#1f1f1f] dark:!text-red-300 dark:hover:!bg-red-950/20 ${
                                    isSidebarCollapsed ? 'justify-center px-2 py-3' : 'gap-3 px-4 py-3.5'
                                }`}
                            >
                                <div className="grid h-10 w-10 place-items-center rounded-xl bg-red-100 dark:bg-red-900/30">
                                    <AlertTriangle className="h-5 w-5" />
                                </div>
                                <div className={`flex-1 ${isSidebarCollapsed ? 'hidden' : ''}`}>
                                    <p className="font-semibold">Danger Zone</p>
                                    <p className="text-xs text-red-500/75 dark:text-red-300/75">Delete account</p>
                                </div>
                                {!isSidebarCollapsed && <ChevronRight className="h-5 w-5" />}
                            </button>
                        </div>
                    </aside>
                    <div
                        role="separator"
                        aria-orientation="vertical"
                        aria-label="Resize settings sidebar"
                        title="Drag to resize settings list. Double-click to reset."
                        onPointerDown={beginSettingsResize}
                        onDoubleClick={() => setSettingsSidebarWidth(typeof window !== 'undefined' && window.innerWidth < 1180 ? 320 : 380)}
                        className="group flex h-full cursor-col-resize touch-none select-none items-center justify-center"
                    >
                        <div className="h-20 w-1.5 rounded-full bg-gray-300/80 transition-all group-hover:h-28 group-hover:bg-orange-500 dark:bg-white/20 dark:group-hover:bg-orange-400" />
                    </div>
                    <section className="h-full overflow-y-auto overscroll-contain no-scrollbar rounded-2xl border border-gray-200 bg-[#f7f7f5] shadow-xl shadow-black/8 dark:!border-[#303030] dark:!bg-[#1b1b1b] dark:shadow-black/30">
                        {isSettingsSearchFocused ? renderSettingsSearchPanel() : renderDetailView({ embedded: true, sectionId: effectiveSection })}
                    </section>
                    </div>
                    {isSidebarCollapsed && settingsRailTooltip && (
                        <div
                            className="pointer-events-none fixed z-[140] -translate-y-1/2 rounded-xl border border-gray-200 bg-white px-3 py-2 text-xs font-bold text-gray-900 shadow-xl shadow-black/15 dark:border-white/10 dark:bg-[#202121] dark:text-white"
                            style={{
                                left: settingsRailTooltip.left,
                                top: settingsRailTooltip.top
                            }}
                        >
                            {settingsRailTooltip.label}
                        </div>
                    )}
                </div>
                <div className="md:hidden">
                    {activeSection === null ? renderMainList() : renderDetailView({ sectionId: effectiveSection })}
                </div>
            </>
        )
    }

    // Main render
    return (
        <div className={profileSettingsArriving ? 'settings-profile-arrival' : ''}>
            {compactMode ? renderSplitSettingsView() : (activeSection === null ? renderMainList() : renderDetailView())}

            {isLivePreviewOpen && (
                <div className="fixed inset-0 z-[145]" role="presentation">
                    <button
                        type="button"
                        className="absolute inset-0 bg-black/45 backdrop-blur-[2px] animate-in fade-in"
                        onClick={() => setIsLivePreviewOpen(false)}
                        aria-label="Close Live Preview"
                    />
                    <aside
                        id="settings-live-preview-drawer"
                        role="dialog"
                        aria-modal="true"
                        aria-label={`${sections.find((section) => section.id === (activeSection || 'account'))?.label || 'Settings'} Live Preview`}
                        className="settings-live-preview-drawer absolute inset-y-0 right-0 flex w-[min(92vw,26rem)] flex-col border-l border-orange-200 bg-[#f7f7f5] shadow-[-24px_0_70px_rgba(0,0,0,0.28)] dark:border-orange-400/20 dark:bg-[#121212]"
                    >
                        <div className="flex items-center justify-between border-b border-gray-200 px-4 py-4 dark:border-white/10">
                            <div className="flex min-w-0 items-center gap-3">
                                <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-orange-100 text-orange-600 dark:bg-orange-500/15 dark:text-orange-300">
                                    <Sparkles className="h-5 w-5" />
                                </span>
                                <div className="min-w-0">
                                    <p className="text-[10px] font-black uppercase tracking-[0.16em] text-orange-600 dark:text-orange-300">Live Preview</p>
                                    <p className="truncate font-black text-gray-900 dark:text-white">{sections.find((section) => section.id === (activeSection || 'account'))?.label || 'Settings'}</p>
                                </div>
                            </div>
                            <button type="button" onClick={() => setIsLivePreviewOpen(false)} className="grid h-10 w-10 place-items-center rounded-full border border-gray-200 bg-white text-gray-600 transition hover:bg-gray-100 dark:border-white/10 dark:bg-white/5 dark:text-gray-200 dark:hover:bg-white/10" aria-label="Close Live Preview">
                                <X className="h-5 w-5" />
                            </button>
                        </div>
                        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-4">
                            <LiveFeaturePreview
                                type={activeSection || 'account'}
                                section={sections.find((section) => section.id === (activeSection || 'account'))}
                                collapsible={false}
                                defaultOpen
                                showHeader={false}
                                className="shadow-none"
                            />
                        </div>
                    </aside>
                </div>
            )}

            {false && compactMode && isSettingsSearchFocused && (
                <div className="fixed inset-0 z-[90] hidden bg-white/95 backdrop-blur-2xl dark:bg-black/95 md:grid md:grid-cols-[minmax(300px,42vw)_minmax(420px,1fr)]">
                    <div className="hidden md:block" onClick={() => setIsSettingsSearchFocused(false)} />
                    <div className="min-h-screen overflow-y-auto overscroll-contain px-4 pb-28 pt-5 md:px-8 md:pt-6">
                        <div className="mb-6 flex items-center gap-3">
                            <button
                                type="button"
                                onClick={() => setIsSettingsSearchFocused(false)}
                                className="grid h-10 w-10 place-items-center rounded-full text-gray-700 transition hover:bg-gray-100 dark:text-gray-200 dark:hover:bg-white/10"
                                aria-label="Back to settings"
                            >
                                <ChevronLeft className="h-6 w-6" />
                            </button>
                            <input
                                type="text"
                                placeholder="Search"
                                value={searchQuery}
                                onChange={(e) => setSearchQuery(e.target.value)}
                                onKeyDown={handleSettingsSearchEnter}
                                autoFocus
                                className="h-12 min-w-0 flex-1 rounded-2xl border border-transparent bg-transparent px-1 text-xl font-semibold text-gray-900 outline-none placeholder:text-gray-500 dark:text-white dark:placeholder:text-gray-400"
                            />
                            <Mic className="h-5 w-5 text-gray-500 dark:text-gray-300" />
                        </div>

                        {!searchQuery && (
                            <div className="mb-5 rounded-[1.35rem] bg-gray-100 p-4 dark:bg-[#191919]">
                                <p className="mb-3 text-xs font-semibold text-gray-500 dark:text-gray-400">Recent searches</p>
                                <div className="flex flex-wrap gap-2">
                                    {(recentSettingsSearches.length ? recentSettingsSearches : ['theme', 'offline', 'updates', 'password']).slice(0, 6).map((term) => (
                                        <button
                                            key={term}
                                            type="button"
                                            onClick={() => reopenRecentSettingsSearch(term)}
                                            className="inline-flex items-center gap-2 rounded-full bg-gray-200 px-4 py-2 text-sm font-semibold text-gray-700 transition hover:bg-gray-300 dark:bg-[#303030] dark:text-gray-200 dark:hover:bg-[#3a3a3a]"
                                        >
                                            {term}
                                            <X
                                                className="h-3.5 w-3.5 opacity-60"
                                                onClick={(event) => {
                                                    event.stopPropagation()
                                                    setRecentSettingsSearches((current) => current.filter((item) => item !== term))
                                                }}
                                            />
                                        </button>
                                    ))}
                                </div>
                            </div>
                        )}

                        {!searchQuery && (
                            <div className="mb-5 rounded-[1.35rem] bg-gray-100 p-4 dark:bg-[#191919]">
                                <p className="mb-3 text-xs font-semibold text-gray-500 dark:text-gray-400">Suggestions</p>
                                <div className="flex flex-wrap gap-2">
                                    {[
                                        ['#DarkMode', 'theme_dark'],
                                        ['#Notifications', 'notifications'],
                                        ['#Offline', 'offline_mode'],
                                        ['#Updates', 'android_apk'],
                                        ['#BirthDate', 'date_of_birth_picker']
                                    ].map(([label, id]) => {
                                        const item = allSearchableItems.find((candidate) => candidate.id === id)
                                        return (
                                            <button
                                                key={label}
                                                type="button"
                                                onClick={() => {
                                                    if (item) {
                                                        item.action()
                                                        setIsSettingsSearchFocused(false)
                                                    } else {
                                                        setSearchQuery(label.replace('#', ''))
                                                    }
                                                }}
                                                className="rounded-full border border-orange-500/70 px-4 py-2 text-sm font-bold text-orange-600 transition hover:bg-orange-50 dark:text-orange-300 dark:hover:bg-orange-500/10"
                                            >
                                                {label}
                                            </button>
                                        )
                                    })}
                                </div>
                            </div>
                        )}

                        <div>
                            <p className="mb-3 text-sm font-semibold text-gray-500 dark:text-gray-400">
                                Results
                            </p>
                            <div className="overflow-hidden rounded-[1.35rem] border border-gray-200/80 bg-white/90 shadow-2xl shadow-black/10 backdrop-blur-xl divide-y divide-gray-100 dark:border-[#282828] dark:bg-[#121212]/95 dark:divide-[#242424] dark:shadow-black/40">
                                {(searchQuery ? searchResults : defaultSearchSuggestions).slice(0, 8).map((item) => {
                                    const Icon = item.icon || Search
                                    return (
                                        <button
                                            key={item.id}
                                            type="button"
                                            onClick={() => handleSettingsSearchResultSelect(item)}
                                            className="flex w-full items-center gap-3 px-4 py-3.5 text-left transition-colors hover:bg-gray-50 dark:hover:bg-white/5"
                                        >
                                            <div className="grid h-10 w-10 place-items-center rounded-xl bg-gray-100 dark:bg-[#242424]">
                                                <Icon className="h-5 w-5 text-gray-500 dark:text-gray-300" />
                                            </div>
                                            <div className="min-w-0 flex-1">
                                                <p className="truncate font-semibold text-gray-900 dark:text-white">{item.label}</p>
                                                <p className="truncate text-xs text-gray-500 dark:text-gray-400">{getSettingPath(item)}</p>
                                            </div>
                                            <ChevronRight className="h-4 w-4 text-gray-400" />
                                        </button>
                                    )
                                })}
                                {searchQuery && searchResults.length === 0 && (
                                    <div className="p-6 text-center">
                                        <p className="font-semibold text-gray-900 dark:text-white">No settings found</p>
                                        <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">Try another word or open a section below.</p>
                                    </div>
                                )}
                            </div>
                        </div>
                    </div>
                </div>
            )}

            {quickSettingsSearchItem && (
                <div className="fixed inset-0 z-[130] flex items-center justify-center bg-black/45 p-4 backdrop-blur-md">
                    <div className="w-full max-w-sm overflow-hidden rounded-[1.6rem] border border-gray-200 bg-white shadow-2xl shadow-black/20 dark:border-white/10 dark:bg-[#181818] dark:shadow-black/50">
                        <div className="flex items-center justify-between gap-3 border-b border-gray-100 px-5 py-4 dark:border-white/10">
                            <div className="min-w-0">
                                <p className="text-xs font-bold uppercase tracking-wide text-orange-600 dark:text-orange-300">Quick setting</p>
                                <h3 className="truncate text-lg font-black text-gray-900 dark:text-white">{quickSettingsSearchItem.label}</h3>
                            </div>
                            <button
                                type="button"
                                onClick={() => setQuickSettingsSearchItem(null)}
                                className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-gray-100 text-gray-500 transition hover:bg-gray-200 dark:bg-white/10 dark:text-gray-200 dark:hover:bg-white/15"
                                aria-label="Close quick setting"
                            >
                                <X className="h-5 w-5" />
                            </button>
                        </div>
                        <div className="space-y-4 px-5 py-5">
                            <p className="text-sm text-gray-500 dark:text-gray-400">{getSettingPath(quickSettingsSearchItem)}</p>
                            {quickSettingsSearchItem.description && (
                                <p className="rounded-2xl bg-gray-50 p-3 text-sm text-gray-700 dark:bg-white/5 dark:text-gray-300">
                                    {quickSettingsSearchItem.description}
                                </p>
                            )}
                            <div className="grid grid-cols-2 gap-2">
                                <button
                                    type="button"
                                    onClick={() => setQuickSettingsSearchItem(null)}
                                    className="min-h-[46px] rounded-xl border border-gray-200 bg-white px-3 text-sm font-bold text-gray-700 transition hover:bg-gray-50 dark:border-white/10 dark:bg-white/5 dark:text-gray-200 dark:hover:bg-white/10"
                                >
                                    Keep searching
                                </button>
                                <button
                                    type="button"
                                    onClick={openQuickSettingsSearchItem}
                                    className="min-h-[46px] rounded-xl bg-orange-600 px-3 text-sm font-bold text-white shadow-lg shadow-orange-600/20 transition hover:bg-orange-700"
                                >
                                    Open setting
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
            )}

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
            {showExportCenter && (
                <div className="fixed inset-0 z-[95] overflow-y-auto overscroll-contain bg-white dark:bg-[#121212]">
                    <React.Suspense fallback={<LazyPanelFallback />}>
                        <ExportCenterPage onBack={() => setShowExportCenter(false)} />
                    </React.Suspense>
                </div>
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
