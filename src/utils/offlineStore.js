const DB_NAME = 'datser-offline'
const DB_VERSION = 4
const SNAPSHOT_STORE = 'snapshots'
const PENDING_STORE = 'pendingChanges'
const AUTH_STORE = 'auth'
const LOCAL_STATE_STORE = 'localState'
const MEMBER_PREVIEW_STORE = 'memberPreviews'
const SNAPSHOT_KEY = 'latest'
const AUTH_PROFILE_KEY = 'latest'
const PREFERENCES_KEY = 'preferences'
export const OFFLINE_SNAPSHOT_SCHEMA_VERSION = 1

const snapshotScopeKey = (userId, ownerId) => (
  userId && ownerId ? `workspace:${userId}:${ownerId}` : SNAPSHOT_KEY
)

const matchesScope = (record, { userId, ownerId } = {}) => (
  Boolean(record) &&
  (!userId || record.authenticated_user_id === userId) &&
  (!ownerId || record.data_owner_id === ownerId)
)

export const isCompleteOfflineSnapshot = (record, scope = {}) => (
  matchesScope(record, scope) &&
  record?.completeness === 'complete' &&
  record?.snapshot?.completeness === 'complete'
)

const canUseIndexedDb = () => (
  typeof window !== 'undefined' &&
  typeof window.indexedDB !== 'undefined'
)

const openOfflineDb = () => new Promise((resolve, reject) => {
  if (!canUseIndexedDb()) {
    reject(new Error('IndexedDB is not available in this browser.'))
    return
  }

  const request = window.indexedDB.open(DB_NAME, DB_VERSION)

  request.onupgradeneeded = () => {
    const db = request.result
    if (!db.objectStoreNames.contains(SNAPSHOT_STORE)) {
      db.createObjectStore(SNAPSHOT_STORE, { keyPath: 'key' })
    }
    if (!db.objectStoreNames.contains(PENDING_STORE)) {
      const store = db.createObjectStore(PENDING_STORE, { keyPath: 'local_change_id' })
      store.createIndex('sync_status', 'sync_status', { unique: false })
      store.createIndex('created_at', 'created_at', { unique: false })
    }
    if (!db.objectStoreNames.contains(AUTH_STORE)) {
      db.createObjectStore(AUTH_STORE, { keyPath: 'key' })
    }
    if (!db.objectStoreNames.contains(LOCAL_STATE_STORE)) {
      db.createObjectStore(LOCAL_STATE_STORE, { keyPath: 'key' })
    }
    if (!db.objectStoreNames.contains(MEMBER_PREVIEW_STORE)) {
      const store = db.createObjectStore(MEMBER_PREVIEW_STORE, { keyPath: 'key' })
      store.createIndex('scope_table', ['scope', 'table_name'], { unique: false })
      store.createIndex('member_id', 'member_id', { unique: false })
      store.createIndex('updated_at', 'updated_at', { unique: false })
    }
  }

  request.onsuccess = () => resolve(request.result)
  request.onerror = () => reject(request.error || new Error('Could not open offline database.'))
})

const runStore = async (storeName, mode, runner) => {
  const db = await openOfflineDb()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, mode)
    const store = tx.objectStore(storeName)
    const request = runner(store)

    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error || new Error('Offline storage request failed.'))
    tx.oncomplete = () => db.close()
    tx.onerror = () => {
      db.close()
      reject(tx.error || new Error('Offline storage transaction failed.'))
    }
  })
}

const runTransaction = async (storeName, mode, runner) => {
  const db = await openOfflineDb()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, mode)
    const store = tx.objectStore(storeName)
    let result
    try {
      result = runner(store)
    } catch (error) {
      db.close()
      reject(error)
      return
    }
    tx.oncomplete = () => {
      db.close()
      resolve(result)
    }
    tx.onerror = () => {
      db.close()
      reject(tx.error || new Error('Offline storage transaction failed.'))
    }
    tx.onabort = () => {
      db.close()
      reject(tx.error || new Error('Offline storage transaction aborted.'))
    }
  })
}

const memberPreviewKey = (scope = 'guest', tableName = 'default', memberId = '') => (
  `${scope || 'guest'}::${tableName || 'default'}::${memberId || ''}`
)

const getMemberId = (member = {}) => (
  member.id ||
  member.member_id ||
  member.member_code ||
  member['Full Name'] ||
  member.full_name ||
  member.name ||
  member.Name ||
  null
)

export const isOfflineStoreAvailable = canUseIndexedDb

export const saveOfflineSnapshot = async (snapshot) => {
  const cachedAt = new Date().toISOString()
  const authenticatedUserId = snapshot?.authenticated_user_id || null
  const dataOwnerId = snapshot?.data_owner_id || authenticatedUserId
  const key = snapshotScopeKey(authenticatedUserId, dataOwnerId)
  const existing = await runStore(SNAPSHOT_STORE, 'readonly', (store) => store.get(key))
  // An automatic, active-month cache must never downgrade a successfully
  // prepared workspace snapshot to partial data after a restart or refresh.
  if (existing?.completeness === 'complete' && snapshot?.completeness !== 'complete') {
    return existing.cached_at
  }
  const record = {
    key,
    cached_at: cachedAt,
    authenticated_user_id: authenticatedUserId,
    data_owner_id: dataOwnerId,
    schema_version: OFFLINE_SNAPSHOT_SCHEMA_VERSION,
    completeness: snapshot?.completeness || 'partial',
    snapshot: {
      ...snapshot,
      authenticated_user_id: authenticatedUserId,
      data_owner_id: dataOwnerId,
      schema_version: OFFLINE_SNAPSHOT_SCHEMA_VERSION,
      completeness: snapshot?.completeness || 'partial'
    }
  }
  await runStore(SNAPSHOT_STORE, 'readwrite', (store) => store.put(record))
  return cachedAt
}

export const getOfflineSnapshot = async ({ userId = null, ownerId = null } = {}) => {
  const key = snapshotScopeKey(userId, ownerId || userId)
  const record = await runStore(SNAPSHOT_STORE, 'readonly', (store) => store.get(key))
  return matchesScope(record, { userId, ownerId }) ? record : null
}

export const getReadyOfflineSnapshotForUser = async (userId) => {
  if (!userId) return null
  const records = await runStore(SNAPSHOT_STORE, 'readonly', (store) => store.getAll())
  return (records || []).find((record) => (
    record?.authenticated_user_id === userId &&
    isCompleteOfflineSnapshot(record, { userId })
  )) || null
}

export const clearOfflineSnapshot = async ({ userId = null, ownerId = null } = {}) => (
  runStore(SNAPSHOT_STORE, 'readwrite', (store) => store.delete(snapshotScopeKey(userId, ownerId || userId)))
)

export const saveOfflineAuthProfile = async ({ user, session } = {}) => {
  if (!user?.id) return null

  const savedAt = new Date().toISOString()
  const profile = {
    key: AUTH_PROFILE_KEY,
    saved_at: savedAt,
    user: {
      id: user.id,
      email: user.email || null,
      app_metadata: user.app_metadata || {},
      user_metadata: user.user_metadata || {},
      created_at: user.created_at || null,
      updated_at: user.updated_at || null,
      aud: user.aud || null,
      role: user.role || null
    },
    session: session ? {
      expires_at: session.expires_at || null,
      expires_in: session.expires_in || null,
      token_type: session.token_type || null,
      provider_token_present: Boolean(session.provider_token)
    } : null
  }

  await runStore(AUTH_STORE, 'readwrite', (store) => store.put(profile))
  return profile
}

export const getOfflineAuthProfile = async () => (
  runStore(AUTH_STORE, 'readonly', (store) => store.get(AUTH_PROFILE_KEY))
)

export const clearOfflineAuthProfile = async () => (
  runStore(AUTH_STORE, 'readwrite', (store) => store.delete(AUTH_PROFILE_KEY))
)

const scopedPreferencesKey = (actorId, ownerId) => (
  actorId && ownerId ? `preferences:${actorId}:${ownerId}` : PREFERENCES_KEY
)

export const saveOfflinePreferences = async (userId, payload = {}) => {
  const actorId = payload?.actorId || userId
  const ownerId = payload?.ownerId || userId
  if (!actorId) return null

  const isPartitioned = payload && (payload.personal || payload.workspace)
  const personal = isPartitioned ? (payload.personal || {}) : payload
  const workspace = isPartitioned ? (payload.workspace || {}) : {}

  const key = scopedPreferencesKey(actorId, ownerId)

  const record = {
    key,
    user_id: actorId,
    actor_id: actorId,
    owner_id: ownerId,
    personal,
    workspace,
    personal_revision: payload?.personalRevision ? String(payload.personalRevision) : '0',
    workspace_revision: payload?.workspaceRevision ? String(payload.workspaceRevision) : '0',
    preferences: {
      ...personal,
      ...workspace,
      user_id: actorId
    },
    saved_at: new Date().toISOString()
  }

  await runStore(LOCAL_STATE_STORE, 'readwrite', (store) => store.put(record))
  return record
}

export const getOfflinePreferences = async (userId = null, ownerId = null) => {
  if (userId && ownerId) {
    const key = scopedPreferencesKey(userId, ownerId)
    const record = await runStore(LOCAL_STATE_STORE, 'readonly', (store) => store.get(key))
    if (record && record.actor_id === userId && record.owner_id === ownerId) {
      return record
    }
  }

  const record = await runStore(LOCAL_STATE_STORE, 'readonly', (store) => store.get(PREFERENCES_KEY))
  if (!record) return null
  if (userId && record.actor_id && record.actor_id !== userId && record.user_id !== userId) return null
  if (ownerId && record.owner_id && record.owner_id !== ownerId) return null
  return record
}

export const clearOfflinePreferences = async (userId = null, ownerId = null) => {
  if (userId && ownerId) {
    const key = scopedPreferencesKey(userId, ownerId)
    await runStore(LOCAL_STATE_STORE, 'readwrite', (store) => store.delete(key))
  }
  return runStore(LOCAL_STATE_STORE, 'readwrite', (store) => store.delete(PREFERENCES_KEY))
}

// Deleted rows must never be persisted into the active member preview store.
// This pure helper keeps the write path testable without IndexedDB.
export const filterPreviewMembersForWrite = (members = []) =>
  (Array.isArray(members) ? members : []).filter((member) => Boolean(member) && !member?.deleted_at)

export const saveMemberPreviewMembers = async (scope, tableName, members = []) => {
  const activeMembers = filterPreviewMembersForWrite(members)
  if (activeMembers.length === 0) return 0
  const savedAt = new Date().toISOString()
  const records = activeMembers
    .map((member) => {
      const memberId = getMemberId(member)
      if (!memberId) return null
      return {
        key: memberPreviewKey(scope, tableName, memberId),
        scope: scope || 'guest',
        table_name: tableName || 'default',
        member_id: String(memberId),
        member,
        updated_at: member.updated_at || member.updatedAt || savedAt,
        saved_at: savedAt
      }
    })
    .filter(Boolean)

  if (records.length === 0) return 0
  await runTransaction(MEMBER_PREVIEW_STORE, 'readwrite', (store) => {
    records.forEach((record) => store.put(record))
    return records.length
  })
  return records.length
}

export const getMemberPreviewMembers = async (scope, tableName) => {
  const db = await openOfflineDb()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(MEMBER_PREVIEW_STORE, 'readonly')
    const store = tx.objectStore(MEMBER_PREVIEW_STORE)
    const index = store.indexNames.contains('scope_table') ? store.index('scope_table') : null
    const request = index
      ? index.getAll([scope || 'guest', tableName || 'default'])
      : store.getAll()
    request.onsuccess = () => {
      const records = request.result || []
      const filtered = records
        .filter((record) => (
          record?.scope === (scope || 'guest') &&
          record?.table_name === (tableName || 'default')
        ))
        .map((record) => record.member)
        .filter((member) => Boolean(member) && !member?.deleted_at)
      resolve(filtered)
    }
    request.onerror = () => reject(request.error || new Error('Could not read member preview cache.'))
    tx.oncomplete = () => db.close()
    tx.onerror = () => {
      db.close()
      reject(tx.error || new Error('Member preview cache read failed.'))
    }
  })
}

export const getMemberPreviewCount = async (scope, tableName) => {
  const members = await getMemberPreviewMembers(scope, tableName)
  return members.length
}

export const deleteMemberPreviewMember = async (scope, tableName, memberId) => {
  if (!memberId) return null
  return runStore(
    MEMBER_PREVIEW_STORE,
    'readwrite',
    (store) => store.delete(memberPreviewKey(scope, tableName, memberId))
  )
}

export const clearMemberPreviewTable = async (scope, tableName) => {
  const members = await getMemberPreviewMembers(scope, tableName)
  if (members.length === 0) return 0
  await runTransaction(MEMBER_PREVIEW_STORE, 'readwrite', (store) => {
    members.forEach((member) => {
      const memberId = getMemberId(member)
      if (memberId) store.delete(memberPreviewKey(scope, tableName, memberId))
    })
    return members.length
  })
  return members.length
}

export const clearMemberPreviewCache = async () => (
  runStore(MEMBER_PREVIEW_STORE, 'readwrite', (store) => store.clear())
)

export const clearMemberPreviewScope = async (scope) => {
  if (!scope) return 0
  const db = await openOfflineDb()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(MEMBER_PREVIEW_STORE, 'readwrite')
    const store = tx.objectStore(MEMBER_PREVIEW_STORE)
    const request = store.getAll()
    let removed = 0
    request.onsuccess = () => {
      ;(request.result || []).forEach((record) => {
        if (record?.scope === scope) {
          store.delete(record.key)
          removed += 1
        }
      })
    }
    tx.oncomplete = () => { db.close(); resolve(removed) }
    tx.onerror = () => { db.close(); reject(tx.error || new Error('Member preview cache clear failed.')) }
  })
}

export const coalesceOfflineChange = (existingChanges = [], change = {}, now = new Date().toISOString()) => {
  const sameMember = (candidate) => (
    candidate?.member_id === change.member_id &&
    candidate?.table_name === change.table_name
  )
  const existingAdd = existingChanges.find(candidate => candidate?.action_type === 'member_add' && sameMember(candidate))
  const relatedUpdates = existingChanges.filter(candidate => candidate?.action_type === 'member_update' && sameMember(candidate))

  if (change.action_type === 'member_delete' && existingAdd) {
    return {
      queuedChange: null,
      removeIds: [existingAdd.local_change_id, ...relatedUpdates.map(item => item.local_change_id)].filter(Boolean),
      coalesced: true
    }
  }

  if (change.action_type === 'member_update' && existingAdd) {
    return {
      queuedChange: {
        ...existingAdd,
        member_data: { ...(existingAdd.member_data || {}), ...(change.updates || {}) },
        updated_at: now,
        sync_status: 'pending',
        retry_count: 0,
        last_attempt_at: null,
        client_revision: Number(existingAdd.client_revision || 1) + 1
      },
      removeIds: relatedUpdates.map(item => item.local_change_id).filter(Boolean),
      coalesced: true
    }
  }

  const sameId = existingChanges.find(candidate => candidate?.local_change_id === change.local_change_id)
  const createdAt = sameId?.created_at || change.created_at || now
  return {
    queuedChange: {
      ...(sameId || {}),
      ...change,
      ...(change.action_type === 'member_update' && sameId
        ? { updates: { ...(sameId.updates || {}), ...(change.updates || {}) } }
        : {}),
      ...(change.action_type === 'member_add' && sameId
        ? { member_data: { ...(sameId.member_data || {}), ...(change.member_data || {}) } }
        : {}),
      created_at: createdAt,
      updated_at: now,
      sync_status: 'pending',
      retry_count: 0,
      last_attempt_at: null,
      client_revision: Number(sameId?.client_revision || 0) + 1,
      idempotency_key: change.idempotency_key || change.local_change_id
    },
    removeIds: [],
    coalesced: Boolean(sameId)
  }
}

export const queueOfflineChange = async (change) => {
  const pendingChanges = await getPendingOfflineChanges({
    userId: change?.user_id || null,
    ownerId: change?.owner_id || null
  })
  const result = coalesceOfflineChange(pendingChanges, change)
  for (const localChangeId of result.removeIds) {
    await removeOfflineChange(localChangeId)
  }
  if (!result.queuedChange) {
    return { ...change, sync_status: 'superseded', coalesced: true }
  }
  await runStore(PENDING_STORE, 'readwrite', (store) => store.put(result.queuedChange))
  return result.queuedChange
}

export const getPendingOfflineChanges = async ({ userId = null, ownerId = null } = {}) => {
  const changes = await runStore(PENDING_STORE, 'readonly', (store) => store.getAll())
  return changes
    .filter((change) => (
      change.sync_status !== 'synced' &&
      (!userId || change.user_id === userId) &&
      (!ownerId || change.owner_id === ownerId)
    ))
    .sort((a, b) => String(a.created_at || '').localeCompare(String(b.created_at || '')))
}

export const updateOfflineChangeStatus = async (localChangeId, updates = {}) => {
  const existing = await runStore(PENDING_STORE, 'readonly', (store) => store.get(localChangeId))
  if (!existing) return null
  const next = {
    ...existing,
    ...updates,
    retry_count: updates.retry_count ?? (
      updates.sync_status === 'pending' || updates.sync_status === 'failed'
        ? Number(existing.retry_count || 0) + 1
        : Number(existing.retry_count || 0)
    ),
    last_attempt_at: updates.last_attempt_at || (
      updates.sync_status === 'pending' || updates.sync_status === 'failed'
        ? new Date().toISOString()
        : existing.last_attempt_at
    ),
    updated_at: new Date().toISOString()
  }
  await runStore(PENDING_STORE, 'readwrite', (store) => store.put(next))
  return next
}

// Bounded retry policy for the automatic offline flush. A change gets a fixed
// number of automatic attempts, spaced by an increasing backoff. When the
// budget is spent the change is moved to a recoverable `failed` state instead
// of being retried forever (or silently discarded).
export const SYNC_RETRY_LIMIT = 5

const SYNC_BACKOFF_STEPS_MS = [30_000, 60_000, 120_000, 300_000, 900_000]

export const getSyncBackoffDelayMs = (retryCount) => {
  const count = Math.max(0, Number(retryCount) || 0)
  return SYNC_BACKOFF_STEPS_MS[Math.min(count, SYNC_BACKOFF_STEPS_MS.length - 1)]
}

// Earliest allowed attempt timestamp for a change. Returns null when the
// change was never attempted yet (first attempt may run immediately).
export const getChangeNextAttemptAt = (change, now = Date.now()) => {
  if (!change) return null
  const lastAttemptAt = Date.parse(change.last_attempt_at || '')
  if (!Number.isFinite(lastAttemptAt) || lastAttemptAt <= 0) return null
  return lastAttemptAt + getSyncBackoffDelayMs(change.retry_count)
}

export const isChangeSyncable = (change) => (
  change?.sync_status === 'pending' || change?.sync_status === 'waiting_for_month'
)

// Automatic attempts are only allowed while the retry budget remains and the
// backoff window has elapsed. Manual syncs intentionally bypass this gate.
export const isChangeRetryEligible = (change, now = Date.now()) => {
  if (!isChangeSyncable(change)) return false
  if (Number(change.retry_count || 0) >= SYNC_RETRY_LIMIT) return false
  const nextAttemptAt = getChangeNextAttemptAt(change, now)
  return nextAttemptAt === null || now >= nextAttemptAt
}

// Delay until the earliest next allowed automatic attempt across all syncable
// changes that still have retry budget left (0 when at least one is eligible
// right now, null when none can ever be attempted automatically).
export const getSyncableChangesNextAttemptDelayMs = (changes, now = Date.now(), { limit = SYNC_RETRY_LIMIT } = {}) => {
  const delays = (Array.isArray(changes) ? changes : [])
    .filter((change) => isChangeSyncable(change) && Number(change?.retry_count || 0) < limit)
    .map((change) => {
      const nextAttemptAt = getChangeNextAttemptAt(change, now)
      return nextAttemptAt === null ? 0 : Math.max(0, nextAttemptAt - now)
    })
  return delays.length > 0 ? Math.min(...delays) : null
}

// Failure bookkeeping for one flush attempt. Transient failures stay `pending`
// until the retry budget is spent; non-transient failures become `failed`
// immediately. `failed` changes are never auto-retried but are preserved and
// recoverable through a manual sync. The returned `error` is only set when the
// retry budget was exhausted by repeated transient failures, so the caller can
// surface an explicit recovery message instead of a raw network error.
export const getNextFailureSyncStatus = (change, { transient = false, limit = SYNC_RETRY_LIMIT } = {}) => {
  const nextRetryCount = Number(change?.retry_count || 0) + 1
  const budgetExhausted = !transient || nextRetryCount >= limit
  return {
    sync_status: budgetExhausted ? 'failed' : 'pending',
    retry_count: nextRetryCount,
    error: transient && budgetExhausted
      ? 'Sync kept failing after several attempts. Your change is still saved locally - retry from Settings.'
      : null
  }
}

// Decides how a pending member operation should be handled against the row
// currently on the server:
// - 'remove'   member_delete on an already-deleted/missing row is idempotent
//              success: retire the queued delete (never resurrect, never loop).
// - 'fail'     update/add/attendance against a deleted row cannot apply and
//              must not resurrect the member; keep the change, stop auto-retry.
// - 'proceed'  no deletion on the server, safe to run the operation.
export const resolveServerDeletedMemberChange = (change, serverRow) => {
  // A queued member_add normally has no server row yet (a brand-new offline
  // member), so an absent row is the expected state and must proceed to the
  // idempotent upsert instead of being misread as a deletion. Only an explicit
  // soft-deleted server row (deleted_at set) blocks the add and prevents
  // resurrection of an already-deleted member identity.
  if (change?.action_type === 'member_add') {
    if (serverRow && serverRow.deleted_at) {
      return {
        action: 'fail',
        error: 'Member was deleted on the server. This change is kept locally and will not auto-retry.'
      }
    }
    return { action: 'proceed' }
  }
  const isDeleted = !serverRow || Boolean(serverRow.deleted_at)
  if (!isDeleted) return { action: 'proceed' }
  if (change?.action_type === 'member_delete') return { action: 'remove' }
  return {
    action: 'fail',
    error: 'Member was deleted on the server. This change is kept locally and will not auto-retry.'
  }
}

export const removeOfflineChange = async (localChangeId) => (
  runStore(PENDING_STORE, 'readwrite', (store) => store.delete(localChangeId))
)

export const clearPendingOfflineChanges = async () => (
  runStore(PENDING_STORE, 'readwrite', (store) => store.clear())
)

export const clearAllOfflineData = async ({ userId = null, ownerId = null, scope = null } = {}) => {
  const pending = await getPendingOfflineChanges({ userId, ownerId })
  if (pending.length > 0) {
    throw new Error('Sync or resolve pending changes before removing downloaded data.')
  }
  await clearOfflineSnapshot({ userId, ownerId })
  await clearOfflinePreferences(userId, ownerId)
  if (scope) await clearMemberPreviewScope(scope)
}
