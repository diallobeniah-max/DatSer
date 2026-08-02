const channels = new Map()

const createEntry = ({ client, scopeKey, channelName, bindings }) => {
  const listeners = new Map()
  const statusListeners = new Set()
  let channel = client.channel(channelName)

  bindings.forEach(({ key, event = '*', schema = 'public', table, filter }) => {
    listeners.set(key, new Set())
    channel = channel.on(
      'postgres_changes',
      { event, schema, table, ...(filter ? { filter } : {}) },
      (payload) => {
        listeners.get(key)?.forEach((listener) => listener(payload))
      }
    )
  })

  channel.subscribe((status) => {
    statusListeners.forEach((listener) => listener(status))
  })

  const entry = {
    client,
    scopeKey,
    channel,
    listeners,
    statusListeners,
    releaseToken: 0
  }
  channels.set(scopeKey, entry)
  return entry
}

export const acquireRealtimeChannel = ({
  client,
  scopeKey,
  channelName,
  bindings,
  handlers,
  onStatus
}) => {
  const entry = channels.get(scopeKey) || createEntry({ client, scopeKey, channelName, bindings })
  entry.releaseToken += 1
  const token = entry.releaseToken

  Object.entries(handlers || {}).forEach(([key, handler]) => {
    if (typeof handler === 'function') entry.listeners.get(key)?.add(handler)
  })
  if (typeof onStatus === 'function') entry.statusListeners.add(onStatus)

  return () => {
    Object.entries(handlers || {}).forEach(([key, handler]) => {
      entry.listeners.get(key)?.delete(handler)
    })
    if (typeof onStatus === 'function') entry.statusListeners.delete(onStatus)

    // React StrictMode releases and reacquires in the same turn. Deferring
    // disposal keeps one physical subscription while still cleaning real scope exits.
    queueMicrotask(() => {
      const current = channels.get(scopeKey)
      if (current !== entry || current.releaseToken !== token) return
      const hasListeners = [...current.listeners.values()].some((set) => set.size > 0)
      if (hasListeners || current.statusListeners.size > 0) return
      current.client.removeChannel(current.channel)
      channels.delete(scopeKey)
    })
  }
}

export const invalidateRealtimeScope = (scopeKey) => {
  const entry = channels.get(scopeKey)
  if (!entry) return
  entry.client.removeChannel(entry.channel)
  channels.delete(scopeKey)
}
