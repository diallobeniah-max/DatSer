import React, { memo } from 'react'
import { dismissKeyboardForNonTextControl } from '../hooks/useKeyboardSafeModal'

const OPTIONS = [
  { value: true, label: 'Present', compactLabel: 'P', tone: 'present' },
  { value: false, label: 'Absent', compactLabel: 'A', tone: 'absent' },
  { value: null, label: 'Clear', compactLabel: 'C', tone: 'clear' }
]

const AttendanceChoice = memo(({
  value,
  onChange,
  disabled = false,
  pending = false,
  allowPendingChange = false,
  queued = false,
  error = false,
  compact = false,
  variant = 'editable',
  showClear = true,
  className = '',
  testIdPrefix = 'attendance-choice',
  stopPropagation = false,
  ariaLabel = 'Attendance choice'
}) => {
  const handleSelect = (event, nextValue) => {
    if (stopPropagation) event.stopPropagation()
    const isCurrentValue = nextValue === null ? value === null : nextValue === value
    if (disabled || (pending && (!allowPendingChange || isCurrentValue))) return
    dismissKeyboardForNonTextControl()
    onChange?.(nextValue)
  }

  return (
    <div
      className={`attendance-choice ${compact ? 'attendance-choice--compact' : ''} ${className}`.trim()}
      data-variant={variant}
      data-columns={showClear ? '3' : '2'}
      role="group"
      aria-label={ariaLabel}
      data-state={error ? 'error' : queued ? 'queued' : pending ? 'saving' : 'idle'}
    >
      {OPTIONS.filter(option => showClear || option.value !== null).map(option => {
        const selected = option.value === null ? value === null : value === option.value
        // A second, different choice is allowed while the first one is still
        // saving. The attendance write queue keeps the final intent durable;
        // repeating the selected control remains disabled to avoid accidental
        // duplicate taps.
        const blockedWhilePending = pending && (selected || !allowPendingChange)
        return (
          <button
            key={option.tone}
            type="button"
            data-testid={`${testIdPrefix}-${option.tone}`}
            data-tone={option.tone}
            data-selected={selected ? 'true' : 'false'}
            aria-pressed={selected}
            aria-busy={pending && selected ? 'true' : undefined}
            disabled={disabled || blockedWhilePending}
            onPointerDown={stopPropagation ? event => event.stopPropagation() : undefined}
            onClick={event => handleSelect(event, option.value)}
            className="attendance-choice__button"
          >
            {compact ? option.compactLabel : option.label}
          </button>
        )
      })}
    </div>
  )
})

AttendanceChoice.displayName = 'AttendanceChoice'

export default AttendanceChoice
