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
    if (disabled || pending) return
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
        return (
          <button
            key={option.tone}
            type="button"
            data-testid={`${testIdPrefix}-${option.tone}`}
            data-tone={option.tone}
            data-selected={selected ? 'true' : 'false'}
            aria-pressed={selected}
            aria-busy={pending && selected ? 'true' : undefined}
            disabled={disabled || pending}
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
