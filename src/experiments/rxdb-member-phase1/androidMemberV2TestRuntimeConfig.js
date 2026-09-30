const runtimeConfigStorageKey = 'datser.member-v2.android-test.local-supabase'

const isLocalTestUrl = (value) => {
  try {
    const url = new URL(value)
    return url.protocol === 'http:' && ['127.0.0.1', 'localhost', '10.0.2.2'].includes(url.hostname)
  } catch {
    return false
  }
}

const storageFor = (storage) => storage || (typeof window === 'undefined' ? null : window.localStorage)

// The Android validation APK carries only this marker. Its local endpoint and
// public anon key are delivered after installation by the test operator, never
// compiled into the bundle or committed to the repository.
export const isAndroidMemberV2ValidationBuild = (env = import.meta.env) => (
  env?.VITE_DATSER_MEMBER_V2_ANDROID_TEST_BUILD === 'true'
)

export const getAndroidMemberV2RuntimeConfig = ({ env = import.meta.env, storage } = {}) => {
  if (!isAndroidMemberV2ValidationBuild(env)) return null
  try {
    const raw = storageFor(storage)?.getItem(runtimeConfigStorageKey)
    const parsed = raw ? JSON.parse(raw) : null
    if (!isLocalTestUrl(parsed?.url) || !String(parsed?.anonKey || '').trim()) return null
    return { url: parsed.url, anonKey: parsed.anonKey }
  } catch {
    return null
  }
}

export { runtimeConfigStorageKey }
