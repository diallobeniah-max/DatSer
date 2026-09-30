import { createRxDatabase } from 'rxdb/plugins/core'
import { getRxStorageDexie } from 'rxdb/plugins/storage-dexie'
import { memberMutationV2Schema, memberSyncV2Schema, memberV2Schema } from './memberSchemas'

const safeSegment = (value) => String(value).toLowerCase().replace(/[^a-z0-9_$]/g, '_')
export const createMemberV2ScopeKey = ({ userId, ownerId }) => `${userId}:${ownerId}`
export const memberV2DatabaseName = ({ userId, ownerId }) => `datser_member_v2_${safeSegment(userId)}_${safeSegment(ownerId)}`

export const createMemberV2Database = async ({ userId, ownerId, storage } = {}) => {
  if (!userId || !ownerId) throw new Error('Member V2 database requires authenticated user and workspace owner IDs.')
  const database = await createRxDatabase({ name: memberV2DatabaseName({ userId, ownerId }), storage: storage || getRxStorageDexie(), multiInstance: true, eventReduce: true })
  await database.addCollections({ members: { schema: memberV2Schema }, mutations: { schema: memberMutationV2Schema }, sync: { schema: memberSyncV2Schema } })
  return database
}
