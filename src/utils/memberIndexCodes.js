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

export const getMemberIndexCode = (member, indexMap) => {
  if (!member) return ''
  if (indexMap instanceof Map) return indexMap.get(member.id) || ''
  return indexMap?.[member.id] || ''
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
  const normalizedQuery = String(query || '').trim().toUpperCase()
  if (!normalizedQuery) return false
  const code = getMemberIndexCode(member, indexCodeMap)
  return code.toUpperCase().includes(normalizedQuery)
}
