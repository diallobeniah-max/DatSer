export const PERSONAL_MANUAL_INACTIVITY_MS = 5 * 60 * 1000
export const PERSONAL_MANUAL_WARNING_MS = 60 * 1000
export const PERSONAL_MANUAL_DURATION_MS = PERSONAL_MANUAL_INACTIVITY_MS + PERSONAL_MANUAL_WARNING_MS

export const getPersonalManualDeadline = (now = Date.now()) => now + PERSONAL_MANUAL_DURATION_MS

// Keep the persisted calendar contract in one place.  A month click is only a
// preview; this payload is created after a Sunday has been chosen.
export const buildManualCalendarPreferences = ({ tableName, dateKey, expiresAt }) => ({
  calendar_mode: 'manual',
  manual_month_table: tableName,
  manual_sunday_date: dateKey,
  manual_override_until: expiresAt
})

export const buildAutoCalendarPreferences = () => ({
  calendar_mode: 'auto',
  manual_month_table: null,
  manual_sunday_date: null,
  manual_override_until: null
})

export const getPersonalManualExpiryPhase = ({
  isManualMode,
  deadlineAt,
  now = Date.now(),
  isBlocked = false
} = {}) => {
  if (!isManualMode || !deadlineAt) return 'inactive'

  const remainingMs = deadlineAt - now
  if (remainingMs > PERSONAL_MANUAL_WARNING_MS) return 'active'
  if (remainingMs > 0) return 'warning'
  return isBlocked ? 'deferred' : 'expired'
}
