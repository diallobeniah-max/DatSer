export const MEMBER_NAME_STYLES = Object.freeze({
  LOWER: 'lower',
  TITLE: 'title',
  UPPER: 'upper'
})

export const normalizeMemberNameStyle = (style) => (
  Object.values(MEMBER_NAME_STYLES).includes(style) ? style : MEMBER_NAME_STYLES.TITLE
)

// Display-only formatter. It deliberately never mutates a member/CSV row, so
// matching, search, IDs and historical provenance keep using canonical values.
export const formatMemberName = (value, style = MEMBER_NAME_STYLES.TITLE) => {
  if (value === null || value === undefined) return ''
  const name = String(value).trim()
  if (!name) return ''
  const normalizedStyle = normalizeMemberNameStyle(style)
  if (normalizedStyle === MEMBER_NAME_STYLES.LOWER) return name.toLocaleLowerCase()
  if (normalizedStyle === MEMBER_NAME_STYLES.UPPER) return name.toLocaleUpperCase()
  return name.toLocaleLowerCase().replace(/(^|[\s'’\-])(\p{L})/gu, (_match, prefix, letter) => `${prefix}${letter.toLocaleUpperCase()}`)
}
