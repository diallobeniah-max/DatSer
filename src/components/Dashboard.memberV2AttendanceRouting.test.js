import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const dashboardSource = readFileSync(resolve(process.cwd(), 'src/components/Dashboard.jsx'), 'utf8')

describe('Dashboard Member V2 main-card attendance routing', () => {
  it('uses the authenticated identity and routes both main actions through the V2 attendance authority', () => {
    expect(dashboardSource).toContain("import { useAuth } from '../context/AuthContext'")
    expect(dashboardSource).toContain('const { user } = useAuth()')
    expect(dashboardSource).toContain('userId: user?.id')

    const mainHandlerStart = dashboardSource.indexOf('const handleAttendance = async (memberId, present) =>')
    const mainHandlerEnd = dashboardSource.indexOf('const handleAttendanceForDate = async')
    expect(mainHandlerStart).toBeGreaterThanOrEqual(0)
    expect(mainHandlerEnd).toBeGreaterThan(mainHandlerStart)
    const mainHandler = dashboardSource.slice(mainHandlerStart, mainHandlerEnd)
    expect(mainHandler).toContain('const targetDate = getDateString(selectedAttendanceDate)')
    expect(mainHandler).toContain('? await saveMemberV2Attendance(member, targetDate, nextStatus)')
    expect(mainHandler).toContain(': await markAttendance(memberId, new Date(targetDate), nextStatus)')

    const mainV2Routes = dashboardSource.match(/await saveMemberV2Attendance\(member, targetDate, nextStatus\)/g) || []
    expect(mainV2Routes).toHaveLength(1)
  })
})
