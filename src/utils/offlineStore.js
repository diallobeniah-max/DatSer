const DB_NAME = 'datser-offline'
const DB_VERSION = 2
const SNAPSHOT_STORE = 'snapshots'
const PENDING_STORE = 'pendingChanges'
const AUTH_STORE = 'auth'
const LOCAL_STATE_STORE = 'localState'
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

export const queueOfflineChange = async (change) => {
  const createdAt = change.created_at || new Date().toISOString()
  const queuedChange = {
    ...change,
    created_at: createdAt,
    sync_status: change.sync_status || 'pending'
  }
  await runStore(PENDING_STORE, 'readwrite', (store) => store.put(queuedChange))
  return queuedChange
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
  const next = { ...existing, ...updates, updated_at: new Date().toISOString() }
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
}
