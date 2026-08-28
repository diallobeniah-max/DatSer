// CSV Import Matching — reconciles parsed CSV rows against existing DatSer members.
// Uses existing memberSearch utilities for name/phone/code matching.

import {
  normalizeSearchText,
  normalizePhoneForSearch,
  getPhoneVariants,
  getSearchableMemberName,
  getSearchablePhones,
  classifyMemberSearch
} from './memberSearch'

// ─── Match status constants ─────────────────────────────────────────────────
export const CSV_MATCH_STATUS = {
  EXACT: 'exact',
  POSSIBLE: 'possible',
  NEW: 'new',
  INVALID: 'invalid',
  PENDING: 'pending',
  UNMATCHED: 'unmatched',
}

// ─── Name similarity scoring ────────────────────────────────────────────────
const editDistance = (left, right) => {
  if (!left) return right?.length || 0
  if (!right) return left.length
  const previous = Array.from({ length: right.length + 1 }, (_, i) => i)
  const current = new Array(right.length + 1)
  for (let row = 1; row <= left.length; row += 1) {
    current[0] = row
    for (let col = 1; col <= right.length; col += 1) {
      current[col] = Math.min(
        current[col - 1] + 1,
        previous[col] + 1,
        previous[col - 1] + (left[row - 1] === right[col - 1] ? 0 : 1)
      )
    }
    for (let col = 0; col <= right.length; col += 1) previous[col] = current[col]
  }
  return previous[right.length]
}

const normalizedNameTokens = (name) =>
  normalizeSearchText(name).split(' ').filter(Boolean)

const nameTokenOverlap = (nameA, nameB) => {
  const tokensA = normalizedNameTokens(nameA)
  const tokensB = normalizedNameTokens(nameB)
  if (tokensA.length === 0 || tokensB.length === 0) return 0
  let matches = 0
  tokensA.forEach((tokenA) => {
    if (tokensB.some((tokenB) => tokenB === tokenA || (tokenA.length >= 3 && tokenB.includes(tokenA)) || (tokenB.length >= 3 && tokenA.includes(tokenB)))) {
      matches += 1
    }
  })
  return matches / Math.max(tokensA.length, tokensB.length)
}

// ─── Phone matching ─────────────────────────────────────────────────────────
const phoneMatchesAny = (csvPhone, member) => {
  if (!csvPhone) return false
  const csvVariants = getPhoneVariants(csvPhone)
  if (csvVariants.length === 0) return false
  const memberPhones = getSearchablePhones(member)
  return memberPhones.some(({ variants }) =>
    csvVariants.some((v) => variants.includes(v))
  )
}

// ─── Code matching ──────────────────────────────────────────────────────────
const codeMatches = (csvCode, member) => {
  if (!csvCode) return false
  const memberCode = String(member.member_code || member.memberCode || member.code || '').toUpperCase().replace(/[^A-Z0-9]/g, '')
  const normalized = String(csvCode).toUpperCase().replace(/[^A-Z0-9]/g, '')
  return normalized.length >= 2 && normalized === memberCode
}

// ─── Single-row matching ────────────────────────────────────────────────────
/**
 * Match a single CSV import row against a list of existing DatSer members.
 *
 * @param {Object} importRow — Canonical import row from parser
 * @param {Array} allMembers — All available DatSer members (across historical months)
 * @param {Object} options — { codeLength }
 * @returns {{ status, selectedMemberId, candidates, matchedMember }}
 */
export const matchImportRow = (importRow, allMembers, options = {}) => {
  const { edited } = importRow
  const csvName = edited.fullName || ''
  const csvPhone = edited.phoneNumber || ''
  const csvCode = edited.memberCode || ''

  // Invalid: no usable name
  if (!csvName.trim()) {
    return {
      status: CSV_MATCH_STATUS.INVALID,
      selectedMemberId: null,
      candidates: [],
      matchedMember: null,
    }
  }

  // 1) Try exact member code match first (most trustworthy)
  if (csvCode) {
    const codeMatchesFound = allMembers.filter((m) => codeMatches(csvCode, m))
    if (codeMatchesFound.length === 1) {
      return {
        status: CSV_MATCH_STATUS.EXACT,
        selectedMemberId: String(codeMatchesFound[0].id),
        candidates: codeMatchesFound,
        matchedMember: codeMatchesFound[0],
      }
    }
    if (codeMatchesFound.length > 1) return { status: CSV_MATCH_STATUS.POSSIBLE, selectedMemberId: null, candidates: codeMatchesFound.slice(0, 10), matchedMember: null }
  }

  // 2) Try unique phone match
  if (csvPhone && normalizePhoneForSearch(csvPhone).length >= 9) {
    const phoneMatches = allMembers.filter((m) => phoneMatchesAny(csvPhone, m))
    if (phoneMatches.length === 1) {
      return {
        status: CSV_MATCH_STATUS.EXACT,
        selectedMemberId: String(phoneMatches[0].id),
        candidates: phoneMatches,
        matchedMember: phoneMatches[0],
      }
    }
    if (phoneMatches.length > 1) {
      // Multiple phone matches — operator must decide
      return {
        status: CSV_MATCH_STATUS.POSSIBLE,
        selectedMemberId: null,
        candidates: phoneMatches.slice(0, 10),
        matchedMember: null,
      }
    }
  }

  // 3) Name-based matching
  const normalizedCsvName = normalizeSearchText(csvName)
  if (!normalizedCsvName) {
    return { status: options.mode === 'sunday_names' ? CSV_MATCH_STATUS.UNMATCHED : CSV_MATCH_STATUS.NEW, selectedMemberId: null, candidates: [], matchedMember: null }
  }

  // Exact name match
  const exactNameMatches = allMembers.filter((m) => {
    const memberName = normalizeSearchText(getSearchableMemberName(m))
    return memberName === normalizedCsvName
  })

  if (exactNameMatches.length === 1) {
    return {
      status: CSV_MATCH_STATUS.EXACT,
      selectedMemberId: String(exactNameMatches[0].id),
      candidates: exactNameMatches,
      matchedMember: exactNameMatches[0],
    }
  }

  if (exactNameMatches.length > 1) {
    return {
      status: CSV_MATCH_STATUS.POSSIBLE,
      selectedMemberId: null,
      candidates: exactNameMatches.slice(0, 10),
      matchedMember: null,
    }
  }

  // Fuzzy name matching — token overlap + edit distance
  const fuzzyMatches = []
  allMembers.forEach((m) => {
    const memberName = getSearchableMemberName(m)
    const overlap = nameTokenOverlap(csvName, memberName)
    if (overlap >= 0.5) {
      fuzzyMatches.push({ member: m, overlap })
    } else {
      // Try edit distance for very short names
      const normalizedMemberName = normalizeSearchText(memberName)
      if (normalizedCsvName.length >= 4 && normalizedMemberName.length >= 4) {
        const dist = editDistance(normalizedCsvName, normalizedMemberName)
        const maxLen = Math.max(normalizedCsvName.length, normalizedMemberName.length)
        if (dist <= Math.ceil(maxLen * 0.25)) {
          fuzzyMatches.push({ member: m, overlap: 1 - (dist / maxLen) })
        }
      }
    }
  })

  if (fuzzyMatches.length > 0) {
    fuzzyMatches.sort((a, b) => b.overlap - a.overlap)
    return {
      status: CSV_MATCH_STATUS.POSSIBLE,
      selectedMemberId: null,
      candidates: fuzzyMatches.slice(0, 10).map((f) => f.member),
      matchedMember: null,
    }
  }

  // No match found — new member
  return {
    status: options.mode === 'sunday_names' ? CSV_MATCH_STATUS.UNMATCHED : CSV_MATCH_STATUS.NEW,
    selectedMemberId: null,
    candidates: [],
    matchedMember: null,
  }
}

// ─── Batch matching ─────────────────────────────────────────────────────────
/**
 * Match all parsed CSV rows against existing DatSer members.
 * Runs client-side only — no database calls.
 *
 * @param {Array} importRows — Array of canonical import rows
 * @param {Array} allMembers — Combined members from current + historical months
 * @param {Object} options
 * @returns {Array} — Same rows array with updated .match property
 */
export const matchAllImportRows = (importRows, allMembers, options = {}) => {
  const firstSourceRowByName = new Map()
  return importRows.map((row) => {
    const mode = options.mode || row.mode
    const matchResult = matchImportRow(row, allMembers, { ...options, mode })
    const normalizedSourceName = normalizeSearchText(row.rawFullName || row.raw?.full_name || row.edited?.fullName)
    const duplicateOfRowId = mode === 'sunday_names' && normalizedSourceName && firstSourceRowByName.has(normalizedSourceName)
      ? firstSourceRowByName.get(normalizedSourceName)
      : null
    if (mode === 'sunday_names' && normalizedSourceName && !duplicateOfRowId) firstSourceRowByName.set(normalizedSourceName, row.importRowId)
    return {
      ...row,
      match: matchResult,
      duplicateOfRowId,
      // For exact matches, default field resolution to DatSer values
      fieldResolution: matchResult.status === CSV_MATCH_STATUS.EXACT
        ? {
            fullName: 'datser',
            phoneNumber: 'datser',
            age: 'datser',
            gender: 'datser',
            educationalLevel: 'datser',
            parentGuardianName: 'datser',
            parentGuardianPhone: 'datser',
          }
        : row.fieldResolution,
    }
  })
}

// ─── Manual search wrapper ──────────────────────────────────────────────────
/**
 * Search DatSer members for manual match selection.
 * Uses existing classifyMemberSearch from memberSearch.js.
 */
export const searchDatSerMembers = (query, members, options = {}) => {
  return classifyMemberSearch({
    members,
    remoteMembers: [],
    deletedMembers: [],
    query,
    getCode: (m) => m?.member_code || m?.memberCode || m?.code || '',
    getCodeAliases: () => [],
    codeLength: options.codeLength || 3,
  })
}

// ─── Field comparison ───────────────────────────────────────────────────────
const COMPARE_FIELD_MAP = {
  fullName: { memberKey: 'Full Name', label: 'Full Name' },
  phoneNumber: { memberKey: 'Phone Number', label: 'Phone' },
  age: { memberKey: 'Age', label: 'Age' },
  gender: { memberKey: 'Gender', label: 'Gender' },
  educationalLevel: { memberKey: 'Current Level', label: 'Education Level' },
  parentGuardianName: { memberKey: 'parent_name_1', label: 'Guardian Name' },
  parentGuardianPhone: { memberKey: 'parent_phone_1', label: 'Guardian Phone' },
}

/**
 * Compare CSV edited fields to a matched DatSer member.
 * Returns an object of field comparisons.
 */
export const compareFieldsToMember = (importRow, member) => {
  if (!member) return {}

  const comparisons = {}
  Object.entries(COMPARE_FIELD_MAP).forEach(([csvField, { memberKey, label }]) => {
    const csvValue = String(importRow.edited[csvField] || '').trim()
    const memberValue = String(member[memberKey] || '').trim()

    const normalizedCsv = csvValue.toLowerCase()
    const normalizedMember = memberValue.toLowerCase()

    comparisons[csvField] = {
      label,
      csvValue,
      memberValue,
      isDifferent: normalizedCsv !== normalizedMember && csvValue !== '' && memberValue !== '',
      csvEmpty: csvValue === '',
      memberEmpty: memberValue === '',
    }
  })

  return comparisons
}
