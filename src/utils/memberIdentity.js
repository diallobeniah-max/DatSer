const firstText = (...values) => values.find((value) => typeof value === 'string' && value.trim())?.trim() || ''

export const getMemberSourceTable = (member, fallbackTable = '') => (
  firstText(member?.__source_table, member?.source_table, member?.table_name, fallbackTable)
)

export const getMemberOwnerId = (member, fallbackOwnerId = null) => (
  member?.__owner_id || member?.user_id || fallbackOwnerId || null
)

export const buildMemberIdentityHint = (member = {}) => ({
  full_name: firstText(member.full_name, member['Full Name'], member.name, member.Name),
  phone_number: firstText(member.phone_number, member['Phone Number'])
})

export const attachMemberIdentity = (member, { tableName = '', ownerId = null } = {}) => {
  if (!member) return member
  return {
    ...member,
    __source_table: getMemberSourceTable(member, tableName),
    __owner_id: getMemberOwnerId(member, ownerId)
  }
}
