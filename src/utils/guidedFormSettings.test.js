import { beforeEach, describe, expect, it } from 'vitest'
import {
  DEFAULT_GUIDED_FORM_SETTINGS,
  GUIDED_FORM_SETTINGS_KEY,
  readGuidedFormSettings,
  writeGuidedFormSettings
} from './guidedFormSettings'

const createMemoryStorage = () => {
  let store = {}
  return {
    getItem: (key) => (key in store ? store[key] : null),
    setItem: (key, value) => { store[key] = String(value) },
    removeItem: (key) => { delete store[key] },
    clear: () => { store = {} }
  }
}

describe('workspace guided form settings', () => {
  beforeEach(() => {
    if (!globalThis.localStorage || typeof globalThis.localStorage.clear !== 'function') {
      Object.defineProperty(globalThis, 'localStorage', {
        value: createMemoryStorage(),
        configurable: true
      })
    }
    globalThis.localStorage.clear()
  })

  it('defaults optional tags to off when no workspace preference exists', () => {
    expect(readGuidedFormSettings('workspace-new').showTagsField).toBe(false)
    expect(DEFAULT_GUIDED_FORM_SETTINGS.showTagsField).toBe(false)
  })

  it('keeps cached visibility isolated to the owning workspace', () => {
    writeGuidedFormSettings({
      ...DEFAULT_GUIDED_FORM_SETTINGS,
      showTagsField: true
    }, 'workspace-a')

    expect(readGuidedFormSettings('workspace-a').showTagsField).toBe(true)
    expect(readGuidedFormSettings('workspace-b').showTagsField).toBe(false)
  })

  it('does not reuse the old device-global value for another workspace', () => {
    globalThis.localStorage.setItem(GUIDED_FORM_SETTINGS_KEY, JSON.stringify({ showTagsField: true }))
    expect(readGuidedFormSettings('workspace-new').showTagsField).toBe(false)
  })
})
