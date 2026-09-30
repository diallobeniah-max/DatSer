import { readFileSync, existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const repoRoot = process.cwd()
const runnerPath = resolve(repoRoot, 'scripts/local/test-member-v2-production-replay.ps1')
const manifestPath = resolve(repoRoot, 'tests/fixtures/production-replay/manifest.json')
const runner = readFileSync(runnerPath, 'utf8')
const browserConfig = readFileSync(resolve(repoRoot, 'playwright.real-member-v2-offline.config.js'), 'utf8')
const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))

describe('Member V2 production replay contract', () => {
  it('models historical applied versions explicitly without patching copied SQL', () => {
    expect(manifest.mode).toBe('known-production-history')
    for (const baseline of manifest.historicalBaselines) {
      expect(existsSync(resolve(repoRoot, baseline.fixture))).toBe(true)
      expect(runner).toContain(baseline.source.split('/').at(-1))
      expect(runner).toContain(baseline.fixture.split('/').at(-1))
    }
    expect(runner).not.toMatch(/\$shareSql|\$collaboratorSql|\$csvSql|missingPolicyClosers/)
    expect(runner).not.toMatch(/Set-Content\s+-LiteralPath\s+\$(?:share|collaborator|csv)/i)
    expect(runner).toContain('PRODUCTION_REPLAY_WITH_EXPLICIT_HISTORICAL_BASELINES: PASS')
  })

  it('targets the isolated local Supabase and Vite ports in browser replay', () => {
    expect(browserConfig).toContain('PLAYWRIGHT_REAL_MEMBER_V2_URL')
    expect(browserConfig).toContain("['127.0.0.1', 'localhost'].includes(localUrl.hostname)")
    expect(browserConfig).not.toContain("localUrl.port !== '54321'")
  })

  it('applies the retired POC contract only after production migration assertions', () => {
    const productionAssertion = runner.indexOf("Write-Output 'PRODUCTION_REPLAY_WITH_EXPLICIT_HISTORICAL_BASELINES: PASS'")
    const pocApply = runner.indexOf('psql -U postgres -d postgres -v ON_ERROR_STOP=1 -f $pocContainerPath')
    const databaseTests = runner.indexOf('test db --local')
    expect(productionAssertion).toBeGreaterThanOrEqual(0)
    expect(pocApply).toBeGreaterThan(productionAssertion)
    expect(databaseTests).toBeGreaterThan(pocApply)
    expect(runner).not.toContain('20260928114000_local_only_poc_phase0.sql')
  })
})
