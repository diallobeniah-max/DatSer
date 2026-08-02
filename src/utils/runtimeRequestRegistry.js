const requestRegistry = new Map()

const makeKey = (scopeKey, requestType) => `${scopeKey}:${requestType}`

export const runScopedRequest = (
  scopeKey,
  requestType,
  loader,
  { force = false, cacheResult = true } = {}
) => {
  const key = makeKey(scopeKey, requestType)
  const existing = requestRegistry.get(key)

  if (!force && existing?.hasValue) return Promise.resolve(existing.value)
  if (existing?.promise) return existing.promise

  const entry = existing || { hasValue: false, value: undefined, promise: null }
  const promise = Promise.resolve()
    .then(loader)
    .then((value) => {
      if (cacheResult) {
        entry.value = value
        entry.hasValue = true
      }
      entry.promise = null
      requestRegistry.set(key, entry)
      return value
    })
    .catch((error) => {
      // A failed request is retryable. Preserve the last confirmed value, if any.
      entry.promise = null
      if (entry.hasValue) requestRegistry.set(key, entry)
      else requestRegistry.delete(key)
      throw error
    })

  entry.promise = promise
  requestRegistry.set(key, entry)
  return promise
}

export const invalidateRequestScope = (scopeKey, requestType = '') => {
  const prefix = requestType ? makeKey(scopeKey, requestType) : `${scopeKey}:`
  for (const key of requestRegistry.keys()) {
    if (key === prefix || key.startsWith(prefix)) requestRegistry.delete(key)
  }
}

export const peekScopedRequest = (scopeKey, requestType) => {
  const entry = requestRegistry.get(makeKey(scopeKey, requestType))
  return entry?.hasValue ? entry.value : undefined
}
