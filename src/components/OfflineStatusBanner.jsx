import React, { useEffect, useMemo, useState } from 'react'
import { AlertCircle, CheckCircle2, CloudOff, Database, Download, RefreshCw, X } from 'lucide-react'
import { useApp } from '../context/AppContext'

const PREP_DISMISSED_KEY = 'datser_offline_prepare_prompt_dismissed'

const getDismissed = () => {
  if (typeof window === 'undefined') return false
  return localStorage.getItem(PREP_DISMISSED_KEY) === 'true'
}

const OfflineStatusBanner = ({ onOpenOfflineSettings }) => {
  const {
    isOnline,
    offlineMode,
    offlineModeStatus,
    offlineCacheMeta,
    pendingSyncCount,
    offlineSaveNoticeThreshold,
    offlineStatusMessage,
    isPreparingOffline,
    offlinePreparationProgress,
    isSyncingOffline,
    prepareOfflineData,
    syncOfflineChanges,
    hasAccess
  } = useApp()
  const [isPrepDismissed, setIsPrepDismissed] = useState(getDismissed)
  const [dismissedStatusKey, setDismissedStatusKey] = useState(null)

  useEffect(() => {
    if (offlineCacheMeta && isPrepDismissed) {
      setIsPrepDismissed(false)
      if (typeof window !== 'undefined') {
        localStorage.removeItem(PREP_DISMISSED_KEY)
      }
    }
  }, [offlineCacheMeta, isPrepDismissed])

  const dismissPrep = () => {
    setIsPrepDismissed(true)
    if (typeof window !== 'undefined') {
      localStorage.setItem(PREP_DISMISSED_KEY, 'true')
    }
  }

  const hasCache = offlineCacheMeta?.completeness === 'complete'
  const isActuallyOffline = !isOnline || offlineModeStatus === 'offline' || offlineModeStatus === 'forced-offline' || offlineModeStatus === 'online-unavailable'
  const canShowSaveNotice = isActuallyOffline && pendingSyncCount >= (offlineSaveNoticeThreshold || 10)
  const showPrepPrompt = hasAccess && isOnline && !hasCache && !isPrepDismissed
  const isError = offlineStatusMessage?.toLowerCase().includes('failed') || offlineModeStatus === 'online-unavailable'
  const statusKey = useMemo(() => {
    if (!hasAccess) return null
    if (isError && canShowSaveNotice) return `error:${offlineStatusMessage || offlineModeStatus}`
    if (isSyncingOffline && canShowSaveNotice) return 'syncing'
    if (canShowSaveNotice && offlineStatusMessage && /synced|ready|saved offline|saved locally/i.test(offlineStatusMessage)) {
      return `saved:${offlineStatusMessage}`
    }
    if (isActuallyOffline) return `offline:${offlineModeStatus}`
    return null
  }, [canShowSaveNotice, hasAccess, isActuallyOffline, isError, isSyncingOffline, offlineModeStatus, offlineStatusMessage])
  const showStatus = Boolean(statusKey) && dismissedStatusKey !== statusKey && !showPrepPrompt

  useEffect(() => {
    if (!statusKey) return undefined
    setDismissedStatusKey((current) => (current === statusKey ? null : current))
    const timeoutId = setTimeout(() => {
      setDismissedStatusKey(statusKey)
    }, isActuallyOffline ? 3600 : 1800)
    return () => clearTimeout(timeoutId)
  }, [isActuallyOffline, statusKey])

  if (!showPrepPrompt && !showStatus) return null

  if (showPrepPrompt) {
    return (
      <div className="datser-offline-notice fixed z-[65] w-[min(420px,calc(100vw-24px))]">
        <div className="rounded-2xl border border-orange-200 bg-white text-gray-900 shadow-2xl shadow-orange-900/10 dark:border-orange-900/60 dark:bg-gray-900 dark:text-white">
          <div className="h-1 rounded-t-2xl bg-gradient-to-r from-orange-500 via-amber-400 to-orange-600" />
          <div className="p-4">
            <div className="flex items-start gap-3">
              <div className="rounded-xl bg-orange-100 p-2.5 text-orange-700 dark:bg-orange-900/35 dark:text-orange-300">
                <Database className="h-5 w-5" />
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-sm font-bold">Set up offline access</p>
                    <p className="mt-1 text-sm leading-relaxed text-gray-600 dark:text-gray-300">
                      Download your DatSer workspace so you can search members, mark attendance and make updates even when you are offline.
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={dismissPrep}
                    className="grid h-8 w-8 flex-shrink-0 place-items-center rounded-full text-gray-400 hover:bg-gray-100 hover:text-gray-700 dark:hover:bg-gray-800 dark:hover:text-gray-200"
                    aria-label="Dismiss offline preparation prompt"
                  >
                    <X className="h-4 w-4" />
                  </button>
                </div>
                <div className="mt-3 flex flex-col gap-2 sm:flex-row">
                  <button
                    type="button"
                    onClick={async () => {
                      const result = await prepareOfflineData()
                      if (result?.success) dismissPrep()
                    }}
                    disabled={isPreparingOffline || !isOnline}
                    className="inline-flex min-h-[42px] items-center justify-center gap-2 rounded-xl bg-orange-600 px-4 py-2 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-orange-700 disabled:cursor-not-allowed disabled:bg-orange-300"
                  >
                    {isPreparingOffline ? <RefreshCw className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
                    {isPreparingOffline ? (offlinePreparationProgress?.stage || 'Preparing…') : 'Download data'}
                  </button>
                  <button
                    type="button"
                    onClick={dismissPrep}
                    className="inline-flex min-h-[42px] items-center justify-center rounded-xl border border-orange-200 bg-orange-50 px-4 py-2 text-sm font-semibold text-orange-800 transition-colors hover:bg-orange-100 dark:border-orange-800 dark:bg-orange-950/30 dark:text-orange-200 dark:hover:bg-orange-900/40"
                  >
                    Not now
                  </button>
                </div>
                {isPreparingOffline && (
                  <p className="mt-2 text-xs font-medium text-orange-700 dark:text-orange-300">
                    {offlinePreparationProgress?.completed || 0} of {offlinePreparationProgress?.total || 0} months complete
                  </p>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
    )
  }

  const title = isError
    ? 'Sync failed'
    : isSyncingOffline
      ? 'Syncing...'
      : isActuallyOffline
        ? "You're offline"
        : 'All changes saved locally'
  const message = isError
    ? 'Changes are still saved locally.'
    : isSyncingOffline
      ? 'Your changes are being saved.'
      : isActuallyOffline
        ? 'You are working in offline mode. Data is safe on this device.'
        : (offlineStatusMessage || 'We will sync automatically when needed.')
  const tone = isError ? 'error' : isSyncingOffline ? 'sync' : isActuallyOffline ? 'offline' : 'saved'
  const StatusIcon = isError ? AlertCircle : isSyncingOffline ? RefreshCw : isActuallyOffline ? CloudOff : CheckCircle2
  const showSync = isOnline && offlineMode !== 'offline' && pendingSyncCount > 0 && !isSyncingOffline

  return (
    <div className="datser-offline-notice fixed z-[65] w-[min(520px,calc(100vw-28px))]">
      <div className={`datser-offline-card datser-offline-card-${tone}`}>
        <div className="flex items-center gap-3">
          <div className="datser-offline-card-icon">
            <StatusIcon className={isSyncingOffline ? 'animate-spin' : ''} />
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-extrabold leading-tight">{title}</p>
            <p className="mt-0.5 text-sm leading-snug opacity-85">{message}</p>
            {isSyncingOffline && (
              <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-white/15">
                <div className="h-full w-1/2 rounded-full bg-current opacity-80" />
              </div>
            )}
          </div>
          {showSync && (
            <button
              type="button"
              onClick={() => syncOfflineChanges({ manual: true })}
              disabled={isSyncingOffline}
              className="datser-offline-card-pill"
            >
              Sync
            </button>
          )}
          <button
            type="button"
            onClick={() => setDismissedStatusKey(statusKey)}
            className="datser-offline-card-close"
            aria-label="Dismiss status"
          >
            <X className="h-5 w-5" />
          </button>
        </div>
      </div>
    </div>
  )
}

export default OfflineStatusBanner
