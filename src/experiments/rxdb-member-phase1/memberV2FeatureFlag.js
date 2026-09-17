const guardPrefix = 'datser.member-v2.local-flow-guard:'

const localSupabaseUrl = (value) => {
  try {
    const url = new URL(value)
    return url.protocol === 'http:' && (url.hostname === '127.0.0.1' || url.hostname === 'localhost')
  } catch {
    return false
  }
}

const guardKey = ({ userId, ownerId }) => `${guardPrefix}${userId}:${ownerId}`

const localStorageFor = (storage) => storage || (typeof window === 'undefined' ? null : window.localStorage)

// This experiment is intentionally impossible to enable against a hosted
// Supabase project. It is a local Vite opt-in, not a workspace preference.
export const isMemberV2LocalExperimentEnabled = (env = import.meta.env) => (
  env?.DEV === true
  && env?.VITE_DATSER_MEMBER_V2_EXPERIMENT === 'true'
  && localSupabaseUrl(env?.VITE_SUPABASE_URL)
)

export const getMemberV2LocalFlowGuard = ({ userId, ownerId, storage } = {}) => {
  if (!userId || !ownerId) return null
  try {
    const raw = localStorageFor(storage)?.getItem(guardKey({ userId, ownerId }))
    return raw ? JSON.parse(raw) : null
  } catch {
    return null
  }
}

export const updateMemberV2LocalFlowGuard = ({ userId, ownerId, syncState, storage } = {}) => {
  if (!userId || !ownerId || !syncState) return
  const target = localStorageFor(storage)
  if (!target) return
  const blocked = Number(syncState.pendingChanges || 0) > 0
    || Number(syncState.failedChanges || 0) > 0
    || Number(syncState.conflicts || 0) > 0
  try {
    if (!blocked) {
      target.removeItem(guardKey({ userId, ownerId }))
      return
    }
    target.setItem(guardKey({ userId, ownerId }), JSON.stringify({
      state: syncState.state,
      pendingChanges: Number(syncState.pendingChanges || 0),
      failedChanges: Number(syncState.failedChanges || 0),
      conflicts: Number(syncState.conflicts || 0),
      updatedAt: new Date().toISOString(),
    }))
  } catch {
    // A storage failure must not weaken the server contract or alter writes.
  }
}

export const assertLegacyMemberFlowIsSafe = ({ userId, ownerId, env = import.meta.env, storage } = {}) => {
  // Production has no Member V2 switch and therefore never reads this local
  // development guard. In a local Vite build, however, a pending V2 change
  // must be recovered through V2 instead of silently switching write paths.
  if (env?.DEV !== true || isMemberV2LocalExperimentEnabled(env)) return
  const guard = getMemberV2LocalFlowGuard({ userId, ownerId, storage })
  if (!guard) return
  throw new Error('Member V2 has unsynced local work. Re-enable the local Member V2 experiment and sync or resolve it before using the legacy member form.')
}
