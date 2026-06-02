import React, { useCallback, useEffect, useState } from 'react'
import { Download, RefreshCw, Smartphone, Info } from 'lucide-react'
import { fetchLatestAppRelease, getInstalledAppInfo, isReleaseNewer, openApkDownload } from '../utils/appUpdates'

const UpdatesSettingsSection = ({ getSettingTargetClass }) => {
  const [latestApkRelease, setLatestApkRelease] = useState(null)
  const [installedAppInfo, setInstalledAppInfo] = useState(null)
  const [isLoadingApkRelease, setIsLoadingApkRelease] = useState(false)

  const loadApkRelease = useCallback(async () => {
    setIsLoadingApkRelease(true)
    try {
      const [release, appInfo] = await Promise.all([
        fetchLatestAppRelease().catch(() => null),
        getInstalledAppInfo().catch(() => null)
      ])
      setLatestApkRelease(release)
      setInstalledAppInfo(appInfo)
    } finally {
      setIsLoadingApkRelease(false)
    }
  }, [])

  useEffect(() => {
    loadApkRelease()
  }, [loadApkRelease])

  const handleApkDownload = () => {
    if (!latestApkRelease?.apkUrl) return
    if (typeof window !== 'undefined') {
      window.localStorage.setItem('datser_apk_update_badge', 'false')
      window.dispatchEvent(new Event('datser-apk-update-badge'))
    }
    openApkDownload(latestApkRelease.apkUrl)
  }

  const updateReady = installedAppInfo && latestApkRelease && isReleaseNewer(latestApkRelease, installedAppInfo)

  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-1">Updates</h3>
        <p className="text-sm text-gray-500 dark:text-gray-400">Android downloads, version history, and install notices.</p>
      </div>

      <div
        data-setting-id="android_apk"
        tabIndex={-1}
        className={`rounded-2xl border border-gray-200 bg-white p-4 dark:border-gray-700 dark:bg-gray-800 ${getSettingTargetClass?.('android_apk') || ''}`}
      >
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-start gap-3">
            <div className="grid h-11 w-11 place-items-center rounded-2xl bg-orange-100 text-orange-700 dark:bg-orange-900/40 dark:text-orange-200">
              <Smartphone className="h-5 w-5" />
            </div>
            <div>
              <p className="font-semibold text-gray-900 dark:text-white">Android APK</p>
              <p className="text-sm text-gray-500 dark:text-gray-400">Download the latest install file for Android devices.</p>
            </div>
          </div>
          <button
            type="button"
            onClick={loadApkRelease}
            className="grid h-9 w-9 place-items-center rounded-xl border border-gray-200 bg-white text-gray-500 hover:border-orange-300 hover:text-orange-600 dark:border-gray-700 dark:bg-gray-900/40 dark:text-gray-300"
            aria-label="Refresh APK release"
          >
            <RefreshCw className={`h-4 w-4 ${isLoadingApkRelease ? 'animate-spin' : ''}`} />
          </button>
        </div>

        <div className="mt-4 rounded-2xl border border-gray-200 bg-gray-50 p-3 dark:border-gray-700 dark:bg-gray-900/40">
          {latestApkRelease?.apkUrl ? (
            <>
              <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <p className="text-sm font-bold text-gray-900 dark:text-white">{latestApkRelease.title || 'DatSer Android update'}</p>
                  <p className="text-xs text-gray-500 dark:text-gray-400">
                    Latest: {latestApkRelease.versionName} ({latestApkRelease.versionCode})
                    {installedAppInfo?.versionName ? ` · Current: ${installedAppInfo.versionName} (${installedAppInfo.versionCode || 'web'})` : ''}
                  </p>
                  <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                    Published: {latestApkRelease.publishedAt ? new Date(latestApkRelease.publishedAt).toLocaleString() : 'Recent update'}
                  </p>
                </div>
                <span className={`w-fit rounded-full px-2.5 py-1 text-xs font-bold ${
                  updateReady
                    ? 'bg-orange-100 text-orange-700 dark:bg-orange-500/15 dark:text-orange-200'
                    : 'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-200'
                }`}>
                  {updateReady ? 'Update ready' : 'Latest available'}
                </span>
              </div>
              {latestApkRelease.description && (
                <p className="mt-2 text-xs leading-5 text-gray-600 dark:text-gray-300">{latestApkRelease.description}</p>
              )}
              <button
                type="button"
                onClick={handleApkDownload}
                className="mt-3 flex min-h-[44px] w-full items-center justify-center gap-2 rounded-xl bg-orange-600 px-4 text-sm font-bold text-white shadow-sm transition-colors hover:bg-orange-700"
              >
                <Download className="h-4 w-4" />
                Download Android APK
              </button>
              <p className="mt-2 flex items-start gap-2 text-xs leading-5 text-gray-500 dark:text-gray-400">
                <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                After installing, you can delete the APK from Android Downloads to free storage.
              </p>
            </>
          ) : (
            <p className="text-sm text-gray-500 dark:text-gray-400">
              {isLoadingApkRelease ? 'Checking for the latest APK...' : 'No Android APK release is available yet.'}
            </p>
          )}
        </div>
      </div>
    </div>
  )
}

export default React.memo(UpdatesSettingsSection)
