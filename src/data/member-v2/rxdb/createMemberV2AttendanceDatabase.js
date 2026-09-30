import { createRxDatabase } from 'rxdb/plugins/core'
import { getRxStorageDexie } from 'rxdb/plugins/storage-dexie'
import { createMemberV2ScopeKey, memberV2DatabaseName } from './createMemberV2Database'
import { memberV2AttendanceMutationSchema, memberV2AttendanceSchema, memberV2AttendanceSyncSchema } from './attendanceSchemas'

export const memberV2AttendanceDatabaseName = (scope) => `${memberV2DatabaseName(scope)}_attendance`

export const createMemberV2AttendanceDatabase = async ({ userId, ownerId, storage } = {}) => {
  if (!userId || !ownerId) throw new Error('Member V2 attendance requires authenticated user and workspace owner IDs.')
  const database = await createRxDatabase({ name: memberV2AttendanceDatabaseName({ userId, ownerId }), storage: storage || getRxStorageDexie(), multiInstance: true, eventReduce: true })
  await database.addCollections({ attendance: { schema: memberV2AttendanceSchema }, mutations: { schema: memberV2AttendanceMutationSchema }, sync: { schema: memberV2AttendanceSyncSchema } })
  database.memberV2AttendanceScopeKey = createMemberV2ScopeKey({ userId, ownerId })
  return database
}
