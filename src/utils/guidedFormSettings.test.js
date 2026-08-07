// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest'
import {
  DEFAULT_GUIDED_FORM_SETTINGS,
  GUIDED_FORM_SETTINGS_KEY,
  readGuidedFormSettings,
  writeGuidedFormSettings
} from './guidedFormSettings'

const createMemoryStorage = () => {
  const store = new Map()
  return {
    getItem: (key) => store.get(key) || null,
    setItem: (key, value) => { store.set(key, String(value)) },
    removeItem: (key) => { store.delete(key) },
    clear: () => { store.clear() }
  }
}

describe('workspace guided form settings', () => {
  beforeEach(() => {
    Object.defineProperty(window, 'localStorage', {
      value: createMemoryStorage(),
      writable: true,
      configurable: true
    })
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
    window.localStorage.setItem(GUIDED_FORM_SETTINGS_KEY, JSON.stringify({ showTagsField: true }))
    expect(readGuidedFormSettings('workspace-new').showTagsField).toBe(false)
  })
})
