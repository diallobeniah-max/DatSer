import { describe, expect, it } from 'vitest'
import { CSV_MATCH_STATUS, matchAllImportRows, matchImportRow } from './csvImportMatching'

const row = (edited) => ({ edited: { fullName: '', phoneNumber: '', memberCode: '', ...edited } })
const member = (id, name, phone, code) => ({ id, 'Full Name': name, 'Phone Number': phone, member_code: code })

describe('CSV Import matching', () => {
  it('prefers an exact member code over conflicting name or phone evidence', () => {
    const result = matchImportRow(row({ fullName: 'Different Name', phoneNumber: '0240000000', memberCode: 'A07' }), [
      member('m1', 'Ama Serwaa', '0550000000', 'A07'),
      member('m2', 'Different Name', '0240000000', 'B01'),
    ])
    expect(result.status).toBe(CSV_MATCH_STATUS.EXACT)
    expect(result.selectedMemberId).toBe('m1')
  })

  it('requires operator choice when a phone or exact name has multiple candidates', () => {
    const result = matchImportRow(row({ fullName: 'Ama Serwaa', phoneNumber: '0240000000' }), [
      member('m1', 'Ama Serwaa', '0240000000'),
      member('m2', 'Ama Serwaa', '0240000000'),
    ])
    expect(result.status).toBe(CSV_MATCH_STATUS.POSSIBLE)
    expect(result.selectedMemberId).toBeNull()
    expect(result.candidates).toHaveLength(2)
  })

  it('never silently accepts a fuzzy candidate', () => {
    const result = matchImportRow(row({ fullName: 'Joseph Mensa' }), [member('m1', 'Joseph Mensah', '')])
    expect(result.status).toBe(CSV_MATCH_STATUS.POSSIBLE)
    expect(result.selectedMemberId).toBeNull()
  })

  it('uses unmatched rather than new for a names-only row', () => {
    const result = matchImportRow(row({ fullName: 'No Such Member' }), [], { mode: 'sunday_names' })
    expect(result.status).toBe(CSV_MATCH_STATUS.UNMATCHED)
  })

  it('requires a choice when a code is duplicated', () => {
    const result = matchImportRow(row({ fullName: 'Ama Serwaa', memberCode: 'A07' }), [member('m1', 'Ama Serwaa', '', 'A07'), member('m2', 'Ama Other', '', 'A07')])
    expect(result).toMatchObject({ status: CSV_MATCH_STATUS.POSSIBLE, selectedMemberId: null })
  })

  it('preserves duplicate source rows while marking later copies', () => {
    const sourceRows = [
      { importRowId: 'r1', mode: 'sunday_names', rawFullName: 'AMA SERWAA', edited: { fullName: 'Ama Serwaa', phoneNumber: '', memberCode: '' }, fieldResolution: {} },
      { importRowId: 'r2', mode: 'sunday_names', rawFullName: 'Ama Serwaa', edited: { fullName: 'Ama Serwaa', phoneNumber: '', memberCode: '' }, fieldResolution: {} },
    ]
    const matched = matchAllImportRows(sourceRows, [member('m1', 'Ama Serwaa', '')], { mode: 'sunday_names' })
    expect(matched).toHaveLength(2)
    expect(matched[0].duplicateOfRowId).toBeNull()
    expect(matched[1].duplicateOfRowId).toBe('r1')
  })
})
