import { MEMBER_SAVE_STATES } from '../../../services/member-v2/memberSaveState'

const nullableString = { type: ['string', 'null'], maxLength: 1000 }
const nullableNumber = { type: ['number', 'null'], minimum: 0 }
const nullableObject = { type: ['object', 'null'], additionalProperties: true }

export const memberV2AttendanceSchema = {
  title: 'DatSer Member V2 isolated attendance', version: 0, primaryKey: 'id', type: 'object', additionalProperties: false,
  properties: {
    id: { type: 'string', maxLength: 180 }, scope_key: { type: 'string', maxLength: 160 }, owner_id: { type: 'string', maxLength: 36 }, member_id: { type: 'string', maxLength: 36 },
    table_name: { type: 'string', maxLength: 120 }, attendance_date: { type: 'string', maxLength: 10 }, attendance_id: { type: 'string', maxLength: 36 },
    status: nullableString, is_deleted: { type: 'boolean' }, server_revision: nullableNumber,
    save_state: { type: 'string', enum: Object.values(MEMBER_SAVE_STATES), maxLength: 32 }, conflict_remote: nullableObject, last_error: nullableString,
    created_at: { type: 'string', maxLength: 40 }, updated_at: { type: 'string', maxLength: 40 },
  },
  required: ['id', 'scope_key', 'owner_id', 'member_id', 'table_name', 'attendance_date', 'attendance_id', 'is_deleted', 'save_state', 'created_at', 'updated_at'],
  indexes: ['scope_key', ['scope_key', 'member_id', 'attendance_date']],
}

export const memberV2AttendanceMutationSchema = {
  title: 'DatSer Member V2 isolated attendance mutation', version: 0, primaryKey: 'id', type: 'object', additionalProperties: false,
  properties: {
    id: { type: 'string', maxLength: 200 }, scope_key: { type: 'string', maxLength: 160 }, owner_id: { type: 'string', maxLength: 36 }, member_id: { type: 'string', maxLength: 36 },
    table_name: { type: 'string', maxLength: 120 }, attendance_date: { type: 'string', maxLength: 10 }, attendance_id: { type: 'string', maxLength: 36 },
    status: nullableString, base_server_revision: nullableNumber, payload_fingerprint: { type: 'string', minLength: 64, maxLength: 64 }, retry_count: { type: 'integer', minimum: 0 },
    save_state: { type: 'string', enum: Object.values(MEMBER_SAVE_STATES), maxLength: 32 }, last_error: nullableString, conflict_remote: nullableObject,
    created_at: { type: 'string', maxLength: 40 }, updated_at: { type: 'string', maxLength: 40 },
  },
  required: ['id', 'scope_key', 'owner_id', 'member_id', 'table_name', 'attendance_date', 'attendance_id', 'payload_fingerprint', 'retry_count', 'save_state', 'created_at', 'updated_at'],
  indexes: ['scope_key', ['scope_key', 'member_id', 'attendance_date'], ['scope_key', 'save_state', 'created_at']],
}

export const memberV2AttendanceSyncSchema = {
  title: 'DatSer Member V2 isolated attendance checkpoint', version: 0, primaryKey: 'id', type: 'object', additionalProperties: false,
  properties: { id: { type: 'string', maxLength: 160 }, cursor: nullableNumber, state: { type: 'string', maxLength: 32 }, last_error: nullableString, updated_at: { type: 'string', maxLength: 40 } },
  required: ['id', 'state', 'updated_at'],
}
