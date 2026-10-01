import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const source = readFileSync(resolve(process.cwd(), 'src/context/AppContext.jsx'), 'utf8')

describe('AppContext Member V2 reconnect routing', () => {
  it('wakes the existing Member V2 adapter immediately for explicit Online and browser reconnects', () => {
    expect(source).toContain("import { getRealMemberV2UiAdapter, wakeRealMemberV2Sync } from '../experiments/rxdb-member-phase1/realMemberUiAdapter'")
    expect(source).toContain("const nextOfflineModeStatus = nextMode === 'offline'")
    expect(source).toContain('setRealDatserMemberV2Connection({')
    expect(source).toContain('void wakeRealMemberV2Sync().catch((error) => {')
    expect(source).toContain("if (offlineMode !== 'offline') {")
  })
})
