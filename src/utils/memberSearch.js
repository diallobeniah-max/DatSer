export const normalizeSearchText = (value) => String(value || '')
  .normalize('NFKD')
  .replace(/[\u0300-\u036f]/g, '')
  .toLowerCase()
  .replace(/[\u2018\u2019'`]/g, '')
  .replace(/[^a-z0-9+]+/g, ' ')
  .replace(/\s+/g, ' ')
  .trim()

export const normalizePhoneForSearch = (value) => String(value || '').replace(/\D/g, '')

const normalizeCodeForSearch = (value) => String(value || '').toUpperCase().replace(/[^A-Z0-9]/g, '')
const getCodeCandidates = (member, getCode, getCodeAliases) => {
  const aliases = getCodeAliases(member)
  return [
    getCode(member),
    ...(Array.isArray(aliases) ? aliases : [])
  ].map(normalizeCodeForSearch).filter(Boolean)
}

const isNumericCodeEquivalent = (query, code) => {
  if (!/^\d+$/.test(query) || !/^\d+$/.test(code)) return false
  // 000 is reserved as invalid and must never become an accidental exact match.
  if (Number(query) === 0 || Number(code) === 0) return false
  return Number(query) === Number(code)
}

const getPhoneVariants = (value) => {
  const digits = normalizePhoneForSearch(value)
  if (!digits) return []

  const variants = new Set([digits])
  // Ghana's national format is 0 + 9 digits; only add the country-code
  // equivalent when the input has that exact, unambiguous shape.
  if (/^0\d{9}$/.test(digits)) variants.add(`233${digits.slice(1)}`)
  if (/^233\d{9}$/.test(digits)) variants.add(`0${digits.slice(3)}`)
  return [...variants]
}

// Shared by filtering and ranking. Keeping this helper in scope prevents a
// numeric search from reaching the ranker through an undefined callback.
const phoneMatchesQuery = (phoneValue, query) => {
  const queryVariants = getPhoneVariants(query)
  if (queryVariants.length === 0) return false
  return getPhoneVariants(phoneValue).some((phone) => (
    queryVariants.some((candidate) => phone.includes(candidate))
  ))
}

export const getSearchableMemberName = (member = {}) => (
  member.full_name || member['Full Name'] || member.name || member.Name || ''
).toString().trim()

const PHONE_FIELDS = [
  ['phone_number', 'member'], ['Phone Number', 'member'], ['phone', 'member'], ['Phone', 'member'],
  ['parent_phone_1', 'guardian'], ['Parent Phone 1', 'guardian'], ['parentPhone1', 'guardian'],
  ['parent_phone_2', 'guardian'], ['Parent Phone 2', 'guardian'], ['parentPhone2', 'guardian'],
  ['parent_phone_number', 'guardian'], ['Parent Phone Number', 'guardian'],
  ['guardian_phone_1', 'guardian'], ['Guardian Phone 1', 'guardian'],
  ['guardian_phone_2', 'guardian'], ['Guardian Phone 2', 'guardian']
]

export const getSearchablePhones = (member = {}) => PHONE_FIELDS
  .map(([field, kind]) => ({ value: member[field], kind }))
  .filter(({ value }) => value !== undefined && value !== null && String(value).trim() !== '')
  .map(({ value, kind }) => ({
    kind,
    raw: String(value).trim(),
    variants: getPhoneVariants(value)
  }))

const editDistance = (left, right) => {
  if (!left) return right.length
  if (!right) return left.length
  const previous = Array.from({ length: right.length + 1 }, (_, index) => index)
  const current = new Array(right.length + 1)
  for (let row = 1; row <= left.length; row += 1) {
    current[0] = row
    for (let column = 1; column <= right.length; column += 1) {
      current[column] = Math.min(
        current[column - 1] + 1,
        previous[column] + 1,
        previous[column - 1] + (left[row - 1] === right[column - 1] ? 0 : 1)
      )
    }
    for (let column = 0; column <= right.length; column += 1) previous[column] = current[column]
  }
  return previous[right.length]
}

const uniqueActiveMembers = (...sources) => {
  const flattenedSources = sources.filter(Array.isArray).flat()
  const deletedIds = new Set(flattenedSources
    .filter((member) => member?.id && member.deleted_at)
    .map((member) => String(member.id)))
  const byId = new Map()
  flattenedSources.forEach((member) => {
    if (!member?.id || member.deleted_at || deletedIds.has(String(member.id))) return
    byId.set(String(member.id), { ...(byId.get(String(member.id)) || {}), ...member })
  })
  return [...byId.values()]
}

const hasNameTokenMatch = (name, query) => {
  if (!name || !query) return false
  const queryTokens = query.split(' ').filter(Boolean)
  const nameTokens = name.split(' ').filter(Boolean)
  return queryTokens.length > 0 && queryTokens.every((queryToken) => (
    nameTokens.some((nameToken) => nameToken.includes(queryToken))
  ))
}

const hasPhoneMatch = (member, query) => getSearchablePhones(member)
  .some(({ raw }) => phoneMatchesQuery(raw, query))

const isSuggestedMatch = (name, query) => {
  if (!name || query.length < 3) return false
  const queryWords = query.split(/\s+/).filter(Boolean)
  const nameWords = name.split(/\s+/).filter(Boolean)
  return queryWords.some((queryWord) => nameWords.some((nameWord) => {
    const limit = queryWord.length >= 7 ? 2 : 1
    return editDistance(queryWord, nameWord) <= limit
  }))
}

export const classifyMemberSearch = ({
  members = [],
  remoteMembers = [],
  deletedMembers = [],
  query = '',
  getCode = (member) => member?.member_code || member?.memberCode || member?.code || member?.Code || '',
  getCodeAliases = () => [],
  codeLength = 3
} = {}) => {
  const normalizedQuery = normalizeSearchText(query)
  const normalizedCodeQuery = normalizeCodeForSearch(query)
  const configuredCodeLength = [3, 4, 5, 6].includes(Number(codeLength)) ? Number(codeLength) : 3
  const isCodePrefixQuery = normalizedCodeQuery.length >= 2
  const activeMembers = uniqueActiveMembers(members, remoteMembers)
  if (!normalizedQuery) {
    return {
      query: '', exact: [], partial: activeMembers, suggestions: [], visible: activeMembers,
      deletedMatches: [], status: 'idle', visibleCount: activeMembers.length
    }
  }

  const exact = []
  const exactAlias = []
  const partial = []
  const suggestions = []
  activeMembers.forEach((member) => {
    const name = normalizeSearchText(getSearchableMemberName(member))
    const codes = getCodeCandidates(member, getCode, getCodeAliases)
    const [currentCode = ''] = codes
    const aliasCodes = codes.slice(1)
    const nameTokens = name.split(' ').filter(Boolean)
    const isExactCode = Boolean(normalizedCodeQuery) && (
      (normalizedCodeQuery.length === configuredCodeLength && currentCode === normalizedCodeQuery) ||
      isNumericCodeEquivalent(normalizedCodeQuery, currentCode)
    )
    // Historical one-character aliases stay searchable as partial results,
    // but cannot take priority over a real name such as "Ophelia".
    const isExactAlias = Boolean(normalizedCodeQuery) && aliasCodes.some((code) => (
      code.length >= 2 && (
        (normalizedCodeQuery.length === configuredCodeLength && code === normalizedCodeQuery) ||
        isNumericCodeEquivalent(normalizedCodeQuery, code)
      )
    ))
    const isExact = name === normalizedQuery || isExactCode || getSearchablePhones(member)
      .some(({ variants }) => getPhoneVariants(query).some((candidate) => variants.includes(candidate)))

    if (isExact) {
      exact.push(member)
      return
    }

    if (isExactAlias) {
      exactAlias.push(member)
      return
    }

    const exactNamePart = normalizedQuery.split(' ').length === 1 && nameTokens.includes(normalizedQuery)
    const phraseMatch = name.includes(normalizedQuery)
    const hasCodePrefixMatch = isCodePrefixQuery && codes.some((code) => code.startsWith(normalizedCodeQuery))
    if (exactNamePart || phraseMatch || hasNameTokenMatch(name, normalizedQuery) || hasCodePrefixMatch || hasPhoneMatch(member, query)) {
      partial.push(member)
      return
    }
    if (isSuggestedMatch(name, normalizedQuery)) suggestions.push(member)
  })

  const deletedMatches = (Array.isArray(deletedMembers) ? deletedMembers : []).filter((member) => {
    const name = normalizeSearchText(getSearchableMemberName(member))
    const codes = getCodeCandidates(member, getCode, getCodeAliases)
    return name === normalizedQuery || codes.includes(normalizedCodeQuery) || hasNameTokenMatch(name, normalizedQuery)
  })
  // A code is a unique identifier. Do not dilute a valid exact result with name matches.
  const exactCodes = normalizedCodeQuery && (exact.some((member) => {
    const code = getCodeCandidates(member, getCode, getCodeAliases)[0]
    return (normalizedCodeQuery.length === configuredCodeLength && code === normalizedCodeQuery) || isNumericCodeEquivalent(normalizedCodeQuery, code)
  }))
    ? exact.filter((member) => {
      const code = getCodeCandidates(member, getCode, getCodeAliases)[0]
      return (normalizedCodeQuery.length === configuredCodeLength && code === normalizedCodeQuery) || isNumericCodeEquivalent(normalizedCodeQuery, code)
    })
    : []
  const exactAliasCodes = !exactCodes.length && normalizedCodeQuery ? exactAlias : []
  const getVisibleRank = (member) => {
    const codes = getCodeCandidates(member, getCode, getCodeAliases)
    if (isCodePrefixQuery && codes.some((code) => code.startsWith(normalizedCodeQuery))) return 0

    const name = normalizeSearchText(getSearchableMemberName(member))
    if (name === normalizedQuery || hasNameTokenMatch(name, normalizedQuery)) return 1

    const phoneMatches = getSearchablePhones(member).filter((phone) => phoneMatchesQuery(phone.raw, query))
    if (phoneMatches.some((phone) => phone.kind === 'member')) return 2
    if (phoneMatches.some((phone) => phone.kind === 'guardian')) return 3
    return 4
  }

  // Current/alias exact codes always stand alone. Otherwise retain a predictable
  // code -> name -> member phone -> guardian phone ordering across every client.
  const visible = exactCodes.length
    ? exactCodes
    : exactAliasCodes.length
      ? exactAliasCodes
      : [...exact, ...partial].sort((left, right) => getVisibleRank(left) - getVisibleRank(right))
  const status = exactCodes.length || exactAliasCodes.length || exact.length ? 'exact' : partial.length ? 'partial' : deletedMatches.length ? 'deleted' : suggestions.length ? 'suggested' : 'none'

  return { query: normalizedQuery, exact: [...exactCodes, ...exactAliasCodes, ...exact.filter((member) => !exactCodes.includes(member))], partial, suggestions, visible, deletedMatches, status, visibleCount: visible.length }
}

export const shouldShowSearchDebug = ({ isDevelopment, flag }) => (
  isDevelopment === true && flag === 'true'
)
