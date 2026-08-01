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
    aspectRatio: { ideal: 16 / 9 },
    resizeMode: 'crop-and-scale'
  }
})

const BACK_CAMERA_WORDS = ['back', 'rear', 'environment', 'world', 'facing back']
const PROBLEM_LENS_WORDS = ['ultra', 'wide', 'macro', 'depth', 'telephoto', 'tele', 'front', 'selfie']

const normalizeDeviceLabel = (label = '') => String(label).toLowerCase()

export const rankQrCameraDevices = (devices = []) => (
  devices
    .filter(device => device?.kind === 'videoinput' && device.deviceId)
    .map((device, index) => {
      const label = normalizeDeviceLabel(device.label)
      const isBack = BACK_CAMERA_WORDS.some(word => label.includes(word))
      const isProblemLens = PROBLEM_LENS_WORDS.some(word => label.includes(word))
      return {
        device,
        score: (isBack ? 100 : 0) - (isProblemLens ? 55 : 0) - index,
        index
      }
    })
    .sort((a, b) => b.score - a.score)
    .map(item => item.device)
)

export const getQrCameraConstraintCandidates = (devices = []) => {
  const preferred = getPreferredQrCameraConstraints()
  const deviceCandidates = rankQrCameraDevices(devices).map(device => ({
    audio: false,
    video: {
      deviceId: { exact: device.deviceId },
      width: { ideal: 1920 },
      height: { ideal: 1080 },
      aspectRatio: { ideal: 16 / 9 },
      resizeMode: 'crop-and-scale'
    }
  }))

  return [
    ...deviceCandidates,
    preferred,
    {
      audio: false,
      video: {
        facingMode: { exact: 'environment' },
        width: { ideal: 1280 },
        height: { ideal: 720 }
      }
    },
    {
      audio: false,
      video: true
    }
  ].filter((candidate, index, list) => (
    list.findIndex(other => JSON.stringify(other) === JSON.stringify(candidate)) === index
  ))
}
