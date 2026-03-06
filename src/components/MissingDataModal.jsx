import React, { useState, useEffect } from 'react'
import { X, AlertCircle, ChevronDown } from 'lucide-react'
import { useApp } from '../context/AppContext'
import { toast } from 'react-toastify'

const MissingDataModal = ({ member, missingFields, missingDates, pendingAttendanceAction, selectedAttendanceDate, onClose, onSave }) => {
    const { updateMember, markAttendance, selectedAttendanceDate: contextAttendanceDate } = useApp()
    const [formData, setFormData] = useState({})
    const [attendanceData, setAttendanceData] = useState({})
    const [isSaving, setIsSaving] = useState(false)
    const [saveError, setSaveError] = useState(null)
    const [hasAttemptedSave, setHasAttemptedSave] = useState(false)
    const [isOverrideMode, setIsOverrideMode] = useState(false)
    const [showLevelDropdown, setShowLevelDropdown] = useState(false)

    const levelOptions = [
        'JHS1', 'JHS2', 'JHS3',
        'SHS1', 'SHS2', 'SHS3',
        'COMPLETED', 'UNIVERSITY'
    ]
    const [showGenderDropdown, setShowGenderDropdown] = useState(false)
    const genderOptions = ['Male', 'Female']

    // Local selection for which missing Sunday should be considered the "selectedAttendanceDate"
    // This lets the admin choose a date from the missingDates dropdown inside the modal.
    const [selectedDateKey, setSelectedDateKey] = useState(null)

    useEffect(() => {
        // Initialize the selected date key from the prop if available, otherwise pick the first missing date
        if (selectedAttendanceDate) {
            try {
                setSelectedDateKey(selectedAttendanceDate.toISOString().split('T')[0])
                return
            } catch { }
        }
        if (missingDates && missingDates.length > 0) {
            setSelectedDateKey(missingDates[0].toISOString().split('T')[0])
        } else {
            setSelectedDateKey(null)
        }
    }, [selectedAttendanceDate, missingDates])

    // Initialize form data with member's current values
    useEffect(() => {
        const initialData = {}
        if (missingFields.includes('Phone Number')) {
            initialData.phoneNumber = member['Phone Number'] || ''
        }
        if (missingFields.includes('Gender')) {
            initialData.gender = member['Gender'] || ''
        }
        if (missingFields.includes('Age')) {
            initialData.age = member['Age'] || ''
        }
        if (missingFields.includes('Current Level')) {
            initialData.currentLevel = member['Current Level'] || ''
        }
        if (missingFields.includes('Parent Name 1')) {
            initialData.parentName1 = member['parent_name_1'] || ''
        }
        if (missingFields.includes('Parent Phone 1')) {
            initialData.parentPhone1 = member['parent_phone_1'] || ''
        }
        setFormData(initialData)

        // Initialize attendance data
        const initialAttendance = {}
        missingDates.forEach(date => {
            initialAttendance[date.toISOString().split('T')[0]] = null
        })
        setAttendanceData(initialAttendance)
    }, [member, missingFields, missingDates])

    const handleInputChange = (field, value) => {
        setFormData(prev => ({ ...prev, [field]: value }))
        // Clear error when user makes changes
        if (saveError) setSaveError(null)
    }

    const handleAttendanceChange = (dateKey, status) => {
        setAttendanceData(prev => ({ ...prev, [dateKey]: status }))
        // Clear error when user makes changes
        if (saveError) setSaveError(null)
    }

    // Check if all required fields are filled
    const isFormComplete = () => {
        // Check member fields
        for (const field of missingFields) {
            if (field === 'Phone Number' && (!formData.phoneNumber || formData.phoneNumber.length !== 10)) {
                return false
            }
            if (field === 'Gender' && (!formData.gender || formData.gender === '')) {
                return false
            }
            if (field === 'Age' && (!formData.age || formData.age === '')) {
                return false
            }
            if (field === 'Current Level' && (!formData.currentLevel || formData.currentLevel === '')) {
                return false
            }
            if (field === 'Parent Name 1' && (!formData.parentName1 || formData.parentName1 === '')) {
                return false
            }
            if (field === 'Parent Phone 1' && (!formData.parentPhone1 || formData.parentPhone1.length !== 10)) {
                return false
            }
        }

        // Check attendance dates
        for (const dateKey of Object.keys(attendanceData)) {
            if (attendanceData[dateKey] === null) {
                return false
            }
        }

        return true
    }

    // Helper to check if a specific field is invalid
    const isFieldInvalid = (field) => {
        if (!hasAttemptedSave) return false

        if (field === 'Phone Number') return !formData.phoneNumber || formData.phoneNumber.length !== 10
        if (field === 'Gender') return !formData.gender || formData.gender === ''
        if (field === 'Age') return !formData.age || formData.age === ''
        if (field === 'Current Level') return !formData.currentLevel || formData.currentLevel === ''
        if (field === 'Parent Name 1') return !formData.parentName1 || formData.parentName1 === ''
        if (field === 'Parent Phone 1') return !formData.parentPhone1 || formData.parentPhone1.length !== 10

        return false
    }

    const handleSave = async () => {
        setHasAttemptedSave(true)

        console.log('=== SAVE BUTTON CLICKED ===')
        console.log('Form complete?', isFormComplete())

        if (!isOverrideMode && !isFormComplete()) {
            console.log('Form not complete, showing error')
            toast.error('Please fill in all highlighted fields')
            return
        }

        setIsSaving(true)
        setSaveError(null)
        console.log('Starting save process...')

        try {
            if (!isOverrideMode && missingFields.length > 0) {
                const updates = {}
                if (missingFields.includes('Phone Number')) {
                    updates['Phone Number'] = formData.phoneNumber
                }
                if (missingFields.includes('Gender')) {
                    updates['Gender'] = formData.gender
                }
                if (missingFields.includes('Age')) {
                    updates['Age'] = formData.age
                }
                if (missingFields.includes('Current Level')) {
                    updates['Current Level'] = formData.currentLevel
                }
                if (missingFields.includes('Parent Name 1')) {
                    updates.parent_name_1 = formData.parentName1
                }
                if (missingFields.includes('Parent Phone 1')) {
                    updates.parent_phone_1 = formData.parentPhone1
                }

                console.log('Updating member with:', updates)
                await updateMember(member.id, updates)
                console.log('Member updated successfully')
            }

            // Use the locally-selected date if provided by the modal dropdown; fall back to the prop
            const selectedKey = selectedDateKey || (selectedAttendanceDate ? selectedAttendanceDate.toISOString().split('T')[0] : null)
            if (pendingAttendanceAction && selectedKey) {
                const actionBool = !!pendingAttendanceAction.present
                console.log(`Marking pending selected date ${selectedKey}: ${actionBool}`)
                await markAttendance(member.id, new Date(selectedKey), actionBool)
            }

            for (const dateKey of Object.keys(attendanceData)) {
                if (selectedKey && dateKey === selectedKey) continue
                const status = attendanceData[dateKey]
                if (status !== null) {
                    console.log(`Marking attendance for ${dateKey}: ${status}`)
                    await markAttendance(member.id, new Date(dateKey), status)
                }
            }

            console.log('All updates complete!')
            toast.success(isOverrideMode ? 'Attendance saved (Override)' : 'Missing data saved successfully!')
            onSave()
            onClose()
        } catch (error) {
            console.error('Error saving missing data:', error)
            const errorMsg = error.message || 'Unknown error occurred'
            setSaveError(errorMsg)
            toast.error(`Failed to save data: ${errorMsg}`)
        } finally {
            setIsSaving(false)
        }
    }
    return (
        <div className="fixed inset-0 bg-black bg-opacity-50 dark:bg-black dark:bg-opacity-70 flex items-center justify-center p-4 z-[60] backdrop-animate">
            <div className={`max-w-2xl w-full max-h-[90vh] overflow-y-auto transition-all duration-300 scrollbar-hide ring-1 rounded-3xl animate-scale-in ${isOverrideMode
                ? 'bg-orange-50/90 dark:bg-orange-900/40 backdrop-blur-md ring-orange-300 dark:ring-orange-700'
                : 'bg-white dark:bg-gray-800 ring-gray-200 dark:ring-gray-700'
                }`} style={{ scrollbarWidth: 'none', msOverflowStyle: 'none' }}>
                <style>{`
                    .scrollbar-hide::-webkit-scrollbar {
                        display: none;
                    }
                `}</style>
                <div className={`sticky top-0 border-b px-6 py-4 flex items-center justify-between z-10 transition-all duration-300 rounded-t-3xl ${isOverrideMode
                    ? 'bg-orange-100/80 dark:bg-orange-800/80 border-orange-200 dark:border-orange-700'
                    : 'bg-white dark:bg-gray-800 border-gray-200 dark:border-gray-700'
                    }`}>
                    <div className="flex items-center gap-2">
                        <AlertCircle className={`w-5 h-5 ${isOverrideMode ? 'text-orange-500' : 'text-orange-500'}`} />
                        <h2 className="text-xl font-semibold text-gray-900 dark:text-white">
                            Complete Missing Information
                        </h2>
                    </div>
                    <div className="flex items-center gap-2">
                        <button
                            type="button"
                            onClick={() => setIsOverrideMode(!isOverrideMode)}
                            className={`px-3 py-1 rounded text-xs border transition-colors ${isOverrideMode
                                ? 'bg-orange-200 dark:bg-orange-700 text-orange-800 dark:text-orange-200 border-orange-300 dark:border-orange-600 font-medium'
                                : 'bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300 border-gray-300 dark:border-gray-600 hover:bg-gray-200 dark:hover:bg-gray-600'
                                }`}
                            title="Toggle Override Mode (Bypass Validation)"
                        >
                            {isOverrideMode ? 'Override Active' : 'Override'}
                        </button>
                        <button
                            onClick={onClose}
                            className="p-1 hover:bg-gray-100 dark:hover:bg-gray-700 rounded transition-colors"
                        >
                            <X className="w-5 h-5 text-gray-500 dark:text-gray-400" />
                        </button>
                    </div>
                </div>

                <div className="p-6 space-y-6">
                    {saveError && (
                        <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg p-4 mb-4">
                            <div className="flex items-center gap-2 text-red-800 dark:text-red-200 font-medium mb-1">
                                <AlertCircle className="w-4 h-4" />
                                <span>Error Saving Data</span>
                            </div>
                            <p className="text-sm text-red-700 dark:text-red-300 break-words">
                                {saveError}
                            </p>
                        </div>
                    )}

                    <div className="bg-orange-100 dark:bg-orange-900/30 border border-orange-300 dark:border-orange-700 rounded-lg p-4">
                        <p className="text-sm text-orange-800 dark:text-orange-200 font-medium mb-2">
                            📋 Complete Missing Information for <strong>{member['Full Name'] || member.full_name}</strong>
                        </p>
                        <p className="text-xs text-orange-700 dark:text-orange-300">
                            {missingDates.length > 0 && (
                                <span className="block mb-1">
                                    ✅ <strong>Past Sundays:</strong> If you were in church, select <span className="text-green-600 dark:text-green-400 font-semibold">Present (Green)</span>. If not, select <span className="text-red-600 dark:text-red-400 font-semibold">Absent (Red)</span>.
                                </span>
                            )}
                            {missingFields.length > 0 && (
                                <span className="block">
                                    📝 <strong>Required Fields:</strong> Please fill in all missing information below.
                                </span>
                            )}
                        </p>
                    </div>

                    {/* Missing Member Fields */}
                    {missingFields.length > 0 && (
                        <div className="space-y-4">
                            <h3 className="text-lg font-medium text-gray-900 dark:text-white">Member Information</h3>

                            {missingFields.includes('Phone Number') && (
                                <div>
                                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                                        Phone Number * (10 digits)
                                    </label>
                                    <div className="flex gap-2">
                                        <input
                                            type="tel"
                                            value={formData.phoneNumber || ''}
                                            onChange={(e) => {
                                                const value = e.target.value.replace(/\D/g, '').slice(0, 10)
                                                handleInputChange('phoneNumber', value)
                                            }}
                                            maxLength="10"
                                            className={`flex-1 px-3 py-2 border rounded-lg focus:outline-none focus:ring-2 dark:bg-gray-700 dark:text-white ${isFieldInvalid('Phone Number')
                                                ? 'border-red-500 focus:ring-red-500 bg-red-50 dark:bg-red-900/10'
                                                : 'border-gray-300 dark:border-gray-600 focus:ring-primary-500'
                                                }`}
                                            placeholder="Enter 10-digit phone number"
                                        />
                                        <button
                                            type="button"
                                            onClick={() => handleInputChange('phoneNumber', '0000000000')}
                                            className="px-4 py-2 bg-gray-500 hover:bg-gray-600 text-white rounded-lg text-sm font-medium transition-colors"
                                        >
                                            No Phone
                                        </button>
                                    </div>
                                    {formData.phoneNumber && formData.phoneNumber.length !== 10 && (
                                        <p className="text-xs text-red-600 dark:text-red-400 mt-1">Must be exactly 10 digits</p>
                                    )}
                                    {isFieldInvalid('Phone Number') && !formData.phoneNumber && (
                                        <p className="text-xs text-red-600 dark:text-red-400 mt-1">Phone number is required</p>
                                    )}
                                </div>
                            )}

                            {missingFields.includes('Gender') && (
                                <div>
                                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                                        Gender *
                                    </label>
                                    <div className="relative">
                                        {/* Custom dropdown trigger */}
                                        <button
                                            type="button"
                                            onClick={() => setShowGenderDropdown(prev => !prev)}
                                            className={`w-full px-3 py-2 text-left border rounded-lg focus:outline-none focus:ring-2 bg-white dark:bg-gray-700 text-gray-900 dark:text-white transition-colors flex items-center justify-between ${isFieldInvalid('Gender')
                                                ? 'border-red-500 focus:ring-red-500 bg-red-50 dark:bg-red-900/10'
                                                : 'border-gray-300 dark:border-gray-600 focus:ring-primary-500'
                                                }`}
                                        >
                                            <span className={formData.gender ? '' : 'text-gray-400 dark:text-gray-400'}>
                                                {formData.gender || 'Select gender'}
                                            </span>
                                            <ChevronDown className={`w-4 h-4 text-gray-400 transition-transform ${showGenderDropdown ? 'rotate-180' : ''}`} />
                                        </button>

                                        {/* Dropdown list - opens downward */}
                                        {showGenderDropdown && (
                                            <div className="absolute left-0 right-0 mt-1 z-50 max-h-60 overflow-y-auto rounded-lg border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-800 shadow-lg">
                                                {genderOptions.map(gender => {
                                                    const isActive = formData.gender === gender
                                                    return (
                                                        <button
                                                            key={gender}
                                                            type="button"
                                                            onClick={() => {
                                                                handleInputChange('gender', gender)
                                                                setShowGenderDropdown(false)
                                                            }}
                                                            className={`w-full text-left px-3 py-2 text-sm transition-colors ${isActive
                                                                ? 'bg-primary-50 dark:bg-primary-900 text-primary-700 dark:text-primary-300'
                                                                : 'text-gray-800 dark:text-gray-100 hover:bg-gray-100 dark:hover:bg-gray-700'
                                                                }`}
                                                        >
                                                            {gender}
                                                        </button>
                                                    )
                                                })}
                                            </div>
                                        )}
                                    </div>
                                    {isFieldInvalid('Gender') && (
                                        <p className="text-xs text-red-600 dark:text-red-400 mt-1">Gender is required</p>
                                    )}
                                </div>
                            )}

                            {missingFields.includes('Age') && (
                                <div>
                                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                                        Age *
                                    </label>
                                    <input
                                        type="text"
                                        value={formData.age || ''}
                                        onChange={(e) => handleInputChange('age', e.target.value)}
                                        className={`w-full px-3 py-2 border rounded-lg focus:outline-none focus:ring-2 dark:bg-gray-700 dark:text-white ${isFieldInvalid('Age')
                                            ? 'border-red-500 focus:ring-red-500 bg-red-50 dark:bg-red-900/10'
                                            : 'border-gray-300 dark:border-gray-600 focus:ring-primary-500'
                                            }`}
                                        placeholder="Enter age"
                                    />
                                    {isFieldInvalid('Age') && (
                                        <p className="text-xs text-red-600 dark:text-red-400 mt-1">Age is required</p>
                                    )}
                                </div>
                            )}

                            {missingFields.includes('Current Level') && (
                                <div>
                                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                                        Current Level *
                                    </label>
                                    <div className="relative">
                                        {/* Custom dropdown trigger */}
                                        <button
                                            type="button"
                                            onClick={() => setShowLevelDropdown(prev => !prev)}
                                            className={`w-full px-3 py-2 text-left border rounded-lg focus:outline-none focus:ring-2 bg-white dark:bg-gray-700 text-gray-900 dark:text-white transition-colors flex items-center justify-between ${isFieldInvalid('Current Level')
                                                ? 'border-red-500 focus:ring-red-500 bg-red-50 dark:bg-red-900/10'
                                                : 'border-gray-300 dark:border-gray-600 focus:ring-primary-500'
                                                }`}
                                        >
                                            <span className={formData.currentLevel ? '' : 'text-gray-400 dark:text-gray-400'}>
                                                {formData.currentLevel || 'Select level'}
                                            </span>
                                            <ChevronDown className={`w-4 h-4 text-gray-400 transition-transform ${showLevelDropdown ? 'rotate-180' : ''}`} />
                                        </button>

                                        {/* Dropdown list - opens downward */}
                                        {showLevelDropdown && (
                                            <div className="absolute left-0 right-0 mt-1 z-50 max-h-60 overflow-y-auto rounded-lg border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-800 shadow-lg">
                                                {levelOptions.map(level => {
                                                    const isActive = formData.currentLevel === level
                                                    return (
                                                        <button
                                                            key={level}
                                                            type="button"
                                                            onClick={() => {
                                                                handleInputChange('currentLevel', level)
                                                                setShowLevelDropdown(false)
                                                            }}
                                                            className={`w-full text-left px-3 py-2 text-sm transition-colors ${isActive
                                                                ? 'bg-primary-50 dark:bg-primary-900 text-primary-700 dark:text-primary-300'
                                                                : 'text-gray-800 dark:text-gray-100 hover:bg-gray-100 dark:hover:bg-gray-700'
                                                                }`}
                                                        >
                                                            {level}
                                                        </button>
                                                    )
                                                })}
                                            </div>
                                        )}
                                    </div>
                                    {isFieldInvalid('Current Level') && (
                                        <p className="text-xs text-red-600 dark:text-red-400 mt-1">Current level is required</p>
                                    )}
                                </div>
                            )}

                            {missingFields.includes('Parent Name 1') && (
                                <div>
                                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                                        Parent/Guardian Name *
                                    </label>
                                    <input
                                        type="text"
                                        value={formData.parentName1 || ''}
                                        onChange={(e) => handleInputChange('parentName1', e.target.value)}
                                        className={`w-full px-3 py-2 border rounded-lg focus:outline-none focus:ring-2 dark:bg-gray-700 dark:text-white ${isFieldInvalid('Parent Name 1')
                                            ? 'border-red-500 focus:ring-red-500 bg-red-50 dark:bg-red-900/10'
                                            : 'border-gray-300 dark:border-gray-600 focus:ring-primary-500'
                                            }`}
                                        placeholder="Enter parent/guardian name"
                                    />
                                    {isFieldInvalid('Parent Name 1') && (
                                        <p className="text-xs text-red-600 dark:text-red-400 mt-1">Parent name is required</p>
                                    )}
                                </div>
                            )}

                            {missingFields.includes('Parent Phone 1') && (
                                <div>
                                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                                        Parent/Guardian Phone * (10 digits)
                                    </label>
                                    <div className="flex gap-2">
                                        <input
                                            type="tel"
                                            value={formData.parentPhone1 || ''}
                                            onChange={(e) => {
                                                const value = e.target.value.replace(/\D/g, '').slice(0, 10)
                                                handleInputChange('parentPhone1', value)
                                            }}
                                            maxLength="10"
                                            className={`flex-1 px-3 py-2 border rounded-lg focus:outline-none focus:ring-2 dark:bg-gray-700 dark:text-white ${isFieldInvalid('Parent Phone 1')
                                                ? 'border-red-500 focus:ring-red-500 bg-red-50 dark:bg-red-900/10'
                                                : 'border-gray-300 dark:border-gray-600 focus:ring-primary-500'
                                                }`}
                                            placeholder="Enter 10-digit phone number"
                                        />
                                        <button
                                            type="button"
                                            onClick={() => handleInputChange('parentPhone1', '0000000000')}
                                            className="px-4 py-2 bg-gray-500 hover:bg-gray-600 text-white rounded-lg text-sm font-medium transition-colors"
                                        >
                                            No Phone
                                        </button>
                                    </div>
                                    {formData.parentPhone1 && formData.parentPhone1.length !== 10 && (
                                        <p className="text-xs text-red-600 dark:text-red-400 mt-1">Must be exactly 10 digits</p>
                                    )}
                                    {isFieldInvalid('Parent Phone 1') && !formData.parentPhone1 && (
                                        <p className="text-xs text-red-600 dark:text-red-400 mt-1">Parent phone is required</p>
                                    )}
                                </div>
                            )}
                        </div>
                    )}

                    {/* Missing Attendance Dates */}
                    {missingDates.length > 0 && (
                        <div className="space-y-4">
                            <h3 className="text-lg font-medium text-gray-900 dark:text-white">Past Sunday Attendance</h3>
                            <p className="text-sm text-gray-600 dark:text-gray-400">
                                Please mark attendance for the following past Sundays:
                            </p>

                            {/* Optional dropdown to choose which missing Sunday should be used as the "selected" date.
                                    This is used to apply the pending attendance action (if any) to the chosen date. */}
                            <div className="mb-3">
                                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Apply pending attendance to</label>
                                <select
                                    value={selectedDateKey || ''}
                                    onChange={(e) => setSelectedDateKey(e.target.value)}
                                    className="w-full px-3 py-2 border rounded-lg focus:outline-none focus:ring-2 dark:bg-gray-700 dark:text-white border-gray-300 dark:border-gray-600 focus:ring-primary-500"
                                >
                                    {(missingDates || []).map(d => {
                                        const k = d.toISOString().split('T')[0]
                                        const label = d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
                                        return <option key={k} value={k}>{label}</option>
                                    })}
                                </select>
                                <p className="text-xs text-gray-500 mt-1">The selected date will be used for the pending attendance action (the one that triggered this modal).</p>
                            </div>

                            <div className="space-y-3">
                                {missingDates.map(date => {
                                    const dateKey = date.toISOString().split('T')[0]
                                    const dateLabel = date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
                                    const isMissing = hasAttemptedSave && attendanceData[dateKey] === null

                                    return (
                                        <div key={dateKey} className={`flex items-center justify-between p-3 rounded-lg ${isMissing
                                            ? 'bg-red-50 dark:bg-red-900/10 border border-red-300 dark:border-red-700'
                                            : 'bg-gray-50 dark:bg-gray-700'
                                            }`}>
                                            <span className={`text-sm font-medium ${isMissing ? 'text-red-800 dark:text-red-200' : 'text-gray-700 dark:text-gray-300'}`}>
                                                {dateLabel} {isMissing && '(Required)'}
                                            </span>
                                            <div className="flex gap-2">
                                                <button
                                                    onClick={() => handleAttendanceChange(dateKey, true)}
                                                    className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${attendanceData[dateKey] === true
                                                        ? 'bg-green-600 text-white'
                                                        : 'bg-gray-200 dark:bg-gray-600 text-gray-700 dark:text-gray-300 hover:bg-green-100 dark:hover:bg-green-900'
                                                        }`}
                                                >
                                                    Present
                                                </button>
                                                <button
                                                    onClick={() => handleAttendanceChange(dateKey, false)}
                                                    className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${attendanceData[dateKey] === false
                                                        ? 'bg-red-600 text-white'
                                                        : 'bg-gray-200 dark:bg-gray-600 text-gray-700 dark:text-gray-300 hover:bg-red-100 dark:hover:bg-red-900'
                                                        }`}
                                                >
                                                    Absent
                                                </button>
                                            </div>
                                        </div>
                                    )
                                })}
                            </div>
                        </div>
                    )}
                </div>

                {/* Footer with Save button */}
                <div className="sticky bottom-0 bg-gray-50/90 dark:bg-gray-900/90 backdrop-blur-sm border-t border-gray-200 dark:border-gray-700 px-6 py-4 flex justify-end gap-3 z-10 rounded-b-3xl">
                    <button
                        onClick={onClose}
                        className="px-4 py-2 bg-gray-200 hover:bg-gray-300 dark:bg-gray-700 dark:hover:bg-gray-600 text-gray-700 dark:text-gray-300 rounded-lg transition-colors btn-press"
                        disabled={isSaving}
                    >
                        Cancel
                    </button>
                    <button
                        onClick={handleSave}
                        className={`px-6 py-2 rounded-lg font-medium transition-colors btn-press ${isSaving
                            ? 'bg-gray-300 dark:bg-gray-700 text-gray-500 dark:text-gray-500 cursor-not-allowed'
                            : (isOverrideMode ? 'bg-orange-600 hover:bg-orange-700 text-white' : 'bg-primary-600 hover:bg-primary-700 text-white')
                            }`}
                        disabled={isSaving}
                    >
                        {isSaving ? 'Saving...' : (isOverrideMode ? 'Save (Override)' : 'Save')}
                    </button>
                </div>
            </div >
        </div >
    )
}

export default MissingDataModal
