import { execSync } from 'node:child_process'

// Resolves the Gemini API key for server-side use only.
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

export const getGeminiApiKey = (exec = execSync) => {
  // Prefer the configured User-scope credential on Windows so a stale/malformed
  // PROCESS value can never shadow the valid key again.
  if (process.platform === 'win32') {
    const userValue = readWindowsUserScope(exec)
    if (looksPlausible(userValue)) return userValue
  }

  const processValue = process.env.GEMINI_API_KEY || ''
  if (looksPlausible(processValue)) return processValue.trim()
  return ''
}

export const hasGeminiApiKey = (exec) => looksPlausible(getGeminiApiKey(exec))