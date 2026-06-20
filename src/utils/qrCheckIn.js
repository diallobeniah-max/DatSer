const CHECK_IN_PARAM_NAMES = ['member_checkin', 'qr_mark', 'code', 'date', 'table']

export const buildMemberCheckInUrl = ({ href, memberId, code }) => {
  if (!memberId) return ''
  try {
    const baseHref = href || (typeof window !== 'undefined' ? window.location.href : '')
    if (!baseHref) return ''
    const url = new URL(baseHref)
    url.search = ''
    url.hash = ''
    url.searchParams.set('member_checkin', '1')
    url.searchParams.set('qr_mark', memberId)
    if (code) url.searchParams.set('code', code)
    return url.toString()
  } catch {
    return ''
  }
}

export const consumeMemberCheckInUrl = (href) => {
  try {
    const url = new URL(href)
    const memberId = url.searchParams.get('qr_mark')?.trim()
    if (url.searchParams.get('member_checkin') !== '1' || !memberId) return null

    const request = {
      memberId,
      code: url.searchParams.get('code')?.trim() || ''
    }
    CHECK_IN_PARAM_NAMES.forEach((name) => url.searchParams.delete(name))
    return { request, cleanUrl: url.toString() }
  } catch {
    return null
  }
}

export const getLocalQrCheckInTarget = (value, currentHref) => {
  try {
    const appHref = currentHref || (typeof window !== 'undefined' ? window.location.href : '')
    if (!appHref) return null

    const scannedUrl = new URL(value, appHref)
    if (scannedUrl.searchParams.get('member_checkin') !== '1') return null
    if (!scannedUrl.searchParams.get('qr_mark')?.trim()) return null

    const targetUrl = new URL(appHref)
    targetUrl.search = ''
    targetUrl.hash = ''
    CHECK_IN_PARAM_NAMES.forEach((name) => {
      const paramValue = scannedUrl.searchParams.get(name)
      if (paramValue) targetUrl.searchParams.set(name, paramValue)
    })
    return targetUrl.toString()
  } catch {
    return null
  }
}

export const getPreferredQrCameraConstraints = () => ({
  audio: false,
  video: {
    facingMode: { ideal: 'environment' },
    width: { ideal: 1920 },
    height: { ideal: 1080 },
    aspectRatio: { ideal: 16 / 9 }
  }
})
