import { createClient } from '@supabase/supabase-js'

const LOCAL_HOSTS = new Set(['127.0.0.1', 'localhost'])

export const assertLocalPocUrl = (value) => {
  const parsed = new URL(value)
  if (!LOCAL_HOSTS.has(parsed.hostname)) {
    throw new Error('RxDB POC refuses non-local Supabase URLs.')
  }
  return parsed.toString().replace(/\/$/, '')
}

export const createLocalPocSupabaseClient = ({ url, anonKey } = {}) => {
  const resolvedUrl = assertLocalPocUrl(url || import.meta.env.VITE_RXDB_POC_SUPABASE_URL || 'http://127.0.0.1:54321')
  const resolvedKey = anonKey || import.meta.env.VITE_RXDB_POC_SUPABASE_ANON_KEY
  if (!resolvedKey) {
    throw new Error('Set VITE_RXDB_POC_SUPABASE_ANON_KEY from the local Supabase status output.')
  }
  return createClient(resolvedUrl, resolvedKey, {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: false,
      storageKey: 'datser-rxdb-poc-auth'
    },
    global: { headers: { 'x-client-info': 'datser-rxdb-backend-poc' } }
  })
}
