import { createRxDatabase } from 'rxdb/plugins/core'
import { getRxStorageDexie } from 'rxdb/plugins/storage-dexie'
import { memberSchema } from '../schemas/memberSchema'
import { attendanceSchema } from '../schemas/attendanceSchema'
import { pocConflictHandler } from '../conflicts/pocConflictHandler'

const databaseName = (userId, workspaceId) => (
  `datser_rxdb_poc_${userId}_${workspaceId}`.toLowerCase().replace(/[^a-z0-9_$]/g, '_')
)

export const createPocDatabase = async ({ userId, workspaceId, storage } = {}) => {
  if (!userId || !workspaceId) throw new Error('POC database requires user and workspace ids.')
  const database = await createRxDatabase({
    name: databaseName(userId, workspaceId),
    storage: storage || getRxStorageDexie(),
    multiInstance: true,
    eventReduce: true
  })

  await database.addCollections({
    members: { schema: memberSchema, conflictHandler: pocConflictHandler },
    attendance: { schema: attendanceSchema, conflictHandler: pocConflictHandler }
  })
  return database
}
