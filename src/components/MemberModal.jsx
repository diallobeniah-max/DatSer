import React, { useState } from 'react'
import { useApp } from '../context/AppContext'
import { useTheme } from '../context/ThemeContext'
import { useAuth } from '../context/AuthContext'
import { X, User, Phone, Calendar, BookOpen, ChevronDown, ChevronUp, Info, Users, StickyNote } from 'lucide-react'
import { toast } from 'react-toastify'
import useHapticFeedback from '../hooks/useHapticFeedback'
import { supabase } from '../lib/supabase'
import DatePicker from './DatePicker'

const normalizeMinistryList = (items) => {
  if (!Array.isArray(items)) return []
  const seen = new Set()
  const normalized = []
  for (const item of items) {
    const value = String(item || '').replace(/\s+/g, ' ').trim()
    if (!value) continue
    const key = value.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    normalized.push(value)
  }
  return normalized
}

const MemberModal = ({ isOpen, onClose }) => {
  const { addMember, markAttendance, currentTable, toggleMemberBadge, updateMemberBadges, updateMember, isCollaborator, dataOwnerId, isSupabaseConfigured } = useApp()
  const { user } = useAuth()
  const { isDarkMode } = useTheme()
  const { selection, success } = useHapticFeedback()

  // Helper function to get month display name from table name
  const getMonthDisplayName = (tableName) => {
    // Convert table name like "October_2025" to "October 2025"
    return tableName.replace('_', ' ')
  }
  const [loading, setLoading] = useState(false)
  const [showErrors, setShowErrors] = useState(false)
  const [showParentErrors, setShowParentErrors] = useState(false)
  const [isLevelOpen, setIsLevelOpen] = useState(false)
  const [newlyAddedMemberId, setNewlyAddedMemberId] = useState(null)
  const [formData, setFormData] = useState({
    full_name: '',
    gender: '',
    phone_number: '',
    date_of_birth: '',
    age: '',
    current_level: '',
    notes: '',
    ministry: [],
    is_visitor: false
  })

  // Available ministries - load from localStorage or use defaults
  const defaultMinistries = ['Choir', 'Ushers', 'Youth', 'Children', 'Media', 'Welfare', 'Protocol', 'Evangelism']
  const workspaceOwnerId = isCollaborator ? dataOwnerId : user?.id
  const ministryStorageKey = workspaceOwnerId ? `customMinistries_${workspaceOwnerId}` : 'customMinistries'
  const preferenceUserId = workspaceOwnerId
  const [ministries, setMinistries] = React.useState(() => {
    try {
      const saved = localStorage.getItem(ministryStorageKey) || localStorage.getItem('customMinistries')
      if (!saved) return defaultMinistries
      return normalizeMinistryList(JSON.parse(saved))
    } catch {
      return defaultMinistries
    }
  })

  // Listen for ministry updates from Admin Panel
  React.useEffect(() => {
    const handleMinistriesUpdate = (e) => {
      if (Array.isArray(e.detail)) {
        setMinistries(e.detail)
        return
      }
      if (Array.isArray(e.detail?.ministries)) {
        if (!e.detail.ownerId || !workspaceOwnerId || e.detail.ownerId === workspaceOwnerId) {
          setMinistries(e.detail.ministries)
        }
      }
    }
    window.addEventListener('ministriesUpdated', handleMinistriesUpdate)
    return () => window.removeEventListener('ministriesUpdated', handleMinistriesUpdate)
  }, [workspaceOwnerId])

  React.useEffect(() => {
    if (!workspaceOwnerId) return
    const saved = localStorage.getItem(ministryStorageKey) || localStorage.getItem('customMinistries')
    if (saved) {
      try {
        setMinistries(normalizeMinistryList(JSON.parse(saved)))
      } catch {
      }
    }
  }, [workspaceOwnerId, ministryStorageKey])

  React.useEffect(() => {
    if (!isSupabaseConfigured() || !preferenceUserId) return
    let active = true
    const hasLocalScopedMinistries = !!localStorage.getItem(ministryStorageKey)
    const fetchMinistries = async () => {
      if (hasLocalScopedMinistries) return
      try {
        const { data, error } = await supabase
          .from('user_preferences')
          .select('ministry_groups')
          .eq('user_id', preferenceUserId)
          .maybeSingle()
        if (error) throw error
        if (!active) return
        if (Array.isArray(data?.ministry_groups)) {
          const normalized = normalizeMinistryList(data.ministry_groups)
          const next = normalized
          setMinistries(next)
          localStorage.setItem(ministryStorageKey, JSON.stringify(next))
          localStorage.setItem('customMinistries', JSON.stringify(next))
        }
      } catch (error) {
        console.warn('Could not load shared ministries:', error)
      }
    }
    fetchMinistries()

    const channel = supabase
      .channel(`member-modal-ministries:${preferenceUserId}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'user_preferences',
          filter: `user_id=eq.${preferenceUserId}`
        },
        (payload) => {
          if (!Array.isArray(payload?.new?.ministry_groups)) return
          const normalized = normalizeMinistryList(payload.new.ministry_groups)
          const next = normalized
          setMinistries(next)
          localStorage.setItem(ministryStorageKey, JSON.stringify(next))
          localStorage.setItem('customMinistries', JSON.stringify(next))
        }
      )
      .subscribe()

    return () => {
      active = false
      supabase.removeChannel(channel)
    }
  }, [preferenceUserId, ministryStorageKey, isSupabaseConfigured])

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
  const [showParentInfo, setShowParentInfo] = useState(false)
  const [showParentSection, setShowParentSection] = useState(false)
  const [parentInfo, setParentInfo] = useState({
    parent_name_1: '',
    parent_phone_1: '',
    parent_name_2: '',
    parent_phone_2: ''
  })

  // Reset attendance state when modal opens (but not while it stays open) or current table changes
  React.useEffect(() => {
    if (isOpen && !previousIsOpen) {
      // Modal just opened, reset attendance
      setSundayAttendance(initializeSundayAttendance())
    }
    setPreviousIsOpen(isOpen)
  }, [isOpen, currentTable])

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

  const handleSubmit = async (e) => {
    e.preventDefault()
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
    setLoading(true)

    try {
      const newMember = await addMember({
        ...formData,
        ...parentInfo,
        age: formData.age ? String(formData.age).trim() : null,
        phone_number: formData.phone_number || null,
        notes: formData.notes || null,
        ministry: formData.ministry?.length > 0 ? formData.ministry : null,
        is_visitor: formData.is_visitor || false
      })

      // Assign selected tags (Member / Regular / Newcomer)
      if (selectedTags.length > 0 && newMember?.id) {
        for (const tag of selectedTags) {
          try {
            await toggleMemberBadge(newMember.id, tag, { suppressToast: true })
          } catch (badgeError) {
            console.error(`Error assigning ${tag} badge:`, badgeError)
          }
        }
        try {
          await updateMemberBadges()
        } catch (updateError) {
          console.warn('Badge update recalculation failed:', updateError)
        }
      }

      // Mark attendance for selected Sunday dates
      for (const [date, attendance] of Object.entries(sundayAttendance)) {
        if (attendance !== null) {
          try {
            await markAttendance(newMember.id, new Date(date), attendance)
          } catch (attendanceError) {
            console.error(`Error marking attendance for ${date}:`, attendanceError)
          }
        }
      }

      // Reset form and open Parent Info popup to complete mandatory details
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
      setParentInfo({ parent_name_1: '', parent_phone_1: '', parent_name_2: '', parent_phone_2: '' })
      setShowErrors(false)
      setNewlyAddedMemberId(newMember.id)
      setShowErrors(false)
      setNewlyAddedMemberId(newMember.id)
      onClose()
      setIsOverrideMode(false)
      success()

      // Success toast handled in global state
    } catch (error) {
      console.error('Error adding member:', error)
      // Error toast handled in global state
    } finally {
      setLoading(false)
    }
  }

  const handleInputChange = (e) => {
    const { name, value } = e.target
    
    if (name === 'date_of_birth') {
      // Calculate age automatically
      if (value) {
        const dob = new Date(value)
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

  if (!isOpen) return null

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-md flex items-center justify-center p-0 sm:p-4 z-[60] backdrop-animate">
      <div className={`shadow-2xl ring-1 max-w-md w-[96%] sm:w-full mx-auto max-h-[90vh] flex flex-col transition-all duration-300 animate-scale-in ${isOverrideMode
        ? 'bg-orange-50/90 dark:bg-orange-900/40 backdrop-blur-md ring-orange-300 dark:ring-orange-700 rounded-3xl'
        : 'bg-white dark:bg-gray-800 ring-gray-200 dark:ring-gray-700 rounded-xl'
        }`}> 
        {/* Header */}
        <div className={`flex items-center justify-between p-6 border-b flex-shrink-0 transition-all duration-300 ${isOverrideMode
          ? 'bg-orange-100/80 dark:bg-orange-800/80 border-orange-200 dark:border-orange-700 rounded-t-3xl'
          : 'border-gray-200 dark:border-gray-700 rounded-t-xl'
          }`}>
          <h2 className="text-xl font-semibold text-gray-900 dark:text-white">Add New Member</h2>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => { selection(); setIsOverrideMode(!isOverrideMode) }}
              className={`px-3 py-1 rounded text-xs border transition-colors ${isOverrideMode
                ? 'bg-orange-200 dark:bg-orange-700 text-orange-800 dark:text-orange-200 border-orange-300 dark:border-orange-600 font-medium'
                : 'bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300 border-gray-300 dark:border-gray-600 hover:bg-gray-200 dark:hover:bg-gray-600'
                }`}
              title="Toggle Override Mode (Bypass Validation)"
            >
              {isOverrideMode ? 'Override Active' : 'Override'}
            </button>
            <button
              onClick={() => { selection(); onClose() }}
              className="p-1 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg transition-colors"
            >
              <X className="w-5 h-5 text-gray-500 dark:text-gray-400" />
            </button>
          </div>
        </div>

        {/* Scrollable Form Area */}
        < div className="overflow-y-auto no-scrollbar" >
          <form onSubmit={handleSubmit} noValidate className="p-6 space-y-6">
            {/* Section: Member Information */}
            <div className="space-y-4">
              <div className="flex items-center space-x-2 text-sm text-gray-500 dark:text-gray-400">
                <Info className="w-4 h-4" />
                <span>Basic information</span>
              </div>
              {/* Full Name */}
              <div>
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
                    className={`w-full pl-10 pr-4 py-2 rounded-lg shadow-sm focus:outline-none focus:ring-1 bg-white dark:bg-gray-700 text-gray-900 dark:text-white placeholder-gray-500 dark:placeholder-gray-400 transition-colors duration-200 border ${showErrors && (!formData.full_name || !formData.full_name.trim()) ? 'border-red-500 ring-1 ring-red-400' : 'border-gray-300 dark:border-gray-600 focus:ring-primary-500'}`}
                    placeholder="Enter full name"
                  />
                </div>
                {showErrors && (!formData.full_name || !formData.full_name.trim()) && (
                  <p className="mt-2 text-xs text-red-600 dark:text-red-400">Please enter full name</p>
                )}
              </div>

              {/* Gender */}
              <div>
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
                      className="text-primary-600 focus:ring-primary-500"
                    />
                    <span className="text-sm">Female</span>
                  </label>
                </div>
                {showErrors && !formData.gender && (
                  <p className="mt-2 text-xs text-red-600 dark:text-red-400">Please select gender to continue</p>
                )}
              </div>

              {/* Phone Number */}
              <div>
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
              </div>

              {/* Date of Birth and Age */}
              <div className="grid grid-cols-2 gap-3">
                {/* Date of Birth */}
                <div>
                  <DatePicker
                    name="date_of_birth"
                    label="Date of Birth"
                    value={formData.date_of_birth}
                    onChange={handleInputChange}
                    placeholder="Select date"
                    error={showErrors && !formData.date_of_birth && !formData.age}
                  />
                </div>

                {/* Age */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                    Age
                  </label>
                  <div className="relative">
                    <input
                      type="number"
                      name="age"
                      value={formData.age}
                      onChange={handleInputChange}
                      min="1"
                      max="120"
                      inputMode="numeric"
                      pattern="[0-9]*"
                      step="1"
                      className={`w-full px-3 py-2 rounded-lg focus:outline-none focus:ring-1 bg-white dark:bg-gray-700 text-gray-900 dark:text-white placeholder-gray-500 dark:placeholder-gray-400 transition-colors duration-200 border ${showErrors && (!formData.age || isNaN(parseInt(formData.age))) ? 'border-red-500 ring-1 ring-red-400' : 'border-gray-300 dark:border-gray-600 focus:ring-primary-500'}`}
                      placeholder="Age"
                    />
                  </div>
                </div>
              </div>
              {showErrors && (!formData.age || isNaN(parseInt(formData.age))) && (
                <p className="mt-1 text-xs text-red-600 dark:text-red-400">Please enter date of birth or age</p>
              )}

              {/* Current Level */}
              <div className="relative">
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                  Current Level
                </label>
                <div className="relative">
                  <button
                    type="button"
                    onClick={() => { selection(); setIsLevelOpen(!isLevelOpen) }}
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
                    </div>
                  )}
                </div>
                {showErrors && !formData.current_level && (
                  <p className="mt-1 text-xs text-red-600 dark:text-red-400">Please select current level</p>
                )}
              </div>

              {/* Sunday Attendance */}
              <div>
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
                      <div key={date} className="flex items-center justify-between p-3 border border-gray-200 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 hover:border-primary-300 dark:hover:border-primary-600 transition-colors duration-200">
                        <span className="text-sm font-medium text-gray-700 dark:text-gray-300">
                          {dateLabel}
                        </span>
                        <div className="flex space-x-2">
                          <button
                            type="button"
                            onClick={() => { selection(); setSundayAttendance(prev => ({ ...prev, [date]: true })) }}
                            className={`px-3 py-1 rounded-lg text-xs font-medium transition-colors ${sundayAttendance[date] === true
                              ? 'bg-green-600 text-white shadow-sm'
                              : 'bg-green-100 dark:bg-green-900 text-green-700 dark:text-green-300 hover:bg-green-200 dark:hover:bg-green-800'
                              }`}
                          >
                            Present
                          </button>
                          <button
                            type="button"
                            onClick={() => { selection(); setSundayAttendance(prev => ({ ...prev, [date]: false })) }}
                            className={`px-3 py-1 rounded-lg text-xs font-medium transition-colors ${sundayAttendance[date] === false
                              ? 'bg-red-600 text-white shadow-sm'
                              : 'bg-red-100 dark:bg-red-900 text-red-700 dark:text-red-300 hover:bg-red-200 dark:hover:bg-red-800'
                              }`}
                          >
                            Absent
                          </button>
                          <button
                            type="button"
                            onClick={() => { selection(); setSundayAttendance(prev => ({ ...prev, [date]: null })) }}
                            className="px-3 py-1 rounded-lg text-xs font-medium bg-gray-100 dark:bg-gray-600 text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-500 transition-colors"
                          >
                            Clear
                          </button>
                        </div>
                      </div>
                    )
                  })}
                </div>
              </div>

              {/* Collapsible Parent/Guardian Info Section */}
              <div className={`border rounded-lg overflow-hidden transition-all duration-300 ${showErrors && !((parentInfo.parent_name_1?.trim() || parentInfo.parent_phone_1?.trim()) || (parentInfo.parent_name_2?.trim() || parentInfo.parent_phone_2?.trim()))
                ? 'border-red-500 ring-4 ring-red-50 dark:ring-red-900/30'
                : 'border-gray-200 dark:border-gray-600'
                }`}>
                <button
                  type="button"
                  onClick={() => { selection(); setShowParentSection(!showParentSection) }}
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
                      Parent/Guardian Info {showErrors && !((parentInfo.parent_name_1?.trim() || parentInfo.parent_phone_1?.trim()) || (parentInfo.parent_name_2?.trim() || parentInfo.parent_phone_2?.trim())) ? '(Required)' : '(Optional)'}
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
                        Parent/Guardian 1
                      </label>
                      <div className="space-y-2">
                        <div className="relative">
                          <User className="absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-gray-400" />
                          <input
                            type="text"
                            value={parentInfo.parent_name_1}
                            onChange={(e) => setParentInfo(prev => ({ ...prev, parent_name_1: e.target.value }))}
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

                    {/* Parent 2 */}
                    <div>
                      <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">
                        Parent/Guardian 2
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
                  </div>
                )}
              </div>

              {/* Ministry/Groups Tags Section */}
              <div>
                <label className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-2">
                  Ministry/Groups Tags (Optional)
                </label>
                <div className="flex flex-wrap gap-2">
                  {ministries.map(ministry => (
                    <button
                      key={ministry}
                      type="button"
                      onClick={() => {
                        selection()
                        setFormData(prev => ({
                          ...prev,
                          ministry: prev.ministry.includes(ministry)
                            ? prev.ministry.filter(m => m !== ministry)
                            : [...prev.ministry, ministry]
                        }))
                      }}
                      className={`px-3 py-1.5 rounded-full text-xs font-medium transition-all ${
                        formData.ministry.includes(ministry)
                          ? 'bg-primary-600 text-white shadow-sm'
                          : 'bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600'
                      }`}
                    >
                      {ministry}
                    </button>
                  ))}
                </div>
              </div>

              {/* Visitor Toggle */}
              <div className="flex items-center justify-between py-2 px-3 bg-gray-50 dark:bg-gray-700/50 rounded-lg">
                <span className="text-sm font-medium text-gray-700 dark:text-gray-300">Mark as Visitor</span>
                <button
                  type="button"
                  onClick={() => { selection(); setFormData(prev => ({ ...prev, is_visitor: !prev.is_visitor })) }}
                  className={`relative w-11 h-6 rounded-full transition-colors ${
                    formData.is_visitor ? 'bg-amber-500' : 'bg-gray-300 dark:bg-gray-600'
                  }`}
                >
                  <span className={`absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full shadow transition-transform ${
                    formData.is_visitor ? 'translate-x-5' : 'translate-x-0'
                  }`} />
                </button>
              </div>

              {/* Notes Section */}
              <div>
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
                  placeholder="Add any notes about this member..."
                  className="w-full px-3 py-2 border rounded-lg focus:outline-none focus:ring-2 bg-white dark:bg-gray-700 text-gray-900 dark:text-white placeholder-gray-500 dark:placeholder-gray-400 border-gray-300 dark:border-gray-600 focus:ring-primary-500 text-sm resize-none"
                />
              </div>

              {/* Form Actions */}
              <div className="flex space-x-3 pt-4">
                <button
                  type="button"
                  onClick={() => { selection(); onClose() }}
                  className="flex-1 px-4 py-2 border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700 bg-white dark:bg-gray-700 transition-colors btn-press"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={loading}
                  className={`flex-1 px-4 py-2 text-white rounded-lg disabled:opacity-50 disabled:cursor-not-allowed transition-colors btn-press ${isOverrideMode
                    ? 'bg-orange-600 hover:bg-orange-700'
                    : 'bg-primary-600 hover:bg-primary-700'
                    }`}
                >
                  {loading ? 'Adding...' : (isOverrideMode ? 'Add (Override)' : 'Add Member')}
                </button>
              </div>
            </div>
          </form>
        </div >



      </div >
    </div >
  )
}

export default MemberModal
