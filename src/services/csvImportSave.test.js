import { describe, expect, it } from 'vitest'
import { buildCsvSavePlan, buildSundayDateMap, buildSundayNamesSavePlan, isMemberPresentOnDate } from './csvImportSave'

const baseRow = {
  importRowId: 'synthetic__Sheet 1__row1',
  edited: {
    fullName: 'Synthetic Person', phoneNumber: '0240000000', age: '14', gender: 'Female',
    educationalLevel: 'JHS 3', parentGuardianName: '', parentGuardianPhone: '', notes: '',
    sunday_1: 'PRESENT', sunday_2: 'ABSENT', sunday_3: '', sunday_4: 'UNKNOWN', sunday_5: '',
  },
  fieldResolution: {},
}

describe('CSV Import save plan', () => {
  it('uses ISO Sunday keys with booleans and omits blank or unknown values', () => {
    const plan = buildCsvSavePlan({
      importRows: [{ ...baseRow, newMemberConfirmed: true, match: { status: 'new', selectedMemberId: null } }],
      targetTable: 'August_2026',
      sundayDateMap: buildSundayDateMap('August_2026', { sunday_1: true, sunday_2: true, sunday_3: true, sunday_4: true }),
      ownerId: 'owner',
      workspaceName: 'Synthetic Workspace',
    })
    expect(plan[0].action).toBe('create')
    expect(plan[0].attendancePayload).toEqual({ '2026-08-02': true, '2026-08-09': false })
  })

  it('skips an unresolved possible match and an already completed row', () => {
    const unresolved = buildCsvSavePlan({
      importRows: [{ ...baseRow, match: { status: 'possible', selectedMemberId: null } }],
      targetTable: 'August_2026', sundayDateMap: {}, ownerId: 'owner', workspaceName: 'Synthetic Workspace',
    })
    expect(unresolved[0]).toMatchObject({ action: 'skip', reason: expect.stringContaining('operator decision') })

    const completed = buildCsvSavePlan({
      importRows: [{ ...baseRow, match: { status: 'new' } }],
      targetTable: 'August_2026', sundayDateMap: {}, ownerId: 'owner', workspaceName: 'Synthetic Workspace',
      completedRowIds: new Set([baseRow.importRowId]),
    })
    expect(completed[0]).toMatchObject({ action: 'skip', reason: 'Already completed' })
  })

  it('keeps a newly detected member unresolved until an operator confirms it', () => {
    const plan = buildCsvSavePlan({
      importRows: [{ ...baseRow, match: { status: 'new', selectedMemberId: null } }],
      targetTable: 'August_2026', sundayDateMap: {}, ownerId: 'owner', workspaceName: 'Synthetic Workspace',
    })
    expect(plan[0]).toMatchObject({ action: 'unresolved', reason: expect.stringContaining('explicit operator confirmation') })
  })

  it('builds attendance-only names plans and never sends profile updates', () => {
    const member = { id: 'm1', 'Full Name': 'Synthetic Person', __source_table: 'August_2026' }
    const plan = buildSundayNamesSavePlan({
      importRows: [{ ...baseRow, mode: 'sunday_names', match: { status: 'exact', selectedMemberId: 'm1', matchedMember: member } }],
      targetTable: 'August_2026', selectedSundayDate: '2026-08-02', ownerId: 'owner', workspaceName: 'Synthetic',
    })
    expect(plan[0]).toMatchObject({ action: 'update', memberId: 'm1', profileUpdates: {}, attendancePayload: { '2026-08-02': true } })
  })

  it('uses the trusted cross-month path for historical members', () => {
    const member = { id: 'm1', 'Full Name': 'Synthetic Person', __source_table: 'July_2026' }
    const plan = buildSundayNamesSavePlan({
      importRows: [{ ...baseRow, match: { status: 'exact', selectedMemberId: 'm1', matchedMember: member } }],
      targetTable: 'August_2026', selectedSundayDate: '2026-08-09', ownerId: 'owner', workspaceName: 'Synthetic',
    })
    expect(plan[0]).toMatchObject({ action: 'cross_month', sourceTable: 'July_2026', profileUpdates: {} })
  })

  it('keeps unmatched and possible rows unresolved and skips duplicate source names', () => {
    const plan = buildSundayNamesSavePlan({
      importRows: [
        { ...baseRow, importRowId: 'u', match: { status: 'unmatched' } },
        { ...baseRow, importRowId: 'p', match: { status: 'possible', candidates: [{ id: 'm1' }] } },
        { ...baseRow, importRowId: 'd', duplicateOfRowId: 'first', match: { status: 'exact', selectedMemberId: 'm1' } },
      ],
      targetTable: 'August_2026', selectedSundayDate: '2026-08-16', ownerId: 'owner', workspaceName: 'Synthetic',
    })
    expect(plan.map((step) => step.action)).toEqual(['unresolved', 'unresolved', 'skip'])
  })

  it('marks already-present attendance as an idempotent skip', () => {
    const member = { id: 'm1', 'Full Name': 'Synthetic Person', attendance_2026_08_23: true }
    expect(isMemberPresentOnDate(member, '2026-08-23')).toBe(true)
    const plan = buildSundayNamesSavePlan({
      importRows: [{ ...baseRow, match: { status: 'exact', selectedMemberId: 'm1', matchedMember: member } }],
      targetTable: 'August_2026', selectedSundayDate: '2026-08-23', ownerId: 'owner', workspaceName: 'Synthetic',
    })
    expect(plan[0]).toMatchObject({ action: 'skip', reason: 'Already Present' })
  })

  it('creates safe new members when allowSafeNew is enabled', () => {
    const plan = buildCsvSavePlan({
      importRows: [{ ...baseRow, match: { status: 'new', selectedMemberId: null } }],
      targetTable: 'August_2026',
      sundayDateMap: buildSundayDateMap('August_2026', { sunday_1: true }),
      ownerId: 'owner',
      workspaceName: 'Synthetic Workspace',
      allowSafeNew: true,
    })
    expect(plan[0]).toMatchObject({ action: 'create', attendancePayload: { '2026-08-02': true } })
  })

  it('excludes rows with unverified attention notes from automatic creation and save', () => {
    const plan = buildCsvSavePlan({
      importRows: [{ ...baseRow, match: { status: 'new', selectedMemberId: null }, edited: { ...baseRow.edited, notes: 'Handwriting uncertain' } }],
      targetTable: 'August_2026',
      sundayDateMap: buildSundayDateMap('August_2026', { sunday_1: true }),
      ownerId: 'owner',
      workspaceName: 'Synthetic Workspace',
      allowSafeNew: true,
    })
    expect(plan[0]).toMatchObject({ action: 'unresolved', reason: expect.stringContaining('Transcription note') })
  })

  it('maps explicit P and A and strictly omits blank or unspecified Sundays to protect unmapped dates', () => {
    const rowWithMixed = {
      ...baseRow,
      edited: {
        ...baseRow.edited,
        sunday_1: 'PRESENT',
        sunday_2: 'ABSENT',
        sunday_3: '',
        sunday_4: 'UNKNOWN',
        sunday_5: null,
      },
    }
    const sundayDateMap = buildSundayDateMap('August_2026', { sunday_1: true, sunday_2: true, sunday_3: true, sunday_4: true, sunday_5: true })
    const plan = buildCsvSavePlan({
      importRows: [{ ...rowWithMixed, match: { status: 'exact', selectedMemberId: 'm1', matchedMember: { id: 'm1', __source_table: 'August_2026' } } }],
      targetTable: 'August_2026',
      sundayDateMap,
      ownerId: 'owner',
      workspaceName: 'Synthetic Workspace',
    })
    expect(plan[0].action).toBe('update')
    expect(plan[0].attendancePayload).toEqual({
      '2026-08-02': true,
      '2026-08-09': false,
    })
    // sunday_3, sunday_4, sunday_5 must not be present in payload
    expect(plan[0].attendancePayload['2026-08-16']).toBeUndefined()
    expect(plan[0].attendancePayload['2026-08-23']).toBeUndefined()
    expect(plan[0].attendancePayload['2026-08-30']).toBeUndefined()
  })

  it('processes Needs Attention rows and creates Possible/unmatched as NEW members when processRemaining is enabled', () => {
    const rows = [
      { ...baseRow, importRowId: 'exact-1', edited: { ...baseRow.edited, fullName: 'Exact Person' }, match: { status: 'exact', selectedMemberId: 'm-exact', matchedMember: { id: 'm-exact', __source_table: 'August_2026' } } },
      { ...baseRow, importRowId: 'possible-1', edited: { ...baseRow.edited, fullName: 'Possible Person' }, match: { status: 'possible', selectedMemberId: null, candidates: [{ id: 'cand-1' }] } },
      { ...baseRow, importRowId: 'attention-1', edited: { ...baseRow.edited, fullName: 'Attention Person', notes: 'Check spelling' }, match: { status: 'new' } },
      { ...baseRow, importRowId: 'unmatched-1', edited: { ...baseRow.edited, fullName: 'Unmatched Person' }, match: { status: 'unmatched' } },
      { ...baseRow, importRowId: 'invalid-1', edited: { ...baseRow.edited, fullName: '' }, match: { status: 'invalid' } },
    ]
    const sundayDateMap = buildSundayDateMap('August_2026', { sunday_1: true })
    const plan = buildCsvSavePlan({
      importRows: rows,
      targetTable: 'August_2026',
      sundayDateMap,
      ownerId: 'owner',
      workspaceName: 'Synthetic Workspace',
      processRemaining: true,
    })

    expect(plan.map((s) => ({ id: s.importRowId, action: s.action }))).toEqual([
      { id: 'exact-1', action: 'update' },
      { id: 'possible-1', action: 'create' },
      { id: 'attention-1', action: 'create' },
      { id: 'unmatched-1', action: 'create' },
      { id: 'invalid-1', action: 'skip' },
    ])
  })

  it('enables all Sundays of the target month by default when enabledSundays is empty or unconfigured', () => {
    const sundayDateMap = buildSundayDateMap('August_2026', {})
    expect(Object.keys(sundayDateMap)).toEqual(['sunday_1', 'sunday_2', 'sunday_3', 'sunday_4', 'sunday_5'])

    const row = {
      ...baseRow,
      edited: {
        ...baseRow.edited,
        sunday_1: 'P',
        sunday_2: 'A',
        sunday_3: 'P',
        sunday_4: 'A',
        sunday_5: 'P',
      },
    }
    const plan = buildCsvSavePlan({
      importRows: [row],
      targetTable: 'August_2026',
      sundayDateMap,
      ownerId: 'owner',
      workspaceName: 'Synthetic Workspace',
      allowSafeNew: true,
    })
    expect(plan[0].attendancePayload).toEqual({
      '2026-08-02': true,
      '2026-08-09': false,
      '2026-08-16': true,
      '2026-08-23': false,
      '2026-08-30': true,
    })
  })

  it('reuses previously created member IDs during repair reprocessing instead of creating duplicates', () => {
    const repairedRows = [
      {
        ...baseRow,
        importRowId: 'repair-row-1',
        needsReprocess: true,
        reprocessAttempt: 1,
        edited: {
          ...baseRow.edited,
          fullName: 'Repaired Person',
          phoneNumber: '0241234567',
          sunday_1: 'P',
          sunday_2: 'A',
          sunday_4: 'X',
          sunday_5: '✓',
        },
        bulkCreate: { memberId: 'prev-created-uuid-1', sourceSheet: 'Sheet 5', sourceRow: 1 },
        match: { status: 'new' },
      },
    ]
    const sundayDateMap = buildSundayDateMap('August_2026', {})
    const plan = buildCsvSavePlan({
      importRows: repairedRows,
      targetTable: 'August_2026',
      sundayDateMap,
      ownerId: 'owner',
      workspaceName: 'Synthetic Workspace',
      processRemaining: true,
    })

    expect(plan[0].action).toBe('update')
    expect(plan[0].memberId).toBe('prev-created-uuid-1')
    expect(plan[0].profileUpdates['Full Name']).toBe('Repaired Person')
    expect(plan[0].attendancePayload).toEqual({
      '2026-08-02': true,
      '2026-08-09': false,
      '2026-08-23': false,
      '2026-08-30': true,
    })
    expect(plan[0].attendancePayload['2026-08-16']).toBeUndefined()
  })

  it('rejects a date outside the selected target month', () => {
    expect(() => buildSundayNamesSavePlan({ importRows: [], targetTable: 'August_2026', selectedSundayDate: '2026-09-06' })).toThrow(/exactly one Sunday/)
  })
})
