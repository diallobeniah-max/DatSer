import React, { useCallback, useEffect, useMemo, useState } from 'react'
import { AlertCircle, Archive, CheckCircle2, ChevronDown, Database, ExternalLink, FileBox, HardDrive, Loader2, Mail, RefreshCw, ScanLine, Wifi } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { getSavedScanStorageUsage, listSavedScans, probeReadableFileStorage } from '../services/paperScanSavedScans'
import { FILE_STORAGE_QUOTA_BYTES, formatBytes, PAPER_SCAN_GEMINI_MODEL, summarizeSavedScanUsage } from '../utils/paperScanUsageHealth'

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

const UsageBar = ({ used, total, tone }) => {
  const pct = total > 0 ? Math.max(1, Math.min(100, Math.round((used / total) * 100))) : 0
  const barTone = tone || (used > total * 0.8 ? 'from-orange-400 to-red-500' : 'from-emerald-400 to-emerald-500')
  return (
    <div className="h-4 rounded-full bg-gray-100 dark:bg-gray-700 overflow-hidden border border-gray-200 dark:border-gray-600">
      <div className={`h-full rounded-full transition-all bg-gradient-to-r ${barTone}`} style={{ width: `${pct}%` }} />
    </div>
  )
}

const PaperScanStorageLimitsSection = ({ ownerId, user, dbUsage, dbLoading, fetchDbUsage, dbLimitMb = 500, oldestMonthTable, setArchiveMonth, openSettingsSection, getSettingTargetClass }) => {
  const [scans, setScans] = useState([])
  const [scansStatus, setScansStatus] = useState('loading')
  const [savedScanStorage, setSavedScanStorage] = useState({ bytes: 0, objects: 0, buckets: [] })
  const [fileStorage, setFileStorage] = useState({ bytes: 0, objects: 0, buckets: [] })
  const [storageError, setStorageError] = useState('')
  const [refreshing, setRefreshing] = useState(false)

  // Email usage tracking for Supabase free-tier awareness.
  const EMAIL_RATE_LIMIT = 3
  const EMAIL_WINDOW_MS = 60 * 60 * 1000

  const getEmailSends = useCallback(() => {
    try {
      const raw = localStorage.getItem('email_send_timestamps')
      if (!raw) return []
      const timestamps = JSON.parse(raw)
      const cutoff = Date.now() - EMAIL_WINDOW_MS
      return timestamps.filter((ts) => Number(ts) > cutoff)
    } catch { return [] }
  }, [])

  const [emailSends, setEmailSends] = useState(getEmailSends)
  const [emailCountdown, setEmailCountdown] = useState('')

  useEffect(() => {
    const tick = () => {
      const current = getEmailSends()
      setEmailSends(current)
      if (current.length >= EMAIL_RATE_LIMIT && current.length > 0) {
        const resetAt = Math.min(...current) + EMAIL_WINDOW_MS
        const remaining = resetAt - Date.now()
        if (remaining > 0) {
          setEmailCountdown(`${Math.floor(remaining / 60000)}m ${Math.floor((remaining % 60000) / 1000)}s`)
        } else {
          setEmailCountdown('')
        }
      } else {
        setEmailCountdown('')
      }
    }
    tick()
    const interval = setInterval(tick, 1000)
    return () => clearInterval(interval)
  }, [getEmailSends])

  const emailsRemaining = Math.max(0, EMAIL_RATE_LIMIT - emailSends.length)
  const emailPct = Math.round((emailSends.length / EMAIL_RATE_LIMIT) * 100)

  const loadUsage = useCallback(async () => {
    if (refreshing) return
    setRefreshing(true)
    setStorageError('')
    try {
      const savedScans = await listSavedScans({ supabase, ownerId })
      setScans(savedScans)
      setScansStatus('ready')
      if (user?.id) {
        const [saved, readable] = await Promise.all([
          getSavedScanStorageUsage({ supabase, userId: user.id }),
          probeReadableFileStorage({ supabase, userId: user.id })
        ])
        setSavedScanStorage(saved)
        setFileStorage(readable)
      }
    } catch (error) {
      setScansStatus('error')
      setStorageError(error?.message || 'Usage could not be loaded.')
    } finally {
      setRefreshing(false)
    }
  }, [ownerId, refreshing, user?.id])

  useEffect(() => { loadUsage() }, [loadUsage])

  const gemini = useMemo(() => summarizeSavedScanUsage(scans), [scans])

  return (
    <section className="space-y-6" aria-label="Storage and limits">
      <div>
        <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-1">Storage & Limits</h3>
        <p className="text-sm text-gray-500 dark:text-gray-400">Live database usage, file storage, Paper Scan quota, and free-plan limits.</p>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={loadUsage}
          className="inline-flex items-center gap-1.5 rounded-xl bg-orange-600 px-3 py-1.5 text-sm font-bold text-white hover:bg-orange-700 disabled:opacity-50"
          disabled={refreshing}
        >
          <RefreshCw className={`h-3.5 w-3.5 ${refreshing ? 'animate-spin' : ''}`} /> Refresh usage
        </button>
        {scansStatus === 'error' && (
          <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-red-600 dark:text-red-400">
            <AlertCircle className="h-3.5 w-3.5" /> {storageError || 'Usage could not be loaded.'}
          </span>
        )}
      </div>

      <div data-setting-id="storage_limits" tabIndex={-1} className={`overflow-hidden rounded-2xl border border-gray-200 bg-white dark:border-gray-700 dark:bg-gray-800 ${getSettingTargetClass('storage_limits')}`}>
        <div className="flex items-start justify-between gap-4 border-b border-gray-100 p-4 dark:border-gray-700">
          <div className="flex items-center gap-2">
            <Database className="h-4 w-4 text-emerald-600" />
            <div>
              <h4 className="font-semibold text-gray-900 dark:text-white">Database Storage</h4>
              <p className="text-xs text-gray-500 dark:text-gray-400">Member data, attendance, badges, tags, and monthly tables. Reads the live <code className="font-mono">get_database_usage</code> RPC.</p>
            </div>
          </div>
          <span className="text-xs font-bold px-2.5 py-1 rounded-full bg-orange-100 dark:bg-orange-900/40 text-orange-700 dark:text-orange-300">Free Plan</span>
        </div>
        <div className="space-y-3 p-4">
          <div className="flex items-center justify-between text-sm">
            <span className="font-semibold text-gray-800 dark:text-gray-200">Used</span>
            {dbLoading ? (
              <span className="flex items-center gap-1 text-gray-400"><Loader2 className="h-3 w-3 animate-spin" /> Loading...</span>
            ) : dbUsage ? (
              <span className={`font-bold ${Number(dbUsage.db_size_mb) > dbLimitMb * 0.8 ? 'text-orange-600 dark:text-orange-400' : 'text-gray-900 dark:text-white'}`}>
                {Number(dbUsage.db_size_mb).toFixed(2)} / {dbLimitMb} MB
              </span>
            ) : (
              <span className="text-gray-400">Unavailable</span>
            )}
          </div>
          <UsageBar used={Number(dbUsage?.db_size_mb) || 0} total={dbLimitMb} />
          <div className="flex items-center justify-between text-xs">
            <span className="font-medium text-emerald-600 dark:text-emerald-400">
              {dbUsage ? `${(dbLimitMb - Number(dbUsage.db_size_mb)).toFixed(2)} MB free` : 'Run refresh to check usage'}
            </span>
            <button onClick={fetchDbUsage} className="flex items-center gap-1 font-semibold text-orange-500 transition-colors hover:text-orange-600 dark:hover:text-orange-400">
              <RefreshCw className={`h-3 w-3 ${dbLoading ? 'animate-spin' : ''}`} /> Refresh
            </button>
          </div>
        </div>
      </div>

      <div className="overflow-hidden rounded-2xl border border-gray-200 bg-white dark:border-gray-700 dark:bg-gray-800">
        <div className="flex items-start justify-between gap-4 border-b border-gray-100 p-4 dark:border-gray-700">
          <div className="flex items-center gap-2">
            <HardDrive className="h-4 w-4 text-blue-600" />
            <div>
              <h4 className="font-semibold text-gray-900 dark:text-white">File Storage</h4>
              <p className="text-xs text-gray-500 dark:text-gray-400">Images and uploads across all Supabase buckets.</p>
            </div>
          </div>
          <span className="text-xs font-bold px-2.5 py-1 rounded-full bg-orange-100 dark:bg-orange-900/40 text-orange-700 dark:text-orange-300">1 GB Free</span>
        </div>
        <div className="space-y-3 p-4">
          <div className="flex items-center justify-between text-sm">
            <span className="font-semibold text-gray-800 dark:text-gray-200">Total used</span>
            <span className="font-semibold text-gray-900 dark:text-white">Not available from provider</span>
          </div>
          <p className="text-xs text-gray-500 dark:text-gray-400">
            Supabase storage only exposes objects your login is allowed to read, so the project-wide total cannot be shown. The quota is {formatBytes(FILE_STORAGE_QUOTA_BYTES)} on the Free plan.
          </p>
          <div className="rounded-xl border border-gray-200 bg-gray-50 p-3 dark:border-gray-700 dark:bg-gray-900/40">
            <div className="flex items-center justify-between text-xs font-bold text-gray-600 dark:text-gray-300">
              <span>Readable from your account</span>
              <span>{refreshing ? 'Checking…' : `${formatBytes(fileStorage.bytes)} · ${fileStorage.objects} files`}</span>
            </div>
            {!refreshing && fileStorage.buckets.length > 0 && (
              <ul className="mt-2 space-y-1 text-xs text-gray-500 dark:text-gray-400">
                {fileStorage.buckets.filter((bucket) => bucket.objects > 0).map((bucket) => (
                  <li key={bucket.bucket} className="flex items-center justify-between">
                    <span className="font-mono">{bucket.bucket}</span>
                    <span>{formatBytes(bucket.bytes)} · {bucket.objects} files</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </div>

      <div className="overflow-hidden rounded-2xl border border-gray-200 bg-white dark:border-gray-700 dark:bg-gray-800">
        <div className="flex items-start justify-between gap-4 border-b border-gray-100 p-4 dark:border-gray-700">
          <div className="flex items-center gap-2">
            <FileBox className="h-4 w-4 text-violet-600" />
            <div>
              <h4 className="font-semibold text-gray-900 dark:text-white">Saved Scan Storage</h4>
              <p className="text-xs text-gray-500 dark:text-gray-400">Private sheet images in the saved-scans bucket, counted inside your File Storage quota.</p>
            </div>
          </div>
        </div>
        <div className="space-y-3 p-4">
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            <Metric label="Used" value={refreshing ? 'Checking…' : formatBytes(savedScanStorage.bytes)} />
            <Metric label="Files" value={refreshing ? 'Checking…' : String(savedScanStorage.objects)} />
          </div>
          <p className="text-xs text-gray-500 dark:text-gray-400">Scanned sheet photos your account has saved for reopening without re-billing Gemini.</p>
        </div>
      </div>

      <div className="overflow-hidden rounded-2xl border border-gray-200 bg-white dark:border-gray-700 dark:bg-gray-800">
        <div className="flex items-start justify-between gap-4 border-b border-gray-100 p-4 dark:border-gray-700">
          <div className="flex items-center gap-2">
            <ScanLine className="h-4 w-4 text-orange-600" />
            <div>
              <h4 className="font-semibold text-gray-900 dark:text-white">Gemini</h4>
              <p className="text-xs text-gray-500 dark:text-gray-400">Paper Scan extraction usage, read from persisted scan metadata.</p>
            </div>
          </div>
          <HealthBadge healthy={gemini.successfulCalls > 0}>{gemini.successfulCalls > 0 ? 'Recorded successful calls' : 'No saved successful call yet'}</HealthBadge>
        </div>
        <div className="space-y-4 p-4">
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-4">
            <Metric label="Configured model" value={PAPER_SCAN_GEMINI_MODEL} />
            <Metric label="Successful calls" value={String(gemini.successfulCalls)} />
            <Metric label="Tokens" value={`${gemini.promptTokens} input · ${gemini.candidateTokens} output`} />
            <Metric label="Last successful call" value={formatTime(gemini.lastSuccessfulAt)} />
          </div>
          <div className="rounded-xl border border-gray-200 bg-gray-50 p-3 dark:border-gray-700 dark:bg-gray-900/40">
            <p className="text-xs font-bold text-gray-600 dark:text-gray-300">Today’s usage (from saved scans)</p>
            <p className="mt-1 text-sm text-gray-700 dark:text-gray-300">
              {gemini.today.calls > 0
                ? `${gemini.today.calls} call${gemini.today.calls !== 1 ? 's' : ''} · ${gemini.today.promptTokens} input · ${gemini.today.candidateTokens} output · ${gemini.today.totalTokens} total`
                : 'No successful extraction recorded yet today.'}
            </p>
          </div>
          {gemini.recent.length > 0 && (
            <div>
              <p className="mb-2 text-xs font-bold uppercase tracking-wide text-gray-500 dark:text-gray-400">Recent Paper Scan usage</p>
              <ul className="space-y-1.5 text-xs text-gray-600 dark:text-gray-300">
                {gemini.recent.map((entry, index) => (
                  <li key={`${entry.scanId}-${entry.sheetId}`} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-gray-100 bg-white px-2.5 py-2 dark:border-gray-700 dark:bg-gray-900/40">
                    <span className="truncate font-semibold">{entry.scanName}{entry.sheetId ? ` · ${entry.sheetId}` : ''}</span>
                    <span className="text-gray-400">{entry.promptTokens} in · {entry.candidateTokens} out · {formatTime(entry.extractedAt)}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
          <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 dark:border-amber-800/50 dark:bg-amber-900/15">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-xs text-amber-800 dark:text-amber-200">
                <strong>Remaining quota:</strong> Not available from provider. Gemini quota is not reported through this app.
              </p>
              <a
                href="https://aistudio.google.com/app/apikey"
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1 text-xs font-bold text-amber-700 hover:text-amber-900 dark:text-amber-300 dark:hover:text-amber-100"
              >
                View live limits in Google AI Studio <ExternalLink className="h-3 w-3" />
              </a>
            </div>
          </div>
        </div>
      </div>

      <div className="overflow-hidden rounded-2xl border border-gray-200 bg-white dark:border-gray-700 dark:bg-gray-800">
        <div className="flex items-start justify-between gap-4 border-b border-gray-100 p-4 dark:border-gray-700">
          <div className="flex items-center gap-2">
            <Wifi className="h-4 w-4 text-gray-500" />
            <div>
              <h4 className="font-semibold text-gray-900 dark:text-white">Alibaba / Qwen</h4>
              <p className="text-xs text-gray-500 dark:text-gray-400">Alternative extraction model, if configured.</p>
            </div>
          </div>
          <HealthBadge healthy={false}>Not connected</HealthBadge>
        </div>
        <div className="space-y-3 p-4">
          <p className="text-xs text-gray-500 dark:text-gray-400">No Alibaba/Qwen integration is present in this build; model, calls, tokens, quota, and last updated are unavailable.</p>
        </div>
      </div>

      <div className="overflow-hidden rounded-2xl border border-gray-200 bg-white dark:border-gray-700 dark:bg-gray-800">
        <div className="flex items-start justify-between gap-4 border-b border-gray-100 p-4 dark:border-gray-700">
          <div className="flex items-center gap-2">
            <Mail className="h-4 w-4 text-purple-600" />
            <div>
              <h4 className="font-semibold text-gray-900 dark:text-white">Auth Emails</h4>
              <p className="text-xs text-gray-500 dark:text-gray-400">Magic links, password resets, invites, and signup confirmations.</p>
            </div>
          </div>
          <span className={`text-xs font-bold px-2.5 py-1 rounded-full ${emailsRemaining === 0 ? 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-200' : 'bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-200'}`}>
            {emailSends.length} / {EMAIL_RATE_LIMIT}
          </span>
        </div>
        <div className="space-y-3 p-4">
          <UsageBar used={emailSends.length} total={EMAIL_RATE_LIMIT} tone={emailsRemaining === 0 ? 'from-red-400 to-red-500' : emailPct >= 66 ? 'from-amber-400 to-orange-500' : 'from-purple-400 to-purple-500'} />
          <div className="flex items-center justify-between text-xs">
            <span className={`font-medium ${emailsRemaining === 0 ? 'text-red-600 dark:text-red-400' : 'text-purple-600 dark:text-purple-400'}`}>
              {emailsRemaining > 0 ? `${emailsRemaining} email${emailsRemaining !== 1 ? 's' : ''} remaining` : 'Rate limit reached'}
            </span>
            {emailCountdown ? (
              <span className="font-medium text-orange-600 dark:text-orange-400">Resets in {emailCountdown}</span>
            ) : (
              <span className="text-gray-400">Resets hourly</span>
            )}
          </div>
        </div>
      </div>

      {oldestMonthTable && (
        <div className="flex items-start gap-3 rounded-2xl border border-amber-200 bg-amber-50 p-4 dark:border-amber-800/50 dark:bg-amber-900/15">
          <Archive className="mt-0.5 h-5 w-5 flex-shrink-0 text-amber-600 dark:text-amber-400" />
          <div className="min-w-0 flex-1">
            <h4 className="font-semibold text-amber-900 dark:text-amber-200">Archive recommendation</h4>
            <p className="mt-1 text-sm text-amber-800 dark:text-amber-300">
              Archive <strong>{String(oldestMonthTable.table_name).replace('_', ' ')}</strong> ({oldestMonthTable.size_mb} MB) to free up space.
            </p>
            <button
              type="button"
              onClick={() => { openSettingsSection('data'); setArchiveMonth(oldestMonthTable.table_name) }}
              className="mt-3 rounded-xl bg-amber-600 px-4 py-2 text-sm font-bold text-white hover:bg-amber-700"
            >
              Archive Month
            </button>
          </div>
        </div>
      )}

      <PlanDetails />
    </section>
  )
}

const PlanDetails = () => {
  const [open, setOpen] = useState(false)
  return (
    <div className="overflow-hidden rounded-2xl border border-gray-200 bg-white dark:border-gray-700 dark:bg-gray-800">
      <button
        type="button"
        onClick={() => setOpen((current) => !current)}
        className="flex w-full items-center justify-between gap-4 p-4 text-left transition-colors hover:bg-gray-50 dark:hover:bg-gray-700/50"
      >
        <div>
          <h4 className="font-semibold text-gray-900 dark:text-white">Plan details</h4>
          <p className="text-xs text-gray-500 dark:text-gray-400">See what counts toward storage and when to archive old months.</p>
        </div>
        <ChevronDown className={`h-5 w-5 text-gray-400 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && (
        <div className="space-y-3 px-4 pb-4 text-sm text-gray-600 dark:text-gray-300">
          <div className="rounded-xl border border-gray-200 bg-gray-50 p-3 dark:border-gray-700 dark:bg-gray-900/40">
            Member records, attendance tables, tags, notes, and badges all count toward database storage.
          </div>
          <div className="rounded-xl border border-gray-200 bg-gray-50 p-3 dark:border-gray-700 dark:bg-gray-900/40">
            Archive older month tables when they are no longer actively edited. Exports stay available while the database gets lighter.
          </div>
          <div className="rounded-xl border border-gray-200 bg-gray-50 p-3 dark:border-gray-700 dark:bg-gray-900/40">
            Supabase auth emails reset on a rolling hourly window, so invites and password emails may pause until the limit refreshes.
          </div>
        </div>
      )}
    </div>
  )
}

export default PaperScanStorageLimitsSection