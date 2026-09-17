import { canonicalJson } from './memberContractFingerprint'

const sha256Hex = async (value) => {
  const bytes = new globalThis.TextEncoder().encode(value)
  const digest = await globalThis.crypto.subtle.digest('SHA-256', bytes)
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('')
}

export const createMemberV2AttendanceFingerprint = ({ operation, ownerId, memberId, tableName, attendanceDate, status, baseServerRevision = null }) => sha256Hex(canonicalJson({
  attendance_date: attendanceDate, attendance_status: status, base_server_revision: baseServerRevision,
  member_id: memberId, operation, owner_id: ownerId, table_name: tableName,
}))
