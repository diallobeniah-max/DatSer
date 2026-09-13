import { SAVE_STATES } from '../../constants'

export const attendanceSchema = {
  title: 'DatSer RxDB POC attendance',
  version: 0,
  primaryKey: 'id',
  type: 'object',
  additionalProperties: false,
  properties: {
    id: { type: 'string', maxLength: 36 },
    workspace_id: { type: 'string', maxLength: 36 },
    member_id: { type: 'string', maxLength: 36 },
    attendance_date: { type: 'string', maxLength: 10 },
    status: { type: ['string', 'null'], enum: ['present', 'absent', null], maxLength: 10 },
    revision: { type: 'integer', minimum: 0 },
    base_revision: { type: ['integer', 'null'], minimum: 0 },
    created_at: { type: 'string', maxLength: 40 },
    updated_at: { type: 'string', maxLength: 40 },
    is_deleted: { type: 'boolean' },
    save_state: { type: 'string', enum: Object.values(SAVE_STATES), maxLength: 32 },
    request_id: { type: ['string', 'null'], maxLength: 200 },
    mutation_operation: { type: ['string', 'null'], maxLength: 40 },
    conflict_remote: { type: ['string', 'null'], maxLength: 10000 },
    last_error: { type: ['string', 'null'], maxLength: 1000 }
  },
  required: ['id', 'workspace_id', 'member_id', 'attendance_date', 'revision', 'created_at', 'updated_at', 'is_deleted', 'save_state'],
  indexes: ['workspace_id', 'member_id', 'save_state', ['workspace_id', 'updated_at', 'id']]
}
