import { describe, expect, it } from 'vitest'
import {
  getAndroidMemberV2RuntimeConfig,
  isAndroidMemberV2ValidationBuild,
  runtimeConfigStorageKey,
} from './androidMemberV2TestRuntimeConfig'

const testBuild = { VITE_DATSER_MEMBER_V2_ANDROID_TEST_BUILD: 'true' }

const storage = (value) => ({ getItem: () => value || null })

describe('Member V2 Android validation runtime configuration', () => {
  it('is impossible to enable in a normal build', () => {
    expect(isAndroidMemberV2ValidationBuild({})).toBe(false)
    expect(getAndroidMemberV2RuntimeConfig({ env: {}, storage: storage(JSON.stringify({ url: 'http://10.0.2.2:54321', anonKey: 'local-public-key' })) })).toBeNull()
  })

  it('accepts only a supplied local endpoint for the explicit validation build', () => {
    expect(runtimeConfigStorageKey).toMatch(/^datser\.member-v2\./)
    expect(getAndroidMemberV2RuntimeConfig({
      env: testBuild,
      storage: storage(JSON.stringify({ url: 'http://10.0.2.2:54321', anonKey: 'local-public-key' })),
    })).toEqual({ url: 'http://10.0.2.2:54321', anonKey: 'local-public-key' })
  })

  it('rejects hosted, malformed, and incomplete runtime configuration', () => {
    for (const value of [
      JSON.stringify({ url: 'https://datser.vercel.app', anonKey: 'not-allowed' }),
      JSON.stringify({ url: 'http://10.0.2.2:54321' }),
      'not-json',
    ]) {
      expect(getAndroidMemberV2RuntimeConfig({ env: testBuild, storage: storage(value) })).toBeNull()
    }
  })
})
