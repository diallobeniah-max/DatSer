import React, { useEffect, useMemo, useState } from 'react'
import { AlertCircle, CheckCircle2, CloudOff, Database, Download, RefreshCw, X } from 'lucide-react'
import { useApp } from '../context/AppContext'
import { useAuth } from '../context/AuthContext'
import { getDurableOfflineSetupMeta, isOfflineSetupDismissedSession, markOfflineSetupDismissedSession } from '../utils/offlineStore'

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
    hasAccess,
    monthlyTables,
    members,
    dataOwnerId
  } = useApp()
  let user = null
  try {
    const auth = useAuth()
    user = auth?.user || null
  } catch {
    // Rendered outside AuthProvider in isolated tests
  }
  const effectiveUserId = user?.id || null
  const effectiveOwnerId = dataOwnerId || effectiveUserId

  const isSessionDismissed = isOfflineSetupDismissedSession(effectiveUserId, effectiveOwnerId)
  const [isPrepDismissed, setIsPrepDismissed] = useState(isSessionDismissed)
  const [dismissedStatusKey, setDismissedStatusKey] = useState(null)
  const [isSetupComplete, setIsSetupComplete] = useState(false)

  const dismissPrep = (event) => {
    event?.stopPropagation?.()
    markOfflineSetupDismissedSession(effectiveUserId, effectiveOwnerId)
    setIsPrepDismissed(true)
  }

  const durableMeta = getDurableOfflineSetupMeta(effectiveUserId, effectiveOwnerId)
  const hasCache = Boolean(
    (offlineCacheMeta?.completeness === 'complete' &&
      (!effectiveUserId || !offlineCacheMeta?.authenticated_user_id || offlineCacheMeta?.authenticated_user_id === effectiveUserId) &&
      (!effectiveOwnerId || !offlineCacheMeta?.data_owner_id || offlineCacheMeta?.data_owner_id === effectiveOwnerId)) ||
    (durableMeta?.snapshotComplete &&
      (!effectiveUserId || durableMeta?.userId === effectiveUserId) &&
      (!effectiveOwnerId || durableMeta?.ownerId === effectiveOwnerId))
  )
  const isActuallyOffline = !isOnline || offlineModeStatus === 'offline' || offlineModeStatus === 'forced-offline' || offlineModeStatus === 'online-unavailable'
  const canShowSaveNotice = isActuallyOffline && pendingSyncCount >= (offlineSaveNoticeThreshold || 10)
  const isError = offlineStatusMessage?.toLowerCase().includes('failed') || offlineModeStatus === 'online-unavailable'
  const showSetupCard = hasAccess && !isPrepDismissed && (!hasCache || isPreparingOffline || isSetupComplete)

  useEffect(() => {
    if (offlinePreparationProgress?.phase === 'complete') {
      setIsSetupComplete(true)
    }
  }, [offlinePreparationProgress?.phase])

  useEffect(() => {
    setIsSetupComplete(false)
  }, [effectiveUserId, effectiveOwnerId])

  useEffect(() => {
    if (!showSetupCard || typeof window === 'undefined') return undefined
    const handleKeyDown = (event) => {
      if (event.key !== 'Escape') return
      event.preventDefault()
      event.stopPropagation()
      setIsPrepDismissed(true)
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [showSetupCard])

  const statusKey = useMemo(() => {
    if (!hasAccess) return null
    if (isPreparingOffline && isPrepDismissed) return `preparing:${offlinePreparationProgress?.completed || 0}:${offlinePreparationProgress?.total || 0}`
    if (isError && canShowSaveNotice) return `error:${offlineStatusMessage || offlineModeStatus}`
    if (isSyncingOffline && canShowSaveNotice) return 'syncing'
    if (canShowSaveNotice && offlineStatusMessage && /synced|ready|saved offline|saved locally/i.test(offlineStatusMessage)) {
      return `saved:${offlineStatusMessage}`
    }
    if (isActuallyOffline) return `offline:${offlineModeStatus}`
    return null
  }, [canShowSaveNotice, hasAccess, isActuallyOffline, isError, isPrepDismissed, isPreparingOffline, isSyncingOffline, offlineModeStatus, offlinePreparationProgress?.completed, offlinePreparationProgress?.total, offlineStatusMessage])
  const showStatus = Boolean(statusKey) && dismissedStatusKey !== statusKey && !showSetupCard

  useEffect(() => {
    if (!statusKey) return undefined
    setDismissedStatusKey((current) => (current === statusKey ? null : current))
    const timeoutId = setTimeout(() => {
      setDismissedStatusKey(statusKey)
    }, isActuallyOffline ? 3600 : 1800)
    return () => clearTimeout(timeoutId)
  }, [isActuallyOffline, statusKey])

  if (!showSetupCard && !showStatus) return null

  if (showSetupCard) {
    const totalMonths = monthlyTables?.length || offlinePreparationProgress?.total || 0
    const totalMembers = members?.length || 0

    return (
      <div
        className="fixed inset-0 z-[65] flex items-center justify-center p-4 sm:p-6"
        role="dialog"
        aria-modal="true"
        aria-labelledby="offline-setup-title"
        data-testid="offline-setup-progress-card"
      >
        <div className="w-full max-w-[420px] rounded-2xl border border-orange-200 bg-white text-gray-900 shadow-2xl shadow-orange-900/10 dark:border-orange-900/60 dark:bg-gray-900 dark:text-white">
          <div className="h-1.5 rounded-t-2xl bg-gradient-to-r from-orange-500 via-amber-400 to-orange-600" />
          <div className="p-4 sm:p-5">
            <div className="flex items-start gap-3.5">
              <div className="rounded-2xl bg-orange-100 p-3 text-orange-700 dark:bg-orange-900/35 dark:text-orange-300">
                <Database className="h-6 w-6" />
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p id="offline-setup-title" className="text-base font-bold">
                      {isSetupComplete ? 'Offline access ready' : (isPreparingOffline ? 'Preparing DatSer for offline use' : 'Set up offline access')}
                    </p>
                    <p className="mt-1 text-sm leading-relaxed text-gray-600 dark:text-gray-300">
                      {isSetupComplete
                        ? 'Your downloaded workspace is ready for search, attendance and supported edits without internet.'
                        : 'Download your workspace once so members, attendance and edits remain available without internet.'}
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

                {!isPreparingOffline && (totalMonths > 0 || totalMembers > 0) && (
                  <div className="mt-3 flex items-center gap-3 rounded-xl bg-orange-50/70 px-3 py-2 text-xs font-medium text-orange-900 dark:bg-orange-950/30 dark:text-orange-200">
                    {totalMonths > 0 && <span><strong>{totalMonths}</strong> month{totalMonths === 1 ? '' : 's'}</span>}
                    {totalMonths > 0 && totalMembers > 0 && <span>•</span>}
                    {totalMembers > 0 && <span>~<strong>{totalMembers}</strong> members</span>}
                  </div>
                )}

                {isPreparingOffline && (
                  <div className="mt-3 rounded-xl bg-orange-50/80 p-3 dark:bg-orange-950/30">
                    <p className="text-xs font-semibold text-orange-900 dark:text-orange-200">
                      {offlinePreparationProgress?.stage || 'Downloading workspace…'}
                    </p>
                    {offlinePreparationProgress?.detail && (
                      <p className="mt-1 text-[11px] text-orange-700 dark:text-orange-300">
                        {offlinePreparationProgress.detail}
                      </p>
                    )}
                    <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-orange-200/80 dark:bg-orange-900/60" aria-label="Offline download progress">
                      <div
                        className="h-full rounded-full bg-orange-600 transition-[width] duration-200"
                        style={{ width: `${Math.min(100, Math.max(0, offlinePreparationProgress?.percent || 0))}%` }}
                      />
                    </div>
                    {offlinePreparationProgress?.total > 0 && (
                      <p className="mt-1 text-[11px] text-orange-700 dark:text-orange-300">
                        {offlinePreparationProgress?.percent || 0}% · {offlinePreparationProgress?.completed || 0} of {offlinePreparationProgress?.total} steps complete
                      </p>
                    )}
                  </div>
                )}

                <div className="mt-4 flex flex-col gap-2 sm:flex-row">
                  {isSetupComplete ? (
                    <button
                      type="button"
                      onClick={dismissPrep}
                      className="inline-flex min-h-[44px] flex-1 items-center justify-center gap-2 rounded-xl bg-emerald-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-emerald-700"
                    >
                      <CheckCircle2 className="h-4 w-4" />
                      Done
                    </button>
                  ) : (
                  <button
                    type="button"
                    onClick={async () => {
                      const result = await prepareOfflineData()
                      if (result?.success) setIsSetupComplete(true)
                    }}
                    disabled={isPreparingOffline || !isOnline}
                    className="inline-flex min-h-[44px] flex-1 items-center justify-center gap-2 rounded-xl bg-orange-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-orange-700 disabled:cursor-not-allowed disabled:bg-orange-300"
                  >
                    {isPreparingOffline ? <RefreshCw className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
                    {isPreparingOffline ? (offlinePreparationProgress?.stage || 'Preparing…') : 'Download for offline use'}
                  </button>
                  )}
                  <button
                    type="button"
                    onClick={dismissPrep}
                    className="inline-flex min-h-[44px] items-center justify-center rounded-xl border border-gray-200 bg-white px-4 py-2.5 text-sm font-semibold text-gray-700 transition-colors hover:bg-gray-50 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-200 dark:hover:bg-gray-700"
                  >
                    {isPreparingOffline ? 'Continue in background' : 'Not now'}
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    )
  }

  const title = isPreparingOffline
    ? 'Preparing offline access'
    : isError
    ? 'Sync failed'
    : isSyncingOffline
      ? 'Syncing...'
      : isActuallyOffline
        ? "You're offline"
        : 'All changes saved locally'
  const message = isPreparingOffline
    ? `${offlinePreparationProgress?.stage || 'Downloading data'}${offlinePreparationProgress?.total ? ` · ${offlinePreparationProgress?.completed || 0}/${offlinePreparationProgress.total}` : ''}`
    : isError
    ? 'Changes are still saved locally.'
    : isSyncingOffline
      ? 'Your changes are being saved.'
      : isActuallyOffline
        ? 'You are working in offline mode. Data is safe on this device.'
        : (offlineStatusMessage || 'We will sync automatically when needed.')
  const tone = isPreparingOffline ? 'sync' : isError ? 'error' : isSyncingOffline ? 'sync' : isActuallyOffline ? 'offline' : 'saved'
  const StatusIcon = isPreparingOffline ? Download : isError ? AlertCircle : isSyncingOffline ? RefreshCw : isActuallyOffline ? CloudOff : CheckCircle2
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
