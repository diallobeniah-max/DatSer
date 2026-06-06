import React, { useState, useEffect, useMemo, useRef, useCallback, memo, lazy, Suspense } from 'react'
import { useApp } from '../context/AppContext'
import { useTheme } from '../context/ThemeContext'
import { supabase } from '../lib/supabase'
import { Search, Users, Filter, Edit3, Trash2, Calendar, ChevronDown, ChevronUp, ChevronRight, ChevronLeft, UserPlus, Award, Star, UserCheck, Check, X, Feather, StickyNote, History, Eye, Shield, MoreHorizontal, Phone, MessageSquare, Mail, Share2, Church } from 'lucide-react'
import DateSelector from './DateSelector'
import ConfirmModal from './ConfirmModal'
import TableSkeleton from './TableSkeleton'
import SelectionToolbar from './SelectionToolbar'
import { useLongPressSelection } from '../hooks/useLongPressSelection'
import useHapticFeedback from '../hooks/useHapticFeedback'
import useBottomSheetDrag from '../hooks/useBottomSheetDrag'
import { toast } from 'react-toastify'
import MemberCard from './MemberCard'
import { buildMemberIndexCodeMap, getMemberIndexCode, memberMatchesIndexCode } from '../utils/memberIndexCodes'


// Lazy load heavy modals for better initial load performance
const EditMemberModal = lazy(() => import('./EditMemberModal'))
const MemberModal = lazy(() => import('./MemberModal'))
const MonthModal = lazy(() => import('./MonthModal'))
const MissingDataModal = lazy(() => import('./MissingDataModal'))

// Helper function to get month display name from table name
const getMonthDisplayName = (tableName) => {
  // Convert table name like "October_2025" to "October 2025"
  if (!tableName) return 'Select Month'
  return tableName.replace('_', ' ')
}

// Helper function to get target date string from selectedAttendanceDate (timezone-safe)
const getDateString = (date) => {
  if (!date) return null
  if (typeof date === 'string') return date
  // Use local date to avoid timezone shifting the day
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

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

const normalizeAttendanceValue = (value) => {
  if (value === true || value === false) return value
  if (typeof value !== 'string') return undefined
  const normalized = value.trim().toLowerCase()
  if (normalized === 'present') return true
  if (normalized === 'absent') return false
  return undefined
}

const getLegacyAttendanceColumnName = (dateKey) => {
  if (!dateKey) return null
  const parts = String(dateKey).split('-')
  const day = Number(parts[2])
  if (!Number.isFinite(day)) return null
  return `Attendance ${day}${getOrdinalSuffix(day)}`
}

const resolveMemberAttendanceForDate = (member, dateKey, attendanceMap = {}) => {
  if (!member || !dateKey) return undefined

  if (Object.prototype.hasOwnProperty.call(attendanceMap, member.id)) {
    const mapValue = normalizeAttendanceValue(attendanceMap[member.id])
    if (mapValue !== undefined) return mapValue
  }

  const normalizedDateKey = String(dateKey).replace(/-/g, '_')
  const newColumnName = `attendance_${normalizedDateKey}`
  const legacyColumnName = getLegacyAttendanceColumnName(dateKey)

  for (const key in member) {
    const keyLower = key.toLowerCase()
    if (keyLower === newColumnName || key === legacyColumnName) {
      const memberValue = normalizeAttendanceValue(member[key])
      if (memberValue !== undefined) return memberValue
    }
  }

  return undefined
}

const Dashboard = ({ isAdmin = false }) => {
  const {
    filteredMembers: contextFilteredMembers,
    loading,
    searchTerm,
    setSearchTerm,
    forceRefreshMembers,
    forceRefreshMembersSilent,
    searchMemberAcrossAllTables,
    deleteMember,
    logActivity,
    markAttendance,
    bulkAttendance,
    fetchAttendanceForDate,
    attendanceData,
    setAttendanceData,
    currentTable,
    members,
    calculateMemberBadge,

    toggleMemberBadge,
    memberHasBadge,
    updateMemberBadges,
    updateMember,
    selectedAttendanceDate,
    badgeFilter,
    toggleBadgeFilter,
    isSupabaseConfigured,
    // Global dashboard tab (controlled by mobile header)
    dashboardTab,
    setDashboardTab,
    setAndSaveAttendanceDate,
    loadAllAttendanceData,
    uiAction,
    validateMemberData,
    getPastSundays,
    getMissingAttendance,
    missingInfoPromptEnabled,
    isCollaborator,
    dataOwnerId,
    user,
    isDeveloperBypass,
    searchSuggestionView,
    preferences
  } = useApp()
  const { isDarkMode } = useTheme()
  const { selection, success, error: errorHaptic } = useHapticFeedback()
  const [editingMember, setEditingMember] = useState(null)
  const [attendanceLoading, setAttendanceLoading] = useState({})
  const [expandedMembers, setExpandedMembers] = useState({})
  const [memberTags, setMemberTags] = useState({}) // memberId -> tags array
  const [showMemberModal, setShowMemberModal] = useState(false)
  const [showMonthModal, setShowMonthModal] = useState(false)
  const [quickPassMember, setQuickPassMember] = useState(null)
  const [profileMember, setProfileMember] = useState(null)

  // Pagination state
  const [displayLimit, setDisplayLimit] = useState(20) // Initial display limit
  const [isLoadingMore, setIsLoadingMore] = useState(false)

  // Badge management state
  const [isUpdatingBadges, setIsUpdatingBadges] = useState(false)
  const [badgeAssignmentLoading, setBadgeAssignmentLoading] = useState({})

  // Tab state moved to AppContext: dashboardTab ('all' | 'edited')
  const [selectedSundayDate, setSelectedSundayDate] = useState(null)
  const [genderFilter, setGenderFilter] = useState(null)
  const [levelFilter, setLevelFilter] = useState(null)
  const [visitorFilter, setVisitorFilter] = useState(null)
  const [showFilters, setShowFilters] = useState(false)
  const [isClosingFilters, setIsClosingFilters] = useState(false)
  const filterCloseTimeoutRef = useRef(null)
  const [sortNewestFirst, setSortNewestFirst] = useState(true) // Toggle for Marked tab sort order

  // Tag filter state
  const [workspaceTags, setWorkspaceTags] = useState([])
  const [tagFilter, setTagFilter] = useState(null) // Selected tag ID for filtering
  const [allMemberTags, setAllMemberTags] = useState({}) // memberId -> array of tag IDs


  // Track the timestamp of each attendance action for chronological sorting (most recent first)
  // Key: `${memberId}_${dateKey}`, Value: Date.now()
  const actionTimestampsRef = useRef({})

  // Handle filter closing with animation
  const closeFilters = useCallback(({ skipHaptic = false, viaDrag = false } = {}) => {
    if (!skipHaptic) selection()
    if (viaDrag) {
      setShowFilters(false)
      setIsClosingFilters(false)
      if (filterCloseTimeoutRef.current) {
        clearTimeout(filterCloseTimeoutRef.current)
        filterCloseTimeoutRef.current = null
      }
      return
    }
    setIsClosingFilters(true)
    if (filterCloseTimeoutRef.current) {
      clearTimeout(filterCloseTimeoutRef.current)
    }
    filterCloseTimeoutRef.current = setTimeout(() => {
      setShowFilters(false)
      setIsClosingFilters(false)
      filterCloseTimeoutRef.current = null
    }, 300)
  }, [selection])

  const {
    dragHandleProps: filterDragHandleProps,
    sheetStyle: filterSheetStyle,
    resetDrag: resetFilterDrag
  } = useBottomSheetDrag({
    onDismiss: (event) => closeFilters({ skipHaptic: true, viaDrag: event?.viaDrag })
  })

  useEffect(() => {
    return () => {
      if (filterCloseTimeoutRef.current) {
        clearTimeout(filterCloseTimeoutRef.current)
      }
    }
  }, [])

  useEffect(() => {
    if (!showFilters && !isClosingFilters) {
      resetFilterDrag()
    }
  }, [showFilters, isClosingFilters, resetFilterDrag])

  // Available filter options
  const levels = ['SHS1', 'SHS2', 'SHS3', 'JHS1', 'JHS2', 'JHS3', 'COMPLETED', 'UNIVERSITY']

  // iOS detection (used for minor tweaks if needed)
  const searchInputRef = useRef(null)
  const isIOS = typeof navigator !== 'undefined' && /iPad|iPhone|iPod/.test(navigator.userAgent)
  const isStandalone = typeof window !== 'undefined' && ((window.matchMedia && window.matchMedia('(display-mode: standalone)').matches) || (window.navigator && window.navigator.standalone === true))

  // Multi-select state (members + Sundays)
  const [selectedMemberIds, setSelectedMemberIds] = useState(new Set())
  const [selectedBulkSundayDates, setSelectedBulkSundayDates] = useState(new Set())
  const [isBulkApplying, setIsBulkApplying] = useState(false)
  const [isBulkDeleting, setIsBulkDeleting] = useState(false)
  const [swipeOpenId, setSwipeOpenId] = useState(null)
  const [swipeOffset, setSwipeOffset] = useState({})
  const swipeStartXRef = useRef(null)
  const swipeActiveIdRef = useRef(null)
  const [isDeleteConfirmOpen, setIsDeleteConfirmOpen] = useState(false)
  const [memberToDelete, setMemberToDelete] = useState(null)



  // Custom confirmation modals
  const [confirmModalConfig, setConfirmModalConfig] = useState({
    isOpen: false,
    title: "",
    message: "",
    onConfirm: null,
    confirmText: "Confirm",
    cancelText: "Cancel",
    confirmButtonClass: "bg-red-600 hover:bg-red-700 text-white",
    cancelButtonClass: "bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600"
  })
  const sundaysRef = useRef(null)

  // Duplicates management state
  const [selectedDuplicateIds, setSelectedDuplicateIds] = useState(new Set())

  // Ref to track the last fetched table to prevent re-fetching on every render
  const lastFetchedTableRef = useRef(null)

  // Missing data validation state
  const [showMissingDataModal, setShowMissingDataModal] = useState(false)
  const [missingDataMember, setMissingDataMember] = useState(null)
  const [missingFields, setMissingFields] = useState([])
  const [missingDates, setMissingDates] = useState([])
  const [pendingAttendanceAction, setPendingAttendanceAction] = useState(null)
  const recentMissingDataCloseRef = useRef({ memberId: null, present: null, at: 0, suppressAll: false })
  const missingDataPromptLockRef = useRef(null)
  const attendanceActionLocksRef = useRef(new Set())

  const closeMissingDataModal = ({ suppressAll = false } = {}) => {
    recentMissingDataCloseRef.current = {
      memberId: pendingAttendanceAction?.memberId ?? missingDataMember?.id ?? null,
      present: pendingAttendanceAction?.present ?? null,
      at: Date.now(),
      suppressAll
    }
    setShowMissingDataModal(false)
    setMissingDataMember(null)
    setMissingFields([])
    setMissingDates([])
    setPendingAttendanceAction(null)
  }

  // Bulk Transfer Modal state
  const [showTransferModal, setShowTransferModal] = useState(false)
  const [transferTargetDate, setTransferTargetDate] = useState(null)
  const [isTransferring, setIsTransferring] = useState(false)
  const [selectedTransferIds, setSelectedTransferIds] = useState(new Set())

  // Long-press selection hook (works with both touch and mouse)
  const {
    selectionMode,
    selectedIds: longPressSelectedIds,
    handleLongPressStart,
    handleLongPressMove,
    handleLongPressEnd,
    handleMouseDown,
    handleMouseUp,
    toggleSelection,
    clearSelection
  } = useLongPressSelection()

  // Local search term state for the bottom suggestion tray
  const [localSearchTerm, setLocalSearchTerm] = useState(searchTerm)
  const [isSearchFocused, setIsSearchFocused] = useState(false)

  // Keep local input in sync when external searchTerm changes
  useEffect(() => {
    setLocalSearchTerm(searchTerm)
  }, [searchTerm])

  useEffect(() => {
    if (searchSuggestionView !== 'full') return undefined
    const tid = setTimeout(() => {
      if (localSearchTerm !== searchTerm) {
        setSearchTerm(localSearchTerm)
      }
    }, 250)
    return () => clearTimeout(tid)
  }, [localSearchTerm, searchSuggestionView, searchTerm, setSearchTerm])

  const selectedTagFilters = useMemo(() => (
    Array.isArray(tagFilter)
      ? tagFilter.filter(Boolean)
      : (tagFilter ? [tagFilter] : [])
  ), [tagFilter])
  const hasTagFilters = selectedTagFilters.length > 0

  const getTagIdFromEntry = (entry) => {
    if (!entry) return null
    if (typeof entry === 'string' || typeof entry === 'number') return String(entry)
    return entry.id != null ? String(entry.id) : (entry.tag_id != null ? String(entry.tag_id) : null)
  }

  const getMemberTagIdSet = (memberId) => {
    const ids = new Set()
    const addEntries = (entries) => {
      if (!Array.isArray(entries)) return
      entries.forEach(entry => {
        const id = getTagIdFromEntry(entry)
        if (id) ids.add(id)
      })
    }
    addEntries(allMemberTags[memberId])
    addEntries(memberTags[memberId])
    return ids
  }

  const toggleTagFilter = (tagId) => {
    const normalizedTagId = String(tagId)
    setTagFilter(prev => {
      const current = Array.isArray(prev) ? prev.map(String) : (prev ? [String(prev)] : [])
      if (current.includes(normalizedTagId)) {
        const next = current.filter(id => id !== normalizedTagId)
        return next.length > 0 ? next : null
      }
      return [...current, normalizedTagId]
    })
  }

  const refreshTagFilters = useCallback(async () => {
    const ownerId = dataOwnerId || user?.id
    if (!ownerId || isDeveloperBypass || !isSupabaseConfigured()) {
      setWorkspaceTags([])
      setAllMemberTags({})
      return
    }

    try {
      // Fetch workspace tags first so the filter options always render.
      const { data: tagsData, error: tagsError } = await supabase.rpc('get_workspace_tags', {
        p_owner_id: ownerId
      })
      if (tagsError) {
        console.error('Error fetching workspace tags:', tagsError)
        return
      }

      const nextWorkspaceTags = tagsData || []
      setWorkspaceTags(nextWorkspaceTags)

      const isSearching = Boolean(searchTerm.trim())
      const tagMemberSource = isSearching && Array.isArray(contextFilteredMembers) && contextFilteredMembers.length > 0
        ? contextFilteredMembers
        : [
          ...(Array.isArray(members) ? members : []),
          ...(Array.isArray(contextFilteredMembers) ? contextFilteredMembers : [])
        ]
      const memberIds = Array.from(new Set(tagMemberSource.map(m => m?.id).filter(Boolean)))

      if (!currentTable || memberIds.length === 0) {
        setAllMemberTags({})
        return
      }

      const tagDetailsByMember = {}
      const tagIdsByMember = {}
      const shouldHydrateMemberTags = Boolean(isSearching || hasTagFilters)

      if (!shouldHydrateMemberTags) {
        setAllMemberTags({})
        return
      }

      if (shouldHydrateMemberTags) {
        const chunkSize = 25
        for (let i = 0; i < memberIds.length; i += chunkSize) {
          const chunk = memberIds.slice(i, i + chunkSize)
          await Promise.all(chunk.map(async (memberId) => {
            try {
              const { data, error } = await supabase.rpc('get_member_tags', {
                p_member_id: memberId,
                p_table_name: currentTable
              })
              if (error) throw error

              tagDetailsByMember[memberId] = data || []
              tagIdsByMember[memberId] = (data || []).map(tag => String(tag.id)).filter(Boolean)
            } catch (error) {
              console.error('Error hydrating member tags for filter:', error)
            }
          }))
        }
      }

      setMemberTags(prev => {
        const next = { ...prev }
        memberIds.forEach(memberId => {
          next[memberId] = tagDetailsByMember[memberId] || []
        })
        return next
      })
      setAllMemberTags(tagIdsByMember)
    } catch (error) {
      console.error('Error fetching tags for filter:', error)
    }
  }, [dataOwnerId, user?.id, currentTable, isDeveloperBypass, isSupabaseConfigured, members, contextFilteredMembers, searchTerm, hasTagFilters])

  // Fetch workspace tags and member tags for filtering.
  useEffect(() => {
    refreshTagFilters()
  }, [refreshTagFilters])

  // Handle bulk attendance for long-press selection
  const handleLongPressBulkAction = async (present) => {
    if (longPressSelectedIds.size === 0) return

    const dateToUse = selectedAttendanceDate ? new Date(selectedAttendanceDate) : new Date()
    const memberIds = Array.from(longPressSelectedIds)

    setIsBulkApplying(true)
    try {
      await bulkAttendance(memberIds, dateToUse, present)
      // Record action timestamps for chronological sorting
      const dateKey = getDateString(dateToUse)
      const now = Date.now()
      memberIds.forEach(id => {
        actionTimestampsRef.current[`${id}_${dateKey}`] = now
      })
      toast.success(`Marked ${memberIds.length} member${memberIds.length !== 1 ? 's' : ''} as ${present ? 'present' : 'absent'}!`)
      if (present) success()
      else errorHaptic()
      clearSelection()
    } catch (error) {
      console.error('Bulk action error:', error)
      errorHaptic()
      toast.error('Failed to update attendance')
    } finally {
      setIsBulkApplying(false)
    }
  }

  // Sync long-press selection to selectedMemberIds when on Edited Members tab
  useEffect(() => {
    if (dashboardTab === 'edited') {
      setSelectedMemberIds(new Set(longPressSelectedIds))
    }
  }, [longPressSelectedIds, dashboardTab])

  const checkMissingDataBeforeAttendance = (member, present) => {
    if (!missingInfoPromptEnabled) {
      return false
    }

    const promptKey = `${member?.id || 'unknown'}:${present ? 'present' : 'absent'}`
    const activePromptLock = missingDataPromptLockRef.current
    if (
      activePromptLock?.key === promptKey &&
      Date.now() - activePromptLock.at < 5000
    ) {
      return true
    }

    const recentClose = recentMissingDataCloseRef.current
    if (
      recentClose.memberId === member?.id &&
      (recentClose.suppressAll || recentClose.present === present) &&
      Date.now() - recentClose.at < 5000
    ) {
      return true
    }

    if (showMissingDataModal || pendingAttendanceAction) {
      return true
    }
    
    return proceedWithAttendanceCheck(member, present)
  }
  
  const proceedWithAttendanceCheck = (member, present) => {
    const fields = validateMemberData(member)
    const pastSundays = getPastSundays()
    const dates = getMissingAttendance(member.id, pastSundays)

    if (fields.length > 0 || dates.length > 0) {
      missingDataPromptLockRef.current = {
        key: `${member?.id || 'unknown'}:${present ? 'present' : 'absent'}`,
        at: Date.now()
      }
      setMissingDataMember(member)
      setMissingFields(fields)
      setMissingDates(dates)
      setPendingAttendanceAction({ memberId: member.id, present })
      setShowMissingDataModal(true)
      return true // Has missing data
    }
    return false // No missing data
  }

  const onRowTouchStart = (id, e) => {
    swipeActiveIdRef.current = id
    swipeStartXRef.current = e.touches[0]?.clientX || 0
    setSwipeOffset(prev => ({ ...prev, [id]: 0 }))
  }

  const onRowTouchMove = (id, e) => {
    if (swipeActiveIdRef.current !== id) return
    const currentX = e.touches[0]?.clientX || 0
    const dx = currentX - (swipeStartXRef.current || 0)
    if (dx < 0) {
      const v = Math.min(-dx, 96)
      setSwipeOffset(prev => ({ ...prev, [id]: v }))
    } else {
      setSwipeOffset(prev => ({ ...prev, [id]: 0 }))
    }
  }

  const onRowTouchEnd = (id) => {
    const v = swipeOffset[id] || 0
    if (v > 48) setSwipeOpenId(id)
    else setSwipeOpenId(null)
    setSwipeOffset(prev => ({ ...prev, [id]: 0 }))
    swipeActiveIdRef.current = null
    swipeStartXRef.current = null
  }

  // Badge quick filter moved to Header popup

  // Helper function to generate Sunday dates for the current month/year
  const generateSundayDates = (currentTable) => {
    if (!currentTable) return []

    try {
      const [monthName, year] = currentTable.split('_')
      const yearNum = parseInt(year)

      const monthIndex = [
        'January', 'February', 'March', 'April', 'May', 'June',
        'July', 'August', 'September', 'October', 'November', 'December'
      ].indexOf(monthName)

      if (monthIndex === -1) return []

      const sundays = []
      const date = new Date(yearNum, monthIndex, 1)

      // Find the first Sunday of the month
      while (date.getDay() !== 0) {
        date.setDate(date.getDate() + 1)
      }

      // Collect all Sundays in the month
      // Use local date format (YYYY-MM-DD) to match attendanceData keys
      while (date.getMonth() === monthIndex) {
        const y = date.getFullYear()
        const m = String(date.getMonth() + 1).padStart(2, '0')
        const d = String(date.getDate()).padStart(2, '0')
        sundays.push(`${y}-${m}-${d}`) // Local date format
        date.setDate(date.getDate() + 7)
      }

      return sundays
    } catch (error) {
      console.error('Error generating Sunday dates:', error)
      return []
    }
  }

  // Generate Sunday dates dynamically based on current table
  const sundayDates = useMemo(() => generateSundayDates(currentTable), [currentTable])

  // Aggregated counts across selected or all Sundays for Edited Members
  const selectedDatesForCounting = selectedBulkSundayDates && selectedBulkSundayDates.size > 0
    ? selectedBulkSundayDates
    : new Set(sundayDates)

  // Function to check if a member has been edited (has attendance marked for any date)
  const isEditedMember = (member) => {
    // First check: inspect member record columns from database. This works before
    // attendanceData is loaded and supports both old and date-keyed column names.
    const editedViaRecord = sundayDates.some((dateKey) => (
      resolveMemberAttendanceForDate(member, dateKey) !== undefined
    ))
    if (editedViaRecord) return true

    // Second check: attendanceData map (for real-time updates before DB sync)
    const editedViaMaps = sundayDates.some((date) => {
      const v = resolveMemberAttendanceForDate(member, date, attendanceData[date] || {})
      return v === true || v === false
    })

    return editedViaMaps
  }

  // Get filtered members based on active tab
  const getTabFilteredMembers = () => {
    const badgeFilteredMembers = getFilteredMembersByBadge()

    // Apply all filters (gender, level, visitor)
    let filteredMembers = badgeFilteredMembers

    // Gender filter
    if (genderFilter) {
      filteredMembers = filteredMembers.filter(member => {
        const g = (member['Gender'] || member.gender || '').toString()
        return g.toLowerCase() === genderFilter.toLowerCase()
      })
    }

    // Level filter
    if (levelFilter) {
      filteredMembers = filteredMembers.filter(member => {
        const level = (member['Current Level'] || member.current_level || '').toString().toUpperCase()
        return level === levelFilter.toUpperCase()
      })
    }

    // Visitor filter
    if (visitorFilter !== null) {
      filteredMembers = filteredMembers.filter(member => {
        return visitorFilter ? member.is_visitor === true : member.is_visitor !== true
      })
    }

    // Tag filter - use existing memberTags state
    if (hasTagFilters) {
      filteredMembers = filteredMembers.filter(member => {
        const memberTagIds = getMemberTagIdSet(member.id)
        return selectedTagFilters.some(tagId => memberTagIds.has(String(tagId)))
      })
    }

    // If AppContext has not produced search results yet, keep a local fallback.
    // Otherwise search, tag, gender, level, and visitor filters compose above.
    if (searchTerm && searchTerm.trim() && (!contextFilteredMembers || contextFilteredMembers.length === 0)) {
      const lowerTerm = searchTerm.toLowerCase()
      filteredMembers = filteredMembers.filter(member => {
        const name = (member['full_name'] || member['Full Name'] || '').toLowerCase()
        return name.includes(lowerTerm)
      })
    }

    if (dashboardTab === 'edited') {
      const dateKey = selectedSundayDate || getDateString(selectedAttendanceDate)
      if (!dateKey) {
        const editedOnly = filteredMembers.filter(member => {
          if (!isEditedMember(member)) return false
          // Apply name search only to members who have been edited (marked on any Sunday)
          if (searchTerm) {
            const lowerTerm = searchTerm.toLowerCase()
            const name = (member['full_name'] || member['Full Name'] || '').toLowerCase()
            if (!name.includes(lowerTerm)) return false
          }
          return true
        })
        return editedOnly.sort((a, b) => {
          // Sort by join date (respecting sortNewestFirst toggle)
          const dateA = new Date(a.inserted_at || a.created_at || 0)
          const dateB = new Date(b.inserted_at || b.created_at || 0)
          const dateDiff = sortNewestFirst ? dateB - dateA : dateA - dateB
          if (dateA !== dateB) return dateDiff
          // Then by most recent action timestamp
          const tsA = Math.max(...sundayDates.map(d => actionTimestampsRef.current[`${a.id}_${d}`] || 0))
          const tsB = Math.max(...sundayDates.map(d => actionTimestampsRef.current[`${b.id}_${d}`] || 0))
          if (tsA !== tsB) return tsB - tsA
          // Finally by name
          const an = (a['full_name'] || a['Full Name'] || '').toLowerCase()
          const bn = (b['full_name'] || b['Full Name'] || '').toLowerCase()
          return an.localeCompare(bn)
        })
      }
      // Check both attendanceData map AND member record columns for the selected date
      const map = attendanceData[dateKey] || {}
      const getVal = (member) => resolveMemberAttendanceForDate(member, dateKey, map)

      let filteredByDate = filteredMembers.filter(m => {
        const val = getVal(m)
        if (val === undefined) return false
        // Apply name search only to members who have been marked Present or Absent
        if (searchTerm) {
          const lowerTerm = searchTerm.toLowerCase()
          const name = (m['full_name'] || m['Full Name'] || '').toLowerCase()
          if (!name.includes(lowerTerm)) return false
        }
        return true
      })

      return filteredByDate.sort((a, b) => {
        // Sort by join date (respecting sortNewestFirst toggle)
        const joinDateA = new Date(a.inserted_at || a.created_at || 0)
        const joinDateB = new Date(b.inserted_at || b.created_at || 0)
        const dateDiff = sortNewestFirst ? joinDateB - joinDateA : joinDateA - joinDateB
        if (joinDateA !== joinDateB) return dateDiff
        // Then by most recent action timestamp (chronological, newest on top)
        const tsA = actionTimestampsRef.current[`${a.id}_${dateKey}`] || 0
        const tsB = actionTimestampsRef.current[`${b.id}_${dateKey}`] || 0
        if (tsA !== tsB) return tsB - tsA
        // Fallback: group Present before Absent, then alphabetical
        const avResolved = getVal(a)
        const bvResolved = getVal(b)
        const rank = (v) => (v === true ? 0 : v === false ? 1 : 2)
        const r = rank(avResolved) - rank(bvResolved)
        if (r !== 0) return r
        const an = (a['full_name'] || a['Full Name'] || '').toLowerCase()
        const bn = (b['full_name'] || b['Full Name'] || '').toLowerCase()
        return an.localeCompare(bn)
      })
    }

    if (dashboardTab === 'duplicates') {
      // For duplicates tab, only show members that are part of duplicate groups
      const duplicateMemberIds = new Set()
      duplicateGroups.forEach(group => {
        group.members.forEach(member => duplicateMemberIds.add(member.id))
      })
      return filteredMembers.filter(member => duplicateMemberIds.has(member.id))
    }

    return filteredMembers
  }

  // Aggregated counts across selected/all Sundays for members in current view
  const { presentCount, absentCount } = useMemo(() => {
    let present = 0
    let absent = 0
    if (dashboardTab === 'edited') {
      // Edited tab: count only edited members
      const membersBase = members.filter(isEditedMember)
      selectedDatesForCounting.forEach((dateKey) => {
        const map = attendanceData[dateKey] || {}
        for (const m of membersBase) {
          const val = resolveMemberAttendanceForDate(m, dateKey, map)
          if (val === true) present += 1
          else if (val === false) absent += 1
        }
      })
    } else {
      // All tab: count only current members so stale/deleted IDs do not inflate totals.
      selectedDatesForCounting.forEach((dateKey) => {
        const map = attendanceData[dateKey] || {}
        for (const member of members) {
          const val = resolveMemberAttendanceForDate(member, dateKey, map)
          if (val === true) present += 1
          else if (val === false) absent += 1
        }
      })
    }
    return { presentCount: present, absentCount: absent }
  }, [attendanceData, selectedBulkSundayDates, currentTable, dashboardTab, members])

  // Helper function to normalize names for duplicate detection
  const normalizeName = (name) => {
    if (!name) return ''
    return name.toString().toLowerCase().trim().replace(/\s+/g, ' ')
  }

  // Duplicate groups detection
  const duplicateGroups = useMemo(() => {
    const map = {}
    members.forEach(m => {
      const name = normalizeName(m['Full Name'] || m.full_name)
      if (!name) return
      if (!map[name]) map[name] = []
      map[name].push(m)
    })
    return Object.entries(map)
      .filter(([, arr]) => arr.length > 1)
      .map(([name, arr]) => ({ name, members: arr }))
  }, [members])

  // Attendance counts across all Sundays for duplicate analysis
  const attendanceCounts = useMemo(() => {
    const counts = {}
    sundayDates.forEach(d => {
      const map = attendanceData[d] || {}
      members.forEach(member => {
        const val = resolveMemberAttendanceForDate(member, d, map)
        if (val === true) counts[member.id] = (counts[member.id] || 0) + 1
      })
    })
    return counts
  }, [attendanceData, sundayDates, members])

  // Smart keep logic for duplicates (prioritize 3+ Sunday attendance)
  const groupKeepId = (members) => {
    let best = null
    let bestCount = -1
    members.forEach(m => {
      const c = attendanceCounts[m.id] || 0
      if (c >= 3 && c > bestCount) { best = m.id; bestCount = c }
    })
    if (best !== null) return best
    // Fallback to highest attendance
    members.forEach(m => {
      const c = attendanceCounts[m.id] || 0
      if (c > bestCount) { best = m.id; bestCount = c }
    })
    return best || members[0]?.id
  }

  // Helper function to show confirmation modal
  const showConfirmModal = (config) => {
    setConfirmModalConfig({
      ...config,
      isOpen: true
    })
  }

  // Toggle duplicate selection
  const toggleSelectDuplicate = (memberId) => {
    setSelectedDuplicateIds(prev => {
      const next = new Set(prev)
      if (next.has(memberId)) next.delete(memberId)
      else next.add(memberId)
      return next
    })
  }

  // Select all duplicates (excluding the "Keep" members)
  const selectAllDuplicates = () => {
    const allDuplicateIds = new Set()
    duplicateGroups.forEach(group => {
      const keepId = groupKeepId(group.members)
      group.members.forEach(member => {
        // Only select non-keep members (the duplicates to delete)
        if (member.id !== keepId) {
          allDuplicateIds.add(member.id)
        }
      })
    })
    setSelectedDuplicateIds(allDuplicateIds)
  }

  // Deselect all duplicates
  const deselectAllDuplicates = () => {
    setSelectedDuplicateIds(new Set())
  }

  // Bulk delete selected duplicates
  const deleteSelectedDuplicates = async () => {
    if (selectedDuplicateIds.size === 0) return

    showConfirmModal({
      title: "Delete Duplicate Members",
      message: `Delete ${selectedDuplicateIds.size} selected duplicate member${selectedDuplicateIds.size !== 1 ? 's' : ''}? This cannot be undone.`,
      confirmText: "Delete",
      onConfirm: async () => {
        try {
          for (const id of Array.from(selectedDuplicateIds)) {
            await deleteMember(id)
          }
          setSelectedDuplicateIds(new Set())
          toast.success(`Deleted ${selectedDuplicateIds.size} duplicate member${selectedDuplicateIds.size !== 1 ? 's' : ''}.`)
        } catch (error) {
          console.error('Bulk delete failed:', error)
          toast.error('Failed to delete selected duplicates. Please try again.')
        }
      }
    })
  }

  // Final execution of bulk delete (called from modal)
  const finalizeBulkDelete = async () => {
    setIsBulkDeleting(true)
    try {
      // Use the current state directly
      const idsToDelete = Array.from(longPressSelectedIds)

      if (idsToDelete.length === 0) {
        setIsBulkDeleting(false)
        return
      }

      // Sequentially delete members
      for (const id of idsToDelete) {
        await deleteMember(id)
      }
      toast.success(`Deleted ${idsToDelete.length} member${idsToDelete.length !== 1 ? 's' : ''}`)
      clearSelection()
    } catch (error) {
      console.error('Bulk delete failed:', error)
      toast.error('Failed to delete some members')
    } finally {
      setIsBulkDeleting(false)
    }
  }

  // Bulk delete from selection toolbar (Open Modal)
  const handleBulkDelete = () => {
    if (longPressSelectedIds.size === 0) return

    setConfirmModalConfig({
      isOpen: true,
      type: 'bulk_delete', // Custom type to render list
      title: "Delete Selected Members",
      message: "", // Ignored in favor of custom children
      confirmText: "Delete",
      confirmButtonClass: "bg-red-600 hover:bg-red-700 text-white",
      // onConfirm will be handled by the specialized handler in the render method
      onConfirm: () => { }
    })
  }

  // Per-Sunday counts for Edited Members (used in chips)
  const perDayCounts = useMemo(() => {
    const editedMembers = members.filter(isEditedMember)
    const acc = {}
    for (const dateStr of sundayDates) {
      const map = attendanceData[dateStr] || {}
      let p = 0
      let a = 0
      for (const m of editedMembers) {
        const val = resolveMemberAttendanceForDate(m, dateStr, map)
        if (val === true) p += 1
        else if (val === false) a += 1
      }
      acc[dateStr] = { present: p, absent: a }
    }
    return acc
  }, [attendanceData, members, sundayDates])

  // Fetch attendance for the selected date when table or date changes
  useEffect(() => {
    const targetDate = getDateString(selectedAttendanceDate)
    if (targetDate && lastFetchedTableRef.current !== `${currentTable}_${targetDate}`) {
      lastFetchedTableRef.current = `${currentTable}_${targetDate}`
      fetchAttendanceForDate(new Date(targetDate)).then(map => {
        setAttendanceData(prev => ({
          ...prev,
          [targetDate]: map
        }))
      })
    }
  }, [currentTable, selectedAttendanceDate, fetchAttendanceForDate, setAttendanceData])

  // Preload attendance maps when switching to Edited tab
  useEffect(() => {
    if (dashboardTab === 'edited') {
      loadAllAttendanceData()
    }
  }, [dashboardTab])

  // Ensure attendance map loads when a Sunday is selected (local state)
  useEffect(() => {
    const loadMap = async () => {
      if (selectedSundayDate && !Object.prototype.hasOwnProperty.call(attendanceData, selectedSundayDate)) {
        const map = await fetchAttendanceForDate(new Date(selectedSundayDate))
        setAttendanceData(prev => ({ ...prev, [selectedSundayDate]: map || {} }))
      }
    }
    loadMap()
  }, [selectedSundayDate, attendanceData, fetchAttendanceForDate, setAttendanceData])

  // Focus Sundays section when requested via header "Select Date"
  useEffect(() => {
    if (uiAction && uiAction.type === 'focusDateSelector' && sundaysRef.current) {
      try {
        sundaysRef.current.scrollIntoView({ behavior: 'smooth', block: 'start' })
      } catch { }
    }
  }, [uiAction])

  // Fetch attendance for all Sunday dates
  useEffect(() => {
    // Load Sunday attendance maps for all tabs to ensure highlights show in expanded cards
    if (sundayDates.length === 0) return

    let isCancelled = false
    const load = async () => {
      for (const date of sundayDates) {
        const map = await fetchAttendanceForDate(new Date(date))
        if (isCancelled) return
        // Always store the map, even if empty, to mark the date as loaded
        setAttendanceData(prev => ({
          ...prev,
          [date]: { ...(prev[date] || {}), ...map }
        }))
      }
    }
    load()
    return () => { isCancelled = true }
  }, [currentTable])

  // Reset selected Sunday when month changes
  useEffect(() => {
    setSelectedSundayDate(null)
  }, [currentTable])

  useEffect(() => {
    if (selectedAttendanceDate) {
      const key = getDateString(selectedAttendanceDate)
      setSelectedSundayDate(sundayDates.includes(key) ? key : null)
    }
  }, [selectedAttendanceDate, sundayDates])

  // Clear selections when month changes
  useEffect(() => {
    setSelectedMemberIds(new Set())
    setSelectedBulkSundayDates(new Set())
  }, [currentTable])

  // Clear multi-select when leaving Edited Members tab
  useEffect(() => {
    if (dashboardTab !== 'edited') {
      setSelectedMemberIds(new Set())
      setSelectedBulkSundayDates(new Set())
    }
  }, [dashboardTab])

  // Reset pagination when search term changes
  useEffect(() => {
    if (searchTerm) {
      // When searching, we show all results, so no need for pagination
    } else {
      // When search is cleared, reset to initial display limit
      setDisplayLimit(20)
    }
  }, [searchTerm])

  const openDeleteConfirm = (event, member) => {
    if (event) {
      event.stopPropagation()
      event.preventDefault()
    }
    setMemberToDelete(member)
    setIsDeleteConfirmOpen(true)
  }

  const confirmDelete = async () => {
    if (!memberToDelete) return
    try {
      const result = await deleteMember(memberToDelete.id)
      if (!result?.success) {
        throw result?.error || new Error('Delete failed')
      }
      // deleteMember already shows success toast, just close modal and reset state
      setSwipeOpenId(null)
      setIsDeleteConfirmOpen(false)
      setMemberToDelete(null)
    } catch (error) {
      console.error('Error deleting member:', error)
      toast.error('Failed to delete member. Please try again.')
    }
  }

  const handleAttendance = async (memberId, present) => {
    const targetDate = getDateString(selectedAttendanceDate)
    const actionKey = `${memberId}:${targetDate || 'no-date'}:${present ? 'present' : 'absent'}`

    if (attendanceActionLocksRef.current.has(actionKey)) {
      return
    }

    if (attendanceLoading[memberId]) {
      return
    }

    attendanceActionLocksRef.current.add(actionKey)

    const member = members.find(m => m.id === memberId)
    try {
      // Check for missing data before marking attendance
      if (member && checkMissingDataBeforeAttendance(member, present)) {
        return // Stop here if missing data found
      }

      // Use the selected attendance date from the picker
      if (!targetDate) {
        toast.error('Please select an attendance date first.')
        return
      }

      setAttendanceLoading(prev => ({ ...prev, [memberId]: true }))
      const currentStatus = attendanceData[targetDate]?.[memberId]

      // Toggle functionality: if clicking the same status, deselect it (set to null)
      if (currentStatus === present) {
        await markAttendance(memberId, new Date(targetDate), null)
        // Record action timestamp for chronological sorting
        actionTimestampsRef.current[`${memberId}_${targetDate}`] = Date.now()
        selection()
      } else {
        await markAttendance(memberId, new Date(targetDate), present)
        // Record action timestamp for chronological sorting
        actionTimestampsRef.current[`${memberId}_${targetDate}`] = Date.now()
        if (present) success()
        else errorHaptic()
      }
    } catch (error) {
      console.error('Error marking attendance:', error)
      errorHaptic()
      toast.error('Failed to update attendance. Please try again.')
    } finally {
      setAttendanceLoading(prev => ({ ...prev, [memberId]: false }))
      attendanceActionLocksRef.current.delete(actionKey)
    }
  }

  const handleAttendanceForDate = async (memberId, present, specificDate) => {
    const loadingKey = `${memberId}_${specificDate}`
    const actionKey = `${memberId}:${specificDate || 'no-date'}:${present ? 'present' : 'absent'}`

    if (attendanceActionLocksRef.current.has(actionKey) || attendanceLoading[loadingKey]) {
      return
    }

    attendanceActionLocksRef.current.add(actionKey)
    try {
      setAttendanceLoading(prev => ({ ...prev, [loadingKey]: true }))
      // Read from date-keyed attendance map
      const currentStatus = attendanceData[specificDate]?.[memberId]

      // Toggle functionality: if clicking the same status, deselect it (set to null)
      if (currentStatus === present) {
        await markAttendance(memberId, new Date(specificDate), null)
        // Record action timestamp for chronological sorting
        actionTimestampsRef.current[`${memberId}_${specificDate}`] = Date.now()
        selection()
      } else {
        await markAttendance(memberId, new Date(specificDate), present)
        // Record action timestamp for chronological sorting
        actionTimestampsRef.current[`${memberId}_${specificDate}`] = Date.now()
        if (present) success()
        else errorHaptic()
      }
    } catch (error) {
      console.error('Error marking attendance:', error)
      errorHaptic()
      toast.error('Failed to update attendance. Please try again.')
    } finally {
      setAttendanceLoading(prev => ({ ...prev, [loadingKey]: false }))
      attendanceActionLocksRef.current.delete(actionKey)
    }
  }

  const handleBulkAttendance = async (present, specificDate = null) => {
    selection()
    // Use the selected attendance date from the picker
    const targetString = getDateString(selectedAttendanceDate)
    const dateToUse = specificDate ? new Date(specificDate) : (targetString ? new Date(targetString) : new Date())
    const dateLabel = dateToUse.toLocaleDateString()

    showConfirmModal({
      title: "Bulk Attendance Update",
      message: `Mark all members as ${present ? 'present' : 'absent'} on ${dateLabel}?`,
      confirmText: "Update",
      confirmButtonClass: present ? "bg-green-600 hover:bg-green-700 text-white" : "bg-red-600 hover:bg-red-700 text-white",
      onConfirm: async () => {
        try {
          const memberIds = contextFilteredMembers.map(member => member.id)
          await bulkAttendance(memberIds, dateToUse, present)
          // Record action timestamps for chronological sorting
          const bulkDateKey = getDateString(dateToUse)
          const bulkNow = Date.now()
          memberIds.forEach(id => {
            actionTimestampsRef.current[`${id}_${bulkDateKey}`] = bulkNow
          })
          if (present) success()
          else errorHaptic()
          toast.success(`All members marked as ${present ? 'present' : 'absent'} successfully!`, {
            style: { background: present ? '#10b981' : '#ef4444', color: '#ffffff' }
          })
        } catch (error) {
          console.error('Error with bulk attendance:', error)
          errorHaptic()
          toast.error('Error updating attendance. Please try again.', {
            style: { background: '#ef4444', color: '#ffffff' }
          })
        }
      }
    })
  }

  // Function to fetch tags for a member
  const fetchMemberTags = async (memberId) => {
    try {
      const { data, error } = await supabase.rpc('get_member_tags', {
        p_member_id: memberId,
        p_table_name: currentTable
      })

      if (error) throw error
      const nextTags = data || []
      setMemberTags(prev => ({
        ...prev,
        [memberId]: nextTags
      }))
      setAllMemberTags(prev => ({
        ...prev,
        [memberId]: nextTags.map(tag => String(tag.id)).filter(Boolean)
      }))
    } catch (error) {
      console.error('Error fetching member tags:', error)
    }
  }

  const toggleMemberExpansion = (memberId) => {
    selection()
    const isExpanding = !expandedMembers[memberId]
    setExpandedMembers(prev => ({
      ...prev,
      [memberId]: isExpanding
    }))
    // Fetch tags when expanding
    if (isExpanding) {
      fetchMemberTags(memberId)
    }
  }

  // Toggle member selection for bulk actions
  const toggleMemberSelection = (memberId) => {
    setSelectedMemberIds(prev => {
      const next = new Set(prev)
      if (next.has(memberId)) next.delete(memberId)
      else next.add(memberId)
      return next
    })
  }

  const clearMemberSelection = () => setSelectedMemberIds(new Set())

  const selectAllVisibleMembers = () => {
    const tabFilteredMembers = getTabFilteredMembers()
    const membersToShow = searchTerm ? tabFilteredMembers : tabFilteredMembers.slice(0, displayLimit)
    setSelectedMemberIds(new Set(membersToShow.map(m => m.id)))
  }

  // Toggle Sunday selection for bulk actions
  const toggleSundayBulkSelection = (dateStr) => {
    setSelectedBulkSundayDates(prev => {
      const next = new Set(prev)
      if (next.has(dateStr)) next.delete(dateStr)
      else next.add(dateStr)
      return next
    })
  }

  const selectAllSundays = () => {
    setSelectedBulkSundayDates(new Set(sundayDates))
  }

  const clearSundayBulkSelection = () => setSelectedBulkSundayDates(new Set())

  // Bulk Transfer attendance from one Sunday to another
  const handleBulkTransfer = async () => {
    if (!selectedSundayDate || !transferTargetDate) {
      toast.error('Please select both source and target dates')
      return
    }
    if (selectedSundayDate === transferTargetDate) {
      toast.error('Source and target dates cannot be the same')
      return
    }

    const sourceMap = attendanceData[selectedSundayDate] || {}

    // Filter by selected members if any are selected
    const idsToTransfer = selectedTransferIds.size > 0
      ? Array.from(selectedTransferIds)
      : Object.keys(sourceMap).filter(id => sourceMap[id] === true || sourceMap[id] === false)

    const presentIds = idsToTransfer.filter(id => sourceMap[id] === true)
    const absentIds = idsToTransfer.filter(id => sourceMap[id] === false)

    if (presentIds.length === 0 && absentIds.length === 0) {
      toast.error('No attendance records to transfer')
      return
    }

    setIsTransferring(true)
    try {
      // Transfer present members
      if (presentIds.length > 0) {
        await bulkAttendance(presentIds, new Date(transferTargetDate), true)
      }
      // Transfer absent members
      if (absentIds.length > 0) {
        await bulkAttendance(absentIds, new Date(transferTargetDate), false)
      }

      // Clear source date attendance for transferred members
      for (const id of [...presentIds, ...absentIds]) {
        await markAttendance(id, new Date(selectedSundayDate), null)
      }

      // Refresh attendance data
      const newSourceMap = await fetchAttendanceForDate(new Date(selectedSundayDate))
      const newTargetMap = await fetchAttendanceForDate(new Date(transferTargetDate))
      setAttendanceData(prev => ({
        ...prev,
        [selectedSundayDate]: newSourceMap,
        [transferTargetDate]: newTargetMap
      }))

      const sourceLabel = new Date(selectedSundayDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
      const targetLabel = new Date(transferTargetDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
      toast.success(`Transferred ${presentIds.length + absentIds.length} records from ${sourceLabel} to ${targetLabel}`)

      // Close modal and reset selection
      setShowTransferModal(false)
      setTransferTargetDate(null)
      setSelectedTransferIds(new Set())
      setSelectedSundayDate(transferTargetDate) // Switch to target date
    } catch (error) {
      console.error('Transfer failed:', error)
      toast.error('Failed to transfer attendance. Please try again.')
    } finally {
      setIsTransferring(false)
    }
  }

  // Initialize selected transfer IDs when modal opens
  const openTransferModal = () => {
    setSelectedTransferIds(new Set()) // Start with none selected by default
    setShowTransferModal(true)
  }

  // Select only members registered today
  const selectTodayMembers = () => {
    const sourceMap = attendanceData[selectedSundayDate] || {}
    const memberIds = Object.keys(sourceMap).filter(id => sourceMap[id] === true || sourceMap[id] === false)
    const today = new Date()
    today.setHours(0, 0, 0, 0)

    const todayIds = memberIds.filter(id => {
      const member = members.find(m => m.id === id)
      if (!member) return false
      const createdAt = member.created_at || member.inserted_at
      if (!createdAt) return false
      const regDate = new Date(createdAt)
      regDate.setHours(0, 0, 0, 0)
      return regDate.getTime() === today.getTime()
    })

    setSelectedTransferIds(new Set(todayIds))
  }

  // Toggle transfer member selection
  const toggleTransferMember = (id) => {
    setSelectedTransferIds(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }


  // Bulk apply attendance to selected members and Sundays
  const handleMultiAttendanceAction = async (status) => {
    const memberIds = Array.from(selectedMemberIds)
    if (memberIds.length === 0) {
      toast.error('Please select at least one member to apply.')
      return
    }

    const targetDate = getDateString(selectedAttendanceDate)
    if (!targetDate) {
      toast.error('Please select an attendance date first.')
      return
    }

    const dateLabel = selectedAttendanceDate ? new Date(selectedAttendanceDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : ''
    setIsBulkApplying(true)
    try {
      if (status === null) {
        // Clear individually when status is null
        for (const id of memberIds) {
          await markAttendance(id, new Date(targetDate), null)
        }
      } else {
        await bulkAttendance(memberIds, new Date(targetDate), status)
      }
      // Record action timestamps for chronological sorting
      const multiNow = Date.now()
      memberIds.forEach(id => {
        actionTimestampsRef.current[`${id}_${targetDate}`] = multiNow
      })
      const actionText = status === null ? 'cleared' : status ? 'present' : 'absent'
      toast.success(`Bulk ${actionText} applied to ${memberIds.length} member(s) for ${dateLabel}.`)
    } catch (error) {
      console.error('Bulk attendance failed:', error)
      toast.error('Failed to apply bulk update. Please try again.')
    } finally {
      setIsBulkApplying(false)
    }
  }



  const handleBulkBadgeAssignment = async (badgeType) => {
    if (!contextFilteredMembers.length) return

    const badgeNames = {
      'member': 'Member Badge',
      'regular': 'Regular Attendee',
      'newcomer': 'Newcomer'
    }

    const badgeName = badgeNames[badgeType]
    const memberCount = contextFilteredMembers.length

    showConfirmModal({
      title: "Assign Badge",
      message: `Assign "${badgeName}" to ${memberCount} member${memberCount !== 1 ? 's' : ''}?`,
      confirmText: "Assign",
      confirmButtonClass: "bg-orange-600 hover:bg-orange-700 text-white",
      onConfirm: async () => {
        setIsUpdatingBadges(true)
        try {
          for (const member of contextFilteredMembers) {
            // Only add the badge if the member doesn't already have it
            if (!memberHasBadge(member, badgeType)) {
              await toggleMemberBadge(member.id, badgeType)
            }
          }
          await updateMemberBadges()
          toast.success(`Successfully assigned "${badgeName}" to ${memberCount} member${memberCount !== 1 ? 's' : ''}!`, {
            style: { background: '#f97316', color: '#ffffff' }
          })
        } catch (error) {
          console.error('Error assigning badges:', error)
          toast.error('Error assigning badges. Please try again.', {
            style: { background: '#ef4444', color: '#ffffff' }
          })
        } finally {
          setIsUpdatingBadges(false)
        }
      }
    })
  }

  const getFilteredMembersByBadge = () => {
    // When searching, ignore badge filters and search across all members
    if (searchTerm.trim()) return contextFilteredMembers

    // If no filters selected, show all members
    if (badgeFilter.length === 0) return contextFilteredMembers

    // Filter members by selected badge filters
    // Use explicit badge assignment if available; otherwise fall back to calculated badge
    return contextFilteredMembers.filter(member => {
      return badgeFilter.some((type) => {
        // Match if the member explicitly has the badge or their calculated badge equals the type
        return memberHasBadge(member, type) || calculateMemberBadge(member) === type
      })
    })
  }



  const handleIndividualBadgeAssignment = async (memberId, badgeType) => {
    setBadgeAssignmentLoading(prev => ({ ...prev, [memberId]: badgeType }))

    try {
      const member = members.find(m => m.id === memberId)
      const memberName = member ? (member['full_name'] || member['Full Name']) : 'Member'
      const hasBadge = memberHasBadge(member, badgeType)

      // Badge colors matching the icon colors
      const badgeColors = {
        'member': '#f97316',
        'regular': '#10b981',  // Green
        'newcomer': '#f59e0b'  // Amber/Gold
      }

      // Toggle the badge
      await toggleMemberBadge(memberId, badgeType, { suppressToast: true })
      await updateMemberBadges()

      const badgeName = badgeType.charAt(0).toUpperCase() + badgeType.slice(1)
      // Single consolidated notification and silent refresh
      const message = `${badgeName} badge ${hasBadge ? 'removed' : 'assigned'} for: ${memberName} - data refreshed`
      toast.success(message, {
        style: hasBadge
          ? { background: '#f3f4f6', color: '#374151' }
          : { background: badgeColors[badgeType], color: '#ffffff' }
      })
      // Ensure UI reflects latest DB state when using Supabase, but silently
      await forceRefreshMembersSilent()
    } catch (error) {
      console.error('Error managing badge:', error)
      toast.error('Failed to update badge. Please try again.')
    } finally {
      setBadgeAssignmentLoading(prev => ({ ...prev, [memberId]: null }))
    }
  }

  const getMemberSearchName = (member) => (
    member?.full_name || member?.['full_name'] || member?.['Full Name'] || 'Unknown member'
  )

  const getMemberEmail = (member) => (
    member?.email || member?.Email || member?.['Email Address'] || ''
  )

  const getMemberPhone = (member) => (
    member?.['Phone Number'] || member?.phone || member?.Phone || ''
  )

  const getMemberLevel = (member) => (
    member?.['Current Level'] || member?.level || member?.Level || 'N/A'
  )

  const getMemberJoinLabel = (member) => {
    const rawDate = member?.inserted_at || member?.created_at
    if (!rawDate) return 'Joined Jan 10'
    const date = new Date(rawDate)
    if (Number.isNaN(date.getTime())) return 'Joined Jan 10'
    return `Joined ${date.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}`
  }

  const openMemberPass = useCallback((member) => {
    if (!member || preferences?.member_codes_enabled !== true) return
    selection()
    if (preferences?.member_code_quick_pass_enabled === false) {
      setProfileMember(member)
      return
    }
    setQuickPassMember(member)
  }, [preferences?.member_code_quick_pass_enabled, preferences?.member_codes_enabled, selection])

  const openMemberProfile = useCallback((member) => {
    if (!member) return
    selection()
    setQuickPassMember(null)
    setProfileMember(member)
  }, [selection])

  const pendingSearchTerm = localSearchTerm.trim()
  const memberIndexCodeMap = useMemo(() => buildMemberIndexCodeMap(members), [members])
  const contactMember = useCallback(async (member, type) => {
    const phone = getMemberPhone(member).replace(/[^\d+]/g, '')
    const email = getMemberEmail(member)
    const name = getMemberSearchName(member)
    if (type === 'whatsapp') {
      if (!phone) {
        toast.info('No phone number')
        return
      }
      window.open(`https://wa.me/${phone.replace(/^\+/, '')}`, '_blank', 'noopener,noreferrer')
      return
    }
    if (type === 'sms') {
      if (!phone) {
        toast.info('No phone number')
        return
      }
      window.location.href = `sms:${phone}`
      return
    }
    if (type === 'email') {
      if (!email) {
        toast.info('No email address')
        return
      }
      window.location.href = `mailto:${email}`
      return
    }
    const code = getMemberIndexCode(member, memberIndexCodeMap)
    try {
      await navigator.clipboard.writeText(`${name} - ${code}`)
      toast.success('Member code copied')
    } catch {
      toast.error('Copy failed')
    }
  }, [memberIndexCodeMap])
  const searchSuggestionMembers = pendingSearchTerm
    ? (() => {
        const lowerTerm = pendingSearchTerm.toLowerCase()
        const sourceMembers = dashboardTab === 'edited'
          ? members.filter(isEditedMember)
          : dashboardTab === 'duplicates'
            ? duplicateGroups.flatMap(group => group.members)
            : members
        const seen = new Set()
        return sourceMembers
          .filter(member => {
            if (!member?.id || seen.has(member.id)) return false
            seen.add(member.id)
            return getMemberSearchName(member).toLowerCase().includes(lowerTerm) || memberMatchesIndexCode(member, memberIndexCodeMap, pendingSearchTerm)
          })
          .sort((a, b) => {
            const nameA = getMemberSearchName(a).toLowerCase()
            const nameB = getMemberSearchName(b).toLowerCase()
            const codeA = getMemberIndexCode(a, memberIndexCodeMap).toLowerCase()
            const codeB = getMemberIndexCode(b, memberIndexCodeMap).toLowerCase()
            const aCodeStarts = codeA.startsWith(lowerTerm) ? 0 : 1
            const bCodeStarts = codeB.startsWith(lowerTerm) ? 0 : 1
            if (aCodeStarts !== bCodeStarts) return aCodeStarts - bCodeStarts
            const aStarts = nameA.startsWith(lowerTerm) ? 0 : 1
            const bStarts = nameB.startsWith(lowerTerm) ? 0 : 1
            if (aStarts !== bStarts) return aStarts - bStarts
            return nameA.localeCompare(nameB)
          })
          .slice(0, 10)
      })()
    : []
  const isShortSearchView = searchSuggestionView !== 'full'
  const showSearchSuggestions = pendingSearchTerm.length > 0 && (isShortSearchView || isSearchFocused)
  const isShortSearchActive = isShortSearchView && showSearchSuggestions
  const isShortSearchDisplayActive = isShortSearchView && dashboardTab !== 'edited'
  const showSearchTrayDelete = preferences?.member_search_tray_delete_enabled !== false
  const memberFilterButtonEnabled = preferences?.member_filter_button_enabled === true
  const memberCodesEnabled = preferences?.member_codes_enabled === true
  const memberCodeBadgeStyle = preferences?.member_code_badge_style || 'soft'
  const memberCodeShowLogo = preferences?.member_code_show_logo !== false
  const memberCodeShowPhoto = preferences?.member_code_show_photo !== false
  const memberCodeShowEmail = preferences?.member_code_show_email !== false

  useEffect(() => {
    if (memberFilterButtonEnabled) return
    if (showFilters || isClosingFilters) {
      setShowFilters(false)
      setIsClosingFilters(false)
    }
    if (genderFilter) setGenderFilter(null)
    if (levelFilter) setLevelFilter(null)
    if (visitorFilter !== null) setVisitorFilter(null)
    if (tagFilter) setTagFilter(null)
  }, [
    memberFilterButtonEnabled,
    showFilters,
    isClosingFilters,
    genderFilter,
    levelFilter,
    visitorFilter,
    tagFilter
  ])

  const applySearchSelection = (value) => {
    selection()
    setLocalSearchTerm(value)
    setSearchTerm(value)
    setIsSearchFocused(false)
  }

  const renderSearchSuggestionTray = () => {
    if (!showSearchSuggestions || !isShortSearchView) return null
    return (
      <div className="fixed bottom-[calc(4.35rem+env(safe-area-inset-bottom,0px))] left-3 right-3 z-40 overflow-hidden rounded-[1.45rem] border border-orange-200/80 bg-white/96 ring-1 ring-white/70 backdrop-blur-2xl animate-in fade-in slide-in-from-bottom-3 duration-200 dark:border-orange-500/45 dark:bg-[#101111]/96 dark:ring-white/[0.04] sm:left-1/2 sm:right-auto sm:w-[min(92rem,calc(100vw-2rem))] sm:-translate-x-1/2 md:bottom-[calc(4.75rem+env(safe-area-inset-bottom,0px))] md:rounded-[1.8rem]">
        <div className="border-b border-orange-100/80 bg-gradient-to-r from-orange-50/95 via-white/95 to-orange-50/70 px-4 pb-2 pt-4 dark:border-white/[0.06] dark:from-[#171817] dark:via-[#171817] dark:to-[#201714] sm:px-7 sm:pt-5">
          <p className="text-xs font-black uppercase tracking-[0.16em] text-orange-600 dark:text-orange-300 sm:text-sm">Search matches</p>
        </div>
        <div className="datser-search-scroll grid max-h-[44vh] gap-3 overflow-y-auto overscroll-contain bg-[radial-gradient(circle_at_50%_0%,rgba(249,115,22,0.10),transparent_36%),linear-gradient(180deg,rgba(255,255,255,0.92),rgba(255,247,237,0.55))] px-2 pb-3 pt-3 dark:bg-[radial-gradient(circle_at_50%_0%,rgba(249,115,22,0.16),transparent_40%),linear-gradient(180deg,rgba(255,255,255,0.02),rgba(0,0,0,0.10))] sm:max-h-[48vh] sm:px-5 sm:pb-5 md:grid-cols-2 xl:grid-cols-3">
          {searchSuggestionMembers.length > 0 ? (
            searchSuggestionMembers.map((member) => {
              const isExpanded = !!expandedMembers[member.id]
              const isSelected = longPressSelectedIds.has(member.id) || selectedMemberIds.has(member.id)
              const targetDate = getDateString(selectedAttendanceDate)
              return (
                <MemberCard
                  key={member.id}
                  member={member}
                  memberIndexCode={memberCodesEnabled ? getMemberIndexCode(member, memberIndexCodeMap) : null}
                  onIndexClick={openMemberPass}
                  memberCodeBadgeStyle={memberCodeBadgeStyle}
                  isExpanded={isExpanded}
                  isSelected={isSelected}
                  selectionMode={selectionMode}
                  onToggleExpansion={toggleMemberExpansion}
                  onToggleSelection={toggleSelection}
                  onLongPressStart={handleLongPressStart}
                  onLongPressMove={handleLongPressMove}
                  onLongPressEnd={handleLongPressEnd}
                  onMouseDown={handleMouseDown}
                  onMouseUp={handleMouseUp}
                  onAttendance={handleAttendance}
                  onAttendanceForDate={handleAttendanceForDate}
                  onEdit={setEditingMember}
                  onDelete={openDeleteConfirm}
                  attendanceStatus={targetDate ? attendanceData[targetDate]?.[member.id] : undefined}
                  attendanceLoading={attendanceLoading[member.id]}
                  monthSundays={sundayDates}
                  attendanceData={attendanceData}
                  memberTags={memberTags[member.id]}
                  currentTable={currentTable}
                  getMonthDisplayName={getMonthDisplayName}
                  showDeleteActions={showSearchTrayDelete}
                />
              )
            })
          ) : (
            <div className="px-4 py-8 text-center text-sm font-semibold text-gray-400 md:col-span-2 xl:col-span-3">
              No matching names yet
            </div>
          )}
        </div>
      </div>
    )
  }

  if (loading) {
    return (
      <div className="max-w-7xl mx-auto px-0 sm:px-4 mt-8">
        <TableSkeleton />
      </div>
    )
  }

  return (
    <div className="space-y-2 pb-24 md:pb-12 max-w-7xl mx-auto px-0 sm:px-4">
      {/* Header removed; summary now shown in sticky Header */}

      {/* Desktop tab navigation removed; use mobile segmented control in Header */}

      {/* Edited Members: Sundays Quick View */}
      {dashboardTab === 'edited' && (
        <div ref={sundaysRef} className="block mt-4 sm:mt-10 bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-3 sm:p-4 shadow-sm w-[96%] sm:w-full mx-auto">
          {/* Header - stacked on mobile, inline on desktop */}
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 mb-3">
            <h3 className="text-sm sm:text-lg font-semibold text-gray-900 dark:text-white flex items-center gap-2">
              <Calendar className="w-4 h-4 text-primary-600" />
              <span className="truncate">{getMonthDisplayName(currentTable)} Sundays</span>
            </h3>
            <div className="flex items-center gap-1.5 sm:gap-2 flex-wrap">
              {/* Sort Order Toggle */}
              <button
                onClick={() => setSortNewestFirst(!sortNewestFirst)}
                className={`text-[11px] sm:text-xs px-2 py-1 rounded-full flex items-center gap-1 transition-colors ${sortNewestFirst
                  ? 'bg-orange-100 dark:bg-orange-900/30 text-orange-700 dark:text-orange-400 border border-orange-300 dark:border-orange-700'
                  : 'bg-sky-100 dark:bg-sky-900/30 text-sky-700 dark:text-sky-400 border border-sky-300 dark:border-sky-700'
                  }`}
                title={sortNewestFirst ? 'Newest to Oldest' : 'Oldest to Newest'}
              >
                <span className="text-xs">Sort</span>
                {sortNewestFirst ? 'Newest' : 'Oldest'}
              </button>
              {selectedSundayDate && (
                <>
                  <button
                    onClick={openTransferModal}
                    className="text-[11px] sm:text-xs px-2 py-1 rounded bg-orange-100 dark:bg-orange-900/30 text-orange-700 dark:text-orange-400 hover:bg-orange-200 dark:hover:bg-orange-900/50 border border-orange-300 dark:border-orange-700"
                    title="Transfer attendance to another date"
                  >
                    Transfer
                  </button>
                  <button
                    onClick={() => setSelectedSundayDate(null)}
                    className="text-[11px] sm:text-xs px-2 py-1 rounded bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600"
                    title="Clear date selection"
                  >
                    Clear
                  </button>
                </>
              )}
            </div>
          </div>

          {/* Sunday date chips - horizontal scroll on mobile */}
          <div className="flex gap-2 mb-3 overflow-x-auto pb-2 -mx-1 px-1 scrollbar-hide">
            {sundayDates.length === 0 && (
              <div className="text-xs sm:text-sm text-gray-600 dark:text-gray-300 whitespace-nowrap">No Sundays found for this month</div>
            )}
            {sundayDates.map(dateStr => {
              const isSelected = selectedSundayDate === dateStr
              const dateObj = new Date(dateStr)
              const label = dateObj.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
              const map = attendanceData[dateStr] || {}
              const presentCount = members.filter(member => resolveMemberAttendanceForDate(member, dateStr, map) === true).length
              const absentCount = members.filter(member => resolveMemberAttendanceForDate(member, dateStr, map) === false).length
              return (
                <button
                  key={dateStr}
                  onClick={async () => {
                    setSelectedSundayDate(dateStr)
                    if (!attendanceData[dateStr]) {
                      const map = await fetchAttendanceForDate(new Date(dateStr))
                      setAttendanceData(prev => ({ ...prev, [dateStr]: map }))
                    }
                  }}
                  className={`flex-shrink-0 flex items-center gap-1.5 sm:gap-2 px-2.5 sm:px-3 py-1.5 rounded-lg text-xs sm:text-sm font-medium transition-colors duration-150 border ${isSelected
                    ? 'bg-[#FFE5D9] dark:bg-[#8B4513] text-orange-900 dark:text-white border-orange-300 dark:border-orange-700 shadow-lg scale-[1.02]'
                    : 'bg-white dark:bg-gray-800 text-gray-800 dark:text-gray-200 border-gray-200 dark:border-gray-600 hover:bg-gray-50 dark:hover:bg-gray-700 shadow-sm'
                    }`}
                  title={`${label}: ${presentCount} present, ${absentCount} absent`}
                >
                  <span className="font-medium whitespace-nowrap">{label}</span>
                  <div className="flex items-center gap-0.5 sm:gap-1">
                    <span className={`text-[10px] sm:text-xs px-1 sm:px-1.5 py-0.5 rounded font-semibold ${isSelected ? 'bg-green-200/60 dark:bg-green-400/30 text-green-700 dark:text-green-100' : 'bg-green-100 dark:bg-green-900/40 text-green-600 dark:text-green-400'}`}>
                      {presentCount}
                    </span>
                    <span className={`text-[10px] sm:text-xs px-1 sm:px-1.5 py-0.5 rounded font-semibold ${isSelected ? 'bg-red-200/60 dark:bg-red-400/30 text-red-700 dark:text-red-100' : 'bg-red-100 dark:bg-red-900/40 text-red-600 dark:text-red-400'}`}>
                      {absentCount}
                    </span>
                  </div>
                </button>
              )
            })}
          </div>

          {/* Attendance summary for selected Sunday */}
          {selectedSundayDate && (
            <div className="mt-2 space-y-3">
              {(() => {
                const dateObj = new Date(selectedSundayDate)
                const labelFull = dateObj.toLocaleDateString('en-US', { weekday: 'short', month: 'long', day: 'numeric' })
                const map = attendanceData[selectedSundayDate] || {}
                const presentMembers = members.filter(m => resolveMemberAttendanceForDate(m, selectedSundayDate, map) === true)
                const absentMembers = members.filter(m => resolveMemberAttendanceForDate(m, selectedSundayDate, map) === false)
                const presentCount = presentMembers.length
                const absentCount = absentMembers.length

                // Sort by action timestamp (most recent first), fallback to name
                const sortByTimestamp = (a, b) => {
                  const tsA = actionTimestampsRef.current[`${a.id}_${selectedSundayDate}`] || 0
                  const tsB = actionTimestampsRef.current[`${b.id}_${selectedSundayDate}`] || 0
                  if (tsA !== tsB) return tsB - tsA
                  const nameA = (a['full_name'] || a['Full Name'] || '').toLowerCase()
                  const nameB = (b['full_name'] || b['Full Name'] || '').toLowerCase()
                  return nameA.localeCompare(nameB)
                }
                presentMembers.sort(sortByTimestamp)
                absentMembers.sort(sortByTimestamp)

                return (
                  <>
                    {/* Summary Header */}
                    <div className="bg-gray-50 dark:bg-gray-700 rounded-lg border border-gray-200 dark:border-gray-600 p-2.5 sm:p-3">
                      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-1.5 sm:gap-0">
                        <div className="text-sm sm:text-base font-medium text-gray-900 dark:text-white">
                          {labelFull}
                        </div>
                        <div className="flex items-center gap-3 text-xs sm:text-sm">
                          <span className="flex items-center gap-1.5">
                            <span className="w-2 h-2 rounded-full bg-green-500"></span>
                            <span className="text-green-600 dark:text-green-400 font-medium">{presentCount} Present</span>
                          </span>
                          <span className="flex items-center gap-1.5">
                            <span className="w-2 h-2 rounded-full bg-red-500"></span>
                            <span className="text-red-600 dark:text-red-400 font-medium">{absentCount} Absent</span>
                          </span>
                        </div>
                      </div>
                    </div>

                    {/* Registered Members List - Stacked on mobile, side by side on desktop */}
                    {(presentCount > 0 || absentCount > 0) && (
                      <div className={`grid grid-cols-1 sm:grid-cols-2 gap-2 sm:gap-3 ${searchTerm ? '' : 'transition-colors duration-300'} grid-animate`}>
                        {/* Present Members - Left Column (Collapsible) */}
                        <details className="bg-white dark:bg-gray-800 rounded-xl border border-green-200 dark:border-green-900/50 overflow-hidden">
                          <summary className="px-3 py-2.5 bg-green-50 dark:bg-green-900/20 border-b border-green-200 dark:border-green-900/50 cursor-pointer list-none flex items-center justify-between hover:bg-green-100 dark:hover:bg-green-900/30 transition-colors">
                            <h4 className="text-sm font-semibold text-green-700 dark:text-green-400 flex items-center gap-2">
                              <span className="w-2 h-2 rounded-full bg-green-500"></span>
                              Present ({presentCount})
                            </h4>
                            <ChevronDown className="w-4 h-4 text-green-600 dark:text-green-400 transition-transform [details[open]>&]:rotate-180" />
                          </summary>
                          <div className="divide-y divide-gray-100 dark:divide-gray-700 max-h-64 overflow-y-auto">
                            {presentCount === 0 ? (
                              <div className="px-3 py-4 text-center text-xs sm:text-sm text-gray-400 dark:text-gray-500">No one present</div>
                            ) : (
                              presentMembers.map((member, index) => {
                                const name = member['full_name'] || member['Full Name'] || 'Unknown'
                                const createdAt = member.created_at || member.inserted_at ? new Date(member.created_at || member.inserted_at) : null
                                const dateStr = createdAt
                                  ? createdAt.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
                                  : ''
                                const timeStr = createdAt
                                  ? createdAt.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }).toLowerCase()
                                  : ''
                                return (
                                  <button
                                    key={member.id}
                                    onClick={() => setEditingMember(member)}
                                    className="w-full flex items-center justify-between gap-2 px-3 py-2.5 hover:bg-green-50 dark:hover:bg-green-900/10 transition-colors text-left"
                                  >
                                    <div className="flex items-center gap-2 min-w-0">
                                      <div className="w-6 h-6 rounded-full bg-gradient-to-br from-green-400 to-green-600 flex items-center justify-center text-white text-xs font-bold shadow-sm flex-shrink-0">
                                        {index + 1}
                                      </div>
                                      <p className="text-sm font-medium text-gray-900 dark:text-white truncate">{name}</p>
                                    </div>
                                    {createdAt && (
                                      <div className="flex-shrink-0 text-right">
                                        <p className="text-xs font-medium text-gray-700 dark:text-white">{dateStr}</p>
                                        <p className="text-xs font-semibold text-green-600 dark:text-green-400">{timeStr}</p>
                                      </div>
                                    )}
                                  </button>
                                )
                              })
                            )}
                          </div>
                        </details>

                        {/* Absent Members - Right Column (Collapsible) */}
                        <details className="bg-white dark:bg-gray-800 rounded-xl border border-red-200 dark:border-red-900/50 overflow-hidden">
                          <summary className="px-3 py-2.5 bg-red-50 dark:bg-red-900/20 border-b border-red-200 dark:border-red-900/50 cursor-pointer list-none flex items-center justify-between hover:bg-red-100 dark:hover:bg-red-900/30 transition-colors">
                            <h4 className="text-sm font-semibold text-red-700 dark:text-red-400 flex items-center gap-2">
                              <span className="w-2 h-2 rounded-full bg-red-500"></span>
                              Absent ({absentCount})
                            </h4>
                            <ChevronDown className="w-4 h-4 text-red-600 dark:text-red-400 transition-transform [details[open]>&]:rotate-180" />
                          </summary>
                          <div className="divide-y divide-gray-100 dark:divide-gray-700 max-h-64 overflow-y-auto">
                            {absentCount === 0 ? (
                              <div className="px-3 py-4 text-center text-xs sm:text-sm text-gray-400 dark:text-gray-500">No one absent</div>
                            ) : (
                              absentMembers.map((member, index) => {
                                const name = member['full_name'] || member['Full Name'] || 'Unknown'
                                const createdAt = member.created_at || member.inserted_at ? new Date(member.created_at || member.inserted_at) : null
                                const dateStr = createdAt
                                  ? createdAt.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
                                  : ''
                                const timeStr = createdAt
                                  ? createdAt.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }).toLowerCase()
                                  : ''
                                return (
                                  <button
                                    key={member.id}
                                    onClick={() => setEditingMember(member)}
                                    className="w-full flex items-center justify-between gap-2 px-3 py-2.5 hover:bg-red-50 dark:hover:bg-red-900/10 transition-colors text-left"
                                  >
                                    <div className="flex items-center gap-2 min-w-0">
                                      <div className="w-6 h-6 rounded-full bg-gradient-to-br from-red-400 to-red-600 flex items-center justify-center text-white text-xs font-bold shadow-sm flex-shrink-0">
                                        {index + 1}
                                      </div>
                                      <p className="text-sm font-medium text-gray-900 dark:text-white truncate">{name}</p>
                                    </div>
                                    {createdAt && (
                                      <div className="flex-shrink-0 text-right">
                                        <p className="text-xs font-medium text-gray-700 dark:text-white">{dateStr}</p>
                                        <p className="text-xs font-semibold text-red-600 dark:text-red-400">{timeStr}</p>
                                      </div>
                                    )}
                                  </button>
                                )
                              })
                            )}
                          </div>
                        </details>
                      </div>
                    )}
                  </>
                )
              })()}
            </div>
          )}
        </div>
      )}

      {dashboardTab === 'duplicates' && (
        <div className={`rounded-lg border p-3 sm:p-4 mt-3 sm:mt-10 ${isDarkMode ? 'bg-gray-800 border-gray-700' : 'bg-white border-gray-200'}`}>
          <div className="flex items-center justify-between mb-4">
            <h3 className={`text-base sm:text-lg font-semibold ${isDarkMode ? 'text-white' : 'text-gray-900'}`}>Duplicate Names</h3>
          </div>
          <div className="space-y-3 sm:space-y-4">
            {/* Control Bar */}
            <div className={`rounded-lg p-3 ${isDarkMode ? 'bg-gray-700' : 'bg-gray-50'}`}>
              <div className="flex items-center justify-between gap-2 flex-wrap">
                <div className={`text-xs sm:text-sm font-medium ${isDarkMode ? 'text-gray-300' : 'text-gray-700'}`}>
                  {duplicateGroups.length} names with duplicates
                  {selectedDuplicateIds.size > 0 && <span className="ml-2 text-primary-600 dark:text-primary-400">({selectedDuplicateIds.size} selected)</span>}
                </div>
                <div className="flex items-center gap-2 flex-wrap">
                  <button
                    onClick={selectedDuplicateIds.size === 0 ? selectAllDuplicates : deselectAllDuplicates}
                    className={`px-3 py-1.5 rounded text-xs sm:text-sm font-medium transition-colors ${selectedDuplicateIds.size === 0 ? 'bg-orange-600 text-white hover:bg-orange-700' : 'bg-gray-400 dark:bg-gray-600 text-white hover:bg-gray-500 dark:hover:bg-gray-500'}`}
                  >
                    {selectedDuplicateIds.size === 0 ? 'Select All' : 'Deselect All'}
                  </button>
                  <button
                    onClick={deleteSelectedDuplicates}
                    disabled={selectedDuplicateIds.size === 0}
                    className={`px-3 py-1.5 rounded text-xs sm:text-sm font-medium transition-colors ${selectedDuplicateIds.size === 0 ? 'bg-gray-300 dark:bg-gray-700 text-gray-600 dark:text-gray-400 cursor-not-allowed' : 'bg-red-600 text-white hover:bg-red-700'}`}
                  >
                    Delete All
                  </button>
                </div>
              </div>
            </div>
            {duplicateGroups.length === 0 && (
              <div className={`text-xs sm:text-sm ${isDarkMode ? 'text-gray-300' : 'text-gray-700'}`}>No duplicate names found</div>
            )}
            {duplicateGroups.map(group => {
              const keepId = groupKeepId(group.members)
              const keepMember = group.members.find(m => m.id === keepId)
              const keepMemberName = keepMember ? (keepMember['Full Name'] || keepMember.full_name) : 'Unknown'
              return (
                <div key={group.name} className={`rounded-lg border p-2.5 sm:p-3 ${isDarkMode ? 'border-gray-700' : 'border-gray-200'}`}>
                  <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-1.5 sm:gap-2 mb-2">
                    <div className="flex items-center gap-2 min-w-0">
                      <Users className="w-4 h-4 text-primary-600 flex-shrink-0" />
                      <span className={`font-semibold truncate ${isDarkMode ? 'text-white' : 'text-gray-900'}`}>{group.members[0]['Full Name'] || group.members[0].full_name}</span>
                    </div>
                    <div className="flex items-center gap-2 flex-shrink-0">
                      <span className="text-xs px-2 py-0.5 rounded bg-green-100 dark:bg-green-900 text-green-700 dark:text-green-300 border border-green-300 dark:border-green-700 truncate max-w-[120px] sm:max-w-none">Keep: {keepMemberName}</span>
                      <button
                        onClick={async () => {
                          const toDelete = group.members.map(m => m.id).filter(id => id !== keepId)
                          console.log(`[DELETE] Delete Others clicked - deleting ${toDelete.length} members:`, toDelete)
                          for (const id of toDelete) {
                            try {
                              await deleteMember(id)
                            } catch (error) {
                              console.error(`[DELETE] Failed to delete member ${id}:`, error)
                            }
                          }
                        }}
                        className="px-2 py-1 rounded text-xs bg-red-600 text-white hover:bg-red-700"
                      >
                        Delete Others
                      </button>
                    </div>
                  </div>
                  <div className="space-y-2">
                    {group.members.map(m => {
                      const c = attendanceCounts[m.id] || 0
                      const selected = selectedDuplicateIds.has(m.id)
                      const isKeepMember = m.id === keepId
                      return (
                        <div key={m.id} className={`flex items-center justify-between pl-4 pr-3 py-2 sm:px-3 sm:py-2 rounded border-2 ${isKeepMember
                          ? 'bg-green-50 dark:bg-green-900/30 border-green-300 dark:border-green-700'
                          : isDarkMode ? 'bg-gray-700 border-gray-600' : 'bg-gray-50 border-gray-200'
                          }`}>
                          <div className="flex items-center gap-3">
                            <button
                              onClick={() => toggleSelectDuplicate(m.id)}
                              className={`w-5 h-5 rounded-full border flex items-center justify-center ${selected ? 'bg-primary-600 border-primary-600' : isDarkMode ? 'border-gray-500' : 'border-gray-400'}`}
                              title={selected ? 'Unselect' : 'Select'}
                            >
                              {selected && <Check className="w-3 h-3 text-white" />}
                            </button>
                            <div>
                              <div className={`text-sm font-medium ${isKeepMember
                                ? 'text-green-800 dark:text-green-300'
                                : isDarkMode ? 'text-white' : 'text-gray-900'
                                }`}>
                                {m['Full Name'] || m.full_name}
                                {isKeepMember && <span className="ml-2 text-xs bg-green-100 dark:bg-green-800 text-green-700 dark:text-green-300 px-2 py-0.5 rounded-full">Keep</span>}
                              </div>
                              <div className={`text-xs ${isKeepMember
                                ? 'text-green-600 dark:text-green-400'
                                : isDarkMode ? 'text-gray-300' : 'text-gray-600'
                                }`}>Attendance: {c}</div>
                            </div>
                          </div>
                          <button
                            onClick={async () => {
                              console.log(`[DELETE] Delete button clicked for member ID: ${m.id}`)
                              try {
                                await deleteMember(m.id)
                              } catch (error) {
                                console.error(`[DELETE] Failed to delete member ${m.id}:`, error)
                              }
                            }}
                            className={`px-2 py-1 rounded text-xs border ${isKeepMember
                              ? 'bg-gray-100 dark:bg-gray-700 text-gray-400 dark:text-gray-500 border-gray-300 dark:border-gray-600 cursor-not-allowed opacity-50'
                              : 'bg-red-100 dark:bg-red-900 text-red-700 dark:text-red-300 hover:bg-red-200 dark:hover:bg-red-800 border-red-300 dark:border-red-700'
                              }`}
                            disabled={isKeepMember}
                            title={isKeepMember ? 'This member is recommended to keep' : 'Delete this member'}
                          >
                            Delete
                          </button>
                        </div>
                      )
                    })}
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* Badge/Sundays dashboard card removed per request */}

      {/* Top sticky search bar moved to Header.jsx */}





      {/* Fixed Bottom Selection Toolbar */}
      {longPressSelectedIds.size > 0 && (
        <div className="fixed bottom-20 left-4 right-4 z-30 flex justify-center pointer-events-none animate-in fade-in slide-in-from-bottom-4 duration-300">
          <div className="w-full max-w-4xl pointer-events-auto">
            <SelectionToolbar
              selectedCount={longPressSelectedIds.size}
              onPresent={() => handleLongPressBulkAction(true)}
              onAbsent={() => handleLongPressBulkAction(false)}
              onCancel={clearSelection}
              onDelete={handleBulkDelete}
              onSelectAll={selectAllSundays}
              onClearDays={clearSundayBulkSelection}
              sundayDates={sundayDates}
              selectedSundayDates={selectedBulkSundayDates}
              onToggleSunday={toggleSundayBulkSelection}
              isLoading={isBulkApplying || isBulkDeleting}
              showSundaySelection={dashboardTab === 'edited' && longPressSelectedIds.size > 0}
            />
          </div>
        </div>
      )}

      {/* Members List */}
      {!isShortSearchDisplayActive && (
      <div className={`${longPressSelectedIds.size > 0 ? '' : 'mt-4 sm:mt-10'} grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3 ${searchTerm ? '' : 'transition-colors duration-200'} grid-animate`}>
        {(() => {
          const tabFilteredMembers = getTabFilteredMembers()
          const membersToShow = searchTerm ? tabFilteredMembers : tabFilteredMembers.slice(0, displayLimit)
          const hasMoreMembers = !searchTerm && tabFilteredMembers.length > displayLimit

          return (
            <>
              {membersToShow.map((member, index) => {
                const isExpanded = !!expandedMembers[member.id]
                const isSelected = longPressSelectedIds.has(member.id) || selectedMemberIds.has(member.id)
                return (
                  <MemberCard
                    key={member.id}
                    member={member}
                    memberIndexCode={memberCodesEnabled ? getMemberIndexCode(member, memberIndexCodeMap) : null}
                    onIndexClick={openMemberPass}
                    memberCodeBadgeStyle={memberCodeBadgeStyle}
                    isExpanded={isExpanded}
                    isSelected={isSelected}
                    selectionMode={selectionMode}
                    onToggleExpansion={toggleMemberExpansion}
                    onToggleSelection={toggleSelection}
                    onLongPressStart={handleLongPressStart}
                    onLongPressMove={handleLongPressMove}
                    onLongPressEnd={handleLongPressEnd}
                    onMouseDown={handleMouseDown}
                    onMouseUp={handleMouseUp}
                    onAttendance={handleAttendance}
                    onAttendanceForDate={handleAttendanceForDate}
                    onEdit={setEditingMember}
                    onDelete={openDeleteConfirm}
                    attendanceStatus={(() => {
                      const targetDate = getDateString(selectedAttendanceDate)
                      if (!targetDate) return undefined
                      return attendanceData[targetDate]?.[member.id]
                    })()}
                    attendanceLoading={attendanceLoading[member.id]}
                    monthSundays={sundayDates}
                    attendanceData={attendanceData}
                    memberTags={memberTags[member.id]}
                    currentTable={currentTable}
                    getMonthDisplayName={getMonthDisplayName}
                  />
                )
              })}

              {(hasMoreMembers || (!searchTerm && tabFilteredMembers.length > 0)) && (
                <div className="lg:col-span-3 mt-4 mb-4 flex flex-col items-center justify-center space-y-2">
                  {/* Load More Button */}
                  {hasMoreMembers && (
                    <button
                      onClick={async () => {
                        selection()
                        setIsLoadingMore(true)
                        // Simulate a small delay for better UX
                        await new Promise(resolve => setTimeout(resolve, 300))
                        setDisplayLimit(prev => prev + 20)
                        setIsLoadingMore(false)
                      }}
                      disabled={isLoadingMore}
                      className="px-6 py-3 bg-primary-600 hover:bg-primary-700 disabled:bg-primary-400 text-white rounded-lg font-medium transition-colors flex items-center space-x-2"
                    >
                      {isLoadingMore ? (
                        <>
                          <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
                          <span>Loading...</span>
                        </>
                      ) : (
                        <>
                          <UserPlus className="w-4 h-4" />
                          <span>Load More ({Math.max(tabFilteredMembers.length - displayLimit, 0)} remaining)</span>
                        </>
                      )}
                    </button>
                  )}

                  {/* Members count info */}
                  {!searchTerm && tabFilteredMembers.length > 0 && (
                    <div className="text-sm md:text-base text-gray-600 dark:text-gray-400 text-center">
                      Showing {Math.min(displayLimit, tabFilteredMembers.length)} of {tabFilteredMembers.length} members
                    </div>
                  )}
                </div>
              )}
            </>
          )
        })()}
      </div>
      )}

      {isShortSearchDisplayActive && (
        <div className={`relative mx-auto mt-14 flex w-[calc(100%-1.5rem)] max-w-[92rem] overflow-hidden rounded-[1.75rem] border px-5 text-center shadow-inner backdrop-blur-xl transition-all duration-300 sm:mt-14 ${
          pendingSearchTerm
            ? 'min-h-[8.75rem] items-center justify-center py-5 sm:min-h-[9.5rem] md:min-h-[7.25rem] md:px-8'
            : 'min-h-[clamp(20rem,48vh,33rem)] items-center justify-center py-12 sm:min-h-[27rem] sm:py-16'
        } ${isDarkMode ? 'border-white/[0.08] bg-[#0d0e0e]/95 shadow-black/40' : 'border-orange-200/70 bg-white/85 shadow-orange-950/5'}`}>
          <div className={`pointer-events-none absolute inset-0 ${
            isDarkMode
              ? 'bg-[radial-gradient(circle_at_50%_42%,rgba(249,115,22,0.30),rgba(249,115,22,0.10)_27%,transparent_58%)]'
              : 'bg-[radial-gradient(circle_at_50%_42%,rgba(249,115,22,0.24),rgba(249,115,22,0.08)_25%,transparent_55%)]'
          }`} />
          <div className={`pointer-events-none absolute inset-0 ${
            isDarkMode
              ? 'bg-[linear-gradient(180deg,rgba(255,255,255,0.035),rgba(255,255,255,0.008),rgba(255,255,255,0.025))]'
              : 'bg-[linear-gradient(180deg,rgba(255,255,255,0.78),rgba(255,247,237,0.42),rgba(255,255,255,0.72))]'
          }`} />
          <div className={`relative mx-auto max-w-2xl ${pendingSearchTerm ? 'md:flex md:max-w-4xl md:items-center md:justify-center md:gap-5 md:text-left' : ''}`}>
            <div className={`grid place-items-center rounded-2xl border border-orange-500/35 bg-orange-500/10 text-orange-600 shadow-lg transition-all duration-300 ${
              isDarkMode ? 'bg-orange-500/15 text-orange-300 shadow-orange-950/25' : 'shadow-orange-950/10'
            } ${
              pendingSearchTerm ? 'mx-auto mb-3 h-12 w-12 md:mx-0 md:mb-0 md:h-14 md:w-14' : 'mx-auto mb-5 h-16 w-16'
            }`}>
              <Search className={pendingSearchTerm ? 'h-6 w-6' : 'h-8 w-8'} />
            </div>
            <div>
              <p className={`${pendingSearchTerm ? 'text-base sm:text-lg' : 'text-xl'} font-black drop-shadow-sm ${isDarkMode ? 'text-white' : 'text-gray-950'}`}>Search tray is active</p>
              <p className={`mx-auto mt-2 max-w-xl text-sm leading-6 ${isDarkMode ? 'text-gray-300' : 'text-gray-600'} ${pendingSearchTerm ? 'line-clamp-2 md:mt-1' : ''}`}>
                {pendingSearchTerm
                  ? 'Pick from the search queue below, mark Present or Absent, or clear the search to bring the member list back.'
                  : 'Start typing to open the short queue. The full member list stays hidden in this mode.'}
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Empty State - use the same getTabFilteredMembers() for consistency */}
      {!isShortSearchDisplayActive && getTabFilteredMembers().length === 0 && !loading && (
        <div className="text-center py-12">
          <Users className="w-12 h-12 text-gray-400 dark:text-gray-500 mx-auto mb-4" />
          <h3 className="text-lg font-medium text-gray-900 dark:text-white mb-2">No members found</h3>
          <p className="text-gray-600 dark:text-gray-400 mb-4">
            {dashboardTab === 'edited'
              ? 'No edited members yet. Mark Present or Absent to see them here.'
              : searchTerm
                ? 'Try adjusting your search terms'
                : 'Get started by adding your first member'}
          </p>

          {/* Debug Information for Search Issues */}
          {searchTerm && members.length > 0 && (
            <div className="bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-800 rounded-lg p-4 max-w-md mx-auto text-left">
              <h4 className="font-medium text-yellow-800 dark:text-yellow-200 mb-2">Debug Info</h4>
              <div className="text-sm text-yellow-700 dark:text-yellow-300 space-y-1">
                <p><strong>Search term:</strong> "{searchTerm}"</p>
                <p><strong>Total members:</strong> {members.length}</p>
                <p><strong>Filtered results:</strong> {contextFilteredMembers.length}</p>
                <p><strong>Current table:</strong> {currentTable}</p>
                <p><strong>Supabase status:</strong> {isSupabaseConfigured() ? 'Connected' : 'Not configured (showing mock data)'}</p>
              </div>
              <button
                onClick={() => searchMemberAcrossAllTables(searchTerm)}
                className="mt-2 w-full bg-purple-600 hover:bg-purple-700 text-white px-3 py-2 rounded text-sm font-medium transition-colors duration-200 flex items-center justify-center gap-2"
                disabled={!searchTerm.trim()}
              >
                <Search className="w-4 h-4" />
                Search All Tables
              </button>
              {!isSupabaseConfigured() && (
                <div className="mt-3 text-xs text-yellow-700 dark:text-yellow-300">
                  Tip: Configure <code>VITE_SUPABASE_URL</code> and <code>VITE_SUPABASE_ANON_KEY</code> to search real data.
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* Edit Member Modal */}
      {editingMember && (
        <Suspense fallback={null}>
          <EditMemberModal
            isOpen={!!editingMember}
            onClose={() => {
              // Refresh tags for this member after editing
              if (editingMember.id && expandedMembers[editingMember.id]) {
                fetchMemberTags(editingMember.id)
              }
              refreshTagFilters()
              setEditingMember(null)
            }}
            onTagsChange={() => {
              if (editingMember?.id) fetchMemberTags(editingMember.id)
              refreshTagFilters()
            }}
            member={editingMember}
          />
        </Suspense>
      )}

      {/* Add Member Modal */}
      {showMemberModal && (
        <Suspense fallback={null}>
          <MemberModal
            isOpen={showMemberModal}
            onClose={() => {
              setShowMemberModal(false)
              refreshTagFilters()
            }}
          />
        </Suspense>
      )}

      {/* Delete Confirm Modal */}
      {isDeleteConfirmOpen && (
        <div
          className="fixed inset-0 bg-black bg-opacity-60 flex items-center justify-center p-4 z-50 backdrop-blur-sm"
          onClick={() => { selection(); setIsDeleteConfirmOpen(false); setMemberToDelete(null) }}
          onKeyDown={(e) => e.key === 'Escape' && (setIsDeleteConfirmOpen(false), setMemberToDelete(null))}
        >
          <div
            className="bg-white dark:bg-gray-800 rounded-xl w-full max-w-md mx-4 overflow-hidden shadow-2xl border border-gray-200 dark:border-gray-700"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Header with warning icon */}
            <div className="px-6 py-4 bg-red-50 dark:bg-red-900/20 border-b border-red-200 dark:border-red-800 flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-full bg-red-100 dark:bg-red-900 flex items-center justify-center">
                  <svg className="w-5 h-5 text-red-600 dark:text-red-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                  </svg>
                </div>
                <h3 className="text-lg font-semibold text-red-800 dark:text-red-300">Confirm Deletion</h3>
              </div>
              <button
                onClick={() => { selection(); setIsDeleteConfirmOpen(false); setMemberToDelete(null) }}
                className="p-2 hover:bg-red-100 dark:hover:bg-red-800 rounded-lg transition-colors"
              >
                <X className="w-5 h-5 text-red-600 dark:text-red-400" />
              </button>
            </div>

            {/* Enhanced confirmation message */}
            <div className="px-6 py-6 text-center">
              <div className="mb-4">
                <div className="w-16 h-16 rounded-full bg-red-100 dark:bg-red-900/30 flex items-center justify-center mx-auto mb-4">
                  <svg className="w-8 h-8 text-red-600 dark:text-red-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                  </svg>
                </div>
                <h4 className="text-lg font-medium text-gray-900 dark:text-white mb-2">
                  Are you sure you want to delete this member?
                </h4>
                <p className="text-xl font-bold text-red-600 dark:text-red-400 mb-3">
                  {memberToDelete?.['full_name'] || memberToDelete?.['Full Name']}
                </p>
                <div className="bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-800 rounded-lg p-3 mb-4">
                  <p className="text-sm text-yellow-800 dark:text-yellow-300 flex items-center gap-2">
                    <svg className="w-4 h-4 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                    </svg>
                    <span><strong>This action cannot be undone.</strong> The member will be permanently removed from the system.</span>
                  </p>
                </div>
              </div>
            </div>

            {/* Enhanced action buttons */}
            <div className="px-6 py-4 bg-gray-50 dark:bg-gray-700/50 border-t border-gray-200 dark:border-gray-600 flex gap-3">
              <button
                onClick={() => { selection(); setIsDeleteConfirmOpen(false); setMemberToDelete(null) }}
                className="flex-1 px-4 py-3 border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-600 font-medium transition-colors focus:outline-none focus:ring-2 focus:ring-gray-500"
              >
                Cancel
              </button>
              <button
                onClick={() => { selection(); confirmDelete() }}
                className="flex-1 px-4 py-3 bg-red-600 hover:bg-red-700 text-white rounded-lg font-medium transition-colors focus:outline-none focus:ring-2 focus:ring-red-500 shadow-lg hover:shadow-xl"
              >
                Delete Member
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Create Month Modal */}
      {showMonthModal && (
        <Suspense fallback={null}>
          <MonthModal
            isOpen={showMonthModal}
            onClose={() => setShowMonthModal(false)}
          />
        </Suspense>
      )}

      {/* Custom Confirmation Modal */}
      <ConfirmModal
        isOpen={confirmModalConfig.isOpen}
        onClose={() => setConfirmModalConfig(prev => ({ ...prev, isOpen: false }))}
        onConfirm={confirmModalConfig.type === 'bulk_delete' ? finalizeBulkDelete : confirmModalConfig.onConfirm}
        title={confirmModalConfig.type === 'bulk_delete' ? `Delete ${longPressSelectedIds.size} Member${longPressSelectedIds.size !== 1 ? 's' : ''}` : confirmModalConfig.title}
        message={confirmModalConfig.message}
        confirmText={confirmModalConfig.confirmText}
        cancelText={confirmModalConfig.cancelText}
        confirmButtonClass={confirmModalConfig.confirmButtonClass}
        cancelButtonClass={confirmModalConfig.cancelButtonClass}
      >
        {confirmModalConfig.type === 'bulk_delete' && (
          <div className="flex flex-col gap-2 max-h-[60vh] overflow-y-auto pr-1 text-left">
            <p className="mb-4 text-center text-sm text-gray-600 dark:text-gray-400">
              Review the members selected for deletion. Click the <X className="inline w-3 h-3" /> to remove from selection.
            </p>
            <div className="space-y-2">
              {Array.from(longPressSelectedIds).map(id => {
                const m = members.find(x => x.id === id);
                if (!m) return null;
                return (
                  <div key={id} className="flex items-center justify-between bg-gray-50 dark:bg-gray-700/50 px-3 py-2 rounded-lg border border-gray-100 dark:border-gray-600 group">
                    <span className="text-sm font-medium text-gray-800 dark:text-gray-200">{m['full_name'] || m['Full Name']}</span>
                    <button
                      onClick={(e) => {
                        selection()
                        e.stopPropagation();
                        // Assuming toggleLongPressSelection logic handles removal correctly
                        toggleLongPressSelection(id);
                        // If selection becomes empty after this, the modal works empty? 
                        // It will show title "Delete 0 Members". User can cancel.
                      }}
                      className="text-gray-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 p-1.5 rounded-full transition-colors"
                      title="Remove from selection"
                    >
                      <X size={14} />
                    </button>
                  </div>
                )
              })}
            </div>
            {longPressSelectedIds.size === 0 && (
              <p className="text-center text-red-500 text-sm mt-4 font-medium">No members selected for deletion.</p>
            )}
          </div>
        )}
      </ConfirmModal>

      {/* Bulk Transfer Modal */}
      {showTransferModal && selectedSundayDate && (
        <div
          className="fixed inset-0 bg-black bg-opacity-60 flex items-center justify-center p-4 z-50 backdrop-blur-sm"
          onClick={() => { selection(); setShowTransferModal(false); setTransferTargetDate(null); setSelectedTransferIds(new Set()) }}
          onKeyDown={(e) => e.key === 'Escape' && (setShowTransferModal(false), setTransferTargetDate(null), setSelectedTransferIds(new Set()))}
        >
          <div
            className="bg-white dark:bg-gray-800 rounded-xl w-full max-w-lg mx-4 overflow-hidden shadow-2xl border border-gray-200 dark:border-gray-700 max-h-[90vh] flex flex-col"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Header */}
            <div className="px-5 py-4 bg-orange-50 dark:bg-orange-900/20 border-b border-orange-200 dark:border-orange-800 flex items-center justify-between flex-shrink-0">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-full bg-orange-100 dark:bg-orange-900 flex items-center justify-center">
                  <Calendar className="w-5 h-5 text-orange-600 dark:text-orange-400" />
                </div>
                <div>
                  <h3 className="text-lg font-semibold text-orange-800 dark:text-orange-300">Transfer Attendance</h3>
                  <p className="text-xs text-orange-600 dark:text-orange-400">Select members to transfer</p>
                </div>
              </div>
              <button
                onClick={() => { selection(); setShowTransferModal(false); setTransferTargetDate(null); setSelectedTransferIds(new Set()) }}
                className="p-2 hover:bg-orange-100 dark:hover:bg-orange-800 rounded-lg transition-colors"
              >
                <X className="w-5 h-5 text-orange-600 dark:text-orange-400" />
              </button>
            </div>

            {/* Content */}
            <div className="p-4 space-y-3 overflow-y-auto flex-1">
              {/* Source Date & Target Selection Row */}
              <div className="flex gap-3">
                <div className="flex-1 bg-gray-50 dark:bg-gray-700/50 rounded-lg p-3">
                  <p className="text-xs font-medium text-gray-500 dark:text-gray-400 uppercase mb-1">From</p>
                  <p className="text-sm font-semibold text-gray-900 dark:text-white">
                    {new Date(selectedSundayDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                  </p>
                </div>
                <div className="flex items-center">
                  <ChevronRight className="w-5 h-5 text-gray-400" />
                </div>
                <div className="flex-1">
                  <p className="text-xs font-medium text-gray-500 dark:text-gray-400 uppercase mb-1">To</p>
                  <select
                    value={transferTargetDate || ''}
                    onChange={(e) => setTransferTargetDate(e.target.value)}
                    className="w-full px-3 py-2 rounded-lg text-sm font-medium border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
                  >
                    <option value="">Select date</option>
                    {sundayDates.filter(d => d !== selectedSundayDate).map(dateStr => (
                      <option key={dateStr} value={dateStr}>
                        {new Date(dateStr).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              {/* Members List with Checkboxes */}
              <div className="bg-gray-50 dark:bg-gray-700/30 rounded-lg border border-gray-200 dark:border-gray-600 overflow-hidden">
                <div className="px-3 py-2 bg-gray-100 dark:bg-gray-700 border-b border-gray-200 dark:border-gray-600 flex items-center justify-between">
                  <p className="text-xs font-semibold text-gray-600 dark:text-gray-300 uppercase">
                    Members ({selectedTransferIds.size} selected)
                  </p>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={selectTodayMembers}
                      className="text-xs px-2 py-0.5 rounded bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400 hover:bg-green-200 dark:hover:bg-green-900/50"
                    >
                      Today
                    </button>
                    <button
                      onClick={() => {
                        const sourceMap = attendanceData[selectedSundayDate] || {}
                        const allIds = Object.keys(sourceMap).filter(id => sourceMap[id] === true || sourceMap[id] === false)
                        setSelectedTransferIds(selectedTransferIds.size === allIds.length ? new Set() : new Set(allIds))
                      }}
                      className="text-xs text-orange-600 dark:text-orange-400 hover:underline"
                    >
                      {selectedTransferIds.size === Object.keys(attendanceData[selectedSundayDate] || {}).filter(id => (attendanceData[selectedSundayDate] || {})[id] === true || (attendanceData[selectedSundayDate] || {})[id] === false).length ? 'Deselect All' : 'Select All'}
                    </button>
                  </div>
                </div>
                <div className="max-h-48 overflow-y-auto divide-y divide-gray-100 dark:divide-gray-700">
                  {(() => {
                    const sourceMap = attendanceData[selectedSundayDate] || {}
                    const memberIds = Object.keys(sourceMap).filter(id => sourceMap[id] === true || sourceMap[id] === false)
                    const today = new Date()
                    today.setHours(0, 0, 0, 0)

                    if (memberIds.length === 0) {
                      return (
                        <div className="px-4 py-6 text-center text-sm text-gray-400 dark:text-gray-500">
                          No attendance records for this date
                        </div>
                      )
                    }

                    return memberIds.map(id => {
                      const member = members.find(m => m.id === id)
                      if (!member) return null
                      const name = member['full_name'] || member['Full Name'] || 'Unknown'
                      const isPresent = sourceMap[id] === true
                      const isSelected = selectedTransferIds.has(id)

                      // Check if registered today
                      const createdAt = member.created_at || member.inserted_at
                      const regDate = createdAt ? new Date(createdAt) : null
                      let isRegisteredToday = false
                      let regTimeStr = ''
                      if (regDate) {
                        const regDateOnly = new Date(regDate)
                        regDateOnly.setHours(0, 0, 0, 0)
                        isRegisteredToday = regDateOnly.getTime() === today.getTime()
                        regTimeStr = regDate.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }).toLowerCase()
                      }

                      return (
                        <button
                          key={id}
                          onClick={() => toggleTransferMember(id)}
                          className={`w-full flex items-center gap-3 px-3 py-2.5 hover:bg-gray-100 dark:hover:bg-gray-600/50 transition-colors text-left ${isSelected ? 'bg-orange-50 dark:bg-orange-900/20' : ''}`}
                        >
                          <div className={`w-5 h-5 rounded-full border-2 flex items-center justify-center flex-shrink-0 transition-colors ${isSelected
                            ? 'bg-orange-600 border-orange-600'
                            : 'border-gray-300 dark:border-gray-500'
                            }`}>
                            {isSelected && <Check className="w-3 h-3 text-white" />}
                          </div>
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2">
                              <p className="text-sm font-medium text-gray-900 dark:text-white truncate">{name}</p>
                              {isRegisteredToday && (
                                <span className="px-1.5 py-0.5 text-xs font-medium bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400 rounded">
                                  Today {regTimeStr}
                                </span>
                              )}
                            </div>
                          </div>
                          <span className={`w-2 h-2 rounded-full flex-shrink-0 ${isPresent ? 'bg-green-500' : 'bg-red-500'}`}></span>
                        </button>
                      )
                    })
                  })()}
                </div>
              </div>

              {/* Info */}
              <p className="text-xs text-gray-500 dark:text-gray-400 text-center">
                Selected members will be moved from source to target date
              </p>
            </div>

            {/* Actions */}
            <div className="px-4 py-3 bg-gray-50 dark:bg-gray-700/50 border-t border-gray-200 dark:border-gray-700 flex gap-3 flex-shrink-0">
              <button
                onClick={() => { selection(); setShowTransferModal(false); setTransferTargetDate(null); setSelectedTransferIds(new Set()) }}
                className="flex-1 px-4 py-2.5 bg-gray-100 dark:bg-gray-600 text-gray-700 dark:text-gray-300 rounded-lg font-medium hover:bg-gray-200 dark:hover:bg-gray-500 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleBulkTransfer}
                disabled={!transferTargetDate || isTransferring || selectedTransferIds.size === 0}
                className="flex-1 px-4 py-2.5 bg-orange-600 hover:bg-orange-700 disabled:bg-orange-400 disabled:cursor-not-allowed text-white rounded-lg font-medium transition-colors flex items-center justify-center gap-2"
              >
                {isTransferring ? (
                  <>
                    <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
                    Transferring...
                  </>
                ) : (
                  `Transfer ${selectedTransferIds.size}`
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Missing Data Modal */}
      {showMissingDataModal && missingDataMember && (
        <Suspense fallback={null}>
          <MissingDataModal
            member={missingDataMember}
            missingFields={missingFields}
            missingDates={missingDates}
            pendingAttendanceAction={pendingAttendanceAction}
            selectedAttendanceDate={selectedAttendanceDate}
            onClose={closeMissingDataModal}
            onSave={() => {
              // Keep the modal closed and avoid full-page refresh/jump after save.
              // updateMember and markAttendance already update local app state.
              closeMissingDataModal({ suppressAll: true })
            }}
          />
        </Suspense>
      )}

      {/* Filter Modal */}
      {memberFilterButtonEnabled && (showFilters || isClosingFilters) && (
        <div
          className="fixed inset-0 z-[90] flex items-end md:items-center justify-center"
          onKeyDown={(e) => e.key === 'Escape' && closeFilters()}
        >
          {/* Backdrop */}
          <div
            className="absolute inset-0 bg-black/50 backdrop-blur-sm"
            onClick={closeFilters}
          />
          {/* Filter Panel */}
          <div
            className={`relative w-full md:w-[480px] md:max-w-[90vw] bg-white dark:bg-gray-800 rounded-t-2xl md:rounded-2xl shadow-2xl max-h-[80vh] overflow-hidden ${isClosingFilters ? 'filter-exit' : 'filter-enter'
              }`}
            style={filterSheetStyle}
            onClick={(e) => e.stopPropagation()}
          >
            <div
              className="md:hidden flex justify-center pt-3 pb-1 cursor-grab active:cursor-grabbing"
              role="button"
              aria-label="Drag down to close filters"
              title="Drag down to close"
              {...filterDragHandleProps}
            >
              <div className="h-1.5 w-12 rounded-full bg-gray-300 dark:bg-gray-600 shadow-sm" />
            </div>
            {/* Header */}
            <div className="flex items-center justify-between px-5 py-4 border-b border-gray-200 dark:border-gray-700">
              <h3 className="text-lg font-semibold text-gray-900 dark:text-white flex items-center gap-2">
                <Filter className="w-5 h-5 text-primary-500" />
                Filter Members
              </h3>
              <button
                onClick={() => { selection(); closeFilters() }}
                className="p-2 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-full transition-colors"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Filter Content */}
            <div className="px-5 py-4 space-y-5 overflow-y-auto max-h-[60vh]">
              {/* Gender Filter */}
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">Gender</label>
                <div className="flex gap-2">
                  {['Male', 'Female'].map(g => (
                    <button
                      key={g}
                      onClick={() => { selection(); setGenderFilter(genderFilter === g ? null : g) }}
                      className={`flex-1 px-4 py-2.5 rounded-xl text-sm font-medium transition-all ${genderFilter === g
                        ? 'bg-primary-600 text-white shadow-md'
                        : 'bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600'
                        }`}
                    >
                      {g}
                    </button>
                  ))}
                </div>
              </div>

              {/* Level Filter */}
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">Education Level</label>
                <div className="grid grid-cols-4 gap-2">
                  {levels.map(l => (
                    <button
                      key={l}
                      onClick={() => { selection(); setLevelFilter(levelFilter === l ? null : l) }}
                      className={`px-3 py-2 rounded-lg text-xs font-medium transition-all ${levelFilter === l
                        ? 'bg-primary-600 text-white shadow-md'
                        : 'bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600'
                        }`}
                    >
                      {l}
                    </button>
                  ))}
                </div>
              </div>

              {/* Status Filter */}
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">Member Status</label>
                <div className="flex gap-2">
                  <button
                    onClick={() => { selection(); setVisitorFilter(visitorFilter === false ? null : false) }}
                    className={`flex-1 px-4 py-2.5 rounded-xl text-sm font-medium transition-all ${visitorFilter === false
                      ? 'bg-primary-600 text-white shadow-md'
                      : 'bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600'
                      }`}
                  >
                    Members Only
                  </button>
                  <button
                    onClick={() => { selection(); setVisitorFilter(visitorFilter === true ? null : true) }}
                    className={`flex-1 px-4 py-2.5 rounded-xl text-sm font-medium transition-all ${visitorFilter === true
                      ? 'bg-amber-500 text-white shadow-md'
                      : 'bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600'
                      }`}
                  >
                    Visitors Only
                  </button>
                </div>
              </div>

              {/* Tag Filter */}
              {workspaceTags.length > 0 && (
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">Tags</label>
                  <div className="grid grid-cols-2 gap-2">
                    {workspaceTags.map(tag => (
                      <button
                        key={tag.id}
                        onClick={() => { selection(); toggleTagFilter(tag.id) }}
                        className={`px-3 py-2 rounded-lg text-xs font-medium transition-all flex items-center gap-2 ${selectedTagFilters.includes(String(tag.id))
                          ? 'bg-primary-600 text-white shadow-md'
                          : 'bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600'
                        }`}
                      >
                        <span 
                          className="w-3 h-3 rounded-full flex-shrink-0" 
                          style={{ backgroundColor: tag.color || '#6366f1' }}
                        />
                        {tag.name}
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>

            {/* Footer */}
            <div className="px-5 py-4 border-t border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800/50 flex gap-3">
              <button
                onClick={() => {
                  selection()
                  setGenderFilter(null)
                  setLevelFilter(null)
                  setVisitorFilter(null)
                  setTagFilter(null)
                }}
                disabled={!genderFilter && !levelFilter && visitorFilter === null && !hasTagFilters}
                className="flex-1 px-4 py-2.5 rounded-xl text-sm font-medium text-gray-700 dark:text-gray-300 bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 hover:bg-gray-50 dark:hover:bg-gray-600 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                Clear All
              </button>
              <button
                onClick={() => { selection(); closeFilters() }}
                className="flex-1 px-4 py-2.5 rounded-xl text-sm font-medium text-white bg-primary-600 hover:bg-primary-700 shadow-md transition-colors"
              >
                Apply Filters
              </button>
            </div>
          </div>
        </div>
      )}

      {quickPassMember && (
        <div className="fixed inset-0 z-[95] flex items-end justify-center bg-black/65 backdrop-blur-md" onClick={() => { selection(); setQuickPassMember(null) }}>
          <div
            className="w-full max-w-md overflow-hidden rounded-t-[2rem] border border-white/10 bg-[#111313] text-white shadow-2xl md:mb-6 md:rounded-[2rem]"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="flex items-center justify-between px-5 pt-3">
              <button
                type="button"
                onClick={() => { selection(); setQuickPassMember(null) }}
                className="grid h-11 w-11 place-items-center rounded-full border border-white/10 bg-white/5 text-white/80 hover:bg-white/10"
                aria-label="Close member pass"
              >
                <X className="h-5 w-5" />
              </button>
              <div className="h-1.5 w-14 rounded-full bg-white/25" />
              <button
                type="button"
                onClick={() => openMemberProfile(quickPassMember)}
                className="grid h-11 w-11 place-items-center rounded-full border border-white/10 bg-white/5 text-white/80 hover:bg-white/10"
                aria-label="Open member profile"
              >
                <MoreHorizontal className="h-5 w-5" />
              </button>
            </div>

            <div className="px-6 pb-7 pt-3 text-center">
              {memberCodeShowLogo && (
                <>
                  <div className="mx-auto mb-4 grid h-16 w-16 place-items-center rounded-2xl text-orange-400">
                    <Church className="h-11 w-11" />
                  </div>
                  <p className="text-sm font-semibold text-white/70">DatSer Church</p>
                  <p className="text-xs text-white/45">Growing Together in Faith</p>
                </>
              )}

              {memberCodeShowPhoto && (
                <div className="relative mx-auto my-7 h-32 w-32 rounded-full border-4 border-orange-500 bg-gradient-to-br from-orange-100 via-white to-orange-200 p-1 shadow-[0_0_60px_rgba(249,115,22,0.25)]">
                  <div className="grid h-full w-full place-items-center rounded-full bg-gradient-to-br from-orange-500 to-purple-500 text-5xl font-black text-white">
                    {getMemberSearchName(quickPassMember).charAt(0).toUpperCase()}
                  </div>
                </div>
              )}

              <div className="flex items-center justify-center gap-3">
                <h3 className="text-3xl font-black">{getMemberSearchName(quickPassMember)}</h3>
                <span className="rounded-lg border border-green-400/35 bg-green-500/15 px-3 py-1 text-sm font-black text-green-300">
                  {getMemberIndexCode(quickPassMember, memberIndexCodeMap)}
                </span>
              </div>
              <p className="mt-2 text-sm text-white/55">{getMemberJoinLabel(quickPassMember)}</p>

              <div className="mt-7 grid grid-cols-2 gap-3">
                <button
                  type="button"
                  onClick={() => contactMember(quickPassMember, 'whatsapp')}
                  className="flex items-center justify-center gap-2 rounded-xl border border-white/10 bg-white/[0.06] px-4 py-3 font-bold hover:bg-white/[0.10]"
                >
                  <Phone className="h-5 w-5 text-green-400" />
                  WhatsApp
                </button>
                <button
                  type="button"
                  onClick={() => contactMember(quickPassMember, 'sms')}
                  className="flex items-center justify-center gap-2 rounded-xl border border-white/10 bg-white/[0.06] px-4 py-3 font-bold hover:bg-white/[0.10]"
                >
                  <MessageSquare className="h-5 w-5" />
                  SMS
                </button>
              </div>
              <button
                type="button"
                onClick={() => contactMember(quickPassMember, 'copy')}
                className="mt-3 flex w-full items-center justify-center gap-2 rounded-xl border border-white/10 bg-white/[0.04] px-4 py-3 text-sm font-semibold text-white/70 hover:bg-white/[0.08]"
              >
                <Share2 className="h-4 w-4" />
                Share member pass and code
              </button>
            </div>
          </div>
        </div>
      )}

      {profileMember && (
        <div className="fixed inset-0 z-[96] flex items-center justify-center bg-black/70 p-4 backdrop-blur-md" onClick={() => { selection(); setProfileMember(null) }}>
          <div
            className="relative w-full max-w-md overflow-hidden rounded-[2rem] border border-white/10 bg-[#111313] p-5 text-white shadow-2xl"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="mb-4 flex items-center justify-between">
              <button
                type="button"
                onClick={() => { selection(); setProfileMember(null); setQuickPassMember(profileMember) }}
                className="grid h-11 w-11 place-items-center rounded-full border border-white/10 bg-white/5 text-white/80 hover:bg-white/10"
                aria-label="Back to member pass"
              >
                <ChevronLeft className="h-5 w-5" />
              </button>
              <button
                type="button"
                onClick={() => { selection(); setProfileMember(null) }}
                className="grid h-11 w-11 place-items-center rounded-full border border-white/10 bg-white/5 text-white/80 hover:bg-white/10"
                aria-label="Close member profile"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="flex items-center gap-4">
              {memberCodeShowPhoto && (
                <div className="grid h-24 w-24 shrink-0 place-items-center rounded-full border-2 border-orange-500 bg-gradient-to-br from-orange-500 to-purple-500 text-4xl font-black text-white shadow-xl">
                  {getMemberSearchName(profileMember).charAt(0).toUpperCase()}
                </div>
              )}
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <h3 className="truncate text-2xl font-black">{getMemberSearchName(profileMember)}</h3>
                  <span className="rounded-lg border border-green-400/35 bg-green-500/15 px-2 py-1 text-xs font-black text-green-300">
                    {getMemberIndexCode(profileMember, memberIndexCodeMap)}
                  </span>
                </div>
                {memberCodeShowEmail && (
                  <p className="mt-1 flex items-center gap-2 text-sm text-white/60">
                    <Mail className="h-4 w-4" />
                    {getMemberEmail(profileMember) || 'No email'}
                  </p>
                )}
              </div>
            </div>

            <div className="mt-6 space-y-3">
              <div className="rounded-2xl border border-white/10 bg-white/[0.06] p-4">
                <p className="mb-3 text-sm font-bold text-white/80">Contact</p>
                <button
                  type="button"
                  onClick={() => contactMember(profileMember, 'whatsapp')}
                  className="flex w-full items-center justify-between rounded-xl bg-black/20 px-3 py-3 text-left"
                >
                  <span className="flex items-center gap-3"><Phone className="h-5 w-5 text-green-400" />{getMemberPhone(profileMember) || 'No phone'}</span>
                  <MessageSquare className="h-5 w-5 text-white/45" />
                </button>
              </div>

              <div className="rounded-2xl border border-white/10 bg-white/[0.06] p-4">
                <div className="grid grid-cols-2 gap-3 text-sm">
                  <div>
                    <p className="text-white/45">Gender</p>
                    <p className="mt-1 font-bold">{profileMember?.Gender || profileMember?.gender || 'N/A'}</p>
                  </div>
                  <div>
                    <p className="text-white/45">Level</p>
                    <p className="mt-1 font-bold">{getMemberLevel(profileMember)}</p>
                  </div>
                  <div className="col-span-2">
                    <p className="text-white/45">Joined</p>
                    <p className="mt-1 font-bold">{getMemberJoinLabel(profileMember).replace('Joined ', '')}</p>
                  </div>
                </div>
              </div>

              <div className="rounded-2xl border border-white/10 bg-white/[0.06] p-4">
                <div className="mb-3 flex items-center justify-between">
                  <p className="text-sm font-bold text-white/80">Recent Attendance</p>
                  <button type="button" className="text-xs font-bold text-orange-400">See All</button>
                </div>
                <div className="grid grid-cols-5 gap-2">
                  {sundayDates.slice(-5).map((date) => {
                    const status = attendanceData[date]?.[profileMember.id]
                    const dateObj = new Date(date)
                    return (
                      <div key={date} className={`rounded-xl px-2 py-2 text-center text-xs ${status === false ? 'bg-red-500/20 text-red-100' : status === true ? 'bg-green-500/20 text-green-100' : 'bg-white/10 text-white/55'}`}>
                        <p className="font-bold uppercase">{dateObj.toLocaleDateString('en-US', { weekday: 'short' })}</p>
                        <p className="text-base font-black">{dateObj.getDate()}</p>
                        <p>{status === false ? 'A' : status === true ? 'P' : '-'}</p>
                      </div>
                    )
                  })}
                </div>
              </div>

              <button
                type="button"
                onClick={() => {
                  selection()
                  setEditingMember(profileMember)
                  setProfileMember(null)
                  setQuickPassMember(null)
                }}
                className="flex w-full items-center justify-center gap-2 rounded-xl bg-orange-600 px-4 py-3 font-black text-white hover:bg-orange-700"
              >
                <Edit3 className="h-5 w-5" />
                Edit Member
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Bottom Search Bar */}
      <div className={`bottom-search-bar bottom-control-safe fixed bottom-0 left-0 right-0 border-t z-30 safe-area-x ${isShortSearchActive ? 'bg-white/95 dark:bg-[#202121]/95 border-orange-500 shadow-2xl shadow-black/30' : 'bg-white dark:bg-gray-800 border-gray-200 dark:border-gray-700'}`}>
        <div className="mx-auto px-3 sm:px-4 py-1.5">
          <div className="flex items-center gap-2">
            {dashboardTab === 'edited' ? (
              /* Marked tab: Search bar that only searches within Present/Absent members */
              <div className="flex-1 relative">
                {renderSearchSuggestionTray()}
                <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-gray-500 dark:text-gray-400" />
                <input
                  type="text"
                  placeholder="Search marked members..."
                  value={localSearchTerm}
                  onChange={(e) => setLocalSearchTerm(e.target.value)}
                  onFocus={() => setIsSearchFocused(true)}
                  onBlur={() => window.setTimeout(() => setIsSearchFocused(false), 120)}
                  onKeyDown={(e) => { if (e.key === 'Enter') applySearchSelection(localSearchTerm) }}
                  className={`w-full rounded-lg pl-10 pr-10 py-1 text-sm border bg-white dark:bg-gray-700 text-gray-900 dark:text-white placeholder-gray-500 dark:placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-orange-500 transition-colors sm:text-base ${isShortSearchActive ? 'border-orange-500 dark:border-orange-500' : 'border-gray-300 dark:border-gray-600'}`}
                />
                {(searchTerm || localSearchTerm) && (
                  <button
                    type="button"
                    onClick={() => { selection(); setSearchTerm(''); setLocalSearchTerm(''); setIsSearchFocused(false) }}
                    className="absolute right-2 top-1/2 inline-flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded-full text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-700 dark:text-gray-500 dark:hover:bg-gray-600 dark:hover:text-gray-200"
                    title="Clear search"
                    aria-label="Clear search"
                  >
                    <X className="h-4 w-4" />
                  </button>
                )}
              </div>
            ) : (
              /* Other tabs: Normal text search */
              <div className="flex-1 relative">
                {renderSearchSuggestionTray()}
                <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-gray-500 dark:text-gray-400" />
                <input
                  type="text"
                  placeholder="Search members..."
                  value={localSearchTerm}
                  onChange={(e) => setLocalSearchTerm(e.target.value)}
                  onFocus={() => setIsSearchFocused(true)}
                  onBlur={() => window.setTimeout(() => setIsSearchFocused(false), 120)}
                  onKeyDown={(e) => { if (e.key === 'Enter') applySearchSelection(localSearchTerm) }}
                  className={`w-full rounded-lg pl-10 pr-10 py-1 text-sm border bg-white dark:bg-gray-700 text-gray-900 dark:text-white placeholder-gray-500 dark:placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-orange-500 transition-colors sm:text-base ${isShortSearchActive ? 'border-orange-500 dark:border-orange-500' : 'border-gray-300 dark:border-gray-600'}`}
                />
                {(searchTerm || localSearchTerm) && (
                  <button
                    type="button"
                    onClick={() => { selection(); setSearchTerm(''); setLocalSearchTerm(''); setIsSearchFocused(false) }}
                    className="absolute right-2 top-1/2 inline-flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded-full text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-700 dark:text-gray-500 dark:hover:bg-gray-600 dark:hover:text-gray-200"
                    title="Clear search"
                    aria-label="Clear search"
                  >
                    <X className="h-4 w-4" />
                  </button>
                )}
              </div>
            )}
            {/* Filter Button */}
            {memberFilterButtonEnabled && (
              <button
                type="button"
                onClick={() => { selection(); setShowFilters(!showFilters) }}
                className={`member-filter-toggle inline-flex shrink-0 items-center justify-center gap-1 rounded-lg px-3 py-1 transition-colors ${showFilters || genderFilter || levelFilter || visitorFilter !== null || hasTagFilters
                  ? 'bg-primary-100 dark:bg-primary-900/30 text-primary-600 dark:text-primary-400 border border-primary-300 dark:border-primary-700'
                  : isShortSearchActive
                    ? 'bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-300 border border-gray-300 dark:border-gray-600'
                    : 'bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300 border border-gray-300 dark:border-gray-600 hover:bg-gray-200 dark:hover:bg-gray-600'
                  }`}
                title="Filters"
                aria-label="Show member filters"
              >
                <Filter className="w-4 h-4" />
                {(genderFilter || levelFilter || visitorFilter !== null || hasTagFilters) && (
                  <span className="w-2 h-2 bg-primary-500 rounded-full" />
                )}
              </button>
            )}
            {/* Add Member Button */}
            <button
              onClick={() => { selection(); setShowMemberModal(true) }}
              className="flex items-center gap-2 px-3 py-1 bg-orange-600 hover:bg-orange-700 text-white rounded-lg transition-colors shadow-sm"
              title="Add New Member"
            >
              <UserPlus className="w-5 h-5" />
              <span className="hidden md:inline text-sm font-medium">Add Member</span>
            </button>
            {/* Admin Controls Button removed per request */}
          </div>
        </div>
      </div>

      {/* Add padding to prevent content from being hidden behind bottom search bar */}
      <div className="h-14 md:h-7" />
    </div>
  )
}

export default memo(Dashboard)
