import { createClient } from '@supabase/supabase-js'

const LOCAL_HOSTS = new Set(['127.0.0.1', 'localhost'])

export const createLocalMemberV2SupabaseClient = () => {
  const url = new URL(import.meta.env.VITE_RXDB_MEMBER_V2_SUPABASE_URL || 'http://127.0.0.1:54321')
  if (!LOCAL_HOSTS.has(url.hostname)) throw new Error('The isolated Member V2 demo refuses non-local Supabase URLs.')
  const key = import.meta.env.VITE_RXDB_MEMBER_V2_SUPABASE_ANON_KEY
  if (!key) throw new Error('Set VITE_RXDB_MEMBER_V2_SUPABASE_ANON_KEY from local Supabase status.')
  return createClient(url.toString().replace(/\/$/, ''), key, { auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false, storageKey: 'datser-member-v2-demo-auth' }, global: { headers: { 'x-client-info': 'datser-member-v2-demo' } } })
}
