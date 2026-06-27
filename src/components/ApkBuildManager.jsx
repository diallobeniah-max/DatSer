import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { AlertTriangle, CheckCircle2, Hammer, RefreshCw, Upload, FolderOpen, TerminalSquare } from 'lucide-react'
import { notify } from '../utils/notify'

const DEV_APK_ENDPOINT = '/__datser-dev/apk-build'
const DEV_APK_STATUS_ENDPOINT = '/__datser-dev/apk-build/status'
const DEV_APK_UPLOAD_ENDPOINT = '/__datser-dev/apk-build/upload'

const formatBytes = (value) => {
  const bytes = Number(value || 0)
  if (!bytes) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB']
  const index = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1)
  return `${(bytes / (1024 ** index)).toFixed(index === 0 ? 0 : 1)} ${units[index]}`
}

const ApkBuildManager = ({ canAccess = false, canUpload = false, userId = null }) => {
  const [job, setJob] = useState(null)
  const [isStarting, setIsStarting] = useState(false)
  const [isUploading, setIsUploading] = useState(false)
  const [uploadResult, setUploadResult] = useState(null)
  const [uploadError, setUploadError] = useState(null)
  const [releaseForm, setReleaseForm] = useState({
    versionName: '',
    versionCode: '',
    title: '',
    description: '',
    forceUpdate: false,
    isActive: true
  })
  const pollRef = useRef(null)

  const isLocalDev = import.meta.env.DEV
  const canUseBuilder = canAccess && isLocalDev
  const isRunning = job?.status === 'running'
  const canUploadBuiltApk = canUseBuilder && canUpload && job?.status === 'success' && !isUploading

  const progressLabel = useMemo(() => {
    if (!job) return 'Ready'
    if (job.status === 'success') return 'APK created'
    if (job.status === 'failed') return 'Build failed'
    return 'Building APK'
  }, [job])

  const stopPolling = useCallback(() => {
    if (pollRef.current) {
      window.clearInterval(pollRef.current)
      pollRef.current = null
    }
  }, [])

  useEffect(() => () => stopPolling(), [stopPolling])

  const applyDefaults = (defaults = {}) => {
    setReleaseForm((current) => ({
      ...current,
      versionName: current.versionName || defaults.versionName || '',
      versionCode: current.versionCode || String(defaults.versionCode || ''),
      title: current.title || defaults.title || '',
      description: current.description || defaults.description || ''
    }))
  }

  const pollJob = (jobId) => {
    stopPolling()
    pollRef.current = window.setInterval(async () => {
      try {
        const response = await fetch(`${DEV_APK_STATUS_ENDPOINT}?jobId=${encodeURIComponent(jobId)}`, { cache: 'no-store' })
        const payload = await response.json()
        if (!response.ok) throw new Error(payload?.error || 'Could not read APK build status.')
        setJob(payload.job)
        applyDefaults(payload.job?.defaults)
        if (payload.job?.status !== 'running') stopPolling()
      } catch (error) {
        stopPolling()
        setJob((current) => current ? {
          ...current,
          status: 'failed',
          progress: 100,
          error: error?.message || 'Lost connection to the local APK build job.',
          nextStep: 'Refresh the local dev server and start the APK build again.'
        } : current)
      }
    }, 1200)
  }

  const startBuild = async () => {
    if (!canUseBuilder || isRunning) return
    setIsStarting(true)
    setJob(null)
    setUploadResult(null)
    setUploadError(null)
    try {
      const response = await fetch(DEV_APK_ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode: 'local' })
      })
      const payload = await response.json()
      if (!response.ok) throw new Error(payload?.error || 'Could not start APK build.')
      setJob(payload.job)
      applyDefaults(payload.job?.defaults)
      pollJob(payload.job.id)
      notify.info('APK build started.', {
        title: 'Building local APK',
        details: 'Keep this dev server running while Gradle creates the APK.'
      })
    } catch (error) {
      setJob({
        status: 'failed',
        progress: 100,
        error: error?.message || 'Could not start APK build.',
        nextStep: 'Make sure you are running the local Vite dev server, then retry.'
      })
    } finally {
      setIsStarting(false)
    }
  }

  const uploadBuiltApk = async () => {
    if (!canUploadBuiltApk || !job?.id) return
    setIsUploading(true)
    setUploadError(null)
    try {
      const response = await fetch(DEV_APK_UPLOAD_ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jobId: job.id,
          ...releaseForm,
          userId
        })
      })
      const payload = await response.json().catch(() => ({}))
      if (!response.ok) {
        const message = payload?.details || payload?.error || 'Failed to upload built APK.'
        const error = new Error(message)
        error.step = payload?.step
        error.nextStep = payload?.nextStep
        throw error
      }
      setUploadResult(payload)
      notify.success('Built APK uploaded.', {
        title: `Version ${payload.release?.versionName || releaseForm.versionName}`,
        details: `Uploaded to ${payload.bucket}/${payload.storagePath}`
      })
    } catch (error) {
      const stepLabel = error?.step ? `Failed step: ${error.step}. ` : ''
      const message = `${stepLabel}${error?.message || 'Failed to upload built APK.'}`
      setUploadError({
        message,
        nextStep: error?.nextStep || 'Check Supabase service role configuration, app update policies, and retry.'
      })
      notify.error(message, {
        title: 'Upload failed',
        details: error?.nextStep || 'Check Supabase service role configuration, app update policies, and retry.',
        persistent: true
      })
    } finally {
      setIsUploading(false)
    }
  }

  const updateField = (field, value) => {
    setReleaseForm((current) => ({ ...current, [field]: value }))
  }

  if (!canUseBuilder) {
    return null
  }

  return (
    <section className="overflow-hidden rounded-3xl border border-orange-200 bg-gradient-to-br from-orange-50 via-white to-amber-50 shadow-sm dark:border-orange-400/20 dark:from-orange-950/25 dark:via-gray-900 dark:to-[#202121]">
      <div className="border-b border-orange-100/80 p-4 dark:border-orange-400/10 sm:p-5">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="flex min-w-0 gap-3">
            <div className="grid h-12 w-12 shrink-0 place-items-center rounded-2xl bg-orange-600 text-white shadow-lg shadow-orange-900/20">
              <Hammer className="h-6 w-6" />
            </div>
            <div className="min-w-0">
              <p className="text-xs font-black uppercase tracking-[0.18em] text-orange-600 dark:text-orange-300">Developer APK forge</p>
              <h3 className="mt-1 text-xl font-black text-gray-950 dark:text-white">Build from current local files</h3>
              <p className="mt-1 text-sm text-gray-600 dark:text-gray-300">
                Creates a local bundled debug APK through the dev server, then lets you upload it through App Updates.
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={startBuild}
            disabled={isStarting || isRunning}
            className="inline-flex min-h-[46px] items-center justify-center gap-2 rounded-2xl bg-orange-600 px-4 py-2 text-sm font-black text-white shadow-lg shadow-orange-900/20 transition hover:bg-orange-700 disabled:cursor-wait disabled:bg-orange-300"
          >
            {isStarting || isRunning ? <RefreshCw className="h-4 w-4 animate-spin" /> : <Hammer className="h-4 w-4" />}
            {isRunning ? 'Building...' : 'Create new APK'}
          </button>
        </div>
      </div>

      <div className="grid gap-4 p-4 sm:p-5 lg:grid-cols-[1fr_0.9fr]">
        <div className="space-y-4">
          <div className="rounded-2xl border border-orange-100 bg-white/82 p-4 dark:border-white/10 dark:bg-black/20">
            <div className="mb-3 flex items-center justify-between gap-3">
              <div>
                <p className="text-sm font-black text-gray-900 dark:text-white">{progressLabel}</p>
                <p className="text-xs text-gray-500 dark:text-gray-400">Local dev server bridge · Android Gradle</p>
              </div>
              <span className="rounded-full bg-orange-100 px-3 py-1 text-xs font-black text-orange-700 dark:bg-orange-500/15 dark:text-orange-200">
                {Math.round(job?.progress || 0)}%
              </span>
            </div>
            <div className="h-3 overflow-hidden rounded-full bg-gray-100 dark:bg-white/10">
              <div
                className="h-full rounded-full bg-gradient-to-r from-orange-500 to-amber-400 transition-all duration-500"
                style={{ width: `${Math.min(100, Math.max(0, job?.progress || 0))}%` }}
              />
            </div>

            {job?.status === 'success' && (
              <div className="mt-4 rounded-2xl border border-green-200 bg-green-50 p-3 text-sm text-green-800 dark:border-green-400/20 dark:bg-green-500/10 dark:text-green-100">
                <p className="flex items-center gap-2 font-black">
                  <CheckCircle2 className="h-4 w-4" />
                  APK created successfully · Saved on this laptop
                </p>
                <div className="mt-2 flex items-start gap-2 rounded-xl bg-white/70 p-3 font-mono text-xs text-green-950 dark:bg-black/20 dark:text-green-50">
                  <FolderOpen className="mt-0.5 h-4 w-4 shrink-0" />
                  <span className="break-all">{job.apkPath}</span>
                </div>
                <p className="mt-2 text-xs font-semibold opacity-80">{formatBytes(job.fileSize)} · {job.nextStep}</p>
              </div>
            )}

            {job?.status === 'failed' && (
              <div className="mt-4 rounded-2xl border border-red-200 bg-red-50 p-3 text-sm text-red-800 dark:border-red-400/20 dark:bg-red-500/10 dark:text-red-100">
                <p className="flex items-center gap-2 font-black">
                  <AlertTriangle className="h-4 w-4" />
                  {job.error || 'APK build failed.'}
                </p>
                <p className="mt-2 text-xs font-semibold opacity-85">{job.nextStep || 'Check the build log, fix the Android toolchain issue, then retry.'}</p>
              </div>
            )}
          </div>

          <details className="rounded-2xl border border-gray-200 bg-white/70 p-3 dark:border-white/10 dark:bg-black/20">
            <summary className="flex cursor-pointer items-center gap-2 text-sm font-black text-gray-800 dark:text-white">
              <TerminalSquare className="h-4 w-4 text-orange-500" />
              Build log
            </summary>
            <pre className="mt-3 max-h-56 overflow-auto whitespace-pre-wrap rounded-xl bg-gray-950 p-3 text-xs leading-5 text-orange-50">
              {(job?.logs?.length ? job.logs : ['No build started yet.']).join('\n')}
            </pre>
          </details>
        </div>

        <div className="rounded-2xl border border-gray-200 bg-white/82 p-4 dark:border-white/10 dark:bg-black/20">
          <p className="text-sm font-black text-gray-900 dark:text-white">Upload details</p>
          <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">Blank fields are prefilled from local app metadata when possible.</p>

          <div className="mt-4 grid gap-3">
            <label className="text-sm font-semibold text-gray-700 dark:text-gray-200">
              Version name
              <input
                value={releaseForm.versionName}
                onChange={(event) => updateField('versionName', event.target.value)}
                className="mt-1 w-full rounded-xl border border-gray-200 bg-white px-3 py-2 text-gray-900 outline-none focus:ring-2 focus:ring-orange-500 dark:border-white/10 dark:bg-gray-900 dark:text-white"
                placeholder="1.0.5"
              />
            </label>
            <label className="text-sm font-semibold text-gray-700 dark:text-gray-200">
              Version code
              <input
                type="number"
                min="1"
                value={releaseForm.versionCode}
                onChange={(event) => updateField('versionCode', event.target.value)}
                className="mt-1 w-full rounded-xl border border-gray-200 bg-white px-3 py-2 text-gray-900 outline-none focus:ring-2 focus:ring-orange-500 dark:border-white/10 dark:bg-gray-900 dark:text-white"
                placeholder="5"
              />
            </label>
            <label className="text-sm font-semibold text-gray-700 dark:text-gray-200">
              Update title
              <input
                value={releaseForm.title}
                onChange={(event) => updateField('title', event.target.value)}
                className="mt-1 w-full rounded-xl border border-gray-200 bg-white px-3 py-2 text-gray-900 outline-none focus:ring-2 focus:ring-orange-500 dark:border-white/10 dark:bg-gray-900 dark:text-white"
                placeholder="DatSer Android update"
              />
            </label>
            <label className="text-sm font-semibold text-gray-700 dark:text-gray-200">
              Release notes
              <textarea
                value={releaseForm.description}
                onChange={(event) => updateField('description', event.target.value)}
                rows={3}
                className="mt-1 w-full rounded-xl border border-gray-200 bg-white px-3 py-2 text-gray-900 outline-none focus:ring-2 focus:ring-orange-500 dark:border-white/10 dark:bg-gray-900 dark:text-white"
                placeholder="What changed in this APK?"
              />
            </label>
            <div className="flex flex-wrap gap-3">
              <label className="inline-flex items-center gap-2 text-sm font-bold text-gray-700 dark:text-gray-200">
                <input
                  type="checkbox"
                  checked={releaseForm.forceUpdate}
                  onChange={(event) => updateField('forceUpdate', event.target.checked)}
                  className="h-4 w-4 rounded border-gray-300 text-orange-600 focus:ring-orange-500"
                />
                Force update
              </label>
              <label className="inline-flex items-center gap-2 text-sm font-bold text-gray-700 dark:text-gray-200">
                <input
                  type="checkbox"
                  checked={releaseForm.isActive}
                  onChange={(event) => updateField('isActive', event.target.checked)}
                  className="h-4 w-4 rounded border-gray-300 text-orange-600 focus:ring-orange-500"
                />
                Publish now
              </label>
            </div>
          </div>

          {job?.status === 'success' && (
            <button
              type="button"
              onClick={uploadBuiltApk}
              disabled={!canUploadBuiltApk}
              className="mt-4 inline-flex min-h-[46px] w-full items-center justify-center gap-2 rounded-2xl bg-gray-950 px-4 py-2 text-sm font-black text-white transition hover:bg-gray-800 disabled:cursor-not-allowed disabled:bg-gray-400 dark:bg-white dark:text-gray-950 dark:hover:bg-orange-100"
            >
              {isUploading ? <RefreshCw className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
              {isUploading ? 'Uploading built APK...' : 'Upload built APK'}
            </button>
          )}

          {uploadResult && (
            <div className="mt-4 rounded-2xl border border-green-200 bg-green-50 p-3 text-xs text-green-900 dark:border-green-400/20 dark:bg-green-500/10 dark:text-green-100">
              <p className="font-black">Upload complete</p>
              <p className="mt-1 break-all">Bucket/path: {uploadResult.bucket}/{uploadResult.storagePath}</p>
              <p className="mt-1 break-all">Download URL: {uploadResult.apkUrl}</p>
              <p className="mt-1">Status: {uploadResult.publishStatus}</p>
            </div>
          )}

          {uploadError && (
            <div className="mt-4 rounded-2xl border border-red-200 bg-red-50 p-3 text-xs text-red-900 dark:border-red-400/20 dark:bg-red-500/10 dark:text-red-100">
              <p className="font-black">Upload needs attention</p>
              <p className="mt-1">{uploadError.message}</p>
              <p className="mt-1 font-semibold opacity-85">{uploadError.nextStep}</p>
            </div>
          )}

          {!canUpload && (
            <p className="mt-3 rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs font-semibold text-amber-800 dark:border-amber-400/20 dark:bg-amber-500/10 dark:text-amber-100">
              Upload needs Supabase App Updates access. Build still works locally in developer mode.
            </p>
          )}
        </div>
      </div>
    </section>
  )
}

export default ApkBuildManager
