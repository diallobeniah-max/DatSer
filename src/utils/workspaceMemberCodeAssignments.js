const CACHE_PREFIX = 'datser_workspace_member_code_assignments_v1'

const toTimestamp = (value) => {
  const timestamp = Date.parse(value || '')
  return Number.isFinite(timestamp) ? timestamp : 0
}

// Supabase range responses are capped. Larger workspaces must load every
// assignment page before a remote snapshot is reconciled with visible badges.
export const readAllWorkspaceMemberCodeAssignmentPages = async ({ fetchPage, pageSize = 500 }) => {
  const assignmentsByMemberId = new Map()
  let from = 0

  while (true) {
    const page = await fetchPage(from, pageSize)
    const rows = Array.isArray(page) ? page : []
    rows.forEach((row) => {
      if (!row?.member_id) return
      const memberId = String(row.member_id)
      const existing = assignmentsByMemberId.get(memberId)
      if (!existing || toTimestamp(row.updated_at) >= toTimestamp(existing.updated_at)) {
        assignmentsByMemberId.set(memberId, row)
      }
    })
    if (rows.length < pageSize) break
    from += pageSize
  }

  return Array.from(assignmentsByMemberId.values()).sort((left, right) => (
    Number(left.ordinal || 0) - Number(right.ordinal || 0) || String(left.member_id).localeCompare(String(right.member_id))
  ))
}

export const getWorkspaceMemberCodeAssignmentsCacheKey = (ownerId) => (
  `${CACHE_PREFIX}:${ownerId || 'local'}`
)

export const toWorkspaceMemberCodeMap = (rows = []) => rows.reduce((map, row) => {
  if (!row?.member_id || !row?.current_code) return map
  const memberId = String(row.member_id)
  const nextAssignment = {
    current_code: String(row.current_code),
    aliases: Array.isArray(row.aliases) ? row.aliases : [],
    ordinal: row.ordinal,
    updated_at: row.updated_at || null
  }
  // Pagination, realtime, and cache hydration can overlap. Keep the newest
  // confirmed assignment for a canonical member instead of letting an older
  // page erase a newly allocated code.
  if (!map[memberId] || toTimestamp(nextAssignment.updated_at) >= toTimestamp(map[memberId].updated_at)) {
    map[memberId] = nextAssignment
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
