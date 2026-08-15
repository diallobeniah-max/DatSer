const isDev = typeof import.meta !== 'undefined' && Boolean(import.meta.env?.DEV)

const logSyncDiagnostic = (source, status, extra = '') => {
  if (!isDev) return
  const timestamp = new Date().toISOString()
  const detail = extra ? ` (${extra})` : ''
  console.log(`[SyncDiagnostics] ${source} | status: ${status}${detail} | time: ${timestamp}`)
}

export const createResumeSyncCoordinator = ({
  refresh,
  now = () => Date.now(),
  cooldownMs = 15000,
  getVisibilityState = () => (typeof document !== 'undefined' ? document.visibilityState : 'visible')
}) => {
  let inFlight = null
  let lastStartedAt = 0
  let pendingVisibleRefresh = false
  let disposed = false

  const trigger = (source = 'resume', { force = false } = {}) => {
    if (disposed) {
      logSyncDiagnostic(source, 'SKIPPED (DISPOSED)')
      return Promise.resolve({ skipped: 'disposed' })
    }

    const visibility = getVisibilityState()
    if (visibility === 'hidden') {
      pendingVisibleRefresh = true
      logSyncDiagnostic(source, 'SKIPPED (HIDDEN)', 'marked pending visible refresh')
      return Promise.resolve({ skipped: 'hidden' })
    }

    if (inFlight) {
      logSyncDiagnostic(source, 'DEDUPED', 'in-flight sync reused')
      return inFlight
    }

    const startedAt = now()
    const shouldBypassCooldown = force || pendingVisibleRefresh

    if (!shouldBypassCooldown && lastStartedAt && startedAt - lastStartedAt < cooldownMs) {
      const remainingMs = cooldownMs - (startedAt - lastStartedAt)
      logSyncDiagnostic(source, 'SKIPPED BY COOLDOWN', `${remainingMs}ms remaining`)
      return Promise.resolve({ skipped: 'cooldown' })
    }

    pendingVisibleRefresh = false
    lastStartedAt = startedAt
    logSyncDiagnostic(source, force ? 'FORCED' : shouldBypassCooldown ? 'PENDING_RESOLVED' : 'STARTED')

    inFlight = Promise.resolve(refresh(source))
      .finally(() => {
        inFlight = null
      })
    return inFlight
  }

  return {
    trigger,
    dispose: () => { disposed = true },
    isRunning: () => Boolean(inFlight),
    getLastStartedAt: () => lastStartedAt,
    setLastStartedAt: (val) => { lastStartedAt = val },
    hasPendingVisibleRefresh: () => pendingVisibleRefresh,
    setPendingVisibleRefresh: (val) => { pendingVisibleRefresh = Boolean(val) }
  }
}
