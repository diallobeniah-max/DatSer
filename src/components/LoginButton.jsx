import React, { useState, useEffect, useRef, memo, useCallback } from 'react'
import {
  LogIn,
  LogOut,
  User,
  ChevronLeft,
  Moon,
  Sun,
  Settings,
  Building2,
  Download,
  Trash2,
  HelpCircle,
  Lock,
  Bell,
  Shield,
  X,
  Users,
  CheckSquare,
  TrendingUp,
  Calendar,
  Sparkles,
  Copy,
  Wifi,
  WifiOff,
  RefreshCw
} from 'lucide-react'
import { useAuth } from '../context/AuthContext'
import { useTheme } from '../context/ThemeContext'
import { useApp } from '../context/AppContext'
import { toast } from 'react-toastify'
import useHapticFeedback from '../hooks/useHapticFeedback'

const LoginButton = ({ onCreateMonth, onToggleAIChat, setCurrentView, setDashboardTab, currentView, dashboardTab, compactStatus = null }) => {
  const { user, loading, signInWithGoogle, signOut, isAuthenticated, preferences } = useAuth()
  const { isDarkMode, toggleTheme } = useTheme()
  const { members, currentTable, filteredMembers, attendanceData } = useApp()
  const { selection } = useHapticFeedback()
  const [showDropdown, setShowDropdown] = useState(false)
  const [shouldRender, setShouldRender] = useState(false)
  const [isTransitioning, setIsTransitioning] = useState(false)
  const [isSigningIn, setIsSigningIn] = useState(false)
  const dropdownRef = useRef(null)

  // Handle drawer transition states
  useEffect(() => {
    let timer
    if (showDropdown) {
      setShouldRender(true)
      timer = setTimeout(() => {
        setIsTransitioning(true)
      }, 10)
    } else {
      setIsTransitioning(false)
      timer = setTimeout(() => {
        setShouldRender(false)
      }, 300)
    }
    return () => clearTimeout(timer)
  }, [showDropdown])

  // Count edited members
  const editedCount = React.useMemo(() => {
    try {
      if (!filteredMembers || filteredMembers.length === 0) return 0
      const dateKeys = Object.keys(attendanceData || {})
      if (dateKeys.length === 0) return 0
      let count = 0
      for (const member of filteredMembers) {
        let isEdited = false
        for (const dk of dateKeys) {
          const map = attendanceData[dk] || {}
          const val = map[member.id]
          if (val === true || val === false) { isEdited = true; break }
        }
        if (isEdited) count += 1
      }
      return count
    } catch {
      return 0
    }
  }, [filteredMembers, attendanceData])

  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (event) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target)) {
        setShowDropdown(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  const handleSignIn = useCallback(async () => {
    selection()
    setIsSigningIn(true)
    try {
      await signInWithGoogle()
    } catch (error) {
      console.error('Sign in error:', error)
    } finally {
      setIsSigningIn(false)
    }
  }, [selection, signInWithGoogle])

  const handleSignOut = useCallback(async () => {
    selection()
    setShowDropdown(false)
    try {
      await signOut()
    } catch (error) {
      console.error('Sign out error:', error)
    }
  }, [selection, signOut])

  if (loading) {
    return (
      <div className="w-8 h-8 rounded-full bg-gray-200 dark:bg-gray-700 animate-pulse" />
    )
  }

  if (!isAuthenticated) {
    return (
      <button
        onClick={handleSignIn}
        disabled={isSigningIn}
        className="flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium transition-colors bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 hover:bg-gray-50 dark:hover:bg-gray-600 text-gray-700 dark:text-gray-200"
      >
        {isSigningIn ? (
          <div className="w-4 h-4 border-2 border-gray-400 border-t-transparent rounded-full animate-spin" />
        ) : (
          <>
            <svg className="w-4 h-4" viewBox="0 0 24 24">
              <path
                fill="#4285F4"
                d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
              />
              <path
                fill="#34A853"
                d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
              />
              <path
                fill="#FBBC05"
                d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
              />
              <path
                fill="#EA4335"
                d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
              />
            </svg>
            <span className="hidden sm:inline">Sign in</span>
          </>
        )}
      </button>
    )
  }

  // User is authenticated - show profile dropdown
  const localAvatar = typeof window !== 'undefined' ? localStorage.getItem('user_avatar_url') : null
  const userPhoto = localAvatar || user?.user_metadata?.avatar_url || user?.user_metadata?.picture || user?.identities?.[0]?.identity_data?.avatar_url || user?.identities?.[0]?.identity_data?.picture
  const userName = user?.user_metadata?.full_name || user?.user_metadata?.name || user?.email?.split('@')[0]
  const workspaceName = preferences?.workspace_name || 'My Workspace'

  return (
    <div className={`relative ${shouldRender ? 'z-[151]' : 'z-[60]'}`} ref={dropdownRef}>
      <button
        onClick={() => { selection(); setShowDropdown(!showDropdown) }}
        className="flex items-center gap-2 px-2 py-1 rounded-lg transition-colors hover:bg-gray-100 dark:hover:bg-gray-700"
      >
        {userPhoto ? (
          <img
            src={userPhoto}
            alt={userName}
            className="w-10 h-10 md:w-8 md:h-8 rounded-full object-cover aspect-square border-2 border-primary-500"
          />
        ) : (
          <div className="w-10 h-10 md:w-8 md:h-8 rounded-full aspect-square bg-primary-500 flex items-center justify-center text-white font-semibold text-base md:text-sm">
            {userName?.charAt(0)?.toUpperCase() || 'U'}
          </div>
        )}
        <span className="hidden md:inline text-sm font-medium text-gray-700 dark:text-gray-200 max-w-[100px] truncate">
          {userName}
        </span>
        <ChevronLeft className={`w-4 h-4 text-gray-500 transition-transform ${showDropdown ? 'rotate-180' : ''}`} />
      </button>

      {/* Professional Profile Dropdown */}
      {shouldRender && (
        <>
          {/* Backdrop */}
          <div
            className={`fixed inset-0 z-[150] drawer-backdrop-transition ${
              isTransitioning
                ? 'bg-black/40 backdrop-blur-sm'
                : 'bg-transparent backdrop-blur-none pointer-events-none'
            }`}
            onClick={() => setShowDropdown(false)}
          />

          <div
            className={`fixed inset-y-0 right-0 w-[85vw] sm:w-80 md:w-[360px] z-[151] border-y-0 border-l border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 shadow-2xl overflow-hidden drawer-panel-transition flex flex-col ${
              isTransitioning
                ? 'translate-x-0 opacity-100'
                : 'translate-x-full opacity-0'
            }`}
          >

            {/* Header with Close Button */}
            <div className="mobile-panel-header-safe flex items-center justify-between px-4 pb-3 border-b border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800">
              <h2 className="text-lg font-semibold text-gray-900 dark:text-white">Profile</h2>
              <button
                onClick={() => { selection(); setShowDropdown(false) }}
                className="p-2 rounded-full hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
              >
                <X className="w-5 h-5 text-gray-500" />
              </button>
            </div>

            {/* User Profile Section */}
            <div className="px-4 py-4 bg-gradient-to-r from-primary-50 to-orange-50 dark:from-gray-800 dark:to-gray-750 border-b border-gray-200 dark:border-gray-700">
              <div className="flex items-center gap-3">
                {userPhoto ? (
                  <img
                    src={userPhoto}
                    alt={userName}
                    className="w-14 h-14 md:w-12 md:h-12 rounded-full object-cover aspect-square border-2 border-white shadow-sm"
                  />
                ) : (
                  <div className="w-14 h-14 md:w-12 md:h-12 rounded-full aspect-square bg-primary-500 flex items-center justify-center text-white font-bold text-xl md:text-lg shadow-sm">
                    {userName?.charAt(0)?.toUpperCase() || 'U'}
                  </div>
                )}
                <div className="flex-1 min-w-0">
                  <p className="text-base md:text-sm font-semibold text-gray-900 dark:text-white truncate">
                    {userName}
                  </p>
                  <p className="text-sm md:text-xs text-gray-500 dark:text-gray-400 truncate">
                    {user?.email}
                  </p>
                  <p className="text-sm md:text-xs text-primary-600 dark:text-primary-400 truncate mt-0.5">
                    {workspaceName}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    selection()
                    setShowDropdown(false)
                    if (window.openSettings) window.openSettings()
                  }}
                  className="relative inline-flex h-11 min-w-11 items-center justify-center gap-2 rounded-2xl border border-orange-200 bg-white/80 px-3 text-sm font-bold text-orange-700 shadow-sm transition hover:bg-orange-50 dark:border-orange-400/25 dark:bg-white/10 dark:text-orange-200 dark:hover:bg-white/15"
                  aria-label="Open Settings"
                >
                  <Settings className="h-5 w-5" />
                  <span className="hidden sm:inline">Settings</span>
                  {window.__needsPasswordSetup && (
                    <span className="absolute -mr-9 -mt-8 inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-red-500 px-1 text-xs font-bold text-white">
                      1
                    </span>
                  )}
                </button>
              </div>
            </div>

            {compactStatus && (
              <div className="border-b border-gray-200 bg-white px-4 py-3 dark:border-gray-700 dark:bg-gray-800">
                <div className="mb-2 flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-[11px] font-bold uppercase tracking-wide text-gray-500 dark:text-gray-400">Live dashboard</p>
                    <p className="mt-0.5 truncate text-xs text-gray-500 dark:text-gray-400">
                      {compactStatus.monthLabel}
                      {compactStatus.foundCount !== null ? ` • ${compactStatus.foundCount} found` : ''}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={async () => {
                      selection()
                      await compactStatus.onRefresh?.()
                    }}
                    disabled={compactStatus.isSyncing}
                    className={`inline-flex min-h-9 shrink-0 items-center gap-1.5 rounded-full border px-3 text-xs font-black transition hover:brightness-105 disabled:cursor-wait disabled:opacity-75 ${compactStatus.syncToneClass || 'border-gray-200 bg-gray-50 text-gray-800 dark:border-white/10 dark:bg-white/5 dark:text-gray-100'}`}
                  >
                    <RefreshCw className={`h-3.5 w-3.5 ${compactStatus.isSyncing ? 'animate-spin' : ''}`} />
                    {compactStatus.isSyncing ? 'Syncing' : (compactStatus.syncLabel || 'Refresh')}
                  </button>
                </div>
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                  <button
                    type="button"
                    onClick={() => {
                      selection()
                      setShowDropdown(false)
                      compactStatus.onOpenMonthPicker?.()
                    }}
                    className="rounded-2xl border border-orange-200 bg-orange-50/80 px-3 py-2 text-left text-xs font-bold text-orange-700 transition hover:bg-orange-100 dark:border-orange-400/20 dark:bg-orange-500/10 dark:text-orange-200"
                  >
                    <span className="block text-[10px] font-black uppercase text-orange-500/80 dark:text-orange-300/80">Month</span>
                    <span className="block truncate">{compactStatus.monthLabel}</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      selection()
                      setShowDropdown(false)
                      compactStatus.onOpenConnectionMenu?.()
                    }}
                    className={`rounded-2xl border px-3 py-2 text-left text-xs font-bold transition hover:brightness-105 ${compactStatus.connectionToneClass}`}
                  >
                    <span className="mb-1 flex items-center gap-1 text-[10px] font-black uppercase opacity-80">
                      {compactStatus.isSupabaseConfigured
                        ? compactStatus.isConnectionLive
                          ? <Wifi className="h-3.5 w-3.5" />
                          : <WifiOff className="h-3.5 w-3.5" />
                        : <WifiOff className="h-3.5 w-3.5" />}
                      Connection
                    </span>
                    <span className="block truncate">{compactStatus.connectionLabel}</span>
                  </button>
                  {compactStatus.dateLabel && (
                    <div className="rounded-2xl border border-gray-200 bg-gray-50 px-3 py-2 text-xs font-bold text-gray-800 dark:border-white/10 dark:bg-white/5 dark:text-gray-100">
                      <span className="block text-[10px] font-black uppercase text-gray-500 dark:text-gray-400">Date</span>
                      {compactStatus.dateLabel}
                    </div>
                  )}
                  {compactStatus.foundCount !== null && (
                    <div className="rounded-2xl border border-gray-200 bg-gray-50 px-3 py-2 text-xs font-bold text-gray-800 dark:border-white/10 dark:bg-white/5 dark:text-gray-100">
                      <span className="block text-[10px] font-black uppercase text-gray-500 dark:text-gray-400">Total</span>
                      {compactStatus.foundCount} found
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* Navigation Section */}
            <div className="flex-1 px-3 md:px-2 py-3 md:py-2 border-b border-gray-200 dark:border-gray-700 overflow-y-auto">
              {/* Section: Views */}
              <div className="mb-3">
                <p className="px-3 py-1 text-[11px] font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">Views</p>
                <button
                  onClick={() => { selection(); setShowDropdown(false); setCurrentView?.('dashboard'); setDashboardTab?.('all') }}
                  className={`w-full flex items-center gap-3 px-4 md:px-3 py-3 md:py-2.5 rounded-lg text-base md:text-sm transition-colors ${currentView === 'dashboard' && dashboardTab === 'all' ? 'bg-primary-50 dark:bg-primary-900/30 text-primary-700 dark:text-primary-300' : 'text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700'}`}
                >
                  <Users className="w-5 h-5 md:w-4 md:h-4" />
                  <span>Members</span>
                </button>
                <button
                  onClick={() => { selection(); setShowDropdown(false); setCurrentView?.('dashboard'); setDashboardTab?.('edited') }}
                  className={`w-full flex items-center gap-3 px-4 md:px-3 py-3 md:py-2.5 rounded-lg text-base md:text-sm transition-colors ${currentView === 'dashboard' && dashboardTab === 'edited' ? 'bg-primary-50 dark:bg-primary-900/30 text-primary-700 dark:text-primary-300' : 'text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700'}`}
                >
                  <CheckSquare className="w-5 h-5 md:w-4 md:h-4" />
                  <span>Marked</span>
                  {editedCount > 0 && <span className="ml-auto px-2 py-0.5 text-xs bg-orange-100 dark:bg-orange-900 text-orange-700 dark:text-orange-300 rounded-full">{editedCount}</span>}
                </button>
                <button
                  onClick={() => { selection(); setShowDropdown(false); setCurrentView?.('dashboard'); setDashboardTab?.('duplicates') }}
                  className={`w-full flex items-center gap-3 px-4 md:px-3 py-3 md:py-2.5 rounded-lg text-base md:text-sm transition-colors ${currentView === 'dashboard' && dashboardTab === 'duplicates' ? 'bg-primary-50 dark:bg-primary-900/30 text-primary-700 dark:text-primary-300' : 'text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700'}`}
                >
                  <Copy className="w-5 h-5 md:w-4 md:h-4" />
                  <span>Duplicates</span>
                </button>
                <button
                  onClick={() => { selection(); setShowDropdown(false); setCurrentView?.('admin') }}
                  className={`w-full flex items-center gap-3 px-4 md:px-3 py-3 md:py-2.5 rounded-lg text-base md:text-sm transition-colors ${currentView === 'admin' ? 'bg-primary-50 dark:bg-primary-900/30 text-primary-700 dark:text-primary-300' : 'text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700'}`}
                >
                  <TrendingUp className="w-5 h-5 md:w-4 md:h-4" />
                  <span>Admin Panel</span>
                </button>
              </div>

              {/* Section: Actions */}
              <div className="mb-3">
                <p className="px-3 py-1 text-[11px] font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">Actions</p>
                <button
                  onClick={() => { selection(); setShowDropdown(false); onCreateMonth?.() }}
                  className="w-full flex items-center gap-3 px-4 md:px-3 py-3 md:py-2.5 rounded-lg text-base md:text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
                >
                  <Calendar className="w-5 h-5 md:w-4 md:h-4" />
                  <span>Create New Month</span>
                </button>
                <button
                  onClick={() => { selection(); setShowDropdown(false); onToggleAIChat?.() }}
                  className="w-full flex items-center gap-3 px-4 md:px-3 py-3 md:py-2.5 rounded-lg text-base md:text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
                >
                  <Sparkles className="w-5 h-5 md:w-4 md:h-4" />
                  <span>AI Assistant</span>
                </button>
              </div>

              {/* Section: Preferences */}
              <div>
                <p className="px-3 py-1 text-[11px] font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">Preferences</p>
                <button
                  onClick={() => { selection(); toggleTheme(); }}
                  className="w-full flex items-center justify-between gap-3 px-4 md:px-3 py-3 md:py-2.5 rounded-lg text-base md:text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
                >
                  <span className="flex items-center gap-3">
                    {isDarkMode ? <Moon className="w-5 h-5 md:w-4 md:h-4" /> : <Sun className="w-5 h-5 md:w-4 md:h-4" />}
                    <span>Dark Mode</span>
                  </span>
                  <div className={`w-11 h-6 md:w-9 md:h-5 rounded-full transition-colors ${isDarkMode ? 'bg-primary-500' : 'bg-gray-300'}`}>
                    <div className={`w-5 h-5 md:w-4 md:h-4 rounded-full bg-white shadow-sm transform transition-transform mt-0.5 ${isDarkMode ? 'translate-x-5 md:translate-x-4 ml-0.5' : 'translate-x-0.5'}`} />
                  </div>
                </button>
                                <button
                  onClick={() => {
                    selection()
                    setShowDropdown(false)
                    if (window.openSettings) window.openSettings()
                  }}
                  className="w-full flex items-center gap-3 px-4 md:px-3 py-3 md:py-2.5 rounded-lg text-base md:text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
                >
                  <Building2 className="w-5 h-5 md:w-4 md:h-4" />
                  <span>Settings</span>
                  {window.__needsPasswordSetup && (
                    <span className="ml-auto inline-flex items-center justify-center h-5 min-w-5 px-1 rounded-full bg-red-500 text-white text-xs font-bold">
                      1
                    </span>
                  )}
                  <span className="text-sm md:text-xs text-gray-400">Account, Team, Data</span>
                </button>
              </div>
            </div>

            {/* Sign Out */}
            <div className="px-3 md:px-2 py-3 md:py-2">
              <button
                onClick={handleSignOut}
                className="w-full flex items-center gap-3 px-4 md:px-3 py-4 md:py-2.5 rounded-lg text-base md:text-sm font-medium text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors btn-press"
              >
                <LogOut className="w-5 h-5 md:w-4 md:h-4" />
                <span>Sign Out</span>
              </button>
            </div>

            {/* Footer */}
            <div className="mobile-panel-footer-safe px-4 pt-3 md:pt-2 bg-gray-50 dark:bg-gray-900/50 border-t border-gray-200 dark:border-gray-700">
              <p className="text-xs md:text-[10px] text-gray-400 text-center">
                Datser v1.0 • TMH Teen Ministry
              </p>
            </div>
          </div>
        </>
      )}
    </div>
  )
}

export default memo(LoginButton)
