const keyFor = (tableName, serviceDate) => `${tableName || 'default'}::${serviceDate || ''}`

// Keeps refresh responses from replacing a choice made after that refresh began.
// The registry is intentionally local to a running app instance; Supabase remains
// the durable source and Realtime schedules the next confirmed read.
export const createAttendanceSnapshotVersionRegistry = () => {
  const versions = new Map()
  const localVersions = new Map()

  const get = (tableName, serviceDate) => versions.get(keyFor(tableName, serviceDate)) || 0
  const bump = (tableName, serviceDate) => {
    const next = get(tableName, serviceDate) + 1
    versions.set(keyFor(tableName, serviceDate), next)
    return next
  }

  return {
    // A read takes a version of its own. This makes older overlapping reads
    // harmless even when there was no local change between them.
    captureVersion: get,
    captureLocalVersion: (tableName, date) => localVersions.get(keyFor(tableName, date)) || 0,
    canApplyLocalVersion: (tableName, date, version) => (localVersions.get(keyFor(tableName, date)) || 0) === version,
    startRead: bump,
    markLocalChange: (tableName, date) => {
      const key = keyFor(tableName, date)
      localVersions.set(key, (localVersions.get(key) || 0) + 1)
      return bump(tableName, date)
    },
    canApplyRead: (tableName, serviceDate, version) => get(tableName, serviceDate) === version
  }
}
