import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { getGeminiApiKey, hasGeminiApiKey } from './geminiKey.js'

let platformGetter
let envGetter

const STALE_PROCESS_KEY = 'AIzaSyBogusStaleProcessKeyThatLooksPlausible'
const VALID_USER_KEY = 'AIzaSyValidConfiguredUserScopeKeyForDatSer'

const stubExec = (returnValue) => vi.fn(() => returnValue)

beforeEach(() => {
  vi.clearAllMocks()
  // Pin to win32 so the User-scope path is exercised regardless of CI host.
  platformGetter = vi.spyOn(process, 'platform', 'get').mockReturnValue('win32')
  // Fresh process.env per test.
  envGetter = vi.spyOn(process, 'env', 'get').mockReturnValue({})
})

afterEach(() => {
  platformGetter.mockRestore()
  envGetter.mockRestore()
})

describe('geminiKey resolution', () => {
  it('uses the valid Windows User-scope key even when a stale plausible PROCESS value shadows it', () => {
    // Regression: the previous resolver preferred any "plausible" PROCESS value
    // over the configured User-scope credential, so a stale key left in a shell
    // session silently broke extraction. User-scope must win.
    envGetter.mockReturnValue({ GEMINI_API_KEY: STALE_PROCESS_KEY })
    const exec = stubExec(`${VALID_USER_KEY}\r\n`)
    expect(getGeminiApiKey(exec)).toBe(VALID_USER_KEY)
    expect(exec).toHaveBeenCalled()
  })

  it('uses the Windows User-scope key when the PROCESS value is malformed', () => {
    envGetter.mockReturnValue({ GEMINI_API_KEY: '  not-a-real-key with spaces  ' })
    expect(getGeminiApiKey(stubExec(`${VALID_USER_KEY}\r\n`))).toBe(VALID_USER_KEY)
  })

  it('falls back to a plausible PROCESS value when no User-scope key exists', () => {
    envGetter.mockReturnValue({ GEMINI_API_KEY: VALID_USER_KEY })
    expect(getGeminiApiKey(stubExec(''))).toBe(VALID_USER_KEY)
  })

  it('returns empty when neither PROCESS nor USER scope has a valid key', () => {
    envGetter.mockReturnValue({})
    expect(getGeminiApiKey(stubExec(''))).toBe('')
    expect(hasGeminiApiKey(stubExec(''))).toBe(false)
  })

  it('returns empty when the User-scope lookup fails and PROCESS is malformed', () => {
    envGetter.mockReturnValue({ GEMINI_API_KEY: 'stale-with space' })
    const exec = vi.fn(() => { throw new Error('powershell unavailable') })
    expect(getGeminiApiKey(exec)).toBe('')
  })

  it('ignores a plausible PROCESS value that has surrounding whitespace (malformed)', () => {
    envGetter.mockReturnValue({ GEMINI_API_KEY: `  ${VALID_USER_KEY}  ` })
    // Trimmed would be plausible, but the raw value is malformed => not trusted.
    expect(getGeminiApiKey(stubExec(''))).toBe('')
    expect(hasGeminiApiKey(stubExec(''))).toBe(false)
  })
})

describe('geminiKey production/non-Windows behavior', () => {
  beforeEach(() => {
    platformGetter.mockReturnValue('linux')
  })

  it('uses process.env only and never calls the Windows lookup', () => {
    envGetter.mockReturnValue({ GEMINI_API_KEY: VALID_USER_KEY })
    const exec = stubExec('')
    expect(getGeminiApiKey(exec)).toBe(VALID_USER_KEY)
    expect(exec).not.toHaveBeenCalled()
  })

  it('returns empty on non-Windows when process.env has no valid key', () => {
    envGetter.mockReturnValue({})
    expect(getGeminiApiKey(stubExec(''))).toBe('')
  })
})

describe('geminiKey safety', () => {
  it('never returns a partial/truncated key and never logs one', () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
    envGetter.mockReturnValue({ GEMINI_API_KEY: VALID_USER_KEY })
    expect(getGeminiApiKey(stubExec(`${VALID_USER_KEY}\r\n`))).toBe(VALID_USER_KEY)
    // No key material in any log output.
    const logged = logSpy.mock.calls.flat().join(' ')
    expect(logged).not.toContain('AIzaSy')
    logSpy.mockRestore()
  })
})
