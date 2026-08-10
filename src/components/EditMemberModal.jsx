import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react'
import { useApp } from '../context/AppContext'
import { useTheme } from '../context/ThemeContext'
import { useAuth } from '../context/AuthContext'
import { X, User, Phone, ChevronDown, ChevronUp, Users, StickyNote } from 'lucide-react'
import { toast } from 'react-toastify'
import useHapticFeedback from '../hooks/useHapticFeedback'
import { supabase } from '../lib/supabase'
import { executeSupabaseWrite, isTransientSupabaseError } from '../utils/supabaseWrite'
import { buildMemberIdentityHint, getMemberSourceTable } from '../utils/memberIdentity'
import DatePicker from './DatePicker'
import CombinedDatePicker from './CombinedDatePicker'
import TagSelector from './TagSelector'
import useBottomSheetDrag from '../hooks/useBottomSheetDrag'
import { GuidedField, useGuidedFormAssistant } from './GuidedFormAssistant'
import CurrentLevelPicker from './CurrentLevelPicker'
import useKeyboardSafeModal, { dismissKeyboardForNonTextControl, dismissMobileKeyboard, scrollControlIntoModalView } from '../hooks/useKeyboardSafeModal'
import AttendanceChoice from './AttendanceChoice'
import { getCanonicalAttendanceStatus } from '../utils/attendanceRecords'
import { areOptionalTagsVisible } from '../utils/tagVisibility'
import GuardianSectionHeader from './GuardianSectionHeader'

const EditMemberModal = ({ isOpen, onClose, member, onTagsChange }) => {
  const { updateMember, markAttendance, currentTable, attendanceData, members, isCollaborator, dataOwnerId, isSupabaseConfigured, guidedFormSettings, recordRecentMemberEdit, refreshMemberPreviewById } = useApp()
  const { user, preferences, isDeveloperBypass } = useAuth()
  const { selection, success } = useHapticFeedback()
  const { isDarkMode } = useTheme()

  // Get the latest member data from the members array to ensure we have up-to-date info
  const latestMember = useMemo(() => {
    if (!member?.id) return member
    return members.find(m => m.id === member.id) || member
  }, [members, member])

  // Helper function to get month display name from table name
  const getMonthDisplayName = (tableName) => {
    if (!tableName) return 'Select Month'
    // Convert table name like "October_2025" to "October 2025"
    return tableName.replace('_', ' ')
  }

  const [loading, setLoading] = useState(false)
  const hydratedMemberIdRef = useRef(null)
  const stableMemberRef = useRef(null)
  const isDirtyRef = useRef(false)
  const submitRequestIdRef = useRef(null)
  const submitInFlightRef = useRef(false)
  const [formData, setFormData] = useState({
    full_name: '',
    gender: '',
    phone_number: '',
    date_of_birth: '',
    age: '',
    current_level: '',
    notes: '',
    is_visitor: false
  })

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
      while (date.getMonth() === monthIndex) {
        sundays.push(date.toISOString().split('T')[0]) // Format as YYYY-MM-DD
        date.setDate(date.getDate() + 7)
      }

      return sundays
    } catch (error) {
      console.error('Error generating Sunday dates:', error)
      return []
    }
  }

  // Generate Sunday dates dynamically based on current table, memoized to avoid ref churn
  const sundayDates = useMemo(() => generateSundayDates(currentTable), [currentTable])
  const [sundayAttendance, setSundayAttendance] = useState({})
  const [clearedAttendanceDates, setClearedAttendanceDates] = useState(() => new Set())
  const [selectedTags, setSelectedTags] = useState([])
  const [selectedWorkspaceTagIds, setSelectedWorkspaceTagIds] = useState(new Set())
  const [initialWorkspaceTagIds, setInitialWorkspaceTagIds] = useState(new Set())
  const badgeTags = ['member', 'regular', 'newcomer']

  const levels = [
    'SHS1', 'SHS2', 'SHS3',
    'JHS1', 'JHS2', 'JHS3',
    'COMPLETED', 'UNIVERSITY'
  ]

  // Initialize form data only once per modal open/member id
  useEffect(() => {
    if (!isOpen || !member?.id) return
    if (isDirtyRef.current) return
    stableMemberRef.current = latestMember || member
    const sourceMember = stableMemberRef.current
    if (sourceMember) {
      // Normalize gender to lowercase to match radio button values
      const rawGender = sourceMember['Gender'] || ''
      const normalizedGender = typeof rawGender === 'string' ? rawGender.toLowerCase() : ''
      setFormData({
        full_name: (sourceMember['full_name'] || sourceMember['Full Name'] || ''),
        gender: normalizedGender || (typeof sourceMember.gender === 'string' ? sourceMember.gender.toLowerCase() : ''),
        phone_number: sourceMember['Phone Number'] || sourceMember.phone_number || '',
        date_of_birth: sourceMember['date_of_birth'] || sourceMember.date_of_birth || '',
        age: sourceMember['Age'] || sourceMember.age || '',
        current_level: sourceMember['Current Level'] || sourceMember.current_level || '',
        notes: sourceMember['notes'] || '',
        is_visitor: sourceMember['is_visitor'] || false
      })
      const resolvedTags = badgeTags.filter(tag => {
        if (tag === 'member') return sourceMember['Member'] === 'Yes'
        if (tag === 'regular') return sourceMember['Regular'] === 'Yes'
        if (tag === 'newcomer') return sourceMember['Newcomer'] === 'Yes'
        return false
      })
      setSelectedTags(resolvedTags)
      // Initialize parent info from member
      setParentInfo({
        parent_name_1: sourceMember['parent_name_1'] || '',
        parent_phone_1: sourceMember['parent_phone_1'] || '',
        parent_name_2: sourceMember['parent_name_2'] || '',
        parent_phone_2: sourceMember['parent_phone_2'] || ''
      })
      hydratedMemberIdRef.current = sourceMember.id
      isDirtyRef.current = false
    }
  }, [isOpen, member?.id, latestMember])

  useEffect(() => {
    if (!isOpen) {
      hydratedMemberIdRef.current = null
      stableMemberRef.current = null
      isDirtyRef.current = false
      submitRequestIdRef.current = null
      setSelectedWorkspaceTagIds(new Set())
      setInitialWorkspaceTagIds(new Set())
    }
  }, [isOpen])

  useEffect(() => {
    let cancelled = false

    const fetchMemberTags = async () => {
      if (!isOpen || !latestMember?.id || !currentTable || isDeveloperBypass) return
      try {
        const { data, error } = await supabase.rpc('get_member_tags', {
          p_member_id: latestMember.id,
          p_table_name: currentTable
        })
        if (error) throw error

        if (!cancelled) {
          const nextIds = new Set((data || []).map(tag => tag.id))
          setSelectedWorkspaceTagIds(nextIds)
          setInitialWorkspaceTagIds(new Set(nextIds))
        }
      } catch (error) {
        console.error('Error loading member tags for edit form:', error)
      }
    }

    fetchMemberTags()

    return () => {
      cancelled = true
    }
  }, [isOpen, latestMember?.id, currentTable, isDeveloperBypass])

  // Initialize attendance snapshot when modal opens (stable deps, no loop)
  useEffect(() => {
    if (!isOpen || !latestMember || sundayDates.length === 0) return

    const initialAttendance = {}
    sundayDates.forEach(date => {
      const status = getCanonicalAttendanceStatus({
        member: latestMember,
        memberId: latestMember.id,
        attendanceDate: date,
        attendanceData
      })
      if (status === 'Present') initialAttendance[date] = true
      else if (status === 'Absent') initialAttendance[date] = false
    })
    setSundayAttendance(initialAttendance)
    setClearedAttendanceDates(new Set())
  }, [isOpen, latestMember?.id, currentTable])

  // Update attendance state when attendanceData changes
  useEffect(() => {
    if (latestMember && sundayDates.length > 0) {
      const updatedAttendance = {}
      sundayDates.forEach(date => {
        const status = getCanonicalAttendanceStatus({
          member: latestMember,
          memberId: latestMember.id,
          attendanceDate: date,
          attendanceData
        })
        if (status === 'Present') updatedAttendance[date] = true
        else if (status === 'Absent') updatedAttendance[date] = false
      })
      setSundayAttendance(prev => ({ ...prev, ...updatedAttendance }))
    }
  }, [attendanceData, latestMember?.id, sundayDates])

  // Disable body scroll when modal is open
  useEffect(() => {
    if (isOpen) {
      document.body.style.overflow = 'hidden'
      document.documentElement.style.overflow = 'hidden'
    } else {
      document.body.style.overflow = ''
      document.documentElement.style.overflow = ''
    }
    return () => {
      document.body.style.overflow = ''
      document.documentElement.style.overflow = ''
    }
  }, [isOpen])

  const [hasAttemptedSave, setHasAttemptedSave] = useState(false)
  const [isLevelOpen, setIsLevelOpen] = useState(false)
  const [customLevelValue, setCustomLevelValue] = useState('')
  const [overrideMode, setOverrideMode] = useState(false)
  const [parentInfo, setParentInfo] = useState({
    parent_name_1: '',
    parent_phone_1: '',
    parent_name_2: '',
    parent_phone_2: ''
  })
  const [isClosingSheet, setIsClosingSheet] = useState(false)
  const closeTimeoutRef = useRef(null)
  const closeWithAnimation = useCallback(({ skipHaptic = false, viaDrag = false } = {}) => {
    if (isClosingSheet) return
    dismissMobileKeyboard()
    if (!skipHaptic) selection()
    if (viaDrag) {
      onClose()
      return
    }
    setIsClosingSheet(true)
    if (closeTimeoutRef.current) clearTimeout(closeTimeoutRef.current)
    closeTimeoutRef.current = setTimeout(() => {
      closeTimeoutRef.current = null
      onClose()
      setIsClosingSheet(false)
    }, 300)
  }, [isClosingSheet, onClose, selection])

  useEffect(() => {
    return () => {
      if (closeTimeoutRef.current) clearTimeout(closeTimeoutRef.current)
    }
  }, [])
  const scrollContainerRef = useRef(null)
  useKeyboardSafeModal({ scrollContainerRef, active: isOpen })
  const guideRefs = {
    fullName: useRef(null),
    gender: useRef(null),
    phone: useRef(null),
    dob: useRef(null),
    age: useRef(null),
    level: useRef(null),
    attendance: useRef(null),
    parent: useRef(null),
    tags: useRef(null),
    notes: useRef(null)
  }
  const { dragHandleProps, sheetStyle } = useBottomSheetDrag({
    onDismiss: (event) => closeWithAnimation({ skipHaptic: true, viaDrag: event?.viaDrag })
  })

  const getMissingRequiredTarget = () => {
    const currentPhoneDigits = String(formData.phone_number || '').replace(/\D/g, '')
    const currentAgeNum = parseInt(formData.age)
    const hasParentInfo = (parentInfo.parent_name_1?.trim() || parentInfo.parent_phone_1?.trim()) ||
      (parentInfo.parent_name_2?.trim() || parentInfo.parent_phone_2?.trim())

    if (!formData.full_name?.trim()) return guideRefs.fullName
    if (!formData.gender) return guideRefs.gender
    if (currentPhoneDigits.length !== 0 && currentPhoneDigits.length !== 10) return guideRefs.phone
    if (formData.age && (isNaN(currentAgeNum) || currentAgeNum < 1 || currentAgeNum > 120)) return guideRefs.age
    if (!formData.current_level) return guideRefs.level
    if (!hasParentInfo) return guideRefs.parent
    return null
  }

  const revealMissingRequiredFields = () => {
    if (overrideMode) return

    const firstMissingTarget = getMissingRequiredTarget()
    if (!firstMissingTarget) return

    setHasAttemptedSave(true)
    requestAnimationFrame(() => {
      scrollControlIntoModalView(scrollContainerRef.current, firstMissingTarget.current)
    })
  }

  const setAttendanceChoice = (date, attendance) => {
    selection()
    setSundayAttendance(prev => ({ ...prev, [date]: attendance }))
    setClearedAttendanceDates(prev => {
      const next = new Set(prev)
      if (attendance === null) next.add(date)
      else next.delete(date)
      return next
    })
  }

  const handleSubmit = async (e) => {
    e.preventDefault()
    dismissMobileKeyboard()

    if (submitInFlightRef.current || loading) {
      return
    }

    setHasAttemptedSave(true)

    // Validate required fields
    const isFullNameValid = formData.full_name && formData.full_name.trim().length > 0
    const phoneStr = String(formData.phone_number || '')
    const phoneDigits = phoneStr.replace(/\D/g, '')
    const isPhoneValid = phoneDigits.length === 0 || phoneDigits.length === 10
    const ageNum = parseInt(formData.age)
    const isAgeValid = !formData.age || (!isNaN(ageNum) && ageNum >= 1 && ageNum <= 120)

    // In override mode, save the user's chosen changes without normal form blocking.
    if (overrideMode) {
      if (!isFullNameValid) {
        const hasAttendanceChanges = Object.entries(sundayAttendance).some(([date, attendance]) => {
          const currentAttendance = attendanceData[date]?.[latestMember.id]
          if (attendance === null || attendance === undefined) {
            return clearedAttendanceDates.has(date) && currentAttendance !== undefined
          }
          return currentAttendance !== attendance
        })
        const hasTagChanges = selectedWorkspaceTagIds.size !== initialWorkspaceTagIds.size ||
          Array.from(selectedWorkspaceTagIds).some(id => !initialWorkspaceTagIds.has(id))

        if (!hasAttendanceChanges && !hasTagChanges) {
          toast.error('Choose something to save in override mode')
          return
        }
      }
    } else {
      if (!isFullNameValid || !isPhoneValid || !isAgeValid) {
        revealMissingRequiredFields()
        toast.error('Please fill in all required fields correctly')
        return
      }
    }

    submitInFlightRef.current = true
    setLoading(true)

    let bundleContext = null

    try {
      // Clean up form data before saving
      const currentSnapshot = members.find(m => m.id === latestMember.id) || latestMember || member
      const nextMemberPayload = {
        full_name: formData.full_name,
        gender: formData.gender,
        phone_number: formData.phone_number || null,
        age: formData.age ? String(formData.age).trim() : null,
        date_of_birth: formData.date_of_birth ? String(formData.date_of_birth).trim() : null,
        current_level: formData.current_level,
        // Parent info
        parent_name_1: parentInfo.parent_name_1 || null,
        parent_phone_1: parentInfo.parent_phone_1 || null,
        parent_name_2: parentInfo.parent_name_2 || null,
        parent_phone_2: parentInfo.parent_phone_2 || null,
        // Notes
        notes: formData.notes || null,
        // Visitor status
        is_visitor: formData.is_visitor || false,
        Member: selectedTags.includes('member') ? 'Yes' : null,
        Regular: selectedTags.includes('regular') ? 'Yes' : null,
        Newcomer: selectedTags.includes('newcomer') ? 'Yes' : null
      }
      if (overrideMode && !formData.full_name?.trim()) {
        delete nextMemberPayload.full_name
      }

      console.log('[EditMemberModal] nextMemberPayload:', JSON.stringify(nextMemberPayload))
      const getExistingValue = (key) => {
        if (!currentSnapshot) return undefined
        if (key === 'full_name' || key === 'Full Name') return currentSnapshot.full_name ?? currentSnapshot['Full Name']
        if (key === 'gender' || key === 'Gender') return currentSnapshot.gender ?? currentSnapshot.Gender
        if (key === 'phone_number' || key === 'Phone Number') return currentSnapshot.phone_number ?? currentSnapshot['Phone Number']
        if (key === 'age' || key === 'Age') return currentSnapshot.age ?? currentSnapshot.Age
        if (key === 'date_of_birth') return currentSnapshot['date_of_birth'] ?? currentSnapshot.date_of_birth
        if (key === 'current_level' || key === 'Current Level') return currentSnapshot.current_level ?? currentSnapshot['Current Level']
        if (key === 'Member' || key === 'member') return currentSnapshot.Member ?? currentSnapshot.member
        if (key === 'Regular' || key === 'regular') return currentSnapshot.Regular ?? currentSnapshot.regular
        if (key === 'Newcomer' || key === 'newcomer') return currentSnapshot.Newcomer ?? currentSnapshot.newcomer
        if (key === 'parent_name_1' || key === 'Parent Name 1') return currentSnapshot.parent_name_1 ?? currentSnapshot['Parent Name 1']
        if (key === 'parent_phone_1' || key === 'Parent Phone 1') return currentSnapshot.parent_phone_1 ?? currentSnapshot['Parent Phone 1']
        if (key === 'parent_name_2' || key === 'Parent Name 2') return currentSnapshot.parent_name_2 ?? currentSnapshot['Parent Name 2']
        if (key === 'parent_phone_2' || key === 'Parent Phone 2') return currentSnapshot.parent_phone_2 ?? currentSnapshot['Parent Phone 2']
        return currentSnapshot[key]
      }

      const normalizeComparable = (key, value) => {
        if (key === 'is_visitor') return Boolean(value)
        if (value === null || value === undefined) return ''
        return String(value).trim()
      }

      const changedEntries = Object.entries(nextMemberPayload).filter(([key, value]) => {
        const currentValue = getExistingValue(key)
        return normalizeComparable(key, value) !== normalizeComparable(key, currentValue)
      })
      const changedPayload = Object.fromEntries(changedEntries)
      console.log('[EditMemberModal] changedPayload:', JSON.stringify(changedPayload))

      const attendanceUpdates = Object.entries(sundayAttendance).filter(([date, attendance]) => {
        const currentAttendance = attendanceData[date]?.[latestMember.id]
        if (attendance === null || attendance === undefined) {
          return clearedAttendanceDates.has(date) && currentAttendance !== undefined
        }
        return currentAttendance !== attendance
      })

      const existingBadgeTags = badgeTags.filter(tag => {
        if (tag === 'member') return currentSnapshot?.Member === 'Yes'
        if (tag === 'regular') return currentSnapshot?.Regular === 'Yes'
        if (tag === 'newcomer') return currentSnapshot?.Newcomer === 'Yes'
        return false
      })
      const normalizeTagSet = (tags) => [...tags].sort().join('|')
      const badgeSelectionChanged = normalizeTagSet(selectedTags) !== normalizeTagSet(existingBadgeTags)
      const tagSelectionChanged = areOptionalTagsVisible(guidedFormSettings)
        && normalizeTagSet(Array.from(selectedWorkspaceTagIds)) !== normalizeTagSet(Array.from(initialWorkspaceTagIds))

      if (Object.keys(changedPayload).length === 0 && attendanceUpdates.length === 0 && !badgeSelectionChanged && !tagSelectionChanged) {
        toast.info('No changes to save')
        setLoading(false)
        return
      }

      if (!isSupabaseConfigured()) {
        if (Object.keys(changedPayload).length > 0) {
          await updateMember(latestMember.id, changedPayload)
        }

        if (attendanceUpdates.length > 0) {
          await Promise.all(
            attendanceUpdates.map(([date, attendance]) =>
              markAttendance(latestMember.id, new Date(date), attendance)
            )
          )
        }
      } else {
        if (!submitRequestIdRef.current) {
          submitRequestIdRef.current = window.crypto?.randomUUID?.() || `member-update-${Date.now()}-${Math.random().toString(16).slice(2)}`
        }

        const backendUpdates = { ...changedPayload }
        const normalizedGender = typeof formData.gender === 'string'
          ? (formData.gender.trim().toLowerCase() === 'male'
            ? 'Male'
            : formData.gender.trim().toLowerCase() === 'female'
              ? 'Female'
              : formData.gender)
          : formData.gender

        delete backendUpdates.Member
        delete backendUpdates.Regular
        delete backendUpdates.Newcomer

        // Robust Column Mapping: Map from camelCase/snake_case in UI to Pascal Case/Spaces in DB
        if (Object.prototype.hasOwnProperty.call(backendUpdates, 'full_name')) {
          const targetNameKey = Object.prototype.hasOwnProperty.call(currentSnapshot || {}, 'Full Name')
            ? 'Full Name'
            : 'full_name'
          console.log(`[EditMemberModal] Mapping name to: ${targetNameKey}`)
          backendUpdates[targetNameKey] = backendUpdates.full_name
          if (targetNameKey !== 'full_name') delete backendUpdates.full_name
        }

        // Map other common fields that are Pascal Case in the DB tables
        const mappings = [
          { ui: 'gender', db: 'Gender' },
          { ui: 'phone_number', db: 'Phone Number' },
          { ui: 'age', db: 'Age' },
          { ui: 'current_level', db: 'Current Level' }
        ]

        mappings.forEach(({ ui, db }) => {
          if (Object.prototype.hasOwnProperty.call(backendUpdates, ui)) {
            // Check what the table actually has
            const hasPascal = Object.prototype.hasOwnProperty.call(currentSnapshot || {}, db)
            const targetKey = hasPascal ? db : ui
            
            // For gender, use the properly capitalized version
            const finalValue = ui === 'gender' ? normalizedGender : backendUpdates[ui]
            
            console.log(`[EditMemberModal] Mapping ${ui} to: ${targetKey}`)
            backendUpdates[targetKey] = finalValue
            if (targetKey !== ui) delete backendUpdates[ui]
          } else if (ui === 'gender' && Object.prototype.hasOwnProperty.call(backendUpdates, 'Gender')) {
            // Already mapped or received as Gender, ensure normalization
            backendUpdates.Gender = normalizedGender
          }
        })

        const attendancePayload = Object.fromEntries(attendanceUpdates)
        const ownerId = dataOwnerId || user?.id

        if (!ownerId) {
          throw new Error('Unable to determine the workspace owner for this save')
        }

        const targetTable = getMemberSourceTable(latestMember, currentTable)
        console.info('[EditMemberModal] Submitting bundle update:', {
          table: targetTable,
          memberId: latestMember.id,
          updates: backendUpdates,
          requestId: submitRequestIdRef.current
        })

        bundleContext = {
          backendUpdates,
          targetTable,
          ownerId,
          identity: buildMemberIdentityHint(latestMember)
        }

        const { data: bundleResult } = await executeSupabaseWrite(
          () => supabase.rpc('update_member_bundle_resilient', {
            p_table_name: targetTable,
            p_owner_id: ownerId,
            p_member_id: latestMember.id,
            p_request_id: submitRequestIdRef.current,
            p_updates: backendUpdates,
            p_badges: selectedTags,
            p_tag_ids: tagSelectionChanged ? Array.from(selectedWorkspaceTagIds) : null,
            p_attendance: attendancePayload,
            p_identity: buildMemberIdentityHint(latestMember)
          }),
          { action: `Update member bundle in ${targetTable}` }
        )

        if (!bundleResult?.success) {
          console.error('[EditMemberModal] RPC Error:', bundleResult)
          throw new Error(bundleResult?.error_message || 'Backend member update failed')
        }

        if (bundleResult?.receipt?.request_id) {
          localStorage.setItem('lastMemberSaveReceipt', JSON.stringify(bundleResult.receipt))
        }

        const editedAt = new Date().toISOString()
        recordRecentMemberEdit({
          ...currentSnapshot,
          ...nextMemberPayload,
          id: latestMember.id,
          updated_at: editedAt
        }, editedAt)

        // Successful update - close modal immediately before triggering global refreshes
        // This prevents the parent dashboard from re-rendering the modal while it's still "open" 
        // which causes the entrance animations or "reshow" flicker.
        success()
        onClose()

        // Patch the updated row into the lightweight local preview/search index immediately.
        try {
          await refreshMemberPreviewById?.(latestMember.id, {
            fallbackMember: {
              ...currentSnapshot,
              ...nextMemberPayload,
              id: latestMember.id,
              updated_at: editedAt
            },
            source: 'member-bundle-update',
            action: 'update',
            summary: 'Updated member details',
            skipRemote: true,
            skipBackgroundSync: true
          })
        } catch (refreshError) {
          console.warn('Member updated but refresh failed:', refreshError)
          toast.warning('Member was saved, but the local view could not refresh automatically.')
        }

        submitRequestIdRef.current = null
        if (onTagsChange) {
          onTagsChange()
        }
        toast.success('Member saved')
      }

      // Reset Sunday attendance state
      setSundayAttendance({})
      setClearedAttendanceDates(new Set())
      setSelectedTags([])

    } catch (error) {
      console.error('Error updating member:', error)
      const isOfflineNow = typeof navigator !== 'undefined' && navigator.onLine === false
      if (bundleContext && (isTransientSupabaseError(error) || isOfflineNow)) {
        // Offline or degraded backend: keep the edit by routing it through the
        // canonical AppContext member-update path, which queues it for retry
        // instead of letting it silently disappear.
        try {
          await updateMember(latestMember.id, bundleContext.backendUpdates, {
            targetTable: bundleContext.targetTable,
            ownerId: bundleContext.ownerId,
            identity: bundleContext.identity
          })
          success()
          onClose()
        } catch (queueError) {
          console.error('Could not queue offline member update:', queueError)
          toast.error(queueError.message || 'Failed to update member')
        }
      } else {
        toast.error(error.message || 'Failed to update member')
      }
    } finally {
      setLoading(false)
      submitInFlightRef.current = false
    }
  }

  const handleInputChange = (e) => {
    isDirtyRef.current = true
    const { name, value } = e.target
    
    if (name === 'date_of_birth') {
      // Calculate age automatically
      if (value) {
        // Parse date in local timezone to avoid UTC issues
        const [year, month, day] = value.split('-').map(Number)
        const dob = new Date(year, month - 1, day)
        const today = new Date()
        let age = today.getFullYear() - dob.getFullYear()
        const m = today.getMonth() - dob.getMonth()
        if (m < 0 || (m === 0 && today.getDate() < dob.getDate())) {
          age--
        }
        setFormData(prev => ({
          ...prev,
          [name]: value,
          age: age >= 0 ? age.toString() : ''
        }))
      } else {
        setFormData(prev => ({
          ...prev,
          [name]: value
        }))
      }
    } else {
      setFormData(prev => ({
        ...prev,
        [name]: value
      }))
    }
  }

  const applyCustomLevel = () => {
    const nextLevel = customLevelValue.trim().toUpperCase()
    if (!nextLevel) return

    selection()
    handleInputChange({ target: { name: 'current_level', value: nextLevel } })
    setCustomLevelValue('')
    setIsLevelOpen(false)
  }

  // ESC key to close modal
  useEffect(() => {
    const handleEscKey = (event) => {
      if (event.key === 'Escape' && isOpen) {
        closeWithAnimation()
      }
    }

    document.addEventListener('keydown', handleEscKey)
    return () => {
      document.removeEventListener('keydown', handleEscKey)
    }
  }, [isOpen, closeWithAnimation])

  const phoneDigits = String(formData.phone_number || '').replace(/\D/g, '')
  const guideSteps = React.useMemo(() => ([
    { id: 'full-name', label: 'Full Name', targetRef: guideRefs.fullName, isComplete: () => Boolean(formData.full_name?.trim()) },
    { id: 'gender', label: 'Gender', targetRef: guideRefs.gender, isComplete: () => Boolean(formData.gender) },
    { id: 'phone', label: 'Phone Number', targetRef: guideRefs.phone, isComplete: () => phoneDigits.length === 10 },
    { id: 'dob', label: 'Date of Birth', targetRef: guideRefs.dob, isComplete: () => Boolean(formData.date_of_birth) },
    { id: 'age', label: 'Age', targetRef: guideRefs.age, isComplete: () => Boolean(formData.age) },
    { id: 'level', label: 'Current Level', targetRef: guideRefs.level, isComplete: () => Boolean(formData.current_level) },
    { id: 'attendance', label: 'Sunday Attendance', targetRef: guideRefs.attendance, isComplete: () => sundayDates.some(date => sundayAttendance[date] !== null && sundayAttendance[date] !== undefined) },
    {
      id: 'parent',
      label: 'Parent/Guardian Info',
      targetRef: guideRefs.parent,
      isComplete: () => Boolean((parentInfo.parent_name_1?.trim() || parentInfo.parent_phone_1?.trim()) || (parentInfo.parent_name_2?.trim() || parentInfo.parent_phone_2?.trim())),
    },
    { id: 'tags', label: 'Tags', targetRef: guideRefs.tags, enabled: areOptionalTagsVisible(guidedFormSettings) && guidedFormSettings?.highlightTags, isComplete: () => selectedWorkspaceTagIds.size > 0 },
    { id: 'notes', label: 'Notes', targetRef: guideRefs.notes, enabled: guidedFormSettings?.highlightNotes, isComplete: () => Boolean(formData.notes?.trim()) }
  ]), [formData, parentInfo, phoneDigits, selectedWorkspaceTagIds, sundayAttendance, sundayDates, guidedFormSettings])

  const { activeStepId } = useGuidedFormAssistant({
    steps: guideSteps,
    settings: guidedFormSettings,
    enabled: isOpen && guidedFormSettings?.showInEditMember !== false,
    scrollContainerRef
  })

  if ((!isOpen && !isClosingSheet) || !member) return null

  return (
    <div 
      className="keyboard-safe-modal-backdrop fixed inset-0 bg-black/65 backdrop-blur-md flex items-end sm:items-center justify-center p-0 sm:p-4 z-[90] backdrop-animate"
      onClick={() => closeWithAnimation()}
    >
      <div
        className={`keyboard-safe-modal-shell mobile-bottom-sheet shadow-2xl ring-1 w-full sm:max-w-md max-h-[84dvh] sm:max-h-[90vh] flex flex-col overflow-hidden rounded-t-2xl rounded-b-none sm:rounded-xl ${isClosingSheet ? 'filter-exit' : 'filter-enter'} ${overrideMode
        ? 'bg-orange-50 dark:bg-orange-900 ring-orange-300 dark:ring-orange-700'
        : 'bg-white dark:bg-gray-800 ring-gray-200 dark:ring-gray-700'
        }`}
        data-testid="edit-member-modal"
        style={sheetStyle}
        onClick={(e) => e.stopPropagation()}
        onPointerDownCapture={dismissKeyboardForNonTextControl}
      >
        {/* Draggable Header Section (Mobile Only) */}
        <div
          className={`sm:hidden flex flex-col items-center flex-shrink-0 rounded-t-2xl overflow-hidden transition-colors duration-300 ${overrideMode
            ? 'bg-orange-100/80 dark:bg-orange-800/80'
            : 'bg-white dark:bg-gray-800'
            }`}
        >
          <div
            className="pt-3 pb-1 w-full flex justify-center cursor-grab active:cursor-grabbing"
            role="button"
            aria-label="Drag down to close edit member form"
            title="Drag down to close"
            {...dragHandleProps}
          >
            <div className="w-12 h-1.5 rounded-full bg-gray-300 dark:bg-gray-600 shadow-sm" />
          </div>
          <div className={`w-full flex items-center justify-between px-4 py-3 border-b transition-all duration-300 ${overrideMode
            ? 'bg-orange-100/80 dark:bg-orange-800/80 border-orange-200 dark:border-orange-700'
            : 'border-gray-200 dark:border-gray-700'
            }`}>
            <div>
              <h2 className="text-lg font-bold text-gray-900 dark:text-white">Edit Member</h2>
              {member?.source_month_label && !member?.already_in_current_table && (
                <p className="text-xs text-orange-600 dark:text-orange-400 font-medium">
                  Profile source: {member.source_month_label}
                </p>
              )}
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation()
                  selection()
                  setHasAttemptedSave(false)
                  setOverrideMode(!overrideMode)
                }}
                className={`px-3 py-1 rounded text-[10px] font-black uppercase border transition-colors ${overrideMode
                  ? 'bg-orange-200 dark:bg-orange-700 text-orange-800 dark:text-orange-200 border-orange-300 dark:border-orange-600'
                  : 'bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300 border-gray-300 dark:border-gray-600'
                  }`}
              >
                {overrideMode ? 'Override Active' : 'Override'}
              </button>
              <button
                onClick={(e) => { e.stopPropagation(); closeWithAnimation() }}
                className="p-1 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg transition-colors"
              >
                <X className="w-5 h-5 text-gray-500 dark:text-gray-400" />
              </button>
            </div>
          </div>
        </div>

        {/* Static Header (Desktop Only) */}
        <div className={`hidden sm:flex items-center justify-between px-6 py-4 border-b flex-shrink-0 transition-all duration-300 rounded-t-xl ${overrideMode
          ? 'bg-orange-100/80 dark:bg-orange-800/80 border-orange-200 dark:border-orange-700'
          : 'border-gray-200 dark:border-gray-700'
          }`}>
          <div>
            <h2 className="text-xl font-semibold text-gray-900 dark:text-white">Edit Member</h2>
            {member?.source_month_label && !member?.already_in_current_table && (
              <p className="text-xs text-orange-600 dark:text-orange-400 font-medium">
                Profile source: {member.source_month_label}
              </p>
            )}
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => {
                selection()
                setHasAttemptedSave(false)
                setOverrideMode(!overrideMode)
              }}
              className={`px-3 py-1 rounded text-xs border transition-colors ${overrideMode
                ? 'bg-orange-200 dark:bg-orange-700 text-orange-800 dark:text-orange-200 border-orange-300 dark:border-orange-600 font-medium'
                : 'bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300 border-gray-300 dark:border-gray-600 hover:bg-gray-200 dark:hover:bg-gray-600'
                }`}
            >
              {overrideMode ? 'Override Active' : 'Override'}
            </button>
            <button
              onClick={() => closeWithAnimation()}
              className="p-1 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg transition-colors"
            >
              <X className="w-5 h-5 text-gray-500 dark:text-gray-400" />
            </button>
          </div>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} noValidate className={`flex flex-col flex-1 min-h-0 ${overrideMode ? 'bg-orange-50 dark:bg-orange-900' : 'bg-white dark:bg-gray-800'}`}>
          <div ref={scrollContainerRef} className="keyboard-safe-modal-body flex-1 min-h-0 overflow-y-auto p-4 sm:p-6 pb-5 space-y-4 scrollbar-hide overscroll-contain" style={{ scrollbarWidth: 'none', msOverflowStyle: 'none', WebkitOverflowScrolling: 'touch' }}>
          {/* Full Name */}
          <GuidedField ref={guideRefs.fullName} active={activeStepId === 'full-name'}>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
              Full Name *
            </label>
            <div className="relative">
              <User className="pointer-events-none absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-gray-500 dark:text-gray-400" />
              <input
                type="text"
                name="full_name"
                value={formData.full_name}
                onChange={handleInputChange}
                data-testid="edit-form-full-name"
                className={`w-full pl-10 pr-4 py-2 border rounded-lg focus:outline-none focus:ring-2 bg-white dark:bg-gray-700 text-gray-900 dark:text-white placeholder-gray-500 dark:placeholder-gray-400 transition-colors ${hasAttemptedSave && (!formData.full_name || !formData.full_name.trim())
                  ? 'border-red-500 focus:ring-red-500 bg-red-50 dark:bg-red-900/10'
                  : 'border-gray-300 dark:border-gray-600 focus:ring-primary-500'
                  }`}
                placeholder="Enter full name"
              />
            </div>
            {hasAttemptedSave && (!formData.full_name || !formData.full_name.trim()) && (
              <p className="mt-1 text-xs text-red-600 dark:text-red-400">Full name is required</p>
            )}
          </GuidedField>

          {/* Gender */}
          <GuidedField ref={guideRefs.gender} active={activeStepId === 'gender'}>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
              Gender *
            </label>
            <div className="grid grid-cols-2 gap-3">
              <label className={`flex items-center space-x-2 p-3 border rounded-lg cursor-pointer transition-colors ${formData.gender === 'male'
                ? 'border-primary-500 bg-primary-100 dark:bg-primary-900/30 text-primary-700 dark:text-primary-300 ring-2 ring-primary-300 dark:ring-primary-800 shadow-sm font-semibold'
                : (hasAttemptedSave && !formData.gender
                  ? 'border-red-500 ring-2 ring-red-400 bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-300'
                  : 'border-gray-300 dark:border-gray-600 hover:bg-gray-50 dark:hover:bg-gray-700 bg-white dark:bg-gray-700 text-gray-700 dark:text-gray-300')
                }`}>
                <input
                  type="radio"
                  name="gender"
                  value="male"
                  checked={formData.gender === 'male'}
                  onChange={handleInputChange}
                  data-testid="edit-form-gender-male"
                  required
                  className="text-primary-600 focus:ring-primary-500"
                />
                <span className="text-sm">Male</span>
              </label>

              <label className={`flex items-center space-x-2 p-3 border rounded-lg cursor-pointer transition-colors ${formData.gender === 'female'
                ? 'border-primary-500 bg-primary-100 dark:bg-primary-900/30 text-primary-700 dark:text-primary-300 ring-2 ring-primary-300 dark:ring-primary-800 shadow-sm font-semibold'
                : (hasAttemptedSave && !formData.gender
                  ? 'border-red-500 ring-2 ring-red-400 bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-300'
                  : 'border-gray-300 dark:border-gray-600 hover:bg-gray-50 dark:hover:bg-gray-700 bg-white dark:bg-gray-700 text-gray-700 dark:text-gray-300')
                }`}>
                <input
                  type="radio"
                  name="gender"
                  value="female"
                  checked={formData.gender === 'female'}
                  onChange={handleInputChange}
                  data-testid="edit-form-gender-female"
                  required
                  className="text-primary-600 focus:ring-primary-500"
                />
                <span className="text-sm">Female</span>
              </label>
            </div>
            {hasAttemptedSave && !formData.gender && (
              <p className="mt-2 text-xs text-red-600 dark:text-red-400">Please select gender to continue</p>
            )}
          </GuidedField>

          {/* Phone Number */}
          <GuidedField ref={guideRefs.phone} active={activeStepId === 'phone'}>
            <div className="flex items-center justify-between mb-2">
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">
                Phone Number
              </label>
            </div>
            <div className="relative">
              <div className="absolute inset-y-0 left-0 flex items-center pl-3 pointer-events-none">
                <Phone className="pointer-events-none w-4 h-4 text-gray-500 dark:text-gray-400" />
              </div>
              <input
                type="tel"
                name="phone_number"
                value={formData.phone_number}
                onChange={handleInputChange}
                data-testid="edit-form-phone"
                inputMode="numeric"
                pattern="[0-9]*"
                maxLength={10}
                placeholder="Enter phone number"
                className="w-full pl-10 pr-20 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-gray-50 dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-primary-500 focus:border-transparent transition-all"
              />
              <div className="absolute inset-y-0 right-0 flex items-center pr-2">
                <button
                  type="button"
                  onClick={() => setFormData(prev => ({ ...prev, phone_number: '0000000000' }))}
                  className="px-2 py-1 rounded text-xs bg-gray-100 dark:bg-gray-600 text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-500 border border-gray-300 dark:border-gray-600"
                  title="Set no phone number"
                >
                  No Phone
                </button>
              </div>
            </div>


            {hasAttemptedSave && (String(formData.phone_number || '').replace(/\D/g, '').length !== 10) && (
              <p className="mt-1 text-xs text-red-600 dark:text-red-400">Phone number must be 10 digits</p>
            )}
          </GuidedField>

          {/* Date of Birth and Age */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {/* Date of Birth */}
            <GuidedField ref={guideRefs.dob} active={activeStepId === 'dob'}>
              <CombinedDatePicker
                name="date_of_birth"
                label="Date of Birth"
                value={formData.date_of_birth}
                onChange={handleInputChange}
                placeholder="Select date"
                birthDateMode={preferences?.date_of_birth_picker_mode || 'combined'}
                error={hasAttemptedSave && !formData.date_of_birth && !formData.age}
              />
            </GuidedField>

            {/* Age */}
            <GuidedField ref={guideRefs.age} active={activeStepId === 'age'}>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                Age
              </label>
              <div className="relative">
                <input
                  type="number"
                  name="age"
                  value={formData.age}
                  onChange={handleInputChange}
                  data-testid="edit-form-age"
                  min="1"
                  max="120"
                  inputMode="numeric"
                  pattern="[0-9]*"
                  step="1"
                  className={`w-full px-3 py-2 border rounded-lg focus:outline-none focus:ring-2 transition-colors ${hasAttemptedSave && (!formData.age || isNaN(parseInt(formData.age)))
                    ? 'border-red-500 focus:ring-red-500 bg-red-50 dark:bg-red-900/10'
                    : 'border-gray-300 dark:border-gray-600 focus:ring-primary-500 bg-white dark:bg-gray-700 text-gray-900 dark:text-white placeholder-gray-500 dark:placeholder-gray-400'
                    }`}
                  placeholder="Age"
                />
              </div>
            </GuidedField>
          </div>
          {hasAttemptedSave && (!formData.age || isNaN(parseInt(formData.age))) && (
            <p className="mt-1 text-xs text-red-600 dark:text-red-400">Please enter date of birth or age</p>
          )}

          {/* Current Level */}
          <GuidedField ref={guideRefs.level} active={activeStepId === 'level'}>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
              Current Level
            </label>
            <CurrentLevelPicker
              value={formData.current_level}
              levels={levels}
              error={hasAttemptedSave && !formData.current_level}
              testIdPrefix="edit-form-level"
              customLevelValue={customLevelValue}
              onCustomLevelChange={setCustomLevelValue}
              onCustomLevelApply={applyCustomLevel}
              onOpen={() => setIsLevelOpen(true)}
              onClose={() => setIsLevelOpen(false)}
              onChange={(level) => {
                handleInputChange({ target: { name: 'current_level', value: level } })
                setIsLevelOpen(false)
              }}
            />
            {hasAttemptedSave && !formData.current_level && (
              <p className="mt-1 text-xs text-red-600 dark:text-red-400">Please select current level</p>
            )}
          </GuidedField>

          {/* Optional workspace tags */}
          {areOptionalTagsVisible(guidedFormSettings) && (
            <GuidedField ref={guideRefs.tags} active={activeStepId === 'tags'} className="pt-2 border-t border-gray-200 dark:border-gray-600">
              <TagSelector
                ownerId={dataOwnerId || user?.id}
                memberId={member?.id}
                tableName={currentTable}
                isDarkMode={isDarkMode}
                selectedTagIds={selectedWorkspaceTagIds}
                onSelectionChange={setSelectedWorkspaceTagIds}
                deferSave={true}
              />
            </GuidedField>
          )}

          {/* Sunday Attendance */}
          <GuidedField ref={guideRefs.attendance} active={activeStepId === 'attendance'}>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-3">
              {getMonthDisplayName(currentTable)} Sunday Attendance (Optional)
            </label>
            <div className="space-y-3">
              {sundayDates.map(date => {
                const dateObj = new Date(date)
                const formattedDate = dateObj.toLocaleDateString('en-US', {
                  weekday: 'long',
                  year: 'numeric',
                  month: 'long',
                  day: 'numeric'
                })

                return (
                  <div
                    key={date}
                    data-testid={`edit-form-attendance-card-${date}`}
                    className="border border-gray-200 dark:border-gray-600 rounded-lg p-3 bg-white dark:bg-gray-700 transition-colors"
                  >
                    <div className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                      {formattedDate}
                    </div>
                    <AttendanceChoice
                      value={sundayAttendance[date]}
                      onChange={value => setAttendanceChoice(date, value)}
                      testIdPrefix={`edit-form-attendance-${date}`}
                      ariaLabel={`Attendance for ${formattedDate}`}
                    />
                  </div>
                )
              })}
            </div>
          </GuidedField>

          {/* Parent/Guardian Info is intentionally always visible. */}
          <GuidedField ref={guideRefs.parent} active={activeStepId === 'parent'} className={`border rounded-xl overflow-hidden transition-all duration-300 ${hasAttemptedSave && !overrideMode && !((parentInfo.parent_name_1?.trim() || parentInfo.parent_phone_1?.trim()) || (parentInfo.parent_name_2?.trim() || parentInfo.parent_phone_2?.trim()))
            ? 'border-red-500 ring-4 ring-red-50 dark:ring-red-900/30'
            : 'border-gray-200 dark:border-gray-600'
            }`}>
            <GuardianSectionHeader
              invalid={hasAttemptedSave && !overrideMode && !((parentInfo.parent_name_1?.trim() || parentInfo.parent_phone_1?.trim()) || (parentInfo.parent_name_2?.trim() || parentInfo.parent_phone_2?.trim()))}
              complete={Boolean(parentInfo.parent_name_1 || parentInfo.parent_phone_1)}
            />
              <div className="p-3 space-y-3 bg-white dark:bg-gray-800 border-t border-gray-200 dark:border-gray-600">
                {/* Parent 1 */}
                <div>
                  <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">
                    Parent/Guardian 1 *
                  </label>
                  <div className="space-y-2">
                    <div className="relative">
                      <User className="pointer-events-none absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-gray-400" />
                      <input
                        type="text"
                        value={parentInfo.parent_name_1}
                        onChange={(e) => {
                          isDirtyRef.current = true
                          setParentInfo(prev => ({ ...prev, parent_name_1: e.target.value }))
                        }}
                        data-testid="edit-form-parent1-name"
                        placeholder="Name"
                        className="w-full pl-10 pr-4 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white placeholder-gray-500 dark:placeholder-gray-400 focus:outline-none focus:ring-1 focus:ring-primary-500 text-sm"
                      />
                    </div>
                    <div className="relative">
                      <Phone className="pointer-events-none absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-gray-400" />
                      <input
                        type="tel"
                        value={parentInfo.parent_phone_1}
                        onChange={(e) => {
                          isDirtyRef.current = true
                          setParentInfo(prev => ({ ...prev, parent_phone_1: e.target.value.replace(/\D/g, '').slice(0, 10) }))
                        }}
                        data-testid="edit-form-parent1-phone"
                        placeholder="Phone Number"
                        className="w-full pl-10 pr-20 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white placeholder-gray-500 dark:placeholder-gray-400 focus:outline-none focus:ring-1 focus:ring-primary-500 text-sm"
                      />
                      <div className="absolute inset-y-0 right-0 flex items-center pr-2">
                        <button
                          type="button"
                          onClick={() => {
                            isDirtyRef.current = true
                            setParentInfo(prev => ({ ...prev, parent_phone_1: '0000000000' }))
                          }}
                          className="px-2 py-1 rounded text-xs bg-gray-100 dark:bg-gray-600 text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-500 border border-gray-300 dark:border-gray-600"
                          title="Set no phone number"
                        >
                          No Phone
                        </button>
                      </div>
                    </div>
                  </div>
                </div>

                {/* Parent 2 */}
                <div>
                  <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">
                    Parent/Guardian 2 (Optional)
                  </label>
                  <div className="space-y-2">
                    <div className="relative">
                      <User className="pointer-events-none absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-gray-400" />
                      <input
                        type="text"
                        data-testid="edit-form-parent2-name"
                        value={parentInfo.parent_name_2}
                        onChange={(e) => {
                          isDirtyRef.current = true
                          setParentInfo(prev => ({ ...prev, parent_name_2: e.target.value }))
                        }}
                        placeholder="Name"
                        className="w-full pl-10 pr-4 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white placeholder-gray-500 dark:placeholder-gray-400 focus:outline-none focus:ring-1 focus:ring-primary-500 text-sm"
                      />
                    </div>
                    <div className="relative">
                      <Phone className="pointer-events-none absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-gray-400" />
                      <input
                        type="tel"
                        data-testid="edit-form-parent2-phone"
                        value={parentInfo.parent_phone_2}
                        onChange={(e) => {
                          isDirtyRef.current = true
                          setParentInfo(prev => ({ ...prev, parent_phone_2: e.target.value.replace(/\D/g, '').slice(0, 10) }))
                        }}
                        placeholder="Phone Number"
                        className="w-full pl-10 pr-20 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white placeholder-gray-500 dark:placeholder-gray-400 focus:outline-none focus:ring-1 focus:ring-primary-500 text-sm"
                      />
                      <div className="absolute inset-y-0 right-0 flex items-center pr-2">
                        <button
                          type="button"
                          onClick={() => {
                            isDirtyRef.current = true
                            setParentInfo(prev => ({ ...prev, parent_phone_2: '0000000000' }))
                          }}
                          className="px-2 py-1 rounded text-xs bg-gray-100 dark:bg-gray-600 text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-500 border border-gray-300 dark:border-gray-600"
                          title="Set no phone number"
                        >
                          No Phone
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
          </GuidedField>

          {areOptionalTagsVisible(guidedFormSettings) && (
          <div>
            <label className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-2">
              Member Tags
            </label>
            <div className="flex flex-wrap gap-2">
              {badgeTags.map(tag => {
                const active = selectedTags.includes(tag)
                const label = tag === 'member' ? 'Member' : tag === 'regular' ? 'Regular' : 'Newcomer'
                return (
                  <button
                    key={tag}
                    type="button"
                    data-testid={`edit-form-badge-${tag}`}
                    onClick={() => {
                      setSelectedTags(prev =>
                        prev.includes(tag) ? prev.filter(t => t !== tag) : [...prev, tag]
                      )
                    }}
                    className={`px-3 py-1.5 rounded-full text-xs font-medium transition-all ${
                      active
                        ? 'bg-primary-600 text-white shadow-sm'
                        : 'bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600'
                    }`}
                  >
                    {label}
                  </button>
                )
              })}
            </div>
          </div>
          )}

          {/* Visitor Toggle */}
          {guidedFormSettings?.showVisitorField !== false && (
          <div className="flex items-center justify-between py-2 px-3 bg-gray-50 dark:bg-gray-700/50 rounded-lg">
            <span className="text-sm font-medium text-gray-700 dark:text-gray-300">Mark as Visitor</span>
            <button
              type="button"
              onClick={() => {
                isDirtyRef.current = true
                setFormData(prev => ({ ...prev, is_visitor: !prev.is_visitor }))
              }}
              data-testid="edit-form-visitor-toggle"
              className={`relative w-11 h-6 rounded-full transition-colors ${
                formData.is_visitor ? 'bg-amber-500' : 'bg-gray-300 dark:bg-gray-600'
              }`}
            >
              <span className={`absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full shadow transition-transform ${
                formData.is_visitor ? 'translate-x-5' : 'translate-x-0'
              }`} />
            </button>
          </div>
          )}

          {/* Notes Section */}
          {guidedFormSettings?.showNotesField !== false && (
          <GuidedField ref={guideRefs.notes} active={activeStepId === 'notes'}>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
              <span className="flex items-center gap-1.5">
                <StickyNote className="w-4 h-4" />
                Notes (Optional)
              </span>
            </label>
            <textarea
              name="notes"
              value={formData.notes}
              onChange={handleInputChange}
              rows={2}
              data-testid="edit-form-notes"
              placeholder="Add any notes about this member..."
              className="w-full px-3 py-2 border rounded-lg focus:outline-none focus:ring-2 bg-white dark:bg-gray-700 text-gray-900 dark:text-white placeholder-gray-500 dark:placeholder-gray-400 border-gray-300 dark:border-gray-600 focus:ring-primary-500 text-sm resize-none"
            />
          </GuidedField>
          )}

          </div>

          {/* Form Actions */}
          <div
            className={`keyboard-safe-modal-footer flex-shrink-0 border-t border-gray-200 dark:border-gray-700 px-4 pt-3 sm:px-5 sm:pb-5 flex space-x-3 rounded-b-none sm:rounded-b-xl ${overrideMode ? 'bg-orange-50 dark:bg-orange-900' : 'bg-white dark:bg-gray-800'}`}
            style={{ paddingBottom: 'max(12px, env(safe-area-inset-bottom, 12px))' }}
          >
            <button
                  type="button"
                  onClick={() => closeWithAnimation()}
                  className="flex-1 min-h-[44px] px-4 py-2 border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 rounded-xl hover:bg-gray-50 dark:hover:bg-gray-700 bg-white dark:bg-gray-700 transition-colors btn-press"
                >
                  Cancel
                </button>
            <button
              type="submit"
              disabled={loading || (!overrideMode && !formData.full_name)}
              data-testid="edit-form-submit"
              className={`flex-1 min-h-[44px] px-4 py-2 text-white rounded-xl disabled:opacity-50 disabled:cursor-not-allowed transition-colors btn-press ${overrideMode
                ? 'bg-orange-600 hover:bg-orange-700'
                : 'bg-primary-600 hover:bg-primary-700'
                }`}
            >
              {loading ? 'Updating...' : (overrideMode ? 'Update (Override)' : 'Update Member')}
            </button>
          </div>
        </form>
      </div >
    </div >
  )
}

export default EditMemberModal
