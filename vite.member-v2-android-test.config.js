import { defineConfig, mergeConfig } from 'vite'
import baseConfig from './vite.config.js'

// Deliberately erase any inherited VITE Supabase settings for this bundle.
// The test app receives a local endpoint and public anon key only after it is
// installed, so neither production nor local credentials are shipped in it.
export default defineConfig(() => mergeConfig(baseConfig, {
  define: {
    'import.meta.env.VITE_SUPABASE_URL': 'undefined',
    'import.meta.env.VITE_SUPABASE_ANON_KEY': 'undefined',
  },
}))
