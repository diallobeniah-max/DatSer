import { describe, expect, it } from 'vitest'
import {
  buildMemberCheckInUrl,
  consumeMemberCheckInUrl,
  getLocalQrCheckInTarget,
  getPreferredQrCameraConstraints
} from './qrCheckIn'

describe('QR check-in helpers', () => {
  it('moves a website-generated check-in onto the installed app origin', () => {
    const scanned = 'https://datser.example/?member_checkin=1&qr_mark=42&code=J02&date=2026-01-25&table=January_2026'

    expect(getLocalQrCheckInTarget(scanned, 'capacitor://localhost/dashboard')).toBe(
      'capacitor://localhost/dashboard?member_checkin=1&qr_mark=42&code=J02&date=2026-01-25&table=January_2026'
    )
  })

  it('keeps only supported check-in parameters on the local URL', () => {
    const scanned = 'https://datser.example/?member_checkin=1&qr_mark=7&unexpected=ignore-me#outside'

    expect(getLocalQrCheckInTarget(scanned, 'https://app.datser.example/')).toBe(
      'https://app.datser.example/?member_checkin=1&qr_mark=7'
    )
  })

  it('builds an evergreen member pass without a stale table or service date', () => {
    expect(buildMemberCheckInUrl({
      href: 'https://datser.example/?old=1',
      memberId: '42',
      code: 'J02'
    })).toBe('https://datser.example/?member_checkin=1&qr_mark=42&code=J02')
  })

  it('consumes a legacy dated pass once without carrying its stale date or table forward', () => {
    expect(consumeMemberCheckInUrl('https://datser.example/?member_checkin=1&qr_mark=42&code=J02&date=2026-01-04&table=January_2026')).toEqual({
      request: { memberId: '42', code: 'J02' },
      cleanUrl: 'https://datser.example/'
    })
  })

  it('rejects unrelated and incomplete QR values', () => {
    expect(getLocalQrCheckInTarget('https://example.com/', 'https://app.datser.example/')).toBeNull()
    expect(getLocalQrCheckInTarget('?member_checkin=1', 'https://app.datser.example/')).toBeNull()
    expect(getLocalQrCheckInTarget('not a URL', 'https://app.datser.example/')).toBeNull()
  })

  it('requests the rear camera at a focus-friendly resolution', () => {
    const constraints = getPreferredQrCameraConstraints()

    expect(constraints.video.facingMode).toEqual({ ideal: 'environment' })
    expect(constraints.video.width.ideal).toBe(1920)
    expect(constraints.video.height.ideal).toBe(1080)
  })
})
