export const getCsvImportNote = (row) => String(row?.edited?.notes ?? row?.raw?.notes ?? '').trim()

export const hasCsvImportAttentionNote = (row) => getCsvImportNote(row).length > 0

export const isCsvImportAttentionUnresolved = (row) => (
  hasCsvImportAttentionNote(row) && row?.attentionVerified !== true
)

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
    if (!isCsvImportAttentionUnresolved(row) && !row?.duplicateOfRowId && saveStatus === 'pending' && (matchStatus === 'exact' || (matchStatus === 'possible' && resolved) || (matchStatus === 'new' && row?.allowNamesOnlyCreate))) counts.ready += 1
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
  if (filter === 'ready') return rows.filter((row) => !isCsvImportAttentionUnresolved(row) && !row?.duplicateOfRowId && row?.saveStatus === 'pending' && (row?.match?.status === 'exact' || (row?.match?.status === 'possible' && (row?.match?.selectedMemberId || row?.match?.matchedMember)) || (row?.match?.status === 'new' && row?.allowNamesOnlyCreate)))
  if (filter === 'unresolved') return rows.filter((row) => row?.saveStatus === 'unresolved' || row?.match?.status === 'unmatched' || (row?.match?.status === 'possible' && !(row?.match?.selectedMemberId || row?.match?.matchedMember)))
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
