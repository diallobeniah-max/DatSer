const getMemberName = (member = {}) => (
  member.full_name ||
  member.fullName ||
  member['full_name'] ||
  member['Full Name'] ||
  member.name ||
  member.Name ||
  ''
)

export const getMemberFirstLetter = (member = {}) => {
  const name = String(getMemberName(member)).trim()
  const first = name.charAt(0).toUpperCase()
  return /^[A-Z]$/.test(first) ? first : '#'
}

// Codes are compared without visual separators so E02, E-02 and E 02 all
// resolve to the same member. Stored/display values remain uppercase.
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

const extractCurrentCode = (value) => {
  if (typeof value === 'string') return value
  if (value && typeof value === 'object') return value.current_code || value.code || ''
  return ''
}

export const getMemberIndexCode = (member, indexMap) => {
  if (!member) return ''
  if (indexMap instanceof Map) return extractCurrentCode(indexMap.get(member.id))
  return extractCurrentCode(indexMap?.[member.id])
}

export const buildMemberIndexCodeMap = (members = []) => {
  const groups = new Map()

  members.forEach((member) => {
    if (!member?.id) return
    const letter = getMemberFirstLetter(member)
    const list = groups.get(letter) || []
    list.push(member)
    groups.set(letter, list)
  })

  const codeMap = {}
  Array.from(groups.keys())
    .sort((a, b) => {
      if (a === '#') return 1
      if (b === '#') return -1
      return a.localeCompare(b)
    })
    .forEach((letter) => {
      groups.get(letter)
        .slice()
        .sort((a, b) => {
          const nameA = getMemberName(a).toLowerCase()
          const nameB = getMemberName(b).toLowerCase()
          return nameA.localeCompare(nameB)
        })
        .forEach((member, index) => {
          codeMap[member.id] = `${letter}${String(index + 1).padStart(2, '0')}`
        })
    })

  return codeMap
}

export const memberMatchesIndexCode = (member, indexCodeMap, query) => {
  const normalizedQuery = normalizeMemberCode(query)
  if (!normalizedQuery) return false
  const entry = indexCodeMap instanceof Map ? indexCodeMap.get(member?.id) : indexCodeMap?.[member?.id]
  const candidates = [getMemberIndexCode(member, indexCodeMap), ...(entry?.aliases || [])]
  return candidates.some((code) => normalizeMemberCode(code).includes(normalizedQuery))
}
