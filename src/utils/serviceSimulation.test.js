import { describe, expect, it } from 'vitest'
import { coalesceOfflineChange } from './offlineStore'
import { mergeAttendanceMapWithPending, mergeRealtimeMemberWithPending } from './realtimeMerge'

const TABLE = 'Synthetic_July_2099'
const DATE = '2099-07-19'

const queueChange = (queue, change, timestamp) => {
  const result = coalesceOfflineChange(queue, change, timestamp)
  const removed = new Set(result.removeIds)
  const next = queue.filter((item) => !removed.has(item.local_change_id))
  if (result.queuedChange) {
    const index = next.findIndex((item) => item.local_change_id === result.queuedChange.local_change_id)
    if (index >= 0) next[index] = result.queuedChange
    else next.push(result.queuedChange)
  }
  return next
}

describe('Sunday service reliability simulation', () => {
  it('resolves rapid Present, Absent, and Clear to the newest intent without duplicates', () => {
    let queue = []
    const base = {
      local_change_id: `attendance_${TABLE}_${DATE}_synthetic-member-1`,
      idempotency_key: `attendance_${TABLE}_${DATE}_synthetic-member-1`,
      action_type: 'attendance_mark',
      table_name: TABLE,
      member_id: 'synthetic-member-1',
      service_date: DATE
    }
    queue = queueChange(queue, { ...base, present: true, attendance_status: 'present' }, '2099-07-19T09:00:00.000Z')
    queue = queueChange(queue, { ...base, present: false, attendance_status: 'absent' }, '2099-07-19T09:00:01.000Z')
    queue = queueChange(queue, { ...base, present: null, attendance_status: 'unknown' }, '2099-07-19T09:00:02.000Z')

    expect(queue).toHaveLength(1)
    expect(queue[0]).toMatchObject({ present: null, attendance_status: 'unknown', client_revision: 3 })
    expect(mergeAttendanceMapWithPending({ 'synthetic-member-1': true }, queue, {
      tableName: TABLE,
      serviceDate: DATE
    })).toEqual({})
  })

  it('preserves all fields from repeated offline edits and ignores an older realtime echo', () => {
    let queue = []
    const base = {
      local_change_id: `member_update_${TABLE}_synthetic-member-2`,
      idempotency_key: `member_update_${TABLE}_synthetic-member-2`,
      action_type: 'member_update',
      table_name: TABLE,
      member_id: 'synthetic-member-2'
    }
    queue = queueChange(queue, { ...base, updates: { current_level: 'JHS2' } }, '2099-07-19T09:01:00.000Z')
    queue = queueChange(queue, { ...base, updates: { parent_name_1: 'Synthetic Guardian', tags: ['Synthetic QA'] } }, '2099-07-19T09:01:01.000Z')

    const merged = mergeRealtimeMemberWithPending({
      id: 'synthetic-member-2',
      full_name: 'Synthetic Member',
      current_level: 'JHS1',
      updated_at: '2099-07-19T09:00:00.000Z'
    }, queue, TABLE)

    expect(queue).toHaveLength(1)
    expect(merged.member).toMatchObject({
      current_level: 'JHS2',
      parent_name_1: 'Synthetic Guardian',
      tags: ['Synthetic QA'],
      __offline_status: 'pending_sync'
    })
  })

  it('produces stable final marked counts after delayed and duplicated remote events', () => {
    const pending = [{
      local_change_id: `attendance_${TABLE}_${DATE}_synthetic-member-3`,
      action_type: 'attendance_mark',
      table_name: TABLE,
      member_id: 'synthetic-member-3',
      service_date: DATE,
      present: false,
      sync_status: 'pending'
    }]
    const delayedRemote = {
      'synthetic-member-1': true,
      'synthetic-member-2': true,
      'synthetic-member-3': true,
      'synthetic-member-4': false
    }
    const finalMap = mergeAttendanceMapWithPending(delayedRemote, pending, { tableName: TABLE, serviceDate: DATE })
    const values = Object.values(finalMap)

    expect(values.filter((value) => value === true)).toHaveLength(2)
    expect(values.filter((value) => value === false)).toHaveLength(2)
    expect(Object.keys(finalMap)).toHaveLength(4)
  })
})
