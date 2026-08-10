// Single-flight scheduler for the offline flush. Multiple triggers (auto-sync
// effect, focus/online/pageshow resume) can request a flush at once, but only
// one timer and one running flush may exist at a time. This prevents
// overlapping duplicate flushes of the same pending queue.
export const createSyncFlushScheduler = ({
  run,
  now = () => Date.now(),
  minDelayMs = 1200,
  maxDelayMs = 15 * 60 * 1000
}) => {
  let timer = null
  let inFlight = null
  let disposed = false

  const startFlush = () => {
    inFlight = Promise.resolve(run())
      .catch(() => {})
      .finally(() => {
        inFlight = null
      })
  }

  const schedule = (delayMs) => {
    if (disposed) return { scheduled: false, reason: 'disposed' }
    if (timer) return { scheduled: false, reason: 'already-scheduled' }
    if (inFlight) return { scheduled: false, reason: 'in-flight' }
    const delay = Math.min(Math.max(delayMs ?? minDelayMs, minDelayMs), maxDelayMs)
    timer = setTimeout(() => {
      timer = null
      startFlush()
    }, delay)
    return { scheduled: true, delay }
  }

  return {
    schedule,
    cancel: () => {
      if (timer) {
        clearTimeout(timer)
        timer = null
      }
    },
    isPending: () => Boolean(timer || inFlight),
    dispose: () => {
      disposed = true
      if (timer) {
        clearTimeout(timer)
        timer = null
      }
    }
  }
}
