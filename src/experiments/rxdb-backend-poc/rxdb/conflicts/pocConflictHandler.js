import { SAVE_STATES } from '../../constants'

const comparable = (document) => JSON.stringify({
  id: document?.id,
  workspace_id: document?.workspace_id,
  full_name: document?.full_name,
  member_id: document?.member_id,
  attendance_date: document?.attendance_date,
  status: document?.status,
  revision: document?.revision,
  is_deleted: document?.is_deleted
})

export const pocConflictHandler = {
  isEqual: (left, right) => comparable(left) === comparable(right),
  resolve: async ({ realMasterState, newDocumentState }) => ({
    ...newDocumentState,
    save_state: SAVE_STATES.CONFLICT,
    request_id: null,
    mutation_operation: null,
    conflict_remote: JSON.stringify(realMasterState),
    last_error: 'Server state changed after this device last synchronized.'
  })
}
