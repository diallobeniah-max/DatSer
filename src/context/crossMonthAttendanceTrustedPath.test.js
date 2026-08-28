// @vitest-environment node
import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const context = fs.readFileSync(path.join(root, 'context', 'AppContext.jsx'), 'utf8')

describe('cross-month attendance trusted RPC path', () => {
  it('sends logical source and target months, never client table identifiers', () => {
    const start = context.indexOf('const setMemberAttendanceFromOtherMonth = useCallback')
    const end = context.indexOf('const setPersonalCalendarMode', start)
    const body = context.slice(start, end)
    expect(body).toContain("'set_member_attendance_from_other_month'")
    expect(body).toContain('p_source_month: sourceMonthStart')
    expect(body).toContain('p_target_month: targetMonthStart')
    expect(body).not.toContain('p_source_table: sourceTable')
    expect(body).not.toContain('p_target_table: targetTable')
    expect(body).toContain('Source and target must be registered logical months')
  })
})
