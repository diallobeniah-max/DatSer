import { createClient } from '@supabase/supabase-js'

const isTestEnv = (
  (typeof process !== 'undefined' && (process.env.NODE_ENV === 'test' || Boolean(process.env.VITEST))) ||
  import.meta.env?.MODE === 'test'
)
const TEST_SUPABASE_URL = 'https://mock-test-project.invalid'
const TEST_SUPABASE_ANON_KEY = 'mock-test-anon-key'

// Read env at build time; guard to support demo mode when not configured
const supabaseUrl = isTestEnv
  ? TEST_SUPABASE_URL
  : (import.meta.env.VITE_SUPABASE_URL || (typeof process !== 'undefined' ? process.env.VITE_SUPABASE_URL : undefined))

const supabaseAnonKey = isTestEnv
  ? TEST_SUPABASE_ANON_KEY
  : (import.meta.env.VITE_SUPABASE_ANON_KEY || (typeof process !== 'undefined' ? process.env.VITE_SUPABASE_ANON_KEY : undefined))

// Expose a function so callers can use either `isSupabaseConfigured()` or treat it as a boolean
export const isSupabaseConfigured = () => Boolean(
  supabaseUrl &&
  supabaseAnonKey &&
  supabaseUrl !== 'your_supabase_url_here' &&
  supabaseUrl !== 'https://placeholder.supabase.co' &&
  supabaseUrl !== 'undefined' &&
  supabaseAnonKey !== 'undefined'
)

// Only create the client when config exists; otherwise export null
export const supabase = isSupabaseConfigured() ? createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    autoRefreshToken: !isTestEnv,
    persistSession: !isTestEnv,
    detectSessionInUrl: false,
    storage: typeof window !== 'undefined' ? window.localStorage : undefined,
    storageKey: 'tmh-teen-auth',
    flowType: 'implicit'
  },
  global: {
    headers: { 'x-client-info': 'tmht-checkin' }
  },
  realtime: {
    params: {
      eventsPerSecond: isTestEnv ? 0 : 10
    }
  }
}) : null

// Quick sync check for existing session (faster than async getSession on old devices)
export const hasStoredSession = () => {
  try {
    if (typeof localStorage === 'undefined') return false
    const stored = localStorage.getItem('tmh-teen-auth')
    if (!stored) return false
    const parsed = JSON.parse(stored)
    return !!(parsed?.access_token && parsed?.expires_at > Date.now() / 1000)
  } catch {
    return false
  }
}
