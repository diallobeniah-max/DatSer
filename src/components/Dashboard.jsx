import React, { useState, useEffect, useMemo, useRef, useCallback, memo, lazy, Suspense } from 'react'
import { useApp } from '../context/AppContext'
import { useTheme } from '../context/ThemeContext'
import { Search, Users, Filter, Edit3, Trash2, Calendar, ChevronDown, ChevronUp, ChevronRight, UserPlus, Award, Star, UserCheck, Check, X, Feather, StickyNote, History, Eye } from 'lucide-react'
import DateSelector from './DateSelector'
import ConfirmModal from './ConfirmModal'
import TableSkeleton from './TableSkeleton'
import SelectionToolbar from './SelectionToolbar'
import { useLongPressSelection } from '../hooks/useLongPressSelection'
import useHapticFeedback from '../hooks/useHapticFeedback'
import { toast } from 'react-toastify'
import { normalizeMinistry } from '../utils/dataUtils'

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

const Dashboard = ({ isAdmin = false }) => {
  const {
    filteredMembers: contextFilteredMembers,
    loading,
    searchTerm,
    setSearchTerm,
    refreshSearch,
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
    isCollaborator
  } = useApp()
  const { isDarkMode } = useTheme()
  const { selection, success, error: errorHaptic } = useHapticFeedback()
  const [editingMember, setEditingMember] = useState(null)
  const [attendanceLoading, setAttendanceLoading] = useState({})
  const [expandedMembers, setExpandedMembers] = useState({})
  const [showMemberModal, setShowMemberModal] = useState(false)
  const [showMonthModal, setShowMonthModal] = useState(false)

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
  const [ministryFilter, setMinistryFilter] = useState(null)
  const [visitorFilter, setVisitorFilter] = useState(null)
  const [showFilters, setShowFilters] = useState(false)
  const [isClosingFilters, setIsClosingFilters] = useState(false)
  const [sortNewestFirst, setSortNewestFirst] = useState(true) // Toggle for Marked tab sort order


  // Track the timestamp of each attendance action for chronological sorting (most recent first)
  // Key: `${memberId}_${dateKey}`, Value: Date.now()
  const actionTimestampsRef = useRef({})

  // Handle filter closing with animation
  const closeFilters = () => {
    selection()
    setIsClosingFilters(true)
    setTimeout(() => {
      setShowFilters(false)
      setIsClosingFilters(false)
    }, 300)
  }

  // Available filter options
  const levels = ['SHS1', 'SHS2', 'SHS3', 'JHS1', 'JHS2', 'JHS3', 'COMPLETED', 'UNIVERSITY']
  const defaultMinistries = ['Choir', 'Ushers', 'Youth', 'Children', 'Media', 'Welfare', 'Protocol', 'Evangelism']
  const [ministryOptions, setMinistryOptions] = useState(() => {
    const saved = localStorage.getItem('customMinistries')
    return saved ? JSON.parse(saved) : defaultMinistries
  })

  // Listen for ministry updates from Admin Panel
  useEffect(() => {
    const handleMinistriesUpdate = (e) => {
      setMinistryOptions(e.detail)
    }
    window.addEventListener('ministriesUpdated', handleMinistriesUpdate)
    return () => window.removeEventListener('ministriesUpdated', handleMinistriesUpdate)
  }, [])

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

  // Local search term state for debounced search
  const [localSearchTerm, setLocalSearchTerm] = useState(searchTerm)

  // Keep local input in sync when external searchTerm changes
  useEffect(() => {
    setLocalSearchTerm(searchTerm)
  }, [searchTerm])

  // Debounce updates to global search term to reduce re-renders
  useEffect(() => {
    const tid = setTimeout(() => {
      if (localSearchTerm !== searchTerm) {
        setSearchTerm(localSearchTerm)
      }
    }, 250)
    return () => clearTimeout(tid)
  }, [localSearchTerm])

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

  // Check for missing data before marking attendance
  const checkMissingDataBeforeAttendance = (member, present) => {
    const fields = validateMemberData(member)
    const pastSundays = getPastSundays()
    const dates = getMissingAttendance(member.id, pastSundays)

    if (fields.length > 0 || dates.length > 0) {
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
    // First check: inspect member record columns from database
    // This works even before attendanceData is loaded and persists across refreshes
    // Support both OLD format (Attendance 7th) and NEW format (attendance_2025_12_07)
    for (const key in member) {
      const keyLower = key.toLowerCase()
      const isOldFormat = key.startsWith('Attendance ')
      const isNewFormat = /^attendance_\d{4}_\d{2}_\d{2}$/.test(keyLower)
      if (isOldFormat || isNewFormat) {
        const val = member[key]
        // Check for any attendance value (Present, Absent, true, false)
        if (val === 'Present' || val === 'Absent' || val === true || val === false) {
          return true
        }
      }
    }

    // Second check: attendanceData map (for real-time updates before DB sync)
    const editedViaMaps = sundayDates.some((date) => {
      const map = attendanceData[date] || {}
      const v = map[member.id]
      return v === true || v === false
    })

    return editedViaMaps
  }

  // Get filtered members based on active tab
  const getTabFilteredMembers = () => {
    const badgeFilteredMembers = getFilteredMembersByBadge()

    // Apply all filters (gender, level, ministry, visitor)
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

    // Ministry filter
    if (ministryFilter) {
      filteredMembers = filteredMembers.filter(member => {
        const ministry = normalizeMinistry(member.ministry ?? member['Ministry'])
        return Array.isArray(ministry) && ministry.includes(ministryFilter)
      })
    }

    // Visitor filter
    if (visitorFilter !== null) {
      filteredMembers = filteredMembers.filter(member => {
        return visitorFilter ? member.is_visitor === true : member.is_visitor !== true
      })
    }

    // When searching, use contextFilteredMembers from AppContext which includes serverSearchResults
    // (cross-table search results). Fall back to searching local members array.
    if (searchTerm && searchTerm.trim()) {
      // contextFilteredMembers from AppContext already includes serverSearchResults when available
      if (contextFilteredMembers && contextFilteredMembers.length > 0) {
        return [...contextFilteredMembers].sort((a, b) => {
          const an = (a['full_name'] || a['Full Name'] || '').toLowerCase()
          const bn = (b['full_name'] || b['Full Name'] || '').toLowerCase()
          return an.localeCompare(bn)
        })
      }
      // Fallback: search local members array
      const lowerTerm = searchTerm.toLowerCase()
      return members
        .filter(member => {
          const name = (member['full_name'] || member['Full Name'] || '').toLowerCase()
          return name.includes(lowerTerm)
        })
        .sort((a, b) => {
          const an = (a['full_name'] || a['Full Name'] || '').toLowerCase()
          const bn = (b['full_name'] || b['Full Name'] || '').toLowerCase()
          return an.localeCompare(bn)
        })
    }

    if (dashboardTab === 'edited') {
      const dateKey = selectedSundayDate || (selectedAttendanceDate ? selectedAttendanceDate.toISOString().split('T')[0] : null)
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

      // Helper to resolve attendance value for a member on this date
      const getVal = (member) => {
        if (map[member.id] === true) return true
        if (map[member.id] === false) return false
        for (const key in member) {
          const keyLower = key.toLowerCase()
          const newMatch = keyLower.match(/^attendance_(\d{4})_(\d{2})_(\d{2})$/)
          if (newMatch && `${newMatch[1]}-${newMatch[2]}-${newMatch[3]}` === dateKey) {
            if (member[key] === 'Present') return true
            if (member[key] === 'Absent') return false
          }
        }
        return undefined
      }

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
          const val = map[m.id]
          if (val === true) present += 1
          else if (val === false) absent += 1
        }
      })
    } else {
      // All tab: count from map values directly to include all records
      selectedDatesForCounting.forEach((dateKey) => {
        const map = attendanceData[dateKey] || {}
        for (const val of Object.values(map)) {
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
      Object.entries(map).forEach(([mid, val]) => {
        if (val === true) counts[mid] = (counts[mid] || 0) + 1
      })
    })
    return counts
  }, [attendanceData, sundayDates])

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
      const map = attendanceData[dateStr]
      let p = 0
      let a = 0
      if (map) {
        for (const m of editedMembers) {
          const val = map[m.id]
          if (val === true) p += 1
          else if (val === false) a += 1
        }
      } else {
        // Fallback: show total edited members before attendance map loads
        p = editedMembers.length
        a = 0
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
      const key = selectedAttendanceDate.toISOString().split('T')[0]
      setSelectedSundayDate(key)
    }
  }, [selectedAttendanceDate])

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
    // Check for missing data before marking attendance
    const member = members.find(m => m.id === memberId)
    if (member && checkMissingDataBeforeAttendance(member, present)) {
      return // Stop here if missing data found
    }

    // Use the selected attendance date from the picker
    const targetDate = getDateString(selectedAttendanceDate)
    if (!targetDate) {
      toast.error('Please select an attendance date first.')
      return
    }

    setAttendanceLoading(prev => ({ ...prev, [memberId]: true }))
    try {
      const memberName = member ? (member['full_name'] || member['Full Name']) : 'Member'
      const currentStatus = attendanceData[targetDate]?.[memberId]
      const dateLabel = selectedAttendanceDate ? new Date(selectedAttendanceDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : ''

      // Toggle functionality: if clicking the same status, deselect it (set to null)
      if (currentStatus === present) {
        await markAttendance(memberId, new Date(targetDate), null)
        // Record action timestamp for chronological sorting
        actionTimestampsRef.current[`${memberId}_${targetDate}`] = Date.now()
        selection()
        toast.success(`Attendance cleared for: ${memberName}`, {
          style: {
            background: '#f3f4f6',
            color: '#374151'
          }
        })
      } else {
        await markAttendance(memberId, new Date(targetDate), present)
        // Record action timestamp for chronological sorting
        actionTimestampsRef.current[`${memberId}_${targetDate}`] = Date.now()
        if (present) success()
        else errorHaptic()
        toast.success(`Marked ${present ? 'present' : 'absent'} for ${dateLabel}: ${memberName}`, {
          style: {
            background: present ? '#10b981' : '#ef4444',
            color: '#ffffff'
          }
        })
      }
    } catch (error) {
      console.error('Error marking attendance:', error)
      errorHaptic()
      toast.error('Failed to update attendance. Please try again.')
    } finally {
      setAttendanceLoading(prev => ({ ...prev, [memberId]: false }))
    }
  }

  const handleAttendanceForDate = async (memberId, present, specificDate) => {
    const loadingKey = `${memberId}_${specificDate}`
    setAttendanceLoading(prev => ({ ...prev, [loadingKey]: true }))
    try {
      // Read from date-keyed attendance map
      const currentStatus = attendanceData[specificDate]?.[memberId]

      // Toggle functionality: if clicking the same status, deselect it (set to null)
      if (currentStatus === present) {
        await markAttendance(memberId, new Date(specificDate), null)
        // Record action timestamp for chronological sorting
        actionTimestampsRef.current[`${memberId}_${specificDate}`] = Date.now()
        selection()
        toast.success(`Attendance cleared for ${new Date(specificDate).toLocaleDateString()}`)
      } else {
        await markAttendance(memberId, new Date(specificDate), present)
        // Record action timestamp for chronological sorting
        actionTimestampsRef.current[`${memberId}_${specificDate}`] = Date.now()
        if (present) success()
        else errorHaptic()
        toast.success(`Marked as ${present ? 'present' : 'absent'} for ${new Date(specificDate).toLocaleDateString()}`)
      }
    } catch (error) {
      console.error('Error marking attendance:', error)
      errorHaptic()
      toast.error('Failed to update attendance. Please try again.')
    } finally {
      setAttendanceLoading(prev => ({ ...prev, [loadingKey]: false }))
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

  const toggleMemberExpansion = (memberId) => {
    selection()
    setExpandedMembers(prev => ({
      ...prev,
      [memberId]: !prev[memberId]
    }))
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
      const message = `${badgeName} badge ${hasBadge ? 'removed' : 'assigned'} for: ${memberName} • data refreshed`
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

  if (loading) {
    return (
      <div className="max-w-7xl mx-auto px-0 sm:px-4 mt-8">
        <TableSkeleton />
      </div>
    )
  }

  return (
    <div className="space-y-2 pb-12 max-w-7xl mx-auto px-0 sm:px-4">
      {/* Header removed; summary now shown in sticky Header */}

      {/* Desktop tab navigation removed; use mobile segmented control in Header */}

      {/* Edited Members: Sundays Quick View */}
      {dashboardTab === 'edited' && (
        <div ref={sundaysRef} className="block mt-8 sm:mt-10 bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-3 sm:p-4 shadow-sm w-[96%] sm:w-full mx-auto">
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
                  : 'bg-orange-100 dark:bg-orange-900/30 text-orange-700 dark:text-orange-400 border border-orange-300 dark:border-orange-700'
                  }`}
                title={sortNewestFirst ? 'Newest to Oldest' : 'Oldest to Newest'}
              >
                <span className="text-xs">↓↑</span>
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
              const map = attendanceData[dateStr]
              const presentCount = map
                ? Object.values(map).filter(v => v === true).length
                : 0
              const absentCount = map
                ? Object.values(map).filter(v => v === false).length
                : 0
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
                const presentMembers = members.filter(m => map[m.id] === true)
                const absentMembers = members.filter(m => map[m.id] === false)
                // Count from map values directly to include all records
                const presentCount = Object.values(map).filter(v => v === true).length
                const absentCount = Object.values(map).filter(v => v === false).length

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
        <div className={`rounded-lg border p-3 sm:p-4 mt-4 sm:mt-10 ${isDarkMode ? 'bg-gray-800 border-gray-700' : 'bg-white border-gray-200'}`}>
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
      <div className={`${longPressSelectedIds.size > 0 ? '' : 'mt-8 sm:mt-10'} grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3 ${searchTerm ? '' : 'transition-colors duration-200'} grid-animate`}>
        {/* Calculate displayed members based on search and pagination */}
        {(() => {
          // Get tab-filtered members first
          // getTabFilteredMembers() already handles edited-tab date filtering,
          // so do NOT re-filter here to avoid double-filtering that hides members
          let tabFilteredMembers = getTabFilteredMembers()

          const membersToShow = searchTerm
            ? tabFilteredMembers
            : tabFilteredMembers.slice(0, displayLimit)

          const hasMoreMembers = !searchTerm && tabFilteredMembers.length > displayLimit

          return (
            <>
              {/* Badge filter removed - badges now work automatically in background */}
              {/* Date Filter Indicator removed; use Sundays header Edit Date dropdown */}

              {membersToShow.map((member) => {
                const isExpanded = expandedMembers[member.id]
                const isSelected = longPressSelectedIds.has(member.id)

                return (
                  <div key={member.id} className={`relative ${searchTerm ? '' : 'transition-colors duration-200'}`}>
                    {/* Selection checkmark */}
                    {isSelected && (
                      <div className="selection-checkmark">
                        <Check className="w-3 h-3 text-white" />
                      </div>
                    )}
                    <div
                      className={`relative bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl hover:border-primary-300 dark:hover:border-primary-600 shadow-sm hover:shadow-md transition-all duration-200 overflow-hidden w-[96%] sm:w-full mx-auto ${isSelected ? 'selection-highlight' : ''
                        }`}
                      style={{ touchAction: 'pan-y', userSelect: 'none' }}
                      onTouchStart={(e) => {
                        if (!selectionMode) {
                          handleLongPressStart(member.id, e)
                        }
                      }}
                      onTouchMove={(e) => {
                        handleLongPressMove(e)
                      }}
                      onTouchEnd={() => {
                        handleLongPressEnd()
                      }}
                      onMouseDown={(e) => {
                        if (!selectionMode) {
                          handleMouseDown(member.id, e)
                        }
                      }}
                      onMouseMove={(e) => {
                        handleLongPressMove(e)
                      }}
                      onMouseUp={() => {
                        handleMouseUp()
                      }}
                      onMouseLeave={() => {
                        handleMouseUp()
                      }}
                      onContextMenu={(e) => {
                        // Prevent context menu on long press
                        e.preventDefault()
                      }}
                      onClick={() => {
                        if (selectionMode) {
                          toggleSelection(member.id)
                        }
                      }}
                    >
                      {/* Swipe-to-delete removed on mobile */}

                      {/* Mobile-friendly stacked layout */}
                      <div className="px-0 py-3 sm:px-4 sm:py-3.5">
                        {/* Row 1: Expand toggle row (chevron + name + hint) */}
                        <div className="w-full px-3 sm:px-0">
                          <button
                            type="button"
                            onClick={(e) => {
                              if (selectionMode) {
                                e.stopPropagation()
                                toggleSelection(member.id)
                              } else {
                                toggleMemberExpansion(member.id)
                              }
                            }}
                            className="w-full flex items-center gap-2 mb-2 text-left hover:bg-primary-50 dark:hover:bg-primary-900/40 rounded px-1 py-1 transition-colors duration-150"
                          >
                            <div className="p-1 text-gray-500 dark:text-gray-400 rounded flex-shrink-0 flex items-center justify-center">
                              {isExpanded ? (
                                <ChevronDown className="w-5 h-5" />
                              ) : (
                                <ChevronRight className="w-5 h-5" />
                              )}
                            </div>
                            {dashboardTab === 'edited' && isSelected && (
                              <div className="w-5 h-5 rounded-full bg-green-600 flex items-center justify-center flex-shrink-0">
                                <Check className="w-3 h-3 text-white" />
                              </div>
                            )}
                            <div className="flex-1 min-w-0">
                              <h3 className="font-semibold text-gray-900 dark:text-white text-base sm:text-lg truncate">
                                {member['full_name'] || member['Full Name']}
                              </h3>
                              {(member.inserted_at || member.created_at) && (() => {
                                const regDate = new Date(member.inserted_at || member.created_at)
                                const now = new Date()
                                const diffDays = Math.floor((now - regDate) / (1000 * 60 * 60 * 24))
                                let label = ''
                                if (diffDays === 0) label = 'Today'
                                else if (diffDays === 1) label = 'Yesterday'
                                else if (diffDays < 7) label = `${diffDays}d ago`
                                else label = regDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })

                                return (
                                  <p className="text-[10px] text-gray-400 dark:text-gray-500 mt-0.5">
                                    Joined {label}
                                  </p>
                                )
                              })()}
                            </div>
                            <span className="hidden xs:inline text-[11px] text-gray-500 dark:text-gray-400 flex-shrink-0 ml-1">
                              {isExpanded ? 'Hide details' : 'Details'}
                            </span>
                          </button>
                        </div>

                        {/* Row 2: Present/Absent (and desktop Delete) buttons */}
                        <div className="flex items-stretch gap-2 ml-0 w-full px-3 sm:px-0">
                          {/* Present/Absent buttons */}
                          <div className="flex flex-row items-stretch gap-2 w-full">
                            {/* Present/Absent buttons - compact on mobile, full on desktop */}
                            {(() => {
                              const targetDate = getDateString(selectedAttendanceDate)
                              let rowStatus = targetDate && attendanceData[targetDate] ? attendanceData[targetDate][member.id] : undefined
                              // Fallback: check member record columns if attendanceData map hasn't loaded yet
                              if (rowStatus === undefined && targetDate) {
                                for (const key in member) {
                                  const keyLower = key.toLowerCase()
                                  const m = keyLower.match(/^attendance_(\d{4})_(\d{2})_(\d{2})$/)
                                  if (m && `${m[1]}-${m[2]}-${m[3]}` === targetDate) {
                                    if (member[key] === 'Present') rowStatus = true
                                    else if (member[key] === 'Absent') rowStatus = false
                                    break
                                  }
                                }
                              }
                              const isPresentSelected = rowStatus === true
                              const isAbsentSelected = rowStatus === false
                              return (
                                <>
                                  <button
                                    onClick={() => handleAttendance(member.id, true)}
                                    disabled={attendanceLoading[member.id]}
                                    className={`flex-1 px-2 py-2 rounded-lg text-xs font-medium transition-colors duration-150 whitespace-nowrap sm:text-sm md:text-sm ${isPresentSelected
                                      ? 'bg-orange-600 dark:bg-orange-700 text-white shadow ring-1 ring-orange-300 dark:ring-orange-500'
                                      : attendanceLoading[member.id]
                                        ? 'bg-gray-200 dark:bg-gray-600 text-gray-400 cursor-not-allowed'
                                        : 'bg-orange-600 dark:bg-orange-700 text-white shadow-sm'
                                      }`}
                                    title={isPresentSelected ? "Click to clear" : "Mark present"}
                                  >
                                    {attendanceLoading[member.id] ? '...' : 'Present'}
                                  </button>
                                  <button
                                    onClick={() => handleAttendance(member.id, false)}
                                    disabled={attendanceLoading[member.id]}
                                    className={`flex-1 px-2 py-2 rounded-lg text-xs font-medium transition-colors duration-150 whitespace-nowrap sm:text-sm md:text-sm ${isAbsentSelected
                                      ? 'bg-red-600 dark:bg-red-700 text-white shadow ring-1 ring-red-300 dark:ring-red-500'
                                      : attendanceLoading[member.id]
                                        ? 'bg-gray-200 dark:bg-gray-600 text-gray-400 cursor-not-allowed'
                                        : 'bg-red-600 dark:bg-red-700 text-white shadow-sm'
                                      }`}
                                    title={isAbsentSelected ? "Click to clear" : "Mark absent"}
                                  >
                                    {attendanceLoading[member.id] ? '...' : 'Absent'}
                                  </button>
                                </>
                              )
                            })()}

                          </div>

                          {/* Desktop Delete button - third equal-width button */}
                          <button
                            type="button"
                            onClick={(e) => { e.stopPropagation(); openDeleteConfirm(e, member) }}
                            disabled={attendanceLoading[member.id]}
                            className="hidden md:inline-flex flex-1 items-center justify-center px-3 py-2 rounded-lg bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-600 text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/30 hover:border-red-200 dark:hover:border-red-800 text-sm font-medium whitespace-nowrap transition-colors duration-150"
                            title="Delete member"
                          >
                            Delete
                          </button>
                        </div>
                      </div>

                      {/* Expandable Content */}
                      {isExpanded && (
                        <div className="px-2 sm:px-3 pb-2 sm:pb-3 border-t border-gray-200 dark:border-gray-600 bg-gray-50 dark:bg-gray-700">
                          <div className="pt-2 sm:pt-2.5">
                            {/* Member Details */}
                            {/* Member Details */}
                            <div className={`grid grid-cols-1 md:grid-cols-2 gap-3 sm:gap-4 mb-3 sm:mb-4 p-3 sm:p-4 rounded-xl bg-gray-50 dark:bg-gray-800/50 border border-gray-100 dark:border-gray-700 transition-colors duration-300`}>
                              <div className="space-y-3">
                                <h4 className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-2">Member Info</h4>
                                <div className="space-y-2 text-xs sm:text-sm">
                                  <div className="flex justify-between items-center py-1 border-b border-gray-100 dark:border-gray-700/50 last:border-0">
                                    <span className="text-gray-500 dark:text-gray-400">Gender</span>
                                    <span className="font-medium capitalize text-gray-900 dark:text-white truncate ml-2">
                                      {member['Gender']?.toLowerCase() === 'm' || member['Gender']?.toLowerCase() === 'male' ? 'Male' :
                                        member['Gender']?.toLowerCase() === 'f' || member['Gender']?.toLowerCase() === 'female' ? 'Female' :
                                          member['Gender'] || 'N/A'}
                                    </span>
                                  </div>
                                  <div className="flex justify-between items-center py-1 border-b border-gray-100 dark:border-gray-700/50 last:border-0">
                                    <span className="text-gray-500 dark:text-gray-400">Phone</span>
                                    <span className="font-medium text-gray-900 dark:text-white truncate ml-2 font-mono tracking-tight phone-display">{member['Phone Number'] || 'N/A'}</span>
                                  </div>
                                  <div className="flex justify-between items-center py-1 border-b border-gray-100 dark:border-gray-700/50 last:border-0">
                                    <span className="text-gray-500 dark:text-gray-400">Age</span>
                                    <span className="font-medium text-gray-900 dark:text-white truncate ml-2">{member['Age'] || 'N/A'}</span>
                                  </div>
                                  <div className="flex justify-between items-center py-1 border-b border-gray-100 dark:border-gray-700/50 last:border-0">
                                    <span className="text-gray-500 dark:text-gray-400">Level</span>
                                    <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-primary-50 dark:bg-primary-900/30 text-primary-700 dark:text-primary-300 capitalize ml-2">
                                      {member['Current Level']?.toLowerCase() || 'N/A'}
                                    </span>
                                  </div>
                                  {/* Visitor Badge */}
                                  {member.is_visitor && (
                                    <div className="flex justify-between items-center py-1 border-b border-gray-100 dark:border-gray-700/50">
                                      <span className="text-gray-500 dark:text-gray-400">Status</span>
                                      <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-300">
                                        Visitor
                                      </span>
                                    </div>
                                  )}
                                  {/* Registration Date/Time Card */}
                                  {(member.inserted_at || member.created_at) && (() => {
                                    const regDate = new Date(member.inserted_at || member.created_at)
                                    const now = new Date()
                                    const diffMs = now - regDate
                                    const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24))
                                    const diffHours = Math.floor(diffMs / (1000 * 60 * 60))
                                    const diffMins = Math.floor(diffMs / (1000 * 60))

                                    let relativeTime = ''
                                    let badgeColor = 'bg-orange-100 dark:bg-orange-900/30 text-orange-700 dark:text-orange-300'

                                    if (diffDays === 0) {
                                      if (diffHours === 0) {
                                        relativeTime = diffMins <= 1 ? 'Just now' : `${diffMins} mins ago`
                                      } else {
                                        relativeTime = diffHours === 1 ? '1 hour ago' : `${diffHours} hours ago`
                                      }
                                      badgeColor = 'bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-300'
                                    } else if (diffDays === 1) {
                                      relativeTime = 'Yesterday'
                                      badgeColor = 'bg-emerald-100 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-300'
                                    } else if (diffDays < 7) {
                                      relativeTime = `${diffDays} days ago`
                                      badgeColor = 'bg-cyan-100 dark:bg-cyan-900/30 text-cyan-700 dark:text-cyan-300'
                                    } else if (diffDays < 30) {
                                      const weeks = Math.floor(diffDays / 7)
                                      relativeTime = weeks === 1 ? '1 week ago' : `${weeks} weeks ago`
                                    } else {
                                      const years = Math.floor(diffDays / 365)
                                      relativeTime = years === 1 ? '1 year ago' : `${years} years ago`
                                    }

                                    return (
                                      <div className="mt-3 p-3 rounded-lg bg-gradient-to-r from-primary-50 to-orange-50 dark:from-primary-900/20 dark:to-orange-900/20 border border-primary-200 dark:border-primary-800/50">
                                        <div className="flex items-center justify-between gap-2 mb-2">
                                          <p className="text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wide flex-shrink-0">Registered</p>
                                          <span className={`px-2 py-0.5 rounded-full text-xs font-medium truncate max-w-[100px] ${badgeColor}`} title={relativeTime}>
                                            {relativeTime}
                                          </span>
                                        </div>
                                        <div className="flex items-start gap-3">
                                          <div className="w-10 h-10 rounded-xl bg-primary-100 dark:bg-primary-800/50 flex items-center justify-center flex-shrink-0">
                                            <Calendar className="w-5 h-5 text-primary-600 dark:text-primary-400" />
                                          </div>
                                          <div className="flex-1 min-w-0">
                                            <p className="text-sm font-semibold text-gray-900 dark:text-white">
                                              {regDate.toLocaleDateString('en-US', {
                                                weekday: 'short',
                                                month: 'short',
                                                day: 'numeric',
                                                year: 'numeric'
                                              })}
                                            </p>
                                            <p className="text-xs text-gray-500 dark:text-gray-400">
                                              {regDate.toLocaleTimeString('en-US', {
                                                hour: '2-digit',
                                                minute: '2-digit'
                                              })}
                                            </p>
                                          </div>
                                        </div>
                                      </div>
                                    )
                                  })()}
                                </div>

                                {/* Ministry Tags */}
                                {(() => {
                                  // normalizeMinistry is imported from utils

                                  const ministries = normalizeMinistry(member.ministry)
                                  if (ministries.length === 0) return null
                                  return (
                                  <div className="mt-3 pt-3 border-t border-gray-200 dark:border-gray-700">
                                    <h4 className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-2">Ministry</h4>
                                    <div className="flex flex-wrap gap-1.5">
                                      {ministries.map(m => (
                                        <span key={m} className="px-2.5 py-1 rounded-full text-xs font-medium bg-primary-50 dark:bg-primary-900/30 text-primary-700 dark:text-primary-300 border border-primary-200/70 dark:border-primary-700/50">
                                          {m.length > 22 ? m.slice(0, 20) + '…' : m}
                                        </span>
                                      ))}
                                    </div>
                                  </div>
                                  )
                                })()}

                                {/* Parent Information (if available) */}
                                {(member['parent_name_1'] || member['parent_name_2']) && (
                                  <div className="mt-4 pt-3 border-t border-gray-200 dark:border-gray-700">
                                    <h4 className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-2">Guardians</h4>
                                    <div className="space-y-2 text-xs sm:text-sm">
                                      {member['parent_name_1'] && (
                                        <div className="flex justify-between items-start py-1">
                                          <span className="text-gray-500 dark:text-gray-400 text-xs mt-0.5">Primary</span>
                                          <div className="text-right">
                                            <span className="block font-medium text-gray-900 dark:text-white">{member['parent_name_1']}</span>
                                            {member['parent_phone_1'] && (
                                              <span className="block text-xs text-gray-500 dark:text-gray-400 font-mono tracking-tight phone-display">{member['parent_phone_1']}</span>
                                            )}
                                          </div>
                                        </div>
                                      )}
                                      {member['parent_name_2'] && (
                                        <div className="flex justify-between items-start py-1">
                                          <span className="text-gray-500 dark:text-gray-400 text-xs mt-0.5">Secondary</span>
                                          <div className="text-right">
                                            <span className="block font-medium text-gray-900 dark:text-white">{member['parent_name_2']}</span>
                                            {member['parent_phone_2'] && (
                                              <span className="block text-xs text-gray-500 dark:text-gray-400 font-mono tracking-tight phone-display">{member['parent_phone_2']}</span>
                                            )}
                                          </div>
                                        </div>
                                      )}
                                    </div>
                                  </div>
                                )}
                              </div>

                              {/* Actions */}
                              <div className="space-y-3 border-t md:border-t-0 md:border-l border-gray-200 dark:border-gray-700 pt-3 md:pt-0 md:pl-4">
                                <h4 className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-2">Actions</h4>
                                <div className="flex flex-col gap-2">
                                  <button
                                    onClick={() => setEditingMember(member)}
                                    className="w-full flex items-center justify-center space-x-2 px-3 py-2 text-sm text-gray-700 dark:text-gray-300 hover:text-primary-600 dark:hover:text-primary-400 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-600 hover:border-primary-300 dark:hover:border-primary-600 rounded-lg transition-colors duration-150 shadow-sm hover:shadow-md"
                                  >
                                    <Edit3 className="w-4 h-4" />
                                    <span>Edit Details</span>
                                  </button>
                                {/* Mobile Delete button (replaces swipe-to-delete) */}
                                <button
                                  type="button"
                                  onClick={(e) => { e.stopPropagation(); openDeleteConfirm(e, member) }}
                                  className="md:hidden w-full flex items-center justify-center space-x-2 px-3 py-2 text-sm bg-white dark:bg-gray-800 border border-red-300 dark:border-red-700 text-red-700 dark:text-red-300 hover:bg-red-50 dark:hover:bg-red-900/30 hover:border-red-400 dark:hover:border-red-800 rounded-lg transition-colors duration-150 shadow-sm hover:shadow-md"
                                  title="Delete member"
                                >
                                  <Trash2 className="w-4 h-4" />
                                  <span>Delete Member</span>
                                </button>
                                </div>

                                {/* Notes Section */}
                                {member.notes && (
                                  <div className="mt-3 pt-3 border-t border-gray-200 dark:border-gray-700">
                                    <h4 className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-2 flex items-center gap-1">
                                      <StickyNote className="w-3 h-3" />
                                      Note
                                    </h4>
                                    <p className="text-xs sm:text-sm text-gray-600 dark:text-gray-300 bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-800/50 rounded-lg p-2 italic">
                                      {member.notes}
                                    </p>
                                  </div>
                                )}
                              </div>
                            </div>

                            {/* Sunday Attendance */}
                            <div className="border-t border-gray-200 dark:border-gray-600 pt-4 transition-colors">
                              <h4 className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-3 transition-colors">{getMonthDisplayName(currentTable)} Sunday Attendance</h4>
                              <div className={`grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3 ${searchTerm ? '' : 'transition-colors duration-300'} grid-animate`}>
                                {sundayDates.map(date => {
                                  const dateKey = date
                                  const dateAttendance = attendanceData[dateKey] || {}
                                  let memberStatus = dateAttendance[member.id]
                                  // Fallback: check member record columns if attendanceData map hasn't loaded
                                  if (memberStatus === undefined) {
                                    for (const k in member) {
                                      const kl = k.toLowerCase()
                                      const km = kl.match(/^attendance_(\d{4})_(\d{2})_(\d{2})$/)
                                      if (km && `${km[1]}-${km[2]}-${km[3]}` === dateKey) {
                                        if (member[k] === 'Present') memberStatus = true
                                        else if (member[k] === 'Absent') memberStatus = false
                                        break
                                      }
                                    }
                                  }
                                  const isPresent = memberStatus === true
                                  const isAbsent = memberStatus === false
                                  const isLoading = attendanceLoading[`${member.id}_${dateKey}`]

                                  return (
                                    <div
                                      key={date}
                                      className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 p-3 transition-colors"
                                    >
                                      <div className="text-center mb-2">
                                        <span className="text-sm font-medium text-gray-700 dark:text-gray-300 transition-colors">
                                          {new Date(date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                                        </span>
                                      </div>
                                      <div className="flex space-x-1">
                                        <button
                                          onClick={() => handleAttendanceForDate(member.id, true, date)}
                                          disabled={isLoading}
                                          className={`flex-1 px-2 py-1 rounded text-xs font-bold transition-colors duration-150 ${isPresent
                                            ? 'bg-green-800 dark:bg-green-700 text-white shadow-lg ring-2 ring-green-300 dark:ring-green-400 border border-green-900 dark:border-green-300 font-extrabold'
                                            : isLoading
                                              ? 'bg-gray-300 dark:bg-gray-600 text-gray-500 dark:text-gray-400 cursor-not-allowed'
                                              : 'bg-green-100 dark:bg-green-900 text-green-700 dark:text-green-300 hover:bg-green-200 dark:hover:bg-green-800'
                                            }`}
                                        >
                                          {isLoading ? '...' : 'P'}
                                        </button>
                                        <button
                                          onClick={() => handleAttendanceForDate(member.id, false, date)}
                                          disabled={isLoading}
                                          className={`flex-1 px-2 py-1 rounded text-xs font-bold transition-colors duration-150 ${isAbsent
                                            ? 'bg-red-800 dark:bg-red-700 text-white shadow-lg ring-2 ring-red-300 dark:ring-red-400 border border-red-900 dark:border-red-300 font-extrabold'
                                            : isLoading
                                              ? 'bg-gray-300 dark:bg-gray-600 text-gray-500 dark:text-gray-400 cursor-not-allowed'
                                              : 'bg-red-100 dark:bg-red-900 text-red-700 dark:text-red-300 hover:bg-red-200 dark:hover:bg-red-800'
                                            }`}
                                        >
                                          {isLoading ? '...' : 'A'}
                                        </button>
                                      </div>
                                    </div>
                                  )
                                })}
                              </div>
                            </div>

                            {/* Attendance Summary */}
                            <div className="border-t border-gray-200 dark:border-gray-600 pt-4 mt-4">
                              <h4 className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-3 flex items-center gap-1">
                                <History className="w-3 h-3" />
                                Attendance Summary
                              </h4>
                              <div className="grid grid-cols-3 gap-3 transition-all duration-500 ease-[cubic-bezier(0.4,0,0.2,1)]">
                                {(() => {
                                  // Calculate attendance stats for this member
                                  let present = 0, absent = 0, total = 0
                                  sundayDates.forEach(date => {
                                    const status = attendanceData[date]?.[member.id]
                                    if (status === true) { present++; total++ }
                                    else if (status === false) { absent++; total++ }
                                  })
                                  const rate = total > 0 ? Math.round((present / total) * 100) : 0
                                  return (
                                    <>
                                      <div className="text-center p-2 bg-green-50 dark:bg-green-900/20 rounded-lg">
                                        <div className="text-lg font-bold text-green-600 dark:text-green-400">{present}</div>
                                        <div className="text-xs text-gray-500 dark:text-gray-400">Present</div>
                                      </div>
                                      <div className="text-center p-2 bg-red-50 dark:bg-red-900/20 rounded-lg">
                                        <div className="text-lg font-bold text-red-600 dark:text-red-400">{absent}</div>
                                        <div className="text-xs text-gray-500 dark:text-gray-400">Absent</div>
                                      </div>
                                      <div className="text-center p-2 bg-primary-50 dark:bg-primary-900/20 rounded-lg">
                                        <div className="text-lg font-bold text-primary-600 dark:text-primary-400">{rate}%</div>
                                        <div className="text-xs text-gray-500 dark:text-gray-400">Rate</div>
                                      </div>
                                    </>
                                  )
                                })()}
                              </div>
                            </div>
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
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

      {/* Empty State - use the same getTabFilteredMembers() for consistency */}
      {getTabFilteredMembers().length === 0 && !loading && (
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
              <h4 className="font-medium text-yellow-800 dark:text-yellow-200 mb-2">🔍 Debug Info</h4>
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
            onClose={() => setEditingMember(null)}
            member={editingMember}
          />
        </Suspense>
      )}

      {/* Add Member Modal */}
      {showMemberModal && (
        <Suspense fallback={null}>
          <MemberModal
            isOpen={showMemberModal}
            onClose={() => setShowMemberModal(false)}
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
            selectedAttendanceDate={selectedAttendanceDate ? new Date(selectedAttendanceDate) : new Date()}
            onClose={() => {
              setShowMissingDataModal(false)
              setMissingDataMember(null)
              setMissingFields([])
              setMissingDates([])
              setPendingAttendanceAction(null)
            }}
            onSave={async () => {
              setPendingAttendanceAction(null)
            }}
          />
        </Suspense>
      )}

      {/* Filter Modal */}
      {(showFilters || isClosingFilters) && (
        <div
          className="fixed inset-0 z-50 flex items-end md:items-center justify-center"
          onKeyDown={(e) => e.key === 'Escape' && closeFilters()}
        >
          {/* Backdrop */}
          <div
            className="absolute inset-0 bg-black/50 backdrop-blur-sm"
            onClick={closeFilters}
          />
          {/* Filter Panel */}
          <div className={`relative w-full md:w-[480px] md:max-w-[90vw] bg-white dark:bg-gray-800 rounded-t-2xl md:rounded-2xl shadow-2xl max-h-[80vh] overflow-hidden ${isClosingFilters ? 'filter-exit' : 'filter-enter'
            }`}>
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

              {/* Ministry Filter */}
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">Ministry/Group</label>
                <div className="flex flex-wrap gap-2">
                  {ministryOptions.map(m => (
                    <button
                      key={m}
                      onClick={() => { selection(); setMinistryFilter(ministryFilter === m ? null : m) }}
                      className={`px-3 py-2 rounded-full text-xs font-medium transition-all ${ministryFilter === m
                        ? 'bg-primary-600 text-white shadow-md'
                        : 'bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600'
                        }`}
                    >
                      {m}
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
            </div>

            {/* Footer */}
            <div className="px-5 py-4 border-t border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800/50 flex gap-3">
              <button
                onClick={() => {
                  selection()
                  setGenderFilter(null)
                  setLevelFilter(null)
                  setMinistryFilter(null)
                  setVisitorFilter(null)
                }}
                disabled={!genderFilter && !levelFilter && !ministryFilter && visitorFilter === null}
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

      {/* Bottom Search Bar */}
      <div className="fixed bottom-0 left-0 right-0 bg-white dark:bg-gray-800 border-t border-gray-200 dark:border-gray-700 z-30 safe-area-bottom">
        <div className="mx-auto px-0 sm:px-4 py-3">
          <div className="flex items-center gap-2">
            {dashboardTab === 'edited' ? (
              /* Marked tab: Search bar that only searches within Present/Absent members */
              <div className="flex-1 relative">
                <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-gray-500 dark:text-gray-400" />
                <input
                  type="text"
                  placeholder="Search marked members..."
                  value={localSearchTerm}
                  onChange={(e) => setLocalSearchTerm(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') { setSearchTerm(localSearchTerm); refreshSearch() } }}
                  className="w-full pl-10 pr-10 py-2 border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white placeholder-gray-500 dark:placeholder-gray-400 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500 transition-colors"
                />
                {(searchTerm || localSearchTerm) && (
                  <button
                    onClick={() => { selection(); setSearchTerm(''); setLocalSearchTerm('') }}
                    className="absolute right-3 top-1/2 transform -translate-y-1/2 text-gray-400 dark:text-gray-500 hover:text-gray-600 dark:hover:text-gray-300"
                    title="Clear search"
                  >
                    ×
                  </button>
                )}
              </div>
            ) : (
              /* Other tabs: Normal text search */
              <div className="flex-1 relative">
                <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-gray-500 dark:text-gray-400" />
                <input
                  type="text"
                  placeholder="Search members..."
                  value={localSearchTerm}
                  onChange={(e) => setLocalSearchTerm(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') { setSearchTerm(localSearchTerm); refreshSearch() } }}
                  className="w-full pl-10 pr-10 py-2 border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white placeholder-gray-500 dark:placeholder-gray-400 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500 transition-colors"
                />
                {(searchTerm || localSearchTerm) && (
                  <button
                    onClick={() => { selection(); setSearchTerm(''); setLocalSearchTerm('') }}
                    className="absolute right-3 top-1/2 transform -translate-y-1/2 text-gray-400 dark:text-gray-500 hover:text-gray-600 dark:hover:text-gray-300"
                    title="Clear search"
                  >
                    ×
                  </button>
                )}
              </div>
            )}
            {/* Filter Button */}
            <button
              onClick={() => { selection(); setShowFilters(!showFilters) }}
              className={`flex items-center gap-1 px-3 py-2 rounded-lg transition-colors ${showFilters || genderFilter || levelFilter || ministryFilter || visitorFilter !== null
                ? 'bg-primary-100 dark:bg-primary-900/30 text-primary-600 dark:text-primary-400 border border-primary-300 dark:border-primary-700'
                : 'bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300 border border-gray-300 dark:border-gray-600 hover:bg-gray-200 dark:hover:bg-gray-600'
                }`}
              title="Filters"
            >
              <Filter className="w-4 h-4" />
              {(genderFilter || levelFilter || ministryFilter || visitorFilter !== null) && (
                <span className="w-2 h-2 bg-primary-500 rounded-full" />
              )}
            </button>
            {/* Add Member Button */}
            <button
              onClick={() => { selection(); setShowMemberModal(true) }}
              className="flex items-center gap-2 px-3 py-2 bg-orange-600 hover:bg-orange-700 text-white rounded-lg transition-colors shadow-sm"
              title="Add New Member"
            >
              <UserPlus className="w-5 h-5" />
              <span className="hidden md:inline text-sm font-medium">Add Member</span>
            </button>
          </div>
        </div>
      </div>

      {/* Add padding to prevent content from being hidden behind bottom search bar */}
      <div className="h-12" />
    </div>
  )
}

export default memo(Dashboard)
