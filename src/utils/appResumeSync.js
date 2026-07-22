export const createResumeSyncCoordinator = ({
  refresh,
  now = () => Date.now(),
  cooldownMs = 1500
}) => {
  let inFlight = null
  let lastStartedAt = 0
  let disposed = false

  const trigger = (source = 'resume', { force = false } = {}) => {
    if (disposed) return Promise.resolve({ skipped: 'disposed' })
    if (inFlight) return inFlight
    const startedAt = now()
    if (!force && lastStartedAt && startedAt - lastStartedAt < cooldownMs) {
      return Promise.resolve({ skipped: 'cooldown' })
    }
    lastStartedAt = startedAt
    inFlight = Promise.resolve(refresh(source))
      .finally(() => {
        inFlight = null
      })
    return inFlight
  }

  return {
    trigger,
    dispose: () => { disposed = true },
    isRunning: () => Boolean(inFlight)
  }
}
