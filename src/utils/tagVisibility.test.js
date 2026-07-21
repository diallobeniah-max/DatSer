import { describe, expect, it } from 'vitest'
import { areOptionalTagsVisible, normalizeVisibleTags } from './tagVisibility'

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
})
