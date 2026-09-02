// Serializes durable attendance writes for one member and one Sunday.
//
// UI state remains optimistic and immediate; this queue only guarantees that
// the server receives rapid choices in tap order. A slow earlier response
// therefore cannot overwrite a later Present/Absent/Clear choice.
export const createAttendanceWriteQueue = () => {
  const tails = new Map()
  const latestVersions = new Map()

  const enqueue = (key, operation) => {
    const version = (latestVersions.get(key) || 0) + 1
    latestVersions.set(key, version)

    const previous = tails.get(key) || Promise.resolve()
    const run = previous
      .catch(() => undefined)
      .then(() => operation({
        version,
        isLatest: () => latestVersions.get(key) === version
      }))

    // Keep the chain alive after a failed write so a later tap can still save.
    const tail = run.catch(() => undefined)
    tails.set(key, tail)
    tail.finally(() => {
      if (tails.get(key) === tail) tails.delete(key)
    })

    return {
      version,
      isLatest: () => latestVersions.get(key) === version,
      promise: run
    }
  }

  return { enqueue }
}
