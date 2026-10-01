const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

export const assertMemberTarget = ({ ownerId, tableName, memberId }) => {
  if (!UUID.test(String(ownerId || ''))) throw new Error('Member V2 requires a workspace owner UUID.')
  if (!UUID.test(String(memberId || ''))) throw new Error('Member V2 requires a member UUID.')
  if (!/^[A-Z][a-z]+_[0-9]{4}$/.test(String(tableName || ''))) throw new Error('Member V2 requires a trusted month table name.')
  return { ownerId, tableName, memberId }
}

export const targetFromMember = (member) => assertMemberTarget({
  ownerId: member.owner_id,
  tableName: member.table_name || member.data?.__source_table,
  memberId: member.member_id || member.id,
})

// A row can come from a historical month.  The server remains responsible for
// resolving its canonical/provenance identity before applying an update.
export const createHistoricalIdentity = (member) => ({
  canonical_member_id: member.member_id || member.id,
  source_table: member.table_name || member.data?.__source_table,
  provenance: member.identity || null,
})
