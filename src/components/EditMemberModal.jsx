import React, { useState, useEffect, useMemo } from 'react'
import { useApp } from '../context/AppContext'
import { useTheme } from '../context/ThemeContext'
import { X, User, Phone, Calendar, BookOpen, ChevronDown, ChevronUp, Users, StickyNote } from 'lucide-react'
import { toast } from 'react-toastify'
import useHapticFeedback from '../hooks/useHapticFeedback'
import { normalizeMinistry } from '../utils/dataUtils'

const EditMemberModal = ({ isOpen, onClose, member }) => {
  const { updateMember, markAttendance, refreshSearch, currentTable, attendanceData, loadAllAttendanceData, members } = useApp()
  const { selection, success } = useHapticFeedback()

  // Get the latest member data from the members array to ensure we have up-to-date info
  const latestMember = useMemo(() => {
    if (!member?.id) return member
    return members.find(m => m.id === member.id) || member
  }, [members, member])
  const { isDarkMode } = useTheme()

  // Helper function to get month display name from table name
  const getMonthDisplayName = (tableName) => {
    // Convert table name like "October_2025" to "October 2025"
    return tableName.replace('_', ' ')
  }
  const [loading, setLoading] = useState(false)
  const [formData, setFormData] = useState({
    full_name: '',
    gender: '',
    phone_number: '',
    age: '',
    current_level: '',
    notes: '',
    ministry: [],
    is_visitor: false
  })

  // Available ministries - load from localStorage or use defaults
  const defaultMinistries = ['Choir', 'Ushers', 'Youth', 'Children', 'Media', 'Welfare', 'Protocol', 'Evangelism']
  const [ministries, setMinistries] = React.useState(() => {
    const saved = localStorage.getItem('customMinistries')
    return saved ? JSON.parse(saved) : defaultMinistries
  })

  // Listen for ministry updates from Admin Panel
  React.useEffect(() => {
    const handleMinistriesUpdate = (e) => {
      setMinistries(e.detail)
    }
    window.addEventListener('ministriesUpdated', handleMinistriesUpdate)
    return () => window.removeEventListener('ministriesUpdated', handleMinistriesUpdate)
  }, [])

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

  const levels = [
    'SHS1', 'SHS2', 'SHS3',
    'JHS1', 'JHS2', 'JHS3',
    'COMPLETED', 'UNIVERSITY'
  ]

  // Initialize form data when member changes
  useEffect(() => {
    if (latestMember) {
      // Normalize gender to lowercase to match radio button values
      const rawGender = latestMember['Gender'] || ''
      const normalizedGender = typeof rawGender === 'string' ? rawGender.toLowerCase() : ''
      setFormData({
        full_name: (latestMember['full_name'] || latestMember['Full Name'] || ''),
        gender: normalizedGender,
        phone_number: latestMember['Phone Number'] || '',
        age: latestMember['Age'] || '',
        current_level: latestMember['Current Level'] || '',
        notes: latestMember['notes'] || '',
        ministry: normalizeMinistry(latestMember['ministry']),
        is_visitor: latestMember['is_visitor'] || false
      })
      // Initialize parent info from member
      setParentInfo({
        parent_name_1: latestMember['parent_name_1'] || '',
        parent_phone_1: latestMember['parent_phone_1'] || '',
        parent_name_2: latestMember['parent_name_2'] || '',
        parent_phone_2: latestMember['parent_phone_2'] || ''
      })
      // Auto-expand parent section if parent data exists
      if (latestMember['parent_name_1'] || latestMember['parent_phone_1']) {
        setShowParentSection(true)
      }
    }
  }, [latestMember])

  // Initialize attendance snapshot when modal opens (stable deps, no loop)
  useEffect(() => {
    if (!isOpen || !latestMember || sundayDates.length === 0) return

    const initialAttendance = {}
    sundayDates.forEach(date => {
      const dateKey = date
      const memberAttendance = attendanceData[dateKey]?.[latestMember.id]
      if (memberAttendance !== undefined) {
        initialAttendance[date] = memberAttendance
      }
    })
    setSundayAttendance(initialAttendance)
  }, [isOpen, latestMember?.id, currentTable])

  // Update attendance state when attendanceData changes
  useEffect(() => {
    if (latestMember && sundayDates.length > 0) {
      const updatedAttendance = {}
      sundayDates.forEach(date => {
        const dateKey = date
        const memberAttendance = attendanceData[dateKey]?.[latestMember.id]
        if (memberAttendance !== undefined) {
          updatedAttendance[date] = memberAttendance
        }
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
  const [overrideMode, setOverrideMode] = useState(false)
  const [showParentSection, setShowParentSection] = useState(false)
  const [parentInfo, setParentInfo] = useState({
    parent_name_1: '',
    parent_phone_1: '',
    parent_name_2: '',
    parent_phone_2: ''
  })

  const handleSubmit = async (e) => {
    e.preventDefault()
    setHasAttemptedSave(true)

    // Validate required fields
    const isFullNameValid = formData.full_name && formData.full_name.trim().length > 0
    const isGenderValid = !!formData.gender
    const isLevelValid = !!formData.current_level
    // Ensure phone_number is converted to string for validation (it may be a number from DB)
    const phoneStr = String(formData.phone_number || '')
    const phoneDigits = phoneStr.replace(/\D/g, '')
    const isPhoneValid = phoneDigits.length === 10
    const ageNum = parseInt(formData.age)
    const isAgeValid = formData.age && !isNaN(ageNum) && ageNum >= 1 && ageNum <= 120

    // Check if at least one parent info is provided (either Parent 1 OR Parent 2)
    const hasParentInfo = (parentInfo.parent_name_1?.trim() || parentInfo.parent_phone_1?.trim()) ||
      (parentInfo.parent_name_2?.trim() || parentInfo.parent_phone_2?.trim())

    // In override mode, only require name
    if (overrideMode) {
      if (!isFullNameValid) {
        toast.error('Name is required even in override mode')
        return
      }
    } else {
      if (!isFullNameValid || !isGenderValid || !isLevelValid || !isPhoneValid || !isAgeValid) {
        toast.error('Please fill in all required fields correctly')
        return
      }
      if (!hasParentInfo) {
        setHasAttemptedSave(true)
        setShowParentSection(true)
        toast.error('Please provide at least one parent/guardian contact')
        return
      }
    }

    setLoading(true)

    try {
      // Ensure ministry data is clean before saving
      const cleanMinistries = normalizeMinistry(formData.ministry)

      await updateMember(latestMember.id, {
        // Pass normalized fields; AppContext will map to the correct table column
        full_name: formData.full_name,
        Gender: formData.gender,
        'Phone Number': formData.phone_number || null,
        Age: formData.age ? String(formData.age).trim() : null,
        'Current Level': formData.current_level,
        // Parent info
        parent_name_1: parentInfo.parent_name_1 || null,
        parent_phone_1: parentInfo.parent_phone_1 || null,
        parent_name_2: parentInfo.parent_name_2 || null,
        parent_phone_2: parentInfo.parent_phone_2 || null,
        // Notes
        notes: formData.notes || null,
        // Ministry and visitor status
        ministry: cleanMinistries,
        is_visitor: formData.is_visitor || false
      })

      // Mark attendance for selected Sunday dates
      for (const [date, attendance] of Object.entries(sundayAttendance)) {
        if (attendance !== null) {
          await markAttendance(latestMember.id, new Date(date), attendance)
        }
      }

      success()
      onClose()

      // Reset Sunday attendance state
      setSundayAttendance({})

      // Refresh search results to show updated information
      setTimeout(() => refreshSearch(), 100)

      // Success toast handled in global state
    } catch (error) {
      console.error('Error updating member:', error)
      // Error toast handled in global state
    } finally {
      setLoading(false)
    }
  }

  const handleInputChange = (e) => {
    const { name, value } = e.target
    setFormData(prev => ({
      ...prev,
      [name]: value
    }))
  }

  // ESC key to close modal
  useEffect(() => {
    const handleEscKey = (event) => {
      if (event.key === 'Escape' && isOpen) {
        selection()
        onClose()
      }
    }

    document.addEventListener('keydown', handleEscKey)
    return () => {
      document.removeEventListener('keydown', handleEscKey)
    }
  }, [isOpen, onClose, selection])

  if (!isOpen || !member) return null

  return (
    <div 
      className="fixed inset-0 bg-black bg-opacity-50 backdrop-blur-sm flex items-center justify-center p-4 z-[60] backdrop-animate"
      onClick={() => { selection(); onClose() }}
    >
      <div 
        className={`shadow-2xl ring-1 max-w-md w-full mx-4 max-h-[90vh] flex flex-col transition-all duration-300 animate-scale-in ${overrideMode
        ? 'bg-orange-50/90 dark:bg-orange-900/40 backdrop-blur-md ring-orange-300 dark:ring-orange-700 rounded-3xl'
        : 'bg-white dark:bg-gray-800 ring-gray-200 dark:ring-gray-700 rounded-xl'
        }`}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className={`flex items-center justify-between p-6 border-b flex-shrink-0 transition-all duration-300 ${overrideMode
          ? 'bg-orange-100/80 dark:bg-orange-800/80 border-orange-200 dark:border-orange-700 rounded-t-3xl'
          : 'border-gray-200 dark:border-gray-700 rounded-t-xl'
          }`}>
          <h2 className="text-xl font-semibold text-gray-900 dark:text-white">Edit Member</h2>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setOverrideMode(!overrideMode)}
              className={`px-3 py-1 rounded text-xs border transition-colors ${overrideMode
                ? 'bg-orange-200 dark:bg-orange-700 text-orange-800 dark:text-orange-200 border-orange-300 dark:border-orange-600 font-medium'
                : 'bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300 border-gray-300 dark:border-gray-600 hover:bg-gray-200 dark:hover:bg-gray-600'
                }`}
              title="Toggle Override Mode (Bypass Validation)"
            >
              {overrideMode ? 'Override Active' : 'Override'}
            </button>
            <button
              onClick={() => { selection(); onClose() }}
              className="p-1 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg transition-colors"
            >
              <X className="w-5 h-5 text-gray-500 dark:text-gray-400" />
            </button>
          </div>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="p-6 space-y-4 overflow-y-auto flex-1 scrollbar-hide" style={{ scrollbarWidth: 'none', msOverflowStyle: 'none' }}>
          {/* Full Name */}
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
              Full Name *
            </label>
            <div className="relative">
              <User className="absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-gray-500 dark:text-gray-400" />
              <input
                type="text"
                name="full_name"
                value={formData.full_name}
                onChange={handleInputChange}
                required
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
          </div>

          {/* Gender */}
          <div>
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
                  required
                  className="text-primary-600 focus:ring-primary-500"
                />
                <span className="text-sm">Female</span>
              </label>
            </div>
            {hasAttemptedSave && !formData.gender && (
              <p className="mt-2 text-xs text-red-600 dark:text-red-400">Please select gender to continue</p>
            )}
          </div>

          {/* Phone Number */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">
                Phone Number
              </label>
            </div>
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
          </div>

          {/* Age */}
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
              Age
            </label>
            <div className="relative">
              <Calendar className="absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-gray-500 dark:text-gray-400" />
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
                className={`w-full pl-10 pr-4 py-2 border rounded-lg focus:outline-none focus:ring-2 transition-colors ${hasAttemptedSave && (!formData.age || isNaN(parseInt(formData.age)))
                  ? 'border-red-500 focus:ring-red-500 bg-red-50 dark:bg-red-900/10'
                  : 'border-gray-300 dark:border-gray-600 focus:ring-primary-500 bg-white dark:bg-gray-700 text-gray-900 dark:text-white placeholder-gray-500 dark:placeholder-gray-400'
                  }`}
                placeholder="Enter age"
              />
            </div>
            {hasAttemptedSave && (!formData.age || isNaN(parseInt(formData.age))) && (
              <p className="mt-1 text-xs text-red-600 dark:text-red-400">Please enter age</p>
            )}
          </div>

          {/* Current Level */}
          <div className="relative">
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
              Current Level
            </label>
            <div className="relative">
              <button
                type="button"
                onClick={() => setIsLevelOpen(!isLevelOpen)}
                className={`w-full pl-3 pr-4 py-2 text-left rounded-lg focus:outline-none focus:ring-1 bg-white dark:bg-gray-700 text-gray-900 dark:text-white transition-colors duration-200 border flex items-center justify-between ${hasAttemptedSave && !formData.current_level ? 'border-red-500 ring-1 ring-red-400' : 'border-gray-300 dark:border-gray-600 focus:ring-primary-500'}`}
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
            {hasAttemptedSave && !formData.current_level && (
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
                const formattedDate = dateObj.toLocaleDateString('en-US', {
                  weekday: 'long',
                  year: 'numeric',
                  month: 'long',
                  day: 'numeric'
                })

                return (
                  <div key={date} className="border border-gray-200 dark:border-gray-600 rounded-lg p-3 bg-white dark:bg-gray-700 transition-colors">
                    <div className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                      {formattedDate}
                    </div>
                    <div className="flex space-x-2">
                      <button
                        type="button"
                        onClick={() => setSundayAttendance(prev => ({ ...prev, [date]: true }))}
                        className={`px-3 py-1 text-xs rounded-lg font-bold transition-all duration-200 ${sundayAttendance[date] === true
                          ? 'bg-green-800 dark:bg-green-700 text-white shadow-xl ring-4 ring-green-300 dark:ring-green-400 border-2 border-green-900 dark:border-green-300 font-extrabold transform scale-110'
                          : 'bg-gray-100 dark:bg-gray-600 text-gray-600 dark:text-gray-300 border border-gray-300 dark:border-gray-500 hover:bg-green-50 dark:hover:bg-green-800'
                          }`}
                      >
                        Present
                      </button>
                      <button
                        type="button"
                        onClick={() => setSundayAttendance(prev => ({ ...prev, [date]: false }))}
                        className={`px-3 py-1 text-xs rounded-lg font-bold transition-all duration-200 ${sundayAttendance[date] === false
                          ? 'bg-red-800 dark:bg-red-700 text-white shadow-xl ring-4 ring-red-300 dark:ring-red-400 border-2 border-red-900 dark:border-red-300 font-extrabold transform scale-110'
                          : 'bg-gray-100 dark:bg-gray-600 text-gray-600 dark:text-gray-300 border border-gray-300 dark:border-gray-500 hover:bg-red-50 dark:hover:bg-red-800'
                          }`}
                      >
                        Absent
                      </button>
                      <button
                        type="button"
                        onClick={() => setSundayAttendance(prev => ({ ...prev, [date]: null }))}
                        className="px-3 py-1 text-xs rounded-lg bg-gray-100 dark:bg-gray-600 text-gray-600 dark:text-gray-300 border border-gray-300 dark:border-gray-500 hover:bg-gray-200 dark:hover:bg-gray-500 transition-colors"
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
          <div className={`border rounded-lg overflow-hidden transition-all duration-300 ${hasAttemptedSave && !overrideMode && !((parentInfo.parent_name_1?.trim() || parentInfo.parent_phone_1?.trim()) || (parentInfo.parent_name_2?.trim() || parentInfo.parent_phone_2?.trim()))
            ? 'border-red-500 ring-4 ring-red-50 dark:ring-red-900/30'
            : 'border-gray-200 dark:border-gray-600'
            }`}>
            <button
              type="button"
              onClick={() => setShowParentSection(!showParentSection)}
              className={`w-full flex items-center justify-between p-3 transition-colors ${hasAttemptedSave && !overrideMode && !((parentInfo.parent_name_1?.trim() || parentInfo.parent_phone_1?.trim()) || (parentInfo.parent_name_2?.trim() || parentInfo.parent_phone_2?.trim()))
                ? 'bg-red-50 dark:bg-red-900/20 hover:bg-red-100 dark:hover:bg-red-900/30'
                : 'bg-gray-50 dark:bg-gray-700 hover:bg-gray-100 dark:hover:bg-gray-600'
                }`}
            >
              <div className="flex items-center gap-2">
                <Users className={`w-4 h-4 ${hasAttemptedSave && !overrideMode && !((parentInfo.parent_name_1?.trim() || parentInfo.parent_phone_1?.trim()) || (parentInfo.parent_name_2?.trim() || parentInfo.parent_phone_2?.trim()))
                  ? 'text-red-500 dark:text-red-400'
                  : 'text-gray-500 dark:text-gray-400'
                  }`} />
                <span className={`text-sm font-medium ${hasAttemptedSave && !overrideMode && !((parentInfo.parent_name_1?.trim() || parentInfo.parent_phone_1?.trim()) || (parentInfo.parent_name_2?.trim() || parentInfo.parent_phone_2?.trim()))
                  ? 'text-red-700 dark:text-red-300'
                  : 'text-gray-700 dark:text-gray-300'
                  }`}>
                  Parent/Guardian Info
                </span>
                {(parentInfo.parent_name_1 || parentInfo.parent_phone_1) && (
                  <span className="text-xs px-1.5 py-0.5 bg-green-100 dark:bg-green-900 text-green-700 dark:text-green-300 rounded">Saved</span>
                )}
                {hasAttemptedSave && !overrideMode && !((parentInfo.parent_name_1?.trim() || parentInfo.parent_phone_1?.trim()) || (parentInfo.parent_name_2?.trim() || parentInfo.parent_phone_2?.trim())) && (
                  <span className="text-xs px-1.5 py-0.5 bg-red-100 dark:bg-red-900 text-red-700 dark:text-red-300 rounded font-medium">Required</span>
                )}
              </div>
              {showParentSection ? (
                <ChevronUp className={`w-4 h-4 ${hasAttemptedSave && !overrideMode && !((parentInfo.parent_name_1?.trim() || parentInfo.parent_phone_1?.trim()) || (parentInfo.parent_name_2?.trim() || parentInfo.parent_phone_2?.trim()))
                  ? 'text-red-500 dark:text-red-400'
                  : 'text-gray-500 dark:text-gray-400'
                  }`} />
              ) : (
                <ChevronDown className={`w-4 h-4 ${hasAttemptedSave && !overrideMode && !((parentInfo.parent_name_1?.trim() || parentInfo.parent_phone_1?.trim()) || (parentInfo.parent_name_2?.trim() || parentInfo.parent_phone_2?.trim()))
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
                    Parent/Guardian 1 *
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
                    Parent/Guardian 2 (Optional)
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

          {/* Ministry/Groups Section */}
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
              Ministry/Groups (Optional)
            </label>
            <div className="flex flex-wrap gap-2">
              {ministries.map(ministry => (
                <button
                  key={ministry}
                  type="button"
                  onClick={() => {
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
              onClick={() => setFormData(prev => ({ ...prev, is_visitor: !prev.is_visitor }))}
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
              disabled={loading || !formData.full_name}
              className={`flex-1 px-4 py-2 text-white rounded-lg disabled:opacity-50 disabled:cursor-not-allowed transition-colors btn-press ${overrideMode
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
