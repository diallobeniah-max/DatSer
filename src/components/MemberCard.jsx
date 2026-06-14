import React, { memo } from 'react'
import { 
    ChevronDown, 
    ChevronRight, 
    Check, 
    Calendar, 
    Edit3, 
    Trash2, 
    StickyNote, 
    History 
} from 'lucide-react'
import MemberCodeBadge, { getAutoBadgeStyleKey } from './MemberCodeBadge'

const MemberCard = memo(({ 
    member, 
    memberIndexCode,
    isExpanded, 
    isSelected, 
    selectionMode, 
    onToggleExpansion, 
    onToggleSelection,
    onLongPressStart,
    onLongPressMove,
    onLongPressEnd,
    onMouseDown,
    onMouseUp,
    onAttendance,
    onAttendanceForDate,
    onEdit,
    onDelete,
    attendanceStatus, // Status for the currently selected attendance date
    attendanceLoading,
    monthSundays,
    attendanceData, // Full attendance data for the month
    memberTags = [],
    currentTable,
    getMonthDisplayName,
    showDeleteActions = true,
    onIndexClick,
    memberCodeBadgeStyle = 'soft',
    memberCodeBadgeCycleSlot = 0
}) => {
    const name = member.full_name || member['full_name'] || member['Full Name'] || member.name || member.Name || 'Unnamed member'
    const regDateRaw = member.inserted_at || member.created_at
    
    const getRelativeRegTime = () => {
        if (!regDateRaw) return null
        const regDate = new Date(regDateRaw)
        const now = new Date()
        const diffDays = Math.floor((now - regDate) / (1000 * 60 * 60 * 24))
        if (diffDays === 0) return 'Today'
        if (diffDays === 1) return 'Yesterday'
        if (diffDays < 7) return `${diffDays}d ago`
        return regDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
    }

    const isPresentSelected = attendanceStatus === true
    const isAbsentSelected = attendanceStatus === false
    const resolvedBadgeStyleKey = memberCodeBadgeStyle === 'auto'
        ? getAutoBadgeStyleKey({ member, code: memberIndexCode, cycleSlot: memberCodeBadgeCycleSlot })
        : (memberCodeBadgeStyle || 'soft')

    return (
        <div className={`member-card-shell relative transition-colors duration-200`}>
            {/* Selection checkmark */}
            {isSelected && (
                <div className="selection-checkmark">
                    <Check className="w-3 h-3 text-white" />
                </div>
            )}
            <div
                className={`member-card relative bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl hover:border-primary-300 dark:hover:border-primary-600 shadow-sm hover:shadow-md transition-all duration-200 overflow-hidden w-[96%] sm:w-full mx-auto ${isSelected ? 'selection-highlight' : ''}`}
                style={{ touchAction: 'pan-y', userSelect: 'none' }}
                onTouchStart={(e) => !selectionMode && onLongPressStart(member.id, e)}
                onTouchMove={onLongPressMove}
                onTouchEnd={onLongPressEnd}
                onMouseDown={(e) => !selectionMode && onMouseDown(member.id, e)}
                onMouseMove={onLongPressMove}
                onMouseUp={onMouseUp}
                onMouseLeave={onMouseUp}
                onContextMenu={(e) => e.preventDefault()}
                onClick={() => selectionMode && onToggleSelection(member.id)}
            >
                <div className="member-card-inner px-0 py-3 sm:px-4 sm:py-3.5">
                    {/* Row 1: Expand toggle row */}
                    <div className="w-full px-3 sm:px-0">
                        <div
                            role="button"
                            tabIndex={0}
                            onClick={(e) => {
                                if (selectionMode) {
                                    e.stopPropagation()
                                    onToggleSelection(member.id)
                                } else {
                                    onToggleExpansion(member.id)
                                }
                            }}
                            onKeyDown={(e) => {
                                if (e.key !== 'Enter' && e.key !== ' ') return
                                e.preventDefault()
                                if (selectionMode) {
                                    e.stopPropagation()
                                    onToggleSelection(member.id)
                                } else {
                                    onToggleExpansion(member.id)
                                }
                            }}
                            className="member-card-header w-full flex items-center gap-2 mb-2 text-left hover:bg-primary-50 dark:hover:bg-primary-900/40 rounded px-1 py-1 transition-colors duration-150"
                        >
                            <div className="member-card-chevron p-1 text-gray-500 dark:text-gray-400 rounded flex-shrink-0 flex items-center justify-center">
                                {isExpanded ? <ChevronDown className="w-5 h-5" /> : <ChevronRight className="w-5 h-5" />}
                            </div>
                            <div className="flex-1 min-w-0">
                                <h3 className="member-card-name min-w-0 font-semibold text-gray-900 dark:text-white text-base sm:text-lg truncate">
                                    {name}
                                </h3>
                                {regDateRaw && (
                                    <p className="member-card-meta text-[10px] text-gray-400 dark:text-gray-500 mt-0.5">
                                        Joined {getRelativeRegTime()}
                                    </p>
                                )}
                            </div>
                            {memberIndexCode && (
                                <MemberCodeBadge
                                    as="button"
                                    type="button"
                                    code={memberIndexCode}
                                    styleKey={resolvedBadgeStyleKey}
                                    onPointerDown={(event) => event.stopPropagation()}
                                    onClick={(event) => {
                                        event.stopPropagation()
                                        onIndexClick?.(member)
                                    }}
                                    className="member-index-badge h-8 min-w-[4.75rem] px-4 text-xs transition hover:scale-105 focus:outline-none focus:ring-2 focus:ring-orange-500"
                                    title={`Member index ${memberIndexCode}`}
                                    aria-label={`Open member pass for ${name}, code ${memberIndexCode}`}
                                />
                            )}
                            <span className="hidden xs:inline text-[11px] text-gray-500 dark:text-gray-400 flex-shrink-0 ml-1">
                                {isExpanded ? 'Hide details' : 'Details'}
                            </span>
                        </div>
                    </div>

                    {/* Row 2: Attendance Buttons */}
                    <div className="member-card-actions flex items-stretch gap-2 ml-0 w-full px-3 sm:px-0">
                        <div className="flex flex-row items-stretch gap-2 w-full">
                            <button
                                onPointerDown={(event) => event.stopPropagation()}
                                onClick={(event) => {
                                    event.stopPropagation()
                                    onAttendance(member.id, true)
                                }}
                                disabled={attendanceLoading}
                                className={`member-card-action flex-1 px-2 py-2 rounded-lg text-xs font-medium transition-colors duration-150 whitespace-nowrap sm:text-sm md:text-sm ${isPresentSelected
                                    ? 'bg-orange-600 dark:bg-orange-800 text-white shadow ring-1 ring-orange-300 dark:ring-orange-500/70'
                                    : attendanceLoading
                                        ? 'bg-gray-200 dark:bg-gray-600 text-gray-400 cursor-not-allowed'
                                        : 'bg-orange-600 dark:bg-orange-800 text-white shadow-sm hover:bg-orange-700 dark:hover:bg-orange-700'
                                    }`}
                            >
                                {attendanceLoading ? '...' : 'Present'}
                            </button>
                            <button
                                onPointerDown={(event) => event.stopPropagation()}
                                onClick={(event) => {
                                    event.stopPropagation()
                                    onAttendance(member.id, false)
                                }}
                                disabled={attendanceLoading}
                                className={`member-card-action flex-1 px-2 py-2 rounded-lg text-xs font-medium transition-colors duration-150 whitespace-nowrap sm:text-sm md:text-sm ${isAbsentSelected
                                    ? 'bg-red-600 dark:bg-red-900 text-white shadow ring-1 ring-red-300 dark:ring-red-500/70'
                                    : attendanceLoading
                                        ? 'bg-gray-200 dark:bg-gray-600 text-gray-400 cursor-not-allowed'
                                        : 'bg-red-600 dark:bg-red-900 text-white shadow-sm hover:bg-red-700 dark:hover:bg-red-800'
                                    }`}
                            >
                                {attendanceLoading ? '...' : 'Absent'}
                            </button>
                        </div>
                        {showDeleteActions && (
                            <button
                                type="button"
                                onPointerDown={(e) => e.stopPropagation()}
                                onClick={(e) => { e.stopPropagation(); onDelete(e, member) }}
                                className="member-card-action hidden md:inline-flex flex-1 items-center justify-center px-3 py-2 rounded-lg bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-600 text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/30 hover:border-red-200 dark:hover:border-red-800 text-sm font-medium transition-colors duration-150"
                            >
                                Delete
                            </button>
                        )}
                    </div>
                </div>

                {/* Expandable Content */}
                {isExpanded && (
                    <div className="member-card-expanded px-2 sm:px-3 pb-2 sm:pb-3 border-t border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-700 transition-colors">
                        <div className="pt-2 sm:pt-2.5">
                            <div className="member-card-detail-grid grid grid-cols-1 md:grid-cols-2 gap-3 sm:gap-4 mb-3 sm:mb-4 p-3 sm:p-4 rounded-xl bg-gray-50 dark:bg-gray-800/50 border border-gray-100 dark:border-gray-700">
                                <div className="space-y-3">
                                    <h4 className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-2">Member Info</h4>
                                    <div className="space-y-2 text-xs sm:text-sm">
                                        <div className="flex justify-between items-center py-1 border-b border-gray-100 dark:border-gray-700/50 last:border-0">
                                            <span className="text-gray-500 dark:text-gray-400">Gender</span>
                                            <span className="font-medium capitalize text-gray-900 dark:text-white truncate ml-2">
                                                {member['Gender'] || 'N/A'}
                                            </span>
                                        </div>
                                        <div className="flex justify-between items-center py-1 border-b border-gray-100 dark:border-gray-700/50 last:border-0">
                                            <span className="text-gray-500 dark:text-gray-400">Phone</span>
                                            <span className="font-medium text-gray-900 dark:text-white truncate ml-2 font-mono">{member['Phone Number'] || 'N/A'}</span>
                                        </div>
                                        <div className="flex justify-between items-center py-1 border-b border-gray-100 dark:border-gray-700/50 last:border-0">
                                            <span className="text-gray-500 dark:text-gray-400">Age</span>
                                            <span className="font-medium text-gray-900 dark:text-white truncate ml-2">{member['Age'] || 'N/A'}</span>
                                        </div>
                                        <div className="flex justify-between items-center py-1 border-b border-gray-100 dark:border-gray-700/50 last:border-0">
                                            <span className="text-gray-500 dark:text-gray-400">Level</span>
                                            <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-primary-50 dark:bg-primary-900/30 text-primary-700 dark:text-primary-300 capitalize ml-2">
                                                {member['Current Level'] || 'N/A'}
                                            </span>
                                        </div>
                                    </div>
                                </div>

                                <div className="space-y-3 border-t md:border-t-0 md:border-l border-gray-200 dark:border-gray-700 pt-3 md:pt-0 md:pl-4">
                                    <h4 className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-2">Actions</h4>
                                    <div className="flex flex-col gap-2">
                                        <button
                                            onPointerDown={(e) => e.stopPropagation()}
                                            onClick={() => onEdit(member)}
                                            className="w-full flex items-center justify-center space-x-2 px-3 py-2 text-sm text-gray-700 dark:text-gray-300 hover:text-primary-600 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-600 rounded-lg transition-colors shadow-sm"
                                        >
                                            <Edit3 className="w-4 h-4" />
                                            <span>Edit Details</span>
                                        </button>
                                        {showDeleteActions && (
                                            <button
                                                onPointerDown={(e) => e.stopPropagation()}
                                                onClick={(e) => { e.stopPropagation(); onDelete(e, member) }}
                                                className="md:hidden w-full flex items-center justify-center space-x-2 px-3 py-2 text-sm bg-white dark:bg-gray-800 border border-red-300 text-red-700 rounded-lg transition-colors shadow-sm"
                                            >
                                                <Trash2 className="w-4 h-4" />
                                                <span>Delete Member</span>
                                            </button>
                                        )}
                                    </div>
                                </div>
                            </div>

                            {/* Attendance Grid */}
                            <div className="border-t border-gray-200 dark:border-gray-600 pt-4">
                                <h4 className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-3">
                                    {getMonthDisplayName(currentTable)} Sunday Attendance
                                </h4>
                                <div className="member-card-attendance-grid grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
                                    {monthSundays.map(date => {
                                        const status = attendanceData[date]?.[member.id]
                                        const isP = status === true
                                        const isA = status === false
                                        return (
                                            <div key={date} className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 p-2">
                                                <div className="text-center text-[10px] font-medium text-gray-500 mb-1">
                                                    {new Date(date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                                                </div>
                                                <div className="flex gap-1">
                                                    <button
                                                        onPointerDown={(event) => event.stopPropagation()}
                                                        onClick={(event) => {
                                                            event.stopPropagation()
                                                            onAttendanceForDate(member.id, true, date)
                                                        }}
                                                        className={`flex-1 py-1 rounded text-[10px] font-bold transition-colors ${isP ? 'bg-green-600 dark:bg-green-800 text-white' : 'bg-green-50 text-green-600 dark:bg-green-950/60 dark:text-green-300'}`}
                                                    >
                                                        P
                                                    </button>
                                                    <button
                                                        onPointerDown={(event) => event.stopPropagation()}
                                                        onClick={(event) => {
                                                            event.stopPropagation()
                                                            onAttendanceForDate(member.id, false, date)
                                                        }}
                                                        className={`flex-1 py-1 rounded text-[10px] font-bold transition-colors ${isA ? 'bg-red-600 dark:bg-red-900 text-white' : 'bg-red-50 text-red-600 dark:bg-red-950/60 dark:text-red-300'}`}
                                                    >
                                                        A
                                                    </button>
                                                </div>
                                            </div>
                                        )
                                    })}
                                </div>
                            </div>
                        </div>
                    </div>
                )}
            </div>
        </div>
    )
}, (prev, next) => {
    // Custom comparison for better performance
    return (
        prev.member.id === next.member.id &&
        prev.memberIndexCode === next.memberIndexCode &&
        prev.isExpanded === next.isExpanded &&
        prev.isSelected === next.isSelected &&
        prev.selectionMode === next.selectionMode &&
        prev.attendanceStatus === next.attendanceStatus &&
        prev.attendanceLoading === next.attendanceLoading &&
        prev.attendanceData === next.attendanceData &&
        prev.memberTags === next.memberTags &&
        prev.currentTable === next.currentTable &&
        prev.memberCodeBadgeStyle === next.memberCodeBadgeStyle &&
        prev.memberCodeBadgeCycleSlot === next.memberCodeBadgeCycleSlot
    )
})

MemberCard.displayName = 'MemberCard'

export default MemberCard
