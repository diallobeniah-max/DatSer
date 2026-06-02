import React, { useState, useRef, useEffect } from 'react'
import { createPortal } from 'react-dom'
import { ChevronDown, Calendar, ChevronLeft, ChevronRight } from 'lucide-react'
import useBottomSheetDrag from '../hooks/useBottomSheetDrag'

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']
const DAYS = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT']

const getDaysInMonth = (year, month) => new Date(year, month + 1, 0).getDate()
const getFirstDayOfMonth = (year, month) => new Date(year, month, 1).getDay()

const CombinedDatePicker = ({
  name,
  value,
  onChange,
  placeholder = 'Select date',
  label,
  error,
  disabled = false,
  birthDateMode = 'combined',
  dropdownPlacement = 'auto',
  className = ''
}) => {
  const [isOpen, setIsOpen] = useState(false)
  const [dropdownStyle, setDropdownStyle] = useState({})
  const [isSheetViewport, setIsSheetViewport] = useState(false)
  const containerRef = useRef(null)
  const dropdownRef = useRef(null)

  const pickerId = String(name || label || placeholder || 'date').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
  const pickerSearchText = String([name, label, placeholder].filter(Boolean).join(' ')).toLowerCase()
  const isBirthDatePicker = pickerSearchText.includes('date_of_birth') || pickerSearchText.includes('birth') || pickerSearchText.includes('dob')
  const isCombinedBirthDateMode = isBirthDatePicker && birthDateMode === 'combined'

  const [selectedDate, setSelectedDate] = useState(null)
  const [viewDate, setViewDate] = useState(new Date())
  const [viewMode, setViewMode] = useState('grid')
  const [monthYearStartDate, setMonthYearStartDate] = useState(null)
  const [monthYearTouched, setMonthYearTouched] = useState({ month: false, year: false })
  const [combinedTouched, setCombinedTouched] = useState({ day: false, month: false, year: false })
  const { dragHandleProps, sheetStyle } = useBottomSheetDrag({
    enabled: isOpen && isSheetViewport,
    onDismiss: () => setIsOpen(false)
  })

  useEffect(() => {
    const checkSheetViewport = () => setIsSheetViewport(window.innerWidth <= 1024)
    checkSheetViewport()
    window.addEventListener('resize', checkSheetViewport)
    return () => window.removeEventListener('resize', checkSheetViewport)
  }, [])

  useEffect(() => {
    if (value) {
      const parts = value.split('-')
      if (parts.length === 3) {
        const d = new Date(parseInt(parts[0]), parseInt(parts[1]) - 1, parseInt(parts[2]))
        if (!isNaN(d.getTime())) {
          setSelectedDate(d)
          if (!isOpen) setViewDate(d)
        }
      }
    } else {
      setSelectedDate(null)
    }
  }, [value, isOpen])

  const toggleDropdown = () => {
    if (disabled) return
    if (!isOpen) {
      const sheetViewport = window.innerWidth <= 1024
      const nextViewDate = selectedDate || (isBirthDatePicker
        ? new Date(new Date().getFullYear() - 18, new Date().getMonth(), 1)
        : new Date())
      const shouldStartWithMonthYear = isBirthDatePicker && !selectedDate && !value
      
      if (!sheetViewport && containerRef.current) {
        const rect = containerRef.current.getBoundingClientRect()
        const spaceBelow = window.innerHeight - rect.bottom
        const spaceAbove = rect.top
        const dropdownHeight = 430
        const openUpwards = dropdownPlacement !== 'below' && spaceBelow < dropdownHeight && spaceAbove > spaceBelow
        const insideModal = Boolean(containerRef.current.closest('[data-testid="add-member-modal"], [data-testid="edit-member-modal"], [data-testid="missing-data-modal"]'))
        
        const dropdownWidth = 340 // Wider for desktop
        let calcLeft = rect.left
        if (calcLeft + dropdownWidth > window.innerWidth - 16) {
          calcLeft = window.innerWidth - dropdownWidth - 16
        }
        calcLeft = Math.max(16, calcLeft)

        const unclampedTop = rect.bottom + 8
        const clampedTop = dropdownPlacement === 'below'
          ? unclampedTop
          : Math.max(16, Math.min(unclampedTop, window.innerHeight - dropdownHeight - 16))

        setDropdownStyle({
          position: 'fixed',
          top: insideModal ? `${Math.max(16, Math.round((window.innerHeight - dropdownHeight) / 2))}px` : (openUpwards ? 'auto' : `${clampedTop}px`),
          bottom: insideModal ? 'auto' : (openUpwards ? `${window.innerHeight - rect.top + 8}px` : 'auto'),
          left: insideModal ? `${Math.max(16, Math.round((window.innerWidth - dropdownWidth) / 2))}px` : `${calcLeft}px`,
          width: `${dropdownWidth}px`,
          zIndex: 999999
        })
      }
      
      setViewDate(nextViewDate)
      setViewMode(isCombinedBirthDateMode ? 'combined' : (shouldStartWithMonthYear ? 'wheels' : 'grid'))
      setMonthYearStartDate(shouldStartWithMonthYear ? nextViewDate : null)
      setMonthYearTouched(selectedDate ? { month: true, year: true } : { month: false, year: false })
      setCombinedTouched(selectedDate ? { day: true, month: true, year: true } : { day: false, month: false, year: false })
      setIsOpen(true)
    } else {
      setIsOpen(false)
    }
  }

  useEffect(() => {
    const handleClickOutside = (e) => {
      if (isSheetViewport) return // Handled by overlay click on sheet viewports
      if (containerRef.current && containerRef.current.contains(e.target)) return
      if (dropdownRef.current && dropdownRef.current.contains(e.target)) return
      setIsOpen(false)
    }
    if (isOpen && !isSheetViewport) {
      document.addEventListener('mousedown', handleClickOutside)
      return () => document.removeEventListener('mousedown', handleClickOutside)
    }
  }, [isOpen, isSheetViewport])

  const handleSave = () => {
    if (selectedDate) {
      const y = selectedDate.getFullYear()
      const m = String(selectedDate.getMonth() + 1).padStart(2, '0')
      const d = String(selectedDate.getDate()).padStart(2, '0')
      const dateVal = `${y}-${m}-${d}`
      
      if (name) onChange({ target: { name, value: dateVal } })
      else onChange(dateVal)
    }
    setIsOpen(false)
  }

  const handleCancel = () => {
    setViewMode('grid')
    setMonthYearStartDate(null)
    setIsOpen(false)
    if (value) {
      const parts = value.split('-')
      if (parts.length === 3) {
        const date = new Date(parseInt(parts[0]), parseInt(parts[1]) - 1, parseInt(parts[2]))
        setSelectedDate(date)
        setViewDate(date)
      }
    } else {
      setSelectedDate(null)
    }
  }

  const openMonthYearSelector = () => {
    setMonthYearStartDate(viewDate)
    setMonthYearTouched(selectedDate ? { month: true, year: true } : { month: false, year: false })
    setViewMode('wheels')
  }

  const handleMonthYearCancel = () => {
    if (monthYearStartDate) {
      setViewDate(monthYearStartDate)
    }
    setMonthYearStartDate(null)
    setViewMode('grid')
  }

  const handleMonthYearApply = () => {
    if (!monthYearTouched.month || !monthYearTouched.year) return
    setMonthYearStartDate(null)
    setViewMode('grid')
  }

  const handleCombinedMonthChange = (month) => {
    const currentDay = selectedDate?.getDate() || viewDate.getDate()
    const maxDay = getDaysInMonth(currentYear, month)
    const nextDate = new Date(currentYear, month, Math.min(currentDay, maxDay))
    setViewDate(nextDate)
    setCombinedTouched((current) => ({ ...current, month: true }))
    if (selectedDate) setSelectedDate(nextDate)
  }

  const handleCombinedYearChange = (year) => {
    const currentDay = selectedDate?.getDate() || viewDate.getDate()
    const maxDay = getDaysInMonth(year, currentMonth)
    const nextDate = new Date(year, currentMonth, Math.min(currentDay, maxDay))
    setViewDate(nextDate)
    setCombinedTouched((current) => ({ ...current, year: true }))
    if (selectedDate) setSelectedDate(nextDate)
  }

  const handleCombinedDayChange = (day) => {
    const nextDate = new Date(currentYear, currentMonth, day)
    setViewDate(nextDate)
    setCombinedTouched((current) => ({ ...current, day: true }))
    setSelectedDate(nextDate)
  }

  const handleClear = (e) => {
    e.stopPropagation()
    if (name) onChange({ target: { name, value: '' } })
    else onChange('')
    setSelectedDate(null)
    setIsOpen(false)
  }

  const currentYear = viewDate.getFullYear()
  const currentMonth = viewDate.getMonth()
  const daysInMonth = getDaysInMonth(currentYear, currentMonth)
  const firstDay = getFirstDayOfMonth(currentYear, currentMonth)
  
  const days = []
  for (let i = 0; i < firstDay; i++) days.push(null)
  for (let i = 1; i <= daysInMonth; i++) days.push(i)

  const isSelected = (day) => {
    if (!selectedDate || !day) return false
    return selectedDate.getDate() === day && selectedDate.getMonth() === currentMonth && selectedDate.getFullYear() === currentYear
  }

  const isToday = (day) => {
    if (!day) return false
    const today = new Date()
    return today.getDate() === day && today.getMonth() === currentMonth && today.getFullYear() === currentYear
  }

  const onDayClick = (day) => {
    if (!day) return
    setSelectedDate(new Date(currentYear, currentMonth, day))
  }

  const currentYearActual = new Date().getFullYear()
  const years = Array.from({ length: 120 }, (_, i) => currentYearActual - i)

  const getDisplayText = () => {
    if (!selectedDate) return null
    return `${MONTHS[selectedDate.getMonth()]} ${selectedDate.getDate()}, ${selectedDate.getFullYear()}`
  }
  const displayText = getDisplayText()
  const canApplyMonthYear = monthYearTouched.month && monthYearTouched.year
  const canSaveDate = viewMode === 'wheels'
    ? canApplyMonthYear
    : viewMode === 'combined'
      ? Boolean(selectedDate && combinedTouched.day && combinedTouched.month && combinedTouched.year)
      : Boolean(selectedDate)
  const selectedPickerClass = 'text-orange-700 dark:text-orange-300 font-bold bg-orange-100 dark:bg-orange-500/15 border border-orange-200 dark:border-orange-400/25 shadow-sm transition-none'

  return (
    <div ref={containerRef} className={`relative ${className}`}>
      {label && <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">{label}</label>}
      
      <button
        type="button"
        onClick={toggleDropdown}
        disabled={disabled}
        data-testid={`combined-date-picker-${pickerId}-toggle`}
        className={`
          w-full flex items-center justify-between px-3 py-2.5 text-left
          bg-white dark:bg-gray-800 border rounded-lg
          transition-all duration-150 ease-in-out min-h-[44px]
          ${error ? 'border-red-500 dark:border-red-500 ring-1 ring-red-500/20' : isOpen ? 'border-primary-500 dark:border-primary-400 ring-1 ring-primary-500/20' : 'border-gray-300 dark:border-gray-600'}
          ${disabled ? 'opacity-50 cursor-not-allowed bg-gray-100 dark:bg-gray-900' : 'cursor-pointer hover:border-gray-400 dark:hover:border-gray-500'}
        `}
      >
        <span className={`text-sm flex items-center gap-2 ${displayText ? 'text-gray-900 dark:text-white font-medium' : 'text-gray-400'}`}>
          <Calendar className="w-4 h-4 opacity-70 flex-shrink-0" />
          {displayText || placeholder}
        </span>
        <div className="flex items-center gap-1">
          {displayText && (
            <span role="button" tabIndex={0} onMouseDown={handleClear} onKeyDown={(e) => e.key === 'Enter' && handleClear(e)} className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 text-sm px-1.5 py-0.5 rounded transition-colors" title="Clear date">
              ×
            </span>
          )}
          <ChevronDown className={`w-4 h-4 text-gray-400 transition-transform duration-200 ${isOpen ? 'rotate-180' : ''}`} />
        </div>
      </button>

      {isOpen && typeof document !== 'undefined' && createPortal(
        <>
          {/* Sheet Overlay */}
          {isSheetViewport && (
            <div 
              className="fixed inset-0 bg-black/70 z-[999998] backdrop-blur-md backdrop-animate"
              onClick={() => setIsOpen(false)}
            />
          )}

          {/* Dropdown / Bottom Sheet */}
          <div
            ref={dropdownRef}
            data-testid={`combined-date-picker-${pickerId}-dropdown`}
            className={`
              bg-white text-gray-900 dark:bg-[#2F3030] dark:text-gray-100 shadow-2xl overflow-hidden font-sans z-[999999] flex flex-col ${isBirthDatePicker ? 'date-picker-birth' : ''}
              ${isSheetViewport 
                ? 'fixed bottom-0 left-0 right-0 w-full rounded-t-2xl filter-enter pb-safe' 
                : 'border border-gray-200 dark:border-gray-700/60 rounded-xl animate-scale-in'
              }
            `}
            style={isSheetViewport ? { paddingBottom: 'max(16px, env(safe-area-inset-bottom, 16px))', ...sheetStyle } : { ...dropdownStyle, transformOrigin: dropdownStyle.bottom !== 'auto' ? 'bottom' : 'top' }}
          >
            {isSheetViewport && (
              <div
                className="mobile-sheet-drag-zone flex justify-center pt-3 pb-1 flex-shrink-0 bg-white dark:bg-[#2F3030]"
                role="button"
                tabIndex={0}
                aria-label="Drag down to close date picker"
                {...dragHandleProps}
              >
                <div className="w-10 h-1.5 rounded-full bg-gray-300 dark:bg-gray-600" />
              </div>
            )}

            {viewMode === 'grid' ? (
              <>
                {/* Header */}
                <div className="flex items-center justify-between px-4 pt-4 pb-3">
                  <button
                    type="button"
                    onClick={openMonthYearSelector}
                    aria-label={`${MONTHS[currentMonth]} ${currentYear}. Tap to change month and year`}
                    className="flex items-center gap-2 rounded-xl border border-gray-200 dark:border-gray-800 bg-gray-50 dark:bg-gray-900/80 px-3 py-2 text-left text-gray-900 dark:text-gray-100 hover:border-orange-300 hover:bg-orange-50/70 dark:hover:bg-orange-500/10 transition-colors group"
                  >
                    <span className="flex flex-col leading-tight">
                      <span className="text-[16px] font-semibold">{MONTHS[currentMonth]} {currentYear}</span>
                      <span className="text-[10px] font-medium text-gray-500 dark:text-gray-400">Tap to change month/year</span>
                    </span>
                    <ChevronDown className="w-4 h-4 text-gray-400 dark:text-gray-500 group-hover:text-orange-600 dark:group-hover:text-orange-400 transition-colors" />
                  </button>
                  <div className="flex items-center gap-3">
                    <button onClick={() => setViewDate(new Date(currentYear, currentMonth - 1, 1))} className="text-orange-600 dark:text-orange-400 hover:bg-orange-50 dark:hover:bg-orange-500/10 rounded-full p-1.5 transition-colors">
                      <ChevronLeft className="w-6 h-6" />
                    </button>
                    <button onClick={() => setViewDate(new Date(currentYear, currentMonth + 1, 1))} className="text-orange-600 dark:text-orange-400 hover:bg-orange-50 dark:hover:bg-orange-500/10 rounded-full p-1.5 transition-colors">
                      <ChevronRight className="w-6 h-6" />
                    </button>
                  </div>
                </div>

                {/* Days Header */}
                <div className="grid grid-cols-7 px-3 pb-2">
                  {DAYS.map(d => (
                    <div key={d} className="text-[11px] font-semibold text-gray-500 dark:text-gray-400 text-center tracking-wider">{d}</div>
                  ))}
                </div>

                {/* Days Grid */}
                <div className="grid grid-cols-7 px-3 pb-4 gap-y-2 gap-x-1">
                  {days.map((day, idx) => (
                    <div key={idx} className="flex items-center justify-center h-10">
                      {day && (
                        <button
                          onClick={() => onDayClick(day)}
                          className={`w-10 h-10 rounded-full flex items-center justify-center text-[17px] transition-all
                            ${isSelected(day) 
                              ? selectedPickerClass
                              : isToday(day)
                                ? 'text-orange-600 dark:text-orange-400 font-semibold hover:bg-orange-50 dark:hover:bg-orange-500/10'
                                : 'text-gray-800 dark:text-gray-100 hover:bg-gray-100 dark:hover:bg-gray-800'
                            }
                          `}
                        >
                          {day}
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              </>
            ) : viewMode === 'combined' ? (
              <div className="flex flex-col h-[420px]">
                <div className="px-4 py-3 border-b border-gray-200 dark:border-gray-800/60">
                  <span className="font-semibold text-gray-900 dark:text-gray-100 text-[16px]">Select Date of Birth</span>
                  <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">Pick day, month, and year together</p>
                </div>
                <div className="grid grid-cols-3 border-b border-gray-100 bg-gray-50 text-[11px] font-bold uppercase tracking-wide text-gray-500 dark:border-gray-800/60 dark:bg-[#252626] dark:text-gray-300">
                  <div className="px-2 py-2 text-center border-r border-gray-100 dark:border-gray-800/60">Date</div>
                  <div className="px-2 py-2 text-center border-r border-gray-100 dark:border-gray-800/60">Month</div>
                  <div className="px-2 py-2 text-center">Year</div>
                </div>
                <div className="flex-1 grid grid-cols-3 overflow-hidden bg-white dark:bg-[#151515]">
                  <div className="overflow-y-auto border-r border-gray-100 dark:border-gray-800/60 p-2 space-y-1" style={{ scrollbarWidth: 'none', msOverflowStyle: 'none' }}>
                    {Array.from({ length: daysInMonth }, (_, i) => i + 1).map(day => (
                      <button
                        key={day}
                        type="button"
                        onClick={() => handleCombinedDayChange(day)}
                        className={`w-full py-3 text-center text-[16px] rounded-xl ${selectedDate && selectedDate.getDate() === day && selectedDate.getMonth() === currentMonth && selectedDate.getFullYear() === currentYear ? selectedPickerClass : 'text-gray-700 dark:text-gray-300 hover:bg-orange-50 dark:hover:bg-orange-500/10 transition-colors'}`}
                      >
                        {day}
                      </button>
                    ))}
                  </div>
                  <div className="overflow-y-auto border-r border-gray-100 dark:border-gray-800/60 p-2 space-y-1" style={{ scrollbarWidth: 'none', msOverflowStyle: 'none' }}>
                    {MONTHS.map((m, i) => (
                      <button 
                        key={m} 
                        type="button"
                        onClick={() => handleCombinedMonthChange(i)}
                        className={`w-full py-3 text-center text-[16px] rounded-xl ${combinedTouched.month && currentMonth === i ? selectedPickerClass : 'text-gray-700 dark:text-gray-300 hover:bg-orange-50 dark:hover:bg-orange-500/10 transition-colors'}`}
                      >
                        {m}
                      </button>
                    ))}
                  </div>
                  <div className="overflow-y-auto p-2 space-y-1" style={{ scrollbarWidth: 'none', msOverflowStyle: 'none' }}>
                    {years.map(y => (
                      <button 
                        key={y} 
                        type="button"
                        onClick={() => handleCombinedYearChange(y)}
                        className={`w-full py-3 text-center text-[16px] rounded-xl ${combinedTouched.year && currentYear === y ? selectedPickerClass : 'text-gray-700 dark:text-gray-300 hover:bg-orange-50 dark:hover:bg-orange-500/10 transition-colors'}`}
                      >
                        {y}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            ) : (
              <div className="flex flex-col h-[380px]">
                <div className="flex items-center justify-between px-4 py-3 border-b border-gray-200 dark:border-gray-800/60">
                   <button type="button" onClick={handleMonthYearCancel} className="text-gray-600 dark:text-gray-400 font-medium flex items-center text-[16px] hover:opacity-70 transition-opacity">
                     <ChevronLeft className="w-5 h-5 -ml-1" /> Cancel
                   </button>
                   <span className="font-semibold text-gray-900 dark:text-gray-100 text-[16px]">Select Month & Year</span>
                   <button
                     type="button"
                     onClick={handleMonthYearApply}
                     disabled={!canApplyMonthYear}
                     className={`font-semibold text-[16px] transition-opacity ${canApplyMonthYear ? 'text-orange-600 dark:text-orange-400 hover:opacity-70' : 'text-gray-400 dark:text-gray-500 cursor-not-allowed'}`}
                   >
                     Done
                   </button>
                </div>
                <div className="flex-1 flex px-3 overflow-hidden bg-white dark:bg-[#151515]">
                  {/* Months Scroll */}
                  <div className="flex-1 overflow-y-auto border-r border-gray-100 dark:border-gray-800/60 p-2 space-y-1" style={{ scrollbarWidth: 'none', msOverflowStyle: 'none' }}>
                    {MONTHS.map((m, i) => (
                      <button 
                        key={m} 
                        onClick={() => { setViewDate(new Date(currentYear, i, 1)); setMonthYearTouched((current) => ({ ...current, month: true })) }}
                        className={`w-full py-3 text-center text-[16px] rounded-xl ${monthYearTouched.month && currentMonth === i ? selectedPickerClass : 'text-gray-700 dark:text-gray-300 hover:bg-orange-50 dark:hover:bg-orange-500/10 transition-colors'}`}
                      >
                        {m}
                      </button>
                    ))}
                  </div>
                  {/* Years Scroll */}
                  <div className="flex-1 overflow-y-auto p-2 space-y-1" style={{ scrollbarWidth: 'none', msOverflowStyle: 'none' }}>
                    {years.map(y => (
                      <button 
                        key={y} 
                        onClick={() => { setViewDate(new Date(y, currentMonth, 1)); setMonthYearTouched((current) => ({ ...current, year: true })) }}
                        className={`w-full py-3 text-center text-[16px] rounded-xl ${monthYearTouched.year && currentYear === y ? selectedPickerClass : 'text-gray-700 dark:text-gray-300 hover:bg-orange-50 dark:hover:bg-orange-500/10 transition-colors'}`}
                      >
                        {y}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            )}

            {/* Footer (Cancel / Save) */}
            <div className="flex items-center justify-between px-6 py-4 border-t border-gray-100 dark:border-gray-800/60 bg-gray-50/50 dark:bg-[#1a1a1c]">
              <button 
                onClick={viewMode === 'wheels' ? handleMonthYearCancel : handleCancel}
                className="text-[17px] text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-100 transition-colors font-medium px-4 py-2 bg-gray-200/50 dark:bg-gray-800/50 rounded-xl"
              >
                {viewMode === 'wheels' ? 'Back' : 'Cancel'}
              </button>
              <button 
                onClick={viewMode === 'wheels' ? handleMonthYearApply : handleSave}
                disabled={!canSaveDate}
                className={`text-[17px] text-white transition-colors font-semibold px-8 py-2 rounded-xl shadow-sm ${canSaveDate ? 'bg-orange-600 hover:bg-orange-700 shadow-black/20' : 'bg-gray-500/40 dark:bg-gray-700/70 cursor-not-allowed opacity-70'}`}
              >
                {viewMode === 'wheels' ? 'Apply' : 'Save'}
              </button>
            </div>
          </div>
        </>,
        document.body
      )}
      {error && <p className="text-xs text-red-600 dark:text-red-400 mt-1">{error}</p>}
    </div>
  )
}

export default CombinedDatePicker
