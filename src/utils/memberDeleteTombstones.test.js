// @vitest-environment jsdom
import { describe, expect, it, beforeEach } from 'vitest'
import {
  addMemberDeleteTombstone,
  clearMemberDeleteTombstones,
  filterDeletedMembers,
  getActiveSnapshotMembers,
  isMemberStaleDeleted,
  readMemberDeleteTombstones,
  removeMemberDeleteTombstone,
  writeMemberDeleteTombstones
} from './memberDeleteTombstones'

const DELETED_AT = '2026-08-07T12:00:00.000Z'
const BEFORE = '2026-08-07T11:00:00.000Z'
const AFTER = '2026-08-07T13:00:00.000Z'

const activeMember = (id, updatedAt = AFTER) => ({ id, full_name: 'Active Member', updated_at: updatedAt })
const deletedMember = (id, updatedAt = DELETED_AT) => ({ id, full_name: 'Deleted Member', updated_at: updatedAt, deleted_at: DELETED_AT })

describe('member delete tombstones', () => {
  beforeEach(() => {
    clearMemberDeleteTombstones()
  })

  it('round-trips tombstones through localStorage', () => {
    addMemberDeleteTombstone('uuid-1', DELETED_AT, 'August_2026')
    addMemberDeleteTombstone('uuid-2', DELETED_AT, 'August_2026')
    const list = readMemberDeleteTombstones()
    expect(list).toHaveLength(2)
    expect(list.map((t) => t.id)).toEqual(['uuid-1', 'uuid-2'])
    removeMemberDeleteTombstone('uuid-1')
    expect(readMemberDeleteTombstones().map((t) => t.id)).toEqual(['uuid-2'])
    clearMemberDeleteTombstones()
    expect(readMemberDeleteTombstones()).toEqual([])
  })

  it('A: a deleted member in an offline snapshot is never restored as active', () => {
    const snapshot = { members: [activeMember('a'), deletedMember('d')] }
    const restored = getActiveSnapshotMembers(snapshot)
    expect(restored.map((m) => m.id)).toEqual(['a'])
  })

  it('B: an active member in the snapshot still restores', () => {
    const snapshot = { members: [activeMember('a'), activeMember('b')] }
    expect(getActiveSnapshotMembers(snapshot).map((m) => m.id)).toEqual(['a', 'b'])
  })

  it('C: snapshot persistence excludes deleted rows', () => {
    // The auto-snapshot persists filterDeletedMembers(members).
    const toSave = filterDeletedMembers([activeMember('a'), deletedMember('d')])
    expect(toSave.map((m) => m.id)).toEqual(['a'])
  })

  it('E: stale pre-delete preview data cannot resurrect a newer deleted member', () => {
    addMemberDeleteTombstone('uuid-x', DELETED_AT, 'August_2026')
    // Pre-delete cache row: updated_at older than the deletion -> stale -> filtered.
    expect(filterDeletedMembers([activeMember('uuid-x', BEFORE)])).toEqual([])
    expect(isMemberStaleDeleted(activeMember('uuid-x', BEFORE))).toBe(true)
  })

  it('E2: a restored member (newer updated_at than the tombstone) is kept', () => {
    addMemberDeleteTombstone('uuid-x', DELETED_AT, 'August_2026')
    expect(filterDeletedMembers([activeMember('uuid-x', AFTER)])).toHaveLength(1)
    expect(isMemberStaleDeleted(activeMember('uuid-x', AFTER))).toBe(false)
  })

  it('F: deleting one member does not clear unrelated cached members', () => {
    addMemberDeleteTombstone('deleted-uuid', DELETED_AT, 'August_2026')
    const members = [activeMember('other-1'), activeMember('other-2'), activeMember('deleted-uuid', BEFORE)]
    const kept = filterDeletedMembers(members)
    expect(kept.map((m) => m.id)).toEqual(['other-1', 'other-2'])
    expect(readMemberDeleteTombstones()).toHaveLength(1)
  })

  it('G: normal offline restore still works for active members', () => {
    const snapshot = { members: [activeMember('a'), activeMember('b'), deletedMember('c')] }
    expect(getActiveSnapshotMembers(snapshot).map((m) => m.id)).toEqual(['a', 'b'])
  })

  it('ignores members already carrying deleted_at even without a tombstone', () => {
    expect(filterDeletedMembers([deletedMember('x')])).toEqual([])
  })

  it('is a no-op when no tombstones exist (no false filtering)', () => {
    expect(filterDeletedMembers([activeMember('a')]).map((m) => m.id)).toEqual(['a'])
    expect(writeMemberDeleteTombstones([{ id: 'a', deleted_at: DELETED_AT }])).toBeUndefined()
  })
})
