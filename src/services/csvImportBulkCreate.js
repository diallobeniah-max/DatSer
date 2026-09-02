// Conservative bulk member creation for CSV review. This deliberately uses
// the same resilient member bundle RPC as final CSV save, but never supplies
// attendance. Each row is handled sequentially so a durable review-history
// update can happen between requests.

import { executeSupabaseWrite, isTransientSupabaseError } from '../utils/supabaseWrite'
import { CSV_MATCH_STATUS } from '../utils/csvImportMatching'
import { isCsvImportAttentionUnresolved, isCsvImportRowCompleted } from '../utils/csvImportReview'
import { buildCsvMemberPayload } from './csvImportSave'

const trim = (value) => String(value || '').trim()

export const makeCsvBulkCreateRequestId = (sessionId, importRowId) => (
  `csv_import_bulk_${String(sessionId || 'session')}_${String(importRowId || 'row')}`.slice(0, 180)
)

export const getCsvBulkCreateEligibility = (row) => {
  if (!row) return { eligible: false, reason: 'invalid' }
  if (row.bulkCreate?.memberId) return { eligible: false, reason: 'alreadyCreated' }
  if (isCsvImportRowCompleted(row)) return { eligible: false, reason: 'completed' }
  if (isCsvImportAttentionUnresolved(row)) return { eligible: false, reason: 'attention' }
  if (row.duplicateOfRowId || row.identityConflict) return { eligible: false, reason: 'conflict' }
  if (row.match?.status === CSV_MATCH_STATUS.INVALID) return { eligible: false, reason: 'invalid' }
  if (!trim(row.edited?.fullName)) return { eligible: false, reason: 'missingIdentity' }
  if (row.match?.selectedMemberId || row.match?.matchedMember || row.match?.status === CSV_MATCH_STATUS.EXACT) return { eligible: false, reason: 'exact' }
  if (row.match?.status === CSV_MATCH_STATUS.POSSIBLE) return { eligible: false, reason: 'possible' }
  // The existing matcher marks a confidently unmatched valid identity as NEW.
  // PENDING/UNMATCHED rows still need normal matching or manual review.
  if (row.match?.status !== CSV_MATCH_STATUS.NEW) return { eligible: false, reason: 'needsReview' }
  return { eligible: true, reason: 'safeNew' }
}

export const getCsvBulkCreateSummary = (rows = []) => {
  const summary = {
    total: rows.length,
    safeNew: 0,
    exact: 0,
    possible: 0,
    attention: 0,
    invalid: 0,
    completed: 0,
    alreadyCreated: 0,
    conflict: 0,
    missingIdentity: 0,
    needsReview: 0,
  }
  rows.forEach((row) => {
    const eligibility = getCsvBulkCreateEligibility(row)
    summary[eligibility.reason] += 1
  })
  return summary
}

export const buildCsvBulkCreatePlan = ({ importRows = [], ownerId, workspaceName }) => (
  importRows.flatMap((row) => {
    const eligibility = getCsvBulkCreateEligibility(row)
    if (!eligibility.eligible) return []
    return [{
      importRowId: row.importRowId,
      row,
      memberPayload: buildCsvMemberPayload(row, null, ownerId, workspaceName),
    }]
  })
)

export const executeCsvBulkCreatePlan = async ({
  plan,
  targetTable,
  ownerId,
  sessionId,
  supabase,
  onResult,
}) => {
  const results = []
  let createdCount = 0
  let failCount = 0

  for (const step of plan || []) {
    let result
    try {
      const { data: bundleResult } = await executeSupabaseWrite(
        () => supabase.rpc('save_member_bundle_resilient', {
          p_table_name: targetTable,
          p_owner_id: ownerId,
          p_request_id: makeCsvBulkCreateRequestId(sessionId, step.importRowId),
          p_member: step.memberPayload,
          p_badges: [],
          p_tag_ids: [],
          // This action creates a member only. Attendance remains an explicit
          // operator decision in the normal attendance UI.
          p_attendance: {},
        }),
        { action: `CSV Import: Bulk create member in ${targetTable}` }
      )
      if (!bundleResult?.success || !bundleResult?.member_id) {
        throw new Error(bundleResult?.error_message || 'Member creation failed')
      }
      result = {
        importRowId: step.importRowId,
        status: 'created',
        memberId: String(bundleResult.member_id),
        createdAt: new Date().toISOString(),
      }
      createdCount += 1
    } catch (error) {
      result = {
        importRowId: step.importRowId,
        status: 'failed',
        error: error?.message || 'Unknown error',
        isRetryable: isTransientSupabaseError(error),
      }
      failCount += 1
    }
    results.push(result)
    // Await the caller: it persists successful provenance before a following
    // request can be issued, which keeps partial retry state deterministic.
    await onResult?.(result, { completed: results.length, total: plan.length, createdCount, failCount })
  }

  return { results, createdCount, failCount, total: plan.length }
}

export const applyCsvBulkCreateResult = ({ row, result, sessionId, batchId }) => {
  if (!row || result?.status !== 'created' || !result.memberId) return row
  const member = {
    id: String(result.memberId),
    'Full Name': row.edited?.fullName || '',
    'Phone Number': row.edited?.phoneNumber || '',
    'Age': row.edited?.age || '',
    'Gender': row.edited?.gender || '',
    'Current Level': row.edited?.educationalLevel || '',
  }
  const provenance = {
    memberId: String(result.memberId),
    sourceImportId: sessionId || null,
    sourceBatchId: batchId || null,
    sourceSheet: row.sheet || null,
    sourceRow: row.rowNumber || null,
    createdAt: result.createdAt || new Date().toISOString(),
  }
  return {
    ...row,
    match: {
      ...row.match,
      status: CSV_MATCH_STATUS.EXACT,
      selectedMemberId: member.id,
      matchedMember: member,
      candidates: [member, ...(row.match?.candidates || []).filter((candidate) => String(candidate?.id) !== member.id)],
    },
    bulkCreate: { status: 'created', ...provenance },
    fieldResolution: {
      ...row.fieldResolution,
      fullName: 'csv', phoneNumber: 'csv', age: 'csv', gender: 'csv', educationalLevel: 'csv',
      parentGuardianName: 'csv', parentGuardianPhone: 'csv',
    },
  }
}
