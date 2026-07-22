const normalizeSearchText = (value) => String(value || '')
  .normalize('NFKD')
  .replace(/[\u0300-\u036f]/g, '')
  .toLowerCase()
  .replace(/[^a-z0-9+]+/g, ' ')
  .trim()

export const getSearchableMemberName = (member = {}) => (
  member.full_name || member['Full Name'] || member.name || member.Name || ''
).toString().trim()

const getSearchablePhone = (member = {}) => (
  member.phone_number || member['Phone Number'] || member.phone || ''
).toString().trim()

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
  const byId = new Map()
  sources.flat().forEach((member) => {
    if (!member?.id || member.deleted_at) return
    byId.set(String(member.id), { ...(byId.get(String(member.id)) || {}), ...member })
  })
  return [...byId.values()]
}

const isPartialMatch = (haystack, query) => {
  if (!haystack || !query) return false
  const tokens = query.split(/\s+/).filter(Boolean)
  return tokens.length > 0 && tokens.every((token) => haystack.includes(token))
}

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
  getCode = (member) => member?.member_code || member?.memberCode || member?.code || member?.Code || ''
} = {}) => {
  const normalizedQuery = normalizeSearchText(query)
  const activeMembers = uniqueActiveMembers(members, remoteMembers)
  if (!normalizedQuery) {
    return {
      query: '',
      exact: [],
      partial: activeMembers,
      suggestions: [],
      visible: activeMembers,
      deletedMatches: [],
      status: 'idle',
      visibleCount: activeMembers.length
    }
  }

  const exact = []
  const partial = []
  const suggestions = []
  activeMembers.forEach((member) => {
    const name = normalizeSearchText(getSearchableMemberName(member))
    const code = normalizeSearchText(getCode(member))
    const phone = normalizeSearchText(getSearchablePhone(member))
    const isExact = [name, code, phone].some((candidate) => candidate && candidate === normalizedQuery)
    if (isExact) {
      exact.push(member)
      return
    }
    if (isPartialMatch(name, normalizedQuery) || code.includes(normalizedQuery) || phone.includes(normalizedQuery)) {
      partial.push(member)
      return
    }
    if (isSuggestedMatch(name, normalizedQuery)) suggestions.push(member)
  })

  const deletedMatches = (deletedMembers || []).filter((member) => {
    const name = normalizeSearchText(getSearchableMemberName(member))
    const code = normalizeSearchText(getCode(member))
    return name === normalizedQuery || code === normalizedQuery || isPartialMatch(name, normalizedQuery)
  })
  const visible = [...exact, ...partial]
  const status = exact.length
    ? 'exact'
    : partial.length
      ? 'partial'
      : deletedMatches.length
        ? 'deleted'
        : suggestions.length
          ? 'suggested'
          : 'none'

  return {
    query: normalizedQuery,
    exact,
    partial,
    suggestions,
    visible,
    deletedMatches,
    status,
    visibleCount: visible.length
  }
}

export const shouldShowSearchDebug = ({ isDevelopment, flag }) => (
  isDevelopment === true && flag === 'true'
)
