import React, { createContext, useContext, useState, useEffect, useMemo, useCallback, useRef, memo } from 'react'
import { supabase } from '../lib/supabase'
import { toast } from 'react-toastify'
import { useAuth } from './AuthContext'

const AppContext = createContext()

const MONTHS_IN_YEAR = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December'
]

const sortMonthTables = (tables = []) => {
  return tables
    .filter(Boolean)
    .slice()
    .sort((a, b) => {
      const [monthA = '', yearA = '0'] = a.split('_')
      const [monthB = '', yearB = '0'] = b.split('_')

      if (yearA !== yearB) {
        return parseInt(yearA, 10) - parseInt(yearB, 10)
      }
      return MONTHS_IN_YEAR.indexOf(monthA) - MONTHS_IN_YEAR.indexOf(monthB)
    })
}

// Get current month table name
const getCurrentMonthTable = () => {
  const now = new Date()
  const currentMonth = MONTHS_IN_YEAR[now.getMonth()]
  const currentYear = now.getFullYear()
  return `${currentMonth}_${currentYear}`
}

// Default table for all users - January 2026
const DEFAULT_TABLE = 'January_2026'

// Fallback monthly tables for when Supabase is not configured (demo mode only)
const FALLBACK_MONTHLY_TABLES = [DEFAULT_TABLE]
const DEFAULT_COLLAB_TABLE = 'January_2026'
const COLLAB_FALLBACK_TABLES = [DEFAULT_COLLAB_TABLE]
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms))

const DEFAULT_ATTENDANCE_DATES = {
  'November_2025': '2025-11-23',
  'January_2026': '2026-01-11'
}
const shouldLogAppContext = import.meta.env.MODE !== 'test'
const appContextLog = (...args) => {
  if (shouldLogAppContext) {
    console.log(...args)
  }
}

// Helper function for timezone-safe date string formatting (YYYY-MM-DD)
const getLocalDateString = (date) => {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

const normalizeMemberRecord = (member) => {
  if (!member) return member
  const name = (
    typeof member.full_name === 'string' && member.full_name.trim()
  ) ? member.full_name
    : (typeof member['Full Name'] === 'string' && member['Full Name'].trim()
      ? member['Full Name']
      : '')
  return { ...member, full_name: name, 'Full Name': name }
}

// Get the latest available table from localStorage, falling back to DEFAULT_TABLE
const getLatestTable = () => {
  if (typeof window !== 'undefined') {
    const saved = localStorage.getItem('selectedMonthTable')
    if (saved) return saved
  }
  return DEFAULT_TABLE
}

// Mock data for development when Supabase is not configured
const mockMembers = [
  {
    id: '1',
    'Full Name': 'John Doe',
    'Gender': 'Male',
    'Phone Number': 1234567890,
    'Age': '16',
    'Current Level': 'SHS1',
    inserted_at: new Date().toISOString()
  },
  {
    id: '2',
    'Full Name': 'Jane Smith',
    'Gender': 'Female',
    'Phone Number': 987654321,
    'Age': '15',
    'Current Level': 'JHS3',
    inserted_at: new Date().toISOString()
  },
  {
    id: '3',
    'Full Name': 'Michael Johnson',
    'Gender': 'Male',
    'Phone Number': 555123456,
    'Age': '17',
    'Current Level': 'SHS2',
    inserted_at: new Date().toISOString()
  }
]

export const useApp = () => {
  const context = useContext(AppContext)
  if (!context) {
    throw new Error('useApp must be used within an AppProvider')
  }
  return context
}

export const AppProvider = ({ children }) => {
  // Get user from auth context - may be null during initial load
  const authContext = useAuth()
  const user = authContext?.user
  const authLoading = authContext?.loading
  const [members, setMembers] = useState([])
  const [loading, setLoading] = useState(true)

  // Collaborator state - tracks if current user is viewing someone else's data
  const [dataOwnerId, setDataOwnerId] = useState(null) // The owner whose data we're viewing
  const [isCollaborator, setIsCollaborator] = useState(false)
  const [ownerEmail, setOwnerEmail] = useState(null)
  const [hasAccess, setHasAccess] = useState(true) // Whether user has permission to access the app
  const [searchTerm, setSearchTerm] = useState('')
  const [serverSearchResults, setServerSearchResults] = useState(null)
  const searchCacheRef = useRef(new Map())
  const nameColumnCacheRef = useRef(new Map())
  const membersCacheRef = useRef(new Map()) // tableName -> { data, ts }
  const [attendanceData, setAttendanceData] = useState({})
  const [currentTable, setCurrentTable] = useState(getLatestTable())

  // Admin sticky defaults for collaborators
  const [ownerStickyMonth, setOwnerStickyMonth] = useState(null)
  const [ownerStickySundays, setOwnerStickySundays] = useState([])
  const [adminSyncNotice, setAdminSyncNotice] = useState(null)
  const adminBroadcastRef = useRef({ month: null, date: null })
  const adminRealtimeChannelRef = useRef(null)
  const adminRealtimeStatusRef = useRef('CLOSED')
  const pendingAdminBroadcastRef = useRef(null)

  // Load saved month from user preferences on app startup
  useEffect(() => {
    const loadSavedMonth = async () => {
      if (!user || authLoading) return

      try {
        const storageKey = isCollaborator && dataOwnerId ? `selectedMonthTable_${dataOwnerId}` : 'selectedMonthTable'
        const localSaved = localStorage.getItem(storageKey)

        if (isCollaborator && ownerStickyMonth && !localSaved && !authContext?.preferences?.current_month_table) {
          setCurrentTable(ownerStickyMonth)
          localStorage.setItem(storageKey, ownerStickyMonth)
          return
        }

        // Try to load from Supabase preferences first (persisted across devices)
        if (authContext?.preferences?.current_month_table) {
          const savedMonth = authContext.preferences.current_month_table
          appContextLog('[MONTH] Loaded saved month from Supabase preferences:', savedMonth)
          setCurrentTable(savedMonth)
          localStorage.setItem(storageKey, savedMonth)
          return
        }

        // Fallback to localStorage if preferences not yet synced
        if (localSaved) {
          appContextLog('[MONTH] Loaded month from localStorage:', localSaved)
          setCurrentTable(localSaved)
          return
        }

        // Default to DEFAULT_TABLE if nothing is saved
        appContextLog('[MONTH] No saved month found, using default:', DEFAULT_TABLE)
        localStorage.setItem(storageKey, DEFAULT_TABLE)
      } catch (error) {
        console.error('[MONTH] Error loading saved month:', error)
        // Fallback to localStorage on error
        const storageKey = isCollaborator && dataOwnerId ? `selectedMonthTable_${dataOwnerId}` : 'selectedMonthTable'
        const localSaved = localStorage.getItem(storageKey) || DEFAULT_TABLE
        setCurrentTable(localSaved)
        localStorage.setItem(storageKey, localSaved)
      }
    }

    loadSavedMonth()
  }, [user, authLoading, authContext?.preferences?.current_month_table, isCollaborator, dataOwnerId, ownerStickyMonth])
  const [monthlyTables, setMonthlyTables] = useState(FALLBACK_MONTHLY_TABLES)
  const [selectedAttendanceDate, setSelectedAttendanceDate] = useState(null)
  const [availableSundayDates, setAvailableSundayDates] = useState([])
  // Global dashboard tab state (mobile header controls All/Edited)
  const [dashboardTab, setDashboardTab] = useState('all')

  // Badge filter state - persisted across all components
  const [badgeFilter, setBadgeFilter] = useState(() => {
    const saved = localStorage.getItem('badgeFilter')
    return saved ? JSON.parse(saved) : [] // Start with no badges selected
  })

  // Auto-All-Dates feature (auto-mark all dates up to today)
  const [autoAllDatesEnabled, setAutoAllDatesEnabled] = useState(() => {
    return localStorage.getItem('autoAllDatesEnabled') === 'true'
  })

  // Admin-locked default date — forces collaborators to a specific date
  const [lockedDefaultDate, setLockedDefaultDate] = useState(null)
  const suppressDateBroadcastRef = useRef(false)

  // Fetch the owner's locked default date (for collaborators)
  const fetchLockedDefaultDate = useCallback(async (ownerId) => {
    if (!isSupabaseConfigured() || !ownerId) return null
    try {
      const { data, error } = await supabase.rpc('get_owner_locked_date', {
        owner_uuid: ownerId
      })
      if (!error && data) {
        setLockedDefaultDate(data)
        return data
      }
      setLockedDefaultDate(null)
      return null
    } catch (err) {
      console.error('Error fetching locked default date:', err)
      setLockedDefaultDate(null)
      return null
    }
  }, [])

  // Save locked default date (admin only)
  const saveLockedDefaultDate = useCallback(async (dateStr) => {
    if (!isSupabaseConfigured() || !user?.id || isCollaborator) return false

    // Optimistic UI Update
    const previousDateStr = lockedDefaultDate;
    setLockedDefaultDate(dateStr || null)
    if (dateStr) {
      try {
        const [year, month, day] = dateStr.split('-')
        const newDate = new Date(year, parseInt(month) - 1, parseInt(day))
        setSelectedAttendanceDate(newDate)
      } catch (e) {
        console.error('Error parsing locked date:', e)
      }
    }

    try {
      const { error } = await supabase
        .from('user_preferences')
        .update({ locked_default_date: dateStr || null })
        .eq('user_id', user.id)

      if (!error) {
        return true
      }

      // Revert on error
      console.error('Error saving locked default date:', error)
      setLockedDefaultDate(previousDateStr)
      return false
    } catch (err) {
      // Revert on error
      console.error('Error saving locked default date:', err)
      setLockedDefaultDate(previousDateStr)
      return false
    }
  }, [user?.id, isCollaborator, lockedDefaultDate])

  const getMonthStorageKey = useCallback(() => {
    if (isCollaborator && dataOwnerId) {
      return `selectedMonthTable_${dataOwnerId}`
    }
    return 'selectedMonthTable'
  }, [isCollaborator, dataOwnerId])

  const changeCurrentTable = useCallback((tableName) => {
    setCurrentTable(tableName)
    const storageKey = getMonthStorageKey()
    if (tableName) {
      localStorage.setItem(storageKey, tableName)
    } else {
      localStorage.removeItem(storageKey)
    }
    // Also persist to Supabase so the selection survives across devices/sessions
    if (tableName && authContext?.updatePreference) {
      authContext.updatePreference('current_month_table', tableName)
    }
  }, [getMonthStorageKey, authContext?.updatePreference])

  const pruneMissingTable = useCallback((tableName) => {
    if (!tableName) return
    setMonthlyTables(prev => {
      const filtered = sortMonthTables(prev.filter(t => t !== tableName))
      if (currentTable === tableName) {
        const fallback = filtered[filtered.length - 1] || null
        changeCurrentTable(fallback)
      }
      return filtered
    })
  }, [currentTable, changeCurrentTable])

  // Check if Supabase is properly configured
  const isSupabaseConfigured = useCallback(() => {
    const supabaseUrl = import.meta.env?.VITE_SUPABASE_URL
    return supabase && supabaseUrl &&
      supabaseUrl !== 'your_supabase_url_here' &&
      supabaseUrl !== 'https://placeholder.supabase.co'
  }, [])

  const fetchOwnerStickyDefaults = useCallback(async (ownerId) => {
    if (!isSupabaseConfigured() || !ownerId) return null
    try {
      const { data, error } = await supabase
        .from('user_preferences')
        .select('*')
        .eq('user_id', ownerId)
        .maybeSingle()

      if (!error && data) {
        setOwnerStickyMonth(data.admin_sticky_month || null)
        setOwnerStickySundays(Array.isArray(data.admin_sticky_sundays) ? data.admin_sticky_sundays : [])
        return data
      }

      setOwnerStickyMonth(null)
      setOwnerStickySundays([])
      return null
    } catch (err) {
      console.error('Error fetching owner sticky defaults:', err)
      setOwnerStickyMonth(null)
      setOwnerStickySundays([])
      return null
    }
  }, [isSupabaseConfigured])

  const buildAdminTarget = useCallback((stickyMonth, stickySundays) => {
    let targetTable = null
    let targetDate = null
    if (stickyMonth) {
      targetTable = stickyMonth
    }

    if (!targetDate && targetTable && Array.isArray(stickySundays) && stickySundays.length > 0) {
      const [monthName, yearStr] = targetTable.split('_')
      const yearNum = parseInt(yearStr, 10)
      const monthIndex = MONTHS_IN_YEAR.indexOf(monthName) + 1
      const match = stickySundays.find((dateStr) => {
        const [y, m] = dateStr.split('-').map(Number)
        return y === yearNum && m === monthIndex
      })
      if (match) {
        const [y, m, d] = match.split('-').map(Number)
        targetDate = new Date(y, m - 1, d)
      }
    }

    return { targetTable, targetDate }
  }, [])

  const applyAdminTargetForCollaborator = useCallback((targetTable, targetDateKey) => {
    if (!isCollaborator) return
    if (targetTable && targetTable !== currentTable) {
      changeCurrentTable(targetTable)
    }
    if (!targetDateKey) return
    const currentDateKey = selectedAttendanceDate ? getLocalDateString(selectedAttendanceDate) : null
    if (currentDateKey === targetDateKey) return
    const [y, m, d] = targetDateKey.split('-').map(Number)
    if (Number.isNaN(y) || Number.isNaN(m) || Number.isNaN(d)) return
    const dateObj = new Date(y, m - 1, d)
    setSelectedAttendanceDate(dateObj)
    localStorage.setItem(`selectedAttendanceDate_${targetTable || currentTable}`, dateObj.toISOString())
  }, [isCollaborator, currentTable, changeCurrentTable, selectedAttendanceDate])

  const updateAdminSyncNotice = useCallback((stickyMonth, stickySundays) => {
    if (!isCollaborator) return
    const { targetTable, targetDate } = buildAdminTarget(stickyMonth, stickySundays)
    if (!targetTable && !targetDate) {
      setAdminSyncNotice(null)
      return
    }
    const targetDateKey = targetDate ? getLocalDateString(targetDate) : null
    applyAdminTargetForCollaborator(targetTable, targetDateKey)
    setAdminSyncNotice(null)
  }, [
    isCollaborator,
    buildAdminTarget,
    applyAdminTargetForCollaborator
  ])

  const applyAdminBroadcastNotice = useCallback((payload) => {
    if (!isCollaborator) return
    const targetTable = payload?.targetTable || null
    const targetDateKey = payload?.targetDate || null
    if (!targetTable && !targetDateKey) return
    applyAdminTargetForCollaborator(targetTable, targetDateKey)
    setAdminSyncNotice(null)
  }, [isCollaborator, applyAdminTargetForCollaborator])

  const sendAdminPeriodBroadcast = useCallback((payload) => {
    const channel = adminRealtimeChannelRef.current
    if (!channel || adminRealtimeStatusRef.current !== 'SUBSCRIBED' || typeof channel.send !== 'function') {
      pendingAdminBroadcastRef.current = payload
      return
    }
    try {
      const sendResult = channel.send({
        type: 'broadcast',
        event: 'admin_period_change',
        payload
      })
      if (sendResult && typeof sendResult.catch === 'function') {
        sendResult.catch((err) => {
          console.error('Error sending admin period broadcast:', err)
          pendingAdminBroadcastRef.current = payload
        })
      }
    } catch (err) {
      console.error('Error sending admin period broadcast:', err)
      pendingAdminBroadcastRef.current = payload
    }
  }, [])

  useEffect(() => {
    const channelOwnerId = isCollaborator ? dataOwnerId : user?.id
    if (!isSupabaseConfigured() || !channelOwnerId) return
    const channel = supabase.channel(`admin-sync-${channelOwnerId}`, {
      config: {
        broadcast: { self: false }
      }
    })
    if (isCollaborator) {
      channel.on('broadcast', { event: 'admin_period_change' }, ({ payload }) => {
        applyAdminBroadcastNotice(payload)
      })
    }
    channel.subscribe((status) => {
      adminRealtimeStatusRef.current = status
      if (status === 'SUBSCRIBED' && pendingAdminBroadcastRef.current && typeof channel.send === 'function') {
        const pendingPayload = pendingAdminBroadcastRef.current
        pendingAdminBroadcastRef.current = null
        channel.send({
          type: 'broadcast',
          event: 'admin_period_change',
          payload: pendingPayload
        }).catch((err) => {
          console.error('Error sending queued admin period broadcast:', err)
          pendingAdminBroadcastRef.current = pendingPayload
        })
      }
    })
    adminRealtimeChannelRef.current = channel
    return () => {
      supabase.removeChannel(channel)
      if (adminRealtimeChannelRef.current === channel) {
        adminRealtimeChannelRef.current = null
      }
      adminRealtimeStatusRef.current = 'CLOSED'
    }
  }, [isSupabaseConfigured, isCollaborator, dataOwnerId, user?.id, applyAdminBroadcastNotice])

  useEffect(() => {
    if (isCollaborator || !isSupabaseConfigured() || !user?.id || !currentTable) return
    if (adminBroadcastRef.current.month === currentTable) return

    const [monthName, yearStr] = currentTable.split('_')
    const yearNum = parseInt(yearStr, 10)
    if (!monthName || Number.isNaN(yearNum)) return

    adminBroadcastRef.current.month = currentTable
    ;(async () => {
      try {
        await supabase
          .from('user_preferences')
          .upsert({
            user_id: user.id,
            admin_sticky_month: currentTable,
            admin_sticky_year: yearNum,
            updated_at: new Date().toISOString()
          }, {
            onConflict: 'user_id'
          })
        sendAdminPeriodBroadcast({
          targetTable: currentTable,
          targetDate: null
        })
      } catch (err) {
        console.error('Error broadcasting admin month change:', err)
      }
    })()
  }, [isCollaborator, isSupabaseConfigured, user?.id, currentTable, sendAdminPeriodBroadcast])

  useEffect(() => {
    if (isCollaborator || !isSupabaseConfigured() || !user?.id || !selectedAttendanceDate) return
    if (suppressDateBroadcastRef.current) return

    const dateStr = getLocalDateString(selectedAttendanceDate)
    if (!dateStr || adminBroadcastRef.current.date === dateStr) return

    adminBroadcastRef.current.date = dateStr
    ;(async () => {
      try {
        const [monthName, yearStr] = currentTable.split('_')
        const currentYear = parseInt(yearStr, 10)
        const currentMonthIndex = MONTHS_IN_YEAR.indexOf(monthName) + 1
        const nextStickySundays = [
          dateStr,
          ...ownerStickySundays.filter((savedDate) => {
            const [y, m] = savedDate.split('-').map(Number)
            return y !== currentYear || m !== currentMonthIndex
          })
        ]
        await supabase
          .from('user_preferences')
          .upsert({
            user_id: user.id,
            admin_sticky_sundays: nextStickySundays,
            updated_at: new Date().toISOString()
          }, {
            onConflict: 'user_id'
          })
        sendAdminPeriodBroadcast({
          targetTable: currentTable,
          targetDate: dateStr
        })
      } catch (err) {
        console.error('Error broadcasting admin date change:', err)
      }
    })()
  }, [isCollaborator, isSupabaseConfigured, user?.id, selectedAttendanceDate, currentTable, ownerStickySundays, sendAdminPeriodBroadcast])

  // Check if current user is a collaborator and get the owner's ID
  const checkCollaboratorStatus = async () => {
    appContextLog('=== checkCollaboratorStatus STARTED ===')
    appContextLog('User email:', user?.email)
    appContextLog('User ID:', user?.id)
    appContextLog('Supabase configured?', isSupabaseConfigured())

    if (!user?.id || !isSupabaseConfigured()) {
      appContextLog('Skipping collaborator check - no user ID or Supabase not configured')
      setIsCollaborator(false)
      setDataOwnerId(null)
      setOwnerEmail(null)
      return null
    }

    try {
      const normalizedEmail = user.email?.trim().toLowerCase()
      let data = null
      let error = null

      const collaboratorQuery = supabase
        .from('collaborators')
        .select('owner_id, status, email')
        .eq('collaborator_user_id', user.id)
        .in('status', ['pending', 'accepted', 'active'])
      const userLookup = await (
        typeof collaboratorQuery.maybeSingle === 'function'
          ? collaboratorQuery.maybeSingle()
          : collaboratorQuery.single()
      )

      data = userLookup.data
      error = userLookup.error

      if (!data && normalizedEmail) {
        appContextLog('Collaborator lookup by user id returned no match. Falling back to email lookup:', normalizedEmail)
        const emailQueryBase = supabase
          .from('collaborators')
          .select('owner_id, status, email')
        const emailQuery = typeof emailQueryBase.ilike === 'function'
          ? emailQueryBase.ilike('email', normalizedEmail)
          : emailQueryBase.eq('email', normalizedEmail)
        const emailLookup = await (
          typeof emailQuery.maybeSingle === 'function'
            ? emailQuery
              .in('status', ['pending', 'accepted', 'active'])
              .maybeSingle()
            : emailQuery
              .in('status', ['pending', 'accepted', 'active'])
              .single()
        )
        data = emailLookup.data
        error = emailLookup.error
      }

      appContextLog('Collaborators query result:', { data, error })

      if (error || !data) {
        // Not a collaborator - verify they are an actual owner with data
        appContextLog('User is NOT a collaborator. Checking if they are an owner...')

        // Check if this user has any month tables (i.e., they are a real owner)
        const { data: ownerTables, error: ownerError } = await supabase
          .from('user_month_tables')
          .select('id')
          .eq('user_id', user.id)
          .limit(1)

        // Also check if they have user_preferences (created during onboarding)
        const { data: prefs, error: prefsError } = await supabase
          .from('user_preferences')
          .select('id')
          .eq('user_id', user.id)
          .limit(1)

        const isRealOwner = (ownerTables && ownerTables.length > 0) || (prefs && prefs.length > 0)

        if (!isRealOwner) {
          // Random user with no data and not a collaborator - DENY ACCESS
          appContextLog('❌ User is NOT an owner and NOT a collaborator - ACCESS DENIED')
          setIsCollaborator(false)
          setDataOwnerId(null)
          setOwnerEmail(null)
          setHasAccess(false)
          return null
        }

        appContextLog('✅ User is a verified owner')
        setIsCollaborator(false)
        setDataOwnerId(user.id)
        setOwnerEmail(null)
        setHasAccess(true)
        setOwnerStickyMonth(null)
        setOwnerStickySundays([])
        fetchOwnerStickyDefaults(user.id)
        return user.id
      }

      // User is a collaborator - they should see the owner's data
      appContextLog('✅ User IS a collaborator!')
      appContextLog('Owner ID:', data.owner_id)
      appContextLog('Status:', data.status)
      setIsCollaborator(true)
      setDataOwnerId(data.owner_id)
      setHasAccess(true)
      fetchOwnerStickyDefaults(data.owner_id)

      // Sync Workspace Name from Owner
      if (authContext?.updatePreference) {
        const { data: ownerWsName, error: wsError } = await supabase.rpc('get_owner_workspace_name', {
          owner_uuid: data.owner_id
        })

        if (!wsError && ownerWsName) {
          const currentWs = authContext.preferences?.workspace_name
          if (currentWs !== ownerWsName) {
            appContextLog('Syncing workspace name from owner:', ownerWsName)
            authContext.updatePreference('workspace_name', ownerWsName)
          }
        }
      }

      // Get owner's email for display
      const { data: ownerData } = await supabase
        .from('collaborators')
        .select('owner_id')
        .eq('owner_id', data.owner_id)
        .limit(1)

      // Get owner email from auth.users via a different method
      setOwnerEmail(null) // We'll show owner_id for now

      appContextLog('=== checkCollaboratorStatus COMPLETE - User is COLLABORATOR ===')
      return data.owner_id
    } catch (err) {
      console.error('ERROR in checkCollaboratorStatus:', err)
      // On error, deny access by default for safety
      setIsCollaborator(false)
      setDataOwnerId(null)
      setHasAccess(false)
      return null
    }
  }

  // Determine collaborator status whenever auth state settles
  useEffect(() => {
    if (authLoading) return
    checkCollaboratorStatus()
  }, [authLoading, user?.email, user?.id])

  useEffect(() => {
    if (!isCollaborator || !dataOwnerId) {
      setOwnerStickyMonth(null)
      setOwnerStickySundays([])
      setAdminSyncNotice(null)
      return
    }
    fetchOwnerStickyDefaults(dataOwnerId)
  }, [isCollaborator, dataOwnerId, fetchOwnerStickyDefaults])

  useEffect(() => {
    if (import.meta.env.MODE === 'test') return
    if (!isCollaborator || !dataOwnerId || !isSupabaseConfigured()) return
    const refreshStickyDefaults = () => {
      fetchOwnerStickyDefaults(dataOwnerId)
    }
    const handleVisibilityChange = () => {
      if (!document.hidden) {
        refreshStickyDefaults()
      }
    }
    window.addEventListener('focus', refreshStickyDefaults)
    document.addEventListener('visibilitychange', handleVisibilityChange)
    return () => {
      window.removeEventListener('focus', refreshStickyDefaults)
      document.removeEventListener('visibilitychange', handleVisibilityChange)
    }
  }, [isCollaborator, dataOwnerId, isSupabaseConfigured, fetchOwnerStickyDefaults])

  useEffect(() => {
    if (!isSupabaseConfigured() || !isCollaborator || !dataOwnerId) return

    const channel = supabase
      .channel(`owner-preferences-${dataOwnerId}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'user_preferences',
          filter: `user_id=eq.${dataOwnerId}`
        },
        (payload) => {
          const nextStickyMonth = payload?.new?.admin_sticky_month || null
          const nextStickySundays = Array.isArray(payload?.new?.admin_sticky_sundays)
            ? payload.new.admin_sticky_sundays
            : []
          setOwnerStickyMonth(nextStickyMonth)
          setOwnerStickySundays(nextStickySundays)
          updateAdminSyncNotice(nextStickyMonth, nextStickySundays)
        }
      )
      .subscribe()

    return () => {
      supabase.removeChannel(channel)
    }
  }, [isSupabaseConfigured, isCollaborator, dataOwnerId, updateAdminSyncNotice])

  useEffect(() => {
    updateAdminSyncNotice(ownerStickyMonth, ownerStickySundays)
  }, [ownerStickyMonth, ownerStickySundays, updateAdminSyncNotice])

  // Activity Logging Helper
  const logActivity = useCallback(async (action, details) => {
    if (!isSupabaseConfigured() || !user) return

    try {
      // Determine the owner of the workspace being affected
      // If I am a collaborator, I am affecting the 'dataOwnerId' workspace
      // If I am the owner, I am affecting my own workspace (user.id)
      const targetOwner = isCollaborator ? dataOwnerId : user.id

      if (!targetOwner) {
        console.warn('Cannot log activity: targetOwner is undefined')
        return
      }

      await supabase.from('activity_logs').insert({
        actor_id: user.id,
        actor_email: user.email,
        action,
        details,
        target_owner_id: targetOwner
      })
    } catch (error) {
      console.error('Failed to log activity:', error)
      // Do not throw; logging failure should not break the app
    }
  }, [user, isCollaborator, dataOwnerId])

  // Fetch members from current monthly table or use mock data
  const fetchMembers = async (tableName = currentTable, options = {}) => {
    const { forceRefresh = false, background = false } = options
    if (!tableName) {
      console.warn('fetchMembers called with null/undefined tableName, skipping')
      setMembers([])
      return
    }
    try {
      if (!background) {
        setLoading(true)
      }
      appContextLog(`Fetching members from table: ${tableName} for user: ${user?.id}`)

      if (!isSupabaseConfigured()) {
        appContextLog('Using mock data - Supabase not configured')
        setMembers(mockMembers)
        if (!background) {
          setLoading(false)
        }
        return
      }

      // Check if we have a valid session
      const { data: { session } } = await supabase.auth.getSession()
      appContextLog('Current session:', session ? `authenticated as ${session.user?.id}` : 'not authenticated')
      if (!session) {
        console.warn('No active session - user may need to log in again')
        if (!background) {
          toast.error('Session expired. Please refresh and log in again.')
        }
        setMembers([])
        if (!background) {
          setLoading(false)
        }
        return
      }

      // Serve from cache when fresh (reduces egress)
      const cacheKey = tableName || 'default'
      const cached = membersCacheRef.current.get(cacheKey)
      const now = Date.now()
      const TTL_MS = 5 * 60 * 1000 // 5 minutes
      if (!forceRefresh && cached && (now - cached.ts) < TTL_MS) {
        appContextLog('Using cached members for', cacheKey)
        setMembers(cached.data)
        if (!background) {
          setLoading(false)
        }
        return
      }

      // Fetch data - paginate to avoid Supabase default 1000-row cap
      appContextLog(`Querying ${tableName} with session user: ${session.user?.id}`)

      let data = []
      let fetchOffset = 0
      const FETCH_PAGE = 1000
      let error = null
      while (true) {
        const { data: page, error: pageError } = await supabase
          .from(tableName)
          .select('*')
          .range(fetchOffset, fetchOffset + FETCH_PAGE - 1)

        if (pageError) { error = pageError; break }
        if (!page || page.length === 0) break
        data = data.concat(page)
        if (page.length < FETCH_PAGE) break
        fetchOffset += FETCH_PAGE
      }

      appContextLog(`Query result: ${data?.length || 0} rows, error: ${error?.message || 'none'}`)

      if (error) {
        console.error('Error fetching members:', error)
        appContextLog('Error details:', error.message, error.code)

        const missingTable =
          error.code === 'PGRST205' ||
          error.code === 'PGRST116' ||
          error.message?.toLowerCase().includes('does not exist') ||
          error.message?.toLowerCase().includes('schema cache')

        if (missingTable) {
          await handleMissingTable(tableName)
          setMembers([])
          return
        }

        if (!background) {
          toast.error(`Database error: ${error.message}`, { autoClose: 10000 })
        }
        console.warn('Fetch members failed; preserving current member list.')
      } else {
        // Filter out records with null name, then normalize both name keys
        const validMembers = (data || []).filter(member => member?.['full_name'] || member?.['Full Name'])
        const normalizedMembers = validMembers.map(normalizeMemberRecord)
        setMembers(normalizedMembers)
        membersCacheRef.current.set(cacheKey, { data: normalizedMembers, ts: now })
        appContextLog(`Successfully loaded ${normalizedMembers.length} members from ${tableName}`)
        appContextLog('First few members:', normalizedMembers.slice(0, 3))
        appContextLog('Sample member structure:', normalizedMembers[0])
        // Removed automatic toast notification on page load
      }
    } catch (error) {
      console.error('Unexpected error in fetchMembers:', error)
      appContextLog(`Setting mock members (${mockMembers.length} members) due to error`)
      setMembers(mockMembers) // Fallback to mock data
    } finally {
      if (!background) {
        setLoading(false)
      }
    }
  }

  // Add new member to current monthly table
  const addMember = async (memberData) => {
    try {
      if (!isSupabaseConfigured()) {
        // Demo mode - add to local state
        const newMember = {
          id: Date.now().toString(),
          'Full Name': memberData.full_name || memberData.fullName || memberData['Full Name'],
          'Gender': memberData.gender || memberData['Gender'],
          'Phone Number': memberData.phone_number || memberData.phoneNumber || memberData['Phone Number'],
          'Age': memberData.age || memberData['Age'],
          'Current Level': memberData.current_level || memberData.currentLevel || memberData['Current Level'],
          'Member Status': 'New', // Default status for new members
          'Badge Type': 'newcomer', // Default badge
          'Join Date': new Date().toISOString().split('T')[0], // Join date
          'Manual Badge': null, // For manually assigned badges
          inserted_at: new Date().toISOString()
        }
        setMembers(prev => [newMember, ...prev])
        toast.success('Member added successfully! (Demo Mode)')
        // Return the created member object directly for downstream usage
        return newMember
      }

      // Transform data to match monthly table structure
      const genRaw = memberData.gender || memberData['Gender']
      const gen = typeof genRaw === 'string'
        ? (genRaw.trim().toLowerCase() === 'male' ? 'Male' : genRaw.trim().toLowerCase() === 'female' ? 'Female' : genRaw)
        : genRaw
      const ageRaw = memberData.age || memberData['Age']
      const ageStr = (ageRaw === undefined || ageRaw === null || ageRaw === '') ? null : String(ageRaw).trim()
      const phoneRaw = memberData.phone_number ?? memberData.phoneNumber ?? memberData['Phone Number']
      const phoneStr = (phoneRaw === undefined || phoneRaw === null) ? null : String(phoneRaw).trim() || null

      // Get workspace name from auth preferences
      const workspaceName = authContext?.preferences?.workspace_name || null

      const transformedData = {
        'Full Name': memberData.full_name || memberData.fullName || memberData['Full Name'],
        'Gender': gen,
        'Phone Number': phoneStr,
        'Age': ageStr,
        'Current Level': memberData.current_level || memberData.currentLevel || memberData['Current Level'],
        // Auto-fill workspace from user preferences
        workspace: workspaceName,
        // Optional parent info fields
        parent_name_1: memberData.parent_name_1 || null,
        parent_phone_1: memberData.parent_phone_1 || null,
        parent_name_2: memberData.parent_name_2 || null,
        parent_phone_2: memberData.parent_phone_2 || null,
        // Notes, ministry tags, and visitor status
        notes: memberData.notes || null,
        ministry: memberData.ministry || null,
        is_visitor: memberData.is_visitor || false,
        // Link to current user
        user_id: user?.id
      }

      const { data, error } = await supabase
        .from(currentTable)
        .insert([transformedData])
        .select()

      if (error) throw error

      setMembers(prev => [data[0], ...prev])
      toast.success(`Member added successfully to ${currentTable}!`)

      // Log the action
      logActivity('ADD_MEMBER', `Added new member: ${memberData.full_name || memberData.fullName || memberData['Full Name']}`)

      // Return the created member row directly
      return members.find(m => m.id === id)
    } catch (error) {
      console.error('Error adding member:', error)
      toast.error('Failed to add member')
      // Propagate error; callers can catch
      throw error
    }
  }

  // Get attendance column name for a given date
  const getAttendanceColumn = (date) => {
    const day = date.getDate()
    let suffix = 'th'
    if (day === 1 || day === 21 || day === 31) suffix = 'st'
    else if (day === 2 || day === 22) suffix = 'nd'
    else if (day === 3 || day === 23) suffix = 'rd'
    return `Attendance ${day}${suffix}`
  }

  // Get all attendance columns for the current table
  const getAttendanceColumns = async () => {
    try {
      if (!isSupabaseConfigured()) return []
      if (!currentTable) return []

      const { data, error } = await supabase.rpc('get_table_columns', {
        table_name: currentTable
      })

      if (error) {
        console.error('Error getting table columns:', error)
        return []
      }

      // Filter for attendance columns - support both OLD and NEW formats
      // OLD: Attendance 7th, Attendance 14th
      // NEW: attendance_2025_12_07
      return data?.filter(col => {
        const name = col.column_name
        const nameLower = name.toLowerCase()
        // OLD format: starts with 'Attendance '
        const isOldFormat = name.startsWith('Attendance ')
        // NEW format: attendance_YYYY_MM_DD
        const isNewFormat = /^attendance_\d{4}_\d{2}_\d{2}$/.test(nameLower)
        return isOldFormat || isNewFormat
      }) || []
    } catch (error) {
      console.error('Error getting attendance columns:', error)
      return []
    }
  }

  // Get available attendance dates for the current table
  const getAvailableAttendanceDates = async () => {
    try {
      const attendanceColumns = await getAttendanceColumns()

      // Extract dates from column names and sort them
      // Support both OLD format (Attendance 7th) and NEW format (attendance_2025_12_07)
      const dates = attendanceColumns
        .map(col => {
          const colName = col.column_name.toLowerCase()

          // NEW format: attendance_2025_12_07
          const newMatch = colName.match(/attendance_(\d{4})_(\d{2})_(\d{2})/)
          if (newMatch) {
            return parseInt(newMatch[3]) // Return day of month
          }

          // OLD format: Attendance 7th, attendance_7th
          const oldMatch = col.column_name.match(/[Aa]ttendance[_ ](\d+)(st|nd|rd|th)?/)
          if (oldMatch) {
            return parseInt(oldMatch[1])
          }

          return null
        })
        .filter(date => date !== null)
        .sort((a, b) => a - b)

      return dates
    } catch (error) {
      console.error('Error getting available attendance dates:', error)
      return []
    }
  }

  // Helper function to get all Sundays in a month
  const getSundaysInMonth = (monthName, year) => {
    const monthIndex = [
      'January', 'February', 'March', 'April', 'May', 'June',
      'July', 'August', 'September', 'October', 'November', 'December'
    ].indexOf(monthName)

    if (monthIndex === -1) {
      throw new Error(`Invalid month name: ${monthName}`)
    }

    const sundays = []
    const date = new Date(year, monthIndex, 1)

    // Find the first Sunday of the month
    while (date.getDay() !== 0) {
      date.setDate(date.getDate() + 1)
    }

    // Collect all Sundays in the month
    while (date.getMonth() === monthIndex) {
      sundays.push(new Date(date))
      date.setDate(date.getDate() + 7)
    }

    return sundays
  }

  // Get available Sunday dates for the current table
  // Shows ALL Sundays in the selected month so users can mark attendance for any Sunday
  const getAvailableSundayDates = async () => {
    try {
      // Parse the current table to get month and year
      const [monthName, year] = currentTable.split('_')
      const yearNum = parseInt(year)
      const monthIndex = MONTHS_IN_YEAR.indexOf(monthName)

      if (!monthName || monthIndex < 0 || isNaN(yearNum)) {
        console.error('Invalid table format:', currentTable)
        return []
      }

      // Return all Sundays in the month - attendance columns will be created as needed
      const allSundays = getSundaysInMonth(monthName, yearNum)
      appContextLog(`Found ${allSundays.length} Sundays in ${monthName} ${yearNum}:`, allSundays.map(d => d.getDate()))
      if (isCollaborator) {
        const stickyForMonth = ownerStickySundays
          .filter((dateStr) => {
            const [y, m] = dateStr.split('-').map(Number)
            return y === yearNum && m === monthIndex + 1
          })
          .map((dateStr) => {
            const [y, m, d] = dateStr.split('-').map(Number)
            return new Date(y, m - 1, d)
          })
          .sort((a, b) => a.getTime() - b.getTime())
        if (stickyForMonth.length > 0) {
          return stickyForMonth
        }
      }

      return allSundays
    } catch (error) {
      console.error('Error getting available Sunday dates:', error)
      return []
    }
  }

  // Initialize available Sunday dates and set default selected date
  const initializeAttendanceDates = async () => {
    const sundays = await getAvailableSundayDates()
    setAvailableSundayDates(sundays)

    if (sundays.length > 0) {
      suppressDateBroadcastRef.current = true
      if (isCollaborator) {
        setAndSaveAttendanceDate(sundays[0])
        setTimeout(() => { suppressDateBroadcastRef.current = false }, 300)
        return
      }

      // Check if there's a configured default date for this month
      const configured = DEFAULT_ATTENDANCE_DATES[currentTable]
      if (configured) {
        const cfgDate = new Date(configured)
        const defaultDate = sundays.find(sunday => (
          sunday.getFullYear() === cfgDate.getFullYear() &&
          sunday.getMonth() === cfgDate.getMonth() &&
          sunday.getDate() === cfgDate.getDate()
        ))
        if (defaultDate) {
          setAndSaveAttendanceDate(defaultDate)
          setTimeout(() => { suppressDateBroadcastRef.current = false }, 300)
          return
        }
      }

      // Try to restore user's last selected date from localStorage
      const savedDateKey = `selectedAttendanceDate_${currentTable}`
      const savedDate = localStorage.getItem(savedDateKey)

      if (savedDate) {
        // Check if the saved date is still available in current month
        const savedDateTime = new Date(savedDate)
        const matchingDate = sundays.find(sunday => {
          // Compare dates by year, month, and day (ignore time differences)
          return sunday.getFullYear() === savedDateTime.getFullYear() &&
            sunday.getMonth() === savedDateTime.getMonth() &&
            sunday.getDate() === savedDateTime.getDate()
        })

        if (matchingDate) {
          setSelectedAttendanceDate(matchingDate)
          setTimeout(() => { suppressDateBroadcastRef.current = false }, 300)
          return
        }
      }

      const twentyThird = sundays.find(sunday => sunday.getDate() === 23) || null
      const thirtieth = sundays.find(sunday => sunday.getDate() === 30) || null

      // Prefer 30th if available, then 23rd, then second Sunday, then first
      const defaultDate = thirtieth || twentyThird || (sundays.length >= 2 ? sundays[1] : sundays[0])
      setAndSaveAttendanceDate(defaultDate)
      setTimeout(() => { suppressDateBroadcastRef.current = false }, 300)
    }
  }

  // Calculate member attendance rate
  const calculateAttendanceRate = (member) => {
    // Support both OLD format (Attendance 7th) and NEW format (attendance_2025_12_07)
    const attendanceColumns = Object.keys(member).filter(key => {
      const keyLower = key.toLowerCase()
      const hasValue = member[key] !== null && member[key] !== undefined
      // OLD format: Attendance 7th, Attendance 14th
      const isOldFormat = key.startsWith('Attendance ') && hasValue
      // NEW format: attendance_2025_12_07
      const isNewFormat = /^attendance_\d{4}_\d{2}_\d{2}$/.test(keyLower) && hasValue
      return isOldFormat || isNewFormat
    })

    if (attendanceColumns.length === 0) return 0

    const presentCount = attendanceColumns.filter(col =>
      member[col] === 'Present' || member[col] === true
    ).length

    return Math.round((presentCount / attendanceColumns.length) * 100)
  }

  // Calculate member badge based on attendance and join date
  const calculateMemberBadge = (member) => {
    const joinDate = new Date(member['Join Date'] || member.inserted_at)
    const now = new Date()
    const daysSinceJoin = Math.floor((now - joinDate) / (1000 * 60 * 60 * 24))
    const attendanceRate = calculateAttendanceRate(member)

    // Check for manual badge first
    if (member['Manual Badge']) {
      return member['Manual Badge']
    }

    // New member (less than 30 days)
    if (daysSinceJoin < 30) {
      return 'newcomer'
    }

    // Regular member badges based on attendance
    if (attendanceRate >= 75) {
      return 'regular'
    } else if (attendanceRate >= 50) {
      return 'member'
    } else {
      return 'newcomer'
    }
  }

  // Update member badges for all members
  const updateMemberBadges = () => {
    setMembers(prev => prev.map(member => ({
      ...member,
      // Only update Badge Type if there's no Manual Badge assigned
      'Badge Type': member['Manual Badge'] || calculateMemberBadge(member),
      'Attendance Rate': calculateAttendanceRate(member)
    })))
  }

  // Toggle badge for member (supports multiple badges) - similar to attendance toggle
  const toggleMemberBadge = async (memberId, badgeType, options = {}) => {
    try {
      const { suppressToast = false } = options
      console.log(`Toggling ${badgeType} badge for member ${memberId}`)
      console.log('Supabase configured:', isSupabaseConfigured())
      console.log('Current table:', currentTable)

      // Find the member and log their current badge status
      const member = members.find(m => m.id === memberId)
      const memberName = member ? (member['Full Name'] || member['full_name']) : 'Member'
      console.log('Member found:', memberName)
      console.log('Current badge values:', {
        Member: member?.Member,
        Regular: member?.Regular,
        Newcomer: member?.Newcomer,
        'Manual Badges': member?.['Manual Badges']
      })

      if (!isSupabaseConfigured()) {
        // Demo mode - update local state
        setMembers(prev => prev.map(member => {
          if (member.id === memberId) {
            const currentBadges = member['Manual Badges'] || []
            let updatedBadges

            if (currentBadges.includes(badgeType)) {
              // Remove badge if already selected
              updatedBadges = currentBadges.filter(badge => badge !== badgeType)
            } else {
              // Add badge if not selected
              updatedBadges = [...currentBadges, badgeType]
            }

            const updatedMember = { ...member, 'Manual Badges': updatedBadges }
            return updatedMember
          }
          return member
        }))
        return { success: true }
      }

      // For Supabase, handle individual badge toggling like attendance
      const targetMember = members.find(m => m.id === memberId)

      // Check current badge status - this determines if we're turning ON or OFF
      const currentlyHasBadge = memberHasBadge(targetMember, badgeType)
      console.log(`Current badge status for ${badgeType}:`, currentlyHasBadge)

      // Prepare update object - toggle the badge state
      const updateData = {}

      // Update the specific badge column (toggle: if has badge, remove it; if doesn't have badge, add it)
      if (badgeType === 'member') {
        updateData.Member = currentlyHasBadge ? null : 'Yes'
      } else if (badgeType === 'regular') {
        updateData.Regular = currentlyHasBadge ? null : 'Yes'
      } else if (badgeType === 'newcomer') {
        updateData.Newcomer = currentlyHasBadge ? null : 'Yes'
      }

      console.log('Update data:', updateData)
      console.log('Updating member ID:', memberId)

      const { data, error } = await supabase
        .from(currentTable)
        .update(updateData)
        .eq('id', memberId)
        .select()

      console.log('Supabase update result:', { data, error })

      if (error) throw error

      // Update local state to reflect the change
      setMembers(prev => prev.map(member => {
        if (member.id === memberId) {
          const updatedMember = { ...member }

          // Update the specific badge column in local state
          if (badgeType === 'member') {
            updatedMember.Member = currentlyHasBadge ? null : 'Yes'
          } else if (badgeType === 'regular') {
            updatedMember.Regular = currentlyHasBadge ? null : 'Yes'
          } else if (badgeType === 'newcomer') {
            updatedMember.Newcomer = currentlyHasBadge ? null : 'Yes'
          }

          return updatedMember
        }
        return member
      }))

      // Show success message like attendance system (unless suppressed)
      if (!suppressToast) {
        if (currentlyHasBadge) {
          toast.success(`${badgeType.charAt(0).toUpperCase() + badgeType.slice(1)} badge removed for: ${memberName}`, {
            style: {
              background: '#f3f4f6',
              color: '#374151'
            }
          })
        } else {
          toast.success(`${badgeType.charAt(0).toUpperCase() + badgeType.slice(1)} badge assigned to: ${memberName}`, {
            style: {
              background: '#10b981',
              color: '#ffffff'
            }
          })
        }
      }

      // Log the action
      logActivity(
        currentlyHasBadge ? 'REMOVE_BADGE' : 'ASSIGN_BADGE',
        `${currentlyHasBadge ? 'Removed' : 'Assigned'} ${badgeType} badge for ${memberName}`
      )

      return { success: true }
    } catch (error) {
      console.error('Error toggling badge:', error)
      toast.error('Failed to update badge. Please try again.')
      return { success: false, error }
    }
  }

  const findAttendanceColumnForDate = async (date) => {
    try {
      const attendanceColumns = await getAttendanceColumns()
      const dayOfMonth = date.getDate()
      const month = date.getMonth() + 1 // 0-indexed to 1-indexed
      const year = date.getFullYear()

      // Find the column that matches this date
      const matchingColumn = attendanceColumns.find(col => {
        const colName = col.column_name.toLowerCase()

        // NEW format: attendance_2025_12_07 (year_month_day)
        const newFormatMatch = colName.match(/attendance_(\d{4})_(\d{2})_(\d{2})/)
        if (newFormatMatch) {
          const [, colYear, colMonth, colDay] = newFormatMatch
          return parseInt(colYear) === year &&
            parseInt(colMonth) === month &&
            parseInt(colDay) === dayOfMonth
        }

        // OLD format: Attendance 7th, attendance_7th
        const oldFormatMatch = col.column_name.match(/[Aa]ttendance[_ ](\d+)(st|nd|rd|th)?/)
        if (oldFormatMatch) {
          return parseInt(oldFormatMatch[1]) === dayOfMonth
        }

        return false
      })

      return matchingColumn ? matchingColumn.column_name : null
    } catch (error) {
      console.error('Error finding attendance column for date:', error)
      return null
    }
  }

  const getAttendanceColumnsForTable = useCallback(async (tableName) => {
    try {
      if (!isSupabaseConfigured()) return []
      if (!tableName) return []

      const { data, error } = await supabase.rpc('get_table_columns', {
        table_name: tableName
      })

      if (error) {
        console.error('Error getting table columns:', error)
        return []
      }

      return data?.filter(col => {
        const name = col.column_name
        const nameLower = name.toLowerCase()
        const isOldFormat = name.startsWith('Attendance ')
        const isNewFormat = /^attendance_\d{4}_\d{2}_\d{2}$/.test(nameLower)
        return isOldFormat || isNewFormat
      }) || []
    } catch (error) {
      console.error('Error getting table columns:', error)
      return []
    }
  }, [isSupabaseConfigured])

  const findAttendanceColumnForDateInTable = useCallback(async (date, tableName) => {
    try {
      const attendanceColumns = await getAttendanceColumnsForTable(tableName)
      const dayOfMonth = date.getDate()
      const month = date.getMonth() + 1
      const year = date.getFullYear()

      const matchingColumn = attendanceColumns.find(col => {
        const colName = col.column_name.toLowerCase()
        const newFormatMatch = colName.match(/attendance_(\d{4})_(\d{2})_(\d{2})/)
        if (newFormatMatch) {
          const [, colYear, colMonth, colDay] = newFormatMatch
          return parseInt(colYear) === year &&
            parseInt(colMonth) === month &&
            parseInt(colDay) === dayOfMonth
        }

        const oldFormatMatch = col.column_name.match(/[Aa]ttendance[_ ](\d+)(st|nd|rd|th)?/)
        if (oldFormatMatch) {
          return parseInt(oldFormatMatch[1]) === dayOfMonth
        }

        return false
      })

      return matchingColumn ? matchingColumn.column_name : null
    } catch (error) {
      console.error('Error finding attendance column for date:', error)
      return null
    }
  }, [getAttendanceColumnsForTable])

  // Check if attendance column exists in the current table
  const checkAttendanceColumnExists = async (attendanceColumn) => {
    try {
      if (!isSupabaseConfigured()) return true

      // Get all attendance columns and check if the requested one exists
      const attendanceColumns = await getAttendanceColumns()
      return attendanceColumns.some(col => col.column_name === attendanceColumn)
    } catch (error) {
      console.error('Error checking attendance column:', error)
      return false
    }
  }

  // Create attendance column for a specific date if it doesn't exist
  const createAttendanceColumn = async (date) => {
    try {
      if (!isSupabaseConfigured()) return { success: true }

      const year = date.getFullYear()
      const month = String(date.getMonth() + 1).padStart(2, '0')
      const day = String(date.getDate()).padStart(2, '0')

      // New format: attendance_2025_12_07
      const columnName = `attendance_${year}_${month}_${day}`

      console.log(`Creating attendance column: ${columnName} in table ${currentTable}`)

      // Use Supabase RPC to add the column (requires a DB function)
      // For now, we'll use a direct SQL approach via rpc
      const { data, error } = await supabase.rpc('add_attendance_column', {
        table_name: currentTable,
        column_name: columnName
      })

      if (error) {
        console.error('Error creating attendance column:', error)
        // If the RPC doesn't exist, provide helpful error message
        if (error.message?.includes('function') || error.code === '42883') {
          toast.error('Please create the add_attendance_column function in Supabase. See documentation.')
        }
        throw error
      }

      console.log(`Successfully created column: ${columnName}`)
      return { success: true, columnName }
    } catch (error) {
      console.error('Failed to create attendance column:', error)
      return { success: false, error }
    }
  }

  // Mark attendance for a member in monthly table
  const markAttendance = async (memberId, date, present) => {
    try {
      if (!isSupabaseConfigured()) {
        // Demo mode - update local state
        const dateKey = getLocalDateString(date)
        setAttendanceData(prev => ({
          ...prev,
          [dateKey]: {
            ...prev[dateKey],
            [memberId]: present
          }
        }))
        toast.success(`Attendance marked! (Demo Mode)`)
        return { success: true }
      }

      let attendanceColumn = await findAttendanceColumnForDate(date)

      // If column doesn't exist, create it
      if (!attendanceColumn) {
        console.log(`Attendance column not found for date, creating it...`)
        const result = await createAttendanceColumn(date)

        if (!result.success) {
          toast.error(`Failed to create attendance column for this date`)
          return { success: false, error: 'Failed to create column' }
        }

        attendanceColumn = result.columnName
        // Refresh members to get the new column
        await fetchMembers(currentTable)
      }

      const { data, error } = await supabase
        .from(currentTable)
        .update({
          [attendanceColumn]: present === null ? null : (present ? 'Present' : 'Absent')
        })
        .eq('id', memberId)

      if (error) throw error

      // Update local state for members
      setMembers(prev => prev.map(member =>
        member.id === memberId
          ? { ...member, [attendanceColumn]: present === null ? null : (present ? 'Present' : 'Absent') }
          : member
      ))

      // Update local state for attendanceData (for real-time UI updates)
      // Use local date format to avoid timezone issues
      const year = date.getFullYear()
      const month = String(date.getMonth() + 1).padStart(2, '0')
      const day = String(date.getDate()).padStart(2, '0')
      const dateKey = `${year}-${month}-${day}`
      setAttendanceData(prev => ({
        ...prev,
        [dateKey]: {
          ...prev[dateKey],
          [memberId]: present
        }
      }))

      // Check if month is complete and process badges (guarded)
      if (badgeProcessingEnabled) {
        setTimeout(() => processEndOfMonthBadges(), 500)
      }

      // Log the attendance action
      const memberName = members.find(m => m.id === memberId)?.['full_name'] || members.find(m => m.id === memberId)?.['Full Name'] || 'Unknown'
      const attendanceStatus = present === null ? 'Cleared' : present ? 'Present' : 'Absent'
      logActivity('MARK_ATTENDANCE', `Marked ${memberName} as ${attendanceStatus} on ${date.toLocaleDateString()}`)

      return { success: true }
    } catch (error) {
      console.error('Error marking attendance:', error)
      toast.error('Failed to mark attendance')
      return { success: false, error }
    }
  }

  // Check if ALL Sundays from first to last in the month are filled
  const isMonthAttendanceComplete = () => {
    if (availableSundayDates.length === 0) return false

    // Check that EVERY Sunday has attendance data for at least 1 member
    for (const sunday of availableSundayDates) {
      const dateKey = getLocalDateString(sunday)
      const attendanceForDate = attendanceData[dateKey]

      // If this Sunday has no attendance data at all, month is not complete
      if (!attendanceForDate || Object.keys(attendanceForDate).length === 0) {
        console.log(`Month not complete: Sunday ${dateKey} has no attendance data`)
        return false
      }
    }

    // All Sundays from first to last have attendance data
    console.log(`Month attendance complete: All ${availableSundayDates.length} Sundays have attendance data`)
    return true
  }

  // Check for 3 consecutive Sunday attendances for a member in current month
  const checkMemberConsecutiveAttendance = (memberId) => {
    if (availableSundayDates.length < 3) return false

    const sortedSundays = [...availableSundayDates].sort((a, b) => a - b)
    let consecutiveCount = 0

    for (const sunday of sortedSundays) {
      const dateKey = getLocalDateString(sunday)
      const memberStatus = attendanceData[dateKey]?.[memberId]

      if (memberStatus === true) {
        consecutiveCount++
        if (consecutiveCount >= 3) {
          return true // Found 3 consecutive
        }
      } else if (memberStatus === false) {
        consecutiveCount = 0 // Reset on absent
      }
      // If undefined/null, treat as absent and reset
      else {
        consecutiveCount = 0
      }
    }

    return false
  }

  // Toggleable guard to prevent runaway badge processing loops
  const badgeProcessingEnabled = false

  // Process all members at end of month and assign badges
  const processedEndOfMonthRef = useRef(new Set())
  const processEndOfMonthBadges = async () => {
    try {
      if (!badgeProcessingEnabled) return
      if (!isSupabaseConfigured()) return
      if (!isMonthAttendanceComplete()) {
        console.log('Month attendance not complete yet, skipping badge assignment')
        return
      }

      console.log('Processing end-of-month badges for', currentTable)
      let badgesAssigned = 0

      for (const member of members) {
        // Check if member has 3 consecutive Sundays
        const hasThreeConsecutive = checkMemberConsecutiveAttendance(member.id)

        if (hasThreeConsecutive) {
          // Only update if not already a regular or higher badge
          if (member['Badge Type'] !== 'regular' && member['Badge Type'] !== 'vip') {
            await updateMember(member.id, {
              'Badge Type': 'regular',
              'Member Status': 'Member'
            }, { silent: true })
            badgesAssigned++
            console.log(`Assigned regular badge to ${member['full_name'] || member['Full Name']}`)
          }
        }
        // If they don't have 3 consecutive, keep their current badge (don't downgrade)
      }

      if (badgesAssigned > 0) {
        toast.success(`🎉 End of month: ${badgesAssigned} member${badgesAssigned > 1 ? 's' : ''} earned Regular Member badge!`)
      }
      processedEndOfMonthRef.current.add(currentTable)
    } catch (error) {
      console.error('Error processing end-of-month badges:', error)
    }
  }

  // Bulk attendance marking for monthly table
  const bulkAttendance = async (memberIds, date, present) => {
    try {
      if (!isSupabaseConfigured()) {
        // Demo mode - update local state
        const dateKey = getLocalDateString(date)
        const updates = {}
        memberIds.forEach(id => {
          updates[id] = present
        })
        setAttendanceData(prev => ({
          ...prev,
          [dateKey]: {
            ...prev[dateKey],
            ...updates
          }
        }))
        toast.success(`Bulk attendance marked! (Demo Mode)`)
        return { success: true }
      }

      const attendanceColumn = await findAttendanceColumnForDate(date)

      if (!attendanceColumn) {
        toast.error(`No attendance column found for this date in ${currentTable}`)
        return { success: false, error: 'Column does not exist' }
      }

      const attendanceValue = present ? 'Present' : 'Absent'

      // Update each member's attendance in the monthly table
      const updatePromises = memberIds.map(memberId =>
        supabase
          .from(currentTable)
          .update({ [attendanceColumn]: attendanceValue })
          .eq('id', memberId)
      )

      const results = await Promise.all(updatePromises)

      // Check for errors
      const errors = results.filter(result => result.error)
      if (errors.length > 0) {
        throw new Error(`Failed to update ${errors.length} records`)
      }

      // Update local state for members
      setMembers(prev => prev.map(member =>
        memberIds.includes(member.id)
          ? { ...member, [attendanceColumn]: attendanceValue }
          : member
      ))

      // Update local state for attendanceData (for real-time UI updates)
      const dateKey = getLocalDateString(date)
      const updates = {}
      memberIds.forEach(id => {
        updates[id] = present
      })
      setAttendanceData(prev => ({
        ...prev,
        [dateKey]: {
          ...prev[dateKey],
          ...updates
        }
      }))

      // Check if month is complete and process badges
      if (badgeProcessingEnabled) {
        setTimeout(() => processEndOfMonthBadges(), 500)
      }

      toast.success(`Bulk attendance marked successfully for ${memberIds.length} members!`)
      return { success: true }
    } catch (error) {
      console.error('Error marking bulk attendance:', error)
      toast.error('Failed to mark bulk attendance')
      return { success: false, error }
    }
  }

  // Fetch attendance for a specific date from monthly table
  const fetchAttendanceForDate = async (date) => {
    try {
      if (!isSupabaseConfigured()) {
        // Demo mode - return mock attendance data
        const dateKey = getLocalDateString(date)
        return attendanceData[dateKey] || {}
      }

      const attendanceColumn = await findAttendanceColumnForDate(date)

      if (!attendanceColumn) {
        appContextLog(`No attendance column found for this date in ${currentTable}`)
        return {}
      }

      // Paginate to avoid Supabase default 1000-row cap
      let allRecords = []
      let fetchOff = 0
      const PG_SIZE = 1000
      while (true) {
        const { data: pg, error: pgErr } = await supabase
          .from(currentTable)
          .select(`id, "${attendanceColumn}"`)
          .range(fetchOff, fetchOff + PG_SIZE - 1)

        if (pgErr) throw pgErr
        if (!pg || pg.length === 0) break
        allRecords = allRecords.concat(pg)
        if (pg.length < PG_SIZE) break
        fetchOff += PG_SIZE
      }

      // Transform to object format - include both Present (true) and Absent (false)
      const attendanceMap = {}
      allRecords.forEach(record => {
        const value = record[attendanceColumn]
        if (value === 'Present') {
          attendanceMap[record.id] = true
        } else if (value === 'Absent') {
          attendanceMap[record.id] = false
        }
        // If value is null/undefined, don't add to map (no attendance marked yet)
      })

      return attendanceMap
    } catch (error) {
      console.error('Error fetching attendance:', error)
      return {}
    }
  }

  const fetchAttendanceForDateInTable = useCallback(async (date, tableName) => {
    try {
      if (!isSupabaseConfigured()) {
        const dateKey = getLocalDateString(date)
        return attendanceData[dateKey] || {}
      }
      if (!tableName) return {}

      const attendanceColumn = await findAttendanceColumnForDateInTable(date, tableName)

      if (!attendanceColumn) {
        appContextLog(`No attendance column found for this date in ${tableName}`)
        return {}
      }

      let allRecords = []
      let fetchOff = 0
      const PG_SIZE = 1000
      while (true) {
        const { data: pg, error: pgErr } = await supabase
          .from(tableName)
          .select(`id, "${attendanceColumn}"`)
          .range(fetchOff, fetchOff + PG_SIZE - 1)

        if (pgErr) throw pgErr
        if (!pg || pg.length === 0) break
        allRecords = allRecords.concat(pg)
        if (pg.length < PG_SIZE) break
        fetchOff += PG_SIZE
      }

      const attendanceMap = {}
      allRecords.forEach(record => {
        const value = record[attendanceColumn]
        if (value === 'Present') {
          attendanceMap[record.id] = true
        } else if (value === 'Absent') {
          attendanceMap[record.id] = false
        }
      })

      return attendanceMap
    } catch (error) {
      console.error('Error fetching attendance:', error)
      return {}
    }
  }, [attendanceData, findAttendanceColumnForDateInTable, isSupabaseConfigured])

  // Update member
  // Options: { silent: boolean, allowLocalFallback: boolean }
  const updateMember = async (id, updates, options = {}) => {
    const { silent = false, allowLocalFallback = false } = options
    try {
      if (!isSupabaseConfigured()) {
        // Demo mode - update local state
        const baseMember = members.find(m => m.id === id) || {}
        const updatedMember = { ...baseMember, ...updates }
        const updatedNameDemo = (
          typeof updates.full_name === 'string' && updates.full_name.trim()
        ) ? updates.full_name : (typeof updates['Full Name'] === 'string' ? updates['Full Name'] : undefined)
        if (updatedNameDemo !== undefined) {
          updatedMember['full_name'] = updatedNameDemo
          updatedMember['Full Name'] = updatedNameDemo
        }
        setMembers(prev => prev.map(m => m.id === id ? updatedMember : m))
        if (!silent) toast.success('Member updated successfully! (Demo Mode)')
        return updatedMember
      }

      // Defensive copy so we can safely normalize values
      let normalized = { ...updates }

      // Normalize name field using schema-aware detection
      const nameCol = await resolveNameColumn(currentTable)
      console.log('[updateMember] Resolved name column:', nameCol)
      const incomingName = (
        typeof normalized.full_name === 'string' && normalized.full_name.trim()
      ) ? normalized.full_name : (typeof normalized['Full Name'] === 'string' ? normalized['Full Name'] : undefined)
      console.log('[updateMember] Incoming name value:', incomingName)
      if (incomingName !== undefined) {
        normalized = { ...normalized, [nameCol]: incomingName }
        // Only delete the keys that are different from nameCol to avoid deleting the value we just set
        if (nameCol !== 'full_name') delete normalized.full_name
        if (nameCol !== 'Full Name') delete normalized['Full Name']
      }
      console.log('[updateMember] Normalized updates to send:', normalized)

      // Normalize gender to capitalized values the table expects
      const incomingGender = normalized.gender ?? normalized['Gender']
      if (typeof incomingGender === 'string') {
        const cap = incomingGender.trim().toLowerCase() === 'male' ? 'Male'
          : incomingGender.trim().toLowerCase() === 'female' ? 'Female'
            : incomingGender
        normalized = { ...normalized, Gender: cap }
        delete normalized.gender
      }

      // Normalize phone number (keep as string since column is TEXT)
      const incomingPhone = normalized.phone_number ?? normalized['Phone Number']
      if (incomingPhone !== undefined) {
        const phoneStr = String(incomingPhone || '').trim()
        normalized = { ...normalized, 'Phone Number': phoneStr || null }
        delete normalized.phone_number
      }

      // Normalize age (keep as string since column is TEXT)
      const incomingAge = normalized.age ?? normalized['Age']
      if (incomingAge !== undefined) {
        const ageStr = String(incomingAge ?? '').trim()
        normalized = { ...normalized, Age: ageStr || null }
        delete normalized.age
      }

      // Normalize Current Level field
      const incomingLevel = normalized.current_level ?? normalized['Current Level']
      if (incomingLevel !== undefined) {
        normalized = { ...normalized, 'Current Level': incomingLevel }
        delete normalized.current_level
      }

      // Normalize ministry to text because monthly tables store it as TEXT
      const incomingMinistry = normalized.ministry ?? normalized['Ministry']
      if (incomingMinistry !== undefined) {
        let ministryText = null
        if (Array.isArray(incomingMinistry)) {
          const cleaned = incomingMinistry
            .map(item => String(item || '').trim())
            .filter(Boolean)
          ministryText = cleaned.length > 0 ? cleaned.join(', ') : null
        } else if (typeof incomingMinistry === 'string') {
          const trimmed = incomingMinistry.trim()
          ministryText = trimmed.length > 0 ? trimmed : null
        } else if (incomingMinistry !== null) {
          ministryText = String(incomingMinistry)
        }
        normalized = { ...normalized, ministry: ministryText }
        delete normalized['Ministry']
      }

      // Get existing columns from the table to filter out non-existent fields
      let validColumns = null
      try {
        const { data: sampleRow } = await supabase.from(currentTable).select('*').limit(1)
        if (sampleRow && sampleRow.length > 0) {
          validColumns = new Set(Object.keys(sampleRow[0]))
          console.log('[updateMember] Valid columns in table:', Array.from(validColumns))
        }
      } catch (e) {
        console.warn('Could not fetch table schema, proceeding with all fields:', e)
      }

      // If validColumns not found (empty table or error), fallback to snake_case for standard fields
      if (!validColumns) {
        if (normalized['Phone Number'] !== undefined) {
          normalized['phone_number'] = normalized['Phone Number']
          delete normalized['Phone Number']
        }
        if (normalized['Age'] !== undefined) {
          normalized['age'] = normalized['Age']
          delete normalized['Age']
        }
        if (normalized['Gender'] !== undefined) {
          normalized['gender'] = normalized['Gender']
          delete normalized['Gender']
        }
        if (normalized['Current Level'] !== undefined) {
          normalized['current_level'] = normalized['Current Level']
          delete normalized['Current Level']
        }
        if (normalized['Full Name'] !== undefined) {
          // Only rename if 'Full Name' is present (fallback from resolveNameColumn)
          normalized['full_name'] = normalized['Full Name']
          delete normalized['Full Name']
        }
        if (normalized['Member'] !== undefined) {
          normalized['member'] = normalized['Member']
          delete normalized['Member']
        }
        if (normalized['Regular'] !== undefined) {
          normalized['regular'] = normalized['Regular']
          delete normalized['Regular']
        }
        if (normalized['Newcomer'] !== undefined) {
          normalized['newcomer'] = normalized['Newcomer']
          delete normalized['Newcomer']
        }
      }

      // Filter normalized object to only include valid columns if we know them
      if (validColumns) {
        const filteredNormalized = {}
        for (const key of Object.keys(normalized)) {
          if (validColumns.has(key)) {
            filteredNormalized[key] = normalized[key]
          } else {
            // Try alternative column names for name field
            if (key === 'Full Name' && validColumns.has('full_name')) {
              filteredNormalized['full_name'] = normalized[key]
              console.log('[updateMember] Mapped "Full Name" to "full_name"')
            } else if (key === 'full_name' && validColumns.has('Full Name')) {
              filteredNormalized['Full Name'] = normalized[key]
              console.log('[updateMember] Mapped "full_name" to "Full Name"')
            } else if ((key === 'Full Name' || key === 'full_name') && validColumns.has('name')) {
              filteredNormalized['name'] = normalized[key]
              console.log('[updateMember] Mapped to "name"')
            } else if ((key === 'Full Name' || key === 'full_name') && validColumns.has('Name')) {
              filteredNormalized['Name'] = normalized[key]
              console.log('[updateMember] Mapped to "Name"')
            } else if (key === 'Phone Number' && validColumns.has('phone_number')) {
              filteredNormalized['phone_number'] = normalized[key]
              console.log('[updateMember] Mapped "Phone Number" to "phone_number"')
            } else if (key === 'phone_number' && validColumns.has('Phone Number')) {
              filteredNormalized['Phone Number'] = normalized[key]
              console.log('[updateMember] Mapped "phone_number" to "Phone Number"')
            } else if (key === 'Age' && validColumns.has('age')) {
              filteredNormalized['age'] = normalized[key]
              console.log('[updateMember] Mapped "Age" to "age"')
            } else if (key === 'age' && validColumns.has('Age')) {
              filteredNormalized['Age'] = normalized[key]
              console.log('[updateMember] Mapped "age" to "Age"')
            } else if (key === 'Gender' && validColumns.has('gender')) {
              filteredNormalized['gender'] = normalized[key]
              console.log('[updateMember] Mapped "Gender" to "gender"')
            } else if (key === 'gender' && validColumns.has('Gender')) {
              filteredNormalized['Gender'] = normalized[key]
              console.log('[updateMember] Mapped "gender" to "Gender"')
            } else if (key === 'Current Level' && validColumns.has('current_level')) {
              filteredNormalized['current_level'] = normalized[key]
              console.log('[updateMember] Mapped "Current Level" to "current_level"')
            } else if (key === 'current_level' && validColumns.has('Current Level')) {
              filteredNormalized['Current Level'] = normalized[key]
              console.log('[updateMember] Mapped "current_level" to "Current Level"')
            } else if (key === 'parent_name_1' && validColumns.has('Parent Name 1')) {
              filteredNormalized['Parent Name 1'] = normalized[key]
            } else if (key === 'parent_phone_1' && validColumns.has('Parent Phone 1')) {
              filteredNormalized['Parent Phone 1'] = normalized[key]
            } else if (key === 'parent_name_2' && validColumns.has('Parent Name 2')) {
              filteredNormalized['Parent Name 2'] = normalized[key]
            } else if (key === 'parent_phone_2' && validColumns.has('Parent Phone 2')) {
              filteredNormalized['Parent Phone 2'] = normalized[key]
            } else if (key === 'notes' && validColumns.has('notes')) {
              filteredNormalized['notes'] = normalized[key]
              console.log('[updateMember] Including notes field')
            } else if (key === 'ministry' && validColumns.has('ministry')) {
              filteredNormalized['ministry'] = normalized[key]
              console.log('[updateMember] Including ministry field')
            } else if (key === 'is_visitor' && validColumns.has('is_visitor')) {
              filteredNormalized['is_visitor'] = normalized[key]
              console.log('[updateMember] Including is_visitor field')
            } else if (key === 'Member' && validColumns.has('member')) {
              filteredNormalized['member'] = normalized[key]
            } else if (key === 'member' && validColumns.has('Member')) {
              filteredNormalized['Member'] = normalized[key]
            } else if (key === 'Regular' && validColumns.has('regular')) {
              filteredNormalized['regular'] = normalized[key]
            } else if (key === 'regular' && validColumns.has('Regular')) {
              filteredNormalized['Regular'] = normalized[key]
            } else if (key === 'Newcomer' && validColumns.has('newcomer')) {
              filteredNormalized['newcomer'] = normalized[key]
            } else if (key === 'newcomer' && validColumns.has('Newcomer')) {
              filteredNormalized['Newcomer'] = normalized[key]
            } else {
              console.warn(`Skipping field "${key}" - column does not exist in table ${currentTable}`)
            }
          }
        }
        normalized = filteredNormalized
      }
      console.log('[updateMember] Final normalized data to send:', normalized)

      // Ensure we have something to update
      if (Object.keys(normalized).length === 0) {
        console.warn('No valid fields to update after filtering')
        if (!silent) toast.info('No changes to save')
        return members.find(m => m.id === id)
      }

      const optimisticPatch = { ...updates, ...normalized }

      const { error } = await supabase
        .from(currentTable)
        .update(normalized)
        .eq('id', id)

      if (error) throw error

      // Update members state with optimistic patch
      setMembers(prev => {
        const updatedRow = {}
        const updatedName = (
          typeof updatedRow['full_name'] === 'string' && updatedRow['full_name'].trim()
        ) ? updatedRow['full_name']
          : (typeof updatedRow['Full Name'] === 'string' ? updatedRow['Full Name']
            : (typeof updates.full_name === 'string' && updates.full_name.trim() ? updates.full_name
              : (typeof updates['Full Name'] === 'string' ? updates['Full Name'] : undefined)))
        console.log('Updating member in state:', id, 'with name:', updatedName)
        console.log('Updated row data:', updatedRow)
        const updatedMembers = prev.map(m => {
          if (m.id !== id) return m
          const merged = { ...m, ...optimisticPatch, ...updatedRow }
          if (updatedName !== undefined) {
            merged['full_name'] = updatedName
            merged['Full Name'] = updatedName
          }
          const resolvedPhone = updates['Phone Number'] ?? updates.phone_number
          if (resolvedPhone !== undefined) {
            merged['Phone Number'] = resolvedPhone
            merged.phone_number = resolvedPhone
          }
          const resolvedAge = updates['Age'] ?? updates.age
          if (resolvedAge !== undefined) {
            merged['Age'] = resolvedAge
            merged.age = resolvedAge
          }
          const resolvedLevel = updates['Current Level'] ?? updates.current_level
          if (resolvedLevel !== undefined) {
            merged['Current Level'] = resolvedLevel
            merged.current_level = resolvedLevel
          }
          console.log('Merged member after update:', merged)
          return merged
        })
        console.log('Updated members array:', updatedMembers)
        return updatedMembers
      })

      // Update search term to trigger re-filtering
      refreshSearch()

      // Invalidate stale caches and force fresh pull so all views update instantly
      searchCacheRef.current.clear()
      const cacheKey = currentTable || 'default'
      membersCacheRef.current.delete(cacheKey)
      try {
        await fetchMembers(currentTable, { forceRefresh: true })
      } catch (refreshErr) {
        console.warn('[updateMember] Post-update refresh failed, using optimistic state:', refreshErr)
      }

      if (!silent) toast.success(`Member updated successfully in ${currentTable}!`)

      // Log the action
      const memberName = members.find(m => m.id === id)?.['full_name'] || members.find(m => m.id === id)?.['Full Name'] || 'Unknown'
      logActivity('UPDATE_MEMBER', `Updated member: ${memberName}`)

      return members.find(m => m.id === id)
    } catch (error) {
      console.error('Error updating member:', error)
      if (allowLocalFallback) {
        const fallbackName = (
          typeof updates.full_name === 'string' && updates.full_name.trim()
        ) ? updates.full_name : (typeof updates['Full Name'] === 'string' ? updates['Full Name'] : undefined)
        setMembers(prev => prev.map(m => {
          if (m.id !== id) return m
          const merged = { ...m, ...updates }
          if (fallbackName !== undefined) {
            merged['full_name'] = fallbackName
            merged['Full Name'] = fallbackName
          }
          return merged
        }))
        refreshSearch()
        if (!silent) toast.info('Saved locally on this device')
        return members.find(m => m.id === id)
      }
      toast.error('Failed to update member')
      throw error
    }
  }

  // Delete member
  const deleteMember = async (memberId) => {
    console.log(`[DELETE] Starting deletion for member ID: ${memberId}`)

    // Validate memberId
    if (!memberId) {
      console.error('[DELETE] Error: No member ID provided')
      toast.error('Error: Invalid member ID')
      return { success: false }
    }

    // Support deletion in demo mode by updating local state so mobile users on static deployments can manage entries
    if (!isSupabaseConfigured()) {
      console.log(`[DELETE] Demo mode - deleting member ${memberId} from local state`)
      setMembers(prevMembers => {
        const updated = prevMembers.filter(member => member.id !== memberId)
        console.log(`[DELETE] Members before: ${prevMembers.length}, after: ${updated.length}`)
        return updated
      })
      // Also remove from attendanceData snapshots to keep UI consistent
      setAttendanceData(prev => {
        const next = {}
        Object.entries(prev).forEach(([dateKey, map]) => {
          const { [memberId]: _removed, ...rest } = map || {}
          next[dateKey] = rest
        })
        return next
      })
      refreshSearch()
      toast.success('Member deleted (Demo Mode)')
      return { success: true }
    }

    setLoading(true)
    try {
      console.log(`[DELETE] Attempting Supabase delete from table: ${currentTable}, member ID: ${memberId}`)

      let deleted = false

      // Attempt 1: Direct delete with .select() to verify rows were actually removed
      const { data, error } = await supabase
        .from(currentTable)
        .delete()
        .eq('id', memberId)
        .select()

      console.log(`[DELETE] Direct delete response - Error: ${error ? error.message : 'none'}, Rows deleted:`, data?.length || 0, data)

      if (error) {
        console.warn(`[DELETE] Direct delete error (will try RPC fallback):`, error.message)
      } else if (data && data.length > 0) {
        deleted = true
        console.log(`[DELETE] Direct delete succeeded - ${data.length} row(s) removed`)
      }

      // Attempt 2: If direct delete returned 0 rows (RLS silently blocked), try RPC
      if (!deleted) {
        console.log(`[DELETE] Direct delete returned 0 rows (likely RLS blocking). Trying RPC fallback...`)
        const { data: rpcResult, error: rpcError } = await supabase.rpc('delete_member_by_id', {
          target_table: currentTable,
          member_id: memberId
        })

        console.log(`[DELETE] RPC response - Error: ${rpcError ? rpcError.message : 'none'}, Result:`, rpcResult)

        if (!rpcError) {
          deleted = true
        } else {
          console.warn(`[DELETE] RPC fallback failed:`, rpcError.message)
        }
      }

      // Attempt 3: Verify the row is actually gone from the database
      const { data: verifyData } = await supabase
        .from(currentTable)
        .select('id')
        .eq('id', memberId)
        .maybeSingle()

      if (verifyData) {
        console.error(`[DELETE] VERIFICATION FAILED - member ${memberId} still exists in ${currentTable}`)
        console.error(`[DELETE] This means RLS policies are blocking DELETE. You need to add a DELETE policy in Supabase.`)
        console.error(`[DELETE] Go to Supabase Dashboard > Authentication > Policies > ${currentTable} > Add policy:`)
        console.error(`[DELETE]   Policy name: "Allow authenticated users to delete"`)
        console.error(`[DELETE]   Operation: DELETE`)
        console.error(`[DELETE]   Target roles: authenticated`)
        console.error(`[DELETE]   USING expression: true`)
        console.error(`[DELETE] Or run this SQL in the Supabase SQL Editor:`)
        console.error(`[DELETE]   CREATE POLICY "Allow delete for authenticated" ON "${currentTable}" FOR DELETE TO authenticated USING (true);`)
        throw new Error(`Delete blocked by database policy. Please add a DELETE policy for the "${currentTable}" table in Supabase. Check browser console for instructions.`)
      }

      console.log(`[DELETE] VERIFIED - member ${memberId} successfully removed from ${currentTable}`)

      // Confirmed deleted — now update local state
      setMembers(prevMembers => {
        const updated = prevMembers.filter(member => member.id !== memberId)
        console.log(`[DELETE] Members state updated: ${prevMembers.length} -> ${updated.length}`)
        return updated
      })

      // Also remove from attendanceData snapshots to keep UI consistent
      setAttendanceData(prev => {
        const next = {}
        Object.entries(prev).forEach(([dateKey, map]) => {
          const { [memberId]: _removed, ...rest } = map || {}
          next[dateKey] = rest
        })
        return next
      })

      // Clear search results to force re-filtering with updated members
      setServerSearchResults(prev => {
        if (!prev) return null
        // Filter out the deleted member from search results
        const filtered = prev.filter(member => member.id !== memberId)
        console.log(`[DELETE] Search results updated: ${prev.length} -> ${filtered.length}`)
        return filtered.length > 0 ? filtered : null
      })

      // Invalidate caches so refreshSearch / fetchMembers don't restore stale data
      searchCacheRef.current.clear()
      const cacheKey = currentTable || 'default'
      membersCacheRef.current.delete(cacheKey)
      try {
        await fetchMembers(currentTable)
      } catch (refreshErr) {
        console.warn('[DELETE] Post-delete refresh failed, keeping optimistic UI state:', refreshErr)
      }
      console.log(`[DELETE] Member ${memberId} deleted successfully and UI updated`)
      toast.success('Member deleted')
      logActivity('DELETE_MEMBER', `Deleted member ID: ${memberId}`)
      return { success: true }
    } catch (error) {
      console.error(`[DELETE] Error deleting member ${memberId}:`, error)
      toast.error(error.message || 'Error deleting member')
      return { success: false, error }
    } finally {
      setLoading(false)
    }
  }

  const ensureTableReady = useCallback(async (tableName, attempts = 5, delay = 800) => {
    if (!isSupabaseConfigured()) return true
    for (let attempt = 0; attempt < attempts; attempt++) {
      try {
        const { error } = await supabase
          .from(tableName)
          .select('id')
          .limit(1)
        if (!error || error.code === 'PGRST116') {
          return true
        }
        if (error.code !== 'PGRST205') {
          console.error(`ensureTableReady unexpected error for ${tableName}:`, error)
        }
      } catch (err) {
        console.error(`ensureTableReady threw for ${tableName}:`, err)
      }
      await sleep(delay)
    }
    throw new Error(`Table ${tableName} is not ready yet. Please try again in a moment.`)
  }, [isSupabaseConfigured])

  // Fetch available month tables from database
  const fetchMonthlyTables = useCallback(async () => {
    // Helper to clear invalid table selection
    const clearInvalidTable = () => {
      console.log('Clearing invalid/empty table selection')
      if (currentTable && currentTable === DEFAULT_COLLAB_TABLE) {
        changeCurrentTable(null)
      }
    }

    try {
      const resolveFallbackTables = () => {
        try {
          const storageKey = isCollaborator && dataOwnerId ? `selectedMonthTable_${dataOwnerId}` : 'selectedMonthTable'
          const localSaved = typeof window !== 'undefined' ? localStorage.getItem(storageKey) : null
          const prefSaved = authContext?.preferences?.current_month_table
          const fallback = prefSaved || localSaved || currentTable
          if (fallback) {
            setMonthlyTables(sortMonthTables([fallback]))
            if (!currentTable) {
              changeCurrentTable(fallback)
            }
            return true
          }
        } catch (err) {
          console.warn('Failed to resolve fallback month tables:', err)
        }
        return false
      }

      // 1. Check configuration
      if (!isSupabaseConfigured()) {
        setMonthlyTables(FALLBACK_MONTHLY_TABLES)
        return
      }

      // 2. Identify whose data we are fetching
      const ownerId = dataOwnerId || user?.id
      if (!ownerId) {
        // No user/owner identified yet
        setMonthlyTables([])
        clearInvalidTable()
        return
      }

      appContextLog(`Fetching monthly tables for owner: ${ownerId} (Am I collaborator? ${isCollaborator})`)

      // 3. Fetch tables using RPC to bypass RLS for collaborators
      // We use 'get_available_month_tables' which checks 'collaborators' table for permission
      const { data, error } = await supabase.rpc('get_available_month_tables', {
        target_user_id: ownerId
      })

      if (error) {
        // If RPC is missing (legacy), try fallback to direct select if we are the owner
        // For collaborators, direct select will fail RLS, so we rely on RPC.
        console.error('Error fetching monthly tables via RPC:', error)

        if (!isCollaborator) {
          const { data: directData, error: directError } = await supabase
            .from('user_month_tables')
            .select('table_name')
            .eq('user_id', ownerId)

          if (!directError && directData) {
            const tableNames = directData.map(entry => entry.table_name).filter(Boolean)
            setMonthlyTables(sortMonthTables(tableNames))
            return
          }
        }

        // If everything fails
        if (resolveFallbackTables()) return
        setMonthlyTables([])
        return
      }

      // 4. Process results
      const tableNames = (data || []).map(entry => entry.table_name).filter(Boolean)

      if (tableNames.length === 0) {
        console.log('No tables found for this user/owner.')
        if (isCollaborator && ownerStickyMonth) {
          setMonthlyTables(sortMonthTables([ownerStickyMonth]))
          if (!currentTable) {
            changeCurrentTable(ownerStickyMonth)
          }
          return
        }
        if (!isCollaborator) {
          const { data: directData, error: directError } = await supabase
            .from('user_month_tables')
            .select('table_name')
            .eq('user_id', ownerId)

          if (!directError && directData) {
            const directTables = directData.map(entry => entry.table_name).filter(Boolean)
            if (directTables.length > 0) {
              setMonthlyTables(sortMonthTables(directTables))
              return
            }
          }
        }
        if (resolveFallbackTables()) return
        setMonthlyTables([])
        clearInvalidTable()
        return
      }

      // 5. Update state
      setMonthlyTables(sortMonthTables(tableNames))

    } catch (error) {
      console.error('Unexpected error in fetchMonthlyTables:', error)
      // Do not force fallback tables on error to avoid "ghost" months
    }
  }, [
    isSupabaseConfigured,
    dataOwnerId,
    user?.id,
    isCollaborator,
    ownerStickyMonth,
    changeCurrentTable,
    authContext?.preferences?.current_month_table,
    currentTable
  ])

  const deleteMonthTable = useCallback(async (tableName) => {
    if (!tableName) return
    try {
      if (!isSupabaseConfigured()) {
        setMonthlyTables(prev => {
          const nextTables = sortMonthTables(prev.filter(t => t !== tableName))
          if (currentTable === tableName) {
            const fallback = nextTables[nextTables.length - 1] || null
            changeCurrentTable(fallback)
          }
          return nextTables
        })
        toast.info(`${tableName.replace('_', ' ')} removed (Demo Mode)`)
        return { success: true }
      }

      const ownerId = dataOwnerId || user?.id
      if (!ownerId) {
        throw new Error('Unable to identify workspace owner for deletion.')
      }

      let dropWarning = null
      const { error: dropError } = await supabase.rpc('drop_month_table', { table_to_drop: tableName })
      if (dropError) {
        const normalized = dropError.message?.toLowerCase() || ''
        const missingRpc = normalized.includes('function drop_month_table')
        const missingTable = dropError.code === 'PGRST205' || normalized.includes('does not exist')

        if (missingRpc) {
          dropWarning = 'drop_month_table RPC is missing in Supabase. Table will need to be removed manually.'
          console.warn(dropWarning)
        } else if (missingTable) {
          console.warn(`Table ${tableName} was already removed in Supabase.`)
        } else {
          throw dropError
        }
      }

      const { error: registryError } = await supabase
        .from('user_month_tables')
        .delete()
        .eq('user_id', ownerId)
        .eq('table_name', tableName)

      if (registryError) {
        throw registryError
      }

      setMonthlyTables(prev => {
        const nextTables = sortMonthTables(prev.filter(t => t !== tableName))
        if (currentTable === tableName) {
          const fallback = nextTables[nextTables.length - 1] || null
          changeCurrentTable(fallback)
        }
        return nextTables
      })

      await fetchMonthlyTables()
      toast.success(`Deleted ${tableName.replace('_', ' ')}`)
      if (dropWarning) {
        toast.warn(dropWarning, { autoClose: 7000 })
      }
      return { success: true }
    } catch (error) {
      console.error('Error deleting month table:', error)
      const normalized = error?.message?.toLowerCase?.() || ''
      const missingTable =
        error?.code === 'PGRST205' ||
        error?.code === 'PGRST116' ||
        normalized.includes('does not exist') ||
        normalized.includes('schema cache')

      if (missingTable) {
        await handleMissingTable(tableName)
        toast.info(`${tableName.replace('_', ' ')} already removed.`)
        return { success: true }
      }

      toast.error(error?.message || 'Failed to delete month')
      throw error
    }
  }, [isSupabaseConfigured, supabase, user?.id, dataOwnerId, currentTable, changeCurrentTable, fetchMonthlyTables])

  const handleMissingTable = useCallback(async (tableName) => {
    if (!tableName) return
    console.warn(`Table ${tableName} missing in Supabase – syncing local state`)

    if (isSupabaseConfigured() && user?.id) {
      try {
        await supabase
          .from('user_month_tables')
          .delete()
          .eq('user_id', user.id)
          .eq('table_name', tableName)
      } catch (error) {
        console.warn('Could not prune user_month_tables entry:', error)
      }
    }

    pruneMissingTable(tableName)
    toast.warn(`${tableName.replace('_', ' ')} no longer exists in Supabase. Please recreate it if needed.`)
    await fetchMonthlyTables()
  }, [currentTable, changeCurrentTable, fetchMonthlyTables, isSupabaseConfigured, pruneMissingTable, supabase, user?.id])

  // Create new month by copying from the most recent month
  const createNewMonth = async ({
    month,
    year,
    monthName,
    sundays,
    copyMode = 'all',
    selectedMemberIds = [],
    sourceTableOverride = null
  }) => {
    try {
      const monthIdentifier = `${monthName}_${year}`
      const resolvedCopyMode = copyMode === 'attendance' ? 'custom' : copyMode
      const ownerId = dataOwnerId || user?.id

      if (!isSupabaseConfigured()) {
        // Demo mode - simulate table creation locally
        setMonthlyTables(prev => {
          if (prev.includes(monthIdentifier)) return prev
          return sortMonthTables([...prev, monthIdentifier])
        })

        changeCurrentTable(monthIdentifier)
        if (resolvedCopyMode === 'empty') {
          toast.success(`${monthIdentifier} created as a fresh month (Demo Mode)`)
        } else if (resolvedCopyMode === 'custom') {
          if (selectedMemberIds.length === 0) {
            toast.info(`${monthIdentifier} created empty (Demo Mode)`)
          } else {
            toast.info(`${monthIdentifier} created with selected members (Demo Mode only simulates this state)`)
          }
        } else {
          toast.success(`${monthIdentifier} created successfully! (Demo Mode)`)
        }
        return { success: true, tableName: monthIdentifier }
      }

      if (monthlyTables.includes(monthIdentifier)) {
        toast.error(`${monthIdentifier.replace('_', ' ')} already exists.`)
        changeCurrentTable(monthIdentifier)
        return { success: true, tableName: monthIdentifier, alreadyExists: true }
      }

      // Determine the source table: use currentTable if set, otherwise find the most recent month
      let sourceTable = sourceTableOverride || currentTable

      // If no current table or we want to ensure we use the most recent, find it
      if (!sourceTable && monthlyTables.length > 0) {
        // Sort tables to find the most recent one
        const sortedTables = [...monthlyTables].sort((a, b) => {
          const [monthA, yearA] = a.split('_')
          const [monthB, yearB] = b.split('_')

          if (yearA !== yearB) {
            return parseInt(yearB) - parseInt(yearA) // Descending (most recent first)
          }

          const monthIndexA = MONTHS_IN_YEAR.indexOf(monthA)
          const monthIndexB = MONTHS_IN_YEAR.indexOf(monthB)
          return monthIndexB - monthIndexA // Descending (most recent first)
        })

        // Use the most recent table as source
        if (sortedTables.length > 0) {
          sourceTable = sortedTables[0]
        }
      }

      console.log(`Creating new month table: ${monthIdentifier}`)
      console.log(`Copying from most recent table: ${sourceTable}`)
      console.log(`New month will have ${sundays.length} Sundays:`, sundays.map(s => s.toISOString().split('T')[0]))

      // Format Sunday dates as YYYY-MM-DD strings for the database function
      const sundayDates = sundays.map(sunday => sunday.toISOString().split('T')[0])

      // Use RPC function to create month table by copying from most recent month
      // This will also enable RLS and copy all policies automatically
      const { data: result, error: createError } = await supabase.rpc(
        'create_month_from_current',
        {
          source_table: sourceTable,
          new_table_name: monthIdentifier,
          sunday_dates: sundayDates
        }
      )

      if (createError) {
        console.error('Error creating month table:', createError)
        throw new Error(`Failed to create month table: ${createError.message}`)
      }

      console.log('Month table creation result:', result)

      await ensureTableReady(monthIdentifier)

      if (resolvedCopyMode === 'custom' || resolvedCopyMode === 'empty') {
        const { error: clearError } = await supabase.rpc(
          'reset_month_members',
          { target_table: monthIdentifier }
        )

        if (clearError) {
          console.error('Failed clearing auto-copied rows:', clearError)
          throw new Error(`Failed to reset new month data: ${clearError.message}`)
        }
      }

      if (resolvedCopyMode === 'custom' && selectedMemberIds.length > 0) {
        const { data: insertedCount, error: insertError } = await supabase.rpc(
          'insert_selected_members',
          {
            source_table: sourceTable,
            target_table: monthIdentifier,
            member_ids: selectedMemberIds
          }
        )

        if (insertError) {
          console.error('Failed inserting selected members:', insertError)
          throw new Error(`Failed to insert selected members: ${insertError.message}`)
        }

        if (insertedCount === 0) {
          throw new Error('No members were inserted. Please confirm your selection.')
        }
      }


      const { error: ownerAssignError } = await supabase.rpc(
        'set_month_owner_user',
        {
          target_table: monthIdentifier,
          owner_user_id: ownerId
        }
      )

      if (ownerAssignError) {
        console.error('Failed to assign owner user_id on new month rows:', ownerAssignError)
        throw new Error(`Failed to finalize month ownership: ${ownerAssignError.message}`)
      }

      const { error: registerError } = await supabase
        .from('user_month_tables')
        .upsert({
          user_id: ownerId,
          table_name: monthIdentifier,
          month_year: `${monthName} ${year}`
        }, {
          onConflict: 'user_id,table_name'
        })

      if (registerError) {
        console.warn('Could not register month table for user:', registerError)
      }

      // Auto-register all invited collaborators for this new month
      try {
        const { data: registeredCount, error: collabRegError } = await supabase.rpc(
          'register_collaborators_for_month',
          {
            p_owner_id: ownerId,
            p_table_name: monthIdentifier,
            p_month_year: `${monthName} ${year}`
          }
        )

        if (collabRegError) {
          console.warn('Error calling register_collaborators_for_month:', collabRegError)
          // Don't throw - collaborators can still use RLS, they just won't see it in the list immediately
        } else if (registeredCount > 0) {
          console.log(`Successfully registered ${registeredCount} collaborators for ${monthIdentifier}`)
        }
      } catch (collabRegError) {
        console.warn('Could not register collaborators for new month:', collabRegError)
      }


      if (resolvedCopyMode === 'empty') {
        toast.success(`Month ${monthName} ${year} created as a fresh workspace.`)
      } else if (resolvedCopyMode === 'custom') {
        const copiedCount = selectedMemberIds.length
        toast.success(`Month ${monthName} ${year} created with ${copiedCount} selected member${copiedCount === 1 ? '' : 's'}.`)
      } else {
        toast.success(`Month ${monthName} ${year} created successfully! Copied ${result?.members_copied || 0} members from ${sourceTable}. RLS enabled with all policies.`)
      }

      // Optimistically add new month locally so menus update immediately
      setMonthlyTables(prev => {
        if (prev.includes(monthIdentifier)) return prev
        return sortMonthTables([...prev, monthIdentifier])
      })

      // Refresh the monthly tables list from database
      await fetchMonthlyTables()

      // Clear cache for the new month to ensure fresh data fetch
      membersCacheRef.current.delete(monthIdentifier)

      // Switch to the new month
      changeCurrentTable(monthIdentifier)

      // Force refresh members after a short delay to ensure table is ready
      setTimeout(async () => {
        membersCacheRef.current.delete(monthIdentifier)
        await fetchMembers(monthIdentifier)
        await initializeAttendanceDates()
      }, 500)

      console.log(`Successfully created month: ${monthIdentifier}`)
      return { success: true, tableName: monthIdentifier, result }
    } catch (error) {
      console.error('Error creating new month:', error)

      // Provide detailed error information
      let errorMessage = 'Failed to create new month'
      if (error.message) {
        errorMessage += `: ${error.message}`
      } else if (error.error) {
        errorMessage += `: ${error.error}`
      }

      toast.error(errorMessage)
      throw error
    }
  }

  // Optimized filter members based on search term (instant search)
  const filteredMembers = useMemo(() => {
    if (!searchTerm.trim()) {
      return members
    }

    if (serverSearchResults) {
      return serverSearchResults.slice(0, 20)
    }

    // Fast client-side search
    const search = searchTerm.toLowerCase().trim()
    const tokens = search.split(/\s+/).filter(Boolean)
    const filtered = members.filter(member => {
      const fullName = (
        (typeof member['full_name'] === 'string' ? member['full_name'] : '') ||
        (typeof member['Full Name'] === 'string' ? member['Full Name'] : '') ||
        ''
      ).toLowerCase()
      return tokens.every(t => fullName.includes(t))
    }).slice(0, 20)

    return filtered
  }, [members, searchTerm, serverSearchResults])

  const resolveNameColumn = useCallback(async (tableName) => {
    const cached = nameColumnCacheRef.current.get(tableName)
    if (cached) return cached
    if (!isSupabaseConfigured()) return 'Full Name'
    let nameCol = 'Full Name'
    try {
      // Use select('*') to avoid referencing columns that might not exist
      const { data, error } = await supabase.from(tableName).select('*').limit(1)
      if (!error && data && data.length) {
        const row = data[0]
        if (Object.prototype.hasOwnProperty.call(row, 'Full Name')) {
          nameCol = 'Full Name'
        } else if (Object.prototype.hasOwnProperty.call(row, 'full_name')) {
          nameCol = 'full_name'
        } else if (Object.prototype.hasOwnProperty.call(row, 'name')) {
          nameCol = 'name'
        } else if (Object.prototype.hasOwnProperty.call(row, 'Name')) {
          nameCol = 'Name'
        }
      }
    } catch (e) {
      // Fall back gracefully; monthly tables commonly use "Full Name"
      console.warn('resolveNameColumn fallback due to error:', e)
    }
    nameColumnCacheRef.current.set(tableName, nameCol)
    return nameCol
  }, [isSupabaseConfigured])

  const performServerSearch = useCallback(async (term) => {
    const trimmed = term.trim()
    if (!trimmed) {
      setServerSearchResults(null)
      return
    }
    if (!isSupabaseConfigured()) {
      setServerSearchResults(null)
      return
    }

    // Quick attendance keywords
    const kw = trimmed.toLowerCase()
    if (kw === 'present' || kw === 'absent') {
      await quickMarkAttendanceFromKeyword(kw)
      setServerSearchResults(null)
      return
    }

    const CACHE_DURATION = 10 * 60 * 1000
    const cacheKey = `${currentTable}::${trimmed}`
    const hit = searchCacheRef.current.get(cacheKey)
    const now = Date.now()
    if (hit && now - hit.timestamp < CACHE_DURATION) {
      setServerSearchResults(hit.data || [])
      return
    }

    const nameCol = await resolveNameColumn(currentTable)
    const isAge = /^\d{1,3}$/.test(trimmed)
    const tokenized = trimmed.split(/\s+/).filter(Boolean)
    if (tokenized.length > 1 && !isAge) {
      setServerSearchResults(null)
      return
    }
    let query = supabase.from(currentTable).select('*')
    if (isAge) {
      query = query.eq('Age', parseInt(trimmed, 10))
    } else {
      const safe = trimmed.replace(/%/g, '').replace(/_/g, '').replace(/\s+/g, ' ').trim()
      const orExpr = `"${nameCol}".ilike.%${safe}%,"${nameCol}".ilike.${safe}%,"${nameCol}".ilike.% ${safe}%`
      query = query.or(orExpr)
    }
    const { data, error } = await query
    if (error) {
      console.error('Server search error', error)
      setServerSearchResults(null)
      return
    }
    const sorted = (data || []).slice().sort((a, b) => {
      const an = (a[nameCol] || '').toString().toLowerCase()
      const bn = (b[nameCol] || '').toString().toLowerCase()
      if (an < bn) return -1
      if (an > bn) return 1
      return 0
    })
    searchCacheRef.current.set(cacheKey, { timestamp: now, data: sorted })
    setServerSearchResults(sorted)
  }, [currentTable, isSupabaseConfigured, resolveNameColumn])

  useEffect(() => {
    performServerSearch(searchTerm)
  }, [searchTerm, currentTable, performServerSearch])

  const quickMarkAttendanceFromKeyword = useCallback(async (kw) => {
    const list = serverSearchResults && serverSearchResults.length > 0 ? serverSearchResults : filteredMembers
    const first = list && list.length ? list[0] : null
    if (!first) return
    const statusBool = kw === 'present'
    try {
      const dateObj = selectedAttendanceDate ? new Date(selectedAttendanceDate) : new Date()
      await markAttendance(first.id, dateObj, statusBool)
      await fetchMembers(currentTable)
    } catch (e) {
      console.error('Quick mark attendance failed', e)
    }
  }, [serverSearchResults, filteredMembers, selectedAttendanceDate, markAttendance, fetchMembers, currentTable])

  // Function to refresh search results
  const refreshSearch = useCallback(() => {
    // Clear server search results to force re-filtering with updated members
    if (searchTerm) {
      setServerSearchResults(null)
      // Re-run the search with current term to update results
      performServerSearch(searchTerm)
    }
  }, [searchTerm, performServerSearch])

  // Function to force refresh members from database
  const forceRefreshMembers = useCallback(async () => {
    console.log('Force refreshing members from database...')
    toast.info('Refreshing member data...')

    try {
      await fetchMembers(currentTable)
      toast.success('Member data refreshed successfully!')
      console.log('Members refreshed, new count:', members.length)
    } catch (error) {
      console.error('Error refreshing members:', error)
      toast.error('Failed to refresh member data')
    }
  }, [currentTable, fetchMembers, members.length])

  // Silent variant for programmatic refreshes (no toasts)
  const forceRefreshMembersSilent = useCallback(async () => {
    console.log('Force refreshing members (silent) ...')
    try {
      await fetchMembers(currentTable)
      console.log('Members refreshed silently, new count:', members.length)
    } catch (error) {
      console.error('Error refreshing members (silent):', error)
      // No toast here to prevent notification noise
    }
  }, [currentTable, fetchMembers, members.length])

  // Function to search for a member across all monthly tables
  const searchMemberAcrossAllTables = useCallback(async (searchName) => {
    console.log('=== SEARCHING ACROSS ALL TABLES ===')
    console.log('Looking for:', searchName)

    const searchTerm = searchName.toLowerCase().trim()
    const foundInTables = []

    for (const tableName of monthlyTables) {
      try {
        console.log(`Checking table: ${tableName}`)

        if (isSupabaseConfigured()) {
          const { data, error } = await supabase
            .from(tableName)
            .select('*')

          if (error) {
            console.log(`Error accessing ${tableName}:`, error.message)
            continue
          }

          const foundMembers = data?.filter(member => {
            const fullName = (
              (typeof member['full_name'] === 'string' ? member['full_name'] : '') ||
              (typeof member['Full Name'] === 'string' ? member['Full Name'] : '') ||
              ''
            ).toLowerCase()

            return fullName.includes(searchTerm)
          }) || []

          if (foundMembers.length > 0) {
            console.log(`Found ${foundMembers.length} matches in ${tableName}:`)
            foundMembers.forEach(member => {
              console.log(`  - ${member['Full Name'] || member['full_name']}`)
            })
            foundInTables.push({ table: tableName, members: foundMembers })
          }
        }
      } catch (error) {
        console.log(`Error searching ${tableName}:`, error.message)
      }
    }

    console.log('=== SEARCH RESULTS ===')
    if (foundInTables.length === 0) {
      console.log('Member not found in any table')
      toast.error(`"${searchName}" not found in any monthly table`)
    } else {
      console.log(`Found in ${foundInTables.length} table(s):`)
      foundInTables.forEach(({ table, members }) => {
        console.log(`  ${table}: ${members.length} match(es)`)
      })
      toast.success(`Found "${searchName}" in ${foundInTables.length} table(s)`)
    }

    return foundInTables
  }, [monthlyTables, isSupabaseConfigured])

  // Validate member data for missing fields
  const validateMemberData = useCallback((member) => {
    const missingFields = []

    if (!member['Phone Number'] || member['Phone Number'] === null) {
      missingFields.push('Phone Number')
    }
    if (!member['Gender'] || member['Gender'] === null || member['Gender'] === '') {
      missingFields.push('Gender')
    }
    if (!member['Age'] || member['Age'] === null || member['Age'] === '') {
      missingFields.push('Age')
    }
    if (!member['Current Level'] || member['Current Level'] === null || member['Current Level'] === '') {
      missingFields.push('Current Level')
    }
    if (!member['parent_name_1'] || member['parent_name_1'] === null || member['parent_name_1'] === '') {
      missingFields.push('Parent Name 1')
    }
    if (!member['parent_phone_1'] || member['parent_phone_1'] === null) {
      missingFields.push('Parent Phone 1')
    }

    return missingFields
  }, [])

  // Get all past Sundays from the beginning of the month to today
  const getPastSundays = useCallback(() => {
    try {
      // Parse table name to get month and year (e.g., "December_2025" -> "December", 2025)
      const [monthName, year] = currentTable.split('_')
      const yearNum = parseInt(year)

      if (!monthName || isNaN(yearNum)) {
        console.error('Invalid table format:', currentTable)
        return []
      }

      const allSundays = getSundaysInMonth(monthName, yearNum)

      const today = new Date()
      today.setHours(0, 0, 0, 0)

      // Filter to only past Sundays (including today)
      return allSundays.filter(sunday => sunday <= today)
    } catch (error) {
      console.error('Error getting past Sundays:', error)
      return []
    }
  }, [currentTable, getSundaysInMonth])

  // Get missing attendance for a member for past Sundays
  const getMissingAttendance = useCallback((memberId, pastSundays) => {
    const missingDates = []

    pastSundays.forEach(sunday => {
      const dateKey = getLocalDateString(sunday)
      const attendanceMap = attendanceData[dateKey] || {}
      const status = attendanceMap[memberId]

      // If status is undefined/null, it's missing
      if (status === undefined || status === null) {
        missingDates.push(sunday)
      }
    })

    return missingDates
  }, [attendanceData])

  // Wrapper function to set attendance date and save to localStorage
  const setAndSaveAttendanceDate = useCallback((date) => {
    setSelectedAttendanceDate(date)
    // Save to localStorage with current table as key
    const savedDateKey = `selectedAttendanceDate_${currentTable}`
    localStorage.setItem(savedDateKey, date.toISOString())
  }, [currentTable])

  const acknowledgeAdminSync = useCallback(async () => {
    if (!adminSyncNotice) return
    const { targetTable, targetDate, blocking } = adminSyncNotice
    setAdminSyncNotice(null)
    const applyDate = async () => {
      if (!targetDate) return
      const [y, m, d] = targetDate.split('-').map(Number)
      if (Number.isNaN(y) || Number.isNaN(m) || Number.isNaN(d)) return
      const dateObj = new Date(y, m - 1, d)
      setAndSaveAttendanceDate(dateObj)
      const attendanceMap = await fetchAttendanceForDate(dateObj)
      const dateKey = getLocalDateString(dateObj)
      setAttendanceData(prev => ({
        ...prev,
        [dateKey]: attendanceMap
      }))
    }

    try {
      if (targetTable && targetTable !== currentTable) {
        changeCurrentTable(targetTable)
        if (import.meta.env.MODE === 'test') {
          await applyDate()
        } else {
          setTimeout(() => {
            applyDate()
          }, 200)
        }
      } else {
        await applyDate()
      }

      await logActivity('admin_period_refresh_ack', {
        targetTable,
        targetDate,
        blocking
      })
    } catch (err) {
      console.error('Error acknowledging admin sync:', err)
    }
  }, [
    adminSyncNotice,
    currentTable,
    changeCurrentTable,
    setAndSaveAttendanceDate,
    fetchAttendanceForDate,
    logActivity
  ])

  // Fetch monthly tables when dependencies change (e.g., collaborator status)
  useEffect(() => {
    fetchMonthlyTables()
  }, [fetchMonthlyTables])

  // Restore saved month or fall back to a valid table on load
  useEffect(() => {
    if (monthlyTables.length > 0) {
      // If the user is not authenticated locally, prefer a known-safe default table
      if (!authContext?.user) {
        if (monthlyTables.includes(DEFAULT_TABLE)) {
          setCurrentTable(DEFAULT_TABLE)
          localStorage.setItem('selectedMonthTable', DEFAULT_TABLE)
          return
        }
      }
      // If the current table is valid, keep it
      if (currentTable && monthlyTables.includes(currentTable)) {
        return
      }
      // Current table is invalid — try localStorage, then DEFAULT_TABLE, then latest
      const saved = localStorage.getItem('selectedMonthTable')
      // Only override if we have real data from Supabase (not just fallback)
      // If saved month exists and we're still on fallback, wait for real data to load
      if (saved && !monthlyTables.includes(saved) && monthlyTables.length === 1 && monthlyTables[0] === DEFAULT_TABLE) {
        return // Don't override yet, real tables are still loading
      }
      if (saved && monthlyTables.includes(saved)) {
        setCurrentTable(saved)
      } else if (monthlyTables.includes(DEFAULT_TABLE)) {
        setCurrentTable(DEFAULT_TABLE)
        localStorage.setItem('selectedMonthTable', DEFAULT_TABLE)
      } else {
        const latest = monthlyTables[monthlyTables.length - 1]
        setCurrentTable(latest)
        localStorage.setItem('selectedMonthTable', latest)
      }
    }
  }, [monthlyTables])

  // Fetch members on component mount and when current table changes
  // Wait for auth to finish loading before fetching to avoid race condition
  useEffect(() => {
    if (authLoading || !currentTable) {
      return // Don't fetch while auth is still loading or table is null
    }
    fetchMembers()
  }, [currentTable, authLoading])

  // Initialize attendance dates when current table or collaborator sticky Sundays change
  useEffect(() => {
    if (!currentTable) return
    initializeAttendanceDates()
  }, [currentTable, ownerStickySundays, isCollaborator])

  // Check for badge processing after attendance data is loaded
  useEffect(() => {
    if (!badgeProcessingEnabled) return
    if (!currentTable || processedEndOfMonthRef.current.has(currentTable)) return
    if (Object.keys(attendanceData).length === 0) return

    const timeoutId = setTimeout(() => {
      if (isMonthAttendanceComplete()) {
        console.log('Month has 40+ members marked, processing badges...')
        processEndOfMonthBadges()
      }
    }, 1000)

    return () => clearTimeout(timeoutId)
  }, [attendanceData, isMonthAttendanceComplete, processEndOfMonthBadges, currentTable, badgeProcessingEnabled])

  // Badge filter functions
  const toggleBadgeFilter = (badgeType) => {
    setBadgeFilter(prev => {
      const newFilter = prev.includes(badgeType)
        ? prev.filter(type => type !== badgeType)
        : [...prev, badgeType]

      // Save to localStorage
      localStorage.setItem('badgeFilter', JSON.stringify(newFilter))
      return newFilter
    })
  }

  // Helper function to check if member has a specific badge
  const memberHasBadge = (member, badgeType) => {
    // Guard against undefined member objects (e.g., during fast search renders)
    if (!member) {
      console.warn('memberHasBadge: member is undefined for badgeType', badgeType)
      return false
    }

    // Check both the Supabase columns and Manual Badges array for compatibility
    let hasSupabaseBadge = false
    let hasManualBadge = false

    switch (badgeType) {
      case 'member':
        hasSupabaseBadge = member['Member'] === 'Yes'
        hasManualBadge = (member['Manual Badges'] || []).includes('member')
        break
      case 'regular':
        hasSupabaseBadge = member['Regular'] === 'Yes'
        hasManualBadge = (member['Manual Badges'] || []).includes('regular')
        break
      case 'newcomer':
        hasSupabaseBadge = member['Newcomer'] === 'Yes'
        hasManualBadge = (member['Manual Badges'] || []).includes('newcomer')
        break
      default:
        return false
    }

    const result = hasSupabaseBadge || hasManualBadge
    console.log(`memberHasBadge(${member?.['Full Name'] || member?.['full_name']}, ${badgeType}):`, {
      hasSupabaseBadge,
      hasManualBadge,
      result,
      supabaseValue: member?.[badgeType === 'member' ? 'Member' : badgeType === 'regular' ? 'Regular' : 'Newcomer'],
      manualBadges: member?.['Manual Badges']
    })

    return result
  }

  // Load all attendance data for all Sunday dates in the current month
  const loadAllAttendanceData = async () => {
    try {
      if (!isSupabaseConfigured()) {
        console.log('Demo mode - attendance data will be managed locally')
        return
      }

      // Get all attendance columns for the current table
      const attendanceColumns = await getAttendanceColumns()

      if (attendanceColumns.length === 0) {
        appContextLog('No attendance columns found in current table')
        return
      }

      // Build select query for all attendance columns
      const selectColumns = ['id', ...attendanceColumns.map(col => `"${col.column_name}"`)]

      // Fetch all rows - use high limit to avoid Supabase default 1000-row cap
      let allData = []
      let offset = 0
      const PAGE_SIZE = 1000
      while (true) {
        const { data: page, error: pageError } = await supabase
          .from(currentTable)
          .select(selectColumns.join(', '))
          .range(offset, offset + PAGE_SIZE - 1)

        if (pageError) throw pageError
        if (!page || page.length === 0) break
        allData = allData.concat(page)
        if (page.length < PAGE_SIZE) break
        offset += PAGE_SIZE
      }

      // Transform data into the format expected by the UI
      const newAttendanceData = {}

      attendanceColumns.forEach(col => {
        const columnName = col.column_name
        const colNameLower = columnName.toLowerCase()

        let dateKey = null

        // NEW format: attendance_2025_12_07
        const newMatch = colNameLower.match(/attendance_(\d{4})_(\d{2})_(\d{2})/)
        if (newMatch) {
          const year = parseInt(newMatch[1])
          const month = parseInt(newMatch[2]) - 1 // 0-indexed
          const day = parseInt(newMatch[3])
          const date = new Date(year, month, day)
          dateKey = getLocalDateString(date)
        }

        // OLD format: Attendance 7th, Attendance 14th
        if (!dateKey) {
          const oldMatch = columnName.match(/(\d+)(st|nd|rd|th)/)
          if (oldMatch) {
            const day = parseInt(oldMatch[1])
            // Get current month and year from table name
            const [monthName, year] = currentTable.split('_')
            const monthIndex = [
              'January', 'February', 'March', 'April', 'May', 'June',
              'July', 'August', 'September', 'October', 'November', 'December'
            ].indexOf(monthName)

            if (monthIndex !== -1) {
              const date = new Date(parseInt(year), monthIndex, day)
              dateKey = getLocalDateString(date)
            }
          }
        }

        if (dateKey) {
          newAttendanceData[dateKey] = {}

          allData.forEach(record => {
            const val = record[columnName]
            // Include both Present (true) and Absent (false) records
            if (val === 'Present' || val === 'Absent') {
              newAttendanceData[dateKey][record.id] = val === 'Present'
            }
          })
        }
      })

      // Update attendance data state
      setAttendanceData(newAttendanceData)
      console.log('Loaded attendance data for all dates:', Object.keys(newAttendanceData), 'from', allData.length, 'rows')

    } catch (error) {
      console.error('Error loading attendance data:', error)
    }
  }

  // Load all badge data for the current table
  const loadAllBadgeData = async () => {
    try {
      if (!isSupabaseConfigured()) {
        console.log('Demo mode - badge data will be managed locally')
        return
      }

      appContextLog('Loading badge data from Supabase...')

      // Select all columns to be safe, then process locally
      // This avoids errors if specific badge columns don't exist
      const { data, error } = await supabase
        .from(currentTable)
        .select('*')

      if (error) {
        console.error('Error loading badge data:', error)

        // Only treat as missing table if it's actually a missing TABLE error
        const missingTable =
          error.code === '42P01' || // undefined_table
          error.code === 'PGRST205' ||
          (error.message?.includes('relation') && error.message?.includes('does not exist'))

        if (missingTable) {
          console.warn('Table appears to be missing during badge load:', currentTable)
          // Don't trigger full table deletion here to be safe
        }
        return
      }

      appContextLog('Badge data loaded:', data?.slice(0, 3))

      // Update members with badge data
      setMembers(prev => prev.map(member => {
        const badgeData = data.find(d => d.id === member.id)
        if (badgeData) {
          return {
            ...member,
            'Member': badgeData.Member,
            'Regular': badgeData.Regular,
            'Newcomer': badgeData.Newcomer,
            'Manual Badge': badgeData['Manual Badge'],
            'Badge Type': badgeData['Badge Type']
          }
        }
        return member
      }))

    } catch (error) {
      console.error('Error loading badge data:', error)
    }
  }

  // Load attendance and badge data when table changes
  useEffect(() => {
    if (currentTable) {
      loadAllAttendanceData()
      loadAllBadgeData()
    }
  }, [currentTable])

  // QR-based marking handler
  // If the URL contains ?qr_mark=<memberId>&date=YYYY-MM-DD the app will attempt to mark that member present for the supplied date (or 30th of currentTable if no date)
  useEffect(() => {
    if (typeof window === 'undefined') return
    try {
      const params = new URLSearchParams(window.location.search)
      const qrMark = params.get('qr_mark')
      const dateParam = params.get('date')

      if (!qrMark) return

        ; (async () => {
          try {
            // Determine date to use: prefer provided date, otherwise the 30th of the current table month
            let targetDate = null
            if (dateParam) {
              const d = new Date(dateParam)
              if (!isNaN(d.getTime())) targetDate = d
            }
            if (!targetDate && currentTable) {
              try {
                const [monthName, year] = currentTable.split('_')
                const months = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']
                const monthIndex = months.indexOf(monthName)
                if (monthIndex !== -1) {
                  targetDate = new Date(parseInt(year, 10), monthIndex, 30)
                }
              } catch (e) {
                // fallback to today
                targetDate = new Date()
              }
            }
            if (!targetDate) targetDate = new Date()

            // Mark attendance as present
            await markAttendance(qrMark, targetDate, true)

            // Show a confirmation toast
            try { toast.success('Attendance marked via QR') } catch { }

            // Remove query params so repeated reloads do not re-trigger the action
            try {
              const url = new URL(window.location.href)
              url.searchParams.delete('qr_mark')
              url.searchParams.delete('date')
              window.history.replaceState({}, document.title, url.toString())
            } catch (e) {
              // ignore
            }
          } catch (err) {
            console.error('QR mark processing failed', err)
          }
        })()
    } catch (e) {
      console.error('Failed to parse QR params', e)
    }
  }, [currentTable, markAttendance])

  useEffect(() => {
    if (!isSupabaseConfigured()) return;

    const channel = supabase
      .channel(`public:members:${currentTable}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: currentTable,
        },
        (payload) => {
          console.log('Change received!', payload);

          if (payload.eventType === 'INSERT') {
            const incoming = normalizeMemberRecord(payload.new)
            setMembers((prevMembers) => {
              const exists = prevMembers.some(member => member.id === incoming.id)
              const nextMembers = exists
                ? prevMembers.map(member => member.id === incoming.id ? { ...member, ...incoming } : member)
                : [...prevMembers, incoming]
              membersCacheRef.current.set(currentTable || 'default', { data: nextMembers, ts: Date.now() })
              return nextMembers
            });
          } else if (payload.eventType === 'UPDATE') {
            const incoming = normalizeMemberRecord(payload.new)
            setMembers((prevMembers) => {
              const nextMembers = prevMembers.map((member) =>
                member.id === incoming.id ? { ...member, ...incoming } : member
              )
              membersCacheRef.current.set(currentTable || 'default', { data: nextMembers, ts: Date.now() })
              return nextMembers
            });
          } else if (payload.eventType === 'DELETE') {
            setMembers((prevMembers) => {
              const nextMembers = prevMembers.filter((member) => member.id !== payload.old.id)
              membersCacheRef.current.set(currentTable || 'default', { data: nextMembers, ts: Date.now() })
              return nextMembers
            });
          }
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [currentTable]);

  // UI action signaling for cross-component coordination
  const [uiAction, setUiAction] = useState(null)
  const focusDateSelector = () => {
    setUiAction({ type: 'focusDateSelector', ts: Date.now() })
  }

  // Update workspace name across all tables
  const updateWorkspaceForAllTables = async (newName) => {
    try {
      if (!isSupabaseConfigured()) {
        toast.info('Workspace updated (Demo Mode)')
        return true
      }

      console.log(`Updating workspace to "${newName}" across all tables...`)

      const { error } = await supabase.rpc('update_user_workspace_name', {
        new_name: newName
      })

      if (error) {
        if (error.message?.includes('function') || error.code === '42883') {
          throw new Error('Please run the "Complete Workspace Features" migration first')
        }
        throw error
      }

      toast.success('Workspace updated across all records!')
      return true
    } catch (error) {
      console.error('Error updating workspace:', error)
      toast.error(error.message || 'Failed to update workspace records')
      return false
    }
  }

  // Memoize context value to prevent unnecessary re-renders of consumers
  const value = useMemo(() => ({
    checkCollaboratorStatus,
    logActivity,
    updateWorkspaceForAllTables,
    members,
    filteredMembers,
    loading,
    searchTerm,
    setSearchTerm,
    refreshSearch,
    serverSearchResults,
    forceRefreshMembers,
    forceRefreshMembersSilent,
    searchMemberAcrossAllTables,
    addMember,
    updateMember,
    deleteMember,
    fetchMembers,
    attendanceData,
    setAttendanceData,
    markAttendance,
    bulkAttendance,
    fetchAttendanceForDate,
    fetchAttendanceForDateInTable,
    loadAllAttendanceData,
    loadAllBadgeData,
    currentTable,
    monthlyTables,
    setCurrentTable: changeCurrentTable,
    createNewMonth,
    deleteMonthTable,
    fetchMonthlyTables,
    getAttendanceColumns,
    getAvailableAttendanceDates,
    findAttendanceColumnForDate,
    calculateAttendanceRate,
    calculateMemberBadge,
    updateMemberBadges,
    processEndOfMonthBadges,
    isMonthAttendanceComplete,
    toggleMemberBadge,
    memberHasBadge,
    selectedAttendanceDate,
    setSelectedAttendanceDate,
    setAndSaveAttendanceDate,
    availableSundayDates,
    getAvailableSundayDates,
    initializeAttendanceDates,
    getSundaysInMonth,
    badgeFilter,
    toggleBadgeFilter,
    isSupabaseConfigured,
    dashboardTab,
    setDashboardTab,
    uiAction,
    focusDateSelector,
    validateMemberData,
    getPastSundays,
    getMissingAttendance,
    autoAllDatesEnabled,
    setAutoAllDatesEnabled,
    hasAccess,
    isCollaborator,
    dataOwnerId,
    ownerStickySundays,
    adminSyncNotice,
    acknowledgeAdminSync,
    lockedDefaultDate,
    saveLockedDefaultDate,
    fetchLockedDefaultDate
  }), [
    members, filteredMembers, loading, searchTerm, serverSearchResults,
    attendanceData, currentTable, monthlyTables, selectedAttendanceDate,
    availableSundayDates, badgeFilter, dashboardTab, uiAction,
    logActivity, checkCollaboratorStatus, updateWorkspaceForAllTables,
    refreshSearch, forceRefreshMembers, forceRefreshMembersSilent,
    searchMemberAcrossAllTables, addMember, updateMember, deleteMember,
    fetchMembers, markAttendance, bulkAttendance, fetchAttendanceForDate, fetchAttendanceForDateInTable,
    loadAllAttendanceData, loadAllBadgeData, changeCurrentTable, createNewMonth,
    deleteMonthTable, fetchMonthlyTables, getAttendanceColumns, getAvailableAttendanceDates,
    findAttendanceColumnForDate, calculateAttendanceRate, calculateMemberBadge,
    updateMemberBadges, processEndOfMonthBadges, isMonthAttendanceComplete,
    toggleMemberBadge, memberHasBadge, setAndSaveAttendanceDate,
    initializeAttendanceDates, getSundaysInMonth, toggleBadgeFilter,
    focusDateSelector, validateMemberData, getPastSundays, getMissingAttendance,
    autoAllDatesEnabled, setAutoAllDatesEnabled,
    hasAccess, isCollaborator, dataOwnerId, ownerStickySundays, adminSyncNotice, acknowledgeAdminSync,
    lockedDefaultDate, saveLockedDefaultDate, fetchLockedDefaultDate
  ])

  return (
    <AppContext.Provider value={value}>
      {children}
    </AppContext.Provider>
  )
}
