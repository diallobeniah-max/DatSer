const CACHE_PREFIX = 'datser_workspace_member_code_assignments_v1'

const toTimestamp = (value) => {
  const timestamp = Date.parse(value || '')
  return Number.isFinite(timestamp) ? timestamp : 0
}

export const getWorkspaceMemberCodeAssignmentsCacheKey = (ownerId) => (
  `${CACHE_PREFIX}:${ownerId || 'local'}`
)

export const toWorkspaceMemberCodeMap = (rows = []) => rows.reduce((map, row) => {
  if (!row?.member_id || !row?.current_code) return map
  map[String(row.member_id)] = {
    current_code: String(row.current_code),
    aliases: Array.isArray(row.aliases) ? row.aliases : [],
    ordinal: row.ordinal,
    updated_at: row.updated_at || null
  }
  return map
}, {})

// Assignment rows are workspace-level metadata. A newer confirmed response may
// replace the snapshot, while an older cache/realtime response must not undo it.
export const mergeWorkspaceMemberCodeAssignments = (current = {}, incoming = {}) => {
  const next = { ...current }
  Object.entries(incoming || {}).forEach(([memberId, assignment]) => {
    const previous = current?.[memberId]
    if (!previous || toTimestamp(assignment?.updated_at) >= toTimestamp(previous?.updated_at)) {
      next[memberId] = { ...assignment }
    }
  })
  return next
}

export const readWorkspaceMemberCodeAssignmentsCache = (ownerId) => {
  if (typeof window === 'undefined' || !ownerId) return null
  try {
    const cached = JSON.parse(window.localStorage.getItem(getWorkspaceMemberCodeAssignmentsCacheKey(ownerId)) || 'null')
    if (!cached || typeof cached !== 'object' || !cached.assignments) return null
    return {
      assignments: toWorkspaceMemberCodeMap(Object.entries(cached.assignments).map(([member_id, value]) => ({ member_id, ...value }))),
      updatedAt: cached.updatedAt || null
    }
  } catch {
    return null
  }
}

export const writeWorkspaceMemberCodeAssignmentsCache = (ownerId, assignments = {}) => {
  if (typeof window === 'undefined' || !ownerId) return
  try {
    window.localStorage.setItem(getWorkspaceMemberCodeAssignmentsCacheKey(ownerId), JSON.stringify({
      assignments,
      updatedAt: new Date().toISOString()
    }))
  } catch {
    // Cache is an optional startup hint. The confirmed server snapshot wins.
  }
}
