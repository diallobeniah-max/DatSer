import { describe, expect, it } from 'vitest'
import {
  buildAutoCalendarPreferences,
  buildManualCalendarPreferences,
  getPersonalManualDeadline,
  getPersonalManualExpiryPhase,
  PERSONAL_MANUAL_DURATION_MS,
  PERSONAL_MANUAL_WARNING_MS
} from './personalCalendarMode'

describe('personal calendar mode inactivity', () => {
  it('creates the complete persisted Manual selection only after a Sunday is chosen', () => {
    expect(buildManualCalendarPreferences({
      tableName: 'January_2026',
      dateKey: '2026-01-11',
      expiresAt: '2026-01-11T12:06:00.000Z'
    })).toEqual({
      calendar_mode: 'manual',
      manual_month_table: 'January_2026',
      manual_sunday_date: '2026-01-11',
      manual_override_until: '2026-01-11T12:06:00.000Z'
    })
  })

  it('clears every Manual field when returning to Auto', () => {
    expect(buildAutoCalendarPreferences()).toEqual({
      calendar_mode: 'auto',
      manual_month_table: null,
      manual_sunday_date: null,
      manual_override_until: null
    })
  })

  it('keeps Manual active for five minutes before the one-minute warning', () => {
    const now = 1_000
    const deadlineAt = getPersonalManualDeadline(now)

    expect(deadlineAt).toBe(now + PERSONAL_MANUAL_DURATION_MS)
    expect(getPersonalManualExpiryPhase({ isManualMode: true, deadlineAt, now })).toBe('active')
    expect(getPersonalManualExpiryPhase({
      isManualMode: true,
      deadlineAt,
      now: deadlineAt - PERSONAL_MANUAL_WARNING_MS
    })).toBe('warning')
  })

  it('defers expiry while a form, modal, or explicit save is active', () => {
    const deadlineAt = 10_000

    expect(getPersonalManualExpiryPhase({ isManualMode: true, deadlineAt, now: deadlineAt })).toBe('expired')
    expect(getPersonalManualExpiryPhase({
      isManualMode: true,
      deadlineAt,
      now: deadlineAt,
      isBlocked: true
    })).toBe('deferred')
  })

  it('does not schedule expiry for Auto mode or an unset deadline', () => {
    expect(getPersonalManualExpiryPhase({ isManualMode: false, deadlineAt: 10_000, now: 10_000 })).toBe('inactive')
    expect(getPersonalManualExpiryPhase({ isManualMode: true, deadlineAt: null, now: 10_000 })).toBe('inactive')
  })
})
