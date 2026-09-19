import { getAndroidMemberV2RuntimeConfig, isAndroidMemberV2ValidationBuild } from './androidMemberV2TestRuntimeConfig'

const guardPrefix = 'datser.member-v2.local-flow-guard:'
const guardEventName = 'datser:member-v2-local-flow-guard'

const localSupabaseUrl = (value) => {
  try {
    const url = new URL(value)
    return url.protocol === 'http:' && ['127.0.0.1', 'localhost', '10.0.2.2'].includes(url.hostname)
  } catch {
    return false
  }
}

const guardKey = ({ userId, ownerId }) => `${guardPrefix}${userId}:${ownerId}`

const localStorageFor = (storage) => storage || (typeof window === 'undefined' ? null : window.localStorage)

const publishGuardChange = (key) => {
  if (typeof window === 'undefined' || typeof window.dispatchEvent !== 'function') return
  window.dispatchEvent(new CustomEvent(guardEventName, { detail: { key } }))
}

// This experiment is intentionally impossible to enable against a hosted
// Supabase project. It is a local Vite opt-in, not a workspace preference.
export const isMemberV2LocalExperimentEnabled = (env = import.meta.env) => (
  (
    env?.DEV === true
    && env?.VITE_DATSER_MEMBER_V2_EXPERIMENT === 'true'
    && localSupabaseUrl(env?.VITE_SUPABASE_URL)
  )
  || (
    isAndroidMemberV2ValidationBuild(env)
    && localSupabaseUrl(getAndroidMemberV2RuntimeConfig({ env })?.url)
  )
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

// This is presentation metadata only. It never authorizes a server request or
// changes the durable Member V2 state.
export const getMemberV2LocalFlowStatus = (guard, { offline = false } = {}) => {
  if (!guard) return null
  if (Number(guard.conflicts || 0) > 0) return { label: 'Conflict needs review', tone: 'conflict' }
  if (Number(guard.failedChanges || 0) > 0) return { label: 'Sync needs retry', tone: 'failed' }
  if (Number(guard.pendingChanges || 0) > 0) return { label: offline ? 'Offline changes' : 'Sync pending', tone: offline ? 'offline' : 'pending' }
  return null
}

export const subscribeMemberV2LocalFlowGuard = ({ userId, ownerId, listener, storage } = {}) => {
  if (!userId || !ownerId || typeof listener !== 'function' || typeof window === 'undefined') return () => {}
  const key = guardKey({ userId, ownerId })
  const notify = () => listener(getMemberV2LocalFlowGuard({ userId, ownerId, storage }))
  const onGuardChange = (event) => { if (event?.detail?.key === key) notify() }
  const onStorage = (event) => { if (event?.key === key) notify() }
  window.addEventListener(guardEventName, onGuardChange)
  window.addEventListener('storage', onStorage)
  return () => {
    window.removeEventListener(guardEventName, onGuardChange)
    window.removeEventListener('storage', onStorage)
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
      publishGuardChange(guardKey({ userId, ownerId }))
      return
    }
    target.setItem(guardKey({ userId, ownerId }), JSON.stringify({
      state: syncState.state,
      pendingChanges: Number(syncState.pendingChanges || 0),
      failedChanges: Number(syncState.failedChanges || 0),
      conflicts: Number(syncState.conflicts || 0),
      updatedAt: new Date().toISOString(),
    }))
    publishGuardChange(guardKey({ userId, ownerId }))
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
