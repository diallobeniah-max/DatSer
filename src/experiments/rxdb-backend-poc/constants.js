export const SAVE_STATES = Object.freeze({
  LOCAL_PENDING: 'LOCAL_PENDING',
  SERVER_CONFIRMED: 'SERVER_CONFIRMED',
  CONFLICT: 'CONFLICT',
  FAILED_RETRYABLE: 'FAILED_RETRYABLE'
})

export const POC_ENTITIES = Object.freeze({
  MEMBERS: 'members',
  ATTENDANCE: 'attendance'
})

export const createRequestId = (operation, entityId) => {
  const suffix = globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(16).slice(2)}`
  return `rxdb-poc:${operation}:${entityId}:${suffix}`
}

export const createUuid = () => {
  if (!globalThis.crypto?.randomUUID) {
    throw new Error('This POC requires crypto.randomUUID().')
  }
  return globalThis.crypto.randomUUID()
}
