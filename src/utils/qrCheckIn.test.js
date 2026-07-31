import { describe, expect, it } from 'vitest'
import {
  buildMemberCheckInUrl,
  consumeMemberCheckInUrl,
  getLocalQrCheckInTarget,
  getQrCameraConstraintCandidates,
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
      code: 'J02',
      workspaceId: 'workspace-1'
    })).toBe('https://datser.example/?member_checkin=1&qr_mark=42&qr_v=2&code=J02&workspace=workspace-1')
  })

  it('consumes a legacy dated pass once without carrying its stale date or table forward', () => {
    expect(consumeMemberCheckInUrl('https://datser.example/?member_checkin=1&qr_mark=42&code=J02&date=2026-01-04&table=January_2026')).toEqual({
      request: { memberId: '42', code: 'J02', workspaceId: '', version: '1' },
      cleanUrl: 'https://datser.example/'
    })
  })

  it('keeps a versioned workspace check-in payload stable without private member data', () => {
    const payload = consumeMemberCheckInUrl('https://datser.example/?member_checkin=1&qr_mark=42&qr_v=2&code=A&workspace=workspace-1')
    expect(payload?.request).toEqual({ memberId: '42', code: 'A', workspaceId: 'workspace-1', version: '2' })
    expect(payload?.cleanUrl).toBe('https://datser.example/')
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

  it('prefers normal rear cameras before ultra-wide or front cameras when available', () => {
    const candidates = getQrCameraConstraintCandidates([
      { kind: 'videoinput', deviceId: 'front-1', label: 'Front camera' },
      { kind: 'videoinput', deviceId: 'ultra-1', label: 'Back ultra wide camera' },
      { kind: 'videoinput', deviceId: 'back-1', label: 'Back camera' }
    ])

    expect(candidates[0].video.deviceId.exact).toBe('back-1')
    expect(candidates.some(candidate => candidate.video === true)).toBe(true)
  })
})
