import React, { useState, useEffect, useRef, useCallback } from 'react'
import { useApp } from '../context/AppContext'
import { useTheme } from '../context/ThemeContext'
import { useAuth } from '../context/AuthContext'
import { X, User, Phone, Calendar, BookOpen, ChevronDown, ChevronUp, Info, Users, StickyNote, Tag, Pencil } from 'lucide-react'
import { toast } from 'react-toastify'
import useHapticFeedback from '../hooks/useHapticFeedback'
import { supabase } from '../lib/supabase'
import { executeSupabaseWrite } from '../utils/supabaseWrite'
import DatePicker from './DatePicker'
import CombinedDatePicker from './CombinedDatePicker'
import TagSelector from './TagSelector'
import useBottomSheetDrag from '../hooks/useBottomSheetDrag'
import { GuidedField, useGuidedFormAssistant } from './GuidedFormAssistant'

const MemberModal = ({ isOpen, onClose }) => {
  const { addMember, markAttendance, currentTable, toggleMemberBadge, updateMemberBadges, refreshSearch, forceRefreshMembersSilent, loadAllAttendanceData, loadAllBadgeData, updateMember, isCollaborator, dataOwnerId, isSupabaseConfigured, guidedFormSettings } = useApp()
  const { user, preferences, isDeveloperBypass } = useAuth()
  const { isDarkMode } = useTheme()
  const { selection, success } = useHapticFeedback()

  // Helper function to get month display name from table name
  const getMonthDisplayName = (tableName) => {
    // Convert table name like "October_2025" to "October 2025"
    return tableName.replace('_', ' ')
  }
  const [loading, setLoading] = useState(false)
  const submitRequestIdRef = useRef(null)
  const submitInFlightRef = useRef(false)
  const [showErrors, setShowErrors] = useState(false)
  const [showParentErrors, setShowParentErrors] = useState(false)
  const [isLevelOpen, setIsLevelOpen] = useState(false)
  const [customLevelValue, setCustomLevelValue] = useState('')
  const [newlyAddedMemberId, setNewlyAddedMemberId] = useState(null)
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

  // Generate Sunday dates dynamically based on current table
  const sundayDates = generateSundayDates(currentTable)

  // Initialize Sunday attendance state dynamically
  const initializeSundayAttendance = () => {
    const attendance = {}
    sundayDates.forEach(date => {
      attendance[date] = null // null = not set, true = present, false = absent
    })
    return attendance
  }

  const [sundayAttendance, setSundayAttendance] = useState(() => initializeSundayAttendance())
  const [previousIsOpen, setPreviousIsOpen] = useState(false)
  const [selectedTags, setSelectedTags] = useState([]) // ['member','regular','newcomer']
  const [showSecondParent, setShowSecondParent] = useState(false)
  const [showParentSection, setShowParentSection] = useState(false)
  const [parentInfo, setParentInfo] = useState({
    parent_name_1: '',
    parent_phone_1: '',
    parent_name_2: '',
    parent_phone_2: ''
  })
  
  // State for TagSelector (workspace tags)
  const [workspaceTags, setWorkspaceTags] = useState([])
  const [selectedTagIds, setSelectedTagIds] = useState(new Set())
  const scrollContainerRef = useRef(null)
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

  // Reset attendance state when modal opens (but not while it stays open) or current table changes
  React.useEffect(() => {
    if (isOpen && !previousIsOpen) {
      // Modal just opened, reset attendance
      setSundayAttendance(initializeSundayAttendance())
    }
    setPreviousIsOpen(isOpen)
  }, [isOpen, currentTable])

  React.useEffect(() => {
    if (!isOpen) {
      submitRequestIdRef.current = null
    }
  }, [isOpen])

  // Disable body scroll when modal is open
  React.useEffect(() => {
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

  // Fetch workspace tags when modal opens
  React.useEffect(() => {
    const fetchWorkspaceTags = async () => {
      const ownerId = dataOwnerId || user?.id
      if (!ownerId || isDeveloperBypass || !isSupabaseConfigured()) return
      
      try {
        const { data, error } = await supabase.rpc('get_workspace_tags', {
          p_owner_id: ownerId
        })
        if (error) {
          console.error('Error fetching workspace tags:', error)
          return
        }
        setWorkspaceTags(data || [])
      } catch (error) {
        console.error('Error fetching workspace tags:', error)
      }
    }
    
    if (isOpen) {
      fetchWorkspaceTags()
    }
  }, [isOpen, dataOwnerId, user?.id, isDeveloperBypass, isSupabaseConfigured])

  const levels = [
    'SHS1', 'SHS2', 'SHS3',
    'JHS1', 'JHS2', 'JHS3',
    'COMPLETED', 'UNIVERSITY'
  ]

  const toggleTagSelect = (tag) => {
    setSelectedTags(prev => prev.includes(tag)
      ? prev.filter(t => t !== tag)
      : [...prev, tag]
    )
  }

  const [hasAttemptedSave, setHasAttemptedSave] = useState(false)
  const [isOverrideMode, setIsOverrideMode] = useState(false)
  const [isClosingSheet, setIsClosingSheet] = useState(false)
  const closeTimeoutRef = useRef(null)
  const closeWithAnimation = useCallback(({ skipHaptic = false, viaDrag = false } = {}) => {
    if (isClosingSheet) return
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

  const { dragHandleProps, sheetStyle } = useBottomSheetDrag({
    onDismiss: (event) => closeWithAnimation({ skipHaptic: true, viaDrag: event?.viaDrag })
  })

  const getMissingRequiredTarget = () => {
    const currentPhoneDigits = (formData.phone_number || '').replace(/\D/g, '')
    const currentAgeNum = parseInt(formData.age)
    const hasParentInfo = (parentInfo.parent_name_1?.trim() || parentInfo.parent_phone_1?.trim()) ||
      (parentInfo.parent_name_2?.trim() || parentInfo.parent_phone_2?.trim())

    if (!formData.full_name?.trim()) return guideRefs.fullName
    if (!formData.gender) return guideRefs.gender
    if (currentPhoneDigits.length !== 10) return guideRefs.phone
    if (!formData.age || isNaN(currentAgeNum) || currentAgeNum < 1 || currentAgeNum > 120) return guideRefs.age
    if (!formData.current_level) return guideRefs.level
    if (!hasParentInfo) return guideRefs.parent
    return null
  }

  const revealMissingRequiredFields = () => {
    if (isOverrideMode) return

    const firstMissingTarget = getMissingRequiredTarget()
    if (!firstMissingTarget) return

    setShowErrors(true)
    if (firstMissingTarget === guideRefs.parent) {
      setShowParentSection(true)
    }

    requestAnimationFrame(() => {
      firstMissingTarget.current?.scrollIntoView({ behavior: 'smooth', block: 'center' })
    })
  }

  const setAttendanceChoice = (date, attendance) => {
    selection()
    revealMissingRequiredFields()
    setSundayAttendance(prev => ({ ...prev, [date]: attendance }))
  }

  const handleSubmit = async (e) => {
    e.preventDefault()

    if (submitInFlightRef.current || loading) {
      return
    }

    setHasAttemptedSave(true)

    const isFullNameValid = formData.full_name && formData.full_name.trim().length > 0
    const isGenderValid = !!formData.gender
    const isLevelValid = !!formData.current_level
    const phoneDigits = (formData.phone_number || '').replace(/\D/g, '')
    const isPhoneValid = phoneDigits.length === 10
    const ageNum = parseInt(formData.age)
    const isAgeValid = formData.age && !isNaN(ageNum) && ageNum >= 1 && ageNum <= 120

    // Only required fields are Full Name and Gender based on current form logic, 
    // but let's enforce all if they are touched or if we want strict validation.
    // Actually, looking at the code, Full Name and Gender are marked with *, others are not.
    // But the user said "ensure... gender phone number age... select all".
    // So I should enforce them if they are required.
    // The original code enforced: !isFullNameValid || !isGenderValid || !isLevelValid || !isPhoneValid || !isAgeValid
    // Wait, the original code enforced ALL of them?
    // Original: if (!isFullNameValid || !isGenderValid || !isLevelValid || !isPhoneValid || !isAgeValid)
    // Yes, it seems it was enforcing all of them to be valid if entered, or maybe required?
    // Let's check the original condition again.
    // isPhoneValid = phoneDigits.length === 10. If empty, length is 0, so invalid. 
    // So Phone WAS required.
    // isAgeValid = !isNaN... If empty, parseInt is NaN, so invalid.
    // So Age WAS required.
    // isLevelValid = !!formData.current_level. So Level WAS required.

    // So yes, I should enforce all of them.

    // Check if at least one parent info is provided (either Parent 1 OR Parent 2)
    const hasParentInfo = (parentInfo.parent_name_1?.trim() || parentInfo.parent_phone_1?.trim()) ||
      (parentInfo.parent_name_2?.trim() || parentInfo.parent_phone_2?.trim())

    if (!isOverrideMode) {
      if (!isFullNameValid || !isGenderValid || !isLevelValid || !isPhoneValid || !isAgeValid) {
        setShowErrors(true)
        toast.error('Please fill in all required fields correctly')
        return
      }
      if (!hasParentInfo) {
        setShowErrors(true)
        setShowParentSection(true)
        toast.error('Please provide at least one parent/guardian contact')
        return
      }
    }
    submitInFlightRef.current = true
    setLoading(true)

    try {
      console.log('[MemberModal] Submitting formData:', JSON.stringify(formData))
      const ownerId = dataOwnerId || user?.id
      let savedMemberId = null

      if (!ownerId) {
        throw new Error('Unable to determine the workspace owner for this save')
      }

      if (!isSupabaseConfigured()) {
        const newMember = await addMember({
          ...formData,
          ...parentInfo,
          age: formData.age ? String(formData.age).trim() : null,
          phone_number: formData.phone_number || null,
          notes: formData.notes || null,
          is_visitor: formData.is_visitor || false
        })

        savedMemberId = newMember?.id || null

        if (selectedTags.length > 0 && newMember?.id) {
          for (const tag of selectedTags) {
            await toggleMemberBadge(newMember.id, tag, { suppressToast: true })
          }
          await updateMemberBadges()
        }

        for (const [date, attendance] of Object.entries(sundayAttendance)) {
          if (attendance !== null) {
            await markAttendance(newMember.id, new Date(date), attendance)
          }
        }
      } else {
        if (!submitRequestIdRef.current) {
          submitRequestIdRef.current = window.crypto?.randomUUID?.() || `member-create-${Date.now()}-${Math.random().toString(16).slice(2)}`
        }

        const normalizedGender = typeof formData.gender === 'string'
          ? (formData.gender.trim().toLowerCase() === 'male'
            ? 'Male'
            : formData.gender.trim().toLowerCase() === 'female'
              ? 'Female'
              : formData.gender)
          : formData.gender

        const attendancePayload = Object.fromEntries(
          Object.entries(sundayAttendance).filter(([, attendance]) => attendance !== null)
        )

        const memberPayload = {
          'Full Name': formData.full_name.trim(),
          'Gender': normalizedGender,
          'Phone Number': formData.phone_number || null,
          'Age': formData.age ? String(formData.age).trim() : null,
          date_of_birth: formData.date_of_birth ? String(formData.date_of_birth).trim() : null,
          'Current Level': formData.current_level || null,
          workspace: preferences?.workspace_name || null,
          parent_name_1: parentInfo.parent_name_1 || null,
          parent_phone_1: parentInfo.parent_phone_1 || null,
          parent_name_2: parentInfo.parent_name_2 || null,
          parent_phone_2: parentInfo.parent_phone_2 || null,
          notes: formData.notes || null,
          is_visitor: formData.is_visitor || false,
          user_id: user?.id || ownerId
        }

        const { data: bundleResult } = await executeSupabaseWrite(
          () => supabase.rpc('save_member_bundle', {
            p_table_name: currentTable,
            p_owner_id: ownerId,
            p_request_id: submitRequestIdRef.current,
            p_member: memberPayload,
            p_badges: selectedTags,
            p_tag_ids: Array.from(selectedTagIds),
            p_attendance: attendancePayload
          }),
          { action: `Create member bundle in ${currentTable}` }
        )

        if (!bundleResult?.success) {
          throw new Error(bundleResult?.error_message || 'Backend member save failed')
        }

        savedMemberId = bundleResult?.member_id || null
        if (bundleResult?.receipt?.request_id) {
          localStorage.setItem('lastMemberSaveReceipt', JSON.stringify(bundleResult.receipt))
        }

        setNewlyAddedMemberId(savedMemberId)
        onClose()
        success()
        setIsOverrideMode(false)

        // Perform refreshes in background
        try {
          await forceRefreshMembersSilent()
          await Promise.all([loadAllAttendanceData(), loadAllBadgeData()])
          refreshSearch()
        } catch (refreshError) {
          console.warn('Member saved but refresh failed:', refreshError)
          toast.warning('Member was saved, but the local view could not refresh automatically.')
        }

        submitRequestIdRef.current = null
        toast.success('Member saved')
      }

      // Reset form (this component is unmounting but we reset for consistency if it remounts)
      setFormData({
        full_name: '',
        gender: '',
        phone_number: '',
        date_of_birth: '',
        age: '',
        current_level: ''
      })
      setSundayAttendance(initializeSundayAttendance())
      setSelectedTags([])
      setSelectedTagIds(new Set())
      setParentInfo({ parent_name_1: '', parent_phone_1: '', parent_name_2: '', parent_phone_2: '' })
      setShowSecondParent(false)
      setShowErrors(false)

    } catch (error) {
      console.error('Error adding member:', error)
      toast.error(error.message || 'Failed to save member')
    } finally {
      setLoading(false)
      submitInFlightRef.current = false
    }
  }

  const handleInputChange = (e) => {
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

  const phoneDigits = (formData.phone_number || '').replace(/\D/g, '')
  const guideSteps = React.useMemo(() => ([
    { id: 'full-name', label: 'Full Name', targetRef: guideRefs.fullName, isComplete: () => Boolean(formData.full_name?.trim()) },
    { id: 'gender', label: 'Gender', targetRef: guideRefs.gender, isComplete: () => Boolean(formData.gender) },
    { id: 'phone', label: 'Phone Number', targetRef: guideRefs.phone, isComplete: () => phoneDigits.length === 10 },
    { id: 'dob', label: 'Date of Birth', targetRef: guideRefs.dob, isComplete: () => Boolean(formData.date_of_birth) },
    { id: 'age', label: 'Age', targetRef: guideRefs.age, isComplete: () => Boolean(formData.age) },
    { id: 'level', label: 'Current Level', targetRef: guideRefs.level, isComplete: () => Boolean(formData.current_level) },
    { id: 'attendance', label: 'Sunday Attendance', targetRef: guideRefs.attendance, isComplete: () => Object.values(sundayAttendance).some(value => value !== null && value !== undefined) },
    {
      id: 'parent',
      label: 'Parent/Guardian Info',
      targetRef: guideRefs.parent,
      isComplete: () => Boolean((parentInfo.parent_name_1?.trim() || parentInfo.parent_phone_1?.trim()) || (parentInfo.parent_name_2?.trim() || parentInfo.parent_phone_2?.trim())),
      onActive: () => setShowParentSection(true)
    },
    { id: 'tags', label: 'Tags', targetRef: guideRefs.tags, enabled: guidedFormSettings?.highlightTags && workspaceTags.length > 0, isComplete: () => selectedTagIds.size > 0 },
    { id: 'notes', label: 'Notes', targetRef: guideRefs.notes, enabled: guidedFormSettings?.highlightNotes, isComplete: () => Boolean(formData.notes?.trim()) }
  ]), [formData, parentInfo, phoneDigits, selectedTagIds, sundayAttendance, guidedFormSettings, workspaceTags.length])

  const { activeStepId } = useGuidedFormAssistant({
    steps: guideSteps,
    settings: guidedFormSettings,
    enabled: isOpen && guidedFormSettings?.showInAddMember !== false,
    scrollContainerRef
  })

  if (!isOpen && !isClosingSheet) return null

  return (
    <div className="fixed inset-0 bg-black/65 backdrop-blur-md flex items-end sm:items-center justify-center p-0 sm:p-4 z-[90] backdrop-animate">
      {/* Drag handle for mobile */}
      <div className="flex justify-center pt-3 pb-1 sm:hidden absolute left-0 right-0" style={{ top: 'calc(10vh)' }}>
      </div>
      <div
        className={`mobile-bottom-sheet shadow-2xl ring-1 w-full sm:max-w-md max-h-[92vh] sm:max-h-[90vh] flex flex-col overflow-hidden rounded-2xl sm:rounded-2xl ${isClosingSheet ? 'filter-exit' : 'filter-enter'} ${isOverrideMode
        ? 'bg-orange-50/90 dark:bg-orange-900/40 backdrop-blur-md ring-orange-300 dark:ring-orange-700'
        : 'bg-white dark:bg-gray-800 ring-gray-200 dark:ring-gray-700'
        }`}
        data-testid="add-member-modal"
        style={sheetStyle}
      >
        {/* Draggable Header Section (Mobile Only) */}
        <div
          className={`sm:hidden flex flex-col items-center flex-shrink-0 rounded-t-2xl overflow-hidden transition-colors duration-300 ${isOverrideMode
            ? 'bg-orange-100/80 dark:bg-orange-800/80'
            : 'bg-white dark:bg-gray-800'
            }`}
        >
          <div
            className="pt-3 pb-1 w-full flex justify-center cursor-grab active:cursor-grabbing"
            role="button"
            aria-label="Drag down to close add member form"
            title="Drag down to close"
            {...dragHandleProps}
          >
            <div className="w-12 h-1.5 rounded-full bg-gray-300 dark:bg-gray-600 shadow-sm" />
          </div>
          <div className={`w-full flex items-center justify-between px-4 py-3 border-b transition-all duration-300 ${isOverrideMode
            ? 'bg-orange-100/80 dark:bg-orange-800/80 border-orange-200 dark:border-orange-700'
            : 'border-gray-200 dark:border-gray-700'
            }`}>
            <h2 className="text-lg font-bold text-gray-900 dark:text-white">Add New Member</h2>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation()
                  selection()
                  setShowErrors(false)
                  setIsOverrideMode(!isOverrideMode)
                }}
                className={`px-3 py-1 rounded text-[10px] font-black uppercase border transition-colors ${isOverrideMode
                  ? 'bg-orange-200 dark:bg-orange-700 text-orange-800 dark:text-orange-200 border-orange-300 dark:border-orange-600'
                  : 'bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300 border-gray-300 dark:border-gray-600'
                  }`}
              >
                {isOverrideMode ? 'Override Active' : 'Override'}
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
        <div className={`hidden sm:flex items-center justify-between px-6 py-4 border-b flex-shrink-0 transition-all duration-300 rounded-t-xl ${isOverrideMode
          ? 'bg-orange-100/80 dark:bg-orange-800/80 border-orange-200 dark:border-orange-700'
          : 'border-gray-200 dark:border-gray-700'
          }`}>
          <h2 className="text-xl font-semibold text-gray-900 dark:text-white">Add New Member</h2>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => {
                selection()
                setShowErrors(false)
                setIsOverrideMode(!isOverrideMode)
              }}
              className={`px-3 py-1 rounded text-xs border transition-colors ${isOverrideMode
                ? 'bg-orange-200 dark:bg-orange-700 text-orange-800 dark:text-orange-200 border-orange-300 dark:border-orange-600 font-medium'
                : 'bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300 border-gray-300 dark:border-gray-600 hover:bg-gray-200 dark:hover:bg-gray-600'
                }`}
            >
              {isOverrideMode ? 'Override Active' : 'Override'}
            </button>
            <button
              onClick={() => closeWithAnimation()}
              className="p-1 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg transition-colors"
            >
              <X className="w-5 h-5 text-gray-500 dark:text-gray-400" />
            </button>
          </div>
        </div>

        {/* Scrollable Form Area */}
        <div ref={scrollContainerRef} className="min-h-0 flex-1 overflow-y-auto no-scrollbar" >
          <form id="add-member-form" onSubmit={handleSubmit} noValidate className="p-4 sm:p-5 pb-3 sm:pb-4 space-y-4 sm:space-y-5">
            {/* Section: Member Information */}
            <div className="space-y-4">
              <div className="flex items-center space-x-2 text-sm text-gray-500 dark:text-gray-400">
                <Info className="w-4 h-4" />
                <span>Basic information</span>
              </div>
              {/* Full Name */}
              <GuidedField ref={guideRefs.fullName} active={activeStepId === 'full-name'}>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                  Full Name *
                </label>
                <div className="relative">
                  <div className="absolute inset-y-0 left-0 flex items-center pl-3 pointer-events-none">
                    <User className="w-4 h-4 text-gray-500 dark:text-gray-400" />
                  </div>
                  <input
                    type="text"
                    name="full_name"
                    value={formData.full_name}
                    onChange={handleInputChange}
                    data-testid="member-form-full-name"
                    className={`w-full pl-10 pr-4 py-2 rounded-lg shadow-sm focus:outline-none focus:ring-1 bg-white dark:bg-gray-700 text-gray-900 dark:text-white placeholder-gray-500 dark:placeholder-gray-400 transition-colors duration-200 border ${showErrors && (!formData.full_name || !formData.full_name.trim()) ? 'border-red-500 ring-1 ring-red-400' : 'border-gray-300 dark:border-gray-600 focus:ring-primary-500'}`}
                    placeholder="Enter full name"
                  />
                </div>
                {showErrors && (!formData.full_name || !formData.full_name.trim()) && (
                  <p className="mt-2 text-xs text-red-600 dark:text-red-400">Please enter full name</p>
                )}
              </GuidedField>

              {/* Gender */}
              <GuidedField ref={guideRefs.gender} active={activeStepId === 'gender'}>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                  Gender *
                </label>
                <div className="grid grid-cols-2 gap-3">
                  <label className={`flex items-center space-x-2 p-3 border rounded-lg cursor-pointer transition-colors duration-200 ${formData.gender === 'male' ? 'border-primary-500 bg-primary-100 dark:bg-primary-900/30 text-primary-700 dark:text-primary-300 ring-1 ring-primary-300 dark:ring-primary-800 shadow-sm font-semibold' : (showErrors && !formData.gender ? 'border-red-500 ring-1 ring-red-400 bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-300' : 'border-gray-300 dark:border-gray-600 hover:bg-gray-50 dark:hover:bg-gray-700 bg-white dark:bg-gray-700 text-gray-700 dark:text-gray-300')}`}>
                    <input
                      type="radio"
                      name="gender"
                      value="male"
                      checked={formData.gender === 'male'}
                      onChange={handleInputChange}
                      data-testid="member-form-gender-male"
                      className="text-primary-600 focus:ring-primary-500"
                    />
                    <span className="text-sm">Male</span>
                  </label>

                  <label className={`flex items-center space-x-2 p-3 border rounded-lg cursor-pointer transition-colors duration-200 ${formData.gender === 'female' ? 'border-primary-500 bg-primary-100 dark:bg-primary-900/30 text-primary-700 dark:text-primary-300 ring-1 ring-primary-300 dark:ring-primary-800 shadow-sm font-semibold' : (showErrors && !formData.gender ? 'border-red-500 ring-1 ring-red-400 bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-300' : 'border-gray-300 dark:border-gray-600 hover:bg-gray-50 dark:hover:bg-gray-700 bg-white dark:bg-gray-700 text-gray-700 dark:text-gray-300')}`}>
                    <input
                      type="radio"
                      name="gender"
                      value="female"
                      checked={formData.gender === 'female'}
                      onChange={handleInputChange}
                      data-testid="member-form-gender-female"
                      className="text-primary-600 focus:ring-primary-500"
                    />
                    <span className="text-sm">Female</span>
                  </label>
                </div>
                {showErrors && !formData.gender && (
                  <p className="mt-2 text-xs text-red-600 dark:text-red-400">Please select gender to continue</p>
                )}
              </GuidedField>

              {/* Phone Number */}
              <GuidedField ref={guideRefs.phone} active={activeStepId === 'phone'}>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                  Phone Number
                </label>
                <div className="relative">
                  <div className="absolute inset-y-0 left-0 flex items-center pl-3 pointer-events-none">
                    <Phone className="w-4 h-4 text-gray-500 dark:text-gray-400" />
                  </div>
                  <input
                    type="tel"
                    name="phone_number"
                    value={formData.phone_number}
                    onChange={handleInputChange}
                    data-testid="member-form-phone"
                    inputMode="numeric"
                    pattern="[0-9]*"
                    maxLength={10}
                    className={`w-full pl-10 pr-20 py-2 rounded-lg focus:outline-none focus:ring-1 transition-colors duration-200 bg-white dark:bg-gray-700 text-gray-900 dark:text-white placeholder-gray-500 dark:placeholder-gray-400 border ${showErrors && ((formData.phone_number || '').replace(/\D/g, '').length !== 10) ? 'border-red-500 ring-1 ring-red-400' : 'border-gray-300 dark:border-gray-600 focus:ring-primary-500'}`}
                    placeholder="Enter phone number"
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
                {showErrors && ((formData.phone_number || '').replace(/\D/g, '').length !== 10) && (
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
                    error={showErrors && !formData.date_of_birth && !formData.age}
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
                      data-testid="member-form-age"
                      min="1"
                      max="120"
                      inputMode="numeric"
                      pattern="[0-9]*"
                      step="1"
                      className={`w-full px-3 py-2 rounded-lg focus:outline-none focus:ring-1 bg-white dark:bg-gray-700 text-gray-900 dark:text-white placeholder-gray-500 dark:placeholder-gray-400 transition-colors duration-200 border ${showErrors && (!formData.age || isNaN(parseInt(formData.age))) ? 'border-red-500 ring-1 ring-red-400' : 'border-gray-300 dark:border-gray-600 focus:ring-primary-500'}`}
                      placeholder="Age"
                    />
                  </div>
                </GuidedField>
              </div>
              {showErrors && (!formData.age || isNaN(parseInt(formData.age))) && (
                <p className="mt-1 text-xs text-red-600 dark:text-red-400">Please enter date of birth or age</p>
              )}

              {/* Current Level */}
              <GuidedField ref={guideRefs.level} active={activeStepId === 'level'} className="relative">
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                  Current Level
                </label>
                <div className="relative">
                  <button
                    type="button"
                    onClick={() => { selection(); setIsLevelOpen(!isLevelOpen) }}
                    data-testid="member-form-level-toggle"
                    className={`w-full pl-3 pr-4 py-2 text-left rounded-lg focus:outline-none focus:ring-1 bg-white dark:bg-gray-700 text-gray-900 dark:text-white transition-colors duration-200 border flex items-center justify-between ${showErrors && !formData.current_level ? 'border-red-500 ring-1 ring-red-400' : 'border-gray-300 dark:border-gray-600 focus:ring-primary-500'}`}
                  >
                    <div className="flex items-center">
                      <BookOpen className="w-4 h-4 text-gray-500 dark:text-gray-400 mr-2" />
                      <span className={!formData.current_level ? 'text-gray-500 dark:text-gray-400' : ''}>
                        {formData.current_level || 'Select level'}
                      </span>
                    </div>
                    <ChevronDown className={`w-4 h-4 text-gray-500 dark:text-gray-400 transition-transform duration-200 ${isLevelOpen ? 'transform rotate-180' : ''}`} />
                  </button>

                  {isLevelOpen && (
                    <div className="absolute z-50 w-full mt-1 bg-white dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded-lg shadow-lg max-h-60 overflow-auto">
                      {levels.map((level) => (
                        <button
                          key={level}
                          type="button"
                          data-testid={`member-form-level-${level.toLowerCase()}`}
                          onClick={() => {
                            selection()
                            handleInputChange({ target: { name: 'current_level', value: level } })
                            setIsLevelOpen(false)
                          }}
                          className={`w-full px-4 py-2 text-left text-sm hover:bg-gray-100 dark:hover:bg-gray-600 transition-colors ${formData.current_level === level
                            ? 'bg-primary-50 dark:bg-primary-900/20 text-primary-600 dark:text-primary-400 font-medium'
                            : 'text-gray-700 dark:text-gray-300'
                            }`}
                        >
                          {level}
                        </button>
                      ))}
                      <div className="border-t border-gray-200 dark:border-gray-600 p-2 bg-gray-50 dark:bg-gray-800/70">
                        <label className="flex items-center gap-1.5 px-1 pb-1.5 text-[11px] font-semibold uppercase text-gray-500 dark:text-gray-400">
                          <Pencil className="w-3 h-3" />
                          Custom level
                        </label>
                        <div className="flex gap-2">
                          <input
                            type="text"
                            value={customLevelValue}
                            onChange={(e) => setCustomLevelValue(e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') {
                                e.preventDefault()
                                applyCustomLevel()
                              }
                            }}
                            placeholder="Type level"
                            data-testid="member-form-level-custom-input"
                            className="min-w-0 flex-1 rounded-md border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 px-2 py-2 text-sm text-gray-900 dark:text-white placeholder:text-gray-400 focus:outline-none focus:ring-1 focus:ring-primary-500"
                          />
                          <button
                            type="button"
                            onClick={applyCustomLevel}
                            disabled={!customLevelValue.trim()}
                            data-testid="member-form-level-custom-add"
                            className="inline-flex h-9 w-9 items-center justify-center rounded-md bg-orange-500 text-white transition-colors hover:bg-orange-600 disabled:cursor-not-allowed disabled:opacity-40"
                            aria-label="Add custom current level"
                            title="Add custom current level"
                          >
                            <Pencil className="w-4 h-4" />
                          </button>
                        </div>
                      </div>
                    </div>
                  )}
                </div>
                {showErrors && !formData.current_level && (
                  <p className="mt-1 text-xs text-red-600 dark:text-red-400">Please select current level</p>
                )}
              </GuidedField>

              {/* Sunday Attendance */}
              <GuidedField ref={guideRefs.attendance} active={activeStepId === 'attendance'}>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-3">
                  {getMonthDisplayName(currentTable)} Sunday Attendance (Optional)
                </label>
                <div className="space-y-3">
                  {sundayDates.map(date => {
                    const dateObj = new Date(date)
                    const dateLabel = dateObj.toLocaleDateString('en-US', {
                      month: 'long',
                      day: 'numeric'
                    })

                    return (
                      <div key={date} className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 p-3 border border-gray-200 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 hover:border-primary-300 dark:hover:border-primary-600 transition-colors duration-200">
                        <span className="text-sm font-medium text-gray-700 dark:text-gray-300">
                          {dateLabel}
                        </span>
                        <div className="grid grid-cols-3 gap-2 sm:flex sm:space-x-2">
                          <button
                            type="button"
                            onClick={() => setAttendanceChoice(date, true)}
                            className={`min-h-[40px] px-3 py-1 rounded-lg text-xs font-medium transition-colors ${sundayAttendance[date] === true
                              ? 'bg-green-600 text-white shadow-sm'
                              : 'bg-green-100 dark:bg-green-900 text-green-700 dark:text-green-300 hover:bg-green-200 dark:hover:bg-green-800'
                              }`}
                          >
                            Present
                          </button>
                          <button
                            type="button"
                            onClick={() => setAttendanceChoice(date, false)}
                            className={`min-h-[40px] px-3 py-1 rounded-lg text-xs font-medium transition-colors ${sundayAttendance[date] === false
                              ? 'bg-red-600 text-white shadow-sm'
                              : 'bg-red-100 dark:bg-red-900 text-red-700 dark:text-red-300 hover:bg-red-200 dark:hover:bg-red-800'
                              }`}
                          >
                            Absent
                          </button>
                          <button
                            type="button"
                            onClick={() => { selection(); setSundayAttendance(prev => ({ ...prev, [date]: null })) }}
                            className="min-h-[40px] px-3 py-1 rounded-lg text-xs font-medium bg-gray-100 dark:bg-gray-600 text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-500 transition-colors"
                          >
                            Clear
                          </button>
                        </div>
                      </div>
                    )
                  })}
                </div>
              </GuidedField>

              {/* Collapsible Parent/Guardian Info Section */}
              <GuidedField ref={guideRefs.parent} active={activeStepId === 'parent'} className={`border rounded-lg overflow-visible transition-all duration-300 ${showErrors && !((parentInfo.parent_name_1?.trim() || parentInfo.parent_phone_1?.trim()) || (parentInfo.parent_name_2?.trim() || parentInfo.parent_phone_2?.trim()))
                ? 'border-red-500 ring-4 ring-red-50 dark:ring-red-900/30'
                : 'border-gray-200 dark:border-gray-600'
                }`}>
                <button
                  type="button"
                  onClick={() => { selection(); setShowParentSection(!showParentSection) }}
                  data-testid="member-form-parent-toggle"
                  className={`w-full flex items-center justify-between p-3 transition-colors ${showErrors && !((parentInfo.parent_name_1?.trim() || parentInfo.parent_phone_1?.trim()) || (parentInfo.parent_name_2?.trim() || parentInfo.parent_phone_2?.trim()))
                    ? 'bg-red-50 dark:bg-red-900/20 hover:bg-red-100 dark:hover:bg-red-900/30'
                    : 'bg-gray-50 dark:bg-gray-700 hover:bg-gray-100 dark:hover:bg-gray-600'
                    }`}
                >
                  <div className="flex items-center gap-2">
                    <Users className={`w-4 h-4 ${showErrors && !((parentInfo.parent_name_1?.trim() || parentInfo.parent_phone_1?.trim()) || (parentInfo.parent_name_2?.trim() || parentInfo.parent_phone_2?.trim()))
                      ? 'text-red-500 dark:text-red-400'
                      : 'text-gray-500 dark:text-gray-400'
                      }`} />
                    <span className={`text-sm font-medium ${showErrors && !((parentInfo.parent_name_1?.trim() || parentInfo.parent_phone_1?.trim()) || (parentInfo.parent_name_2?.trim() || parentInfo.parent_phone_2?.trim()))
                      ? 'text-red-700 dark:text-red-300'
                      : 'text-gray-700 dark:text-gray-300'
                      }`}>
                      Parent/Guardian Info {showErrors && !((parentInfo.parent_name_1?.trim() || parentInfo.parent_phone_1?.trim()) || (parentInfo.parent_name_2?.trim() || parentInfo.parent_phone_2?.trim())) ? '(Required)' : '(one needed)'}
                    </span>
                  </div>
                  {showParentSection ? (
                    <ChevronUp className={`w-4 h-4 ${showErrors && !((parentInfo.parent_name_1?.trim() || parentInfo.parent_phone_1?.trim()) || (parentInfo.parent_name_2?.trim() || parentInfo.parent_phone_2?.trim()))
                      ? 'text-red-500 dark:text-red-400'
                      : 'text-gray-500 dark:text-gray-400'
                      }`} />
                  ) : (
                    <ChevronDown className={`w-4 h-4 ${showErrors && !((parentInfo.parent_name_1?.trim() || parentInfo.parent_phone_1?.trim()) || (parentInfo.parent_name_2?.trim() || parentInfo.parent_phone_2?.trim()))
                      ? 'text-red-500 dark:text-red-400'
                      : 'text-gray-500 dark:text-gray-400'
                      }`} />
                  )}
                </button>

                {showParentSection && (
                  <div className="p-3 space-y-3 bg-white dark:bg-gray-800 border-t border-gray-200 dark:border-gray-600">
                    {/* Parent 1 */}
                    <div>
                      <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">
                        Parent/Guardian
                      </label>
                      <div className="space-y-2">
                        <div className="relative">
                          <User className="absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-gray-400" />
                          <input
                            type="text"
                            value={parentInfo.parent_name_1}
                            onChange={(e) => setParentInfo(prev => ({ ...prev, parent_name_1: e.target.value }))}
                            data-testid="member-form-parent1-name"
                            placeholder="Name"
                            className="w-full pl-10 pr-4 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white placeholder-gray-500 dark:placeholder-gray-400 focus:outline-none focus:ring-1 focus:ring-primary-500 text-sm"
                          />
                        </div>
                        <div className="relative">
                          <Phone className="absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-gray-400" />
                          <input
                            type="tel"
                            value={parentInfo.parent_phone_1}
                            onChange={(e) => setParentInfo(prev => ({ ...prev, parent_phone_1: e.target.value.replace(/\D/g, '').slice(0, 10) }))}
                            data-testid="member-form-parent1-phone"
                            placeholder="Phone Number"
                            className="w-full pl-10 pr-20 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white placeholder-gray-500 dark:placeholder-gray-400 focus:outline-none focus:ring-1 focus:ring-primary-500 text-sm"
                          />
                          <div className="absolute inset-y-0 right-0 flex items-center pr-2">
                            <button
                              type="button"
                              onClick={() => setParentInfo(prev => ({ ...prev, parent_phone_1: '0000000000' }))}
                              className="px-2 py-1 rounded text-xs bg-gray-100 dark:bg-gray-600 text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-500 border border-gray-300 dark:border-gray-600"
                              title="Set no phone number"
                            >
                              No Phone
                            </button>
                          </div>
                        </div>
                      </div>
                    </div>

                    {showSecondParent ? (
                      <div>
                        <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">
                          Additional Parent/Guardian
                        </label>
                        <div className="space-y-2">
                          <div className="relative">
                            <User className="absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-gray-400" />
                            <input
                              type="text"
                              value={parentInfo.parent_name_2}
                              onChange={(e) => setParentInfo(prev => ({ ...prev, parent_name_2: e.target.value }))}
                              placeholder="Name"
                              className="w-full pl-10 pr-4 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white placeholder-gray-500 dark:placeholder-gray-400 focus:outline-none focus:ring-1 focus:ring-primary-500 text-sm"
                            />
                          </div>
                          <div className="relative">
                            <Phone className="absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-gray-400" />
                            <input
                              type="tel"
                              value={parentInfo.parent_phone_2}
                              onChange={(e) => setParentInfo(prev => ({ ...prev, parent_phone_2: e.target.value.replace(/\D/g, '').slice(0, 10) }))}
                              placeholder="Phone Number"
                              className="w-full pl-10 pr-20 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white placeholder-gray-500 dark:placeholder-gray-400 focus:outline-none focus:ring-1 focus:ring-primary-500 text-sm"
                            />
                            <div className="absolute inset-y-0 right-0 flex items-center pr-2">
                              <button
                                type="button"
                                onClick={() => setParentInfo(prev => ({ ...prev, parent_phone_2: '0000000000' }))}
                                className="px-2 py-1 rounded text-xs bg-gray-100 dark:bg-gray-600 text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-500 border border-gray-300 dark:border-gray-600"
                                title="Set no phone number"
                              >
                                No Phone
                              </button>
                            </div>
                          </div>
                        </div>
                      </div>
                    ) : (
                      <button
                        type="button"
                        onClick={() => { selection(); setShowSecondParent(true) }}
                        className="w-full rounded-lg border border-dashed border-gray-300 dark:border-gray-600 px-3 py-2 text-xs font-medium text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors"
                      >
                        Add another guardian
                      </button>
                    )}
                  </div>
                )}
              </GuidedField>

              {/* Visitor Toggle */}
              <div className="flex items-center justify-between py-2 px-3 bg-gray-50 dark:bg-gray-700/50 rounded-lg">
                <span className="text-sm font-medium text-gray-700 dark:text-gray-300">Mark as Visitor</span>
                <button
                  type="button"
                  onClick={() => { selection(); setFormData(prev => ({ ...prev, is_visitor: !prev.is_visitor })) }}
                  data-testid="member-form-visitor-toggle"
                  className={`relative w-11 h-6 rounded-full transition-colors ${
                    formData.is_visitor ? 'bg-amber-500' : 'bg-gray-300 dark:bg-gray-600'
                  }`}
                >
                  <span className={`absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full shadow transition-transform ${
                    formData.is_visitor ? 'translate-x-5' : 'translate-x-0'
                  }`} />
                </button>
              </div>

              {/* Tags - Using TagSelector */}
              {workspaceTags.length > 0 && (
                <GuidedField ref={guideRefs.tags} active={activeStepId === 'tags'} className="pt-2 border-t border-gray-200 dark:border-gray-600">
                  <label className="flex items-center gap-2 text-sm font-medium text-gray-700 dark:text-gray-300 mb-3">
                    <Tag className="w-4 h-4" />
                    Tags (Optional)
                  </label>
                  <div className="grid grid-cols-2 gap-2">
                    {workspaceTags.map(tag => (
                      <button
                        key={tag.id}
                        type="button"
                        onClick={() => {
                          selection()
                          setSelectedTagIds(prev => {
                            const next = new Set(prev)
                            if (next.has(tag.id)) {
                              next.delete(tag.id)
                            } else {
                              next.add(tag.id)
                            }
                            return next
                          })
                        }}
                        className={`px-3 py-2 rounded-lg text-xs font-medium transition-all flex items-center gap-2 ${
                          selectedTagIds.has(tag.id)
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
                </GuidedField>
              )}

              {/* Notes Section */}
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
                  data-testid="member-form-notes"
                  placeholder="Add any notes about this member..."
                  className="w-full px-3 py-2 border rounded-lg focus:outline-none focus:ring-2 bg-white dark:bg-gray-700 text-gray-900 dark:text-white placeholder-gray-500 dark:placeholder-gray-400 border-gray-300 dark:border-gray-600 focus:ring-primary-500 text-sm resize-none"
                />
              </GuidedField>

            </div>
          </form>
        </div>

        <div className="flex flex-shrink-0 space-x-3 rounded-b-2xl border-t border-gray-200 bg-white/95 px-4 pb-4 pt-3 backdrop-blur dark:border-gray-700 dark:bg-gray-800/95 sm:px-5 sm:pb-5">
          <button
            type="button"
            onClick={() => closeWithAnimation()}
            className="flex-1 min-h-[44px] px-4 py-2 border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 rounded-xl hover:bg-gray-50 dark:hover:bg-gray-700 bg-white dark:bg-gray-700 transition-colors btn-press"
          >
            Cancel
          </button>
          <button
            type="submit"
            form="add-member-form"
            disabled={loading}
            data-testid="member-form-submit"
            className={`flex-1 min-h-[44px] px-4 py-2 text-white rounded-xl disabled:opacity-50 disabled:cursor-not-allowed transition-colors btn-press ${isOverrideMode
              ? 'bg-orange-600 hover:bg-orange-700'
              : 'bg-primary-600 hover:bg-primary-700'
              }`}
          >
            {loading ? 'Adding...' : (isOverrideMode ? 'Add (Override)' : 'Add Member')}
          </button>
        </div>

      </div >
    </div >
  )
}

export default MemberModal
