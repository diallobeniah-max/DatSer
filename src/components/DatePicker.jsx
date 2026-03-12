import React, { useState, useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import { Calendar, ChevronLeft, ChevronRight, ChevronDown, X, Check } from 'lucide-react'
import useHapticFeedback from '../hooks/useHapticFeedback'

const DatePicker = ({ 
    value, 
    onChange, 
    label, 
    placeholder = "Select date", 
    error, 
    disabled = false,
    minDate,
    maxDate,
    name
}) => {
    const [isOpen, setIsOpen] = useState(false)
    const [viewDate, setViewDate] = useState(new Date()) // The month currently being viewed
    const [showYearPicker, setShowYearPicker] = useState(false)
    const [showMonthPicker, setShowMonthPicker] = useState(false)
    
    const containerRef = useRef(null)
    const popupRef = useRef(null)
    const { selection } = useHapticFeedback()

    // Initialize viewDate from value or today
    useEffect(() => {
        if (value) {
            const date = new Date(value)
            if (!isNaN(date.getTime())) {
                setViewDate(date)
            }
        }
    }, [isOpen, value])

    // Close on click outside
    useEffect(() => {
        const handleClickOutside = (e) => {
            if (containerRef.current && !containerRef.current.contains(e.target) &&
                popupRef.current && !popupRef.current.contains(e.target)) {
                setIsOpen(false)
                setShowYearPicker(false)
                setShowMonthPicker(false)
            }
        }
        
        if (isOpen) {
            document.addEventListener('mousedown', handleClickOutside)
            return () => document.removeEventListener('mousedown', handleClickOutside)
        }
    }, [isOpen])

    // Calculate position (basic implementation - could be improved with popper.js but simple is fine here)
    const [popupPosition, setPopupPosition] = useState({ top: 0, left: 0 })
    
    useEffect(() => {
        if (isOpen && containerRef.current) {
            const rect = containerRef.current.getBoundingClientRect()
            const screenHeight = window.innerHeight
            const popupHeight = 350 // Approximate max height
            
            // Check if popup fits below, otherwise show above
            let top = rect.bottom + window.scrollY + 8
            if (rect.bottom + popupHeight > screenHeight) {
                top = rect.top + window.scrollY - popupHeight - 8
            }

            setPopupPosition({
                top,
                left: rect.left + window.scrollX,
                width: rect.width
            })
        }
    }, [isOpen])

    const months = [
        'January', 'February', 'March', 'April', 'May', 'June',
        'July', 'August', 'September', 'October', 'November', 'December'
    ]

    const getDaysInMonth = (year, month) => {
        return new Date(year, month + 1, 0).getDate()
    }

    const getFirstDayOfMonth = (year, month) => {
        return new Date(year, month, 1).getDay()
    }

    const handleDateClick = (day) => {
        const newDate = new Date(viewDate.getFullYear(), viewDate.getMonth(), day)
        // Format as YYYY-MM-DD for consistency with HTML date input
        const formattedDate = newDate.toISOString().split('T')[0]
        
        selection()
        onChange({ target: { name, value: formattedDate } })
        setIsOpen(false)
    }

    const handlePrevMonth = () => {
        setViewDate(new Date(viewDate.getFullYear(), viewDate.getMonth() - 1, 1))
    }

    const handleNextMonth = () => {
        setViewDate(new Date(viewDate.getFullYear(), viewDate.getMonth() + 1, 1))
    }

    const handleYearClick = (year) => {
        setViewDate(new Date(year, viewDate.getMonth(), 1))
        setShowYearPicker(false)
    }

    const handleMonthClick = (monthIndex) => {
        setViewDate(new Date(viewDate.getFullYear(), monthIndex, 1))
        setShowMonthPicker(false)
    }

    const clearDate = (e) => {
        e.stopPropagation()
        selection()
        onChange({ target: { name, value: '' } })
    }

    const setToday = () => {
        const today = new Date()
        const formattedDate = today.toISOString().split('T')[0]
        selection()
        onChange({ target: { name, value: formattedDate } })
        setViewDate(today)
        setIsOpen(false)
    }

    // Generate days grid
    const daysInMonth = getDaysInMonth(viewDate.getFullYear(), viewDate.getMonth())
    const firstDay = getFirstDayOfMonth(viewDate.getFullYear(), viewDate.getMonth())
    const days = []
    
    // Empty slots for days before start of month
    for (let i = 0; i < firstDay; i++) {
        days.push(<div key={`empty-${i}`} className="h-8 w-8" />)
    }

    // Days of month
    for (let day = 1; day <= daysInMonth; day++) {
        const date = new Date(viewDate.getFullYear(), viewDate.getMonth(), day)
        const dateStr = date.toISOString().split('T')[0]
        const isSelected = value === dateStr
        const isToday = new Date().toDateString() === date.toDateString()
        
        days.push(
            <button
                key={day}
                type="button"
                onClick={() => handleDateClick(day)}
                className={`h-8 w-8 rounded-full flex items-center justify-center text-sm transition-colors
                    ${isSelected 
                        ? 'bg-blue-600 text-white font-bold shadow-md' 
                        : isToday 
                            ? 'bg-blue-100 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400 font-semibold border border-blue-200 dark:border-blue-800'
                            : 'text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700'
                    }
                `}
            >
                {day}
            </button>
        )
    }

    // Generate years for picker (1900 - current + 10)
    const currentYear = new Date().getFullYear()
    const years = []
    for (let y = currentYear + 10; y >= 1900; y--) {
        years.push(y)
    }

    // Format display value
    const displayValue = value ? new Date(value).toLocaleDateString('en-US', {
        year: 'numeric',
        month: 'long',
        day: 'numeric'
    }) : ''

    return (
        <div className="relative w-full" ref={containerRef}>
            {label && (
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                    {label}
                </label>
            )}
            
            <div 
                onClick={() => !disabled && setIsOpen(!isOpen)}
                className={`
                    relative w-full pl-10 pr-10 py-2 rounded-lg border bg-white dark:bg-gray-700 
                    text-gray-900 dark:text-white placeholder-gray-500 dark:placeholder-gray-400 
                    transition-all duration-200 cursor-pointer flex items-center
                    ${disabled ? 'opacity-60 cursor-not-allowed bg-gray-50 dark:bg-gray-800' : 'hover:border-gray-400 dark:hover:border-gray-500'}
                    ${error ? 'border-red-500 ring-1 ring-red-400' : isOpen ? 'border-blue-500 ring-1 ring-blue-500' : 'border-gray-300 dark:border-gray-600'}
                `}
            >
                <div className="absolute inset-y-0 left-0 flex items-center pl-3 pointer-events-none">
                    <Calendar className="w-4 h-4 text-gray-500 dark:text-gray-400" />
                </div>
                
                <span className={`block truncate ${!displayValue && 'text-gray-500 dark:text-gray-400'}`}>
                    {displayValue || placeholder}
                </span>

                {value && !disabled && (
                    <div 
                        onClick={clearDate}
                        className="absolute inset-y-0 right-0 flex items-center pr-2"
                    >
                        <div className="p-1 hover:bg-gray-200 dark:hover:bg-gray-600 rounded-full transition-colors">
                            <X className="w-3 h-3 text-gray-400" />
                        </div>
                    </div>
                )}
            </div>

            {/* Calendar Popup */}
            {isOpen && createPortal(
                <div 
                    ref={popupRef}
                    className="fixed z-[9999] bg-white dark:bg-gray-800 rounded-xl shadow-xl border border-gray-200 dark:border-gray-700 p-4 w-[300px] animate-scale-in"
                    style={{ 
                        top: popupPosition.top, 
                        left: popupPosition.left,
                        width: '300px' // Fixed width for calendar
                    }}
                >
                    {/* Header */}
                    <div className="flex items-center justify-between mb-4">
                        <button 
                            type="button"
                            onClick={handlePrevMonth}
                            className="p-1 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-full transition-colors"
                        >
                            <ChevronLeft className="w-5 h-5 text-gray-600 dark:text-gray-300" />
                        </button>
                        
                        <div className="flex items-center gap-2">
                            <button
                                type="button"
                                onClick={() => { setShowMonthPicker(!showMonthPicker); setShowYearPicker(false); }}
                                className="text-sm font-semibold text-gray-800 dark:text-white hover:bg-gray-100 dark:hover:bg-gray-700 px-2 py-1 rounded transition-colors flex items-center gap-1"
                            >
                                {months[viewDate.getMonth()]}
                                <ChevronDown className={`w-3 h-3 transition-transform ${showMonthPicker ? 'rotate-180' : ''}`} />
                            </button>
                            <button
                                type="button"
                                onClick={() => { setShowYearPicker(!showYearPicker); setShowMonthPicker(false); }}
                                className="text-sm font-semibold text-gray-800 dark:text-white hover:bg-gray-100 dark:hover:bg-gray-700 px-2 py-1 rounded transition-colors flex items-center gap-1"
                            >
                                {viewDate.getFullYear()}
                                <ChevronDown className={`w-3 h-3 transition-transform ${showYearPicker ? 'rotate-180' : ''}`} />
                            </button>
                        </div>

                        <button 
                            type="button"
                            onClick={handleNextMonth}
                            className="p-1 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-full transition-colors"
                        >
                            <ChevronRight className="w-5 h-5 text-gray-600 dark:text-gray-300" />
                        </button>
                    </div>

                    {/* Pickers Overlay */}
                    {showMonthPicker && (
                        <div className="absolute inset-0 bg-white dark:bg-gray-800 z-10 p-2 rounded-xl grid grid-cols-3 gap-2">
                            {months.map((m, i) => (
                                <button
                                    key={m}
                                    type="button"
                                    onClick={() => handleMonthClick(i)}
                                    className={`text-sm py-2 rounded-lg transition-colors ${
                                        viewDate.getMonth() === i
                                        ? 'bg-blue-600 text-white'
                                        : 'hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-700 dark:text-gray-300'
                                    }`}
                                >
                                    {m.slice(0, 3)}
                                </button>
                            ))}
                        </div>
                    )}

                    {showYearPicker && (
                        <div className="absolute inset-0 bg-white dark:bg-gray-800 z-10 p-2 rounded-xl grid grid-cols-4 gap-2 overflow-y-auto max-h-[300px] scrollbar-hide">
                            {years.map(y => (
                                <button
                                    key={y}
                                    type="button"
                                    onClick={() => handleYearClick(y)}
                                    ref={y === viewDate.getFullYear() ? (el) => el?.scrollIntoView({ block: 'center' }) : null}
                                    className={`text-sm py-2 rounded-lg transition-colors ${
                                        viewDate.getFullYear() === y
                                        ? 'bg-blue-600 text-white'
                                        : 'hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-700 dark:text-gray-300'
                                    }`}
                                >
                                    {y}
                                </button>
                            ))}
                        </div>
                    )}

                    {/* Days Grid */}
                    <div className="grid grid-cols-7 gap-1 mb-2">
                        {['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'].map(day => (
                            <div key={day} className="h-8 flex items-center justify-center text-xs font-medium text-gray-400">
                                {day}
                            </div>
                        ))}
                        {days}
                    </div>

                    {/* Footer */}
                    <div className="flex items-center justify-between pt-3 border-t border-gray-100 dark:border-gray-700 mt-2">
                        <button
                            type="button"
                            onClick={clearDate}
                            className="text-xs text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200 font-medium px-2 py-1 rounded hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
                        >
                            Clear
                        </button>
                        <button
                            type="button"
                            onClick={setToday}
                            className="text-xs text-blue-600 hover:text-blue-700 dark:text-blue-400 dark:hover:text-blue-300 font-medium px-2 py-1 rounded hover:bg-blue-50 dark:hover:bg-blue-900/20 transition-colors"
                        >
                            Today
                        </button>
                    </div>
                </div>,
                document.body
            )}
        </div>
    )
}

export default DatePicker