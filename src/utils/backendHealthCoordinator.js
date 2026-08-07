import { supabase } from '../lib/supabase'

let isHealthy = true
let lastDegradedError = null
let healthCheckTimer = null
let healthProbeInFlight = null
let currentBackoffMs = 5000
const MAX_BACKOFF_MS = 30000
const listeners = new Set()

export const isBackendDegradedError = (error) => {
  if (!error) return false
  const code = String(error.code || '')
  const status = Number(error.status || error.statusCode || 0)
  const msg = String(error.message || '').toLowerCase()
  return (
    code === 'PGRST002' ||
    status === 503 ||
    msg.includes('schema cache') ||
    msg.includes('503') ||
    msg.includes('could not query the database for the schema cache') ||
    msg.includes('connection pool') ||
    msg.includes('pooler') ||
    msg.includes('network request failed') ||
    msg.includes('failed to fetch') ||
    msg.includes('network error') ||
    msg.includes('network connection was lost') ||
    msg.includes('load failed')
  )
}

export const isBackendHealthy = () => isHealthy
export const getBackendDegradedError = () => lastDegradedError

export const subscribeBackendHealth = (listener) => {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

const notifyListeners = () => {
  listeners.forEach((listener) => {
    try {
      listener(isHealthy, lastDegradedError)
    } catch (e) {
      console.error('[backendHealthCoordinator] listener error:', e)
    }
  })
}

export const markBackendDegraded = (error) => {
  lastDegradedError = error
  if (isHealthy) {
    console.warn('[backendHealthCoordinator] Backend degraded / 503 detected:', error?.message || error)
    isHealthy = false
    notifyListeners()
  }
  scheduleHealthCheck()
}

export const markBackendHealthy = () => {
  if (healthCheckTimer) {
    clearTimeout(healthCheckTimer)
    healthCheckTimer = null
  }
  currentBackoffMs = 5000
  lastDegradedError = null
  if (!isHealthy) {
    console.log('[backendHealthCoordinator] Backend health restored.')
    isHealthy = true
    notifyListeners()
  }
}

export const scheduleHealthCheck = () => {
  // Never schedule background polling timers during automated test runs
  if (typeof process !== 'undefined' && (process.env.NODE_ENV === 'test' || process.env.VITEST)) {
    return
  }

  if (healthCheckTimer) return

  healthCheckTimer = setTimeout(async () => {
    healthCheckTimer = null
    if (isHealthy || healthProbeInFlight) return

    healthProbeInFlight = (async () => {
      try {
      if (!supabase || typeof supabase.rpc !== 'function') {
        markBackendHealthy()
        return
      }
      // One read-only probe is permitted while degraded. It must never write
      // preferences or fan out into multiple fallback reads.
      const { error } = await supabase.rpc('get_preference_bundle', { p_owner_id: null })
      if (error && isBackendDegradedError(error)) {
        currentBackoffMs = Math.min(currentBackoffMs * 2, MAX_BACKOFF_MS)
        scheduleHealthCheck()
      } else {
        markBackendHealthy()
      }
      } catch (err) {
      if (isBackendDegradedError(err)) {
        currentBackoffMs = Math.min(currentBackoffMs * 2, MAX_BACKOFF_MS)
        scheduleHealthCheck()
      } else {
        markBackendHealthy()
      }
      } finally {
        healthProbeInFlight = null
      }
    })()
    await healthProbeInFlight
  }, currentBackoffMs)

  if (healthCheckTimer && typeof healthCheckTimer.unref === 'function') {
    healthCheckTimer.unref()
  }
}

export const resetHealthCoordinator = () => {
  if (healthCheckTimer) {
    clearTimeout(healthCheckTimer)
  }
  healthCheckTimer = null
  healthProbeInFlight = null
  isHealthy = true
  lastDegradedError = null
  currentBackoffMs = 5000
  listeners.clear()
}
