const getMemberName = (member = {}) => (
  member.full_name || member.fullName || member['full_name'] || member['Full Name'] || member.name || member.Name || ''
)

export const MEMBER_CODE_FORMATS = Object.freeze({
  ALPHANUMERIC: 'alphanumeric',
  LETTERS: 'letters',
  NUMBERS: 'numbers'
})

export const normalizeMemberCodeFormat = (value) => (
  Object.values(MEMBER_CODE_FORMATS).includes(value) ? value : MEMBER_CODE_FORMATS.ALPHANUMERIC
)

// The Settings UI exposes two mutually-exclusive toggles, while the stored
// workspace value remains a single non-contradictory format.
export const getToggledMemberCodeFormat = (currentFormat, toggledFormat) => {
  const current = normalizeMemberCodeFormat(currentFormat)
  const next = normalizeMemberCodeFormat(toggledFormat)
  if (next === MEMBER_CODE_FORMATS.ALPHANUMERIC) return MEMBER_CODE_FORMATS.ALPHANUMERIC
  return current === next ? MEMBER_CODE_FORMATS.ALPHANUMERIC : next
}

// Codes compare without display separators: E02, E-02 and E 02 are equivalent.
export const normalizeMemberCode = (value = '') => String(value)
  .trim()
  .toUpperCase()
  .replace(/[^A-Z0-9]/g, '')

export const getLettersOnlyMemberCode = (position) => {
  let value = Number(position)
  if (!Number.isInteger(value) || value < 1) return ''
  let result = ''
  while (value > 0) {
    value -= 1
    result = String.fromCharCode(65 + (value % 26)) + result
    value = Math.floor(value / 26)
  }
  return result
}

export const getNumbersOnlyMemberCode = (position) => {
  const value = Number(position)
  if (!Number.isInteger(value) || value < 1) return ''
  return String(value).padStart(3, '0')
}

export const getMemberFirstLetter = (member = {}) => {
  const first = String(getMemberName(member)).trim().charAt(0).toUpperCase()
  return /^[A-Z]$/.test(first) ? first : '#'
}

const extractCurrentCode = (value) => {
  if (typeof value === 'string') return value
  if (value && typeof value === 'object') return value.current_code || value.code || ''
  return ''
}

export const getMemberIndexCode = (member, indexMap) => {
  if (!member) return ''
  const value = indexMap instanceof Map ? indexMap.get(member.id) : indexMap?.[member.id]
  return extractCurrentCode(value)
}

export const getMemberIndexCodeAliases = (member, indexMap) => {
  if (!member) return []
  const value = indexMap instanceof Map ? indexMap.get(member.id) : indexMap?.[member.id]
  return Array.isArray(value?.aliases) ? value.aliases.filter(Boolean) : []
}

const buildLegacyAlphanumericCodes = (members = []) => {
  const groups = new Map()
  members.forEach((member) => {
    if (!member?.id) return
    const letter = getMemberFirstLetter(member)
    groups.set(letter, [...(groups.get(letter) || []), member])
  })
  const codeMap = {}
  Array.from(groups.keys()).sort((a, b) => (a === '#' ? 1 : b === '#' ? -1 : a.localeCompare(b))).forEach((letter) => {
    groups.get(letter).slice().sort((a, b) => getMemberName(a).localeCompare(getMemberName(b))).forEach((member, index) => {
      codeMap[member.id] = `${letter}${String(index + 1).padStart(2, '0')}`
    })
  })
  return codeMap
}

// Persisted assignments always win. The deterministic fallback keeps legacy pages stable
// while an older workspace is being hydrated; it is never used to allocate a new server code.
export const buildMemberIndexCodeMap = (members = [], { format, persistedCodes = {} } = {}) => {
  const legacyCodes = buildLegacyAlphanumericCodes(members)
  const normalizedFormat = normalizeMemberCodeFormat(format)
  return members.reduce((map, member, index) => {
    if (!member?.id) return map
    const persisted = persistedCodes instanceof Map ? persistedCodes.get(member.id) : persistedCodes?.[member.id]
    if (persisted) {
      map[member.id] = persisted
      return map
    }
    const ordinal = index + 1
    map[member.id] = normalizedFormat === MEMBER_CODE_FORMATS.LETTERS
      ? getLettersOnlyMemberCode(ordinal)
      : normalizedFormat === MEMBER_CODE_FORMATS.NUMBERS
        ? getNumbersOnlyMemberCode(ordinal)
        : legacyCodes[member.id]
    return map
  }, {})
}

export const memberMatchesIndexCode = (member, indexCodeMap, query) => {
  const normalizedQuery = normalizeMemberCode(query)
  if (!normalizedQuery) return false
  return [getMemberIndexCode(member, indexCodeMap), ...getMemberIndexCodeAliases(member, indexCodeMap)]
    .some((code) => normalizeMemberCode(code).includes(normalizedQuery))
}
