import { App as CapacitorApp } from '@capacitor/app'
import { Browser } from '@capacitor/browser'
import { Capacitor } from '@capacitor/core'
import { supabase } from '../lib/supabase'
import { compareVersions } from './versionCompare'

export const APP_UPDATES_BUCKET = 'app-updates'
export const APK_FILE_LIMIT_BYTES = 150 * 1024 * 1024
const APP_RELEASE_SELECT = 'id,version_name,version_code,title,description,apk_url,force_update,is_active,published_at,created_at,created_by'

const buildApkUploadError = (step, error) => {
  const rawMessage = String(error?.message || error || 'APK upload failed.')
  const rlsBlocked = /row-level security|rls|policy/i.test(rawMessage)
  const readableStep = {
    'uploading-apk-file': 'uploading APK file',
    'creating-update-record': 'creating update record',
    'generating-download-link': 'generating download link'
  }[step] || step
  const nextStep = rlsBlocked
    ? 'Supabase blocked the APK upload because the upload endpoint is not authorized. Check admin upload policy or service role configuration.'
    : 'Check Supabase app update migration/storage setup, then retry.'
  const wrapped = new Error(`${readableStep}: ${rawMessage}`)
  wrapped.step = step
  wrapped.nextStep = nextStep
  wrapped.original = error
  return wrapped
}

export const isAndroidNative = () => Capacitor.isNativePlatform() && Capacitor.getPlatform() === 'android'

export const getRuntimeModeLabel = () => {
  if (!Capacitor.isNativePlatform()) return 'Website'
  const protocol = typeof window !== 'undefined' ? window.location.protocol : ''
  return protocol === 'http:' || protocol === 'https:' ? 'Live Website Wrapper' : 'Local Bundled'
}

export const getInstalledAppInfo = async () => {
  if (!Capacitor.isNativePlatform()) {
    return {
      versionName: import.meta.env.VITE_APP_VERSION || 'web',
      versionCode: 0,
      runtimeMode: 'Website',
      platform: 'web'
    }
  }

  try {
    const info = await CapacitorApp.getInfo()
    return {
      versionName: info.version || '0.0.0',
      versionCode: Number(info.build || 0),
      runtimeMode: getRuntimeModeLabel(),
      platform: Capacitor.getPlatform()
    }
  } catch {
    return {
      versionName: '0.0.0',
      versionCode: 0,
      runtimeMode: getRuntimeModeLabel(),
      platform: Capacitor.getPlatform()
    }
  }
}

export const normalizeRelease = (release) => {
  if (!release) return null
  const rawApkUrl = release.apk_url || release.apkUrl || ''
  const apkUrl =
    rawApkUrl && rawApkUrl.startsWith('/') && typeof window !== 'undefined'
      ? `${window.location.origin}${rawApkUrl}`
      : rawApkUrl

  return {
    id: release.id || null,
    versionName: String(release.version_name || release.latestVersion || ''),
    versionCode: Number(release.version_code || release.versionCode || 0),
    title: release.title || 'DatSer update',
    description: release.description || release.message || 'A new DatSer app update is available.',
    apkUrl,
    forceUpdate: Boolean(release.force_update ?? release.forceUpdate),
    isActive: Boolean(release.is_active ?? true),
    publishedAt: release.published_at || release.publishedAt || null,
    createdAt: release.created_at || release.createdAt || null,
    createdBy: release.created_by || release.createdBy || null
  }
}

export const isReleaseNewer = (release, appInfo) => {
  if (!release || !appInfo) return false
  if (release.versionCode && appInfo.versionCode) {
    return release.versionCode > appInfo.versionCode
  }
  return compareVersions(release.versionName, appInfo.versionName) > 0
}

const getHigherRelease = (primary, fallback) => {
  if (!primary) return fallback
  if (!fallback) return primary

  if (fallback.versionCode && primary.versionCode && fallback.versionCode !== primary.versionCode) {
    return fallback.versionCode > primary.versionCode ? fallback : primary
  }

  return compareVersions(fallback.versionName, primary.versionName) > 0 ? fallback : primary
}

const fetchStaticAppRelease = async () => {
  const response = await fetch(`/app-version.json?t=${Date.now()}`, { cache: 'no-store' })
  if (!response.ok) return null
  return normalizeRelease(await response.json())
}

export const fetchLatestAppRelease = async () => {
  let backendRelease = null

  if (supabase) {
    const { data, error } = await supabase
      .from('app_releases')
      .select(APP_RELEASE_SELECT)
      .eq('is_active', true)
      .order('version_code', { ascending: false })
      .order('published_at', { ascending: false })
      .limit(1)
      .maybeSingle()

    if (!error && data) {
      backendRelease = normalizeRelease(data)
    }

    const missingBackend =
      error?.code === '42P01' ||
      error?.code === 'PGRST205' ||
      String(error?.message || '').includes('app_releases')
    if (error && !missingBackend) {
      throw error
    }
  }

  const staticRelease = await fetchStaticAppRelease()
  return getHigherRelease(backendRelease, staticRelease)
}

export const fetchReleaseHistory = async () => {
  if (!supabase) return []
  const { data, error } = await supabase
    .from('app_releases')
    .select(APP_RELEASE_SELECT)
    .order('version_code', { ascending: false })
    .order('created_at', { ascending: false })

  if (error) {
    const missingBackend =
      error?.code === '42P01' ||
      error?.code === 'PGRST205' ||
      String(error?.message || '').includes('app_releases')
    if (missingBackend) return []
    throw error
  }

  return (data || []).map(normalizeRelease)
}

export const validateApkFile = (file) => {
  if (!file) return 'Choose an APK file first.'
  if (!file.name?.toLowerCase().endsWith('.apk')) return 'Only .apk files are allowed.'
  if (file.size > APK_FILE_LIMIT_BYTES) return 'APK is too large. Keep updates under 150 MB.'
  return null
}

export const uploadApkRelease = async ({ file, versionName, versionCode, title, description, forceUpdate, isActive, userId }) => {
  if (!supabase) throw new Error('Supabase is not configured.')
  const validationError = validateApkFile(file)
  if (validationError) throw new Error(validationError)

  const cleanVersion = String(versionName || '').trim()
  const numericCode = Number(versionCode)
  if (!cleanVersion) throw new Error('Version name is required.')
  if (!Number.isFinite(numericCode) || numericCode < 1) throw new Error('Version code must be a positive number.')

  const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, '-')
  const storagePath = `${cleanVersion}-${numericCode}/${Date.now()}-${safeName}`
  const { error: uploadError } = await supabase.storage
    .from(APP_UPDATES_BUCKET)
    .upload(storagePath, file, {
      contentType: 'application/vnd.android.package-archive',
      upsert: false
    })

  if (uploadError) throw buildApkUploadError('uploading-apk-file', uploadError)

  const { data: publicData } = supabase.storage.from(APP_UPDATES_BUCKET).getPublicUrl(storagePath)
  const apkUrl = publicData?.publicUrl
  if (!apkUrl) throw buildApkUploadError('generating-download-link', 'Could not create an APK download URL.')

  const { data, error } = await supabase
    .from('app_releases')
    .insert({
      version_name: cleanVersion,
      version_code: numericCode,
      title: title || `DatSer ${cleanVersion}`,
      description: description || '',
      apk_url: apkUrl,
      force_update: Boolean(forceUpdate),
      is_active: Boolean(isActive),
      published_at: isActive ? new Date().toISOString() : null,
      created_by: userId || null
    })
    .select(APP_RELEASE_SELECT)
    .single()

  if (error) throw buildApkUploadError('creating-update-record', error)
  return normalizeRelease(data)
}

export const setReleasePublished = async (releaseId, isActive) => {
  if (!supabase) throw new Error('Supabase is not configured.')
  const { data, error } = await supabase
    .from('app_releases')
    .update({
      is_active: Boolean(isActive),
      published_at: isActive ? new Date().toISOString() : null
    })
    .eq('id', releaseId)
    .select(APP_RELEASE_SELECT)
    .single()

  if (error) throw error
  return normalizeRelease(data)
}

export const openApkDownload = async (apkUrl) => {
  if (!apkUrl) return
  try {
    if (Capacitor.isNativePlatform()) {
      await Browser.open({ url: apkUrl })
      return
    }
  } catch {
    // Fall through to a normal browser window.
  }
  window.open(apkUrl, '_blank', 'noopener,noreferrer')
}
