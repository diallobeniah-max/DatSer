const DB_NAME = 'datser-offline'
const DB_VERSION = 3
const SNAPSHOT_STORE = 'snapshots'
const PENDING_STORE = 'pendingChanges'
const AUTH_STORE = 'auth'
const LOCAL_STATE_STORE = 'localState'
const MEMBER_PREVIEW_STORE = 'memberPreviews'
const SNAPSHOT_KEY = 'latest'
const AUTH_PROFILE_KEY = 'latest'
const PREFERENCES_KEY = 'preferences'

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
  await runStore(SNAPSHOT_STORE, 'readwrite', (store) => store.put({
    key: SNAPSHOT_KEY,
    cached_at: cachedAt,
    snapshot
  }))
  return cachedAt
}

export const getOfflineSnapshot = async () => {
  const record = await runStore(SNAPSHOT_STORE, 'readonly', (store) => store.get(SNAPSHOT_KEY))
  return record || null
}

export const clearOfflineSnapshot = async () => (
  runStore(SNAPSHOT_STORE, 'readwrite', (store) => store.delete(SNAPSHOT_KEY))
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

export const saveOfflinePreferences = async (userId, preferences = {}) => {
  if (!userId) return null

  const record = {
    key: PREFERENCES_KEY,
    user_id: userId,
    preferences: {
      ...(preferences || {}),
      user_id: preferences?.user_id || userId
    },
    saved_at: new Date().toISOString()
  }

  await runStore(LOCAL_STATE_STORE, 'readwrite', (store) => store.put(record))
  return record
}

export const getOfflinePreferences = async (userId = null) => {
  const record = await runStore(LOCAL_STATE_STORE, 'readonly', (store) => store.get(PREFERENCES_KEY))
  if (!record) return null
  if (userId && record.user_id && record.user_id !== userId) return null
  return record
}

export const clearOfflinePreferences = async () => (
  runStore(LOCAL_STATE_STORE, 'readwrite', (store) => store.delete(PREFERENCES_KEY))
)

export const saveMemberPreviewMembers = async (scope, tableName, members = []) => {
  if (!Array.isArray(members) || members.length === 0) return 0
  const savedAt = new Date().toISOString()
  const records = members
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
      client_revision: Number(sameId?.client_revision || 0) + 1,
      idempotency_key: change.idempotency_key || change.local_change_id
    },
    removeIds: [],
    coalesced: Boolean(sameId)
  }
}

export const queueOfflineChange = async (change) => {
  const pendingChanges = await getPendingOfflineChanges()
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

export const getPendingOfflineChanges = async () => {
  const changes = await runStore(PENDING_STORE, 'readonly', (store) => store.getAll())
  return changes
    .filter((change) => change.sync_status !== 'synced')
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

export const removeOfflineChange = async (localChangeId) => (
  runStore(PENDING_STORE, 'readwrite', (store) => store.delete(localChangeId))
)

export const clearPendingOfflineChanges = async () => (
  runStore(PENDING_STORE, 'readwrite', (store) => store.clear())
)

export const clearAllOfflineData = async () => {
  await clearOfflineSnapshot()
  await clearPendingOfflineChanges()
  await clearOfflinePreferences()
  await clearMemberPreviewCache()
}
