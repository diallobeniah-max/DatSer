// CSV Import Save — builds save plans and executes them using existing
// DatSer RPCs (save_member_bundle, update_member_record_resilient,
// set_member_attendance_from_other_month). Preserves idempotency,
// workspace ownership, member codes, and attendance integrity.

import { executeSupabaseWrite, isTransientSupabaseError } from '../utils/supabaseWrite'
import { CSV_MATCH_STATUS } from '../utils/csvImportMatching'
import { getCsvImportUnresolvedAttentionCount, isCsvImportAttentionUnresolved } from '../utils/csvImportReview'

// ─── Constants ──────────────────────────────────────────────────────────────
export const CSV_SAVE_STATUS = {
  PENDING: 'pending',
  SAVING: 'saving',
  SAVED: 'saved',
  FAILED: 'failed',
  SKIPPED: 'skipped',
  UNRESOLVED: 'unresolved',
}

const MONTHS_IN_YEAR = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
]

const getSundaysForMonth = (monthIndex, yearNum) => {
  const sundays = []
  const date = new Date(yearNum, monthIndex, 1)
  while (date.getMonth() === monthIndex && date.getDay() !== 0) {
    date.setDate(date.getDate() + 1)
  }
  while (date.getMonth() === monthIndex) {
    sundays.push(new Date(date.getFullYear(), date.getMonth(), date.getDate()))
    date.setDate(date.getDate() + 7)
  }
  return sundays
}

const getLocalDateString = (date) => {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

// ─── Resolve effective field value ──────────────────────────────────────────
const resolveFieldValue = (importRow, fieldKey, member) => {
  const resolution = importRow.fieldResolution?.[fieldKey]
  if (resolution === 'datser' && member) {
    const MEMBER_KEYS = {
      fullName: 'Full Name',
      phoneNumber: 'Phone Number',
      age: 'Age',
      gender: 'Gender',
      educationalLevel: 'Current Level',
      parentGuardianName: 'parent_name_1',
      parentGuardianPhone: 'parent_phone_1',
    }
    const memberKey = MEMBER_KEYS[fieldKey]
    const memberVal = member?.[memberKey]
    return memberVal !== undefined && memberVal !== null ? String(memberVal).trim() : ''
  }
  return importRow.edited?.[fieldKey] || ''
}

// ─── Build Sunday date map ──────────────────────────────────────────────────
/**
 * Map sunday_1..sunday_5 to actual dates for the target month.
 *
 * @param {string} targetTable — e.g. "August_2026"
 * @param {Object} enabledSundays — { sunday_1: true, sunday_2: true, ... }
 * @returns {Object} — { sunday_1: Date, sunday_2: Date, ... } (only enabled ones)
 */
export const buildSundayDateMap = (targetTable, enabledSundays = {}) => {
  if (!targetTable) return {}
  const [monthName, yearStr] = targetTable.split('_')
  const monthIndex = MONTHS_IN_YEAR.indexOf(monthName)
  const yearNum = parseInt(yearStr, 10)
  if (monthIndex < 0 || isNaN(yearNum)) return {}

  const sundays = getSundaysForMonth(monthIndex, yearNum)
  const map = {}
  const safeEnabled = enabledSundays && typeof enabledSundays === 'object' ? enabledSundays : {}

  const hasExplicitFlags = ['sunday_1', 'sunday_2', 'sunday_3', 'sunday_4', 'sunday_5'].some(
    (k) => typeof safeEnabled[k] === 'boolean'
  )

  for (let i = 0; i < sundays.length; i += 1) {
    const key = `sunday_${i + 1}`
    const isEnabled = hasExplicitFlags ? safeEnabled[key] === true : safeEnabled[key] !== false
    if (isEnabled) {
      map[key] = sundays[i]
    }
  }

  return map
}

/**
 * Get all Sundays for a given target table.
 */
export const getSundaysForTable = (targetTable) => {
  if (!targetTable) return []
  const [monthName, yearStr] = targetTable.split('_')
  const monthIndex = MONTHS_IN_YEAR.indexOf(monthName)
  const yearNum = parseInt(yearStr, 10)
  if (monthIndex < 0 || isNaN(yearNum)) return []
  return getSundaysForMonth(monthIndex, yearNum)
}

// ─── Build attendance payload ───────────────────────────────────────────────
// Bundle RPCs accept ISO calendar dates as JSON keys, then derive their own
// internal attendance_YYYY_MM_DD column. Keep the CSV import on that public
// contract rather than leaking storage-column names into its payload.
const buildAttendancePayload = (importRow, sundayDateMap) => {
  const payload = {}
  Object.entries(sundayDateMap).forEach(([sundayKey, sundayDate]) => {
    const value = importRow?.edited?.[sundayKey] ?? importRow?.raw?.[sundayKey]
    const normalized = typeof value === 'string' ? value.trim().toUpperCase() : value
    const attendanceDate = getLocalDateString(sundayDate)
    if (normalized === 'PRESENT' || normalized === 'P' || normalized === 'TRUE' || normalized === '1' || normalized === 'YES' || normalized === '✓' || normalized === '✔' || value === true) {
      payload[attendanceDate] = true
    } else if (normalized === 'ABSENT' || normalized === 'A' || normalized === 'FALSE' || normalized === '0' || normalized === 'NO' || normalized === '✗' || normalized === '✘' || normalized === 'X' || value === false) {
      payload[attendanceDate] = false
    }
    // UNSPECIFIED → do not include in payload
  })
  return payload
}

// ─── Build member profile payload ───────────────────────────────────────────
export const buildCsvMemberPayload = (importRow, member, ownerId, workspaceName) => {
  const fullName = resolveFieldValue(importRow, 'fullName', member)
  const phoneNumber = resolveFieldValue(importRow, 'phoneNumber', member)
  const age = resolveFieldValue(importRow, 'age', member)
  const gender = resolveFieldValue(importRow, 'gender', member)
  const educationalLevel = resolveFieldValue(importRow, 'educationalLevel', member)
  const parentGuardianName = resolveFieldValue(importRow, 'parentGuardianName', member)
  const parentGuardianPhone = resolveFieldValue(importRow, 'parentGuardianPhone', member)

  const normalizedGender = gender === 'Male' || gender === 'Female' ? gender : (gender || null)

  return {
    'Full Name': fullName || 'Unnamed',
    'Gender': normalizedGender,
    'Phone Number': phoneNumber || null,
    'Age': age || null,
    'Current Level': educationalLevel || null,
    parent_name_1: parentGuardianName || null,
    parent_phone_1: parentGuardianPhone || null,
    workspace: workspaceName || null,
    user_id: ownerId,
    workspace_owner_id: ownerId,
  }
}

// ─── Build save plan ────────────────────────────────────────────────────────
/**
 * Build a save plan from canonical import rows.
 *
 * @param {Object} params
 * @param {Array} params.importRows — All canonical import rows
 * @param {string} params.targetTable — Target month table name
 * @param {Object} params.sundayDateMap — Mapped sunday dates
 * @param {string} params.ownerId — Workspace owner ID
 * @param {string} params.workspaceName — Workspace name
 * @param {Object} params.completedRowIds — Set of already-completed row IDs
 * @returns {Array} — Plan steps
 */
export const buildCsvSavePlan = ({
  importRows,
  targetTable,
  sundayDateMap,
  ownerId,
  workspaceName,
  completedRowIds = new Set(),
  allowSafeNew = false,
  processRemaining = false,
}) => {
  const plan = []

  importRows.forEach((row) => {
    // Skip already-completed rows (idempotency)
    if (completedRowIds.has(row.importRowId)) {
      plan.push({
        importRowId: row.importRowId,
        action: 'skip',
        reason: 'Already completed',
        row,
      })
      return
    }

    if (!processRemaining && isCsvImportAttentionUnresolved(row)) {
      plan.push({
        importRowId: row.importRowId,
        action: 'unresolved',
        reason: 'Transcription note needs explicit verification',
        row,
      })
      return
    }

    const { match, edited } = row
    const matchStatus = match?.status
    const usableName = String(edited?.fullName || row.raw?.fullName || row.fullName || match?.matchedMember?.['Full Name'] || (matchStatus === 'exact' ? 'Member' : '')).trim()

    // Skip invalid rows (missing name)
    if (!usableName || matchStatus === CSV_MATCH_STATUS.INVALID || row.duplicateOfRowId || row.identityConflict) {
      plan.push({
        importRowId: row.importRowId,
        action: 'skip',
        reason: !usableName ? 'Invalid row (missing name)' : 'Duplicate or invalid row',
        row,
      })
      return
    }

    const attendancePayload = buildAttendancePayload(row, sundayDateMap)
    const matchedMember = match?.matchedMember || null
    const existingCreatedMemberId = row.bulkCreate?.memberId || row.createdMemberId || row.memberId || null
    const existingMatchedMemberId = match?.selectedMemberId || matchedMember?.id || null
    const effectiveMemberId = existingCreatedMemberId || existingMatchedMemberId

    if (effectiveMemberId || matchStatus === CSV_MATCH_STATUS.EXACT || (matchStatus === CSV_MATCH_STATUS.POSSIBLE && match.selectedMemberId)) {
      // Existing member (either matched from database or created in a previous run) — apply profile updates & attendance
      const memberId = effectiveMemberId
      if (!memberId) {
        plan.push({
          importRowId: row.importRowId,
          action: 'skip',
          reason: 'Matched row is missing its selected DatSer member',
          row,
        })
        return
      }
      const memberPayload = buildCsvMemberPayload(row, matchedMember, ownerId, workspaceName)

      // Check if member needs cross-month registration
      const memberSourceTable = matchedMember?.__source_table || matchedMember?.source_table || ''
      const needsCrossMonth = memberSourceTable && memberSourceTable !== targetTable

      // Check which profile fields actually changed from DatSer values
      const profileUpdates = {}
      if (matchedMember) {
        const FIELD_MEMBER_MAP = {
          fullName: 'Full Name',
          phoneNumber: 'Phone Number',
          age: 'Age',
          gender: 'Gender',
          educationalLevel: 'Current Level',
          parentGuardianName: 'parent_name_1',
          parentGuardianPhone: 'parent_phone_1',
        }
        Object.entries(FIELD_MEMBER_MAP).forEach(([csvField, memberKey]) => {
          const resolution = row.fieldResolution?.[csvField]
          if (resolution === 'csv') {
            const csvVal = String(edited[csvField] || '').trim()
            const memberVal = String(matchedMember[memberKey] || '').trim()
            if (csvVal && csvVal.toLowerCase() !== memberVal.toLowerCase()) {
              profileUpdates[memberKey] = csvVal
            }
          }
        })
      } else if (existingCreatedMemberId) {
        // Apply extracted profile fields directly to previously created member
        const FIELD_MEMBER_MAP = {
          fullName: 'Full Name',
          phoneNumber: 'Phone Number',
          age: 'Age',
          gender: 'Gender',
          educationalLevel: 'Current Level',
          parentGuardianName: 'parent_name_1',
          parentGuardianPhone: 'parent_phone_1',
        }
        Object.entries(FIELD_MEMBER_MAP).forEach(([csvField, memberKey]) => {
          const val = String(edited[csvField] || '').trim()
          if (val) profileUpdates[memberKey] = val
        })
      }

      if (!needsCrossMonth && Object.keys(profileUpdates).length === 0 && Object.keys(attendancePayload).length === 0) {
        plan.push({
          importRowId: row.importRowId,
          action: 'skip',
          reason: 'Already current — no profile or attendance changes selected',
          row,
        })
        return
      }

      if (needsCrossMonth && Object.keys(attendancePayload).length === 0) {
        plan.push({
          importRowId: row.importRowId,
          action: 'skip',
          reason: 'Historical member has no selected Present or Absent Sunday to carry into the target month',
          row,
        })
        return
      }

      plan.push({
        importRowId: row.importRowId,
        action: needsCrossMonth ? 'cross_month' : 'update',
        memberId,
        memberPayload,
        profileUpdates,
        attendancePayload,
        sourceTable: memberSourceTable,
        row,
      })
    } else if (processRemaining || allowSafeNew || (matchStatus === CSV_MATCH_STATUS.NEW && (row.newMemberConfirmed || row.allowNamesOnlyCreate))) {
      if (matchStatus === CSV_MATCH_STATUS.POSSIBLE && !match.selectedMemberId && !processRemaining) {
        plan.push({
          importRowId: row.importRowId,
          action: 'skip',
          reason: 'Unresolved possible match — operator decision needed',
          row,
        })
        return
      }
      // Create new member as entered (unmatched, new, or unselected Possible matches in processRemaining mode)
      const memberPayload = buildCsvMemberPayload(row, null, ownerId, workspaceName)
      plan.push({
        importRowId: row.importRowId,
        action: 'create',
        memberPayload,
        attendancePayload,
        row,
      })
    } else if (matchStatus === CSV_MATCH_STATUS.POSSIBLE && !match.selectedMemberId) {
      plan.push({
        importRowId: row.importRowId,
        action: 'skip',
        reason: 'Unresolved possible match — operator decision needed',
        row,
      })
    } else {
      plan.push({
        importRowId: row.importRowId,
        action: 'unresolved',
        reason: 'New member needs explicit operator confirmation',
        row,
      })
    }
  })

  return plan
}

const isPresentValue = (value) => value === true || String(value || '').trim().toLowerCase() === 'present'

export const isMemberPresentOnDate = (member, isoDate, attendanceByMember = {}) => {
  if (!member || !isoDate) return false
  const column = `attendance_${isoDate.replace(/-/g, '_')}`
  const memberAttendance = attendanceByMember[String(member.id)] || attendanceByMember[member.id] || {}
  return [member[isoDate], member[column], member.attendance?.[isoDate], member.attendanceData?.[isoDate], memberAttendance[isoDate], memberAttendance[column]].some(isPresentValue)
}

export const buildSundayNamesSavePlan = ({
  importRows,
  targetTable,
  selectedSundayDate,
  ownerId,
  workspaceName,
  completedRowIds = new Set(),
  attendanceByMember = {},
  allowSafeNew = false,
  processRemaining = false,
}) => {
  const validSundayDates = getSundaysForTable(targetTable).map(getLocalDateString)
  if (!targetTable || !selectedSundayDate || !validSundayDates.includes(selectedSundayDate)) {
    throw new Error('Select exactly one Sunday in the target month before saving')
  }

  const claimedMemberDates = new Set()
  return importRows.map((row) => {
    const base = { importRowId: row.importRowId, row }
    if (completedRowIds.has(row.importRowId)) return { ...base, action: 'skip', reason: 'Already completed' }
    if (!processRemaining && isCsvImportAttentionUnresolved(row)) return { ...base, action: 'unresolved', reason: 'Transcription note needs explicit verification' }
    if (row.duplicateOfRowId) return { ...base, action: 'skip', reason: 'Duplicate name in source list' }

    const usableName = String(row.edited?.fullName || row.raw?.fullName || row.fullName || row.match?.matchedMember?.['Full Name'] || (row.match?.status === 'exact' ? 'Member' : '')).trim()
    if (!usableName || row.match?.status === 'invalid') return { ...base, action: 'skip', reason: 'Invalid row (missing name)' }

    const match = row.match || {}
    const resolved = match.status === CSV_MATCH_STATUS.EXACT || (match.status === CSV_MATCH_STATUS.POSSIBLE && match.selectedMemberId)

    if (resolved) {
      const member = match.matchedMember || match.candidates?.find((candidate) => String(candidate.id) === String(match.selectedMemberId))
      const memberId = String(match.selectedMemberId || member?.id || '')
      if (!memberId) return { ...base, action: 'unresolved', reason: 'Choose the correct DatSer member' }
      const memberDateKey = `${memberId}::${selectedSundayDate}`
      if (claimedMemberDates.has(memberDateKey)) return { ...base, action: 'skip', reason: 'Duplicate member for this Sunday' }
      claimedMemberDates.add(memberDateKey)
      if (isMemberPresentOnDate(member, selectedSundayDate, attendanceByMember)) return { ...base, action: 'skip', reason: 'Already Present' }

      const sourceTable = member?.__source_table || member?.source_table || ''
      return {
        ...base,
        action: sourceTable && sourceTable !== targetTable ? 'cross_month' : 'update',
        memberId,
        memberPayload: {},
        profileUpdates: {},
        attendancePayload: { [selectedSundayDate]: true },
        sourceTable,
      }
    }

    if (processRemaining || allowSafeNew || (match.status === CSV_MATCH_STATUS.NEW && (row.allowNamesOnlyCreate || row.newMemberConfirmed))) {
      if (match.status === CSV_MATCH_STATUS.POSSIBLE && !match.selectedMemberId && !processRemaining) {
        return { ...base, action: 'unresolved', reason: 'Choose the correct DatSer member' }
      }
      return {
        ...base,
        action: 'create',
        memberPayload: buildCsvMemberPayload(row, null, ownerId, workspaceName),
        attendancePayload: { [selectedSundayDate]: true },
      }
    }

    return { ...base, action: 'unresolved', reason: match.status === CSV_MATCH_STATUS.POSSIBLE ? 'Choose the correct DatSer member' : 'Member not found in DatSer' }
  })
}

// ─── Execute save plan ──────────────────────────────────────────────────────
/**
 * Execute the CSV import save plan.
 *
 * @param {Object} params
 * @param {Array} params.plan — Save plan from buildCsvSavePlan
 * @param {string} params.targetTable — Target month table
 * @param {string} params.ownerId — Workspace owner ID
 * @param {string} params.sessionId — Import session ID
 * @param {Object} params.supabase — Supabase client
 * @param {Function} params.onProgress — Progress callback (completedCount, totalCount, rowResult)
 * @param {Function} params.ensureMemberCodeAssignment — Member code assignment function
 * @param {Function} params.setMemberAttendanceFromOtherMonth — Cross-month import function
 * @param {Function} params.forceRefreshMembers — Refresh members after save
 * @returns {Object} — { results, successCount, failCount, skipCount }
 */
export const executeCsvSavePlan = async ({
  plan,
  targetTable,
  ownerId,
  sessionId,
  supabase,
  onProgress,
  ensureMemberCodeAssignment,
  setMemberAttendanceFromOtherMonth,
  forceRefreshMembers,
}) => {
  const results = []
  let successCount = 0
  let failCount = 0
  let skipCount = 0
  let unresolvedCount = 0
  const totalRows = plan.length

  for (let i = 0; i < plan.length; i += 1) {
    const step = plan[i]

    if (step.action === 'skip') {
      results.push({
        importRowId: step.importRowId,
        status: CSV_SAVE_STATUS.SKIPPED,
        reason: step.reason,
      })
      skipCount += 1
      if (onProgress) onProgress(results.length, totalRows, results[results.length - 1])
      continue
    }

    if (step.action === 'unresolved') {
      results.push({ importRowId: step.importRowId, status: CSV_SAVE_STATUS.UNRESOLVED, reason: step.reason })
      unresolvedCount += 1
      if (onProgress) onProgress(results.length, totalRows, results[results.length - 1])
      continue
    }

    try {
      if (step.action === 'create') {
        // The normal member form uses the authenticated workspace-resolving
        // wrapper. The raw bundle RPC is intentionally not browser-callable.
        const requestId = step.row?.needsReprocess
          ? `csv_create_repair_${sessionId}_${step.importRowId}_v${step.row?.reprocessAttempt || 2}`
          : `csv_import_${sessionId}_${step.importRowId}_${Date.now()}`

        const { data: bundleResult } = await executeSupabaseWrite(
          () => supabase.rpc('save_member_bundle_resilient', {
            p_table_name: targetTable,
            p_owner_id: ownerId,
            p_request_id: requestId,
            p_member: step.memberPayload,
            p_badges: [],
            p_tag_ids: [],
            p_attendance: step.attendancePayload,
          }),
          { action: `CSV Import: Create member in ${targetTable}` }
        )

        if (!bundleResult?.success) {
          throw new Error(bundleResult?.error_message || 'Member creation failed')
        }

        // Assign member code
        const savedMemberId = bundleResult?.member_id
        if (savedMemberId && ensureMemberCodeAssignment) {
          try {
            await ensureMemberCodeAssignment({ id: savedMemberId, 'Full Name': step.memberPayload['Full Name'] })
          } catch (_codeErr) {
            // Code assignment failure is non-fatal; row is still saved
          }
        }

        results.push({
          importRowId: step.importRowId,
          status: CSV_SAVE_STATUS.SAVED,
          memberId: savedMemberId,
          action: 'created',
          createdAt: new Date().toISOString(),
        })
        successCount += 1

      } else if (step.action === 'cross_month') {
        // The logical-month attendance path consumes the same ISO date keys
        // used by the bundle RPCs, creates the target attendance columns, and
        // carries the canonical member identity safely.
        const attendanceEntries = Object.entries(step.attendancePayload)
        if (!setMemberAttendanceFromOtherMonth || attendanceEntries.length === 0) {
          throw new Error('A historical member needs at least one selected Present or Absent Sunday to carry into the target month')
        }

        for (const [attendanceDate, isPresent] of attendanceEntries) {
          if (!/^\d{4}-\d{2}-\d{2}$/.test(attendanceDate)) {
            throw new Error(`Invalid CSV attendance date: ${attendanceDate}`)
          }
          if (typeof isPresent !== 'boolean') {
            throw new Error(`Invalid CSV attendance value for ${attendanceDate}`)
          }
          const result = await setMemberAttendanceFromOtherMonth({
            memberId: step.memberId,
            sourceTable: step.sourceTable,
            targetTable,
            attendanceDate,
            attendanceStatus: isPresent ? 'Present' : 'Absent',
          })
          if (!result?.success) throw new Error(result?.error_message || 'Cross-month registration failed')
        }

        // Once registration succeeds, apply only explicitly approved profile
        // fields through the production resilient bundle contract.
        if (Object.keys(step.profileUpdates || {}).length > 0) {
          const profileRequestId = step.row?.needsReprocess
            ? `csv_profile_repair_${sessionId}_${step.importRowId}_v${step.row?.reprocessAttempt || 2}`
            : `csv_import_${sessionId}_${step.importRowId}_profile_${Date.now()}`

          const { data: bundleResult } = await executeSupabaseWrite(
            () => supabase.rpc('update_member_bundle_resilient', {
              p_table_name: targetTable,
              p_owner_id: ownerId,
              p_member_id: step.memberId,
              p_request_id: profileRequestId,
              p_updates: step.profileUpdates,
              p_badges: null,
              p_tag_ids: null,
              p_attendance: {},
              p_identity: { source: 'csv_import', session: sessionId },
            }),
            { action: 'CSV Import: Update historical member profile' }
          )
          if (!bundleResult?.success) throw new Error(bundleResult?.error_message || 'Profile update failed')
        }

        results.push({
          importRowId: step.importRowId,
          status: CSV_SAVE_STATUS.SAVED,
          memberId: step.memberId,
          action: 'cross_month',
        })
        successCount += 1

      } else if (step.action === 'update') {
        // This is the same contract as the production edit form: approved
        // profile fields and attendance are deliberately separate payloads.
        if (Object.keys(step.profileUpdates || {}).length > 0 || Object.keys(step.attendancePayload || {}).length > 0) {
          const requestId = step.row?.needsReprocess
            ? `csv_update_repair_${sessionId}_${step.importRowId}_v${step.row?.reprocessAttempt || 2}`
            : `csv_import_${sessionId}_${step.importRowId}_${Date.now()}`

          const { data: bundleResult } = await executeSupabaseWrite(
            () => supabase.rpc('update_member_bundle_resilient', {
              p_table_name: targetTable,
              p_owner_id: ownerId,
              p_member_id: step.memberId,
              p_request_id: requestId,
              p_updates: step.profileUpdates || {},
              p_badges: null,
              p_tag_ids: null,
              p_attendance: step.attendancePayload || {},
              p_identity: { source: 'csv_import', session: sessionId },
            }),
            { action: 'CSV Import: Save existing member' }
          )
          if (!bundleResult?.success) throw new Error(bundleResult?.error_message || 'Existing member save failed')
        }

        results.push({
          importRowId: step.importRowId,
          status: CSV_SAVE_STATUS.SAVED,
          memberId: step.memberId,
          action: 'updated',
        })
        successCount += 1
      }
    } catch (error) {
      results.push({
        importRowId: step.importRowId,
        status: CSV_SAVE_STATUS.FAILED,
        error: error?.message || 'Unknown error',
        isRetryable: isTransientSupabaseError(error),
      })
      failCount += 1
    }

    // Report progress
    if (onProgress) {
      onProgress(results.length, totalRows, results[results.length - 1])
    }
  }

  // Refresh members after save
  if (successCount > 0 && forceRefreshMembers) {
    try {
      await forceRefreshMembers()
    } catch (_refreshErr) {
      // Non-fatal
    }
  }

  return { results, successCount, failCount, skipCount, unresolvedCount }
}

// ─── Preview summary ────────────────────────────────────────────────────────
/**
 * Build a preview summary of what will happen when the save plan executes.
 */
export const buildCsvPreviewSummary = ({
  importRows,
  sundayDateMap,
  targetTable,
}) => {
  const exactCount = importRows.filter((r) => r.match?.status === CSV_MATCH_STATUS.EXACT).length
  const possibleResolvedCount = importRows.filter((r) => r.match?.status === CSV_MATCH_STATUS.POSSIBLE && r.match?.selectedMemberId).length
  const possibleUnresolvedCount = importRows.filter((r) => r.match?.status === CSV_MATCH_STATUS.POSSIBLE && !r.match?.selectedMemberId).length
  const newCount = importRows.filter((r) => r.match?.status === CSV_MATCH_STATUS.NEW).length
  const invalidCount = importRows.filter((r) => r.match?.status === CSV_MATCH_STATUS.INVALID).length
  const savedCount = importRows.filter((r) => r.saveStatus === 'saved').length
  const attentionCount = getCsvImportUnresolvedAttentionCount(importRows)

  // Count profile updates (where field resolution differs from datser)
  let profileUpdateCount = 0
  importRows.forEach((row) => {
    if (row.match?.status === CSV_MATCH_STATUS.EXACT || (row.match?.status === CSV_MATCH_STATUS.POSSIBLE && row.match?.selectedMemberId)) {
      const hasCsvOverride = Object.values(row.fieldResolution || {}).some((v) => v === 'csv')
      if (hasCsvOverride) profileUpdateCount += 1
    }
  })

  // Sunday attendance counts
  const sundayStats = {}
  Object.entries(sundayDateMap).forEach(([key, date]) => {
    let present = 0
    let absent = 0
    let unspecified = 0
    importRows.forEach((row) => {
      if (row.match?.status === CSV_MATCH_STATUS.INVALID) return
      const val = row.edited[key]
      if (val === 'PRESENT') present += 1
      else if (val === 'ABSENT') absent += 1
      else unspecified += 1
    })
    sundayStats[key] = {
      date: getLocalDateString(date),
      label: date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
      present,
      absent,
      unspecified,
    }
  })

  // Sheet breakdown
  const sheets = new Set(importRows.map((r) => r.sheet))

  return {
    totalRows: importRows.length,
    sheets: [...sheets],
    sheetCount: sheets.size,
    exactCount,
    possibleResolvedCount,
    possibleUnresolvedCount,
    newCount,
    invalidCount,
    savedCount,
    profileUpdateCount,
    targetTable,
    sundayStats,
    actionableCount: importRows.filter((row) => !isCsvImportAttentionUnresolved(row) && (
      row.match?.status === CSV_MATCH_STATUS.EXACT
      || (row.match?.status === CSV_MATCH_STATUS.POSSIBLE && row.match?.selectedMemberId)
      || row.match?.status === CSV_MATCH_STATUS.NEW
    )).length,
    unresolvedCount: possibleUnresolvedCount,
    attentionCount,
  }
}
