import { MEMBER_SAVE_STATES } from '../../../services/member-v2/memberSaveState'

const nullableString = { type: ['string', 'null'], maxLength: 1000 }
const nullableNumber = { type: ['number', 'null'], minimum: 0 }
const jsonObject = { type: ['object', 'null'], additionalProperties: true }

export const memberV2Schema = {
  title: 'DatSer Member V2 local member', version: 0, primaryKey: 'id', type: 'object', additionalProperties: false,
  properties: {
    id: { type: 'string', maxLength: 36 }, scope_key: { type: 'string', maxLength: 160 }, user_id: { type: 'string', maxLength: 36 },
    owner_id: { type: 'string', maxLength: 36 }, table_name: { type: 'string', maxLength: 120 }, member_id: { type: 'string', maxLength: 36 },
    workspace_id: { type: ['string', 'null'], maxLength: 36 }, workspace_owner_id: { type: ['string', 'null'], maxLength: 36 }, authenticated_user_scope: { type: ['string', 'null'], maxLength: 36 },
    source_table: { type: ['string', 'null'], maxLength: 120 }, canonical_member_id: { type: ['string', 'null'], maxLength: 36 }, provenance: jsonObject,
    full_name: nullableString, phone: nullableString, age: nullableString, education: nullableString, gender: nullableString, member_code: nullableString,
    tags: { type: ['array', 'null'], items: { type: 'string', maxLength: 160 } }, local_save_state: { type: ['string', 'null'], maxLength: 32 },
    pending_request_id: nullableString, pending_operation: nullableString, payload_fingerprint: { type: ['string', 'null'], maxLength: 64 }, base_server_revision: nullableNumber, retry_count: { type: 'integer', minimum: 0 }, remote_conflict_snapshot: jsonObject,
    identity: jsonObject, data: { type: 'object', additionalProperties: true }, server_revision: nullableNumber,
    is_deleted: { type: 'boolean' }, save_state: { type: 'string', enum: Object.values(MEMBER_SAVE_STATES), maxLength: 32 },
    conflict_remote: jsonObject, last_error: nullableString, created_at: { type: 'string', maxLength: 40 }, updated_at: { type: 'string', maxLength: 40 },
  },
  required: ['id', 'scope_key', 'user_id', 'owner_id', 'table_name', 'member_id', 'data', 'is_deleted', 'save_state', 'retry_count', 'created_at', 'updated_at'],
  indexes: ['scope_key', 'member_id', ['scope_key', 'table_name', 'member_id']],
}

export const memberMutationV2Schema = {
  title: 'DatSer Member V2 durable mutation', version: 0, primaryKey: 'id', type: 'object', additionalProperties: false,
  properties: {
    id: { type: 'string', maxLength: 200 }, scope_key: { type: 'string', maxLength: 160 }, member_id: { type: 'string', maxLength: 36 },
    table_name: { type: 'string', maxLength: 120 }, owner_id: { type: 'string', maxLength: 36 }, operation: { type: 'string', enum: ['create_member_v2', 'update_member_v2', 'delete_member_v2', 'cancel_local_member_v2'], maxLength: 40 },
    payload: { type: 'object', additionalProperties: true }, identity: jsonObject, base_server_revision: nullableNumber,
    supersedes_request_ids: { type: 'array', items: { type: 'string', maxLength: 200 } },
    payload_fingerprint: { type: 'string', minLength: 64, maxLength: 64 }, retry_count: { type: 'integer', minimum: 0 },
    save_state: { type: 'string', enum: Object.values(MEMBER_SAVE_STATES), maxLength: 32 }, last_error: nullableString,
    created_at: { type: 'string', maxLength: 40 }, updated_at: { type: 'string', maxLength: 40 },
  },
  required: ['id', 'scope_key', 'member_id', 'table_name', 'owner_id', 'operation', 'payload', 'payload_fingerprint', 'retry_count', 'save_state', 'created_at', 'updated_at'],
  indexes: ['scope_key', ['scope_key', 'member_id', 'created_at'], ['scope_key', 'save_state', 'created_at']],
}

export const memberSyncV2Schema = {
  title: 'DatSer Member V2 sync checkpoint', version: 0, primaryKey: 'id', type: 'object', additionalProperties: false,
  properties: { id: { type: 'string', maxLength: 160 }, cursor: nullableNumber, state: { type: 'string', maxLength: 32 }, last_error: nullableString, updated_at: { type: 'string', maxLength: 40 } },
  required: ['id', 'state', 'updated_at'],
}
