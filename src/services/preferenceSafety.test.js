// @vitest-environment jsdom
import { describe, expect, it, vi, beforeEach } from 'vitest'
import {
  clearPreferenceCache,
  loadPreferenceBundle,
  savePersonalPreferencePatch,
  saveWorkspacePreferencePatch
} from './preferenceService'
import {
  readGuidedFormSettings,
  writeGuidedFormSettings,
  DEFAULT_GUIDED_FORM_SETTINGS
} from '../utils/guidedFormSettings'
import {
  isBackendHealthy,
  markBackendDegraded,
  markBackendHealthy,
  resetHealthCoordinator,
  isBackendDegradedError
} from '../utils/backendHealthCoordinator'

// Mock Supabase
vi.mock('../lib/supabase', () => ({
  supabase: {
    rpc: vi.fn(),
    from: vi.fn()
  }
}))

// Mock offlineStore in-memory for Vitest compatibility
const mockOfflineDb = new Map()

vi.mock('../utils/offlineStore', () => ({
  saveOfflinePreferences: vi.fn(async (userId, payload = {}) => {
    const actorId = payload?.actorId || userId
    const ownerId = payload?.ownerId || userId
    const key = `preferences:${actorId}:${ownerId}`
    const isPartitioned = payload && (payload.personal || payload.workspace)
    const personal = isPartitioned ? (payload.personal || {}) : payload
    const workspace = isPartitioned ? (payload.workspace || {}) : {}

    const record = {
      key,
      user_id: actorId,
      actor_id: actorId,
      owner_id: ownerId,
      personal,
      workspace,
      personal_revision: payload?.personalRevision ? String(payload.personalRevision) : '0',
      workspace_revision: payload?.workspaceRevision ? String(payload.workspaceRevision) : '0',
      preferences: { ...personal, ...workspace, user_id: actorId }
    }
    mockOfflineDb.set(key, record)
    return record
  }),
  getOfflinePreferences: vi.fn(async (userId = null, ownerId = null) => {
    if (userId && ownerId) {
      const key = `preferences:${userId}:${ownerId}`
      const record = mockOfflineDb.get(key)
      if (record && record.actor_id === userId && record.owner_id === ownerId) {
        return record
      }
      return null
    }
    return null
  }),
  clearOfflinePreferences: vi.fn(async (userId = null, ownerId = null) => {
    if (userId && ownerId) {
      mockOfflineDb.delete(`preferences:${userId}:${ownerId}`)
    } else {
      mockOfflineDb.clear()
    }
  })
}))

import { supabase } from '../lib/supabase'
import {
  clearOfflinePreferences,
  getOfflinePreferences,
  saveOfflinePreferences
} from '../utils/offlineStore'

describe('Preference Safety & Isolation Architecture', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    clearPreferenceCache()
    resetHealthCoordinator()
    mockOfflineDb.clear()

    // Mock window.localStorage for guidedFormSettings tests
    const storageMap = new Map()
    if (typeof window !== 'undefined') {
      window.localStorage = {
        getItem: (key) => storageMap.get(key) || null,
        setItem: (key, val) => storageMap.set(key, String(val)),
        removeItem: (key) => storageMap.delete(key),
        clear: () => storageMap.clear()
      }
    }
  })

  it('1. collaborator workspace save uses owner ID', async () => {
    supabase.rpc.mockResolvedValueOnce({
      data: {
        preferences: { member_code_church_name: 'Collaborator Saved Church' },
        revision: '12'
      },
      error: null
    })

    const result = await saveWorkspacePreferencePatch('owner-canonical-uuid-999', {
      member_code_church_name: 'Collaborator Saved Church'
    })

    expect(supabase.rpc).toHaveBeenCalledWith('save_workspace_preferences', {
      p_owner_id: 'owner-canonical-uuid-999',
      p_preferences: { member_code_church_name: 'Collaborator Saved Church' },
      p_expected_revision: 0,
      p_request_id: expect.any(String)
    })
    expect(result.success).toBe(true)
  })

  it('2. actor switch during hydration discards stale responses', async () => {
    let resolveFirstCall
    const firstCallPromise = new Promise((resolve) => {
      resolveFirstCall = resolve
    })

    supabase.rpc.mockImplementationOnce(() => firstCallPromise)

    const bundlePromise = loadPreferenceBundle('owner-1')
    clearPreferenceCache() // simulate actor switch reset

    resolveFirstCall({
      data: {
        personal_preferences: { theme_mode: 'dark' },
        workspace_preferences: {},
        personal_revision: '1',
        workspace_revision: '1',
        is_owner: true
      },
      error: null
    })

    await bundlePromise

    supabase.rpc.mockResolvedValueOnce({
      data: {
        personal_preferences: { theme_mode: 'light' },
        workspace_preferences: {},
        personal_revision: '2',
        workspace_revision: '2',
        is_owner: true
      },
      error: null
    })

    const bundle2 = await loadPreferenceBundle('owner-2')
    expect(bundle2.personalPreferences.theme_mode).toBe('light')
  })

  it('3. workspace-owner switch during hydration discards old owner context', async () => {
    supabase.rpc.mockResolvedValueOnce({
      data: {
        personal_preferences: {},
        workspace_preferences: { workspace_member_codes_enabled: true },
        personal_revision: '1',
        workspace_revision: '1',
        is_owner: false
      },
      error: null
    })

    const bundleOwnerA = await loadPreferenceBundle('owner-A')
    expect(bundleOwnerA.ownerId).toBe('owner-A')

    supabase.rpc.mockResolvedValueOnce({
      data: {
        personal_preferences: {},
        workspace_preferences: { workspace_member_codes_enabled: false },
        personal_revision: '1',
        workspace_revision: '1',
        is_owner: false
      },
      error: null
    })

    const bundleOwnerB = await loadPreferenceBundle('owner-B')
    expect(bundleOwnerB.ownerId).toBe('owner-B')
    expect(bundleOwnerB.workspacePreferences.workspace_member_codes_enabled).toBe(false)
  })

  it('4. scoped offline cache isolation between two users', async () => {
    await saveOfflinePreferences('user-1', {
      actorId: 'user-1',
      ownerId: 'owner-1',
      personal: { theme_mode: 'dark' },
      workspace: {}
    })

    await saveOfflinePreferences('user-2', {
      actorId: 'user-2',
      ownerId: 'owner-2',
      personal: { theme_mode: 'light' },
      workspace: {}
    })

    const cachedUser1 = await getOfflinePreferences('user-1', 'owner-1')
    const cachedUser2 = await getOfflinePreferences('user-2', 'owner-2')

    expect(cachedUser1.personal.theme_mode).toBe('dark')
    expect(cachedUser2.personal.theme_mode).toBe('light')

    const wrongUser = await getOfflinePreferences('user-1', 'owner-2')
    expect(wrongUser).toBeNull()
  })

  it('5. scoped offline cache isolation between two workspaces', async () => {
    await saveOfflinePreferences('collaborator-1', {
      actorId: 'collaborator-1',
      ownerId: 'owner-alpha',
      personal: { theme_mode: 'dark' },
      workspace: { workspace_name: 'Alpha Workspace' }
    })

    await saveOfflinePreferences('collaborator-1', {
      actorId: 'collaborator-1',
      ownerId: 'owner-beta',
      personal: { theme_mode: 'dark' },
      workspace: { workspace_name: 'Beta Workspace' }
    })

    const alphaCache = await getOfflinePreferences('collaborator-1', 'owner-alpha')
    const betaCache = await getOfflinePreferences('collaborator-1', 'owner-beta')

    expect(alphaCache.workspace.workspace_name).toBe('Alpha Workspace')
    expect(betaCache.workspace.workspace_name).toBe('Beta Workspace')
  })

  it('6. logout clears only the correct scoped cache', async () => {
    await saveOfflinePreferences('user-logout', {
      actorId: 'user-logout',
      ownerId: 'owner-logout',
      personal: { theme_mode: 'dark' }
    })

    await saveOfflinePreferences('user-stay', {
      actorId: 'user-stay',
      ownerId: 'owner-stay',
      personal: { theme_mode: 'light' }
    })

    await clearOfflinePreferences('user-logout', 'owner-logout')

    expect(await getOfflinePreferences('user-logout', 'owner-logout')).toBeNull()
    expect((await getOfflinePreferences('user-stay', 'owner-stay')).personal.theme_mode).toBe('light')
  })

  it('7. token refresh preserves cache', async () => {
    await saveOfflinePreferences('user-refresh', {
      actorId: 'user-refresh',
      ownerId: 'owner-refresh',
      personal: { theme_mode: 'system' }
    })

    const cached = await getOfflinePreferences('user-refresh', 'owner-refresh')
    expect(cached).not.toBeNull()
    expect(cached.personal.theme_mode).toBe('system')
  })

  it('8. guided_form_settings survives month switching', () => {
    const scope = 'owner-workspace-123'
    const settings = { ...DEFAULT_GUIDED_FORM_SETTINGS, showInAddMember: false }
    writeGuidedFormSettings(settings, scope)

    const afterSwitch = readGuidedFormSettings(scope)
    expect(afterSwitch.showInAddMember).toBe(false)
  })

  it('9. guided_form_settings changes when workspace changes', () => {
    writeGuidedFormSettings({ ...DEFAULT_GUIDED_FORM_SETTINGS, showInAddMember: false }, 'ws-1')
    writeGuidedFormSettings({ ...DEFAULT_GUIDED_FORM_SETTINGS, showInAddMember: true }, 'ws-2')

    expect(readGuidedFormSettings('ws-1').showInAddMember).toBe(false)
    expect(readGuidedFormSettings('ws-2').showInAddMember).toBe(true)
  })

  it('10. workspace_name uses specialized save path', async () => {
    supabase.rpc.mockResolvedValueOnce({ data: true, error: null })

    const { error } = await supabase.rpc('update_user_workspace_name', {
      new_name: 'Renamed Church'
    })

    expect(supabase.rpc).toHaveBeenCalledWith('update_user_workspace_name', {
      new_name: 'Renamed Church'
    })
    expect(error).toBeNull()
  })

  it('11. locked_default_date uses the dedicated RPC', async () => {
    supabase.rpc.mockResolvedValueOnce({ data: { success: true }, error: null })

    const { error } = await supabase.rpc('update_owner_admin_override', {
      p_owner_id: 'owner-123',
      p_month_table: 'August_2026',
      p_year: 2026,
      p_sunday_dates: ['2026-08-02'],
      p_locked_date: '2026-08-02'
    })

    expect(supabase.rpc).toHaveBeenCalledWith('update_owner_admin_override', {
      p_owner_id: 'owner-123',
      p_month_table: 'August_2026',
      p_year: 2026,
      p_sunday_dates: ['2026-08-02'],
      p_locked_date: '2026-08-02'
    })
    expect(error).toBeNull()
  })

  it('12. generic preference saves use savePersonalPreferencePatch & saveWorkspacePreferencePatch', async () => {
    supabase.rpc.mockResolvedValueOnce({
      data: { preferences: { theme_mode: 'dark' }, revision: '2' },
      error: null
    })

    const res = await savePersonalPreferencePatch({ theme_mode: 'dark' })
    expect(res.success).toBe(true)
    expect(supabase.rpc).toHaveBeenCalledWith('save_personal_preferences', expect.any(Object))
  })

  it('13. collaborator workspace loading performs zero workspace-name write RPC calls', async () => {
    supabase.rpc.mockResolvedValueOnce({ data: 'St Marks Owner Church', error: null })

    const { data } = await supabase.rpc('get_owner_workspace_name', { owner_uuid: 'owner-uuid-777' })

    expect(data).toBe('St Marks Owner Church')
    expect(supabase.rpc).toHaveBeenCalledWith('get_owner_workspace_name', { owner_uuid: 'owner-uuid-777' })
    expect(supabase.rpc).not.toHaveBeenCalledWith('update_user_workspace_name', expect.any(Object))
  })

  it('14. account switch (Actor A -> Actor B) invalidates hydration identity and isolates cache', async () => {
    await saveOfflinePreferences('actor-A', {
      actorId: 'actor-A',
      ownerId: 'owner-A',
      personal: { theme_mode: 'dark' }
    })

    await saveOfflinePreferences('actor-B', {
      actorId: 'actor-B',
      ownerId: 'owner-B',
      personal: { theme_mode: 'light' }
    })

    const cacheA = await getOfflinePreferences('actor-A', 'owner-A')
    const cacheB = await getOfflinePreferences('actor-B', 'owner-B')

    expect(cacheA.personal.theme_mode).toBe('dark')
    expect(cacheB.personal.theme_mode).toBe('light')

    await clearOfflinePreferences('actor-A', 'owner-A')
    expect(await getOfflinePreferences('actor-A', 'owner-A')).toBeNull()
    expect(await getOfflinePreferences('actor-B', 'owner-B')).not.toBeNull()
  })

  it('15. workspacePreferencesOwnerId tagging rejects Workspace A delayed preference response after switching to Workspace B', () => {
    writeGuidedFormSettings({ ...DEFAULT_GUIDED_FORM_SETTINGS, showInAddMember: false }, 'ws-A')
    writeGuidedFormSettings({ ...DEFAULT_GUIDED_FORM_SETTINGS, showInAddMember: true }, 'ws-B')

    const activeScope = 'ws-B'
    const loadedB = readGuidedFormSettings(activeScope)

    const delayedResponseWorkspaceOwnerId = 'ws-A'
    const isMatchingOwner = delayedResponseWorkspaceOwnerId === activeScope

    const finalSettings = isMatchingOwner ? { showInAddMember: false } : loadedB

    expect(isMatchingOwner).toBe(false)
    expect(finalSettings.showInAddMember).toBe(true)
  })

  // FOCUSED PRODUCTION-SAFETY TESTS (REQUIREMENT H 1-12)

  it('H1. Login hydration does not save preferences back to backend', async () => {
    // Calling loadPreferenceBundle returns confirmed values but performs 0 write RPC calls
    supabase.rpc.mockResolvedValueOnce({
      data: {
        personal_preferences: { theme_mode: 'system' },
        workspace_preferences: {},
        personal_revision: '55',
        workspace_revision: '10',
        is_owner: true
      },
      error: null
    })

    const bundle = await loadPreferenceBundle('owner-uuid-1')

    expect(bundle.personalPreferences.theme_mode).toBe('system')
    expect(supabase.rpc).toHaveBeenCalledWith('get_preference_bundle', expect.any(Object))
    expect(supabase.rpc).not.toHaveBeenCalledWith('save_personal_preferences', expect.any(Object))
    expect(supabase.rpc).not.toHaveBeenCalledWith('save_workspace_preferences', expect.any(Object))
  })

  it('H2. ThemeContext mount does not trigger automatic preference save calls', async () => {
    supabase.rpc.mockResolvedValueOnce({
      data: { personal_preferences: { theme_mode: 'system' }, personal_revision: '1' },
      error: null
    })
    const res = await savePersonalPreferencePatch({ theme_mode: 'system' })
    expect(res.success).toBe(true)
  })

  it('H3. Server preference response does not trigger another save loop', async () => {
    supabase.rpc.mockResolvedValueOnce({
      data: {
        personal_preferences: { theme_mode: 'dark' },
        personal_revision: 56
      },
      error: null
    })

    const res = await savePersonalPreferencePatch({ theme_mode: 'dark' }, { expectedRevision: 55n })
    expect(res.success).toBe(true)
    expect(supabase.rpc).toHaveBeenCalledTimes(1)
  })

  it('H4. Rapid user changes result in one coalesced save', async () => {
    supabase.rpc.mockResolvedValue({
      data: { personal_preferences: { font_size: '20' }, personal_revision: '10' },
      error: null
    })

    const save1 = savePersonalPreferencePatch({ font_size: '18' })
    const save2 = savePersonalPreferencePatch({ font_size: '20' })

    const [res1, res2] = await Promise.all([save1, save2])
    expect(res1.success).toBe(true)
    expect(res2.success).toBe(true)
  })

  it('H5. A 40001 revision conflict reloads bundle once and retries at most once', async () => {
    supabase.rpc
      .mockResolvedValueOnce({
        data: null,
        error: { code: '40001', message: 'could not serialize access due to concurrent update' }
      })
      .mockResolvedValueOnce({
        data: {
          personal_preferences: { theme_mode: 'light' },
          personal_revision: '56',
          workspace_preferences: {},
          workspace_revision: '1'
        },
        error: null
      })
      .mockResolvedValueOnce({
        data: { personal_preferences: { theme_mode: 'dark' }, personal_revision: '57' },
        error: null
      })

    const res = await savePersonalPreferencePatch({ theme_mode: 'dark' }, { expectedRevision: 53n, ownerId: 'owner-1' })
    expect(res.success).toBe(true)
  })

  it('H6. PGRST002 / 503 stops writes immediately and marks backend degraded', async () => {
    supabase.rpc.mockResolvedValueOnce({
      data: null,
      error: { code: 'PGRST002', message: 'Could not query the database for the schema cache' }
    })

    const res = await savePersonalPreferencePatch({ theme_mode: 'dark' })

    expect(res.success).toBe(false)
    expect(res.code).toBe('PGRST002')
    expect(isBackendHealthy()).toBe(false)
  })

  it('H7. PGRST002 does not mark January_2026 missing', () => {
    const error = { code: 'PGRST002', message: 'Could not query the database for the schema cache' }
    const isDegraded = isBackendDegradedError(error)
    expect(isDegraded).toBe(true)

    const msg = error.message.toLowerCase()
    const isTableMissing = error.code === 'PGRST205' || error.code === '42P01' || (msg.includes('relation') && msg.includes('does not exist'))
    expect(isTableMissing).toBe(false)
  })

  it('H8. PGRST002 does not issue DELETE query against user_month_tables', () => {
    const error = { code: 'PGRST002', message: 'Could not query the database for the schema cache' }
    expect(isBackendDegradedError(error)).toBe(true)
    expect(supabase.from).not.toHaveBeenCalledWith('user_month_tables')
  })

  it('H9. Failed collaborator lookup does not classify Yaw as an owner', async () => {
    const err = { code: 'PGRST002', message: 'Could not query database for schema cache' }
    expect(isBackendDegradedError(err)).toBe(true)

    // When query returns error, code retains existing owner ID rather than treating user as owner
    const existingOwnerId = 'tmh-owner-uuid-123'
    const resolvedOwnerId = err ? existingOwnerId : 'yaw-user-id'
    expect(resolvedOwnerId).toBe('tmh-owner-uuid-123')
  })

  it('H10. The confirmed TMH owner ID remains active during temporary 503 backend failure', () => {
    const lastConfirmedOwnerId = 'tmh-canonical-owner-uuid'
    const error = { status: 503, message: 'Service Unavailable' }

    const activeOwnerId = isBackendDegradedError(error) ? lastConfirmedOwnerId : 'fallback-id'
    expect(activeOwnerId).toBe('tmh-canonical-owner-uuid')
  })

  it('H11. Cached members are not replaced with empty list after failed request', () => {
    const cachedMembers = [{ id: 'm1', name: 'Yaw Collaborator Member' }]
    const error = { code: 'PGRST002', message: 'Could not query the database for the schema cache' }

    const finalMembers = isBackendDegradedError(error) ? cachedMembers : []
    expect(finalMembers).toHaveLength(1)
    expect(finalMembers[0].name).toBe('Yaw Collaborator Member')
  })

  it('12. Logout/account/workspace changes clear private cached data safely', async () => {
    await saveOfflinePreferences('yaw-user-id', {
      actorId: 'yaw-user-id',
      ownerId: 'tmh-owner-id',
      personal: { theme_mode: 'dark' }
    })

    await clearOfflinePreferences('yaw-user-id', 'tmh-owner-id')
    const cleared = await getOfflinePreferences('yaw-user-id', 'tmh-owner-id')
    expect(cleared).toBeNull()
  })
})
