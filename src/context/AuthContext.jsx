import React, { createContext, useContext, useState, useEffect, useCallback, useRef, useMemo } from 'react'
import { supabase, hasStoredSession, isSupabaseConfigured } from '../lib/supabase'
import { toast } from 'react-toastify'
import { executeSupabaseWrite, isTransientSupabaseError } from '../utils/supabaseWrite'
import {
  clearAllOfflineData,
  clearOfflineAuthProfile,
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
  const [preferences, setPreferences] = useState(null)
  const preferencesRef = useRef(null)
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
      if (cachedPreferences?.preferences) {
        setPreferences(cachedPreferences.preferences)
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

  // Load preferences in background (non-blocking)
  const loadUserPreferencesBackground = useCallback((userId) => {
    // Use requestIdleCallback for old devices, fallback to setTimeout
    const scheduleLoad = window.requestIdleCallback || ((cb) => setTimeout(cb, 50))
    scheduleLoad(() => loadUserPreferences(userId))
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
          setPreferences(devPreferences)
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
            if (data?.session) {
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
          setPreferences(null)
          welcomeToastShownRef.current = false // Reset for next login
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

  // Load user preferences from database
  const loadUserPreferences = async (userId) => {
    if (isDeveloperBypassEnabled) {
      const devPreferences = await getDeveloperBypassPreferences()
      setPreferences(devPreferences)
      return devPreferences
    }

    try {
      if (isBrowserOffline()) {
        const cached = await getOfflinePreferences(userId).catch(() => null)
        if (cached?.preferences) {
          setPreferences(cached.preferences)
          return cached.preferences
        }
      }

      if (supabase) {
        const { data, error } = await supabase
          .from('user_preferences')
          .select('*')
          .eq('user_id', userId)
          .single()

        if (error && error.code !== 'PGRST116') {
          // PGRST116 = no rows returned (new user)
          console.warn('Using local preferences because remote load failed:', error)
          return
        }

        if (data) {
          const cached = await getOfflinePreferences(userId).catch(() => null)
          const localOverride = readLocalPreferenceOverride(userId)
          const cachedSavedAt = cached?.saved_at ? new Date(cached.saved_at).getTime() : 0
          const localOverrideSavedAt = localOverride?.saved_at ? new Date(localOverride.saved_at).getTime() : 0
          const remoteUpdatedAt = data.updated_at ? new Date(data.updated_at).getTime() : 0
          const localCacheIsNewer = cachedSavedAt > 0 && cachedSavedAt >= remoteUpdatedAt
          const mergedBasePreferences = localCacheIsNewer
            ? {
              ...data,
              ...(cached?.preferences || {}),
              user_id: data.user_id || userId
            }
            : {
              ...(cached?.preferences || {}),
              ...data,
              user_id: data.user_id || userId
            }
          const mergedPreferences = localOverrideSavedAt >= remoteUpdatedAt
            ? {
              ...mergedBasePreferences,
              ...(localOverride?.preferences || {}),
              user_id: data.user_id || userId
            }
            : mergedBasePreferences
          // The server is authoritative for the workspace-wide code settings.
          // A stale personal cache must not change every collaborator back to
          // the default format while the app is starting.
          const confirmedPreferences = preserveRemoteWorkspaceMemberCodeConfiguration(mergedPreferences, data)
          setPreferences(confirmedPreferences)
          saveOfflinePreferences(userId, confirmedPreferences).catch((error) => {
            console.warn('Could not cache preferences for offline use:', error)
          })
          // Only apply database preferences if localStorage doesn't have values
          // This preserves user's most recent selections even after logout
          if (data.selected_month_table && !localStorage.getItem('selectedMonthTable')) {
            localStorage.setItem('selectedMonthTable', data.selected_month_table)
          }
          if (data.badge_filter && !localStorage.getItem('badgeFilter')) {
            localStorage.setItem('badgeFilter', JSON.stringify(data.badge_filter))
          }
          return confirmedPreferences
        }
      }
    } catch (error) {
      console.warn('Using cached preferences after load failed:', error)
      const cached = await getOfflinePreferences(userId).catch(() => null)
      if (cached?.preferences) {
        setPreferences(cached.preferences)
        return cached.preferences
      }
    }
  }

  // Save user preferences to database
  const saveUserPreferences = async (newPreferences) => {
    if (!user) return

    const cached = await getOfflinePreferences(user.id).catch(() => null)
    const freshestPreferences = {
      ...(cached?.preferences || {}),
      ...(preferencesRef.current || {})
    }
    const nextPreferences = {
      ...freshestPreferences,
      ...normalizePreferencePayload(newPreferences, user.id),
      user_id: user.id
    }

    try {
      if (isDeveloperBypassEnabled) {
        const devPreferences = {
          ...(preferences || DEV_BYPASS_PREFERENCES),
          ...normalizePreferencePayload(newPreferences, user.id),
          user_id: user.id
        }
        setPreferences(devPreferences)
        preferencesRef.current = devPreferences
        writeDeveloperBypassPreferenceCache(devPreferences)
        await saveOfflinePreferences(user.id, devPreferences).catch(() => {})
        return devPreferences
      }

      setPreferences(nextPreferences)
      preferencesRef.current = nextPreferences
      writeLocalPreferenceOverride(user.id, nextPreferences)
      await saveOfflinePreferences(user.id, nextPreferences).catch((error) => {
        console.warn('Could not cache preferences for offline use:', error)
      })

      if (!isSupabaseConfigured() || !supabase || isBrowserOffline()) {
        await queuePreferenceSync(user.id, nextPreferences)
        return nextPreferences
      }

      if (supabase) {
        const { data } = await executeSupabaseWrite(
          () => supabase
            .from('user_preferences')
            .upsert({
              user_id: user.id,
              ...omitWorkspaceMemberCodeConfiguration(nextPreferences, user.id),
              updated_at: new Date().toISOString()
            }, {
              onConflict: 'user_id'
            })
            .select()
            .single(),
          { action: 'Save user preferences' }
        )

        const savedPreferences = preserveRemoteWorkspaceMemberCodeConfiguration(data || nextPreferences, data)
        setPreferences(savedPreferences)
        preferencesRef.current = savedPreferences
        await saveOfflinePreferences(user.id, savedPreferences).catch(() => {})
        return savedPreferences
      }
    } catch (error) {
      // Network / fetch errors are expected when Supabase is unreachable.
      // Keep the UI responsive and avoid throwing (which can cascade into repeated calls).
      const retryable = isTransientSupabaseError(error) || isPreferenceSchemaError(error) || isBrowserOffline()
      if (retryable) {
        console.warn('Preference save queued for later sync:', error)
      } else {
        console.error('Error saving preferences:', error)
      }
      if (retryable) {
        setPreferences(nextPreferences)
        preferencesRef.current = nextPreferences
        await saveOfflinePreferences(user.id, nextPreferences).catch(() => {})
        await queuePreferenceSync(user.id, nextPreferences)
        return nextPreferences
      }

      // Permission/validation failures will not heal through retries. Restore
      // the last confirmed state and make the failure visible.
      setPreferences(freshestPreferences)
      preferencesRef.current = freshestPreferences
      writeLocalPreferenceOverride(user.id, freshestPreferences)
      await saveOfflinePreferences(user.id, freshestPreferences).catch(() => {})
      toast.error(error?.message || 'Setting could not be saved. Please retry.')
      throw error
    }
  }

  // Update a single preference
  const updatePreference = async (key, value, options = {}) => {
    if (!user) {
      // If not logged in, just save to localStorage
      return
    }

    try {
      const nextPreferences = {
        ...(preferencesRef.current || preferences || {}),
        user_id: preferencesRef.current?.user_id || preferences?.user_id || user.id,
        [key]: value
      }

      // Always update local state immediately so UI reflects change.
      setPreferences(nextPreferences)
      preferencesRef.current = nextPreferences
      writeLocalPreferenceOverride(user.id, nextPreferences)
      if (isDeveloperBypassEnabled) {
        writeDeveloperBypassPreferenceCache(nextPreferences)
      }
      await saveOfflinePreferences(user.id, nextPreferences).catch(() => {})

      // If Supabase isn't ready/online, skip remote write.
      if (!isSupabaseConfigured() || !supabase || isBrowserOffline()) {
        await queuePreferenceSync(user.id, nextPreferences)
        return
      }

      return await saveUserPreferences(nextPreferences)
    } catch (error) {
      console.error('Error updating preference:', error)
      if (options?.throwOnError) throw error
    }
  }

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

  // Sign out - memoized to prevent stale references
  const signOut = useCallback(async () => {
    // Supabase can throw AuthSessionMissingError if the session is already gone.
    // We still want the UI to reliably log out in that case.
    try {
      // Always clear local UI state FIRST to ensure immediate logout
      setUser(null)
      setPreferences(null)
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
  }, [])

  // Memoize bypassAuth to prevent recreation on every render
  const bypassAuth = useCallback(async () => {
    if (isLocalWebDeveloperModeAllowed()) {
      localStorage.setItem(DEV_BYPASS_STORAGE_KEY, 'true')
      const devUser = getDeveloperBypassUser()
      const devPreferences = await getDeveloperBypassPreferences()
      setUser(devUser)
      setPreferences(devPreferences)
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
    preferences,
    signInWithGoogle,
    signUpWithEmail,
    signInWithEmail,
    signInWithMagicLink,
    resetPassword,
    signInWithAdminCode,
    signOut,
    saveUserPreferences,
    updatePreference,
    loadUserPreferences,
    bypassAuth,
    isDeveloperBypass: isDeveloperBypassEnabled,
    isAuthenticated: !!user
  }), [user, loading, preferences, signInWithGoogle, signUpWithEmail, signInWithEmail, signInWithMagicLink, resetPassword, signInWithAdminCode, signOut, saveUserPreferences, updatePreference, loadUserPreferences, bypassAuth, isDeveloperBypassEnabled])

  return (
    <AuthContext.Provider value={value}>
      {children}
    </AuthContext.Provider>
  )
}

export default AuthContext
