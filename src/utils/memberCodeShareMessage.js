export const DEFAULT_SHARE_MESSAGE_TEMPLATE =
  'Hello {first_name},\n\nThank you for joining {church_name}.\n\nYour member code is {member_code}.\n\nPlease keep it safe.'

export const SHARE_MESSAGE_TOKENS = [
  { id: 'full_name', token: '{name}', label: 'Full Name' },
  { id: 'first_name', token: '{first_name}', label: 'First Name' },
  { id: 'member_code', token: '{member_code}', label: 'Member Code' },
  { id: 'church_name', token: '{church_name}', label: 'Church Name' },
  { id: 'lookup_link', token: '{lookup_link}', label: 'Lookup Link' }
]

export function formatMemberCodeShareMessage({
  template,
  member,
  memberCode,
  churchName = 'DatSer Church',
  lookupLink = ''
}) {
  const rawTemplate = typeof template === 'string' && template.trim() !== ''
    ? template
    : DEFAULT_SHARE_MESSAGE_TEMPLATE

  const fullName = (
    member?.full_name ||
    member?.['Full Name'] ||
    member?.name ||
    member?.Name ||
    'Member'
  ).trim()

  const firstName = fullName.split(/\s+/)[0] || fullName
  const code = String(memberCode || member?.member_code || member?.code || '').trim()
  const resolvedChurchName = String(churchName || 'DatSer Church').trim()
  const resolvedLookupLink = String(
    lookupLink || (code ? `https://datser.app/pass/${code}` : '')
  ).trim()

  return rawTemplate
    .replace(/\{name\}/g, fullName)
    .replace(/\{first_name\}/g, firstName)
    .replace(/\{member_code\}/g, code)
    .replace(/\{code\}/g, code)
    .replace(/\{church_name\}/g, resolvedChurchName)
    .replace(/\{workspace\}/g, resolvedChurchName)
    .replace(/\{church\}/g, resolvedChurchName)
    .replace(/\{lookup_link\}/g, resolvedLookupLink)
}
