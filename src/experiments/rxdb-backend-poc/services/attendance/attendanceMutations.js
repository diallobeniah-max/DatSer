import { SAVE_STATES, createRequestId, createUuid } from '../../constants'

export const attendanceForMemberDate = async (collection, workspaceId, memberId, attendanceDate) => {
  const rows = await collection.find({
    selector: { workspace_id: workspaceId, member_id: memberId, attendance_date: attendanceDate }
  }).exec()
  return rows[0] || null
}

export const setLocalAttendance = async (collection, { workspaceId, memberId, attendanceDate, status }) => {
  if (!['present', 'absent'].includes(status)) throw new Error('Attendance status must be present or absent.')
  const existing = await attendanceForMemberDate(collection, workspaceId, memberId, attendanceDate)
  const now = new Date().toISOString()
  if (existing) {
    return existing.incrementalPatch({
      status,
      is_deleted: false,
      base_revision: existing.revision,
      updated_at: now,
      save_state: SAVE_STATES.LOCAL_PENDING,
      request_id: createRequestId('set_attendance', existing.id),
      mutation_operation: 'set_attendance',
      conflict_remote: null,
      last_error: null
    })
  }
  const id = createUuid()
  return collection.insert({
    id,
    workspace_id: workspaceId,
    member_id: memberId,
    attendance_date: attendanceDate,
    status,
    revision: 0,
    base_revision: null,
    created_at: now,
    updated_at: now,
    is_deleted: false,
    save_state: SAVE_STATES.LOCAL_PENDING,
    request_id: createRequestId('set_attendance', id),
    mutation_operation: 'set_attendance',
    conflict_remote: null,
    last_error: null
  })
}

export const clearLocalAttendance = async (collection, { workspaceId, memberId, attendanceDate }) => {
  const existing = await attendanceForMemberDate(collection, workspaceId, memberId, attendanceDate)
  const now = new Date().toISOString()
  if (existing) {
    return existing.incrementalPatch({
      status: null,
      is_deleted: true,
      base_revision: existing.revision,
      updated_at: now,
      save_state: SAVE_STATES.LOCAL_PENDING,
      request_id: createRequestId('clear_attendance', existing.id),
      mutation_operation: 'clear_attendance',
      conflict_remote: null,
      last_error: null
    })
  }
  const id = createUuid()
  return collection.insert({
    id,
    workspace_id: workspaceId,
    member_id: memberId,
    attendance_date: attendanceDate,
    status: null,
    revision: 0,
    base_revision: null,
    created_at: now,
    updated_at: now,
    is_deleted: true,
    save_state: SAVE_STATES.LOCAL_PENDING,
    request_id: createRequestId('clear_attendance', id),
    mutation_operation: 'clear_attendance',
    conflict_remote: null,
    last_error: null
  })
}
