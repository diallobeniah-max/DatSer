export const getCsvImportNote = (row) => String(row?.edited?.notes ?? row?.raw?.notes ?? '').trim()

export const hasCsvImportAttentionNote = (row) => getCsvImportNote(row).length > 0

export const isCsvImportAttentionUnresolved = (row) => (
  hasCsvImportAttentionNote(row) && row?.attentionVerified !== true
)

export const isCsvImportRowCompleted = (row) => (
  row?.saveStatus === 'saved' || row?.saveStatus === 'skipped'
)

export const hasCsvImportResolvedMember = (row) => Boolean(
  row?.match?.selectedMemberId || row?.match?.matchedMember?.id || row?.match?.matchedMember
)

// A projection of the existing canonical row, not a second status engine.
// Batch review can therefore stay in sync with persisted matching and saves.
export const getCsvImportRowIssue = (row) => {
  if (!row || isCsvImportRowCompleted(row)) return null
  if (row.saveStatus === 'failed') return { kind: 'failed', label: 'Failed' }
  if (isCsvImportAttentionUnresolved(row)) return { kind: 'attention', label: 'Needs Attention' }
  if (row.duplicateOfRowId) return { kind: 'duplicate', label: 'Duplicate / conflict' }
  if (row.match?.status === 'invalid') return { kind: 'invalid', label: 'Invalid' }
  if (row.match?.status === 'possible' && !hasCsvImportResolvedMember(row)) return { kind: 'possible', label: 'Possible Match' }
  if (row.saveStatus === 'unresolved' || row.match?.status === 'unmatched') return { kind: 'unmatched', label: 'Unmatched' }
  // New members require an explicit operator action. Older sessions without
  // the optional marker remain available for review instead of being reset.
  if (row.match?.status === 'new' && !row.newMemberConfirmed && !row.allowNamesOnlyCreate) return { kind: 'unmatched', label: 'Confirm new member' }
  return null
}

export const isCsvImportRowReady = (row) => {
  if (!row || isCsvImportRowCompleted(row) || getCsvImportRowIssue(row)) return false
  const matchStatus = row.match?.status
  return matchStatus === 'exact'
    || (matchStatus === 'possible' && hasCsvImportResolvedMember(row))
    || (matchStatus === 'new' && (row.newMemberConfirmed || row.allowNamesOnlyCreate))
}

export const isCsvImportRowSafeForBatch = (row) => {
  if (!row || isCsvImportRowCompleted(row)) return false
  if (isCsvImportAttentionUnresolved(row)) return false
  if (row.duplicateOfRowId || row.identityConflict) return false
  if (row.match?.status === 'invalid') return false
  const matchStatus = row.match?.status
  if (matchStatus === 'exact' || (matchStatus === 'possible' && hasCsvImportResolvedMember(row))) return true
  if (matchStatus === 'new') {
    return Boolean(String(row.edited?.fullName || row.raw?.fullName || row.fullName || '').trim())
  }
  return false
}

export const isCsvImportRowProcessableForRemaining = (row) => {
  if (!row || isCsvImportRowCompleted(row)) return false
  if (row.duplicateOfRowId || row.identityConflict) return false
  const usableName = String(row.edited?.fullName || row.raw?.fullName || row.fullName || '').trim()
  if (!usableName) return false
  return true
}

export const getCsvImportUnresolvedAttentionCount = (rows = []) => (
  rows.reduce((count, row) => count + (isCsvImportAttentionUnresolved(row) ? 1 : 0), 0)
)

export const markCsvImportAttentionVerified = (rows = [], rowId) => rows.map((row) => (
  row?.importRowId === rowId && hasCsvImportAttentionNote(row)
    ? { ...row, attentionVerified: true }
    : row
))

export const getCsvImportReviewStatusCounts = (rows = []) => {
  const counts = {
    all: rows.length,
    exact: 0,
    possible: 0,
    new: 0,
    invalid: 0,
    saved: 0,
    skipped: 0,
    failed: 0,
    unmatched: 0,
    ready: 0,
    unresolved: 0,
    attention: 0,
  }

  rows.forEach((row) => {
    const matchStatus = row?.match?.status
    if (Object.prototype.hasOwnProperty.call(counts, matchStatus)) counts[matchStatus] += 1
    const saveStatus = row?.saveStatus
    if (isCsvImportAttentionUnresolved(row)) counts.attention += 1
    if (saveStatus === 'saved' || saveStatus === 'skipped' || saveStatus === 'failed') {
      counts[saveStatus] += 1
    }
    const resolved = Boolean(row?.match?.selectedMemberId || row?.match?.matchedMember)
    if (!isCsvImportAttentionUnresolved(row) && !row?.duplicateOfRowId && saveStatus === 'pending' && (matchStatus === 'exact' || (matchStatus === 'possible' && resolved) || (matchStatus === 'new' && (row?.newMemberConfirmed || row?.allowNamesOnlyCreate)))) counts.ready += 1
    if (saveStatus === 'unresolved' || matchStatus === 'unmatched' || (matchStatus === 'possible' && !resolved)) counts.unresolved += 1
  })

  return counts
}

export const filterCsvImportReviewRows = (rows = [], filter = 'all') => {
  if (filter === 'all') return rows
  if (filter === 'attention') return rows.filter(isCsvImportAttentionUnresolved)
  if (filter === 'saved' || filter === 'skipped' || filter === 'failed') {
    return rows.filter((row) => row?.saveStatus === filter)
  }
  if (filter === 'ready') return rows.filter(isCsvImportRowReady)
  if (filter === 'unresolved') return rows.filter((row) => ['possible', 'unmatched'].includes(getCsvImportRowIssue(row)?.kind))
  return rows.filter((row) => row?.match?.status === filter)
}

export const searchCsvImportReviewRows = (rows = [], searchQuery = '') => {
  const query = String(searchQuery || '').toLowerCase().trim()
  if (!query) return rows
  return rows.filter((row) => [
    row?.edited?.fullName,
    row?.edited?.phoneNumber,
    row?.edited?.memberCode,
    row?.sheet,
    row?.match?.matchedMember?.['Full Name'],
    row?.match?.matchedMember?.member_code,
    row?.match?.matchedMember?.memberCode,
    getCsvImportNote(row),
    row?.rowNumber,
  ].some((value) => String(value ?? '').toLowerCase().includes(query)))
}
