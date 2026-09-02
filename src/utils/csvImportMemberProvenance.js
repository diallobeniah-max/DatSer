export const CSV_IMPORT_PROVENANCE_STORAGE_PREFIX = 'datser:csv-import:recent-members:'
const MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000

const safeStorage = (storage) => storage || (typeof window !== 'undefined' ? window.localStorage : null)
const storageKey = (ownerId) => `${CSV_IMPORT_PROVENANCE_STORAGE_PREFIX}${String(ownerId || '')}`

export const deriveCsvImportMemberProvenance = (rows = [], sessionId = null) => (
  rows.reduce((provenance, row) => {
    const bulkCreate = row?.bulkCreate
    if (!bulkCreate?.memberId) return provenance
    provenance[String(bulkCreate.memberId)] = {
      memberId: String(bulkCreate.memberId),
      sessionId: bulkCreate.sourceImportId || sessionId || null,
      sourceSheet: bulkCreate.sourceSheet || row.sheet || null,
      sourceRow: bulkCreate.sourceRow || row.rowNumber || null,
      createdAt: bulkCreate.createdAt || null,
    }
    return provenance
  }, {})
)

export const rememberCsvImportMemberProvenance = ({ ownerId, sessionId, rows, storage } = {}) => {
  const resolvedStorage = safeStorage(storage)
  const members = deriveCsvImportMemberProvenance(rows, sessionId)
  if (!resolvedStorage || !ownerId) return members
  try {
    const existing = getRecentCsvImportMemberProvenance({ ownerId, storage: resolvedStorage })
    const merged = { ...existing, ...members }
    resolvedStorage.setItem(storageKey(ownerId), JSON.stringify({ ownerId: String(ownerId), sessionId: sessionId || null, savedAt: Date.now(), members: merged }))
    if (typeof window !== 'undefined') window.dispatchEvent(new Event('datser:csv-import-provenance'))
  } catch (_error) {
    // A local badge cache must never interrupt the durable CSV history flow.
  }
  return members
}

export const getRecentCsvImportMemberProvenance = ({ ownerId, storage, now = Date.now() } = {}) => {
  const resolvedStorage = safeStorage(storage)
  if (!resolvedStorage || !ownerId) return {}
  try {
    const raw = resolvedStorage.getItem(storageKey(ownerId))
    const parsed = raw ? JSON.parse(raw) : null
    if (!parsed || parsed.ownerId !== String(ownerId) || !parsed.savedAt || now - parsed.savedAt > MAX_AGE_MS) return {}
    return parsed.members && typeof parsed.members === 'object' ? parsed.members : {}
  } catch (_error) {
    return {}
  }
}

export const getCsvImportMemberProvenance = (provenanceByMemberId, memberId) => (
  provenanceByMemberId?.[String(memberId)] || null
)

export const fetchRecentCsvImportMemberProvenance = async ({ supabase, ownerId, storage } = {}) => {
  if (!supabase || !ownerId) return {}
  try {
    const { data: sessions, error } = await supabase
      .from('csv_import_sessions')
      .select('id, import_rows, updated_at')
      .eq('owner_id', ownerId)
      .order('updated_at', { ascending: false })
      .limit(10)
    if (error || !Array.isArray(sessions)) return {}

    const allMembers = {}
    sessions.forEach((session) => {
      const rows = Array.isArray(session.import_rows) ? session.import_rows : []
      const derived = deriveCsvImportMemberProvenance(rows, session.id)
      Object.assign(allMembers, derived)
    })

    if (Object.keys(allMembers).length > 0) {
      const resolvedStorage = safeStorage(storage)
      if (resolvedStorage) {
        const existing = getRecentCsvImportMemberProvenance({ ownerId, storage: resolvedStorage })
        const merged = { ...allMembers, ...existing }
        resolvedStorage.setItem(storageKey(ownerId), JSON.stringify({ ownerId: String(ownerId), sessionId: null, savedAt: Date.now(), members: merged }))
        if (typeof window !== 'undefined') window.dispatchEvent(new Event('datser:csv-import-provenance'))
        return merged
      }
    }
    return allMembers
  } catch (_err) {
    return {}
  }
}
