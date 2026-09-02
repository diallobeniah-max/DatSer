// Manual attendance has two deliberately scoped server contracts:
//
// - Present / Absent use the attendance-only RPC. It derives the workspace
//   month and physical attendance column on the server.
// - Clear uses the existing member-bundle contract's dedicated attendance
//   payload. The narrow RPC intentionally accepts only Present / Absent.
//
// Neither path sends a dynamic attendance column through a profile update.

const toDateKey = (date) => {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

const createRequestId = ({ memberId, dateKey, status }) => {
  const suffix = globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(16).slice(2)}`
  return `manual_attendance:${memberId}:${dateKey}:${status}:${suffix}`
}

export const writeManualAttendance = async ({
  supabase,
  executeWrite,
  tableName,
  ownerId,
  memberId,
  attendanceDate,
  present,
  identity
}) => {
  if (!tableName || !ownerId || !memberId || !(attendanceDate instanceof Date) || Number.isNaN(attendanceDate.getTime())) {
    throw new Error('Manual attendance is missing its workspace, member, or Sunday.')
  }

  const dateKey = toDateKey(attendanceDate)
  const monthStart = `${attendanceDate.getFullYear()}-${String(attendanceDate.getMonth() + 1).padStart(2, '0')}-01`

  if (present !== null) {
    const status = present ? 'Present' : 'Absent'
    const result = await executeWrite(
      () => supabase.rpc('set_workspace_month_member_attendance', {
        p_owner_id: ownerId,
        p_month_start: monthStart,
        p_member_id: memberId,
        p_attendance_date: dateKey,
        p_attendance_status: status,
        p_request_id: createRequestId({ memberId, dateKey, status })
      }),
      { action: `Save ${status.toLowerCase()} attendance in ${tableName}` }
    )

    if (result?.data?.success !== true || String(result.data.member_id) !== String(memberId)) {
      throw new Error(result?.data?.error_message || 'Attendance save could not be verified. Please retry.')
    }

    return { memberId: result.data.member_id, attendanceDate: dateKey, status }
  }

  const result = await executeWrite(
    () => supabase.rpc('update_member_bundle_resilient', {
      p_table_name: tableName,
      p_owner_id: ownerId,
      p_member_id: memberId,
      p_request_id: createRequestId({ memberId, dateKey, status: 'Cleared' }),
      p_updates: {},
      p_badges: null,
      p_tag_ids: null,
      p_attendance: { [dateKey]: null },
      p_identity: identity || {}
    }),
    { action: `Clear attendance in ${tableName}` }
  )

  if (result?.data?.success !== true || String(result.data.member_id || memberId) !== String(memberId)) {
    throw new Error(result?.data?.error_message || 'Attendance clear could not be verified. Please retry.')
  }

  return { memberId: result.data.member_id || memberId, attendanceDate: dateKey, status: 'Cleared' }
}
