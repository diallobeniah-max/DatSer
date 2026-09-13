import { SAVE_STATES, createRequestId, createUuid } from '../../constants'

export const createLocalMember = async (collection, { workspaceId, fullName }) => {
  const now = new Date().toISOString()
  const id = createUuid()
  return collection.insert({
    id,
    workspace_id: workspaceId,
    full_name: fullName.trim(),
    revision: 0,
    base_revision: null,
    created_at: now,
    updated_at: now,
    is_deleted: false,
    save_state: SAVE_STATES.LOCAL_PENDING,
    request_id: createRequestId('create_member', id),
    mutation_operation: 'create_member',
    conflict_remote: null,
    last_error: null
  })
}

export const updateLocalMember = async (document, { fullName }) => document.incrementalPatch({
  full_name: fullName.trim(),
  base_revision: document.revision,
  updated_at: new Date().toISOString(),
  save_state: SAVE_STATES.LOCAL_PENDING,
  request_id: createRequestId('update_member', document.id),
  mutation_operation: 'update_member',
  conflict_remote: null,
  last_error: null
})
