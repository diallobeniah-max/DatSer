import React, { useEffect, useState } from 'react'
import { AlertTriangle, Download, Info, X } from 'lucide-react'
import {
  fetchLatestAppRelease,
  getInstalledAppInfo,
  isAndroidNative,
  isReleaseNewer,
  openApkDownload
} from '../utils/appUpdates'
import { notify } from '../utils/notify'

const SKIP_KEY_PREFIX = 'datser_apk_update_skip_'
const NOTICE_KEY_PREFIX = 'datser_apk_update_notice_seen_'
const BADGE_KEY = 'datser_apk_update_badge'

const updateApkBadge = (value) => {
  if (typeof window === 'undefined') return
  window.localStorage.setItem(BADGE_KEY, value ? 'true' : 'false')
  window.dispatchEvent(new Event('datser-apk-update-badge'))
}

const openUpdateSettings = () => {
  if (typeof window === 'undefined') return
  window.dispatchEvent(new Event('datser-open-apk-update-settings'))
}

function AppUpdatePrompt() {
  const [updateInfo, setUpdateInfo] = useState(null)
  const [showDetails, setShowDetails] = useState(false)

  useEffect(() => {
    let cancelled = false

    const checkForUpdate = async () => {
      if (!isAndroidNative()) return

      try {
        const appInfo = await getInstalledAppInfo()
        const release = await fetchLatestAppRelease()
        if (!release?.apkUrl || !isReleaseNewer(release, appInfo)) return

        const skipKey = `${SKIP_KEY_PREFIX}${release.versionName}_${release.versionCode}`
        if (!release.forceUpdate && localStorage.getItem(skipKey) === 'true') return

        const nextUpdate = { ...release, appInfo, skipKey }
        if (cancelled) return

        setUpdateInfo(nextUpdate)
        updateApkBadge(true)

        const noticeKey = `${NOTICE_KEY_PREFIX}${release.versionName}_${release.versionCode}`
        const hasSeenNotice = localStorage.getItem(noticeKey) === 'true'
        if (hasSeenNotice && !release.forceUpdate) return

        localStorage.setItem(noticeKey, 'true')
        notify.update('Tap to open the update page and download the APK.', {
          title: release.forceUpdate ? 'Update required before continuing.' : 'New DatSer APK available.',
          details: release.description,
          persistent: release.forceUpdate,
          autoClose: release.forceUpdate ? false : 12000,
          defaultExpanded: release.forceUpdate,
          toastId: `apk-update-${release.versionName}-${release.versionCode}`,
          actions: [
            {
              label: 'Open Update Page',
              variant: 'primary',
              dismiss: false,
              onClick: () => {
                setShowDetails(false)
                openUpdateSettings()
              }
            },
            {
              label: 'View Details',
              dismiss: false,
              onClick: () => setShowDetails(true)
            },
            ...(!release.forceUpdate
              ? [{
                  label: 'Later',
                  onClick: () => {
                    localStorage.setItem(skipKey, 'true')
                    updateApkBadge(true)
                    setUpdateInfo(null)
                    setShowDetails(false)
                  }
                }]
              : [])
          ]
        })
      } catch (error) {
        console.warn('APK update check failed:', error)
      }
    }

    checkForUpdate()

    return () => {
      cancelled = true
    }
  }, [])

  if (!updateInfo || (!updateInfo.forceUpdate && !showDetails)) return null

  const openUpdate = () => openApkDownload(updateInfo.apkUrl)
  const downloadUpdate = () => {
    updateApkBadge(false)
    openUpdate()
  }

  const skipUpdate = () => {
    if (updateInfo.forceUpdate) return
    localStorage.setItem(updateInfo.skipKey, 'true')
    setUpdateInfo(null)
    setShowDetails(false)
  }

  return (
    <div className="fixed inset-0 z-[100] flex justify-end bg-black/45 backdrop-blur-sm">
      <div
        className="flex h-full w-full max-w-md flex-col border-l border-gray-200 bg-white p-5 shadow-2xl animate-slide-in-right dark:border-gray-700 dark:bg-[#2F3030]"
        role="dialog"
        aria-modal={updateInfo.forceUpdate}
        aria-labelledby="datser-apk-update-title"
      >
        <div className="mb-4 flex items-start gap-3">
          <div className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl ${
            updateInfo.forceUpdate
              ? 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-200'
              : 'bg-orange-100 text-orange-700 dark:bg-orange-900/50 dark:text-orange-200'
          }`}>
            {updateInfo.forceUpdate ? <AlertTriangle className="h-5 w-5" /> : <Download className="h-5 w-5" />}
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex items-start justify-between gap-2">
              <h2 id="datser-apk-update-title" className="text-lg font-bold text-gray-950 dark:text-white">
                {updateInfo.forceUpdate ? 'Update required before continuing.' : 'New DatSer update available.'}
              </h2>
              {!updateInfo.forceUpdate && (
                <button
                  type="button"
                  onClick={() => setShowDetails(false)}
                  className="grid h-8 w-8 place-items-center rounded-full text-gray-400 hover:bg-gray-100 hover:text-gray-700 dark:hover:bg-gray-800 dark:hover:text-gray-200"
                  aria-label="Close update details"
                >
                  <X className="h-4 w-4" />
                </button>
              )}
            </div>
            <p className="mt-1 text-sm leading-6 text-gray-600 dark:text-gray-300">
              Version {updateInfo.versionName} is ready to download.
            </p>
          </div>
        </div>

        <div className="mb-4 rounded-2xl bg-gray-50 px-4 py-3 text-sm text-gray-700 dark:bg-gray-900/40 dark:text-gray-200">
          <p className="font-semibold">{updateInfo.title}</p>
          <p className="mt-1 text-gray-600 dark:text-gray-300">{updateInfo.description}</p>
          <p className="mt-3 flex items-start gap-2 text-xs text-gray-500 dark:text-gray-400">
            <Info className="mt-0.5 h-3.5 w-3.5 flex-shrink-0" />
            Android will open the APK download or installer flow. You will still confirm Install or Update manually.
          </p>
        </div>

        <div className="mb-5 grid grid-cols-2 gap-2 rounded-2xl border border-gray-200 bg-white p-3 text-xs dark:border-gray-700 dark:bg-gray-900/40">
          <div>
            <p className="text-gray-400">Current</p>
            <p className="font-semibold text-gray-900 dark:text-white">
              {updateInfo.appInfo.versionName} ({updateInfo.appInfo.versionCode || 'web'})
            </p>
          </div>
          <div>
            <p className="text-gray-400">Latest</p>
            <p className="font-semibold text-gray-900 dark:text-white">
              {updateInfo.versionName} ({updateInfo.versionCode})
            </p>
          </div>
        </div>

        <div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
          {!updateInfo.forceUpdate && (
            <button
              type="button"
              onClick={skipUpdate}
              className="rounded-2xl border border-gray-200 px-4 py-3 text-sm font-semibold text-gray-700 transition hover:bg-gray-50 dark:border-gray-700 dark:text-gray-200 dark:hover:bg-gray-800"
            >
              Later
            </button>
          )}
          <button
            type="button"
            onClick={downloadUpdate}
            className="rounded-2xl bg-orange-600 px-4 py-3 text-sm font-semibold text-white shadow-lg shadow-orange-600/20 transition hover:bg-orange-700"
          >
            Download Update
          </button>
        </div>
      </div>
    </div>
  )
}

export default AppUpdatePrompt
