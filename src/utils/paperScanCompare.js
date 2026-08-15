import {
  classifyMemberSearch,
  getPhoneVariants,
  normalizeSearchText
} from './memberSearch'

// Compare & Correct helpers: how a scanned (Gemini) row relates to the member
// data DatSer already holds. Reuses the app's own member search engine for
// matching — no invented matching logic here.

export const COMPARE_FIELDS = [
  { key: 'full_name', label: 'Full Name' },
  { key: 'phone_number', label: 'Phone Number' },
  { key: 'age', label: 'Age' },
  { key: 'gender', label: 'Gender' },
  { key: 'current_level', label: 'Level of Education' }
]

export const FIELD_STATES = {
  SAME: 'same',
  DIFFERENT: 'different',
  MISSING: 'missing',
  LOW_CONFIDENCE: 'low-confidence'
}

export const COMPARE_CONFIDENCE_THRESHOLD = 0.5

export const MATCH_STATUSES = {
  MATCHED: 'matched',
  POSSIBLE: 'possible',
  NONE: 'none'
}

// Decision model: only acted-on fields carry a reviewed value; the source
// records where that value came from so "Review Changes" can show the choice.
export const REVIEW_SOURCES = {
  SCAN: 'scan',
  DATSER: 'datser',
  EDITED: 'edited'
}

const asTrimmedText = (value) => String(value ?? '').trim()

export const getExistingValue = (member, field) => asTrimmedText(
  member?.[field] ?? member?.[{ full_name: 'Full Name', phone_number: 'Phone Number', age: 'Age', gender: 'Gender', current_level: 'Current Level' }[field]]
)

export const normalizeGenderForCompare = (value) => asTrimmedText(value).toLowerCase()

export const normalizeAgeForCompare = (value) => {
  const normalized = asTrimmedText(value).replace(/[^\d]/g, '')
  const numeric = Number(normalized)
  return Number.isFinite(numeric) ? String(numeric) : normalized
}

// Conservative education mapping: whitespace/hyphen/period-insensitive exact
// equality only. "SHS 1" == "SHS1", but "University" never becomes "Tertiary".
export const normalizeLevelForCompare = (value) => asTrimmedText(value).toUpperCase().replace(/[^A-Z0-9]/g, '')

export const namesEquivalent = (left, right) => Boolean(left && right) && normalizeSearchText(left) === normalizeSearchText(right)

export const phonesEquivalent = (left, right) => {
  if (!asTrimmedText(left) || !asTrimmedText(right)) return false
  const leftVariants = getPhoneVariants(left)
  return leftVariants.length > 0 && leftVariants.some((variant) => getPhoneVariants(right).includes(variant))
}

export const compareFieldValue = ({ field, geminiValue, existingValue, confidence = 1 }) => {
  const gemini = asTrimmedText(geminiValue)
  const existing = asTrimmedText(existingValue)
  if (!gemini) return { state: FIELD_STATES.MISSING, equivalent: false }
  if (!existing) return { state: FIELD_STATES.DIFFERENT, equivalent: false }

  const equivalent = field === 'phone_number'
    ? phonesEquivalent(gemini, existing)
    : field === 'gender'
      ? normalizeGenderForCompare(gemini) === normalizeGenderForCompare(existing)
      : field === 'current_level'
        ? normalizeLevelForCompare(gemini) === normalizeLevelForCompare(existing)
        : field === 'age'
          ? normalizeAgeForCompare(gemini) === normalizeAgeForCompare(existing)
          : namesEquivalent(gemini, existing)

  if (equivalent) return { state: FIELD_STATES.SAME, equivalent: true }
  const lowConfidence = Number(confidence) < COMPARE_CONFIDENCE_THRESHOLD
  return {
    state: lowConfidence ? FIELD_STATES.LOW_CONFIDENCE : FIELD_STATES.DIFFERENT,
    equivalent: false,
    lowConfidence
  }
}

export const compareRowToMember = (row, member, options = {}) => COMPARE_FIELDS.map(({ key }) => ({
  field: key,
  ...compareFieldValue({
    field: key,
    geminiValue: row?.[key],
    existingValue: getExistingValue(member, key),
    confidence: row?.confidence
  })
}))

// Every plausible existing member for a scanned row, best first, deduped by id.
// Drives the "Possible matches" cards: phone first, then name, each through the
// app's own member search engine. Never invents matching logic.
export const getMatchCandidates = (row, members, options = {}) => {
  const people = Array.isArray(members) ? members : []
  const queries = [row?.phone_number, row?.full_name]
    .map(asTrimmedText)
    .filter(Boolean)
  const seen = new Set()
  const candidates = []
  for (const query of queries) {
    const result = classifyMemberSearch({ members: people, query, ...options })
    const ranked = [...result.exact, ...result.partial, ...result.suggestions]
    for (const member of ranked) {
      const id = String(member.id)
      if (seen.has(id)) continue
      seen.add(id)
      candidates.push({ member, query, reason: result.status })
      if (candidates.length >= 5) return candidates
    }
  }
  return candidates
}

// Strong identifiers win: phone, then name — each run through the app's own
// member search so codes, phones, and normalized names behave like everywhere
// else in DatSer.
export const matchGeminiRowToMember = (row, members, options = {}) => {
  const people = Array.isArray(members) ? members : []
  const candidates = [row?.phone_number, row?.full_name]
    .map(asTrimmedText)
    .filter(Boolean)
  for (const query of candidates) {
    const result = classifyMemberSearch({ members: people, query, ...options })
    if (result.status === 'exact' && result.visible.length === 1) {
      return { status: MATCH_STATUSES.MATCHED, member: result.visible[0], query }
    }
    if (result.status === 'exact') {
      return { status: MATCH_STATUSES.POSSIBLE, member: result.visible[0], query, reason: 'ambiguous' }
    }
    if (result.status === 'partial' || result.status === 'suggested') {
      const member = result.visible[0] || result.suggestions[0] || null
      return { status: MATCH_STATUSES.POSSIBLE, member, query, reason: result.status }
    }
  }
  return { status: MATCH_STATUSES.NONE, member: null, query: '' }
}

// Cross-month Possible Matches. The review is intentionally month-local for
// speed, but a person already present in another month must not silently become
// a brand-new UUID. This narrow helper scores candidate rows the caller already
// fetched (via DatSer's existing historical search RPC) with the SAME engine
// the current-month review uses, and tags each with its source month so the UI
// can say "Found in July 2026". It never fetches whole months itself.
export const getCrossMonthMatchCandidates = (row, crossMonthRows = [], options = {}) => {
  const rows = Array.isArray(crossMonthRows) ? crossMonthRows : []
  if (rows.length === 0) return []
  const seen = new Set()
  const candidates = []
  const queries = [row?.phone_number, row?.full_name]
    .map(asTrimmedText)
    .filter(Boolean)
  for (const query of queries) {
    const result = classifyMemberSearch({ members: rows.map((entry) => entry.member), query, ...options })
    const ranked = [...result.exact, ...result.partial, ...result.suggestions]
    for (const member of ranked) {
      const id = String(member.id)
      if (seen.has(id)) continue
      seen.add(id)
      const source = rows.find((entry) => String(entry.member?.id) === id)
      candidates.push({
        member,
        query,
        reason: result.status,
        sourceTable: source?.source_table || null,
        sourceMonthLabel: source?.source_month_label || null
      })
      if (candidates.length >= 5) return candidates
    }
  }
  return candidates
}

// A field needs an explicit choice when the scan differs from DatSer (or the
// difference rides on low confidence). Missing/no conflict needs no decision.
export const fieldNeedsDecision = (compare) => (
  compare.state === FIELD_STATES.DIFFERENT || compare.state === FIELD_STATES.LOW_CONFIDENCE
)

export const getFieldDecision = (row, field) => row?.reviewedValues?.[field] || null

export const getEffectiveValue = ({ field, compare, row, member }) => {
  const decision = getFieldDecision(row, field)
  if (decision) return decision.value
  if (compare.state === FIELD_STATES.SAME || compare.state === FIELD_STATES.MISSING) {
    return getExistingValue(member, field)
  }
  return getExistingValue(member, field)
}

export const summarizeRowCompare = (row, member) => {
  const compares = compareRowToMember(row, member)
  const totals = { same: 0, different: 0, missing: 0, 'low-confidence': 0, unresolved: 0, resolved: 0 }
  compares.forEach((compare) => {
    totals[compare.state] += 1
    if (fieldNeedsDecision(compare) && !getFieldDecision(row, compare.field)) totals.unresolved += 1
    if (fieldNeedsDecision(compare) && getFieldDecision(row, compare.field)) totals.resolved += 1
  })
  return { compares, totals }
}