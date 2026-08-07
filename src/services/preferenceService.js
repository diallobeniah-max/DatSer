import { supabase } from '../lib/supabase'
import {
  getPersonalSettingsDefaults,
  getWorkspaceSettingsDefaults,
  pickPersonalPreferencePatch,
  pickWorkspacePreferencePatch,
  PERSONAL_PREFERENCE_KEYS,
  WORKSPACE_PREFERENCE_KEYS
} from '../config/settingsRegistry'
import {
  isBackendHealthy,
  isBackendDegradedError,
  markBackendDegraded,
  markBackendHealthy,
  subscribeBackendHealth
} from '../utils/backendHealthCoordinator'

const createEmptyPreferenceBundle = () => ({
  personalPreferences: getPersonalSettingsDefaults(),
  workspacePreferences: getWorkspaceSettingsDefaults(),
  personalRevision: 0n,
  workspaceRevision: 0n,
  isOwner: true,
  ownerId: null
})

let inMemoryPreferenceBundle = createEmptyPreferenceBundle()
const inFlightRequests = new Map()

const saveQueues = {
  personal: { active: null, pending: null },
  workspace: { active: null, pending: null }
}
const bundleLoads = new Map()
let conflictBundleLoad = null

// Bounded client-side limit for the first required preference-bundle request so
// a hung get_preference_bundle can never leave hydration "loading" forever.
const BUNDLE_LOAD_TIMEOUT_MS = 15 * 1000

const withTimeout = (promise, ms, label) => {
  let timer
  const timeoutPromise = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label || 'Request'} timed out after ${ms}ms`)), ms)
  })
  return Promise.race([promise, timeoutPromise]).finally(() => {
    if (timer) clearTimeout(timer)
  })
}

const pausedWriteResult = () => ({
  success: false,
  code: 'SERVICE_UNAVAILABLE',
  message: 'Service is temporarily degraded. Writes paused.'
})

// A failure discovered by another part of the app must immediately release
// settings edits that have not started yet. The active request is allowed to
// settle once, but no queued patch is replayed while the backend is degraded.
subscribeBackendHealth((healthy) => {
  if (healthy) return
  Object.values(saveQueues).forEach((queue) => {
    if (!queue.pending) return
    const result = pausedWriteResult()
    queue.pending.waiters.forEach((resolve) => resolve(result))
    queue.pending = null
  })
})

const toBigIntRevision = (value, fallback = 0n) => {
  try {
    if (value === null || value === undefined || value === '') return fallback
    return BigInt(value)
  } catch {
    return fallback
  }
}

const getRevisionNumber = (value) => {
  const revision = toBigIntRevision(value)
  const numericRevision = Number(revision)
  return Number.isSafeInteger(numericRevision) ? numericRevision : 0
}

const validatePatch = (patch, allowedKeys, scope) => {
  const unsupportedKeys = Object.keys(patch || {})
    .filter((key) => !allowedKeys.includes(key))

  if (unsupportedKeys.length === 0) return null

  return {
    success: false,
    code: 'UNSUPPORTED_PREFERENCE_KEY',
    scope,
    unsupportedKeys,
    message: `Unsupported ${scope} preference key${unsupportedKeys.length === 1 ? '' : 's'}: ${unsupportedKeys.join(', ')}`
  }
}

const getErrorResult = (error) => {
  if (isBackendDegradedError(error)) {
    markBackendDegraded(error)
    return {
      success: false,
      code: error?.code || 'SERVICE_UNAVAILABLE',
      message: 'Service is temporarily unavailable (503 / Schema cache error). Using local preferences.'
    }
  }

  if (error?.code === '40001' || String(error?.message || '').toLowerCase().includes('revision') || String(error?.message || '').toLowerCase().includes('conflict')) {
    return {
      success: false,
      code: 'REVISION_CONFLICT',
      message: 'These settings changed on another device. Review the latest values before saving again.'
    }
  }

  return {
    success: false,
    code: error?.code || 'ERROR',
    message: error?.message || 'This setting could not be saved. Your previous saved value is still active.'
  }
}

const getResponsePreferences = (data, scope, fallbackPatch) => {
  if (!data || typeof data !== 'object') return fallbackPatch
  if (scope === 'personal') return data.personal_preferences || data.preferences || fallbackPatch
  return data.workspace_preferences || data.preferences || fallbackPatch
}

export const generateRequestId = (prefix = 'req') => (
  `${prefix}_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`
)

export const getCachedPreferenceBundle = () => inMemoryPreferenceBundle

export const clearPreferenceCache = () => {
  inMemoryPreferenceBundle = createEmptyPreferenceBundle()
  inFlightRequests.clear()
  saveQueues.personal.active = null
  saveQueues.personal.pending = null
  saveQueues.workspace.active = null
  saveQueues.workspace.pending = null
  bundleLoads.clear()
  conflictBundleLoad = null
}

export const loadPreferenceBundle = async (ownerId, { timeoutMs = BUNDLE_LOAD_TIMEOUT_MS } = {}) => {
  if (!supabase) {
    throw new Error('Database client unavailable for preference hydration')
  }

  const loadKey = ownerId || '__personal__'
  if (bundleLoads.has(loadKey)) return bundleLoads.get(loadKey)

  const loadTask = (async () => {
    try {
      const response = await withTimeout(
        supabase.rpc('get_preference_bundle', { p_owner_id: ownerId || null }),
        timeoutMs,
        'Preference bundle load'
      )
      const data = response?.data
      const error = response?.error

      if (error) {
        if (isBackendDegradedError(error)) markBackendDegraded(error)
        throw new Error(error.message || 'Failed to load preferences')
      }
      if (!data) {
        throw new Error('Preference bundle response was empty')
      }

      markBackendHealthy()

      inMemoryPreferenceBundle = {
        personalPreferences: {
          ...getPersonalSettingsDefaults(),
          ...(data.personal_preferences || {})
        },
        workspacePreferences: {
          ...getWorkspaceSettingsDefaults(),
          ...(data.workspace_preferences || {})
        },
        personalRevision: toBigIntRevision(data.personal_revision),
        workspaceRevision: toBigIntRevision(data.workspace_revision),
        isOwner: data.is_owner === undefined ? true : Boolean(data.is_owner),
        ownerId: data.owner_id || ownerId || null
      }

      return inMemoryPreferenceBundle
    } finally {
      bundleLoads.delete(loadKey)
    }
  })()

  bundleLoads.set(loadKey, loadTask)
  return loadTask
}

const isRevisionConflict = (error) => {
  const message = String(error?.message || '').toLowerCase()
  return error?.code === '40001' || message.includes('revision') || message.includes('conflict')
}

// Conflict recovery needs a positively confirmed server bundle. Unlike normal
// hydration, it must not silently fall back to stale in-memory values because
// that would retry the same outdated revision and create a request storm.
const loadConfirmedBundleForConflict = async (ownerId) => {
  if (!supabase || !isBackendHealthy()) return null
  if (conflictBundleLoad) return conflictBundleLoad

  conflictBundleLoad = (async () => {
    try {
      const { data, error } = await supabase.rpc('get_preference_bundle', {
        p_owner_id: ownerId || null
      })

      if (error || !data) {
        if (isBackendDegradedError(error)) markBackendDegraded(error)
        return null
      }

      markBackendHealthy()
      inMemoryPreferenceBundle = {
        personalPreferences: {
          ...getPersonalSettingsDefaults(),
          ...(data.personal_preferences || {})
        },
        workspacePreferences: {
          ...getWorkspaceSettingsDefaults(),
          ...(data.workspace_preferences || {})
        },
        personalRevision: toBigIntRevision(data.personal_revision),
        workspaceRevision: toBigIntRevision(data.workspace_revision),
        isOwner: data.is_owner === undefined ? true : Boolean(data.is_owner),
        ownerId: data.owner_id || ownerId || null
      }
      return inMemoryPreferenceBundle
    } catch (error) {
      if (isBackendDegradedError(error)) markBackendDegraded(error)
      return null
    } finally {
      conflictBundleLoad = null
    }
  })()

  return conflictBundleLoad
}

const resultForScope = (scope, requestId) => ({
  data: scope === 'personal' ? inMemoryPreferenceBundle.personalPreferences : inMemoryPreferenceBundle.workspacePreferences,
  revision: scope === 'personal' ? inMemoryPreferenceBundle.personalRevision : inMemoryPreferenceBundle.workspaceRevision,
  requestId
})

const saveOnePreferencePatch = async ({ scope, ownerId, patch, expectedRevision, requestId }) => {
  const rpcName = scope === 'personal' ? 'save_personal_preferences' : 'save_workspace_preferences'
  const revisionKey = scope === 'personal' ? 'personalRevision' : 'workspaceRevision'
  const preferenceKey = scope === 'personal' ? 'personalPreferences' : 'workspacePreferences'
  const rpcArgs = scope === 'personal'
    ? { p_preferences: patch, p_expected_revision: getRevisionNumber(expectedRevision), p_request_id: requestId }
    : { p_owner_id: ownerId, p_preferences: patch, p_expected_revision: getRevisionNumber(expectedRevision), p_request_id: requestId }

  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const { data, error } = await supabase.rpc(rpcName, rpcArgs)
      if (!error) {
        markBackendHealthy()
        const responsePreferences = getResponsePreferences(data, scope, patch)
        const nextPreferences = { ...inMemoryPreferenceBundle[preferenceKey], ...responsePreferences }
        const nextRevision = toBigIntRevision(
          scope === 'personal' ? data?.personal_revision ?? data?.revision : data?.workspace_revision ?? data?.revision,
          toBigIntRevision(rpcArgs.p_expected_revision) + 1n
        )
        inMemoryPreferenceBundle = {
          ...inMemoryPreferenceBundle,
          [preferenceKey]: nextPreferences,
          [revisionKey]: nextRevision,
          ...(scope === 'workspace' ? { ownerId } : {})
        }
        return { success: true, ...resultForScope(scope, requestId), ...(scope === 'workspace' ? { ownerId } : {}) }
      }

      if (isBackendDegradedError(error)) {
        markBackendDegraded(error)
        return getErrorResult(error)
      }
      if (!isRevisionConflict(error)) return getErrorResult(error)

      if (attempt === 1) return { ...getErrorResult(error), ...resultForScope(scope, requestId) }
      const freshBundle = await loadConfirmedBundleForConflict(scope === 'workspace' ? ownerId : null)
      if (!freshBundle) {
        return { ...getErrorResult(error), ...resultForScope(scope, requestId) }
      }
      const freshPreferences = freshBundle[preferenceKey]
      if (Object.keys(patch).every((key) => freshPreferences[key] === patch[key])) {
        return { success: true, ...resultForScope(scope, requestId), ...(scope === 'workspace' ? { ownerId } : {}) }
      }
      rpcArgs.p_expected_revision = getRevisionNumber(freshBundle[revisionKey])
    } catch (error) {
      if (isBackendDegradedError(error)) markBackendDegraded(error)
      return getErrorResult(error)
    }
  }

  return {
    success: false,
    code: 'REVISION_CONFLICT',
    message: 'The latest saved settings could not be updated. Please try once more.',
    ...resultForScope(scope, requestId)
  }
}

const enqueuePreferenceSave = ({ scope, ownerId = null, patch, options = {} }) => {
  const queue = saveQueues[scope]
  const requestId = options.requestId || generateRequestId(scope)
  if (!isBackendHealthy()) return Promise.resolve(pausedWriteResult())
  if (inFlightRequests.has(requestId)) return inFlightRequests.get(requestId)

  if (queue.active) {
    if (!queue.pending) {
      queue.pending = { patch: {}, ownerId, requestId, expectedRevision: options.expectedRevision, waiters: [] }
    }
    queue.pending.patch = { ...queue.pending.patch, ...patch }
    queue.pending.ownerId = ownerId || queue.pending.ownerId
    return new Promise((resolve) => queue.pending.waiters.push(resolve))
  }

  const run = async (initialJob) => {
    let job = initialJob
    let initialResult
    try {
      while (job && isBackendHealthy()) {
        const expectedRevision = job.expectedRevision ?? (scope === 'personal' ? inMemoryPreferenceBundle.personalRevision : inMemoryPreferenceBundle.workspaceRevision)
        const result = await saveOnePreferencePatch({
          scope,
          ownerId: job.ownerId,
          patch: job.patch,
          expectedRevision,
          requestId: job.requestId
        })
        if (initialResult === undefined) initialResult = result
        job.waiters?.forEach((resolve) => resolve(result))

        if (!result.success) {
          queue.pending?.waiters?.forEach((resolve) => resolve(result))
          queue.pending = null
          break
        }
        job = queue.pending
        queue.pending = null
      }
      return initialResult || pausedWriteResult()
    } finally {
      queue.active = null
      queue.pending = null
      inFlightRequests.delete(initialJob.requestId)
    }
  }

  const initialJob = { patch, ownerId, requestId, expectedRevision: options.expectedRevision, waiters: [] }
  queue.active = run(initialJob)
  inFlightRequests.set(requestId, queue.active)
  return queue.active
}

export const savePersonalPreferencePatch = (patch = {}, options = {}) => {
  const validationError = validatePatch(patch, PERSONAL_PREFERENCE_KEYS, 'personal')
  if (validationError) return Promise.resolve(validationError)
  const cleanedPatch = pickPersonalPreferencePatch(patch)
  if (Object.keys(cleanedPatch).length === 0) return Promise.resolve({ success: true, ...resultForScope('personal', options.requestId || null) })
  if (!supabase) return Promise.resolve({ success: false, code: 'NO_DATABASE', message: 'Database client unavailable' })
  return enqueuePreferenceSave({ scope: 'personal', ownerId: options.ownerId || null, patch: cleanedPatch, options })
}

export const saveWorkspacePreferencePatch = (ownerId, patch = {}, options = {}) => {
  const validationError = validatePatch(patch, WORKSPACE_PREFERENCE_KEYS, 'workspace')
  if (validationError) return Promise.resolve(validationError)
  const cleanedPatch = pickWorkspacePreferencePatch(patch)
  const targetOwnerId = ownerId || inMemoryPreferenceBundle.ownerId
  if (!targetOwnerId) return Promise.resolve({ success: false, code: 'MISSING_OWNER', message: 'Canonical workspace owner missing' })
  if (Object.keys(cleanedPatch).length === 0) return Promise.resolve({ success: true, ...resultForScope('workspace', options.requestId || null), ownerId: targetOwnerId })
  if (!supabase) return Promise.resolve({ success: false, code: 'NO_DATABASE', message: 'Database client unavailable' })
  return enqueuePreferenceSave({ scope: 'workspace', ownerId: targetOwnerId, patch: cleanedPatch, options })
}
