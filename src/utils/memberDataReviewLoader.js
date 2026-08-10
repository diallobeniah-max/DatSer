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
// read-only. Returns a Map<tableName, rows[]>; per-table failures degrade to [].
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
        results.set(table, [])
      }
    }
  }

  await Promise.all(Array.from({ length: limit }, () => worker()))
  return results
}

// Build the read-only per-table fetch used by the review pipeline.
// Only `.from(table).select(...)` is ever called — no insert/update/delete/rpc.
export const createReviewTableFetcher = ({ supabase, ownerId, isConfigured }) => async (table) => {
  if (!isConfigured || !table) return []

  // PostgREST requires a real uuid for the user_id filter. A non-uuid owner
  // (e.g. the developer bypass user) skips the filtered query to avoid a
  // guaranteed 400 and uses the safe fallback read instead.
  const isUuidOwner = typeof ownerId === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(ownerId)

  if (isUuidOwner) {
    const response = await supabase
      .from(table)
      .select(REVIEW_TABLE_SELECT)
      .eq('user_id', ownerId)
      .is('deleted_at', null)

    if (!response?.error) {
      return (response.data || []).filter((row) => !row.deleted_at)
    }
  }

  // Fallback for schema variance (missing user_id/deleted_at) or a non-uuid
  // owner: read the same safe column set and filter soft-deleted rows
  // client-side. `member_code` is intentionally excluded from the select —
  // live month tables do not have that column, and the canonical member code
  // is derived from workspace_member_codes / codeAssignments during
  // normalization.
  const fallback = await supabase.from(table).select(REVIEW_TABLE_SELECT)
  if (fallback?.error) return []
  return (fallback.data || []).filter((row) => !row.deleted_at)
}
