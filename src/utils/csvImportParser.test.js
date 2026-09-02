import { describe, expect, it } from 'vitest'
import { CSV_IMPORT_MODE, detectCSVImportMode, normalizeAttendanceValue, parseCSVText } from './csvImportParser'

describe('CSV Import parser', () => {
  it('normalizes aliases, sheets, names, phones, and stable row identities', () => {
    const csv = [
      'Sheet,Name,Phone,Gender,S1,S2',
      '1,ama SERWAA,+233 24 111 2233,f,present,A',
      'Second,kojo mensah,055 123 4567,m,x,',
    ].join('\n')
    const parsed = parseCSVText(csv, 'synthetic-session')
    expect(parsed.errors).toEqual([])
    expect(parsed.rows).toHaveLength(2)
    expect(parsed.rows[0]).toMatchObject({
      importRowId: 'synthetic-session__Sheet_1__row1',
      sheet: 'Sheet 1',
      edited: { fullName: 'Ama Serwaa', phoneNumber: '0241112233', gender: 'Female', sunday_1: 'PRESENT', sunday_2: 'ABSENT' },
    })
    expect(parsed.rows[1]).toMatchObject({
      sheet: 'Second',
      edited: { fullName: 'Kojo Mensah', phoneNumber: '0551234567', gender: 'Male', sunday_1: 'ABSENT', sunday_2: 'UNSPECIFIED' },
    })
  })

  it('strictly maps P and check to PRESENT, and A and X to ABSENT', () => {
    expect(normalizeAttendanceValue('P')).toBe('PRESENT')
    expect(normalizeAttendanceValue('present')).toBe('PRESENT')
    expect(normalizeAttendanceValue('✓')).toBe('PRESENT')
    expect(normalizeAttendanceValue('✔')).toBe('PRESENT')
    expect(normalizeAttendanceValue('A')).toBe('ABSENT')
    expect(normalizeAttendanceValue('absent')).toBe('ABSENT')
    expect(normalizeAttendanceValue('X')).toBe('ABSENT')
    expect(normalizeAttendanceValue('x')).toBe('ABSENT')
    expect(normalizeAttendanceValue('✗')).toBe('ABSENT')
    expect(normalizeAttendanceValue('✘')).toBe('ABSENT')
    expect(normalizeAttendanceValue('')).toBe('UNSPECIFIED')
    expect(normalizeAttendanceValue(null)).toBe('UNSPECIFIED')
    expect(normalizeAttendanceValue(undefined)).toBe('UNSPECIFIED')
  })

  it('keeps unknown attendance explicit instead of silently treating it as absent', () => {
    expect(normalizeAttendanceValue('maybe')).toBe('UNKNOWN')
    const parsed = parseCSVText('Name,S1\nSynthetic Person,maybe', 's')
    expect(parsed.rows[0].edited.sunday_1).toBe('UNKNOWN')
    expect(parsed.rows[0].attendanceFlags.sunday_1.message).toContain('maybe')
  })

  it('rejects input without a name column and never creates partial rows', () => {
    const parsed = parseCSVText('Phone,S1\n0240000000,P', 's')
    expect(parsed.rows).toEqual([])
    expect(parsed.errors[0].message).toContain('full_name')
  })

  it('detects a names-only CSV without changing full-register detection', () => {
    expect(detectCSVImportMode('full_name\nAma Serwaa')).toMatchObject({ mode: CSV_IMPORT_MODE.SUNDAY_NAMES, confidence: 'high' })
    expect(detectCSVImportMode('full_name,phone,age\nAma Serwaa,0240000000,14')).toMatchObject({ mode: CSV_IMPORT_MODE.FULL_REGISTER })
  })

  it('accepts plain one-name-per-line input and preserves raw spelling', () => {
    const parsed = parseCSVText('AMA serwaa\nKojo Mensah', 'names', { mode: CSV_IMPORT_MODE.SUNDAY_NAMES })
    expect(parsed.errors).toEqual([])
    expect(parsed.rows).toHaveLength(2)
    expect(parsed.rows[0]).toMatchObject({ mode: CSV_IMPORT_MODE.SUNDAY_NAMES, rawFullName: 'AMA serwaa', edited: { fullName: 'Ama Serwaa' } })
  })

  it('keeps ambiguous single-token text undecided', () => {
    expect(detectCSVImportMode('Ama\nKojo')).toMatchObject({ mode: null, confidence: 'ambiguous' })
  })
})
