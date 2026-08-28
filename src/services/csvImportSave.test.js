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
      importRows: [{ ...baseRow, match: { status: 'new', selectedMemberId: null } }],
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

  it('rejects a date outside the selected target month', () => {
    expect(() => buildSundayNamesSavePlan({ importRows: [], targetTable: 'August_2026', selectedSundayDate: '2026-09-06' })).toThrow(/exactly one Sunday/)
  })
})
