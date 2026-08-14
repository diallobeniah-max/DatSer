import React, { useMemo } from 'react'
import { AlertCircle, CheckCircle2, RefreshCw } from 'lucide-react'
import { summarizeOfflineSyncHealth } from '../utils/paperScanUsageHealth'

const formatTime = (value) => {
  const time = Date.parse(value || '')
  return Number.isFinite(time) ? new Date(time).toLocaleString() : 'Not recorded'
}

const HealthBadge = ({ healthy, children }) => (
  <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-bold ${healthy ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300' : 'bg-amber-100 text-amber-800 dark:bg-amber-900/35 dark:text-amber-200'}`}>
    {healthy ? <CheckCircle2 className="h-3.5 w-3.5" /> : <AlertCircle className="h-3.5 w-3.5" />}
    {children}
  </span>
)

const Metric = ({ label, value }) => (
  <div className="rounded-xl border border-gray-200 bg-gray-50 p-3 dark:border-gray-700 dark:bg-gray-900/40">
    <p className="text-[11px] font-bold uppercase tracking-wide text-gray-500 dark:text-gray-400">{label}</p>
    <p className="mt-1 break-words text-sm font-semibold text-gray-900 dark:text-white">{value}</p>
  </div>
)

const OfflineSyncHealthSection = ({ isOnline, offlineModeStatus, offlineCacheMeta, offlinePendingChanges }) => {
  const offline = useMemo(() => summarizeOfflineSyncHealth({ isOnline, offlineModeStatus, offlineCacheMeta, offlinePendingChanges }), [isOnline, offlineModeStatus, offlineCacheMeta, offlinePendingChanges])
  return (
    <section className="overflow-hidden rounded-2xl border border-sky-200 bg-white shadow-sm dark:border-sky-900/60 dark:bg-gray-800" aria-labelledby="offline-sync-health-title">
      <div className="border-b border-sky-100 bg-sky-50/70 px-4 py-4 dark:border-sky-900/40 dark:bg-sky-950/20 sm:px-5">
        <div className="flex flex-wrap items-center gap-2">
          <div className="grid h-9 w-9 place-items-center rounded-xl bg-sky-600 text-white"><RefreshCw className="h-4 w-4" /></div>
          <div>
            <h4 id="offline-sync-health-title" className="font-semibold text-gray-900 dark:text-white">Offline sync health</h4>
            <p className="text-xs text-gray-600 dark:text-gray-300">Read-only facts about pending and failed offline changes.</p>
          </div>
        </div>
      </div>

      <div className="space-y-5 p-4 sm:p-5">
        <div>
          <div className="mb-2 flex items-center gap-2"><RefreshCw className="h-4 w-4 text-orange-600" /><p className="text-sm font-bold text-gray-900 dark:text-white">Offline sync</p><HealthBadge healthy={offline.healthy}>{offline.healthy ? 'Healthy' : 'Needs attention'}</HealthBadge></div>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
            <Metric label="Pending" value={String(offline.pending)} />
            <Metric label="Failed" value={String(offline.failed)} />
            <Metric label="Last sync" value={formatTime(offline.lastSync)} />
          </div>
          <p className="mt-2 text-xs text-gray-500 dark:text-gray-400">This panel reads existing sync state only; it does not retry, clear, or refactor the offline engine.</p>
        </div>
      </div>
    </section>
  )
}

export default OfflineSyncHealthSection