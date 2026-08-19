import { execSync } from 'node:child_process'

// Resolves the Gemini API key for server-side use only.
//
// Resolution order (most preferred first):
//   1. a stored DatSer AI-provider credential (encrypted server-side, resolved
//      by the caller via ai_provider_resolve_key with a server-side Supabase
//      client). Passed in as `storedCredentialResolver` so the extraction
//      handler can resolve it without this module owning Supabase internals.
//   2. the GEMINI_API_KEY server environment variable (existing deployments).
//
// Windows note: an inherited PROCESS-level GEMINI_API_KEY may shadow the valid
// User-scope value (e.g. a stale key left in a shell session). The User-scope
// value is the machine's configured credential, so on Windows we prefer it
// whenever it is present and plausible, and treat PROCESS as a fallback.
// Production/Vercel (non-Windows) keeps using process.env only. Real values
// are never logged, echoed, or returned to callers.
const looksPlausible = (value) => {
  if (!value || typeof value !== 'string') return false
  const trimmed = value.trim()
  return trimmed.length > 10 && trimmed === value && !/\s/.test(trimmed)
}

const readWindowsUserScope = (exec) => {
  try {
    return exec(
      "[Environment]::GetEnvironmentVariable('GEMINI_API_KEY','User')",
      { shell: 'powershell.exe', encoding: 'utf8', windowsHide: true }
    ).trim()
  } catch {
    return ''
  }
}

// The one canonical server-only Gemini credential resolver. Its `source` is
// safe diagnostic metadata; `key` must never leave server code or logs.
// A known-invalid selected key is deliberately NOT followed by opportunistic
// fallbacks: the caller reports it once instead of silently spending retries on
// an unintended credential.
export const resolveServerGeminiCredential = async ({
  exec = execSync,
  storedCredentialResolver = null
} = {}) => {
  if (typeof storedCredentialResolver === 'function') {
    try {
      const stored = await storedCredentialResolver()
      if (looksPlausible(stored)) return { key: stored.trim(), source: 'supabase-provider-store' }
    } catch {
      // fall through to env vars
    }
  }

  // Prefer the configured User-scope credential on Windows so a stale/malformed
  // PROCESS value can never shadow the valid key again.
  if (process.platform === 'win32') {
    const userValue = readWindowsUserScope(exec)
    if (looksPlausible(userValue)) return { key: userValue, source: 'windows-user' }
  }

  const processValue = process.env.GEMINI_API_KEY || ''
  if (looksPlausible(processValue)) return { key: processValue.trim(), source: 'windows-process' }
  return { key: '', source: 'none' }
}

export const getGeminiApiKey = async (options) => (await resolveServerGeminiCredential(options)).key

export const hasGeminiApiKey = async (options) => looksPlausible(await getGeminiApiKey(options))
