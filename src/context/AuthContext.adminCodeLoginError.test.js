import { describe, expect, it } from 'vitest'
import { getAdminCodeLoginErrorMessage } from './AuthContext'

describe('getAdminCodeLoginErrorMessage', () => {
  it('keeps a stopped Edge Runtime from being presented as an invalid admin code', () => {
    expect(getAdminCodeLoginErrorMessage({
      message: 'Edge Function returned a non-2xx status code'
    })).toBe('Admin login is temporarily unavailable. Please try again shortly.')
  })

  it('retains the existing migration setup guidance for a missing function RPC', () => {
    expect(getAdminCodeLoginErrorMessage({ code: '42883', message: 'function does not exist' }))
      .toBe('Admin code login is not set up yet. Apply the latest Supabase migration first.')
  })
})
