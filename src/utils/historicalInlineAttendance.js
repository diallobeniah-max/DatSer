// Historical inline attendance routing helpers.
// Extracted for direct unit testing; consumed by Dashboard for the expanded
// historical-member-card Sunday P/A/C buttons.
//
// Why this exists:
//   - For a historical member NOT yet in the current month, the inline Sunday
//     P/A/C buttons must route through the safe cross-month transfer flow
//     (confirmation modal -> set_member_attendance_from_other_month) instead of
//     update_member_record_resilient, which 400s because the row does not exist
//     in the current month yet.
//   - Clearing attendance must NOT import a historical member into the current
//     month merely to clear a value that cannot exist there yet.

export const ATTENDANCE_STATUS = {
  PRESENT: 'Present',
  ABSENT: 'Absent'
}

export const INLINE_ATTENDANCE_ACTIONS = {
  NORMAL: 'normal',
  TRANSFER: 'transfer',
  SKIP: 'skip'
}

// AttendanceChoice passes boolean/null for P/A/C (true=Present, false=Absent,
// null=Clear). Normalize any boolean/string input into a canonical status.
export const normalizeAttendanceStatus = (value) => {
  if (value === false || value === 'Absent' || value === 'absent') {
    return ATTENDANCE_STATUS.ABSENT
  }
  return ATTENDANCE_STATUS.PRESENT
}

// Decide what an inline Sunday P/A/C tap should do for a member card.
//   - alreadyInCurrentTable: true  -> the member exists in the current month,
//     so normal current-month behavior applies (no import needed).
//   - nextValue null (Clear) when the member is NOT in the current month
//     -> skip (do not import merely to clear).
//   - otherwise (Present/Absent, member not in current month)
//     -> transfer via the cross-month flow.
export const resolveInlineAttendanceAction = ({ alreadyInCurrentTable = false, nextValue }) => {
  if (alreadyInCurrentTable) {
    return { action: INLINE_ATTENDANCE_ACTIONS.NORMAL }
  }
  if (nextValue === null) {
    return { action: INLINE_ATTENDANCE_ACTIONS.SKIP }
  }
  return {
    action: INLINE_ATTENDANCE_ACTIONS.TRANSFER,
    status: normalizeAttendanceStatus(nextValue)
  }
}

// Build the confirmation-modal snapshot for a historical inline transfer.
// Mirrors the main historical-card onAttendance snapshot shape so the shared
// confirm modal and handleConfirmPresent work unchanged, but carries the
// date-specific inline Sunday.
export const buildHistoricalTransferSnapshot = ({
  resultItem = {},
  currentTable,
  specificDate,
  status
}) => ({
  canonicalMemberId: resultItem.canonical_member_id,
  sourceTable: resultItem.source_table,
  sourceMonthLabel: resultItem.source_month_label || (resultItem.source_table || '').replace('_', ' '),
  targetTable: currentTable,
  attendanceDate: specificDate,
  attendanceStatus: normalizeAttendanceStatus(status),
  memberName: resultItem.full_name || resultItem['Full Name'] || 'Member',
  already_in_current_table: Boolean(resultItem.already_in_current_table),
  item: { ...resultItem }
})
