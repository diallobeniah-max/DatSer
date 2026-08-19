import { matchGeminiRowToMember, MATCH_STATUSES } from '../utils/paperScanCompare'

export const QUICK_SUNDAY_STATUS = Object.freeze({ READY: 'ready', NEEDS_REVIEW: 'needs-review', NOT_FOUND: 'not-found', SKIPPED: 'skipped' })

// The chosen register is the ONLY automatic search scope. A near-name never
// becomes attendance without an explicit reviewer choice.
export const matchQuickSundayNames = ({ names, members }) => (Array.isArray(names) ? names : []).map((entry, index) => {
  const name = String(entry?.full_name ?? entry ?? '').trim()
  const match = matchGeminiRowToMember({ full_name: name }, members || [])
  return {
    id: entry?.id || `quick-name-${index}`,
    full_name: name,
    confidence: Number(entry?.confidence) || 0,
    raw: entry?.raw || name,
    match,
    status: match.status === MATCH_STATUSES.MATCHED
      ? QUICK_SUNDAY_STATUS.READY
      : match.status === MATCH_STATUSES.POSSIBLE ? QUICK_SUNDAY_STATUS.NEEDS_REVIEW : QUICK_SUNDAY_STATUS.NOT_FOUND,
    selectedMemberId: match.status === MATCH_STATUSES.MATCHED ? match.member?.id || null : null
  }
})

export const stableQuickSundayRequestId = ({ scanId, memberId, attendanceDate }) =>
  `quick_sunday:${String(scanId)}:${String(memberId)}:${String(attendanceDate)}`

export const saveQuickSundayAttendance = async ({ supabase, ownerId, monthStart, attendanceDate, scanId, rows }) => {
  const confirmed = (Array.isArray(rows) ? rows : []).filter((row) => row?.status === QUICK_SUNDAY_STATUS.READY && row?.selectedMemberId)
  const outcomes = []
  for (const row of confirmed) {
    const memberId = row.selectedMemberId
    const { data, error } = await supabase.rpc('set_workspace_month_member_attendance', {
      p_owner_id: ownerId,
      p_month_start: monthStart,
      p_member_id: memberId,
      p_attendance_date: attendanceDate,
      p_attendance_status: 'Present',
      p_request_id: stableQuickSundayRequestId({ scanId, memberId, attendanceDate })
    })
    outcomes.push({ memberId, success: !error && data?.success === true, error: error?.message || data?.error_message || '' })
  }
  return outcomes
}
