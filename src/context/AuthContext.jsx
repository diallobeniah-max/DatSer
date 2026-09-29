import React, { createContext, useContext, useState, useEffect, useCallback, useRef, useMemo } from 'react'
import { supabase, hasStoredSession, isSupabaseConfigured } from '../lib/supabase'
import { toast } from 'react-toastify'
import { executeSupabaseWrite, isTransientSupabaseError } from '../utils/supabaseWrite'
import {
  clearAllOfflineData,
  clearOfflineAuthProfile,
  clearOfflinePreferences,
  getOfflineAuthProfile,
  getOfflinePreferences,
  queueOfflineChange,
  saveOfflineAuthProfile,
  saveOfflinePreferences
} from '../utils/offlineStore'
import {
  DEV_BYPASS_PREFERENCES_STORAGE_KEY,
  DEV_BYPASS_STORAGE_KEY,
  clearDeveloperBypassState,
  isLocalWebDeveloperModeAllowed,
  isNativeRuntime
} from '../utils/developerMode'
import {
  clearPreferenceCache,
  loadPreferenceBundle,
  savePersonalPreferencePatch,
  saveWorkspacePreferencePatch
} from '../services/preferenceService'
import { isBackendHealthy } from '../utils/backendHealthCoordinator'
import {
  getPersonalSettingsDefaults,
  getWorkspaceSettingsDefaults,
  getSettingConfig,
  pickPersonalPreferencePatch,
  pickWorkspacePreferencePatch,
  SETTINGS_SCOPES
} from '../config/settingsRegistry'

const AuthContext = createContext(null)
const LOCAL_PREFERENCE_OVERRIDES_PREFIX = 'datser_preference_overrides'
const DEV_BYPASS_USER_ID = 'dev-bypass-user'
const DEV_BYPASS_PREFERENCES = {
  workspace_name: 'Developer Workspace',
  role: 'owner',
  member_codes_enabled: true,
  workspace_member_codes_enabled: true
}
const ADMIN_CODE_SESSION_KEY = 'datser_admin_code_session'
const ADMIN_CODE_VERIFIED_SESSION_KEY = 'datser_admin_code_verified'
// These values are configured atomically for the entire workspace. Generic
// preference saves must never race the configuration RPC and restore defaults.
const WORKSPACE_MEMBER_CODE_CONFIGURATION_KEYS = new Set([
  'member_code_format',
  'member_code_length'
])

const devOnlyString = (codes) => (
  import.meta.env.DEV ? String.fromCharCode(...codes) : ''
)

const getDeveloperBypassUser = () => ({
  id: DEV_BYPASS_USER_ID,
  email: devOnlyString([100, 101, 118, 64, 100, 97, 116, 115, 101, 114, 46, 108, 111, 99, 97, 108]),
  user_metadata: {
    full_name: devOnlyString([68, 101, 118, 101, 108, 111, 112, 101, 114, 32, 77, 111, 100, 101, 32, 85, 115, 101, 114])
  }
})

const isAdminCodeSessionMarked = () => {
  if (typeof window === 'undefined') return false
  try {
    return window.sessionStorage?.getItem(ADMIN_CODE_VERIFIED_SESSION_KEY) === 'true'
  } catch {
    return false
  }
}

const markUserAsAdminCodeSession = (user) => {
  if (!user || !isAdminCodeSessionMarked()) return user
  return {
    ...user,
    app_metadata: {
      ...(user.app_metadata || {}),
      provider: 'admin-code'
    }
  }
}

const isDeveloperBypassStorageEnabled = () => (
  isLocalWebDeveloperModeAllowed() &&
  typeof window !== 'undefined' &&
  window.localStorage.getItem(DEV_BYPASS_STORAGE_KEY) === 'true'
)

const readDeveloperBypassPreferenceCache = () => {
  if (typeof window === 'undefined') return {}
  try {
    return JSON.parse(window.localStorage.getItem(DEV_BYPASS_PREFERENCES_STORAGE_KEY) || '{}')
  } catch {
    return {}
  }
}

const writeDeveloperBypassPreferenceCache = (preferences) => {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.setItem(
      DEV_BYPASS_PREFERENCES_STORAGE_KEY,
      JSON.stringify({
        ...(preferences || {}),
        user_id: DEV_BYPASS_USER_ID
      })
    )
  } catch {
    // Local storage can be unavailable in private or restricted browser contexts.
  }
}

const getLocalPreferenceOverrideKey = (userId) => `${LOCAL_PREFERENCE_OVERRIDES_PREFIX}_${userId || 'local'}`

const readLocalPreferenceOverride = (userId) => {
  if (typeof window === 'undefined' || !userId) return null
  try {
    return JSON.parse(window.localStorage.getItem(getLocalPreferenceOverrideKey(userId)) || 'null')
  } catch {
    return null
  }
}

const writeLocalPreferenceOverride = (userId, preferences) => {
  if (typeof window === 'undefined' || !userId) return
  try {
    window.localStorage.setItem(
      getLocalPreferenceOverrideKey(userId),
      JSON.stringify({
        saved_at: new Date().toISOString(),
        preferences: {
          ...(preferences || {}),
          user_id: userId
        }
      })
    )
  } catch {
    // Local storage can be unavailable in private or restricted browser contexts.
  }
}

const getDeveloperBypassPreferences = async () => {
  const cached = await getOfflinePreferences(DEV_BYPASS_USER_ID).catch(() => null)
  return {
    ...DEV_BYPASS_PREFERENCES,
    ...(cached?.preferences || {}),
    ...readDeveloperBypassPreferenceCache(),
    user_id: DEV_BYPASS_USER_ID
  }
}

const isBrowserOffline = () => (
  typeof navigator !== 'undefined' &&
  navigator.onLine === false
)

const isPreferenceSchemaError = (error) => {
  if (!error) return false
  const code = String(error.code || error.status || '').toUpperCase()
  const message = String(error.message || error.details || error.hint || '').toLowerCase()

  return code === 'PGRST204' || (
    message.includes('user_preferences') &&
    (message.includes('column') || message.includes('schema cache'))
  )
}

const makePreferenceChangeId = (userId) => `preferences_update_${userId || 'local'}`

const normalizePreferencePayload = (payload, userId) => {
  if (!payload) return { user_id: userId }
  const { id: _id, created_at: _createdAt, updated_at: _updatedAt, ...rest } = payload
  return {
    ...rest,
    user_id: rest.user_id || userId
  }
}

const omitWorkspaceMemberCodeConfiguration = (preferences, userId) => {
  const payload = normalizePreferencePayload(preferences, userId)
  WORKSPACE_MEMBER_CODE_CONFIGURATION_KEYS.forEach((key) => delete payload[key])
  return payload
}

const preserveRemoteWorkspaceMemberCodeConfiguration = (preferences, remotePreferences) => {
  const merged = { ...(preferences || {}) }
  WORKSPACE_MEMBER_CODE_CONFIGURATION_KEYS.forEach((key) => {
    if (remotePreferences?.[key] !== undefined && remotePreferences?.[key] !== null) {
      merged[key] = remotePreferences[key]
    }
  })
  return merged
}

export const useAuth = () => {
  const context = useContext(AuthContext)
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider')
  }
  return context
}

export const AuthProvider = ({ children }) => {
  // Fast initial state: if we have a stored session, assume logged in (optimistic)
  const [user, setUser] = useState(null)
  const [loading, setLoading] = useState(true)
  const [personalPreferences, setPersonalPreferences] = useState(getPersonalSettingsDefaults())
  const [workspacePreferences, setWorkspacePreferences] = useState(getWorkspaceSettingsDefaults())
  const [workspacePreferencesOwnerId, setWorkspacePreferencesOwnerId] = useState(null)
  const [personalRevision, setPersonalRevision] = useState(0n)
  const [workspaceRevision, setWorkspaceRevision] = useState(0n)
  const [preferencesHydrated, setPreferencesHydrated] = useState(false)
  const [preferencesError, setPreferencesError] = useState(null)
  const [preferencesLoading, setPreferencesLoading] = useState(false)
  const preferences = useMemo(() => ({
    ...personalPreferences,
    ...workspacePreferences
  }), [personalPreferences, workspacePreferences])
  const preferencesRef = useRef(preferences)
  const welcomeToastShownRef = useRef(false) // Prevent duplicate welcome toasts
  // Durable guard so the welcome toast never repeats within a single browser
  // session. React refs reset on remount (StrictMode double-mount, route
  // changes), and Supabase re-emits SIGNED_IN on token refresh/reconnect —
  // both would otherwise re-fire the welcome toast. sessionStorage is cleared
  // when the tab closes, so a genuine new login still shows it.
  const WELCOME_TOAST_SESSION_KEY = 'datser_welcome_toast_shown'
  const offlineLoginToastShownRef = useRef(false)
  const isDeveloperBypassEnabled = isDeveloperBypassStorageEnabled()

  useEffect(() => {
    if (isNativeRuntime()) {
      clearDeveloperBypassState()
    }
  }, [])

  useEffect(() => {
    preferencesRef.current = preferences
  }, [preferences])

  const applyOfflineAuthProfile = useCallback(async () => {
    try {
      const cachedAuth = await getOfflineAuthProfile().catch(() => null)
      if (!cachedAuth?.user?.id) return false

      const cachedPreferences = await getOfflinePreferences(cachedAuth.user.id).catch(() => null)
      setUser(cachedAuth.user)
      if (cachedPreferences) {
        if (cachedPreferences.personal) setPersonalPreferences(cachedPreferences.personal)
        if (cachedPreferences.workspace) setWorkspacePreferences(cachedPreferences.workspace)
        if (cachedPreferences.preferences && !cachedPreferences.personal) {
          setPersonalPreferences(cachedPreferences.preferences)
        }
        setPreferencesHydrated(true)
      }
      setLoading(false)
      welcomeToastShownRef.current = true

      if (!offlineLoginToastShownRef.current) {
        offlineLoginToastShownRef.current = true
        toast.info('Offline Mode Active - using saved login.')
      }
      return true
    } catch (error) {
      console.warn('Could not restore offline login:', error)
      return false
    }
  }, [])

  const rememberOnlineSession = useCallback(async (session) => {
    if (!session?.user?.id) return
    try {
      await saveOfflineAuthProfile({ user: session.user, session })
    } catch (error) {
      console.warn('Could not save offline auth profile:', error)
    }
  }, [])

  const queuePreferenceSync = useCallback(async (userId, nextPreferences) => {
    if (!userId || !nextPreferences) return
    try {
      await queueOfflineChange({
        local_change_id: makePreferenceChangeId(userId),
        action_type: 'preferences_update',
        user_id: userId,
        preferences: {
          ...omitWorkspaceMemberCodeConfiguration(nextPreferences, userId),
          user_id: nextPreferences.user_id || userId
        },
        created_at: new Date().toISOString(),
        sync_status: 'pending'
      })
    } catch (error) {
      console.warn('Could not queue preference sync:', error)
    }
  }, [])

  // Load preferences in background. The FIRST authenticated hydration is
  // required application state: Calendar Mode depends on preferencesHydrated,
  // so it must start immediately and must NOT be deferred behind
  // requestIdleCallback/setTimeout, which can be starved (idle starvation) and
  // leave the UI stuck on "Loading calendar settings…". Idle scheduling is only
  // acceptable for later refreshes.
  const loadUserPreferencesBackground = useCallback((userId) => {
    const load = loadUserPreferencesRef.current
    if (load) void load(userId)
  }, [])

  // Auto-accept collaborator invite when user signs in
  const autoAcceptInvite = async (userEmail) => {
    if (!userEmail || !supabase) return
    try {
      const { data, error } = await supabase.rpc('accept_invite_for_user', {
        user_email: userEmail.toLowerCase()
      })
      if (error) {
        console.log('[INVITE] No pending invite or error:', error.message)
        return
      }
      if (data?.accepted) {
        console.log('[INVITE] Auto-accepted invite, owner_id:', data.owner_id)
      }
    } catch (err) {
      console.error('[INVITE] Error auto-accepting invite:', err)
    }
  }

  // Initialize auth state - optimized for speed
  useEffect(() => {
    let mounted = true

    if (isDeveloperBypassEnabled) {
      setUser(getDeveloperBypassUser())
      getDeveloperBypassPreferences()
        .then((devPreferences) => {
          if (!mounted) return
          setPersonalPreferences(devPreferences)
          setWorkspacePreferences(devPreferences)
          setPreferencesHydrated(true)
        })
        .finally(() => {
          if (mounted) setLoading(false)
        })
      return () => {
        mounted = false
      }
    }

    // Older builds stored a local pseudo-session after Admin Code login. It
    // could render the app but could not safely satisfy Supabase RLS. Remove it
    // and require the server exchange below to create a real Auth session.
    try { window.sessionStorage?.removeItem(ADMIN_CODE_SESSION_KEY) } catch { /* ignore */ }

    // Check if Supabase is configured
    if (!isSupabaseConfigured()) {
      console.error('Supabase is not configured')
      if (!isBrowserOffline()) {
        setLoading(false)
      } else {
        applyOfflineAuthProfile().then((restored) => {
          if (!restored && mounted) setLoading(false)
        })
      }
      return
    }

    // FAST PATH: Check localStorage synchronously first
    // If session already exists, mark welcome toast as shown (don't show on refresh)
    const hadExistingSession = hasStoredSession()
    if (hadExistingSession) {
      welcomeToastShownRef.current = true // Prevent welcome toast on page refresh
    }
    // If the durable welcome flag is set for the current session, treat it as
    // already shown too — covers remount after a refresh where the ref resets.
    if (typeof window !== 'undefined' && window.sessionStorage?.getItem(WELCOME_TOAST_SESSION_KEY)) {
      welcomeToastShownRef.current = true
    }

    // Get initial session
    const getInitialSession = async () => {
      try {
        // Check if there's a hash fragment (OAuth callback, invite link, magic link)
        // With implicit flow, Supabase puts tokens in the hash fragment
        const hash = window.location.hash
        if (hash && hash.length > 1) {
          // Suppress welcome toast for password recovery flow
          if (hash.includes('type=recovery')) {
            welcomeToastShownRef.current = true
          } else {
            welcomeToastShownRef.current = false
          }
          
          // Check for error in hash (e.g. expired invite link)
          if (hash.includes('error=')) {
            const hashParams = new URLSearchParams(hash.substring(1))
            const errorCode = hashParams.get('error_code')
            const errorDesc = hashParams.get('error_description')
            console.error('[AUTH] Auth error in URL:', errorCode, errorDesc)
            if (errorCode === 'otp_expired') {
              toast.error('This invite link has expired. Please ask the admin to send a new one.')
            }
            // Clear the hash from URL
            window.history.replaceState(null, '', window.location.pathname)
            if (mounted) setLoading(false)
            return
          }
          
          // Hash contains tokens (access_token from OAuth, invite, or magic link)
          // Supabase's detectSessionInUrl will automatically process this
          console.log('[AUTH] Hash with tokens detected, Supabase will process it')
          if (supabase) {
            const { data, error } = await supabase.auth.getSession()
            if (error) {
              console.error('[AUTH] Error processing auth callback:', error)
            }
            if (mounted && data?.session?.user) {
              setUser(markUserAsAdminCodeSession(data.session.user))
              setLoading(false)
              rememberOnlineSession(data.session)
              loadUserPreferencesBackground(data.session.user.id)
              if (data.session.user.email) autoAcceptInvite(data.session.user.email)
            } else if (data?.session) {
              rememberOnlineSession(data.session)
            }
            // Clear the hash from URL
            window.history.replaceState(null, '', window.location.pathname)
          }
          return
        }

        if (supabase) {
          const { data: { session }, error } = await supabase.auth.getSession()

          if (isDeveloperBypassStorageEnabled()) {
            return
          }

          if (error) {
            console.error('Error getting session:', error)
          }

          if (mounted) {
            setUser(session?.user ? markUserAsAdminCodeSession(session.user) : null)
            setLoading(false)
            // Load preferences in background - don't block UI
            if (session?.user) {
              rememberOnlineSession(session)
              loadUserPreferencesBackground(session.user.id)
            } else if (isBrowserOffline()) {
              await applyOfflineAuthProfile()
            }
          }
        }
      } catch (error) {
        console.error('Error getting session:', error)
        if (isBrowserOffline() && await applyOfflineAuthProfile()) {
          return
        }
        if (mounted) {
          setLoading(false)
        }
      }
    }

    // Listen for auth changes FIRST
    if (supabase) {
      const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
        console.log('Auth state changed:', event, session?.user?.email)

        if (!mounted) return
        if (isDeveloperBypassStorageEnabled()) return

        // Update user state immediately
        setUser(session?.user ? markUserAsAdminCodeSession(session.user) : null)
        setLoading(false)

        if (event === 'SIGNED_IN' && session?.user) {
          // The only route that sets this intent is the single Admin Google
          // button.  Complete that intentional return after Supabase has
          // verified the OAuth session rather than before the redirect.
          try {
            if (window.sessionStorage?.getItem('datser_admin_google_return') === 'true') {
              window.sessionStorage.setItem('adminAuthenticated', 'true')
              window.sessionStorage.removeItem('datser_admin_google_return')
            }
          } catch { /* session storage is optional */ }
          rememberOnlineSession(session)
          // Load preferences in background
          loadUserPreferencesBackground(session.user.id)
          // Auto-accept collaborator invite if user was invited
          autoAcceptInvite(session.user.email)
          // Show welcome toast only on fresh login (not refresh, remount, or
          // Supabase token-refresh re-emitting SIGNED_IN).
          const welcomeAlreadyShown =
            welcomeToastShownRef.current ||
            (typeof window !== 'undefined' && window.sessionStorage?.getItem(WELCOME_TOAST_SESSION_KEY) === session.user.id)
          if (!welcomeAlreadyShown) {
            welcomeToastShownRef.current = true
            try {
              window.sessionStorage?.setItem(WELCOME_TOAST_SESSION_KEY, session.user.id)
            } catch { /* sessionStorage unavailable */ }
            const isInvitedUser = session.user.user_metadata?.role === 'collaborator'
            const invitedBy = session.user.user_metadata?.invited_by
            if (isInvitedUser && invitedBy) {
              toast.success('Welcome to DatSer')
            } else {
              toast.success('Welcome')
            }
          }
        } else if (event === 'SIGNED_OUT') {
          clearPreferenceCache()
          setPersonalPreferences(getPersonalSettingsDefaults())
          setWorkspacePreferences(getWorkspaceSettingsDefaults())
          setPersonalRevision(0n)
          setWorkspaceRevision(0n)
          setPreferencesHydrated(false)
          welcomeToastShownRef.current = false
          try { window.sessionStorage?.removeItem(WELCOME_TOAST_SESSION_KEY) } catch { /* ignore */ }
          toast.info('Signed out successfully')
        }
      })

      // Then get initial session
      getInitialSession()

      return () => {
        mounted = false
        subscription?.unsubscribe()
      }
    }
  }, [isDeveloperBypassEnabled, loadUserPreferencesBackground])

  const hydrationIdentityRef = useRef({ generation: 0, actorId: null, ownerId: null })
  // Tracks the single in-flight bundle load per (actor, owner) so same-user
  // repeated SIGNED_IN events share one request instead of restarting it.
  const hydrationInFlightRef = useRef(null)
  // Stable handle to the bundle loader; the background helper reads this ref so
  // it never needs to be hoisted above its declaration.
  const loadUserPreferencesRef = useRef(null)

  const resolveCanonicalOwnerId = useCallback((explicitOwnerId) => (
    explicitOwnerId || user?.user_metadata?.invited_by || user?.id
  ), [user?.id, user?.user_metadata?.invited_by])

  // Load preferences bundle using preferenceService
  const loadUserPreferencesBundle = useCallback(async (ownerId, userId) => {
    const targetOwnerId = resolveCanonicalOwnerId(ownerId)
    const targetActorId = userId || user?.id
    if (!targetOwnerId || !targetActorId) return null

    // Same-user repeated SIGNED_IN events share the active in-flight load.
    // Do not restart it, bump the generation, or leave loading stuck.
    const inflight = hydrationInFlightRef.current
    if (inflight && inflight.ownerId === targetOwnerId && inflight.actorId === targetActorId) {
      return inflight.promise
    }

    const previousOwnerId = hydrationIdentityRef.current.ownerId
    const currentGeneration = (hydrationIdentityRef.current.generation || 0) + 1
    hydrationIdentityRef.current = {
      generation: currentGeneration,
      actorId: targetActorId,
      ownerId: targetOwnerId
    }

    if (previousOwnerId && previousOwnerId !== targetOwnerId) {
      setWorkspacePreferences(getWorkspaceSettingsDefaults())
      setWorkspacePreferencesOwnerId(null)
      setWorkspaceRevision(0n)
      setPreferencesHydrated(false)
    }

    const isCurrentRequest = () => {
      const active = hydrationIdentityRef.current
      return Boolean(
        active &&
        active.generation === currentGeneration &&
        active.actorId === targetActorId &&
        active.ownerId === targetOwnerId
      )
    }

    const loadPromise = (async () => {
      setPreferencesLoading(true)
      setPreferencesError(null)
      try {
        const bundle = await loadPreferenceBundle(targetOwnerId)

        if (!isCurrentRequest()) {
          return null
        }

        if (bundle && bundle.personalPreferences && bundle.workspacePreferences) {
          setPersonalPreferences(bundle.personalPreferences)
          setWorkspacePreferences(bundle.workspacePreferences)
          setWorkspacePreferencesOwnerId(targetOwnerId)
          setPersonalRevision(bundle.personalRevision || 0n)
          setWorkspaceRevision(bundle.workspaceRevision || 0n)
          setPreferencesHydrated(true)

          saveOfflinePreferences(targetActorId, {
            actorId: targetActorId,
            ownerId: targetOwnerId,
            personal: bundle.personalPreferences,
            workspace: bundle.workspacePreferences,
            personalRevision: bundle.personalRevision,
            workspaceRevision: bundle.workspaceRevision
          }).catch(() => {})

          return bundle
        }

        throw new Error('Invalid preference bundle returned from server')
      } catch (err) {
        if (!isCurrentRequest()) {
          return null
        }

        console.warn('[AuthContext] loadUserPreferencesBundle error:', err)
        const cached = await getOfflinePreferences(targetActorId, targetOwnerId).catch(() => null)
        if (cached && (cached.personal || cached.workspace)) {
          if (cached.personal) setPersonalPreferences(cached.personal)
          if (cached.workspace) setWorkspacePreferences(cached.workspace)
          setPreferencesHydrated(true)
          return null
        }

        setPreferencesError(err?.message || 'Failed to load preferences')
        return null
      } finally {
        // Only the latest request for this identity may clear the loading flag,
        // otherwise a stale/aborted request would hide a newer one's progress.
        if (isCurrentRequest()) {
          setPreferencesLoading(false)
        }
        if (hydrationInFlightRef.current && hydrationInFlightRef.current.promise === loadPromise) {
          hydrationInFlightRef.current = null
        }
      }
    })()

    const entry = { ownerId: targetOwnerId, actorId: targetActorId, promise: loadPromise }
    hydrationInFlightRef.current = entry
    return loadPromise
  }, [resolveCanonicalOwnerId, user?.id])

  const loadUserPreferences = loadUserPreferencesBundle
  loadUserPreferencesRef.current = loadUserPreferences

  // Save personal preferences using save_personal_preferences RPC
  const savePersonalPreferences = useCallback(async (patch = {}, options = {}) => {
    if (!preferencesHydrated && !options?.forceHydrated) {
      console.warn('[AuthContext] savePersonalPreferences ignored before hydration completed.')
      return false
    }

    if (!isBackendHealthy()) {
      if (!options?.silent) toast.error('Database connection unavailable. Using cached local settings.')
      return false
    }

    // Value diff check: ignore patch if values are unchanged unless the caller
    // explicitly needs a server confirmation. Calendar mode uses this when a
    // user chooses Auto/Manual so UI success always means the RPC confirmed it.
    const hasChange = Object.keys(patch).some((k) => personalPreferences[k] !== patch[k])
    if (!hasChange && !options?.requireServerConfirmation) {
      return true
    }

    const res = await savePersonalPreferencePatch(patch, {
      expectedRevision: personalRevision,
      requestId: options?.requestId
    })

    if (res.success && res.data) {
      setPersonalPreferences(res.data)
      if (res.revision !== undefined) setPersonalRevision(BigInt(res.revision))
      const targetOwnerId = resolveCanonicalOwnerId(options?.ownerId)
      saveOfflinePreferences(user?.id, {
        actorId: user?.id,
        ownerId: targetOwnerId,
        personal: res.data,
        workspace: workspacePreferences,
        personalRevision: res.revision,
        workspaceRevision
      }).catch(() => {})
      return true
    } else if (res.code === 'REVISION_CONFLICT') {
      if (res.data) setPersonalPreferences(res.data)
      if (res.revision !== undefined) setPersonalRevision(BigInt(res.revision))
      toast.error(res.message)
      return false
    } else {
      if (!options?.silent && res.code !== 'SERVICE_UNAVAILABLE') {
        toast.error(res.message || 'This setting could not be saved.')
      }
      return false
    }
  }, [loadUserPreferencesBundle, personalPreferences, personalRevision, preferencesHydrated, resolveCanonicalOwnerId, user?.id, workspacePreferences, workspaceRevision])

  // Save workspace preferences using save_workspace_preferences RPC
  const saveWorkspacePreferences = useCallback(async (ownerId, patch = {}, options = {}) => {
    if (!preferencesHydrated && !options?.forceHydrated) {
      console.warn('[AuthContext] saveWorkspacePreferences ignored before hydration completed.')
      return false
    }

    if (!isBackendHealthy()) {
      if (!options?.silent) toast.error('Database connection unavailable. Using cached local settings.')
      return false
    }

    const targetOwnerId = resolveCanonicalOwnerId(ownerId)
    if (!targetOwnerId) return false

    // Value diff check
    const hasChange = Object.keys(patch).some((k) => workspacePreferences[k] !== patch[k])
    if (!hasChange) {
      return true
    }

    const res = await saveWorkspacePreferencePatch(targetOwnerId, patch, {
      expectedRevision: workspaceRevision,
      requestId: options?.requestId
    })

    if (res.success && res.data) {
      setWorkspacePreferences(res.data)
      if (res.revision !== undefined) setWorkspaceRevision(BigInt(res.revision))
      saveOfflinePreferences(user?.id, {
        actorId: user?.id,
        ownerId: targetOwnerId,
        personal: personalPreferences,
        workspace: res.data,
        personalRevision,
        workspaceRevision: res.revision
      }).catch(() => {})
      return true
    } else if (res.code === 'REVISION_CONFLICT') {
      if (res.data) setWorkspacePreferences(res.data)
      if (res.revision !== undefined) setWorkspaceRevision(BigInt(res.revision))
      toast.error(res.message)
      return false
    } else {
      if (!options?.silent && res.code !== 'SERVICE_UNAVAILABLE') {
        toast.error(res.message || 'This setting could not be saved.')
      }
      return false
    }
  }, [loadUserPreferencesBundle, personalPreferences, personalRevision, preferencesHydrated, resolveCanonicalOwnerId, user?.id, workspacePreferences, workspaceRevision])

  // Backward compatible saveUserPreferences & updatePreference
  const saveUserPreferences = useCallback(async (newPreferences, explicitOwnerId) => {
    if (!newPreferences || typeof newPreferences !== 'object') return false
    const personalPatch = pickPersonalPreferencePatch(newPreferences)
    const workspacePatch = pickWorkspacePreferencePatch(newPreferences)
    const targetOwnerId = resolveCanonicalOwnerId(explicitOwnerId)

    let okPersonal = true
    let okWorkspace = true

    if (Object.keys(personalPatch).length > 0) {
      okPersonal = await savePersonalPreferences(personalPatch)
    }
    if (Object.keys(workspacePatch).length > 0) {
      okWorkspace = await saveWorkspacePreferences(targetOwnerId, workspacePatch)
    }

    return okPersonal && okWorkspace
  }, [resolveCanonicalOwnerId, savePersonalPreferences, saveWorkspacePreferences])

  const updatePreference = useCallback(async (key, value, options = {}) => {
    const settingConfig = getSettingConfig(key)
    if (!settingConfig) {
      console.warn(`[updatePreference] Unregistered key "${key}" ignored.`)
      return false
    }

    if (settingConfig.scope === SETTINGS_SCOPES.PERSONAL) {
      return await savePersonalPreferences({ [key]: value }, options)
    } else if (settingConfig.scope === SETTINGS_SCOPES.WORKSPACE) {
      const targetOwnerId = resolveCanonicalOwnerId(options?.ownerId)
      return await saveWorkspacePreferences(targetOwnerId, { [key]: value }, options)
    } else {
      console.warn(`[updatePreference] Key "${key}" with scope "${settingConfig.scope}" should use specialized save handler.`)
      return false
    }
  }, [resolveCanonicalOwnerId, savePersonalPreferences, saveWorkspacePreferences])

  const getRedirectUrl = useCallback(() => {
    const normalizeRedirectUrl = (value) => {
      const trimmed = value?.trim()
      if (!trimmed) return ''

      try {
        const url = new URL(trimmed)
        const pathname = url.pathname === '/' ? '' : url.pathname.replace(/\/$/, '')
        return `${url.origin}${pathname}${url.search}${url.hash}`
      } catch {
        return trimmed.replace(/\/$/, '')
      }
    }

    const explicit = normalizeRedirectUrl(import.meta.env?.VITE_SUPABASE_REDIRECT_URL)
    if (explicit) return explicit

    // Prefer the app base URL instead of the current route so OAuth always
    // returns to a stable entry point in both localhost and deployed builds.
    const basePath = import.meta.env?.BASE_URL || '/'
    return normalizeRedirectUrl(new URL(basePath, window.location.origin).toString())
  }, [])

  // Sign in with Google
  const signInWithGoogle = async () => {
    try {
      if (!isSupabaseConfigured() || !supabase) {
        toast.error('Authentication is not configured')
        throw new Error('Supabase is not configured')
      }

      const redirectUrl = getRedirectUrl()
      console.log('Redirect URL:', redirectUrl)

      const { data, error } = await supabase.auth.signInWithOAuth({
        provider: 'google',
        options: {
          redirectTo: redirectUrl
        }
      })

      if (error) throw error

      // If we get a URL back, redirect to it
      if (data?.url) {
        window.location.href = data.url
      }

      return data
    } catch (error) {
      console.error('Error signing in with Google:', error)
      toast.error('Failed to sign in with Google')
      throw error
    }
  }

  // Sign up with email and password
  const signUpWithEmail = async (email, password, fullName, captchaToken) => {
    try {
      if (supabase) {
        const redirectUrl = getRedirectUrl()

        const signUpOptions = {
          email,
          password,
          options: {
            emailRedirectTo: redirectUrl,
            data: {
              full_name: fullName
            }
          }
        }
        // Only add captchaToken if it exists
        if (captchaToken) {
          signUpOptions.options.captchaToken = captchaToken
        }
        const { data, error } = await supabase.auth.signUp(signUpOptions)

        if (error) throw error

        // Check if email confirmation is required
        if (data?.user?.identities?.length === 0) {
          toast.info('This email is already registered. Please sign in instead.')
          return { needsSignIn: true }
        }

        if (data?.user && !data?.session) {
          recordEmailSend()
          toast.success('Check your email for a confirmation link!')
          return { needsConfirmation: true }
        }

        return data
      }
    } catch (error) {
      console.error('Error signing up:', error)
      if (error.message?.includes('already registered')) {
        toast.error('This email is already registered. Please sign in.')
      } else {
        toast.error(error.message || 'Failed to sign up')
      }
      throw error
    }
  }

  // Sign in with email and password
  const signInWithEmail = async (email, password, captchaToken) => {
    try {
      if (supabase) {
        const signInOptions = { email, password }
        // Only add captchaToken if it exists
        if (captchaToken) {
          signInOptions.options = { captchaToken }
        }
        const { data, error } = await supabase.auth.signInWithPassword(signInOptions)

        if (error) throw error
        return data
      }
    } catch (error) {
      console.error('Error signing in:', error)
      if (error.message?.includes('Invalid login credentials')) {
        toast.error('Invalid email or password. If this is a collaborator account, ask the owner to resend the invite or reset the login.')
      } else if (error.message?.includes('Email not confirmed')) {
        toast.error('Please check your email and confirm your account first')
      } else {
        toast.error(error.message || 'Failed to sign in')
      }
      throw error
    }
  }

  // Track email sends for rate limit display in Settings
  const recordEmailSend = () => {
    try {
      const raw = localStorage.getItem('email_send_timestamps')
      const timestamps = raw ? JSON.parse(raw) : []
      const cutoff = Date.now() - 60 * 60 * 1000 // 1 hour window
      const recent = timestamps.filter(ts => ts > cutoff)
      recent.push(Date.now())
      localStorage.setItem('email_send_timestamps', JSON.stringify(recent))
    } catch { /* ignore */ }
  }

  // Sign in with magic link (passwordless - for collaborators)
  const signInWithMagicLink = async (email, captchaToken) => {
    try {
      if (supabase) {
        const redirectUrl = getRedirectUrl()
        const otpOptions = {
          email,
          options: {
            emailRedirectTo: redirectUrl,
            shouldCreateUser: false // Only allow existing invited users - prevents random signups
          }
        }
        if (captchaToken) {
          otpOptions.options.captchaToken = captchaToken
        }
        const { error } = await supabase.auth.signInWithOtp(otpOptions)
        if (error) throw error
        recordEmailSend()
        toast.success('Magic link sent! Check your email inbox.')
        return { success: true }
      }
    } catch (error) {
      console.error('Error sending magic link:', error)
      const errorMsg = error.message || ''
      if (errorMsg.includes('Signups not allowed') || errorMsg.includes('otp_disabled') || errorMsg.includes('User not found')) {
        toast.error('No account found with this email. Please ask the admin for an invite.')
      } else {
        toast.error(errorMsg || 'Failed to send magic link')
      }
      throw error
    }
  }

  // Reset password
  const resetPassword = async (email, captchaToken) => {
    try {
      if (supabase) {
        const redirectUrl = getRedirectUrl()

        const resetOptions = { redirectTo: redirectUrl }
        // Only add captchaToken if it exists
        if (captchaToken) {
          resetOptions.captchaToken = captchaToken
        }
        const { error } = await supabase.auth.resetPasswordForEmail(email, resetOptions)

        if (error) throw error
        recordEmailSend()
        toast.success('Password reset email sent! Check your inbox.')
        return true
      }
    } catch (error) {
      console.error('Error resetting password:', error)
      toast.error(error.message || 'Failed to send reset email')
      throw error
    }
  }

  const signInWithAdminCode = async (code) => {
    const trimmedCode = String(code || '').trim()
    if (!trimmedCode) {
      throw new Error('Enter the admin code')
    }
    if (!isSupabaseConfigured() || !supabase) {
      throw new Error('Admin code login needs Supabase to be configured.')
    }

    try {
      const { data: exchange, error: exchangeError } = await supabase.functions.invoke('admin-code-login', {
        body: { code: trimmedCode }
      })
      if (exchangeError) {
        const context = exchangeError?.context
        let serverMessage = ''
        try {
          serverMessage = (await context?.json?.())?.error || ''
        } catch { /* use the safe fallback below */ }
        throw new Error(serverMessage || exchangeError.message || 'Invalid admin code')
      }
      if (!exchange?.success || !exchange?.token_hash) {
        throw new Error(exchange?.error || 'Invalid admin code')
      }

      const { data, error } = await supabase.auth.verifyOtp({
        token_hash: exchange.token_hash,
        type: exchange.type || 'email'
      })
      if (error) throw error
      if (!data?.session || !data?.user) {
        throw new Error('Admin session could not be established')
      }
      try {
        window.sessionStorage?.setItem('adminAuthenticated', 'true')
        window.sessionStorage?.setItem(ADMIN_CODE_VERIFIED_SESSION_KEY, 'true')
      } catch { /* ignore */ }
      const adminCodeUser = markUserAsAdminCodeSession(data.user)
      setUser(adminCodeUser)
      setLoading(false)
      rememberOnlineSession({ ...data.session, user: adminCodeUser })
      loadUserPreferencesBackground(data.user.id)
      toast.success('Admin code accepted')
      return data
    } catch (error) {
      const errorText = String(error?.message || '').toLowerCase()
      const missingRpc = error?.code === '42883' || errorText.includes('admin-code-login')
      const message = missingRpc
        ? 'Admin code login is not set up yet. Apply the latest Supabase migration first.'
        : (error?.message || 'Invalid admin code')
      console.error('Admin code login failed:', error)
      toast.error(message)
      throw new Error(message)
    }
  }

  const clearRevokedWorkspaceCache = useCallback(async (revokedOwnerId) => {
    const actorId = user?.id
    if (actorId && revokedOwnerId) {
      hydrationIdentityRef.current = {
        generation: (hydrationIdentityRef.current?.generation || 0) + 1,
        actorId,
        ownerId: actorId
      }
      clearPreferenceCache()
      await clearOfflinePreferences(actorId, revokedOwnerId).catch(() => {})
      setWorkspacePreferences(getWorkspaceSettingsDefaults())
      setWorkspacePreferencesOwnerId(null)
      setWorkspaceRevision(0n)
      setPreferencesHydrated(false)
      await loadUserPreferencesBundle(actorId, actorId)
    }
  }, [loadUserPreferencesBundle, user?.id])

  // Sign out - memoized to prevent stale references
  const signOut = useCallback(async () => {
    // Supabase can throw AuthSessionMissingError if the session is already gone.
    // We still want the UI to reliably log out in that case.
    try {
      const currentActorId = user?.id
      const currentOwnerId = user?.user_metadata?.invited_by || user?.id

      // Always clear local UI state FIRST to ensure immediate logout
      setUser(null)
      clearPreferenceCache()
      if (currentActorId) {
        clearOfflinePreferences(currentActorId, currentOwnerId).catch(() => {})
      }
      hydrationIdentityRef.current = { generation: (hydrationIdentityRef.current?.generation || 0) + 1, actorId: null, ownerId: null }
      setPersonalPreferences(getPersonalSettingsDefaults())
      setWorkspacePreferences(getWorkspaceSettingsDefaults())
      setWorkspacePreferencesOwnerId(null)
      setPersonalRevision(0n)
      setWorkspaceRevision(0n)
      setPreferencesHydrated(false)
      setPreferencesLoading(false)
      setPreferencesError(null)
      welcomeToastShownRef.current = false
      try { window.sessionStorage?.removeItem(WELCOME_TOAST_SESSION_KEY) } catch { /* ignore */ }
      try { window.sessionStorage?.removeItem(ADMIN_CODE_VERIFIED_SESSION_KEY) } catch { /* ignore */ }
      try {
        window.sessionStorage?.removeItem(ADMIN_CODE_SESSION_KEY)
        window.sessionStorage?.removeItem('adminAuthenticated')
        window.sessionStorage?.removeItem('datser_admin_code_verified')
      } catch { /* ignore */ }

      clearDeveloperBypassState()

      await Promise.all([
        clearOfflineAuthProfile().catch(() => {}),
        clearAllOfflineData().catch(() => {})
      ])

      if (supabase) {
        const { error } = await supabase.auth.signOut()
        if (error) {
          const msg = (error?.message || '').toLowerCase()
          if (!msg.includes('auth session missing') && !msg.includes('session not found') && !msg.includes('session_missing')) {
            console.error('Error signing out:', error)
          }
        }
      }
    } catch (error) {
      console.error('Error signing out:', error)
      // Don't throw - we already cleared local state so user is logged out
    }
  }, [user?.id, user?.user_metadata?.invited_by])

  // Memoize bypassAuth to prevent recreation on every render
  const bypassAuth = useCallback(async () => {
    if (isLocalWebDeveloperModeAllowed()) {
      localStorage.setItem(DEV_BYPASS_STORAGE_KEY, 'true')
      const devUser = getDeveloperBypassUser()
      const devPreferences = await getDeveloperBypassPreferences()
      setUser(devUser)
      setPersonalPreferences(devPreferences)
      setWorkspacePreferences(devPreferences)
      setWorkspacePreferencesOwnerId(devUser.id)
      setPreferencesHydrated(true)
      setLoading(false)
      toast.success('Entered Developer Mode')
      return devUser
    }

    toast.error('Developer mode is only available from localhost in the browser.')
    throw new Error('Developer mode is not available in this build.')
  }, [])

  // Memoize context value to prevent unnecessary re-renders of consumers
  const value = useMemo(() => ({
    user,
    loading,
    personalPreferences,
    workspacePreferences,
    workspacePreferencesOwnerId,
    personalRevision,
    workspaceRevision,
    preferencesHydrated,
    preferencesLoading,
    preferencesError,
    preferences,
    signInWithGoogle,
    signUpWithEmail,
    signInWithEmail,
    signInWithMagicLink,
    resetPassword,
    signInWithAdminCode,
    signOut,
    clearRevokedWorkspaceCache,
    savePersonalPreferences,
    saveWorkspacePreferences,
    saveUserPreferences,
    updatePreference,
    loadUserPreferences,
    loadUserPreferencesBundle,
    bypassAuth,
    isDeveloperBypass: isDeveloperBypassEnabled,
    isAuthenticated: !!user
  }), [user, loading, personalPreferences, workspacePreferences, workspacePreferencesOwnerId, personalRevision, workspaceRevision, preferencesHydrated, preferencesLoading, preferencesError, preferences, signInWithGoogle, signUpWithEmail, signInWithEmail, signInWithMagicLink, resetPassword, signInWithAdminCode, signOut, clearRevokedWorkspaceCache, savePersonalPreferences, saveWorkspacePreferences, saveUserPreferences, updatePreference, loadUserPreferences, loadUserPreferencesBundle, bypassAuth, isDeveloperBypassEnabled])

  return (
    <AuthContext.Provider value={value}>
      {children}
    </AuthContext.Provider>
  )
}

export default AuthContext
