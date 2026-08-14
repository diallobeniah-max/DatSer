const safePhoneHint = (value) => {
  const digits = String(value || '').replace(/\D/g, '')
  return digits.length >= 4 ? `***${digits.slice(-4)}` : ''
}

export const groupHistoricProvenanceReview = (rows = []) => {
  const byMember = new Map()
  for (const row of rows) {
    if (!row?.member_id) continue
    const current = byMember.get(row.member_id) || {
      memberId: row.member_id,
      displayName: row.display_name || 'Unnamed member',
      phoneHint: safePhoneHint(row.phone_hint),
      memberCode: row.member_code || null,
      gender: row.gender || null,
      currentLevel: row.current_level || null,
      reason: row.reason,
      candidateWorkspaceIds: row.candidate_workspace_ids || [],
      months: []
    }
    if (!current.months.includes(row.source_month)) current.months.push(row.source_month)
    byMember.set(row.member_id, current)
  }
  return [...byMember.values()]
    .map((entry) => ({ ...entry, months: entry.months.sort(), rowInstances: entry.months.length }))
    .sort((a, b) => a.reason.localeCompare(b.reason) || a.displayName.localeCompare(b.displayName))
}
