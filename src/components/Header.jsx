import React, { useState, useEffect, useMemo, useRef, memo, useCallback } from 'react'
import {
  Users,
  CheckSquare,
  ChevronDown,
  ChevronRight,
  HelpCircle,
  TrendingUp,
  Wifi,
  WifiOff,
  Download,
  RefreshCw,
  History,
  X,
  Database
} from 'lucide-react'
import MonthPickerPopup from './MonthPickerPopup'
import { useApp } from '../context/AppContext'
import { useAuth } from '../context/AuthContext'
import LoginButton from './LoginButton'
import useHapticFeedback from '../hooks/useHapticFeedback'

const getMemberDisplayName = (member) => (
  member?.full_name || member?.['Full Name'] || member?.name || 'Unknown member'
)

const getMemberRecentDate = (member) => {
  const raw = member?.updated_at || member?.updatedAt || member?.last_updated || member?.modified_at || member?.created_at || member?.inserted_at || member?.joined_at
  if (!raw) return null
  const date = new Date(raw)
  return Number.isNaN(date.getTime()) ? null : date
}

const formatRecentEditLabel = (date) => {
  if (!date) return 'recently'
  const diffMs = Date.now() - date.getTime()
  if (diffMs < 60_000) return 'edited just now'
  const minutes = Math.floor(diffMs / 60_000)
  if (minutes < 60) return `${minutes} min ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours} hr ago`
  const days = Math.floor(hours / 24)
  if (days < 7) return `${days} day${days === 1 ? '' : 's'} ago`
  const weeks = Math.floor(days / 7)
  if (weeks < 5) return `${weeks} week${weeks === 1 ? '' : 's'} ago`
  const months = Math.floor(days / 30)
  if (months < 12) return `${months} month${months === 1 ? '' : 's'} ago`
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

const Header = ({ currentView, setCurrentView, isAdmin, setIsAdmin, onAddMember, onCreateMonth, onToggleAIChat }) => {
  const { preferences } = useAuth()
  const {
    searchTerm,
    setSearchTerm,
    refreshSearch,
    forceRefreshMembers,
    loading,
    dashboardTab,
    setDashboardTab,
    filteredMembers,
    attendanceData,
    currentTable,
    isSupabaseConfigured,
    badgeFilter,
    toggleBadgeFilter,
    selectedAttendanceDate,
    setAndSaveAttendanceDate,
    focusDateSelector,
    isCollaborator,
    isAdminCollaborator,
    isOnline,
    offlineModeStatus,
    offlineMode,
    setOfflineMode,
    pendingSyncCount,
    offlineCacheMeta,
    prepareOfflineData,
    isPreparingOffline,
    members
  } = useApp()
  const { selection } = useHapticFeedback()
  const [showMonthPicker, setShowMonthPicker] = useState(false)
  const [showConnectionMenu, setShowConnectionMenu] = useState(false)
  const [showRecentMenu, setShowRecentMenu] = useState(false)
  const monthButtonRef = useRef(null)
  const connectionButtonRef = useRef(null)
  const recentMenuRef = useRef(null)
  const [apkUpdateBadge, setApkUpdateBadge] = useState(() => (
    typeof window !== 'undefined' && window.localStorage.getItem('datser_apk_update_badge') === 'true'
  ))
  // Debounced search input for performance on low-end devices
  const [localSearchTerm, setLocalSearchTerm] = useState(searchTerm)

  // Keep local input in sync when external searchTerm changes (e.g., clear/search from elsewhere)
  useEffect(() => {
    setLocalSearchTerm(searchTerm)
  }, [searchTerm])

  // Debounce updates to global search term to reduce re-renders during typing
  useEffect(() => {
    const tid = setTimeout(() => {
      if (localSearchTerm !== searchTerm) {
        setSearchTerm(localSearchTerm)
      }
    }, 250)
    return () => clearTimeout(tid)
  }, [localSearchTerm])

  useEffect(() => {
    const syncApkBadge = () => {
      setApkUpdateBadge(window.localStorage.getItem('datser_apk_update_badge') === 'true')
    }
    syncApkBadge()
    window.addEventListener('datser-apk-update-badge', syncApkBadge)
    window.addEventListener('storage', syncApkBadge)
    return () => {
      window.removeEventListener('datser-apk-update-badge', syncApkBadge)
      window.removeEventListener('storage', syncApkBadge)
    }
  }, [])

  useEffect(() => {
    if (!showRecentMenu) return undefined
    const handlePointerDown = (event) => {
      if (recentMenuRef.current && !recentMenuRef.current.contains(event.target)) {
        setShowRecentMenu(false)
      }
    }
    const handleKeyDown = (event) => {
      if (event.key === 'Escape') setShowRecentMenu(false)
    }
    document.addEventListener('pointerdown', handlePointerDown)
    document.addEventListener('keydown', handleKeyDown)
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown)
      document.removeEventListener('keydown', handleKeyDown)
    }
  }, [showRecentMenu])

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

  const sundayDates = generateSundayDates(currentTable)
  const selectedDateKey = selectedAttendanceDate
    ? `${selectedAttendanceDate.getFullYear()}-${String(selectedAttendanceDate.getMonth() + 1).padStart(2, '0')}-${String(selectedAttendanceDate.getDate()).padStart(2, '0')}`
    : null
  const visibleSelectedDateKey = selectedDateKey && sundayDates.includes(selectedDateKey)
    ? selectedDateKey
    : null
  const visibleSelectedDate = visibleSelectedDateKey
    ? (() => {
      const [year, month, day] = visibleSelectedDateKey.split('-').map(Number)
      return new Date(year, month - 1, day)
    })()
    : null

  const isEditedMember = (member) => {
    // Check attendanceData map
    for (const dk of sundayDates) {
      const map = attendanceData[dk] || {}
      const val = map[member.id]
      if (val === true || val === false) return true
    }
    // Fallback: check member record columns directly
    for (const key in member) {
      const keyLower = key.toLowerCase()
      const isOldFormat = key.startsWith('Attendance ')
      const isNewFormat = /^attendance_\d{4}_\d{2}_\d{2}$/.test(keyLower)
      if (isOldFormat || isNewFormat) {
        const val = member[key]
        if (val === 'Present' || val === 'Absent' || val === true || val === false) return true
      }
    }
    return false
  }

  const perDayCounts = useMemo(() => {
    const base = dashboardTab === 'edited' ? filteredMembers.filter(isEditedMember) : filteredMembers
    const acc = {}
    for (const dateStr of sundayDates) {
      const map = attendanceData[dateStr] || {}
      let p = 0
      for (const m of base) {
        const v = map[m.id]
        if (v === true) p += 1
      }
      acc[dateStr] = p
    }
    return acc
  }, [filteredMembers, attendanceData, sundayDates, dashboardTab])

  // Compute compact summary count: respects search and dashboard tab (All/Edited)
  const compactFoundCount = useMemo(() => {
    try {
      if (!filteredMembers || filteredMembers.length === 0) return 0

      const hasSearch = !!(searchTerm && searchTerm.trim())
      if (hasSearch || dashboardTab === 'all') {
        return filteredMembers.length
      }

      if (dashboardTab === 'edited' && visibleSelectedDateKey) {
        const map = attendanceData[visibleSelectedDateKey] || {}
        return filteredMembers.filter(member => {
          const value = map[member.id]
          return value === true || value === false
        }).length
      }

      // Edited tab: member has any attendance entry (present/absent)
      return filteredMembers.filter(isEditedMember).length
    } catch {
      return filteredMembers?.length ?? 0
    }
  }, [filteredMembers, dashboardTab, attendanceData, searchTerm, sundayDates, visibleSelectedDateKey])

  // Count of edited members (has attendance marked true/false for any date)
  const editedCount = useMemo(() => {
    try {
      if (!filteredMembers || filteredMembers.length === 0) return 0
      if (visibleSelectedDateKey) {
        const map = attendanceData[visibleSelectedDateKey] || {}
        return filteredMembers.filter(member => {
          const value = map[member.id]
          return value === true || value === false
        }).length
      }
      return filteredMembers.filter(isEditedMember).length
    } catch {
      return 0
    }
  }, [filteredMembers, attendanceData, sundayDates, visibleSelectedDateKey])

  const recentEditedMembers = useMemo(() => {
    const source = Array.isArray(members) && members.length ? members : filteredMembers || []
    return source
      .map((member) => ({
        member,
        date: getMemberRecentDate(member),
        name: getMemberDisplayName(member)
      }))
      .sort((a, b) => {
        const timeA = a.date?.getTime() || 0
        const timeB = b.date?.getTime() || 0
        if (timeA !== timeB) return timeB - timeA
        return a.name.localeCompare(b.name)
      })
      .slice(0, 6)
  }, [members, filteredMembers])

  const focusRecentMember = useCallback((member) => {
    const name = getMemberDisplayName(member)
    selection()
    setCurrentView('dashboard')
    setSearchTerm(name)
    setLocalSearchTerm(name)
    setShowRecentMenu(false)
  }, [selection, setCurrentView, setSearchTerm])

  const isConnectionLive = isOnline && offlineModeStatus !== 'offline' && offlineModeStatus !== 'forced-offline' && offlineModeStatus !== 'online-unavailable'
  const connectionLabel = isSupabaseConfigured()
    ? (isConnectionLive ? 'Online' : offlineMode === 'offline' ? 'Offline' : 'Offline')
    : 'Demo'
  const connectionToneClass = isSupabaseConfigured()
    ? isConnectionLive
      ? 'text-green-700 dark:text-green-300 border-green-300 dark:border-green-700 bg-green-50 dark:bg-green-900/30'
      : 'text-red-700 dark:text-red-300 border-red-300 dark:border-red-700 bg-red-50 dark:bg-red-900/30'
    : 'text-yellow-700 dark:text-yellow-300 border-yellow-300 dark:border-yellow-700 bg-yellow-50 dark:bg-yellow-900/30'
  const mobileStatusBarEnabled = preferences?.mobile_dashboard_status_enabled !== false
  const visibleDateLabel = visibleSelectedDate
    ? visibleSelectedDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
    : null
  const monthLabel = currentTable ? currentTable.replace('_', ' ') : 'Select Month'

  const recentButton = (extraClass = '', compact = false) => (
    <div ref={recentMenuRef} className={`relative ${extraClass}`}>
      <button
        type="button"
        onClick={() => {
          selection()
          setShowRecentMenu((value) => !value)
        }}
        className={`inline-flex items-center gap-1.5 rounded-full font-semibold whitespace-nowrap transition-colors ${
          compact ? 'px-2 py-1.5' : 'px-2.5 py-1'
        } ${
          showRecentMenu
            ? 'bg-gray-900/10 text-gray-900 dark:bg-white/10 dark:text-white'
            : 'text-gray-700 hover:bg-gray-200/80 dark:text-gray-200 dark:hover:bg-white/10'
        }`}
        title="Recent updates"
        aria-expanded={showRecentMenu}
      >
        <History className="h-3.5 w-3.5" />
        <span className={compact ? 'sr-only' : ''}>Recent</span>
        <ChevronDown className={`${compact ? 'h-3 w-3' : 'h-3.5 w-3.5'} transition-transform ${showRecentMenu ? 'rotate-180' : ''}`} />
      </button>
    </div>
  )

  useEffect(() => {
    if (typeof document === 'undefined') return undefined
    const root = document.documentElement
    root.style.setProperty('--app-dashboard-header-height-mobile', mobileStatusBarEnabled ? '126px' : '86px')
    return () => {
      root.style.removeProperty('--app-dashboard-header-height-mobile')
    }
  }, [mobileStatusBarEnabled])

  // Menu items moved to LoginButton profile dropdown

  return (
    <header className="bg-white dark:bg-gray-800 shadow-sm md:border-b border-gray-200 dark:border-gray-700 z-[55] w-full app-header-safe safe-area-x fixed top-0 left-0 right-0">
      <div className="mx-auto px-3 sm:px-4 md:px-6 lg:px-8 py-0 md:py-1 w-full">
        <div className="flex items-center justify-center md:justify-between min-h-[36px] md:min-h-[44px]">
          {/* Compact brand mark for the website header. The detailed app icon stays for PWA/Android. */}
          <div className="hidden items-center md:flex">
            <button
              onClick={() => { selection(); setCurrentView('dashboard'); setDashboardTab('all') }}
              className="inline-flex h-9 items-center gap-2 rounded-xl px-2 text-gray-900 transition-colors hover:bg-gray-100 active:scale-95 dark:text-white dark:hover:bg-gray-700"
              title="Go to Dashboard"
              aria-label="Go to DatSer dashboard"
            >
              <span className="grid h-7 w-7 place-items-center rounded-lg bg-orange-600 text-white shadow-sm shadow-orange-950/20 ring-1 ring-orange-400/30">
                <Database className="h-4 w-4" strokeWidth={2.5} />
              </span>
              <span className="text-sm font-black tracking-tight">DatSer</span>
            </button>
          </div>

          {/* Center Area - Desktop Navigation */}
          <div className="hidden md:flex items-center flex-1 justify-between mx-2 lg:mx-4">
            {/* Left: Main Navigation Links */}
            <nav className="flex items-center gap-1">
              {/* Home/Dashboard */}
              <button
                onClick={() => { selection(); setCurrentView('dashboard'); setDashboardTab('all') }}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${currentView === 'dashboard' && dashboardTab === 'all'
                  ? 'bg-primary-100 dark:bg-primary-900 text-primary-700 dark:text-primary-300'
                  : 'text-gray-600 dark:text-gray-300 hover:text-gray-900 dark:hover:text-white hover:bg-gray-100 dark:hover:bg-gray-700'
                  }`}
              >
                <Users className="w-4 h-4" />
                <span>Members</span>
              </button>

              {/* Marked - Quick access */}
              <button
                onClick={() => { selection(); setCurrentView('dashboard'); setDashboardTab('edited') }}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${currentView === 'dashboard' && dashboardTab === 'edited'
                  ? 'bg-primary-100 dark:bg-primary-900 text-primary-700 dark:text-primary-300'
                  : 'text-gray-600 dark:text-gray-300 hover:text-gray-900 dark:hover:text-white hover:bg-gray-100 dark:hover:bg-gray-700'
                  }`}
              >
                <CheckSquare className="w-4 h-4" />
                <span>Marked</span>
                {editedCount > 0 && (
                  <span className="ml-1 px-1.5 py-0.5 text-xs bg-orange-100 dark:bg-orange-900 text-orange-700 dark:text-orange-300 rounded-full">
                    {editedCount}
                  </span>
                )}
              </button>

              {/* Admin Panel */}
              <button
                onClick={() => { selection(); setCurrentView('admin') }}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${currentView === 'admin'
                  ? 'bg-primary-100 dark:bg-primary-900 text-primary-700 dark:text-primary-300'
                  : 'text-gray-600 dark:text-gray-300 hover:text-gray-900 dark:hover:text-white hover:bg-gray-100 dark:hover:bg-gray-700'
                  }`}
              >
                <TrendingUp className="w-4 h-4" />
                <span>Admin</span>
              </button>
            </nav>

            {/* Right: Help + Profile + Menu */}
            <div className="flex items-center gap-2">
              {/* Quick Attendance Access Button removed */}

              {/* Help/Settings Button */}
              <button
                onClick={() => { selection(); setCurrentView('settings') }}
                className="relative p-2 rounded-lg text-gray-400 hover:text-orange-500 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
                title="Settings"
              >
                <HelpCircle className="w-4 h-4" />
                {(window.__needsPasswordSetup || apkUpdateBadge) && (
                  <span className="absolute -top-0.5 -right-0.5 inline-flex items-center justify-center h-3.5 min-w-3.5 px-0.5 rounded-full bg-red-500 text-white text-[8px] font-bold">
                    {(window.__needsPasswordSetup ? 1 : 0) + (apkUpdateBadge ? 1 : 0)}
                  </span>
                )}
              </button>

              {/* Profile/Login Button - now contains all menu options */}
              <LoginButton
                onCreateMonth={onCreateMonth}
                onToggleAIChat={onToggleAIChat}
                setCurrentView={setCurrentView}
                setDashboardTab={setDashboardTab}
                currentView={currentView}
                dashboardTab={dashboardTab}
              />
            </div>
          </div>
        </div>

        {/* Mobile Navigation */}
        <div className="md:hidden py-0">
          <div className="flex items-center justify-between">
            {/* Left: Quick nav */}
            <div className="flex items-center gap-1">
              <button
                onClick={() => {
                  selection()
                  setCurrentView('dashboard');
                  setDashboardTab('all');
                }}
                className={`flex items-center gap-1.5 px-2 py-1.5 rounded-lg text-sm font-medium transition-colors ${currentView === 'dashboard' && dashboardTab === 'all'
                  ? 'bg-primary-100 dark:bg-primary-900 text-primary-700 dark:text-primary-300'
                  : 'text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700'
                  }`}
                title="Members"
              >
                <span className={`grid h-5 w-5 shrink-0 place-items-center rounded-md ${currentView === 'dashboard' && dashboardTab === 'all' ? 'bg-orange-600 text-white' : 'bg-orange-500/12 text-orange-500'}`}>
                  <Database className="h-3.5 w-3.5" strokeWidth={2.5} />
                </span>
                <span>Members</span>
              </button>
              <button
                onClick={() => { selection(); setCurrentView('dashboard'); setDashboardTab('edited') }}
                className={`flex items-center gap-1.5 px-2 py-1.5 rounded-lg text-sm font-medium transition-colors ${currentView === 'dashboard' && dashboardTab === 'edited'
                  ? 'bg-primary-100 dark:bg-primary-900 text-primary-700 dark:text-primary-300'
                  : 'text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700'
                  }`}
                title="Marked"
              >
                <CheckSquare className="w-4 h-4" />
                <span>Marked</span>
                {editedCount > 0 && (
                  <span className="ml-1 px-1.5 py-0.5 text-[10px] bg-orange-100 dark:bg-orange-900 text-orange-700 dark:text-orange-300 rounded-full">
                    {editedCount}
                  </span>
                )}
              </button>
              {!mobileStatusBarEnabled && currentView === 'dashboard' && recentButton('', true)}
            </div>

            {/* Right: Profile (contains all menu options) */}
            <div className="flex items-center">
              <LoginButton
                onCreateMonth={onCreateMonth}
                onToggleAIChat={onToggleAIChat}
                setCurrentView={setCurrentView}
                setDashboardTab={setDashboardTab}
                currentView={currentView}
                dashboardTab={dashboardTab}
                compactStatus={!mobileStatusBarEnabled && currentView === 'dashboard' ? {
                  dateLabel: visibleDateLabel,
                  foundCount: (!isCollaborator || isAdminCollaborator) ? compactFoundCount : null,
                  monthLabel,
                  connectionLabel,
                  connectionToneClass,
                  isSupabaseConfigured: isSupabaseConfigured(),
                  isConnectionLive,
                  onOpenMonthPicker: () => setShowMonthPicker(true),
                  onOpenConnectionMenu: () => setShowConnectionMenu(true)
                } : null}
              />
            </div>
          </div>
        </div>
      </div>
      {/* Summary pill - info bar */}
      {currentView === 'dashboard' && (
        <div className={`${mobileStatusBarEnabled ? '' : 'hidden md:block'} md:border-t border-gray-200 dark:border-gray-700`}>
          <div className="mx-auto px-3 pb-2 pt-1.5 sm:px-4 md:py-1">
            <div className="dashboard-status-pill no-scrollbar flex w-full max-w-full flex-wrap items-center justify-center gap-x-1 gap-y-1 overflow-visible rounded-[1.35rem] bg-white/82 px-2.5 py-2 text-[10.5px] leading-none text-gray-700 shadow-sm ring-1 ring-gray-200/80 backdrop-blur-xl dark:bg-[#202121]/88 dark:text-gray-300 dark:ring-white/10 sm:w-fit sm:mx-auto sm:gap-x-1.5 sm:rounded-full sm:px-4 sm:text-sm md:flex-nowrap md:overflow-x-auto md:py-1.5">
              {recentButton('shrink-0')}

              {(visibleSelectedDate || (!isCollaborator || isAdminCollaborator)) && (
                <span className="text-gray-400/80">&middot;</span>
              )}
              {visibleSelectedDate && (
                <>
                  <span className="inline-flex items-center font-medium whitespace-nowrap">
                    {visibleDateLabel}
                  </span>
                  <span className="text-gray-400/80">&middot;</span>
                </>
              )}

              {/* Only show count for admins/owners, hide for collaborators if requested */}
              {(!isCollaborator || isAdminCollaborator) && (
                <>
                  <span className="inline-flex items-center font-medium whitespace-nowrap">{compactFoundCount} found</span>
                  <span className="text-gray-400/80">&middot;</span>
                </>
              )}

              <button
                ref={monthButtonRef}
                onClick={() => { selection(); setShowMonthPicker(true) }}
                className="inline-flex items-center gap-1 text-orange-600 dark:text-orange-400 hover:text-orange-700 dark:hover:text-orange-300 font-semibold whitespace-nowrap transition-colors"
                title={isCollaborator ? "Click to switch month" : "Select Month"}
              >
                {monthLabel}
                <ChevronDown className="w-3.5 h-3.5" />
              </button>

              <button
                ref={connectionButtonRef}
                type="button"
                onClick={() => { selection(); setShowConnectionMenu(prev => !prev) }}
                className={`relative inline-flex items-center gap-1 px-1.5 py-1 text-[10.5px] sm:gap-1.5 sm:px-2 sm:text-xs font-semibold whitespace-nowrap rounded-full border transition-colors hover:brightness-105 md:-ml-0.5 ${connectionToneClass}`}
                title="Connection and offline mode"
              >
                {isSupabaseConfigured()
                  ? isConnectionLive
                    ? <Wifi className="h-3.5 w-3.5 animate-pulse" />
                    : <WifiOff className="h-3.5 w-3.5 animate-pulse" />
                  : <WifiOff className="h-3.5 w-3.5 text-yellow-500" />}
                <span>{connectionLabel}</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {showRecentMenu && currentView === 'dashboard' && (
        <div
          className="fixed inset-0 z-[85] flex items-center justify-center bg-black/55 px-4 py-8 backdrop-blur-sm animate-fade-in"
          onClick={() => setShowRecentMenu(false)}
        >
          <div
            ref={recentMenuRef}
            className="relative w-[min(92vw,390px)] overflow-hidden rounded-3xl border border-gray-200 bg-white/95 text-left shadow-2xl shadow-black/30 backdrop-blur-xl animate-scale-in dark:border-white/10 dark:bg-[#202121]/95"
            onClick={(event) => event.stopPropagation()}
          >
            <button
              type="button"
              onClick={() => setShowRecentMenu(false)}
              className="absolute right-3 top-3 grid h-9 w-9 place-items-center rounded-full text-gray-400 transition hover:bg-gray-100 hover:text-gray-700 dark:hover:bg-white/10 dark:hover:text-white"
              aria-label="Close recent edits"
            >
              <X className="h-4 w-4" />
            </button>

            <div className="border-b border-gray-200/70 px-5 py-4 pr-14 dark:border-white/10">
              <div className="flex items-center gap-3">
                <div className="grid h-10 w-10 place-items-center rounded-2xl border border-orange-300/70 bg-orange-500/10 text-orange-600 shadow-sm backdrop-blur-md dark:border-orange-400/30 dark:bg-orange-400/10 dark:text-orange-300">
                  <History className="h-5 w-5" />
                </div>
                <div>
                  <p className="text-base font-bold text-gray-900 dark:text-white">Recent Edits</p>
                  <p className="mt-0.5 text-xs font-medium text-gray-500 dark:text-gray-400">Latest names changed in this workspace</p>
                </div>
              </div>
            </div>

            <div className="max-h-[min(65vh,420px)] overflow-y-auto overscroll-contain p-2">
              {recentEditedMembers.length > 0 ? (
                recentEditedMembers.map(({ member, date, name }) => (
                  <button
                    key={member.id || name}
                    type="button"
                    onClick={() => focusRecentMember(member)}
                    className="flex w-full items-center gap-3 rounded-2xl px-3 py-3 text-left transition-colors hover:bg-gray-100/80 focus:bg-gray-100/80 focus:outline-none dark:hover:bg-white/10 dark:focus:bg-white/10"
                  >
                    <span className="grid h-10 w-10 shrink-0 place-items-center rounded-2xl bg-orange-500/10 text-sm font-black text-orange-700 dark:bg-orange-400/10 dark:text-orange-300">
                      {name.charAt(0).toUpperCase()}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-bold text-gray-900 dark:text-white">{name}</span>
                      <span className="mt-0.5 block truncate text-xs text-gray-500 dark:text-gray-400">{formatRecentEditLabel(date)}</span>
                    </span>
                    <ChevronRight className="h-5 w-5 shrink-0 text-gray-400 dark:text-gray-300" />
                  </button>
                ))
              ) : (
                <div className="px-4 py-8 text-center text-sm font-medium text-gray-500 dark:text-gray-400">No recent edits yet</div>
              )}
            </div>
          </div>
        </div>
      )}

      {showConnectionMenu && currentView === 'dashboard' && (
        <div
          className="fixed inset-0 z-[80] flex items-center justify-center bg-black/60 px-4 py-8 backdrop-blur-sm animate-fade-in"
          onClick={() => setShowConnectionMenu(false)}
        >
          <div
            className="relative w-[min(92vw,380px)] rounded-3xl border border-gray-200 bg-white/95 p-4 shadow-2xl shadow-black/30 backdrop-blur-xl animate-scale-in dark:border-white/10 dark:bg-[#202121]/95"
            onClick={(event) => event.stopPropagation()}
          >
            <button
              type="button"
              onClick={() => setShowConnectionMenu(false)}
              className="absolute right-3 top-3 grid h-9 w-9 place-items-center rounded-full text-gray-400 transition hover:bg-gray-100 hover:text-gray-700 dark:hover:bg-white/10 dark:hover:text-white"
              aria-label="Close connection mode"
            >
              <X className="h-4 w-4" />
            </button>

            <div className="mb-4 px-8 text-center">
              <p className="text-base font-bold text-gray-900 dark:text-white">Connection Mode</p>
              <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
                {isConnectionLive ? 'Wi-Fi/internet is available.' : 'You are using offline-safe mode.'}
              </p>
            </div>
            <div className="grid grid-cols-3 gap-2">
              {[
                { id: 'auto', label: 'Auto' },
                { id: 'online', label: 'Online' },
                { id: 'offline', label: 'Offline' }
              ].map((mode) => (
                <button
                  key={mode.id}
                  type="button"
                  onClick={() => {
                    setOfflineMode(mode.id)
                    setShowConnectionMenu(false)
                  }}
                  className={`min-h-[42px] rounded-xl border text-sm font-bold transition-colors ${
                    offlineMode === mode.id
                      ? 'border-orange-500 bg-orange-500 text-white shadow-sm'
                      : 'border-gray-200 bg-gray-50 text-gray-700 hover:border-orange-300 dark:border-white/10 dark:bg-white/5 dark:text-gray-200'
                  }`}
                >
                  {mode.label}
                </button>
              ))}
            </div>
            <div className="mt-3 grid grid-cols-2 gap-2 text-xs">
              <div className="rounded-xl border border-gray-200 bg-gray-50 p-3 dark:border-white/10 dark:bg-white/5">
                <p className="font-bold text-gray-900 dark:text-white">Recent cache</p>
                <p className="mt-1 text-gray-500 dark:text-gray-400">{offlineCacheMeta?.cached_at ? new Date(offlineCacheMeta.cached_at).toLocaleDateString() : 'Not downloaded'}</p>
              </div>
              <div className="rounded-xl border border-gray-200 bg-gray-50 p-3 dark:border-white/10 dark:bg-white/5">
                <p className="font-bold text-gray-900 dark:text-white">Pending</p>
                <p className="mt-1 text-gray-500 dark:text-gray-400">{pendingSyncCount || 0} change{pendingSyncCount === 1 ? '' : 's'}</p>
              </div>
            </div>
            <button
              type="button"
              onClick={prepareOfflineData}
              disabled={isPreparingOffline || !isOnline}
              className="mt-3 flex min-h-[42px] w-full items-center justify-center gap-2 rounded-xl bg-orange-600 px-4 text-sm font-bold text-white shadow-sm transition-colors hover:bg-orange-700 disabled:bg-gray-300 disabled:text-white/80 dark:disabled:bg-gray-700"
            >
              {isPreparingOffline ? <RefreshCw className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
              {isPreparingOffline ? 'Downloading...' : 'Download recent data'}
            </button>
          </div>
        </div>
      )}

      {/* Month Picker Popup */}
      <MonthPickerPopup
        isOpen={showMonthPicker}
        onClose={() => setShowMonthPicker(false)}
        anchorRef={monthButtonRef}
        onCreateMonth={onCreateMonth}
      />
      {/* Badge filter popup removed; badge chips now render on the Edited page */}
    </header>
  )
}

export default memo(Header)

