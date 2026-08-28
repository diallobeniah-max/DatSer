// @vitest-environment node
import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const preparation = fs.readFileSync(path.join(root, 'supabase/migrations/20260814005049_prepare_historic_member_provenance_reconciliation.sql'), 'utf8')
const exclusions = fs.readFileSync(path.join(root, 'supabase/migrations/20260814074221_add_historic_provenance_exclusions.sql'), 'utf8')
const cutover = fs.readFileSync(path.join(root, 'supabase/migrations/20260814122618_20260813170000_harden_paper_scan_final_save.sql'), 'utf8')

describe('operator verified historic provenance overrides and exclusions', () => {
  it('1. applied preparation migration contains only overrides and matches live applied design', () => {
    expect(preparation).toContain('create table if not exists public.workspace_member_provenance_overrides')
    expect(preparation).toContain('member_id uuid primary key')
    expect(preparation).not.toContain('workspace_member_provenance_exclusions')
    expect(preparation).not.toContain('record_workspace_member_provenance_exclusion')
  })

  it('2. exclusion migration defines distinct strict blank and operator-confirmed sparse legacy reasons', () => {
    expect(exclusions).toContain('create table if not exists public.workspace_member_provenance_exclusions')
    expect(exclusions).toContain("exclusion_reason in ('blank_legacy_placeholder', 'operator_confirmed_sparse_legacy_placeholder', 'invalid_historic_artifact')")
  })

  it('3. override and exclusion share the same canonical-member transaction lock', () => {
    expect(exclusions).toContain("perform pg_advisory_xact_lock(hashtextextended(p_member_id::text, 0));")
    const overrideFnStart = exclusions.indexOf('create or replace function public.record_workspace_member_provenance_override(')
    const overrideFn = exclusions.slice(overrideFnStart, exclusions.indexOf('$$;', overrideFnStart))
    expect(overrideFn).toContain("perform pg_advisory_xact_lock(hashtextextended(p_member_id::text, 0));")

    const exclusionFnStart = exclusions.indexOf('create or replace function public.record_workspace_member_provenance_exclusion(')
    const exclusionFn = exclusions.slice(exclusionFnStart, exclusions.indexOf('$$;', exclusionFnStart))
    expect(exclusionFn).toContain("perform pg_advisory_xact_lock(hashtextextended(p_member_id::text, 0));")
  })

  it('4. reciprocal exclusion/override checks occur strictly after acquiring the advisory lock', () => {
    const overrideFnStart = exclusions.indexOf('create or replace function public.record_workspace_member_provenance_override(')
    const overrideFn = exclusions.slice(overrideFnStart, exclusions.indexOf('$$;', overrideFnStart))
    const overrideLock = overrideFn.indexOf('pg_advisory_xact_lock')
    const overrideExclusionCheck = overrideFn.indexOf('workspace_member_provenance_exclusions where member_id = p_member_id')
    expect(overrideLock).toBeGreaterThan(0)
    expect(overrideExclusionCheck).toBeGreaterThan(overrideLock)

    const exclusionFnStart = exclusions.indexOf('create or replace function public.record_workspace_member_provenance_exclusion(')
    const exclusionFn = exclusions.slice(exclusionFnStart, exclusions.indexOf('$$;', exclusionFnStart))
    const exclusionLock = exclusionFn.indexOf('pg_advisory_xact_lock')
    const exclusionOverrideCheck = exclusionFn.indexOf('workspace_member_provenance_overrides where member_id = p_member_id')
    expect(exclusionLock).toBeGreaterThan(0)
    expect(exclusionOverrideCheck).toBeGreaterThan(exclusionLock)
  })

  it('5. exclusion RPC routes to dedicated validators for strict blank vs operator-confirmed sparse legacy', () => {
    const exclusionFnStart = exclusions.indexOf('create or replace function public.record_workspace_member_provenance_exclusion(')
    const exclusionFn = exclusions.slice(exclusionFnStart, exclusions.indexOf('$$;', exclusionFnStart))

    expect(exclusionFn).toContain("p_exclusion_reason = 'operator_confirmed_sparse_legacy_placeholder'")
    expect(exclusionFn).toContain('public.is_valid_historic_sparse_legacy_placeholder(p_member_id)')
    expect(exclusionFn).toContain('public.is_valid_historic_blank_placeholder(p_member_id)')
  })

  it('6. strict blank placeholder validator rejects any meaningful evidence including DOB and gender', () => {
    const helperStart = exclusions.indexOf('create or replace function public.is_valid_historic_blank_placeholder(')
    const helper = exclusions.slice(helperStart, exclusions.indexOf('$$;', helperStart))
    expect(helper).toContain("'full name'")
    expect(helper).toContain("'phone number'")
    expect(helper).toContain("'date_of_birth'")
    expect(helper).toContain("'gender'")
    expect(helper).toContain("'current level'")
    expect(helper).toContain("'parent_name_1'")
    expect(helper).toContain("'parent_phone_1'")
    expect(helper).toContain("'notes'")
    expect(helper).toContain('attendance_')
  })

  it('7. sparse legacy placeholder validator counts physical rows across tables and checks direct member code columns', () => {
    const helperStart = exclusions.indexOf('create or replace function public.is_valid_historic_sparse_legacy_placeholder(')
    const helper = exclusions.slice(helperStart, exclusions.indexOf('$$;', helperStart))
    expect(helper).toContain('public.workspace_member_codes')
    expect(helper).toContain('public.workspace_member_provenance_overrides')
    expect(helper).toContain('select count(*) from public.%I where id = $1')
    expect(helper).toContain('v_occurrences := v_occurrences + v_table_rows')
    expect(helper).toContain('if v_occurrences > 1 then')
    expect(helper).toContain("'member_code'")
    expect(helper).toContain("'manual badge'")
    expect(helper).toContain("'badge type'")
    expect(helper).toContain("'full name'")
    expect(helper).toContain("'phone number'")
    expect(helper).toContain("'current level'")
    expect(helper).toContain("'parent_name_1'")
    expect(helper).toContain("'parent_phone_1'")
    expect(helper).toContain('attendance_')
  })

  it('8. excluded UUID never receives workspace_owner_id during backfill', () => {
    const start = cutover.lastIndexOf('create or replace function public.reconcile_month_member_workspace_provenance(')
    const body = cutover.slice(start, cutover.indexOf('$$;', start))
    expect(body).toContain("''excluded'', count(*) filter (where workspace_owner_id is null and is_excluded)")
    expect(body).not.toContain('set workspace_owner_id = exclusion')
    expect(body).not.toContain('set workspace_owner_id = ex.')
  })

  it('9. operator only can exclude: blocks normal users, collaborators, and anonymous sessions', () => {
    expect(exclusions).toContain("create or replace function public.record_workspace_member_provenance_exclusion(")
    expect(exclusions).toContain("v_actor := public.require_historic_provenance_operator();")
    expect(exclusions).toContain("revoke all on function public.record_workspace_member_provenance_exclusion(uuid, text, text, integer) from public, anon;")
    expect(exclusions).toContain("grant execute on function public.record_workspace_member_provenance_exclusion(uuid, text, text, integer) to authenticated;")
    expect(exclusions).toContain("revoke all on table public.workspace_member_provenance_exclusions from public, anon, authenticated;")
  })

  it('10. hardening override backfill defensively skips any excluded member', () => {
    const start = cutover.lastIndexOf('create or replace function public.reconcile_month_member_workspace_provenance(')
    const body = cutover.slice(start, cutover.indexOf('$$;', start))
    expect(body).toContain('not exists (')
    expect(body).toContain('from public.workspace_member_provenance_exclusions ex')
    expect(body).toContain('where ex.member_id = override.member_id')
  })

  it('11. cutover guard aborts if any overlap exists between overrides and exclusions', () => {
    const guardStart = cutover.lastIndexOf('create or replace function public.assert_historic_member_provenance_cutover(')
    const guard = cutover.slice(guardStart, cutover.indexOf('$$;', guardStart))
    expect(guard).toContain('from public.workspace_member_provenance_overrides o')
    expect(guard).toContain('join public.workspace_member_provenance_exclusions e on e.member_id = o.member_id')
    expect(guard).toContain('if v_overlap > 0 then')
  })

  it('12. behavioral simulation: strict blank validator rejects any metadata; sparse validator enforces single physical row, checks member codes, and allows only stray metadata', () => {
    const isStrictBlankSim = (row) => {
      const name = (row['Full Name'] || row.full_name || row.name || '').trim()
      const isDummyName = /^(test|dummy|asdf|xxx|null|none)$/i.test(name)
      const hasName = name.length > 0 && !isDummyName

      const phone = (row['Phone Number'] || row.phone_number || row.phone || '').replace(/\D/g, '')
      const hasPhone = phone.length >= 4

      const dob = (row.date_of_birth || row['date of birth'] || row.dob || '').toString().trim()
      const hasDob = dob.length > 0

      const gender = (row.Gender || row.gender || '').trim()
      const hasGender = gender.length > 0

      const level = (row['Current Level'] || row.current_level || row.level || '').trim()
      const hasLevel = level.length > 0

      const hasParent = Boolean((row.parent_name_1 || '').trim() || (row.parent_name_2 || '').trim() || (row.guardian_name || '').trim())
      const hasParentPhone = Boolean((row.parent_phone_1 || '').replace(/\D/g, '') || (row.parent_phone_2 || '').replace(/\D/g, '') || (row.guardian_phone || '').replace(/\D/g, ''))
      const hasNotes = Boolean((row.notes || row.note || '').trim())
      const hasAttendance = Object.keys(row).some(k => k.startsWith('attendance_') && row[k] && row[k] !== false && row[k] !== 'false')

      if (hasName || hasPhone || hasDob || hasGender || hasLevel || hasParent || hasParentPhone || hasNotes || hasAttendance) {
        return false
      }
      return true
    }

    const isSparseLegacySim = (rowsByMonth, codeClaims = 0, hasOverride = false) => {
      if (codeClaims > 0 || hasOverride) return false

      let totalPhysicalRows = 0
      for (const monthRows of Object.values(rowsByMonth)) {
        totalPhysicalRows += monthRows.length
      }
      if (totalPhysicalRows !== 1) return false

      const singleRow = Object.values(rowsByMonth).flatMap(r => r)[0]

      const name = (singleRow['Full Name'] || singleRow.full_name || singleRow.name || '').trim()
      const isDummyName = /^(test|dummy|asdf|xxx|null|none)$/i.test(name)
      const hasName = name.length > 0 && !isDummyName

      const phone = (singleRow['Phone Number'] || singleRow.phone_number || singleRow.phone || '').replace(/\D/g, '')
      const hasPhone = phone.length >= 4

      const level = (singleRow['Current Level'] || singleRow.current_level || singleRow.level || '').trim()
      const hasLevel = level.length > 0

      const hasParent = Boolean((singleRow.parent_name_1 || '').trim() || (singleRow.parent_name_2 || '').trim() || (singleRow.guardian_name || '').trim())
      const hasParentPhone = Boolean((singleRow.parent_phone_1 || '').replace(/\D/g, '') || (singleRow.parent_phone_2 || '').replace(/\D/g, '') || (singleRow.guardian_phone || '').replace(/\D/g, ''))
      const hasNotes = Boolean((singleRow.notes || singleRow.note || '').trim())

      const memberCodeVal = (singleRow['Manual Badge'] || singleRow.manual_badge || singleRow['Badge Type'] || singleRow.badge_type || singleRow.member_code || singleRow['member code'] || '').toString().trim().toLowerCase()
      const hasMemberCode = memberCodeVal.length > 0 && !['none', 'null', 'false', '0'].includes(memberCodeVal)

      const hasAttendance = Object.keys(singleRow).some(k => k.startsWith('attendance_') && singleRow[k] && singleRow[k] !== false && singleRow[k] !== 'false')

      if (hasName || hasPhone || hasLevel || hasParent || hasParentPhone || hasNotes || hasMemberCode || hasAttendance) {
        return false
      }
      return true
    }

    // 1. Strict blank placeholder
    const trulyBlank = { 'Full Name': null, 'Phone Number': null }
    expect(isStrictBlankSim(trulyBlank)).toBe(true)
    expect(isSparseLegacySim({ February_2026: [trulyBlank] })).toBe(true)

    // 2. The exact 3 sparse placeholders:
    // 4afe1371... (Gender: 'male', Age: '34')
    const sparse4afe = { Gender: 'male', Age: '34' }
    expect(isStrictBlankSim(sparse4afe)).toBe(false)
    expect(isSparseLegacySim({ February_2026: [sparse4afe] })).toBe(true)

    // 71de7f13... (Gender: 'male', Age: '13')
    const sparse71de = { Gender: 'male', Age: '13' }
    expect(isStrictBlankSim(sparse71de)).toBe(false)
    expect(isSparseLegacySim({ February_2026: [sparse71de] })).toBe(true)

    // ecaecdd3... (date_of_birth: '1999-05-19', Age: '26')
    const sparseEcae = { date_of_birth: '1999-05-19', Age: '26' }
    expect(isStrictBlankSim(sparseEcae)).toBe(false)
    expect(isSparseLegacySim({ March_2026: [sparseEcae] })).toBe(true)

    // 3. The real uncertain member 58268530... (has phone, gender, DOB, level) -> FAILS BOTH
    const real5826 = {
      'Phone Number': '0507003871',
      Gender: 'Female',
      date_of_birth: '2009-12-25',
      'Current Level': 'COMPLETED'
    }
    expect(isStrictBlankSim(real5826)).toBe(false)
    expect(isSparseLegacySim({ June_2026: [real5826] })).toBe(false)

    // 4. Codex requirement: DUPLICATE ROW IN SAME MONTH TABLE -> FAILS
    expect(isSparseLegacySim({ February_2026: [sparse4afe, sparse4afe] })).toBe(false)

    // 5. Duplicate row across multiple month tables -> FAILS
    expect(isSparseLegacySim({ February_2026: [sparse4afe], March_2026: [sparse4afe] })).toBe(false)

    // 6. Direct historic member code in month row -> FAILS
    expect(isSparseLegacySim({ February_2026: [{ ...sparse4afe, 'Manual Badge': 'DAT-001' }] })).toBe(false)
    expect(isSparseLegacySim({ February_2026: [{ ...sparse4afe, 'Badge Type': 'STANDARD' }] })).toBe(false)
    expect(isSparseLegacySim({ February_2026: [{ ...sparse4afe, member_code: 'CODE-99' }] })).toBe(false)

    // 7. Workspace member code claims > 0 -> FAILS
    expect(isSparseLegacySim({ February_2026: [sparse4afe] }, 1)).toBe(false)

    // 8. Active override present -> FAILS
    expect(isSparseLegacySim({ February_2026: [sparse4afe] }, 0, true)).toBe(false)
  })
})
