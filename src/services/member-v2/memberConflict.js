export const MEMBER_CONFLICT_OPERATIONS = Object.freeze({
  KEEP_LOCAL: 'KEEP_LOCAL',
  USE_SERVER: 'USE_SERVER',
  MERGED: 'MERGED',
})

export const parseConflictRemote = (value) => {
  if (!value) return null
  if (typeof value === 'object') return value
  try { return JSON.parse(value) } catch { return null }
}

export const assertConflictOperation = (operation) => {
  if (!Object.values(MEMBER_CONFLICT_OPERATIONS).includes(operation)) {
    throw new Error('Choose KEEP_LOCAL, USE_SERVER, or MERGED.')
  }
  return operation
}
