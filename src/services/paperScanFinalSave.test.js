// @vitest-environment node
import { describe, expect, it, vi } from 'vitest'
import { buildFinalSavePlan, detectNewMemberDuplicates, executeFinalSave, finalSaveResultFromOperation, retryPersistedFinalSave, FINAL_SAVE_STATUS } from './paperScanFinalSave'

const member = { id: 'm1', 'Full Name': 'Ama Serwaa', 'Phone Number': '0241111111', Gender: 'Female', 'Current Level': 'SHS1' }
const sheet = [{ id: 'sheet-1' }]
const reviewed = (values) => ({ reviewedValues: Object.fromEntries(Object.entries(values).map(([key, value]) => [key, { value, source: 'reviewer' }])) })
const planFor = (rows) => buildFinalSavePlan({
  sheets: sheet,
  resultsBySheet: { 'sheet-1': { status: 'ok', excludedIndices: [], payload: { rows } } },
  currentMembers: [member],
  monthlyTables: ['June_2026'],
  settingsBySheet: { 'sheet-1': { month: '2026-06', convention: 'tick_x', columnCount: 4 } }
})

const durableSupabase = ({ failStep = false } = {}) => {
  const calls = []
  return {
    calls,
    rpc: vi.fn(async (name, args) => {
      calls.push({ name, args })
      if (name === 'paper_scan_begin_save_operation') {
        const steps = args.p_plan.rows.flatMap((row, index) => {
          const id = row.member_action === 'create-new' ? 'server-member-id' : row.member_id
          const create = row.member_action === 'create-new' ? [{ id: `create-${index}`, step_key: `${index + 1}:member:2026-06-01`, member_id: id }] : []
          const profile = Object.keys(row.profile_updates || {}).length
            ? [{ id: `profile-${index}`, step_key: `${index + 1}:profile`, kind: 'profile', member_id: id, profile_payload: row.profile_updates, state: 'pending' }]
            : []
          const attendance = row.attendance.map((item) => ({ id: `attendance-${index}`, step_key: `${index + 1}:attendance:${item.date}`, kind: 'attendance', member_id: id, state: 'pending' }))
          return [...create, ...profile, ...attendance]
        })
        return { data: { operation_id: args.p_operation_id, steps }, error: null }
      }
      if (name === 'paper_scan_execute_save_step') return failStep
        ? { data: null, error: { message: 'network response lost' } }
        : { data: { success: true, step_id: args.p_step_id, affected: 1 }, error: null }
      return { data: null, error: { message: `unexpected RPC ${name}` } }
    })
  }
}

const deps = (supabase, overrides = {}) => ({
  supabase, updateMember: vi.fn(async () => ({ id: 'm1' })), currentMembers: [member], currentTable: 'June_2026',
  dataOwnerId: 'owner-id', workspaceName: 'Test workspace', isOnline: true, savedScanId: 'saved-scan-id', operationId: 'operation-id', ...overrides
})

describe('paperScanFinalSave durable operation client', () => {
  it('never puts undecided Gemini values in a new-member payload', () => {
    const plan = planFor([{ full_name: 'raw Gemini name', memberAction: 'create-new', attendance: {}, warnings: [] }])
    expect(plan.rows[0].createProfile).toEqual({})
    expect(plan.rows[0].unresolvedProfile).toBeGreaterThan(0)
  })

  it('detects same-batch duplicate new members before mutation', () => {
    const plan = planFor([
      { full_name: 'Kojo', phone_number: '0240000000', memberAction: 'create-new', attendance: {}, warnings: [], ...reviewed({ full_name: 'Kojo', phone_number: '0240000000' }) },
      { full_name: 'Kojo', phone_number: '0240000000', memberAction: 'create-new', attendance: {}, warnings: [], ...reviewed({ full_name: 'Kojo', phone_number: '0240000000' }) }
    ])
    expect(detectNewMemberDuplicates({ rows: plan.rows, currentMembers: [] })).toHaveLength(1)
  })

  it('requires a saved scan id before Final Save can begin', async () => {
    const supabase = durableSupabase()
    await expect(executeFinalSave({ plan: planFor([]), deps: deps(supabase, { savedScanId: null }) })).rejects.toThrow('Save the scan')
  })

  it('begins one immutable operation and executes only durable step ids', async () => {
    const supabase = durableSupabase()
    const plan = planFor([{ full_name: 'Kojo', memberAction: 'create-new', attendance: {}, warnings: [], ...reviewed({ full_name: 'Kojo' }) }])
    const result = await executeFinalSave({ plan, deps: deps(supabase) })
    expect(result.members[0]).toMatchObject({ status: FINAL_SAVE_STATUS.CREATED, memberId: 'server-member-id' })
    expect(supabase.calls.map((call) => call.name)).toEqual(['paper_scan_begin_save_operation', 'paper_scan_execute_save_step'])
    expect(JSON.stringify(supabase.calls)).not.toContain('June_2026')
  })

  it('reports a failed durable step rather than a false saved result', async () => {
    const supabase = durableSupabase({ failStep: true })
    const plan = planFor([{ full_name: 'Kojo', memberAction: 'create-new', attendance: {}, warnings: [], ...reviewed({ full_name: 'Kojo' }) }])
    const result = await executeFinalSave({ plan, deps: deps(supabase) })
    expect(result.members[0].status).toBe(FINAL_SAVE_STATUS.FAILED)
    expect(result.summary.failed).toBe(1)
  })

  it('persists only approved profile fields before executing the profile checkpoint', async () => {
    const supabase = durableSupabase()
    const plan = planFor([{ full_name: 'Ama Serwaa', phone_number: '0249999999', attendance: {}, warnings: [], ...reviewed({ phone_number: '0242222222' }) }])
    await executeFinalSave({ plan, deps: deps(supabase) })
    const begin = supabase.calls.find((call) => call.name === 'paper_scan_begin_save_operation')
    expect(begin.args.p_plan.rows[0].profile_updates).toEqual({ phone_number: '0242222222' })
    expect(supabase.calls.find((call) => call.args?.p_step_id === 'profile-0')).toBeTruthy()
  })

  it('freezes exact all-year target months before execution and excludes a later registry month', async () => {
    const supabase = durableSupabase()
    const plan = buildFinalSavePlan({
      sheets: sheet,
      resultsBySheet: {
        'sheet-1': {
          status: 'ok',
          excludedIndices: [],
          payload: {
            rows: [{
              full_name: 'Kojo',
              memberAction: 'create-new',
              newMemberTarget: { mode: 'all-year', monthKey: '2026-06' },
              attendance: {},
              warnings: [],
              ...reviewed({ full_name: 'Kojo' })
            }]
          }
        }
      },
      currentMembers: [],
      monthlyTables: ['June_2026', 'July_2026', 'August_2026'],
      settingsBySheet: { 'sheet-1': { month: '2026-06', convention: 'tick_x', columnCount: 4 } }
    })
    await executeFinalSave({
      plan,
      deps: deps(supabase, { monthlyTables: ['June_2026', 'July_2026', 'August_2026', 'September_2026'] })
    })
    const begin = supabase.calls.find((call) => call.name === 'paper_scan_begin_save_operation')
    expect(begin.args.p_plan.rows[0].target_months).toEqual(['2026-06-01', '2026-07-01', '2026-08-01'])
    expect(JSON.stringify(begin.args.p_plan)).not.toContain('2026-09-01')
  })

  it('retries only persisted incomplete steps and renders recovery without React plan data', async () => {
    const operation = {
      operation_id: 'operation-id', status: 'failed', immutable_plan: { rows: [{ sheet_id: 'sheet-1', row_index: 0, display_name: 'Ama', member_action: 'update', member_id: 'm1', profile_updates: { phone_number: '0242222222' } }] },
      steps: [{ id: 'profile-0', step_key: '1:profile', kind: 'profile', member_id: 'm1', profile_payload: { phone_number: '0242222222' }, state: 'failed', result: { error: 'response lost' } }]
    }
    const calls = []
    const supabase = { rpc: vi.fn(async (name, args) => {
      calls.push({ name, args })
      if (name === 'paper_scan_get_save_operation') return { data: operation, error: null }
      if (name === 'paper_scan_execute_save_step') { operation.steps[0].state = 'succeeded'; operation.status = 'complete'; return { data: { success: true }, error: null } }
      return { data: null, error: { message: 'unexpected' } }
    }) }
    const result = await retryPersistedFinalSave({ operationId: 'operation-id', deps: deps(supabase) })
    expect(calls.filter((call) => call.name === 'paper_scan_execute_save_step')).toHaveLength(1)
    expect(calls.find((call) => call.name === 'paper_scan_execute_save_step').args.p_step_id).toBe('profile-0')
    expect(result.members[0]).toMatchObject({ status: FINAL_SAVE_STATUS.SAVED, profileChanges: 1 })
    expect(finalSaveResultFromOperation(operation).members[0].memberId).toBe('m1')
  })
})
