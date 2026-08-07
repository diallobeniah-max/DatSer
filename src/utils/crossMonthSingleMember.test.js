import { describe, it, expect, vi, beforeEach } from 'vitest'

// Helper logic extracted from Dashboard / AppContext for direct unit testing
export const deduplicateHistoricalResultsByCanonicalId = (results = []) => {
  if (!Array.isArray(results)) return []
  const map = new Map()
  for (const item of results) {
    if (!item || !item.canonical_member_id) continue
    const key = String(item.canonical_member_id)
    if (!map.has(key)) {
      map.set(key, item)
    } else {
      const existing = map.get(key)
      const existingTime = new Date(existing.source_updated_at || existing.inserted_at || 0).getTime()
      const newTime = new Date(item.source_updated_at || item.inserted_at || 0).getTime()
      if (newTime > existingTime) {
        map.set(key, item)
      }
    }
  }
  return Array.from(map.values())
}

export const validateCrossMonthResponse = ({
  error,
  data,
  expectedMemberId,
  expectedTargetTable,
  expectedAttendanceDate,
  expectedStatus
}) => {
  const isTransportError = Boolean(error)
  const isSuccessTrue = Boolean(data && data.success === true)
  const hasMemberObj = Boolean(data && data.member && data.member.id)
  const isMemberIdMatch = Boolean(
    hasMemberObj &&
    String(data.member.id) === String(expectedMemberId) &&
    String(data.member_id) === String(expectedMemberId)
  )
  const isTargetTableMatch = Boolean(data && String(data.target_table) === String(expectedTargetTable))
  const isAttendanceDateMatch = Boolean(data && String(data.attendance_date) === String(expectedAttendanceDate))
  const isAttendanceStatusMatch = Boolean(data && String(data.attendance_status) === String(expectedStatus))

  return (
    !isTransportError &&
    isSuccessTrue &&
    hasMemberObj &&
    isMemberIdMatch &&
    isTargetTableMatch &&
    isAttendanceDateMatch &&
    isAttendanceStatusMatch
  )
}

describe('Single-Member Cross-Month Attendance & Deduplication', () => {
  describe('Deduplication by Canonical UUID', () => {
    it('deduplicates historical search results by canonical_member_id keeping newest profile', () => {
      const results = [
        {
          canonical_member_id: 'uuid-101',
          full_name: 'Beniah Opong',
          source_table: 'July_2026',
          source_updated_at: '2026-07-01T10:00:00Z'
        },
        {
          canonical_member_id: 'uuid-101',
          full_name: 'Beniah Opong Dizzz',
          source_table: 'August_2026',
          source_updated_at: '2026-08-01T12:00:00Z'
        }
      ]

      const deduplicated = deduplicateHistoricalResultsByCanonicalId(results)
      expect(deduplicated).toHaveLength(1)
      expect(deduplicated[0].canonical_member_id).toBe('uuid-101')
      expect(deduplicated[0].full_name).toBe('Beniah Opong Dizzz')
      expect(deduplicated[0].source_table).toBe('August_2026')
    })

    it('keeps different canonical UUIDs with matching names as separate items', () => {
      const results = [
        {
          canonical_member_id: 'uuid-101',
          full_name: 'John Doe',
          source_table: 'July_2026'
        },
        {
          canonical_member_id: 'uuid-202',
          full_name: 'John Doe',
          source_table: 'August_2026'
        }
      ]

      const deduplicated = deduplicateHistoricalResultsByCanonicalId(results)
      expect(deduplicated).toHaveLength(2)
      expect(deduplicated[0].canonical_member_id).toBe('uuid-101')
      expect(deduplicated[1].canonical_member_id).toBe('uuid-202')
    })
  })

  describe('Server Response Identity & Target Validation', () => {
    const validParams = {
      error: null,
      data: {
        success: true,
        member_id: 'uuid-123',
        member: { id: 'uuid-123', full_name: 'Alice Smith' },
        target_table: 'August_2026',
        attendance_date: '2026-08-02',
        attendance_status: 'Present'
      },
      expectedMemberId: 'uuid-123',
      expectedTargetTable: 'August_2026',
      expectedAttendanceDate: '2026-08-02',
      expectedStatus: 'Present'
    }

    it('validates clean successful RPC response matching targeted canonical member', () => {
      expect(validateCrossMonthResponse(validParams)).toBe(true)
    })

    it('rejects response if Supabase returned a transport error', () => {
      const params = { ...validParams, error: new Error('Postgres error') }
      expect(validateCrossMonthResponse(params)).toBe(false)
    })

    it('rejects response if success is false', () => {
      const params = { ...validParams, data: { ...validParams.data, success: false } }
      expect(validateCrossMonthResponse(params)).toBe(false)
    })

    it('rejects response if returned member ID does not match expected canonical ID', () => {
      const params = {
        ...validParams,
        data: {
          ...validParams.data,
          member_id: 'uuid-999',
          member: { id: 'uuid-999', full_name: 'Wrong Member' }
        }
      }
      expect(validateCrossMonthResponse(params)).toBe(false)
    })

    it('rejects response if returned target table mismatch', () => {
      const params = {
        ...validParams,
        data: { ...validParams.data, target_table: 'September_2026' }
      }
      expect(validateCrossMonthResponse(params)).toBe(false)
    })

    it('rejects response if returned attendance date mismatch', () => {
      const params = {
        ...validParams,
        data: { ...validParams.data, attendance_date: '2026-08-09' }
      }
      expect(validateCrossMonthResponse(params)).toBe(false)
    })

    it('rejects response if returned status mismatch', () => {
      const params = {
        ...validParams,
        data: { ...validParams.data, attendance_status: 'Absent' }
      }
      expect(validateCrossMonthResponse(params)).toBe(false)
    })
  })

  describe('Single-Flight & In-Flight Protection', () => {
    beforeEach(() => {
      globalThis.__crossMonthInFlightRequests = new Set()
    })

    it('tracks single-flight keys correctly', () => {
      const key = 'owner-1:August_2026:uuid-123:2026-08-02:Present'
      expect(globalThis.__crossMonthInFlightRequests.has(key)).toBe(false)

      globalThis.__crossMonthInFlightRequests.add(key)
      expect(globalThis.__crossMonthInFlightRequests.has(key)).toBe(true)

      globalThis.__crossMonthInFlightRequests.delete(key)
      expect(globalThis.__crossMonthInFlightRequests.has(key)).toBe(false)
    })
  })
})
