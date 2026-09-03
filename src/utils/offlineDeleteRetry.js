const NO_ROWS_MESSAGE = /trusted soft delete affected\s+0\s+rows/i

export const isTrustedSoftDeleteNoRowsError = (error) => (
  NO_ROWS_MESSAGE.test(String(error?.message || error || ''))
)

// A queued delete can have completed on the server even when the client lost
// the RPC response. Only the specific trusted-RPC zero-row result is eligible
// for this follow-up read; ordinary write, auth, and network failures remain
// queued for the existing retry policy.
export const syncQueuedMemberDelete = async ({ performDelete, readMember }) => {
  try {
    const { data, error } = await performDelete()
    if (error) throw error
    if (!data) throw new Error('Soft delete could not be verified by server')
    return { action: 'remove', confirmedBy: 'rpc' }
  } catch (error) {
    if (!isTrustedSoftDeleteNoRowsError(error)) throw error

    const { data: rows, error: readError } = await readMember()
    if (readError) throw readError

    const serverRow = Array.isArray(rows) ? rows[0] : rows
    if (serverRow?.deleted_at) {
      return {
        action: 'remove',
        confirmedBy: 'read',
        deletedAt: serverRow.deleted_at
      }
    }

    return {
      action: 'fail',
      error: serverRow
        ? 'Member is still active on the server. The offline delete is kept for recovery.'
        : 'Member could not be verified on the server. The offline delete is kept for recovery.'
    }
  }
}
