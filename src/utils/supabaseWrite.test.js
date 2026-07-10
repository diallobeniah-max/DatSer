import { describe, expect, it } from 'vitest'
import {
  assertSupabaseMutationAffected,
  isTransientSupabaseError
} from './supabaseWrite'

describe('Supabase write reliability', () => {
  it('does not retry permanent permission errors', () => {
    expect(isTransientSupabaseError({ code: '42501', message: 'permission denied' })).toBe(false)
    expect(isTransientSupabaseError({ status: 503, message: 'service unavailable' })).toBe(true)
  })

  it('rejects silent zero-row mutations', () => {
    expect(() => assertSupabaseMutationAffected({ data: [] }, 'Attendance save'))
      .toThrow('Attendance save did not update a record')
    expect(assertSupabaseMutationAffected({ data: [{ id: 'member-1' }] })).toEqual({
      data: [{ id: 'member-1' }]
    })
  })
})
