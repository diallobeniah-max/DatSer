// Read-only loader for Member Data Review. Fetches every month table once
// (bounded concurrency) through a caller-supplied, read-only fetch callback.
// This module performs no writes and no direct database access.

export const REVIEW_TABLE_SELECT = [
  'id',
  '"Full Name"',
  '"Phone Number"',
  '"Gender"',
  '"Age"',
  '"Current Level"',
  'is_visitor',
  'parent_name_1',
  'parent_phone_1',
  'parent_name_2',
  'parent_phone_2',
  'notes',
  'ministry',
  'date_of_birth',
  'inserted_at',
  'updated_at',
  'deleted_at',
  'user_id'
].join(',')

// Load every month table's rows once. fetchTableRows(tableName) must be
// read-only. Returns a Map<tableName, rows[]>; per-table transient failures
// degrade to []. Fail-closed conditions (invalid owner, owner-filtered query
// failure) propagate so the caller surfaces the error instead of silently
// reading a wider scope.
export const loadAllMonthReviewRows = async ({
  tables = [],
  fetchTableRows,
  concurrency = 3
} = {}) => {
  const safeTables = (Array.isArray(tables) ? tables : []).filter((table) => typeof table === 'string' && table.length > 0)
  if (safeTables.length === 0) return new Map()

  const results = new Map()
  let index = 0
  const limit = Math.max(1, Math.min(concurrency, safeTables.length))

  const worker = async () => {
    while (index < safeTables.length) {
      const current = index
      index += 1
      const table = safeTables[current]
      try {
        const rows = await fetchTableRows(table)
        results.set(table, Array.isArray(rows) ? rows : [])
      } catch (err) {
        if (err?.reviewFailClosed) throw err
        results.set(table, [])
      }
    }
  }

  await Promise.all(Array.from({ length: limit }, () => worker()))
  return results
}

const isValidOwnerUuid = (ownerId) => (
  typeof ownerId === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(ownerId)
)

// Build the read-only per-table fetch used by the review pipeline.
// Only `.from(table).select(...).eq('user_id', ownerId).is('deleted_at', null)`
// is ever called — never an unscoped read. Fail-closed: a non-UUID owner or a
// failing owner-filtered query throws (marked reviewFailClosed) instead of
// silently widening the read scope. Canonical codes are derived from
// workspace_member_codes / codeAssignments during normalization.
export const createReviewTableFetcher = ({ supabase, ownerId, isConfigured }) => async (table) => {
  if (!isConfigured || !table) return []

  if (!isValidOwnerUuid(ownerId)) {
    const error = new Error('Member data review requires a valid workspace owner UUID')
    error.reviewFailClosed = true
    throw error
  }

  const response = await supabase
    .from(table)
    .select(REVIEW_TABLE_SELECT)
    .eq('user_id', ownerId)
    .is('deleted_at', null)

  if (response?.error) {
    const error = new Error(`Month table read failed: ${response.error.message || 'unknown error'}`)
    error.reviewFailClosed = true
    throw error
  }

  return (response.data || []).filter((row) => !row.deleted_at)
}
