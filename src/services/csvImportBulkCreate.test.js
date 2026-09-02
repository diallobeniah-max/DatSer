import { describe, expect, it, vi } from 'vitest'
import { applyCsvBulkCreateResult, buildCsvBulkCreatePlan, executeCsvBulkCreatePlan, getCsvBulkCreateSummary, makeCsvBulkCreateRequestId } from './csvImportBulkCreate'

const safeRow = (overrides = {}) => ({
  importRowId: 'sheet-4-row-7',
  sheet: 'Sheet 4',
  rowNumber: 7,
  saveStatus: 'pending',
  edited: { fullName: 'Enoch Norkplim', phoneNumber: '0240000000', age: '16', gender: 'Male', educationalLevel: 'JHS 3', notes: '' },
  match: { status: 'new', selectedMemberId: null, candidates: [], matchedMember: null },
  ...overrides,
})

describe('CSV bulk member creation', () => {
  it('includes only safe New rows and reports all protected rows in the confirmation summary', () => {
    const rows = [
      safeRow(),
      safeRow({ importRowId: 'exact', match: { status: 'exact', selectedMemberId: 'old-1' } }),
      safeRow({ importRowId: 'possible', match: { status: 'possible', candidates: [{ id: 'old-2' }] } }),
      safeRow({ importRowId: 'attention', edited: { ...safeRow().edited, notes: 'Verify surname' } }),
      safeRow({ importRowId: 'invalid', match: { status: 'invalid' } }),
      safeRow({ importRowId: 'saved', saveStatus: 'saved' }),
      safeRow({ importRowId: 'conflict', duplicateOfRowId: 'sheet-4-row-1' }),
    ]
    expect(buildCsvBulkCreatePlan({ importRows: rows, ownerId: 'owner', workspaceName: 'DatSer' }).map((step) => step.importRowId)).toEqual(['sheet-4-row-7'])
    expect(getCsvBulkCreateSummary(rows)).toMatchObject({ safeNew: 1, exact: 1, possible: 1, attention: 1, invalid: 1, completed: 1, conflict: 1 })
  })

  it('uses the trusted bundle RPC with a deterministic request ID and never sends attendance', async () => {
    const rpc = vi.fn().mockResolvedValue({ data: { success: true, member_id: 'new-1' }, error: null })
    const result = await executeCsvBulkCreatePlan({
      plan: buildCsvBulkCreatePlan({ importRows: [safeRow()], ownerId: 'owner', workspaceName: 'DatSer' }),
      targetTable: 'August_2026', ownerId: 'owner', sessionId: 'history-1', supabase: { rpc },
    })
    expect(result).toMatchObject({ createdCount: 1, failCount: 0 })
    expect(rpc).toHaveBeenCalledWith('save_member_bundle_resilient', expect.objectContaining({
      p_table_name: 'August_2026', p_owner_id: 'owner', p_request_id: makeCsvBulkCreateRequestId('history-1', 'sheet-4-row-7'), p_attendance: {},
    }))
  })

  it('reports partial failures without rerunning successful rows, and awaits each durable callback', async () => {
    const rpc = vi.fn()
      .mockResolvedValueOnce({ data: { success: true, member_id: 'new-1' }, error: null })
      .mockResolvedValueOnce({ data: { success: false, error_message: 'denied' }, error: null })
    const onResult = vi.fn().mockResolvedValue(undefined)
    const plan = buildCsvBulkCreatePlan({ importRows: [safeRow(), safeRow({ importRowId: 'row-2' })], ownerId: 'owner' })
    const result = await executeCsvBulkCreatePlan({ plan, targetTable: 'August_2026', ownerId: 'owner', sessionId: 'history-1', supabase: { rpc }, onResult })
    expect(result).toMatchObject({ createdCount: 1, failCount: 1 })
    expect(onResult).toHaveBeenCalledTimes(2)
    expect(rpc.mock.invocationCallOrder[1]).toBeGreaterThan(onResult.mock.invocationCallOrder[0])
  })

  it('handles 3 safe operations with 1 failure and ensures retry only processes the failed row', async () => {
    const row1 = safeRow({ importRowId: 'row-1', edited: { ...safeRow().edited, fullName: 'Member One' } })
    const row2 = safeRow({ importRowId: 'row-2', edited: { ...safeRow().edited, fullName: 'Member Two' } })
    const row3 = safeRow({ importRowId: 'row-3', edited: { ...safeRow().edited, fullName: 'Member Three' } })

    const rpc = vi.fn()
      .mockResolvedValueOnce({ data: { success: true, member_id: 'new-1' }, error: null })
      .mockResolvedValueOnce({ data: { success: false, error_message: 'network error' }, error: null })
      .mockResolvedValueOnce({ data: { success: true, member_id: 'new-3' }, error: null })

    const plan = buildCsvBulkCreatePlan({ importRows: [row1, row2, row3], ownerId: 'owner', workspaceName: 'DatSer' })
    const result = await executeCsvBulkCreatePlan({ plan, targetTable: 'August_2026', ownerId: 'owner', sessionId: 'history-1', supabase: { rpc } })

    expect(result.createdCount).toBe(2)
    expect(result.failCount).toBe(1)

    // Update row1 and row3 with their results
    const updatedRow1 = applyCsvBulkCreateResult({ row: row1, result: result.results[0], sessionId: 'history-1', batchId: 'b-1' })
    const updatedRow2 = { ...row2, saveStatus: 'failed', saveError: 'network error' }
    const updatedRow3 = applyCsvBulkCreateResult({ row: row3, result: result.results[2], sessionId: 'history-1', batchId: 'b-1' })

    // Build plan for retry
    const retryPlan = buildCsvBulkCreatePlan({ importRows: [updatedRow1, updatedRow2, updatedRow3], ownerId: 'owner', workspaceName: 'DatSer' })
    expect(retryPlan.map((s) => s.importRowId)).toEqual(['row-2'])
  })
})
