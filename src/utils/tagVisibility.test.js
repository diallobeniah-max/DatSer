import { describe, expect, it } from 'vitest'
import { areOptionalTagsVisible, getTagSelectionDelta, normalizeVisibleTags } from './tagVisibility'

describe('tag visibility', () => {
  it('uses one explicit workspace preference', () => {
    expect(areOptionalTagsVisible({ showTagsField: true })).toBe(true)
    expect(areOptionalTagsVisible({ showTagsField: false })).toBe(false)
    expect(areOptionalTagsVisible({})).toBe(false)
  })

  it('normalizes RPC tag shapes without treating system labels as tags', () => {
    expect(normalizeVisibleTags([{ tag_id: 7, tag_name: 'Choir', tag_color: '#123456' }]))
      .toEqual([{ id: 7, name: 'Choir', color: '#123456' }])
    expect(normalizeVisibleTags([{ label: '' }, null])).toEqual([])
  })

  it('preserves existing assignments while calculating visible selector changes', () => {
    expect(getTagSelectionDelta(new Set(['choir', 'media']), new Set(['media', 'ushering'])))
      .toEqual({ added: ['ushering'], removed: ['choir'] })
    expect(getTagSelectionDelta(new Set(['choir']), new Set(['choir'])))
      .toEqual({ added: [], removed: [] })
  })
})
