import React, { useState, useEffect, useMemo, useRef, memo, useCallback } from 'react'
import {
  Users,
  CheckSquare,
  ChevronDown,
  HelpCircle,
  TrendingUp,
  Wifi,
  WifiOff
} from 'lucide-react'
import MonthPickerPopup from './MonthPickerPopup'
import { useApp } from '../context/AppContext'
import LoginButton from './LoginButton'
import useHapticFeedback from '../hooks/useHapticFeedback'

const Header = ({ currentView, setCurrentView, isAdmin, setIsAdmin, onAddMember, onCreateMonth, onToggleAIChat }) => {
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
    ownerStickyMonth,
    isOnline,
    offlineModeStatus
  } = useApp()
  const { selection } = useHapticFeedback()
  const [showMonthPicker, setShowMonthPicker] = useState(false)
  const monthButtonRef = useRef(null)
  const [liveClock, setLiveClock] = useState(() => new Date())
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
    const timer = setInterval(() => setLiveClock(new Date()), 30000)
    return () => clearInterval(timer)
  }, [])

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
  const isCalendarLive = currentTable === currentMonthTable && visibleSelectedDateKey === liveSundayDateKey
  const hasStickyMonth = Boolean(ownerStickyMonth)
  const isStickyMonthLive = isCollaborator && hasStickyMonth && currentTable === ownerStickyMonth
  const isStickyMonthMismatch = isCollaborator && hasStickyMonth && currentTable !== ownerStickyMonth
  const showStickyState = !isCollaborator || !hasStickyMonth || isStickyMonthLive
  const showLiveState = showStickyState && isCalendarLive
  const liveLabel = isSupabaseConfigured()
    ? (isStickyMonthMismatch ? 'Out of Sync' : (isCalendarLive ? 'Live' : 'Live Off'))
    : 'Demo'
  const isConnectionLive = isOnline && offlineModeStatus !== 'offline' && offlineModeStatus !== 'forced-offline' && offlineModeStatus !== 'online-unavailable'

  // Menu items moved to LoginButton profile dropdown

  return (
    <header className="bg-white dark:bg-gray-800 shadow-sm md:border-b border-gray-200 dark:border-gray-700 z-[55] w-full app-header-safe safe-area-x fixed top-0 left-0 right-0">
      <div className="mx-auto px-3 sm:px-4 md:px-6 lg:px-8 py-0 md:py-1 w-full">
        <div className="flex items-center justify-center md:justify-between min-h-[36px] md:min-h-[44px]">
          {/* Compact brand label */}
          <div className="flex items-center">
            <button
              onClick={() => { selection(); setCurrentView('dashboard'); setDashboardTab('all') }}
              className="text-xs sm:text-sm font-bold text-gray-900 dark:text-white hover:underline"
              title="Go to Dashboard"
            >
              Datser
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
                {window.__needsPasswordSetup && (
                  <span className="absolute -top-0.5 -right-0.5 inline-flex items-center justify-center h-3.5 min-w-3.5 px-0.5 rounded-full bg-red-500 text-white text-[8px] font-bold">
                    1
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
                <Users className="w-4 h-4" />
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
              />
            </div>
          </div>
        </div>
      </div>
      {/* Summary pill - info bar */}
      {currentView === 'dashboard' && (
        <div className="md:border-t border-gray-200 dark:border-gray-700">
          <div className="mx-auto px-3 sm:px-4 py-1.5 md:py-1">
            <div className="flex flex-wrap items-center justify-center gap-x-2 gap-y-1.5 px-4 py-1.5 rounded-full bg-gray-100/95 dark:bg-gray-700/95 text-xs sm:text-sm leading-none text-gray-700 dark:text-gray-300 shadow-sm w-fit mx-auto">
              {visibleSelectedDate && (
                <>
                  <span className="inline-flex items-center font-medium whitespace-nowrap">
                    {visibleSelectedDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                  </span>
                  <span className="text-gray-400/80">•</span>
                </>
              )}

              {/* Only show count for admins/owners, hide for collaborators if requested */}
              {(!isCollaborator || isAdminCollaborator) && (
                <>
                  <span className="inline-flex items-center font-medium whitespace-nowrap">{compactFoundCount} found</span>
                  <span className="text-gray-400/80">•</span>
                </>
              )}

              <button
                ref={monthButtonRef}
                onClick={() => { selection(); setShowMonthPicker(true) }}
                className="inline-flex items-center gap-1 text-orange-600 dark:text-orange-400 hover:text-orange-700 dark:hover:text-orange-300 font-semibold whitespace-nowrap transition-colors"
                title={isCollaborator ? "Click to switch month" : "Select Month"}
              >
                {currentTable ? currentTable.replace('_', ' ') : 'Select Month'}
                <ChevronDown className="w-3.5 h-3.5" />
              </button>

              <span className={`inline-flex items-center gap-1.5 -ml-0.5 px-2 py-1 text-[11px] sm:text-xs font-semibold whitespace-nowrap rounded-full border ${isSupabaseConfigured()
                ? isConnectionLive && showLiveState
                  ? 'text-green-700 dark:text-green-300 border-green-300 dark:border-green-700 bg-green-50 dark:bg-green-900/30'
                  : 'text-red-700 dark:text-red-300 border-red-300 dark:border-red-700 bg-red-50 dark:bg-red-900/30 animate-pulse'
                : 'text-yellow-700 dark:text-yellow-300 border-yellow-300 dark:border-yellow-700 bg-yellow-50 dark:bg-yellow-900/30'
                }`}>
                {isSupabaseConfigured()
                  ? isConnectionLive && showLiveState
                    ? <Wifi className="h-3.5 w-3.5 animate-pulse" />
                    : <WifiOff className="h-3.5 w-3.5 animate-pulse" />
                  : <WifiOff className="h-3.5 w-3.5 text-yellow-500" />}
                <span>{liveLabel}</span>
              </span>
            </div>
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

