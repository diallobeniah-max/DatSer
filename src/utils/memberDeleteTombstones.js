// Persistent, id-scoped tombstones for soft-deleted members. A confirmed delete
// records { id, deleted_at, table } so that an older local cache/offline snapshot
// cannot resurrect the member as active after a reopen. Timestamps make the guard
// safe for restored members (a restore writes a newer updated_at than the
// tombstone's deleted_at, so the member is kept).
//
// Storage prefers window.localStorage (browser). In environments without a DOM a
// module-level in-memory fallback keeps the utility fully testable.

const TOMBSTONE_STORAGE_KEY = 'datser_member_delete_tombstones_v1'
const MAX_TOMBSTONES = 200

let memoryTombstones = []

const getStorage = () => {
  if (typeof window !== 'undefined' && window.localStorage) {
    return window.localStorage
  }
  return null
}

export const readMemberDeleteTombstones = () => {
  const storage = getStorage()
  if (storage) {
    try {
      const parsed = JSON.parse(storage.getItem(TOMBSTONE_STORAGE_KEY) || 'null')
      if (Array.isArray(parsed)) return parsed.filter((e) => e && e.id)
    } catch {
      // fall through to memory
    }
  }
  return memoryTombstones
}

export const writeMemberDeleteTombstones = (tombstones) => {
  const clean = (tombstones || []).slice(0, MAX_TOMBSTONES)
  const storage = getStorage()
  if (storage) {
    try {
      storage.setItem(TOMBSTONE_STORAGE_KEY, JSON.stringify(clean))
      return
    } catch {
      // fall through to memory
    }
  }
  memoryTombstones = clean
}

export const addMemberDeleteTombstone = (id, deletedAt = null, table = null) => {
  if (!id) return
  const key = String(id)
  const next = readMemberDeleteTombstones().filter((entry) => entry.id !== key)
  next.push({ id: key, deleted_at: deletedAt || null, table: table || null })
  writeMemberDeleteTombstones(next)
}

export const removeMemberDeleteTombstone = (id) => {
  if (!id) return
  const key = String(id)
  writeMemberDeleteTombstones(readMemberDeleteTombstones().filter((entry) => entry.id !== key))
}

export const clearMemberDeleteTombstones = () => {
  const storage = getStorage()
  if (storage) {
    try {
      storage.removeItem(TOMBSTONE_STORAGE_KEY)
    } catch {
      // ignore
    }
  }
  memoryTombstones = []
}

export const getMemberDeleteTombstone = (id, tombstoneList = readMemberDeleteTombstones()) => {
  if (!id) return null
  const key = String(id)
  return tombstoneList.find((entry) => entry.id === key) || null
}

const toTimestamp = (value) => {
  const parsed = Date.parse(value || '')
  return Number.isFinite(parsed) ? parsed : NaN
}

// A member row is considered stale-deleted when a tombstone exists for its id
// and the row's own updated_at is not newer than the deletion. A restored
// member (newer updated_at) is intentionally kept.
export const isMemberStaleDeleted = (member, tombstoneList = readMemberDeleteTombstones()) => {
  if (!member) return false
  if (member.deleted_at) return true
  const tombstone = getMemberDeleteTombstone(member?.id, tombstoneList)
  if (!tombstone) return false
  const deletedTime = toTimestamp(tombstone.deleted_at)
  if (!Number.isFinite(deletedTime) || deletedTime <= 0) return true
  const memberTime = toTimestamp(member.updated_at || member.updatedAt || member.modified_at || member.inserted_at || member.created_at)
  if (!Number.isFinite(memberTime) || memberTime <= 0) return false
  return memberTime <= deletedTime
}

// Pure filter used by offline snapshot restore, preview cache/index writers and
// startup hydration. Rows already marked deleted_at (or tombstoned as stale) are
// never treated as active.
export const filterDeletedMembers = (members = [], tombstoneList = readMemberDeleteTombstones()) =>
  (Array.isArray(members) ? members : []).filter((member) => !isMemberStaleDeleted(member, tombstoneList))

// Active members for an offline snapshot (same rule as filterDeletedMembers).
export const getActiveSnapshotMembers = (snapshot = {}, tombstoneList = readMemberDeleteTombstones()) =>
  filterDeletedMembers(Array.isArray(snapshot?.members) ? snapshot.members : [], tombstoneList)
