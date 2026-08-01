const getMemberName = (member = {}) => (
  member.full_name || member.fullName || member['full_name'] || member['Full Name'] || member.name || member.Name || ''
)

export const MEMBER_CODE_FORMATS = Object.freeze({
  ALPHANUMERIC: 'alphanumeric',
  LETTERS: 'letters',
  NUMBERS: 'numbers'
})

export const MEMBER_CODE_LENGTHS = Object.freeze([3, 4, 5, 6])
export const DEFAULT_MEMBER_CODE_LENGTH = 3

export const normalizeMemberCodeFormat = (value) => (
  Object.values(MEMBER_CODE_FORMATS).includes(value) ? value : MEMBER_CODE_FORMATS.ALPHANUMERIC
)

export const normalizeMemberCodeLength = (value) => {
  const length = Number(value)
  return MEMBER_CODE_LENGTHS.includes(length) ? length : DEFAULT_MEMBER_CODE_LENGTH
}

export const getMemberCodeCapacity = (format, codeLength = DEFAULT_MEMBER_CODE_LENGTH) => {
  const length = normalizeMemberCodeLength(codeLength)
  switch (normalizeMemberCodeFormat(format)) {
    case MEMBER_CODE_FORMATS.LETTERS:
      return 26 ** length
    case MEMBER_CODE_FORMATS.NUMBERS:
      return (10 ** length) - 1
    default:
      return 26 * ((10 ** (length - 1)) - 1)
  }
}

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

export const getLettersOnlyMemberCode = (position, codeLength = DEFAULT_MEMBER_CODE_LENGTH) => {
  let value = Number(position)
  const length = normalizeMemberCodeLength(codeLength)
  if (!Number.isInteger(value) || value < 1 || value > getMemberCodeCapacity(MEMBER_CODE_FORMATS.LETTERS, length)) return ''
  value -= 1
  let result = ''
  for (let index = 0; index < length; index += 1) {
    result = String.fromCharCode(65 + (value % 26)) + result
    value = Math.floor(value / 26)
  }
  return result
}

export const getNumbersOnlyMemberCode = (position, codeLength = DEFAULT_MEMBER_CODE_LENGTH) => {
  const value = Number(position)
  const length = normalizeMemberCodeLength(codeLength)
  if (!Number.isInteger(value) || value < 1 || value > getMemberCodeCapacity(MEMBER_CODE_FORMATS.NUMBERS, length)) return ''
  return String(value).padStart(length, '0')
}

export const getAlphanumericMemberCode = (position, codeLength = DEFAULT_MEMBER_CODE_LENGTH) => {
  const value = Number(position)
  const length = normalizeMemberCodeLength(codeLength)
  const numberCapacity = (10 ** (length - 1)) - 1
  if (!Number.isInteger(value) || value < 1 || value > getMemberCodeCapacity(MEMBER_CODE_FORMATS.ALPHANUMERIC, length)) return ''
  const prefixIndex = Math.floor((value - 1) / numberCapacity)
  const suffix = ((value - 1) % numberCapacity) + 1
  return `${String.fromCharCode(65 + prefixIndex)}${String(suffix).padStart(length - 1, '0')}`
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

const buildLegacyAlphanumericCodes = (members = [], codeLength = DEFAULT_MEMBER_CODE_LENGTH) => {
  const length = normalizeMemberCodeLength(codeLength)
  const groups = new Map()
  members.forEach((member) => {
    if (!member?.id) return
    const letter = getMemberFirstLetter(member)
    groups.set(letter, [...(groups.get(letter) || []), member])
  })
  const codeMap = {}
  Array.from(groups.keys()).sort((a, b) => (a === '#' ? 1 : b === '#' ? -1 : a.localeCompare(b))).forEach((letter) => {
    groups.get(letter).slice().sort((a, b) => getMemberName(a).localeCompare(getMemberName(b))).forEach((member, index) => {
      const suffix = index + 1
      codeMap[member.id] = suffix < 10 ** (length - 1)
        ? `${letter}${String(suffix).padStart(length - 1, '0')}`
        : getAlphanumericMemberCode(index + 1, length)
    })
  })
  return codeMap
}

// Persisted assignments always win. The deterministic fallback keeps legacy pages stable
// while an older workspace is being hydrated; it is never used to allocate a new server code.
export const buildMemberIndexCodeMap = (members = [], { format, codeLength = DEFAULT_MEMBER_CODE_LENGTH, persistedCodes = {}, allowLegacyFallback = true } = {}) => {
  const length = normalizeMemberCodeLength(codeLength)
  const legacyCodes = buildLegacyAlphanumericCodes(members, length)
  const normalizedFormat = normalizeMemberCodeFormat(format)
  return members.reduce((map, member, index) => {
    if (!member?.id) return map
    const persisted = persistedCodes instanceof Map ? persistedCodes.get(member.id) : persistedCodes?.[member.id]
    if (persisted) {
      map[member.id] = persisted
      return map
    }
    if (!allowLegacyFallback) return map
    const ordinal = index + 1
    map[member.id] = normalizedFormat === MEMBER_CODE_FORMATS.LETTERS
      ? getLettersOnlyMemberCode(ordinal, length)
      : normalizedFormat === MEMBER_CODE_FORMATS.NUMBERS
        ? getNumbersOnlyMemberCode(ordinal, length)
        : legacyCodes[member.id]
    return map
  }, {})
}

export const memberMatchesIndexCode = (member, indexCodeMap, query) => {
  const normalizedQuery = normalizeMemberCode(query)
  if (!normalizedQuery) return false
  return [getMemberIndexCode(member, indexCodeMap), ...getMemberIndexCodeAliases(member, indexCodeMap)]
    .some((code) => normalizeMemberCode(code).startsWith(normalizedQuery))
}
