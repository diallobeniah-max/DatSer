import { describe, expect, it } from 'vitest'
import {
  getPendingCalendarPreferenceOverlay,
  mergeRemotePersonalPreferences,
  pickCalendarPreferencePatch
} from './AuthContext'

describe('calendar preference hydration priority', () => {
  it('keeps a pending Manual September selection when an older remote August bundle arrives', () => {
    const pending = getPendingCalendarPreferenceOverlay([
      {
        action_type: 'preferences_update',
        user_id: 'member-1',
        created_at: '2026-08-01T09:00:00.000Z',
        sync_status: 'pending',
        preferences: {
          calendar_mode: 'manual',
          manual_month_table: 'September_2026',
          manual_sunday_date: '2026-09-06',
          manual_override_until: '2026-09-07T12:00:00.000Z'
        }
      }
    ], 'member-1')

    const resolved = mergeRemotePersonalPreferences({
      calendar_mode: 'auto',
      current_month_table: 'August_2026',
      manual_month_table: null,
      manual_sunday_date: null
    }, pending)

    expect(resolved).toMatchObject({
      calendar_mode: 'manual',
      manual_month_table: 'September_2026',
      manual_sunday_date: '2026-09-06'
    })
  })

  it('keeps the newest pending October change over both an old remote value and a prior queued value', () => {
    const pending = getPendingCalendarPreferenceOverlay([
      {
        action_type: 'preferences_update',
        user_id: 'member-1',
        created_at: '2026-08-01T09:00:00.000Z',
        sync_status: 'pending',
        preferences: { calendar_mode: 'manual', manual_month_table: 'September_2026' }
      },
      {
        action_type: 'preferences_update',
        user_id: 'member-1',
        created_at: '2026-08-01T09:01:00.000Z',
        sync_status: 'pending',
        preferences: { calendar_mode: 'manual', manual_month_table: 'October_2026', manual_sunday_date: '2026-10-04' }
      }
    ], 'member-1')

    expect(mergeRemotePersonalPreferences({
      calendar_mode: 'auto',
      current_month_table: 'August_2026',
      manual_month_table: null
    }, pending)).toMatchObject({
      calendar_mode: 'manual',
      manual_month_table: 'October_2026',
      manual_sunday_date: '2026-10-04'
    })
  })

  it('does not let unrelated queued preferences replace a fresh remote calendar setting', () => {
    expect(pickCalendarPreferencePatch({ theme_mode: 'dark', language: 'en' })).toEqual({})
    expect(mergeRemotePersonalPreferences(
      { calendar_mode: 'auto', current_month_table: 'August_2026' },
      {}
    )).toEqual({ calendar_mode: 'auto', current_month_table: 'August_2026' })
  })
})
