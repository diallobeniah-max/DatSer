// @vitest-environment jsdom
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'

vi.mock('../lib/supabase', () => ({
  supabase: {
    rpc: vi.fn(),
    from: vi.fn(() => ({
      select: vi.fn().mockReturnThis(),
      insert: vi.fn().mockReturnThis(),
      update: vi.fn().mockReturnThis(),
      delete: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      in: vi.fn().mockReturnThis(),
      limit: vi.fn().mockReturnThis(),
      single: vi.fn(() => Promise.resolve({ data: null, error: null }))
    })),
    auth: {
      getSession: vi.fn(() => Promise.resolve({ data: { session: null }, error: null })),
      onAuthStateChange: vi.fn(() => ({ data: { subscription: { unsubscribe: vi.fn() } } }))
    }
  },
  isSupabaseConfigured: () => true,
  hasStoredSession: () => false
}))

import { supabase } from '../lib/supabase'
import {
  SETTINGS_REGISTRY,
  SETTINGS_SCOPES,
  getPersonalSettingsDefaults,
  getWorkspaceSettingsDefaults
} from '../config/settingsRegistry'
import {
  clearPreferenceCache,
  generateRequestId,
  getCachedPreferenceBundle,
  loadPreferenceBundle,
  savePersonalPreferencePatch,
  saveWorkspacePreferencePatch
} from './preferenceService'
import { resetHealthCoordinator } from '../utils/backendHealthCoordinator'

describe('Settings Registry & Preference Service', () => {
  beforeEach(() => {
    supabase.rpc.mockReset()
    clearPreferenceCache()
    resetHealthCoordinator()
  })

  afterEach(() => {
    supabase.rpc.mockReset()
  })

  it('validates settings registry scopes and defaults', () => {
    Object.values(SETTINGS_REGISTRY).forEach((item) => {
      expect(item.key).toBeDefined()
      expect(Object.values(SETTINGS_SCOPES)).toContain(item.scope)
    })

    const personalDefaults = getPersonalSettingsDefaults()
    expect(personalDefaults.theme_mode).toBe('system')
    expect(personalDefaults.motion_and_sounds_enabled).toBe(true)

    const workspaceDefaults = getWorkspaceSettingsDefaults()
    expect(workspaceDefaults.workspace_member_codes_enabled).toBe(true)
    expect(workspaceDefaults.historical_search_settings.mode).toBe('all_previous')
  })

  it('hydrates preference bundle from RPC', async () => {
    supabase.rpc.mockResolvedValueOnce({
      data: {
        personal_preferences: { theme_mode: 'dark' },
        workspace_preferences: { member_code_church_name: 'St Marks Church' },
        personal_revision: '1',
        workspace_revision: '1',
        is_owner: true
      },
      error: null
    })

    const bundle = await loadPreferenceBundle('owner-uuid-123')
    expect(bundle.personalPreferences.theme_mode).toBe('dark')
    expect(bundle.workspacePreferences.member_code_church_name).toBe('St Marks Church')
    expect(bundle.personalRevision).toBe(1n)
    expect(bundle.workspaceRevision).toBe(1n)
  })

  it('validates preference keys before saving', async () => {
    const invalidPersonal = await savePersonalPreferencePatch({ invalid_key: 'test' })
    expect(invalidPersonal.success).toBe(false)
    expect(invalidPersonal.code).toBe('UNSUPPORTED_PREFERENCE_KEY')

    const invalidWorkspace = await saveWorkspacePreferencePatch('owner-uuid-123', { invalid_key: 'test' })
    expect(invalidWorkspace.success).toBe(false)
    expect(invalidWorkspace.code).toBe('UNSUPPORTED_PREFERENCE_KEY')
  })

  it('saves personal preference patch with request ID and deduplicates in-flight calls', async () => {
    supabase.rpc.mockResolvedValueOnce({
      data: {
        personal_preferences: { theme_mode: 'light' },
        personal_revision: '5'
      },
      error: null
    })

    const reqId = generateRequestId('test')
    const p1 = savePersonalPreferencePatch({ theme_mode: 'light' }, { requestId: reqId })
    const p2 = savePersonalPreferencePatch({ theme_mode: 'light' }, { requestId: reqId })

    expect(p1).toBe(p2)

    const res = await p1
    expect(res.success).toBe(true)
    expect(res.requestId).toBe(reqId)
    expect(res.data.theme_mode).toBe('light')
    expect(getCachedPreferenceBundle().personalPreferences.theme_mode).toBe('light')
  })

  it('saves workspace preference patch for canonical owner', async () => {
    supabase.rpc.mockResolvedValueOnce({
      data: {
        workspace_preferences: { member_code_church_name: 'Holy Trinity' },
        workspace_revision: '3'
      },
      error: null
    })

    const res = await saveWorkspacePreferencePatch('owner-uuid-123', {
      member_code_church_name: 'Holy Trinity'
    })

    expect(supabase.rpc).toHaveBeenCalledWith('save_workspace_preferences', {
      p_owner_id: 'owner-uuid-123',
      p_preferences: { member_code_church_name: 'Holy Trinity' },
      p_expected_revision: 0,
      p_request_id: expect.any(String)
    })
    expect(res.success).toBe(true)
    expect(getCachedPreferenceBundle().workspacePreferences.member_code_church_name).toBe('Holy Trinity')
  })

  it('handles revision conflict (40001) error code gracefully', async () => {
    supabase.rpc.mockImplementation((name) => {
      if (name === 'get_preference_bundle') {
        return Promise.resolve({
          data: { personal_preferences: { theme_mode: 'system' }, personal_revision: '10' },
          error: null
        })
      }
      return Promise.resolve({
        data: null,
        error: { code: '40001', message: 'Revision conflict' }
      })
    })

    try {
      const res = await savePersonalPreferencePatch({ theme_mode: 'dark' })
      expect(res.success).toBe(false)
      expect(res.code).toBe('REVISION_CONFLICT')
    } finally {
      supabase.rpc.mockReset()
    }
  })

  it('clears in-memory preference cache on logout', async () => {
    supabase.rpc.mockResolvedValueOnce({
      data: {
        personal_preferences: { theme_mode: 'dark' },
        workspace_preferences: {},
        personal_revision: '2',
        workspace_revision: '2'
      },
      error: null
    })

    await loadPreferenceBundle('owner-uuid-123')
    expect(getCachedPreferenceBundle().personalPreferences.theme_mode).toBe('dark')

    clearPreferenceCache()
    expect(getCachedPreferenceBundle().personalPreferences.theme_mode).toBe('system')
  })

  it('bounds a hung preference bundle load with a timeout instead of hanging forever', async () => {
    vi.useFakeTimers()
    try {
      const neverResolves = new Promise(() => {})
      supabase.rpc.mockReturnValueOnce(neverResolves)

      const bundlePromise = loadPreferenceBundle('owner-timeout')
      const assertion = expect(bundlePromise).rejects.toThrow(/timed out/)
      vi.advanceTimersByTime(16 * 1000)
      await assertion
    } finally {
      vi.useRealTimers()
    }
  })
})
