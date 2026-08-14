// Paper Scan — Final Save to DatSer.
//
// One controlled pass over the Compare & Correct state that writes ONLY what
// the reviewer explicitly approved:
//   - existing members get exactly the fields that carry an explicit
//     reviewedValues decision whose value differs from what DatSer holds
//     (a Gemini original can never silently overwrite a reviewed value);
//   - a row marked "Add as New Member" is created only in the chosen month
//     table, or in every already-existing month table of that year, and never
//     creates a missing month table;
//   - attendance writes are only explicit Present/Absent decisions on the
//     selected month's actually-mapped Sunday date keys; Needs Review /
//     unresolved decisions are skipped and never written;
//   - a likely duplicate found at save time blocks creation until the user
//     confirms.
//
// The write side uses the durable operation RPCs from the
// `20260813170000_harden_paper_scan_final_save` migration. The client saves an
// immutable operation before any mutation, then executes server-persisted step
// ids; it never submits a physical table or attendance-column identifier.

import {
  COMPARE_FIELDS,
  MATCH_STATUSES,
  compareRowToMember,
  fieldNeedsDecision,
  getFieldDecision,
  getExistingValue,
  matchGeminiRowToMember,
  namesEquivalent,
  normalizeGenderForCompare,
  normalizeLevelForCompare,
  phonesEquivalent
} from '../utils/paperScanCompare'
import {
  ATTENDANCE_STATUS,
  monthKeyFromTableName,
  monthTablesInYear,
  parseMonthKey,
  resolveAttendanceEntries
} from '../utils/paperScanAttendance'
import { buildMemberIdentityHint, getMemberSourceTable } from '../utils/memberIdentity'
import { executeSupabaseWrite } from '../utils/supabaseWrite'

export const FINAL_SAVE_STATUS = {
  SAVED: 'saved',
  CREATED: 'created',
  FAILED: 'failed',
  BLOCKED_DUPLICATE: 'blocked-duplicate',
  SKIPPED: 'skipped'
}

const EMPTY_ATTENDANCE_SETTINGS = { month: '', convention: '', columnCount: 0 }

const asTrimmed = (value) => String(value ?? '').trim()

const fieldValuesEquivalent = (field, left, right) => {
  const a = asTrimmed(left)
  const b = asTrimmed(right)
  if (field === 'phone_number') return phonesEquivalent(a, b)
  if (field === 'gender') return normalizeGenderForCompare(a) === normalizeGenderForCompare(b)
  if (field === 'current_level') return normalizeLevelForCompare(a) === normalizeLevelForCompare(b)
  return namesEquivalent(a, b)
}

// The member-table name for a 'YYYY-MM' key, or '' when the month table does
// not exist yet. Missing tables are NEVER created by the final save.
export const monthTableForKey = (monthlyTables, monthKey) => {
  if (!monthKey) return ''
  const tables = Array.isArray(monthlyTables) ? monthlyTables : []
  return tables.find((table) => monthKeyFromTableName(table) === monthKey) || ''
}

const monthYearFromKey = (monthKey) => {
  const { year } = parseMonthKey(monthKey)
  return year || null
}

const makeLocalUuid = () => {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (char) => {
    const value = Math.floor(Math.random() * 16)
    return (char === 'x' ? value : (value & 0x3) | 0x8).toString(16)
  })
}

// Same month-table column format the rest of DatSer creates members with.
export const buildMemberInsertRow = (profile, { id = null, userId = null, workspaceName = null } = {}) => {
  const profileSafe = profile || {}
  const gender = asTrimmed(profileSafe.gender).toLowerCase()
  return {
    ...(id ? { id } : {}),
    'Full Name': asTrimmed(profileSafe.full_name),
    'Gender': gender === 'male' ? 'Male' : gender === 'female' ? 'Female' : asTrimmed(profileSafe.gender),
    'Phone Number': asTrimmed(profileSafe.phone_number) || null,
    'Age': asTrimmed(profileSafe.age) || null,
    'date_of_birth': asTrimmed(profileSafe.date_of_birth) || null,
    'Current Level': asTrimmed(profileSafe.current_level),
    workspace: workspaceName || null,
    parent_name_1: asTrimmed(profileSafe.parent_name_1) || null,
    parent_phone_1: asTrimmed(profileSafe.parent_phone_1) || null,
    parent_name_2: asTrimmed(profileSafe.parent_name_2) || null,
    parent_phone_2: asTrimmed(profileSafe.parent_phone_2) || null,
    notes: asTrimmed(profileSafe.notes) || null,
    is_visitor: Boolean(profileSafe.is_visitor),
    user_id: userId || null,
    inserted_at: new Date().toISOString()
  }
}

const isCreateNewRow = (row) => row?.memberAction === 'create-new'

const isChosenMemberRow = (row) => Boolean(row?.selectedMemberId)

// Same override semantics as PaperScanReview's computeRowMatch: an explicit
// create-new / choose-different decision wins over the automatic match.
export const resolvePlanMatch = (row, members) => {
  if (isCreateNewRow(row)) return { status: MATCH_STATUSES.NONE, member: null, query: '' }
  if (isChosenMemberRow(row)) {
    const selected = (Array.isArray(members) ? members : []).find((member) => String(member.id) === String(row.selectedMemberId))
    if (selected) return { status: MATCH_STATUSES.MATCHED, member: selected, query: '' }
  }
  return matchGeminiRowToMember(row, members)
}

// A brand-new member is even stricter than an existing-member update: only
// explicit reviewer decisions may become its profile. Gemini extraction is a
// review aid, never an implicit create payload.
export const effectiveNewMemberProfile = (row) => {
  const built = {}
  for (const { key } of COMPARE_FIELDS) {
    const decision = row?.reviewedValues?.[key]
    if (decision) built[key] = decision.value
  }
  return built
}

// Attendance items that may be written: explicit Present/Absent decisions on a
// dateKey that is one of the sheet's actually-mapped Sundays for its month.
const collectAttendanceItems = ({ row, settings }) => {
  const items = []
  let unresolved = 0
  const month = settings?.month || ''
  if (!month) return { items, unresolved }
  const entries = resolveAttendanceEntries({
    attendance: row?.attendance,
    month,
    columnCount: settings.columnCount,
    convention: settings.convention
  })
  const validDates = new Set(entries.map((entry) => entry.dateKey).filter(Boolean))
  const reviewed = row?.reviewedAttendance && typeof row.reviewedAttendance === 'object' ? row.reviewedAttendance : {}
  Object.entries(reviewed).forEach(([dateKey, decision]) => {
    if (!validDates.has(dateKey)) return
    const value = decision?.value
    if (value === ATTENDANCE_STATUS.PRESENT || value === ATTENDANCE_STATUS.ABSENT) {
      items.push({ dateKey, value, month })
      return
    }
    unresolved += 1
  })
  // A mapped Sunday with a visible mark that received no explicit Present/Absent
  // decision stays unresolved: it must never be written implicitly.
  const withMarkNoDecision = entries.filter((entry) => (
    entry.dateKey && !reviewed[entry.dateKey] && Boolean(entry.rawMark)
  ))
  unresolved += withMarkNoDecision.length
  return { items, unresolved }
}

// One entry per scanned row that is eligible to be written.
export const buildFinalSavePlan = ({
  sheets = [],
  resultsBySheet = {},
  currentMembers = [],
  monthlyTables = [],
  settingsBySheet = {}
}) => {
  const rows = []
  const sheetList = Array.isArray(sheets) ? sheets : []
  sheetList.forEach((sheet) => {
    const result = resultsBySheet?.[sheet.id]
    if (result?.status !== 'ok' || !result?.payload) return
    const excluded = new Set(Array.isArray(result.excludedIndices) ? result.excludedIndices : [])
    const settings = settingsBySheet?.[sheet.id] || EMPTY_ATTENDANCE_SETTINGS
    result.payload.rows.forEach((row, rowIndex) => {
      if (excluded.has(rowIndex)) return
      const match = resolvePlanMatch(row, currentMembers)
      const attendance = collectAttendanceItems({ row, settings })
      if (isCreateNewRow(row)) {
        const target = row?.newMemberTarget || { mode: 'this-month', monthKey: settings.month }
        const targetMode = target?.mode === 'all-year' || target?.mode === 'all-months' ? 'all-year' : 'this-month'
        const frozenTargetMonths = [...new Set(
          targetMode === 'all-year' && target?.monthKey
            ? (Array.isArray(monthlyTables) ? monthlyTables : [])
              .map(monthKeyFromTableName)
              .filter((key) => key?.slice(0, 4) === target.monthKey.slice(0, 4))
            : (target?.monthKey ? [target.monthKey] : [])
        )].sort().map((key) => `${key}-01`)
        const createProfile = effectiveNewMemberProfile(row)
        const unresolvedProfile = COMPARE_FIELDS.reduce((count, { key }) => {
          const scanValue = row?.originalGeminiValue?.[key] ?? row?.[key]
          return count + (asTrimmed(scanValue) && !row?.reviewedValues?.[key] ? 1 : 0)
        }, 0)
        rows.push({
          sheetId: sheet.id,
          rowIndex,
          row,
          memberAction: 'create-new',
          member: null,
          memberId: null,
          createProfile,
          newMemberTarget: target,
          targetMonths: frozenTargetMonths,
          attendance: attendance.items,
          unresolvedAttendance: attendance.unresolved,
          unresolvedProfile,
          hasWrites: Boolean(createProfile.full_name) || attendance.items.length > 0
        })
        return
      }
      const member = match.member
      const profileUpdates = {}
      let unresolvedProfile = 0
      if (member) {
        const compares = compareRowToMember(row, member)
        COMPARE_FIELDS.forEach(({ key }) => {
          const decision = getFieldDecision(row, key)
          if (!decision) return
          if (!fieldValuesEquivalent(key, decision.value, getExistingValue(member, key))) {
            profileUpdates[key] = decision.value
          }
        })
        unresolvedProfile = compares.reduce((sum, compare) => (
          sum + (fieldNeedsDecision(compare) && !getFieldDecision(row, compare.field) ? 1 : 0)
        ), 0)
      }
      rows.push({
        sheetId: sheet.id,
        rowIndex,
        row,
        memberAction: 'update',
        match,
        member,
        memberId: member?.id || null,
        profileUpdates,
        attendance: attendance.items,
        unresolvedAttendance: attendance.unresolved,
        unresolvedProfile,
        hasWrites: Object.keys(profileUpdates).length > 0 || attendance.items.length > 0
      })
    })
  })
  return { rows }
}

// Likely duplicate detection for create-new rows, using the app's own matching.
// An exact or possible match against an existing member blocks creation until
// the user confirms.
export const detectNewMemberDuplicates = ({ rows = [], currentMembers = [] }) => {
  const found = []
  const knownMembers = Array.isArray(currentMembers) ? [...currentMembers] : []
  rows.forEach((entry) => {
    if (entry.memberAction !== 'create-new') return
    const probe = {
      full_name: entry.createProfile?.full_name || '',
      phone_number: entry.createProfile?.phone_number || ''
    }
    if (!asTrimmed(probe.full_name) && !asTrimmed(probe.phone_number)) return
    const match = matchGeminiRowToMember(probe, knownMembers)
    if (match.status === MATCH_STATUSES.MATCHED || match.status === MATCH_STATUSES.POSSIBLE) {
      found.push({
        sheetId: entry.sheetId,
        rowIndex: entry.rowIndex,
        name: asTrimmed(probe.full_name) || 'Unnamed',
        matches: match.member ? [match.member] : [],
        level: match.status
      })
    }
    knownMembers.push({
      id: `paper-scan-pending:${entry.sheetId}:${entry.rowIndex}`,
      'Full Name': probe.full_name,
      'Phone Number': probe.phone_number
    })
  })
  return found
}

// Maps a per-row create target into concrete month-table names.
const resolveCreateTargetTables = ({ target, monthlyTables }) => {
  const mode = target?.mode === 'all-year' || target?.mode === 'all-months' ? 'all-year' : 'this-month'
  const monthKey = target?.monthKey || ''
  const primary = monthTableForKey(monthlyTables, monthKey)
  if (!primary) return { mode, monthKey, primary: '', others: [] }
  const year = monthYearFromKey(monthKey)
  const others = mode === 'all-year' && year
    ? monthTablesInYear(monthlyTables, year).filter((table) => table !== primary)
    : []
  return { mode, monthKey, primary, others }
}

// Operations contain only logical month/date values. The database stores the
// immutable plan and resolves every physical month table from its private
// registry before any step can mutate data.
const monthStartFromTable = (table) => {
  const key = monthKeyFromTableName(table)
  return key ? `${key}-01` : null
}

export const getDurableSaveOperation = async ({ supabase, ownerId, savedScanId, operationId = null }) => {
  const result = await executeSupabaseWrite(
    () => supabase.rpc('paper_scan_get_save_operation', {
      p_owner_id: ownerId,
      p_saved_scan_id: savedScanId,
      p_operation_id: operationId
    }),
    { action: 'Load Final Save recovery state' }
  )
  return result?.data || null
}

const prepareDurableOperation = async ({ plan, ownerId, savedScanId, operationId, supabase, workspaceName, currentTable, monthlyTables = [], confirmedDuplicateKeys = [] }) => {
  if (!savedScanId) throw new Error('Save the scan before starting Final Save.')
  const durablePlan = {
    version: 1,
    duplicate_overrides: confirmedDuplicateKeys.map(({ sheetId, rowIndex }) => `${sheetId}:${rowIndex}`),
    rows: plan.rows.map((entry) => {
      const monthKey = entry.memberAction === 'create-new'
        ? entry.newMemberTarget?.monthKey
        : (entry.attendance?.[0]?.month || '')
      const profileMonthStart = monthStartFromTable(getMemberSourceTable(entry.member, currentTable || ''))
      const targetMode = entry.newMemberTarget?.mode === 'all-year' || entry.newMemberTarget?.mode === 'all-months' ? 'all-year' : 'this-month'
      // Freeze concrete logical month starts before the server creates the
      // operation.  A retry executes only this persisted list; it never asks
      // the current React state or the later month registry to expand it.
      const targetMonths = entry.memberAction === 'create-new'
        ? [...new Set(Array.isArray(entry.targetMonths) ? entry.targetMonths : [])].sort()
        : []
      return {
        row_key: `${entry.sheetId}:${entry.rowIndex}`,
        sheet_id: entry.sheetId,
        row_index: entry.rowIndex,
        display_name: entry.memberAction === 'create-new'
          ? asTrimmed(entry.createProfile?.full_name)
          : (entry.member?.full_name || entry.member?.['Full Name'] || asTrimmed(entry.row?.full_name)),
        member_action: entry.memberAction,
        member_id: entry.memberId || null,
        month_start: monthKey ? `${monthKey}-01` : profileMonthStart,
        profile_month_start: profileMonthStart || (monthKey ? `${monthKey}-01` : null),
        target_mode: targetMode,
        target_months: targetMonths,
        member_payload: entry.memberAction === 'create-new'
          ? buildMemberInsertRow(entry.createProfile, { workspaceName })
          : {},
        profile_updates: entry.profileUpdates || {},
        attendance: (entry.attendance || []).map((item) => ({ date: item.dateKey, status: item.value }))
      }
    })
  }
  const result = await executeSupabaseWrite(
    () => supabase.rpc('paper_scan_begin_save_operation', {
      p_operation_id: operationId,
      p_saved_scan_id: savedScanId,
      p_owner_id: ownerId,
      p_plan: durablePlan
    }),
    { action: 'Prepare Final Save operation' }
  )
  if (!result?.data?.operation_id || !Array.isArray(result?.data?.steps)) {
    throw new Error(result?.data?.error_message || 'The final-save operation could not be prepared.')
  }
  return result.data
}

const executeDurableStep = async ({ operationId, stepId, supabase, action }) => {
  const result = await executeSupabaseWrite(
    () => supabase.rpc('paper_scan_execute_save_step', {
      p_operation_id: operationId,
      p_step_id: stepId
    }),
    { action }
  )
  if (result?.data?.success !== true) {
    throw new Error(result?.data?.error_message || `${action} could not be completed.`)
  }
  return result.data
}

// Processes every planned row in the approved order (validate → resolve target
// member → create if requested → approved profile changes → attendance →
// verify → saved/failed). Individual rows never hide another row's failure.
export const executeFinalSave = async ({ plan, confirmedDuplicateKeys = [], deps = {} }) => {
  const {
    supabase,
    currentMembers = [],
    monthlyTables = [],
    currentTable = null,
    dataOwnerId = null,
    user = null,
    workspaceName = null,
    isOnline = true,
    offlineMode = 'auto',
    operationId = null,
    savedScanId = null
  } = deps
  if (!supabase) {
    throw new Error('Final save is not ready: required write paths are unavailable.')
  }
  if (!isOnline || offlineMode === 'offline') {
    throw new Error('Final save requires an online connection and is never queued offline.')
  }
  const ownerId = dataOwnerId || user?.id || null
  const effectiveOperationId = operationId || makeLocalUuid()
  const memberIds = {}
  const blockedDuplicates = detectNewMemberDuplicates({ rows: plan.rows, currentMembers })
  const confirmedSet = new Set(confirmedDuplicateKeys.map((key) => `${key.sheetId}:${key.rowIndex}`))

  // Block every unconfirmed duplicate before the first mutation. A stale
  // duplicate must never allow earlier rows to write first.
  const unconfirmedDuplicates = blockedDuplicates.filter((duplicate) => (
    !confirmedSet.has(`${duplicate.sheetId}:${duplicate.rowIndex}`)
  ))
  if (unconfirmedDuplicates.length > 0) {
    return {
      summary: { saved: 0, newMembersCreated: 0, profileChanges: 0, attendanceUpdated: 0, skippedUnresolved: 0, skippedMissingTable: 0, failed: 0 },
      members: unconfirmedDuplicates.map((duplicate) => ({
        sheetId: duplicate.sheetId,
        rowIndex: duplicate.rowIndex,
        name: duplicate.name,
        memberId: null,
        status: FINAL_SAVE_STATUS.BLOCKED_DUPLICATE,
        reason: 'Possible duplicate found. Confirm before creating.'
      })),
      blockedDuplicates: unconfirmedDuplicates,
      savedAt: new Date().toISOString(),
      operationId: effectiveOperationId,
      memberIds
    }
  }

  if (!ownerId) throw new Error('Unable to determine the workspace owner for this save.')
  const durableOperation = await prepareDurableOperation({
    plan,
    ownerId,
    savedScanId,
    operationId: effectiveOperationId,
    supabase,
    workspaceName,
    currentTable,
    monthlyTables,
    confirmedDuplicateKeys
  })
  const stepFor = (rowNumber, prefix) => durableOperation.steps.filter((step) => (
    String(step.step_key || '').startsWith(`${rowNumber}:${prefix}`)
  ))

  const summary = {
    saved: 0,
    newMembersCreated: 0,
    profileChanges: 0,
    attendanceUpdated: 0,
    skippedUnresolved: 0,
    skippedMissingTable: 0,
    failed: 0
  }
  const members = []
  const blocked = []

  for (const entry of plan.rows) {
    const memberKey = `${entry.sheetId}:${entry.rowIndex}`
    let memberId = entry.memberId
    let identity = null
    let newMember = false
    let profileChanges = 0
    let attendanceUpdated = 0

    try {
      if (entry.memberAction === 'create-new') {
        if (!ownerId) throw new Error('Unable to determine the workspace owner for this save.')
        const profile = entry.createProfile || {}
        if (!asTrimmed(profile.full_name)) throw new Error('A new member needs an explicitly approved name.')
        const createSteps = stepFor(plan.rows.indexOf(entry) + 1, 'member:')
        if (!createSteps.length) throw new Error('The selected logical month is not registered for this workspace.')
        memberId = createSteps[0].member_id
        for (const step of createSteps) {
          await executeDurableStep({ operationId: effectiveOperationId, stepId: step.id, supabase, action: 'Create reviewed member' })
        }
        memberIds[memberKey] = memberId
        identity = buildMemberIdentityHint(buildMemberInsertRow(profile, { id: memberId, userId: ownerId, workspaceName }))
        newMember = true
        summary.newMembersCreated += 1
      } else {
        if (!entry.member) throw new Error('No matching member was selected for this row.')
        memberId = String(entry.member.id)
        memberIds[memberKey] = memberId
        identity = buildMemberIdentityHint(entry.member)
      }

      if (!ownerId) throw new Error('Unable to determine the workspace owner for this save.')

      // Approved profile changes for existing members (create-new rows already
      // carry their reviewed profile into the insert row above).
      if (!newMember && Object.keys(entry.profileUpdates || {}).length > 0) {
        const profileSteps = stepFor(plan.rows.indexOf(entry) + 1, 'profile')
        if (!profileSteps.length) throw new Error('The approved profile update was not persisted as a durable step.')
        await executeDurableStep({ operationId: effectiveOperationId, stepId: profileSteps[0].id, supabase, action: 'Update reviewed profile' })
        profileChanges = Object.keys(entry.profileUpdates).length
        summary.profileChanges += profileChanges
      }

      // Approved attendance decisions.
      for (const item of entry.attendance || []) {
        const attendanceSteps = stepFor(plan.rows.indexOf(entry) + 1, `attendance:${item.dateKey}`)
        if (!attendanceSteps.length) { summary.skippedMissingTable += 1; continue }
        await executeDurableStep({ operationId: effectiveOperationId, stepId: attendanceSteps[0].id, supabase, action: `Mark ${item.dateKey}` })
        attendanceUpdated += 1
        summary.attendanceUpdated += 1
      }

      const skippedUnresolved = (entry.unresolvedAttendance || 0) + (entry.unresolvedProfile || 0)
      summary.skippedUnresolved += skippedUnresolved

      const wroteSomething = newMember || profileChanges > 0 || attendanceUpdated > 0
      members.push({
        sheetId: entry.sheetId,
        rowIndex: entry.rowIndex,
        name: newMember
          ? asTrimmed(entry.createProfile?.full_name)
          : (entry.member?.full_name || entry.member?.['Full Name'] || asTrimmed(entry.row?.full_name)) || 'Unnamed',
        memberId,
        status: wroteSomething ? (newMember ? FINAL_SAVE_STATUS.CREATED : FINAL_SAVE_STATUS.SAVED) : FINAL_SAVE_STATUS.SKIPPED,
        newMember,
        profileChanges,
        attendanceUpdated,
        skippedUnresolved,
        reason: wroteSomething ? '' : 'No approved changes to write.'
      })
      if (wroteSomething) summary.saved += 1
    } catch (error) {
      summary.failed += 1
      members.push({
        sheetId: entry.sheetId,
        rowIndex: entry.rowIndex,
        name: newMember
          ? asTrimmed(entry.createProfile?.full_name)
          : (entry.member?.full_name || entry.member?.['Full Name'] || asTrimmed(entry.row?.full_name)) || 'Unnamed',
        memberId,
        status: FINAL_SAVE_STATUS.FAILED,
        newMember,
        profileChanges,
        attendanceUpdated,
        skippedUnresolved: 0,
        reason: error?.message || 'Save failed.'
      })
    }
  }

  return {
    summary,
    members,
    blockedDuplicates: blocked,
    savedAt: new Date().toISOString(),
    operationId: effectiveOperationId,
    memberIds
  }
}

// Converts database recovery state into the UI result. The immutable plan and
// checkpoints are authoritative; save_result is merely a display cache.
export const finalSaveResultFromOperation = (operation) => {
  const rows = operation?.immutable_plan?.rows || []
  const steps = Array.isArray(operation?.steps) ? operation.steps : []
  const members = rows.map((row, index) => {
    const rowSteps = steps.filter((step) => String(step.step_key || '').startsWith(`${index + 1}:`))
    const failed = rowSteps.find((step) => step.state === 'failed')
    const incomplete = rowSteps.some((step) => step.state !== 'succeeded')
    const isNew = row.member_action === 'create-new'
    const profile = rowSteps.find((step) => step.kind === 'profile')
    const attendanceUpdated = rowSteps.filter((step) => step.kind === 'attendance' && step.state === 'succeeded').length
    const profileChanges = profile?.state === 'succeeded' ? Object.keys(profile.profile_payload || {}).length : 0
    const wrote = rowSteps.some((step) => step.state === 'succeeded')
    return {
      sheetId: row.sheet_id,
      rowIndex: row.row_index,
      name: row.display_name || 'Unnamed',
      memberId: rowSteps[0]?.member_id || row.member_id || null,
      status: failed || incomplete
        ? FINAL_SAVE_STATUS.FAILED
        : isNew ? FINAL_SAVE_STATUS.CREATED : wrote ? FINAL_SAVE_STATUS.SAVED : FINAL_SAVE_STATUS.SKIPPED,
      newMember: isNew,
      profileChanges,
      attendanceUpdated,
      skippedUnresolved: 0,
      reason: failed?.result?.error || failed?.result?.error_message || (incomplete ? 'Save incomplete.' : wrote ? '' : 'No approved changes to write.')
    }
  })
  return {
    summary: summarizeFinalSaveMembers(members),
    members,
    blockedDuplicates: [],
    savedAt: new Date().toISOString(),
    operationId: operation?.operation_id,
    operationStatus: operation?.status || 'pending',
    memberIds: Object.fromEntries(members.filter((member) => member.memberId).map((member) => [`${member.sheetId}:${member.rowIndex}`, member.memberId]))
  }
}

// Recovery retry is intentionally plan-free: it reloads and executes only the
// failed/pending persisted step records, never the current React review state.
export const retryPersistedFinalSave = async ({ operationId, deps = {} }) => {
  const { supabase, dataOwnerId = null, user = null, savedScanId = null, isOnline = true, offlineMode = 'auto' } = deps
  if (!supabase) throw new Error('Final save is not ready: the recovery path is unavailable.')
  if (!isOnline || offlineMode === 'offline') throw new Error('Final save requires an online connection and is never queued offline.')
  const ownerId = dataOwnerId || user?.id || null
  if (!ownerId || !operationId) throw new Error('A durable operation and workspace owner are required.')
  let operation = await getDurableSaveOperation({ supabase, ownerId, savedScanId, operationId })
  if (!operation) throw new Error('The durable Final Save operation was not found.')
  for (const step of operation.steps || []) {
    if (step.state === 'succeeded') continue
    const result = await executeDurableStep({ operationId, stepId: step.id, supabase, action: `Retry ${step.kind}` })
    if (result?.success !== true) break
  }
  operation = await getDurableSaveOperation({ supabase, ownerId, savedScanId, operationId })
  return finalSaveResultFromOperation(operation)
}

// Compact metadata persisted into the Saved Scan so a reopened scan can show
// the same result summary without re-running Gemini or any write. The
// operation id and each row's canonical member id are the durable retry state:
// a retry reuses them so a partial prior attempt never duplicates a member.
export const buildSaveResultMetadata = ({ result, scanId, name }) => ({
  scanId,
  name,
  savedAt: result.savedAt,
  operationId: result.operationId,
  summary: result.summary,
  members: result.members.map(({ sheetId, rowIndex, name, status, reason, newMember, memberId, profileChanges, attendanceUpdated, skippedUnresolved }) => ({
    sheetId,
    rowIndex,
    name,
    status,
    reason,
    newMember,
    memberId,
    profileChanges,
    attendanceUpdated,
    skippedUnresolved
  })),
  blockedDuplicates: result.blockedDuplicates
})

// Recomputes the result summary from a per-member array. Used when retrying
// only the failed rows so the combined totals stay accurate.
export const summarizeFinalSaveMembers = (members = []) => {
  const summary = {
    saved: 0,
    newMembersCreated: 0,
    profileChanges: 0,
    attendanceUpdated: 0,
    skippedUnresolved: 0,
    skippedMissingTable: 0,
    failed: 0
  }
  members.forEach((member) => {
    if (member.status === FINAL_SAVE_STATUS.FAILED) {
      summary.failed += 1
      return
    }
    if (member.status === FINAL_SAVE_STATUS.CREATED) summary.newMembersCreated += 1
    summary.profileChanges += member.profileChanges || 0
    summary.attendanceUpdated += member.attendanceUpdated || 0
    summary.skippedUnresolved += member.skippedUnresolved || 0
    if (member.status === FINAL_SAVE_STATUS.SAVED || member.status === FINAL_SAVE_STATUS.CREATED) {
      summary.saved += 1
    }
  })
  return summary
}

// Read-only preview for the Final Review screen: what WOULD be written, plus
// any likely-duplicate rows that would block the save until confirmed.
export const previewFinalSave = ({
  sheets = [],
  resultsBySheet = {},
  currentMembers = [],
  monthlyTables = [],
  settingsBySheet = {}
}) => {
  const plan = buildFinalSavePlan({ sheets, resultsBySheet, currentMembers, monthlyTables, settingsBySheet })
  const counts = { rows: plan.rows.length, newMembers: 0, profileChanges: 0, attendance: 0, unresolved: 0 }
  plan.rows.forEach((entry) => {
    if (entry.memberAction === 'create-new') counts.newMembers += 1
    counts.profileChanges += Object.keys(entry.profileUpdates || {}).length
    counts.attendance += (entry.attendance || []).length
    counts.unresolved += (entry.unresolvedAttendance || 0) + (entry.unresolvedProfile || 0)
  })
  const duplicates = detectNewMemberDuplicates({ rows: plan.rows, currentMembers })
  return { plan, counts, duplicates }
}
