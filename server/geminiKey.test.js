import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { getGeminiApiKey, hasGeminiApiKey } from './geminiKey.js'

let platformGetter
let envGetter

const STALE_PROCESS_KEY = 'AIzaSyBogusStaleProcessKeyThatLooksPlausible'
const VALID_USER_KEY = 'AIzaSyValidConfiguredUserScopeKeyForDatSer'
const STORED_KEY = 'AIzaSyValidStoredProviderCredentialForDatSer'

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
  it('uses the valid Windows User-scope key even when a stale plausible PROCESS value shadows it', async () => {
    envGetter.mockReturnValue({ GEMINI_API_KEY: STALE_PROCESS_KEY })
    const exec = stubExec(`${VALID_USER_KEY}\r\n`)
    expect(await getGeminiApiKey({ exec })).toBe(VALID_USER_KEY)
    expect(exec).toHaveBeenCalled()
  })

  it('uses the Windows User-scope key when the PROCESS value is malformed', async () => {
    envGetter.mockReturnValue({ GEMINI_API_KEY: '  not-a-real-key with spaces  ' })
    expect(await getGeminiApiKey({ exec: stubExec(`${VALID_USER_KEY}\r\n`) })).toBe(VALID_USER_KEY)
  })

  it('falls back to a plausible PROCESS value when no User-scope key exists', async () => {
    envGetter.mockReturnValue({ GEMINI_API_KEY: VALID_USER_KEY })
    expect(await getGeminiApiKey({ exec: stubExec('') })).toBe(VALID_USER_KEY)
  })

  it('returns empty when neither PROCESS nor USER scope has a valid key', async () => {
    envGetter.mockReturnValue({})
    expect(await getGeminiApiKey({ exec: stubExec('') })).toBe('')
    expect(await hasGeminiApiKey({ exec: stubExec('') })).toBe(false)
  })

  it('returns empty when the User-scope lookup fails and PROCESS is malformed', async () => {
    envGetter.mockReturnValue({ GEMINI_API_KEY: 'stale-with space' })
    const exec = vi.fn(() => { throw new Error('powershell unavailable') })
    expect(await getGeminiApiKey({ exec })).toBe('')
  })

  it('ignores a plausible PROCESS value that has surrounding whitespace (malformed)', async () => {
    envGetter.mockReturnValue({ GEMINI_API_KEY: `  ${VALID_USER_KEY}  ` })
    expect(await getGeminiApiKey({ exec: stubExec('') })).toBe('')
    expect(await hasGeminiApiKey({ exec: stubExec('') })).toBe(false)
  })
})

describe('geminiKey production/non-Windows behavior', () => {
  beforeEach(() => {
    platformGetter.mockReturnValue('linux')
  })

  it('uses process.env only and never calls the Windows lookup', async () => {
    envGetter.mockReturnValue({ GEMINI_API_KEY: VALID_USER_KEY })
    const exec = stubExec('')
    expect(await getGeminiApiKey({ exec })).toBe(VALID_USER_KEY)
    expect(exec).not.toHaveBeenCalled()
  })

  it('returns empty on non-Windows when process.env has no valid key', async () => {
    envGetter.mockReturnValue({})
    expect(await getGeminiApiKey({ exec: stubExec('') })).toBe('')
  })
})

describe('geminiKey stored-credential resolver (AI Providers)', () => {
  beforeEach(() => {
    platformGetter.mockReturnValue('linux')
  })

  it('prefers a valid server-stored credential over the environment fallback', async () => {
    envGetter.mockReturnValue({ GEMINI_API_KEY: VALID_USER_KEY })
    const storedCredentialResolver = vi.fn(async () => STORED_KEY)
    expect(await getGeminiApiKey({ storedCredentialResolver })).toBe(STORED_KEY)
    expect(storedCredentialResolver).toHaveBeenCalledTimes(1)
  })

  it('falls back to the environment variable when the stored resolver returns empty', async () => {
    envGetter.mockReturnValue({ GEMINI_API_KEY: VALID_USER_KEY })
    const storedCredentialResolver = vi.fn(async () => '')
    expect(await getGeminiApiKey({ storedCredentialResolver })).toBe(VALID_USER_KEY)
  })

  it('falls back to the environment variable when the stored resolver throws', async () => {
    envGetter.mockReturnValue({ GEMINI_API_KEY: VALID_USER_KEY })
    const storedCredentialResolver = vi.fn(async () => { throw new Error('resolve failed') })
    expect(await getGeminiApiKey({ storedCredentialResolver })).toBe(VALID_USER_KEY)
  })

  it('returns empty when the stored resolver returns empty and no env key exists', async () => {
    envGetter.mockReturnValue({})
    const storedCredentialResolver = vi.fn(async () => '')
    expect(await getGeminiApiKey({ storedCredentialResolver })).toBe('')
  })
})

describe('geminiKey safety', () => {
  it('never returns a partial/truncated key and never logs one', async () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
    envGetter.mockReturnValue({ GEMINI_API_KEY: VALID_USER_KEY })
    expect(await getGeminiApiKey({ exec: stubExec(`${VALID_USER_KEY}\r\n`) })).toBe(VALID_USER_KEY)
    const logged = logSpy.mock.calls.flat().join(' ')
    expect(logged).not.toContain('AIzaSy')
    logSpy.mockRestore()
  })
})
