export const PAPER_SCAN_GEMINI_MODEL = 'gemini-3.1-flash-lite'

export const FILE_STORAGE_QUOTA_BYTES = 1024 * 1024 * 1024 // 1 GB Free plan object/file storage

const numeric = (value) => Math.max(0, Number(value) || 0)

const validTimestamp = (value) => {
  const time = Date.parse(value || '')
  return Number.isFinite(time) ? time : null
}

export const formatBytes = (value) => {
  const bytes = Math.max(0, Number(value) || 0)
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`
}

export const formatMegabytes = (value) => `${Number(value || 0).toFixed(2)} MB`

const todayKey = () => new Date().toDateString()

// Saved scans are the only client-readable record of Gemini usageMetadata.
// Do not derive calls, failures, or provider quota from a local estimate.
export const summarizeSavedScanUsage = (scans) => {
  const entries = []
  let promptTokens = 0
  let candidateTokens = 0
  let lastSuccessfulAt = null
  let todayCalls = 0
  let todayPrompt = 0
  let todayCandidates = 0

  for (const scan of Array.isArray(scans) ? scans : []) {
    const usage = scan?.usage_metadata
    if (!usage || typeof usage !== 'object') continue

    for (const [sheetId, metadata] of Object.entries(usage)) {
      if (sheetId === '_total' || !metadata || typeof metadata !== 'object') continue
      const prompt = numeric(metadata.promptTokenCount)
      const candidates = numeric(metadata.candidatesTokenCount)
      promptTokens += prompt
      candidateTokens += candidates
      const extractedAt = scan?.extraction?.[sheetId]?.extractedAt
      const timestamp = validTimestamp(extractedAt)
      if (timestamp && (!lastSuccessfulAt || timestamp > lastSuccessfulAt)) lastSuccessfulAt = timestamp
      if (timestamp && new Date(timestamp).toDateString() === todayKey()) {
        todayCalls += 1
        todayPrompt += prompt
        todayCandidates += candidates
      }
      entries.push({ scanId: scan.id, scanName: scan.name || 'Saved scan', sheetId, promptTokens: prompt, candidateTokens: candidates, extractedAt: timestamp ? new Date(timestamp).toISOString() : null })
    }
  }

  return {
    successfulCalls: entries.length,
    promptTokens,
    candidateTokens,
    totalTokens: promptTokens + candidateTokens,
    lastSuccessfulAt: lastSuccessfulAt ? new Date(lastSuccessfulAt).toISOString() : null,
    recent: entries.slice(0, 5),
    today: { calls: todayCalls, promptTokens: todayPrompt, candidateTokens: todayCandidates, totalTokens: todayPrompt + todayCandidates }
  }
}

export const summarizeOfflineSyncHealth = ({ isOnline, offlineModeStatus, offlineCacheMeta, offlinePendingChanges }) => {
  const pending = Array.isArray(offlinePendingChanges) ? offlinePendingChanges : []
  const failed = pending.filter((change) => ['failed', 'conflict'].includes(change?.sync_status)).length
  const waiting = pending.filter((change) => !['failed', 'conflict'].includes(change?.sync_status)).length
  const lastSync = offlineCacheMeta?.lastSyncAt || offlineCacheMeta?.lastSyncedAt || null
  const healthy = Boolean(isOnline) && offlineModeStatus !== 'online-unavailable' && failed === 0
  return { healthy, pending: waiting, failed, lastSync }
}
