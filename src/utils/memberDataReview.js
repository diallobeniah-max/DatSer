// Member Data Review — Phase 1 (read-only) analysis engine.
//
// Pure, deterministic, fully unit-tested helpers used by the Member Data Review
// admin page. This module performs NO database access and NO writes; it only
// normalizes rows, groups records by strong canonical identity, recommends a
// combined profile, and detects conflicts/completeness.

import { getMemberCanonicalId, getMemberSourceTable } from './memberIdentity'
import { formatMonthTableLabel, parseMonthTable } from './historicalSearchSettings'

export const PROFILE_FIELDS = [
  { key: 'full_name', label: 'Full Name' },
  { key: 'phone_number', label: 'Phone Number' },
  { key: 'gender', label: 'Gender' },
  { key: 'age', label: 'Age' },
  { key: 'current_level', label: 'Current Level' },
  { key: 'date_of_birth', label: 'Date of Birth' },
  { key: 'parent_name_1', label: 'Parent/Guardian Name 1' },
  { key: 'parent_phone_1', label: 'Parent/Guardian Phone 1' },
  { key: 'parent_name_2', label: 'Parent/Guardian Name 2' },
  { key: 'parent_phone_2', label: 'Parent/Guardian Phone 2' },
  { key: 'ministry', label: 'Ministry' },
  { key: 'notes', label: 'Notes' },
  { key: 'member_code', label: 'Member Code' }
]

// Completeness score fields. is_visitor is excluded because the schema defaults
// it to false for every row, which would add the same point to every record.
export const COMPLETENESS_FIELDS = [
  'full_name',
  'phone_number',
  'gender',
  'age',
  'current_level',
  'date_of_birth',
  'parent_name_1',
  'parent_phone_1',
  'parent_name_2',
  'parent_phone_2',
  'ministry',
  'notes',
  'member_code'
]

// High-risk fields compared for conflicts. Age and current level are excluded
// because they legitimately change over time; notes/ministry/visitor vary freely.
export const CONFLICT_FIELDS = [
  'full_name',
  'phone_number',
  'gender',
  'date_of_birth',
  'parent_name_1',
  'parent_phone_1',
  'parent_name_2',
  'parent_phone_2',
  'member_code'
]

export const IDENTITY_TYPES = {
  UUID: 'uuid',
  CODE: 'code',
  PHONE: 'phone',
  NAME: 'name'
}

export const REVIEW_FILTERS = {
  ALL: 'all',
  NEEDS_REVIEW: 'needs_review',
  CONFLICTS: 'conflicts',
  INCOMPLETE: 'incomplete',
  MULTIPLE_MONTHS: 'multiple_months'
}

export const REVIEW_SORTS = {
  NAME: 'name',
  COMPLETENESS: 'completeness',
  MONTHS: 'months',
  RECENT: 'recent'
}

const hasUsefulValue = (value) => value !== undefined && value !== null && (
  typeof value !== 'string' || value.trim() !== ''
)

const pickValue = (row, keys = []) => {
  for (const key of keys) {
    const value = row?.[key]
    if (hasUsefulValue(value)) return value
  }
  return undefined
}

export const normalizeReviewName = (value) => String(value || '')
  .normalize('NFKD')
  .replace(/[\u0300-\u036f]/g, '')
  .toLowerCase()
  .replace(/[^a-z0-9]+/g, ' ')
  .replace(/\s+/g, ' ')
  .trim()

export const normalizeReviewPhone = (value) => String(value || '').replace(/\D/g, '')

export const normalizeReviewCode = (value) => String(value || '').toUpperCase().replace(/[^A-Z0-9]/g, '')

const isReservedCode = (code) => /^0+$/.test(code)

// A single row from a month table normalized into a review record. Read-only.
export const normalizeReviewRow = (row, options = {}) => {
  if (!row || typeof row !== 'object') return null
  const {
    tableName = '',
    ownerId = null,
    codeAssignments = {}
  } = options

  const canonicalId = getMemberCanonicalId(row)
  const sourceTable = getMemberSourceTable(row, tableName)
  const rawPhone = pickValue(row, ['phone_number', 'Phone Number', 'phone', 'Phone'])
  const rawParentPhone1 = pickValue(row, ['parent_phone_1', 'Parent 1 Phone'])
  const rawParentPhone2 = pickValue(row, ['parent_phone_2', 'Parent 2 Phone'])
  const rawMemberCode = pickValue(row, ['member_code', 'Member Code', 'memberCode'])
  const assignment = canonicalId ? codeAssignments?.[canonicalId] : null
  const memberCode = (assignment?.current_code && String(assignment.current_code)) || rawMemberCode || ''

  return {
    id: row.id,
    canonicalId: canonicalId || null,
    sourceTable,
    source_month_label: formatMonthTableLabel(sourceTable),
    full_name: String(pickValue(row, ['full_name', 'Full Name', 'name', 'Name']) || '').trim(),
    gender: String(pickValue(row, ['gender', 'Gender']) || '').trim(),
    phone_number: rawPhone !== undefined && rawPhone !== null ? String(rawPhone).trim() : '',
    age: String(pickValue(row, ['age', 'Age']) || '').trim(),
    current_level: String(pickValue(row, ['current_level', 'Current Level']) || '').trim(),
    date_of_birth: String(pickValue(row, ['date_of_birth', 'Date of Birth']) || '').trim(),
    parent_name_1: String(pickValue(row, ['parent_name_1', 'Parent 1 Name']) || '').trim(),
    parent_phone_1: rawParentPhone1 !== undefined && rawParentPhone1 !== null ? String(rawParentPhone1).trim() : '',
    parent_name_2: String(pickValue(row, ['parent_name_2', 'Parent 2 Name']) || '').trim(),
    parent_phone_2: rawParentPhone2 !== undefined && rawParentPhone2 !== null ? String(rawParentPhone2).trim() : '',
    ministry: String(pickValue(row, ['ministry', 'Ministry']) || '').trim(),
    notes: String(pickValue(row, ['notes', 'Notes']) || '').trim(),
    is_visitor: row.is_visitor === true,
    member_code: String(memberCode || '').trim(),
    inserted_at: row.inserted_at || null,
    updated_at: row.updated_at || row.inserted_at || null,
    deleted_at: row.deleted_at || null,
    __owner_id: ownerId
  }
}

// Deterministic recency ordering: timestamp first, then month recency, then stable.
const getTimestampMs = (record) => {
  const raw = record?.updated_at || record?.inserted_at
  if (!raw) return null
  const ms = new Date(raw).getTime()
  return Number.isFinite(ms) ? ms : null
}

const getMonthKey = (record) => {
  const parsed = parseMonthTable(record?.sourceTable)
  return parsed ? parsed.year * 100 + parsed.monthIndex : null
}

export const compareReviewRecency = (a, b) => {
  const ta = getTimestampMs(a)
  const tb = getTimestampMs(b)
  if (ta != null && tb != null && ta !== tb) return tb - ta
  if (ta != null && tb == null) return -1
  if (ta == null && tb != null) return 1
  const ma = getMonthKey(a)
  const mb = getMonthKey(b)
  if (ma != null && mb != null && ma !== mb) return mb - ma
  if (ma != null && mb == null) return -1
  if (ma == null && mb != null) return 1
  return 0
}

export const sortRecordsNewestFirst = (records = []) => (
  (Array.isArray(records) ? records : []).slice().sort(compareReviewRecency)
)

const hasSupportingEvidence = (a, b) => {
  const phoneA = normalizeReviewPhone(a.phone_number)
  const phoneB = normalizeReviewPhone(b.phone_number)
  if (phoneA && phoneB && phoneA.length >= 7 && phoneA === phoneB) return true

  const parentPhones = (record) => [normalizeReviewPhone(record.parent_phone_1), normalizeReviewPhone(record.parent_phone_2)].filter(Boolean)
  const ppA = parentPhones(a)
  const ppB = parentPhones(b)
  if (ppA.length && ppB.some((p) => ppA.includes(p) && p.length >= 7)) return true

  const genderA = String(a.gender || '').trim().toLowerCase()
  const genderB = String(b.gender || '').trim().toLowerCase()
  const ageA = String(a.age || '').trim()
  const ageB = String(b.age || '').trim()
  if (genderA && genderB && genderA === genderB && ageA && ageB && ageA === ageB) return true

  return false
}

// Two records may be unioned by a non-UUID signal only when they do not carry
// conflicting confirmed canonical ids. Different canonical ids = separate people.
const canUnion = (a, b) => !(a.canonicalId && b.canonicalId && String(a.canonicalId) !== String(b.canonicalId))

const unionFind = (size) => {
  const parent = Array.from({ length: size }, (_, i) => i)
  const find = (x) => {
    while (parent[x] !== x) {
      parent[x] = parent[parent[x]]
      x = parent[x]
    }
    return x
  }
  const union = (a, b) => {
    const ra = find(a)
    const rb = find(b)
    if (ra !== rb) parent[Math.max(ra, rb)] = Math.min(ra, rb)
  }
  return { find, union }
}

// Group records by strong canonical identity. Priority: canonical UUID >
// canonical code > normalized phone > exact name + supporting info. Names are
// never the sole basis for merging, and different canonical ids stay separate.
export const groupRecordsByIdentity = (records = []) => {
  const safe = (Array.isArray(records) ? records : []).filter(Boolean)
  const n = safe.length
  const { find, union } = unionFind(n)

  const bucketBy = (keyOf, bucketKey = (value) => value) => {
    const map = new Map()
    safe.forEach((record, index) => {
      const key = keyOf(record)
      if (!key) return
      const group = map.get(key) || []
      group.push(index)
      map.set(key, group)
    })
    for (const indices of map.values()) {
      for (let k = 1; k < indices.length; k += 1) {
        if (canUnion(safe[indices[0]], safe[indices[k]])) union(indices[0], indices[k])
      }
    }
  }

  // 1. Canonical UUID (strongest).
  bucketBy((record) => (record.canonicalId ? `u:${String(record.canonicalId)}` : ''))

  // 2. Canonical member code.
  bucketBy((record) => {
    const code = normalizeReviewCode(record.member_code)
    return code && !isReservedCode(code) ? `c:${code}` : ''
  })

  // 3. Normalized phone.
  bucketBy((record) => {
    const phone = normalizeReviewPhone(record.phone_number)
    return phone && phone.length >= 7 ? `p:${phone}` : ''
  })

  // 4. Exact normalized name + supporting evidence, only within same-name groups.
  const nameMap = new Map()
  safe.forEach((record, index) => {
    const name = normalizeReviewName(record.full_name)
    if (!name) return
    const group = nameMap.get(name) || []
    group.push(index)
    nameMap.set(name, group)
  })
  for (const indices of nameMap.values()) {
    for (let a = 0; a < indices.length; a += 1) {
      for (let b = a + 1; b < indices.length; b += 1) {
        const ra = safe[indices[a]]
        const rb = safe[indices[b]]
        if (canUnion(ra, rb) && hasSupportingEvidence(ra, rb)) union(indices[a], indices[b])
      }
    }
  }

  const groups = new Map()
  for (let i = 0; i < n; i += 1) {
    const root = find(i)
    if (!groups.has(root)) groups.set(root, [])
    groups.get(root).push(safe[i])
  }
  return Array.from(groups.values()).map(buildPersonMeta)
}

const firstUseful = (records, field) => {
  for (const record of records) {
    if (hasUsefulValue(record[field])) return record[field]
  }
  return undefined
}

const distinctValues = (records, field) => Array.from(new Set(
  records.map((record) => record[field]).filter((value) => hasUsefulValue(value))
))

export const scoreCompleteness = (record = {}, { fields = COMPLETENESS_FIELDS } = {}) => {
  const missing = fields.filter((field) => !hasUsefulValue(record?.[field]))
  const count = fields.length - missing.length
  const percent = fields.length ? count / fields.length : 0
  return { count, total: fields.length, percent, missingFields: missing }
}

export const mostCompleteSingleRecord = (records = []) => {
  const best = sortRecordsNewestFirst(records).slice().sort((a, b) => {
    const diff = scoreCompleteness(b).count - scoreCompleteness(a).count
    return diff !== 0 ? diff : compareReviewRecency(a, b)
  })[0] || null
  return best ? { ...best, completeness: scoreCompleteness(best) } : null
}

export const recommendCombinedProfile = (records = [], { fields = PROFILE_FIELDS } = {}) => {
  const newestFirst = sortRecordsNewestFirst(records)
  const combined = {}
  const provenance = {}
  const contributing = new Set()
  for (const field of fields) {
    const picked = newestFirst.find((record) => hasUsefulValue(record[field.key]))
    if (!picked) continue
    combined[field.key] = picked[field.key]
    provenance[field.key] = {
      value: picked[field.key],
      sourceMonth: picked.source_month_label,
      sourceTable: picked.sourceTable,
      updatedAt: picked.updated_at || picked.inserted_at
    }
    contributing.add(picked)
  }
  const newestContributing = newestFirst.find((record) => contributing.has(record)) || newestFirst[0]
  const label = newestContributing && newestContributing.source_month_label
    ? `Details combined through ${newestContributing.source_month_label}`
    : 'No useful profile fields'
  return {
    combined,
    provenance,
    label,
    completeness: scoreCompleteness(combined)
  }
}

const normalizeConflictValue = (field, value) => {
  if (field === 'phone_number' || field === 'parent_phone_1' || field === 'parent_phone_2') {
    return normalizeReviewPhone(value)
  }
  if (field === 'gender') return String(value).trim().toLowerCase()
  if (field === 'full_name') return normalizeReviewName(value)
  if (field === 'member_code') return normalizeReviewCode(value)
  if (field === 'is_visitor') return String(value)
  return String(value).trim().toLowerCase()
}

// Detect high-risk conflicts across a person's records, with month provenance.
export const detectConflicts = (records = [], { fields = CONFLICT_FIELDS } = {}) => {
  const conflicts = []
  const safe = (Array.isArray(records) ? records : []).filter(Boolean)

  const canonicalIds = Array.from(new Set(safe.map((r) => r.canonicalId).filter(Boolean)))
  if (canonicalIds.length > 1) {
    conflicts.push({
      kind: 'identity',
      field: 'canonical_id',
      label: 'Identity',
      values: canonicalIds.map((id) => ({
        value: id,
        months: safe.filter((r) => r.canonicalId === id).map((r) => r.source_month_label)
      }))
    })
  }

  for (const field of fields) {
    const byKey = new Map()
    for (const record of safe) {
      const value = record[field]
      if (!hasUsefulValue(value)) continue
      const norm = normalizeConflictValue(field, value)
      if (!norm) continue
      const entry = byKey.get(norm) || { value, months: [], variants: new Set() }
      entry.variants.add(String(value))
      if (!entry.months.includes(record.source_month_label)) entry.months.push(record.source_month_label)
      byKey.set(norm, entry)
    }
    if (byKey.size > 1) {
      conflicts.push({
        kind: 'conflict',
        field,
        label: (PROFILE_FIELDS.find((f) => f.key === field) || {}).label || field,
        values: Array.from(byKey.values()).map((entry) => ({
          value: entry.value,
          months: entry.months,
          variants: Array.from(entry.variants)
        }))
      })
    }
  }

  return conflicts
}

export const buildPersonMeta = (records = []) => {
  const sorted = sortRecordsNewestFirst(records)
  const canonicalIds = distinctValues(sorted, 'canonicalId')
  const codes = distinctValues(sorted, 'member_code')
  const phones = distinctValues(sorted, 'phone_number')

  let keyType = IDENTITY_TYPES.NAME
  let key = normalizeReviewName(firstUseful(sorted, 'full_name') || '')
  if (canonicalIds.length) {
    keyType = IDENTITY_TYPES.UUID
    key = String(canonicalIds[0])
  } else if (codes.length) {
    keyType = IDENTITY_TYPES.CODE
    key = normalizeReviewCode(codes[0])
  } else if (phones.length) {
    keyType = IDENTITY_TYPES.PHONE
    key = normalizeReviewPhone(phones[0])
  }

  const recommended = recommendCombinedProfile(sorted)
  const mostComplete = mostCompleteSingleRecord(sorted)
  const conflicts = detectConflicts(sorted)
  const months = Array.from(new Set(sorted.map((r) => r.source_month_label)))
    .sort((a, b) => {
      const pa = parseMonthTable(sorted.find((r) => r.source_month_label === a)?.sourceTable)
      const pb = parseMonthTable(sorted.find((r) => r.source_month_label === b)?.sourceTable)
      const ka = pa ? pa.year * 100 + pa.monthIndex : 0
      const kb = pb ? pb.year * 100 + pb.monthIndex : 0
      return kb - ka
    })

  return {
    id: keyType === IDENTITY_TYPES.NAME ? `name:${key}` : `${keyType}:${key}`,
    name: recommended.combined.full_name || firstUseful(sorted, 'full_name') || 'Unnamed member',
    code: recommended.combined.member_code || firstUseful(sorted, 'member_code') || '',
    phone: recommended.combined.phone_number || firstUseful(sorted, 'phone_number') || '',
    keyType,
    key,
    uncertain: keyType === IDENTITY_TYPES.NAME,
    months,
    monthCount: months.length,
    recordCount: sorted.length,
    latestUpdate: sorted[0]?.updated_at || sorted[0]?.inserted_at || null,
    completeness: recommended.completeness,
    mostComplete,
    recommended,
    provenance: recommended.provenance,
    label: recommended.label,
    conflicts,
    records: sorted.map((record) => ({ ...record, completeness: scoreCompleteness(record) }))
  }
}

export const filterReviewPersons = (persons = [], { filter = REVIEW_FILTERS.ALL, query = '' } = {}) => {
  const q = normalizeReviewName(query)
  const qCode = normalizeReviewCode(query)
  const qPhone = normalizeReviewPhone(query)
  return (Array.isArray(persons) ? persons : []).filter((person) => {
    if (q || qCode || qPhone) {
      const nameHit = q ? normalizeReviewName(person.name).includes(q) : false
      const codeHit = qCode ? normalizeReviewCode(person.code).includes(qCode) : false
      const phoneHit = qPhone ? normalizeReviewPhone(person.phone).includes(qPhone) : false
      if (!nameHit && !codeHit && !phoneHit) return false
    }
    switch (filter) {
      case REVIEW_FILTERS.NEEDS_REVIEW:
        return person.uncertain || person.conflicts.length > 0
      case REVIEW_FILTERS.CONFLICTS:
        return person.conflicts.length > 0
      case REVIEW_FILTERS.INCOMPLETE:
        return person.completeness.percent < 1
      case REVIEW_FILTERS.MULTIPLE_MONTHS:
        return person.monthCount > 1
      default:
        return true
    }
  })
}

export const sortReviewPersons = (persons = [], { sortBy = REVIEW_SORTS.NAME, direction = 'asc' } = {}) => {
  const dir = direction === 'desc' ? -1 : 1
  const list = (Array.isArray(persons) ? persons : []).slice()
  list.sort((a, b) => {
    let diff = 0
    switch (sortBy) {
      case REVIEW_SORTS.COMPLETENESS:
        diff = a.completeness.percent - b.completeness.percent
        if (diff === 0) diff = a.recordCount - b.recordCount
        break
      case REVIEW_SORTS.MONTHS:
        diff = a.monthCount - b.monthCount
        break
      case REVIEW_SORTS.RECENT:
        diff = (new Date(a.latestUpdate || 0).getTime()) - (new Date(b.latestUpdate || 0).getTime())
        break
      default:
        diff = String(a.name || '').localeCompare(String(b.name || ''))
    }
    return diff * dir || String(a.name || '').localeCompare(String(b.name || ''))
  })
  return list
}
