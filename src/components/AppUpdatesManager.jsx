import React, { useEffect, useMemo, useState } from 'react'
import { AlertTriangle, CheckCircle2, ChevronDown, Download, Eye, EyeOff, RefreshCw, Upload } from 'lucide-react'
import { supabase } from '../lib/supabase'
import {
  APK_FILE_LIMIT_BYTES,
  fetchReleaseHistory,
  getInstalledAppInfo,
  openApkDownload,
  setReleasePublished,
  uploadApkRelease,
  validateApkFile
} from '../utils/appUpdates'
import { notify } from '../utils/notify'

const emptyForm = {
  versionName: '',
  versionCode: '',
  title: '',
  description: '',
  forceUpdate: false,
  isActive: true,
  file: null
}

const AppUpdatesManager = ({ canManage = false, userId = null }) => {
  const [releases, setReleases] = useState([])
  const [form, setForm] = useState(emptyForm)
  const [isLoading, setIsLoading] = useState(false)
  const [isSaving, setIsSaving] = useState(false)
  const [appInfo, setAppInfo] = useState(null)
  const [backendError, setBackendError] = useState('')
  const [isOpen, setIsOpen] = useState(false)

  const fileError = useMemo(() => validateApkFile(form.file), [form.file])
  const canSubmit = canManage && supabase && form.versionName && form.versionCode && form.file && !fileError && !isSaving

  const loadReleases = async () => {
    setIsLoading(true)
    setBackendError('')
    try {
      const [history, currentInfo] = await Promise.all([
        fetchReleaseHistory(),
        getInstalledAppInfo()
      ])
      setReleases(history)
      setAppInfo(currentInfo)
    } catch (error) {
      const missingBackend =
        error?.code === '42P01' ||
        error?.code === 'PGRST205' ||
        String(error?.message || '').includes('app_releases')
      setBackendError(missingBackend
        ? 'App update tables/storage are not installed yet. Run the Supabase migration in supabase/migrations.'
        : (error?.message || 'Could not load app releases.'))
    } finally {
      setIsLoading(false)
    }
  }

  useEffect(() => {
    loadReleases()
  }, [])

  const updateForm = (field, value) => {
    setForm(prev => ({ ...prev, [field]: value }))
  }

  const submitRelease = async (event) => {
    event.preventDefault()
    if (!canSubmit) return

    setIsSaving(true)
    try {
      const release = await uploadApkRelease({
        ...form,
        userId
      })
      setForm(emptyForm)
      setReleases(prev => [release, ...prev])
      notify.update('New APK release uploaded.', {
        title: `Version ${release.versionName}`,
        details: release.description
      })
    } catch (error) {
      notify.error(error?.message || 'Failed to upload APK release.', {
        title: 'Upload failed',
        persistent: true
      })
    } finally {
      setIsSaving(false)
    }
  }

  const toggleRelease = async (release) => {
    try {
      const updated = await setReleasePublished(release.id, !release.isActive)
      setReleases(prev => prev.map(item => item.id === updated.id ? updated : item))
      notify.success(updated.isActive ? 'Release published.' : 'Release unpublished.')
    } catch (error) {
      notify.error(error?.message || 'Could not update release status.')
    }
  }

  return (
    <div className="bg-white dark:bg-gray-800 rounded-2xl border border-gray-200 dark:border-gray-700 overflow-hidden animate-fade-in-up">
      <div className="border-b border-gray-200 dark:border-gray-700">
        <div className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
          <button
            type="button"
            onClick={() => setIsOpen(prev => !prev)}
            className="group flex min-w-0 flex-1 items-center gap-3 text-left"
            aria-expanded={isOpen}
          >
            <span className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-orange-100 text-orange-600 dark:bg-orange-500/15 dark:text-orange-300">
              <Upload className="h-5 w-5" />
            </span>
            <span className="min-w-0">
              <span className="flex items-center gap-2 font-semibold text-gray-900 dark:text-white">
                App Updates
                <ChevronDown className={`h-4 w-4 text-gray-400 transition-transform duration-200 group-hover:text-orange-500 ${isOpen ? 'rotate-180' : ''}`} />
              </span>
              <span className="mt-1 block text-sm text-gray-500 dark:text-gray-400">
                Upload APK releases and review Android update history.
              </span>
            </span>
          </button>
          <div className="flex flex-wrap items-center gap-2 sm:justify-end">
            <span className="rounded-full bg-gray-100 px-3 py-1 text-xs font-bold text-gray-600 dark:bg-gray-900 dark:text-gray-300">
              {appInfo ? `${appInfo.versionName} (${appInfo.versionCode || 'web'})` : 'Loading...'}
            </span>
            <span className="rounded-full bg-orange-50 px-3 py-1 text-xs font-bold text-orange-700 dark:bg-orange-500/10 dark:text-orange-200">
              {appInfo?.runtimeMode || 'Website'}
            </span>
            <span className="rounded-full bg-gray-100 px-3 py-1 text-xs font-bold text-gray-600 dark:bg-gray-900 dark:text-gray-300">
              {releases.length} release{releases.length === 1 ? '' : 's'}
            </span>
            <button
              type="button"
              onClick={loadReleases}
              disabled={isLoading}
              className="inline-flex h-9 w-9 items-center justify-center rounded-xl border border-gray-200 bg-white text-gray-700 hover:bg-gray-50 disabled:opacity-60 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-200 dark:hover:bg-gray-800"
              aria-label="Refresh app releases"
            >
              <RefreshCw className={`h-4 w-4 ${isLoading ? 'animate-spin' : ''}`} />
            </button>
          </div>
        </div>
      </div>

      <div className={`grid transition-[grid-template-rows] duration-300 ease-out ${isOpen ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]'}`}>
        <div className="min-h-0 overflow-hidden">
          <div className="p-4 space-y-4">
        {!canManage && (
          <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-100">
            Only workspace owners, admin collaborators, and developer-mode users can upload APK releases.
          </div>
        )}

        {!supabase && (
          <div className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-800 dark:border-red-800 dark:bg-red-950/30 dark:text-red-100">
            Supabase is not configured, so APK release uploads are disabled.
          </div>
        )}

        {backendError && (
          <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-100">
            {backendError}
          </div>
        )}

        <div className="grid grid-cols-1 gap-3 rounded-xl border border-gray-200 bg-gray-50 p-3 text-sm dark:border-gray-700 dark:bg-gray-900/40 sm:grid-cols-3">
          <div>
            <p className="text-xs font-semibold uppercase text-gray-400">Current version</p>
            <p className="mt-1 font-semibold text-gray-900 dark:text-white">
              {appInfo ? `${appInfo.versionName} (${appInfo.versionCode || 'web'})` : 'Loading...'}
            </p>
          </div>
          <div>
            <p className="text-xs font-semibold uppercase text-gray-400">APK mode</p>
            <p className="mt-1 font-semibold text-gray-900 dark:text-white">{appInfo?.runtimeMode || 'Website'}</p>
          </div>
          <div>
            <p className="text-xs font-semibold uppercase text-gray-400">Upload limit</p>
            <p className="mt-1 font-semibold text-gray-900 dark:text-white">{Math.round(APK_FILE_LIMIT_BYTES / 1024 / 1024)} MB .apk only</p>
          </div>
        </div>

        <form onSubmit={submitRelease} className="rounded-2xl border border-gray-200 bg-white p-4 dark:border-gray-700 dark:bg-gray-900/40">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <label className="space-y-1 text-sm">
              <span className="font-semibold text-gray-700 dark:text-gray-200">Version name</span>
              <input
                value={form.versionName}
                onChange={(event) => updateForm('versionName', event.target.value)}
                placeholder="1.0.3"
                disabled={!canManage}
                className="w-full rounded-xl border border-gray-200 bg-gray-50 px-3 py-2 text-gray-900 outline-none focus:ring-2 focus:ring-orange-500 disabled:opacity-60 dark:border-gray-700 dark:bg-gray-800 dark:text-white"
              />
            </label>
            <label className="space-y-1 text-sm">
              <span className="font-semibold text-gray-700 dark:text-gray-200">Version code</span>
              <input
                type="number"
                min="1"
                value={form.versionCode}
                onChange={(event) => updateForm('versionCode', event.target.value)}
                placeholder="3"
                disabled={!canManage}
                className="w-full rounded-xl border border-gray-200 bg-gray-50 px-3 py-2 text-gray-900 outline-none focus:ring-2 focus:ring-orange-500 disabled:opacity-60 dark:border-gray-700 dark:bg-gray-800 dark:text-white"
              />
            </label>
            <label className="space-y-1 text-sm sm:col-span-2">
              <span className="font-semibold text-gray-700 dark:text-gray-200">Update title</span>
              <input
                value={form.title}
                onChange={(event) => updateForm('title', event.target.value)}
                placeholder="DatSer Android update"
                disabled={!canManage}
                className="w-full rounded-xl border border-gray-200 bg-gray-50 px-3 py-2 text-gray-900 outline-none focus:ring-2 focus:ring-orange-500 disabled:opacity-60 dark:border-gray-700 dark:bg-gray-800 dark:text-white"
              />
            </label>
            <label className="space-y-1 text-sm sm:col-span-2">
              <span className="font-semibold text-gray-700 dark:text-gray-200">Short description / release notes</span>
              <textarea
                value={form.description}
                onChange={(event) => updateForm('description', event.target.value)}
                rows={3}
                placeholder="What changed in this APK?"
                disabled={!canManage}
                className="w-full rounded-xl border border-gray-200 bg-gray-50 px-3 py-2 text-gray-900 outline-none focus:ring-2 focus:ring-orange-500 disabled:opacity-60 dark:border-gray-700 dark:bg-gray-800 dark:text-white"
              />
            </label>
            <label className="space-y-1 text-sm sm:col-span-2">
              <span className="font-semibold text-gray-700 dark:text-gray-200">APK file</span>
              <input
                type="file"
                accept=".apk,application/vnd.android.package-archive"
                disabled={!canManage}
                onChange={(event) => updateForm('file', event.target.files?.[0] || null)}
                className="w-full rounded-xl border border-dashed border-gray-300 bg-gray-50 px-3 py-3 text-sm text-gray-700 file:mr-3 file:rounded-lg file:border-0 file:bg-orange-600 file:px-3 file:py-2 file:text-sm file:font-semibold file:text-white disabled:opacity-60 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-200"
              />
              {fileError && form.file && <p className="text-xs font-medium text-red-600 dark:text-red-300">{fileError}</p>}
            </label>
          </div>

          <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex flex-wrap gap-3">
              <label className="inline-flex items-center gap-2 text-sm font-semibold text-gray-700 dark:text-gray-200">
                <input
                  type="checkbox"
                  checked={form.forceUpdate}
                  onChange={(event) => updateForm('forceUpdate', event.target.checked)}
                  disabled={!canManage}
                  className="h-4 w-4 rounded border-gray-300 text-orange-600 focus:ring-orange-500"
                />
                Force update
              </label>
              <label className="inline-flex items-center gap-2 text-sm font-semibold text-gray-700 dark:text-gray-200">
                <input
                  type="checkbox"
                  checked={form.isActive}
                  onChange={(event) => updateForm('isActive', event.target.checked)}
                  disabled={!canManage}
                  className="h-4 w-4 rounded border-gray-300 text-orange-600 focus:ring-orange-500"
                />
                Publish now
              </label>
            </div>
            <button
              type="submit"
              disabled={!canSubmit}
              className="inline-flex min-h-[42px] items-center justify-center gap-2 rounded-xl bg-orange-600 px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-orange-700 disabled:cursor-not-allowed disabled:bg-orange-300"
            >
              {isSaving ? <RefreshCw className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
              {isSaving ? 'Uploading...' : 'Upload APK Release'}
            </button>
          </div>
        </form>

        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <h4 className="text-sm font-bold text-gray-900 dark:text-white">Release history</h4>
            <span className="text-xs text-gray-400">{releases.length} release{releases.length === 1 ? '' : 's'}</span>
          </div>

          {releases.length === 0 ? (
            <div className="rounded-xl border border-gray-200 bg-gray-50 p-4 text-sm text-gray-500 dark:border-gray-700 dark:bg-gray-900/40 dark:text-gray-400">
              No APK releases uploaded yet.
            </div>
          ) : (
            releases.map((release) => (
              <div key={release.id || release.apkUrl} className="rounded-xl border border-gray-200 bg-gray-50 p-3 dark:border-gray-700 dark:bg-gray-900/40">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="font-semibold text-gray-900 dark:text-white">
                        {release.versionName} ({release.versionCode})
                      </p>
                      <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-bold ${
                        release.isActive
                          ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-200'
                          : 'bg-gray-200 text-gray-600 dark:bg-gray-700 dark:text-gray-300'
                      }`}>
                        {release.isActive ? <CheckCircle2 className="h-3 w-3" /> : <EyeOff className="h-3 w-3" />}
                        {release.isActive ? 'Published' : 'Unpublished'}
                      </span>
                      {release.forceUpdate && (
                        <span className="inline-flex items-center gap-1 rounded-full bg-red-100 px-2 py-0.5 text-xs font-bold text-red-700 dark:bg-red-900/30 dark:text-red-200">
                          <AlertTriangle className="h-3 w-3" />
                          Force update
                        </span>
                      )}
                    </div>
                    <p className="mt-1 text-sm font-medium text-gray-700 dark:text-gray-200">{release.title}</p>
                    {release.description && (
                      <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">{release.description}</p>
                    )}
                    <p className="mt-2 text-xs text-gray-400">
                      Uploaded {release.createdAt ? new Date(release.createdAt).toLocaleString() : 'unknown'}
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-2 sm:justify-end">
                    <button
                      type="button"
                      onClick={() => openApkDownload(release.apkUrl)}
                      className="inline-flex items-center gap-1.5 rounded-lg border border-orange-200 bg-white px-3 py-2 text-xs font-semibold text-orange-700 hover:bg-orange-50 dark:border-orange-900/50 dark:bg-gray-800 dark:text-orange-200"
                    >
                      <Download className="h-3.5 w-3.5" />
                      APK
                    </button>
                    {canManage && (
                      <button
                        type="button"
                        onClick={() => toggleRelease(release)}
                        className="inline-flex items-center gap-1.5 rounded-lg border border-gray-200 bg-white px-3 py-2 text-xs font-semibold text-gray-700 hover:bg-gray-50 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-200"
                      >
                        {release.isActive ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                        {release.isActive ? 'Unpublish' : 'Publish'}
                      </button>
                    )}
                  </div>
                </div>
              </div>
            ))
          )}
        </div>
          </div>
        </div>
      </div>
    </div>
  )
}

export default AppUpdatesManager
