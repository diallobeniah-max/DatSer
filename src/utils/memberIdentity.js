const firstText = (...values) => values.find((value) => typeof value === 'string' && value.trim())?.trim() || ''

export const getMemberSourceTable = (member, fallbackTable = '') => (
  firstText(member?.__source_table, member?.source_table, member?.table_name, fallbackTable)
)

export const getMemberOwnerId = (member, fallbackOwnerId = null) => (
  member?.__owner_id || member?.user_id || fallbackOwnerId || null
)

// A member can be represented by a monthly row, a preview row, or a search
// result. Prefer the stable member identifier whenever the transport exposes
// one, then fall back to the row id used by the rest of the app.
export const getMemberCanonicalId = (member) => (
  member?.__canonical_member_id ||
  member?.canonical_member_id ||
  member?.source_member_id ||
  member?.original_member_id ||
  member?.member_id ||
  member?.id ||
  null
)

export const buildMemberIdentityHint = (member = {}) => ({
  full_name: firstText(member.full_name, member['Full Name'], member.name, member.Name),
  phone_number: firstText(member.phone_number, member['Phone Number'])
})

export const attachMemberIdentity = (member, { tableName = '', ownerId = null } = {}) => {
  if (!member) return member
  return {
    ...member,
    __canonical_member_id: getMemberCanonicalId(member),
    __source_table: getMemberSourceTable(member, tableName),
    __owner_id: getMemberOwnerId(member, ownerId)
  }
}
