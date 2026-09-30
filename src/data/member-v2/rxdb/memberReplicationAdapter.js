// The adapter deliberately treats Realtime as a wake-up only.  All data comes
// through the authenticated cursor RPC so a channel never becomes a data API.
export const startMemberV2Replication = async (service) => {
  await service.start()
  return { syncNow: (options) => service.syncNow(options), cancel: () => service.stop() }
}
