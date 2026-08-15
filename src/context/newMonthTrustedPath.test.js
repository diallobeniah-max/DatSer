import { describe, expect, it } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const context = fs.readFileSync(path.join(root, 'src/context/AppContext.jsx'), 'utf8')

describe('New Month trusted creation path', () => {
  it('uses one logical server-controlled month request instead of legacy raw-table RPCs', () => {
    const start = context.indexOf('const createNewMonth = async')
    const end = context.indexOf('const activeMembers = useMemo', start)
    const createNewMonth = context.slice(start, end)
    expect(createNewMonth).toContain("'create_workspace_month'")
    expect(createNewMonth).toContain('p_year: Number(year)')
    expect(createNewMonth).toContain('p_month: MONTHS_IN_YEAR.indexOf(monthName) + 1')
    expect(createNewMonth).toContain('p_source_month: sourceMonthStart')
    expect(createNewMonth).not.toContain("'create_month_from_current'")
    expect(createNewMonth).not.toContain("'reset_month_members'")
    expect(createNewMonth).not.toContain("'insert_selected_members'")
    expect(createNewMonth).not.toContain(".from('user_month_tables')")
  })
})
