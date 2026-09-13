import { replicateRxCollection } from 'rxdb/plugins/replication'
import { SAVE_STATES } from '../../constants'

const localFields = new Set(['base_revision', 'save_state', 'request_id', 'mutation_operation', 'conflict_remote', 'last_error'])
const fromServer = (row) => Object.fromEntries(Object.entries({ ...row,
  save_state: SAVE_STATES.SERVER_CONFIRMED, base_revision: row.revision,
  request_id: null, mutation_operation: null, conflict_remote: null, last_error: null
}).filter(([key]) => !['updated_by'].includes(key)))

export const createPullHandler = ({ supabase, workspaceId, entity }) => async (checkpoint, batchSize) => {
  const { data, error } = await supabase.rpc('poc_pull_changes', {
    p_workspace_id: workspaceId, p_entity: entity,
    p_checkpoint_updated_at: checkpoint?.updated_at || null,
    p_checkpoint_id: checkpoint?.id || null, p_limit: batchSize
  })
  if (error) throw error
  return { documents: (data.documents || []).map(fromServer), checkpoint: data.checkpoint || checkpoint || null }
}

const rpcFor = (entity, doc) => {
  if (entity === 'members') return doc.mutation_operation === 'create_member'
    ? ['poc_create_member', { p_workspace_id: doc.workspace_id, p_member_id: doc.id, p_full_name: doc.full_name, p_request_id: doc.request_id }]
    : ['poc_update_member', { p_workspace_id: doc.workspace_id, p_member_id: doc.id, p_full_name: doc.full_name, p_expected_revision: doc.base_revision, p_request_id: doc.request_id }]
  return doc.mutation_operation === 'clear_attendance'
    ? ['poc_clear_attendance', { p_workspace_id: doc.workspace_id, p_member_id: doc.member_id, p_attendance_id: doc.id, p_attendance_date: doc.attendance_date, p_expected_revision: doc.base_revision, p_request_id: doc.request_id }]
    : ['poc_set_attendance', { p_workspace_id: doc.workspace_id, p_member_id: doc.member_id, p_attendance_id: doc.id, p_attendance_date: doc.attendance_date, p_status: doc.status, p_expected_revision: doc.base_revision, p_request_id: doc.request_id }]
}

const patchLocal = async (collection, id, values) => {
  if (!collection) return
  const local = await collection.findOne(id).exec()
  if (local) await local.incrementalPatch(values)
}

export const createPushHandler = ({ supabase, entity, collection }) => async (rows) => {
  const conflicts = []
  for (const row of rows) {
    const doc = row.newDocumentState
    if (!doc.request_id || !doc.mutation_operation || doc.save_state === SAVE_STATES.SERVER_CONFIRMED) continue
    const [rpc, params] = rpcFor(entity, doc)
    const { data, error } = await supabase.rpc(rpc, params)
    if (error) {
      await patchLocal(collection, doc.id, { save_state: SAVE_STATES.FAILED_RETRYABLE, last_error: error.message || 'Backend push failed.' })
      throw error
    }
    const canonical = data?.member || data?.attendance
    if (data?.conflict) conflicts.push(fromServer(canonical))
    else if (canonical) await patchLocal(collection, doc.id, fromServer(canonical))
  }
  return conflicts
}

export const startPocReplication = ({ collection, supabase, workspaceId, entity, onRealtimeSignal }) => {
  const pullHandler = createPullHandler({ supabase, workspaceId, entity })
  const replicationState = replicateRxCollection({
    replicationIdentifier: `datser-poc:${workspaceId}:${entity}`,
    collection, deletedField: '_deleted', live: true, retryTime: 5000,
    pull: { handler: pullHandler, batchSize: 100 },
    push: { handler: createPushHandler({ supabase, entity, collection }), batchSize: 25 }
  })
  let resolveReady
  const ready = new Promise((resolve) => { resolveReady = resolve })
  const channel = supabase.channel(`poc:${workspaceId}:${entity}`)
    .on('postgres_changes', { event: '*', schema: 'public', table: `poc_${entity}` }, async () => {
      onRealtimeSignal?.(entity)
      try {
        replicationState.emitEvent(await pullHandler(null, 100))
      } catch {
        replicationState.reSync()
      }
    })
    .subscribe((status) => { if (status === 'SUBSCRIBED') resolveReady() })
  return {
    replicationState,
    ready,
    resync: () => replicationState.reSync(),
    cancel: async () => { await replicationState.cancel(); await supabase.removeChannel(channel) }
  }
}

export const stripLocalReplicationFields = (document) => Object.fromEntries(Object.entries(document).filter(([key]) => !localFields.has(key)))
