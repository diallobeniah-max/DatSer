import React, { useCallback, useEffect, useState } from 'react'
import { Cpu, Eye, EyeOff, KeyRound, Loader2, RefreshCw, Trash2, CheckCircle2, XCircle } from 'lucide-react'
import { useAuth } from '../context/AuthContext'
import { useApp } from '../context/AppContext'
import {
  fetchProviderStatus,
  setProviderSecret,
  testProviderConnection,
  removeProviderSecret
} from '../services/aiProviders'

const PROVIDER_LABELS = { gemini: 'Gemini' }
const MODEL_LABEL = 'gemini-3.1-flash-lite'

const StatusBadge = ({ status }) => {
  const map = {
    connected: { text: 'Connected', cls: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300' },
    configured: { text: 'Configured', cls: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300' },
    not_configured: { text: 'Not configured', cls: 'bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-300' },
    invalid_key: { text: 'Error', cls: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300' },
    quota_unavailable: { text: 'Quota unavailable', cls: 'bg-amber-100 text-amber-800 dark:bg-amber-900/35 dark:text-amber-200' },
    provider_unavailable: { text: 'Provider unavailable', cls: 'bg-amber-100 text-amber-800 dark:bg-amber-900/35 dark:text-amber-200' }
  }
  const entry = map[status] || { text: status, cls: 'bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-300' }
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-bold ${entry.cls}`}>
      {status === 'connected' || status === 'configured' ? <CheckCircle2 className="h-3.5 w-3.5" /> : <XCircle className="h-3.5 w-3.5" />}
      {entry.text}
    </span>
  )
}

const AiProvidersSection = () => {
  const { user } = useAuth()
  const { dataOwnerId } = useApp() || {}
  const workspaceId = dataOwnerId || user?.id || ''
  const [bearerToken, setBearerToken] = useState('')
  const [status, setStatus] = useState(null)
  const [statusLoading, setStatusLoading] = useState(true)
  const [statusError, setStatusError] = useState('')
  const [secret, setSecret] = useState('')
  const [showSecret, setShowSecret] = useState(false)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const [messageKind, setMessageKind] = useState('info')

  useEffect(() => {
    let cancelled = false
    const loadSession = async () => {
      try {
        const { supabase } = await import('../lib/supabase')
        const { data } = await supabase.auth.getSession()
        if (!cancelled) setBearerToken(data?.session?.access_token || '')
      } catch { /* ignore */ }
    }
    loadSession()
    return () => { cancelled = true }
  }, [])

  const loadStatus = useCallback(async () => {
    if (!bearerToken || !workspaceId) return
    setStatusLoading(true)
    setStatusError('')
    try {
      const result = await fetchProviderStatus({ bearerToken, workspaceId, provider: 'gemini' })
      setStatus(result)
    } catch (error) {
      setStatusError(error?.message || 'Could not load provider status.')
      setStatus(null)
    } finally {
      setStatusLoading(false)
    }
  }, [bearerToken, workspaceId])

  useEffect(() => {
    if (bearerToken && workspaceId) loadStatus()
  }, [bearerToken, workspaceId, loadStatus])

  const flash = (text, kind = 'info') => {
    setMessage(text)
    setMessageKind(kind)
  }

  const handleSaveAndTest = async () => {
    if (!secret.trim()) { flash('Enter a Gemini API key first.', 'error'); return }
    setBusy(true)
    try {
      const saved = await setProviderSecret({ bearerToken, workspaceId, provider: 'gemini', secret })
      const tested = await testProviderConnection({ bearerToken, workspaceId, provider: 'gemini' })
      setSecret('')
      setStatus(saved)
      if (tested?.status === 'connected') {
        flash('Key saved and Gemini connection verified.', 'success')
      } else {
        flash(`Key saved. Test: ${tested?.status || 'unknown'}`, 'warning')
      }
    } catch (error) {
      flash(error?.message || 'Could not save the key.', 'error')
    } finally {
      setBusy(false)
      await loadStatus()
    }
  }

  const handleTest = async () => {
    setBusy(true)
    try {
      const tested = await testProviderConnection({ bearerToken, workspaceId, provider: 'gemini', secret: secret.trim() })
      if (tested?.status === 'connected') {
        flash('Connected — Gemini is reachable with this credential.', 'success')
      } else {
        flash(tested?.error || `Test result: ${tested?.status || 'unknown'}`, 'warning')
      }
    } catch (error) {
      flash(error?.message || 'Could not test the provider.', 'error')
    } finally {
      setBusy(false)
      await loadStatus()
    }
  }

  const handleRemove = async () => {
    if (!window.confirm('Remove the stored Gemini API key? Future extractions will report Not Configured until a new key is saved.')) return
    setBusy(true)
    try {
      const removed = await removeProviderSecret({ bearerToken, workspaceId, provider: 'gemini' })
      setStatus(removed)
      setSecret('')
      flash('Gemini API key removed.', 'success')
    } catch (error) {
      flash(error?.message || 'Could not remove the key.', 'error')
    } finally {
      setBusy(false)
      await loadStatus()
    }
  }

  const configured = status?.configured === true

  return (
    <section className="overflow-hidden rounded-2xl border border-purple-200 bg-white shadow-sm dark:border-purple-900/60 dark:bg-gray-800" aria-labelledby="ai-providers-title">
      <div className="border-b border-purple-100 bg-purple-50/70 px-4 py-4 dark:border-purple-900/40 dark:bg-purple-950/20 sm:px-5">
        <div className="flex flex-wrap items-center gap-2">
          <div className="grid h-9 w-9 place-items-center rounded-xl bg-purple-600 text-white"><Cpu className="h-4 w-4" /></div>
          <div className="min-w-0">
            <h4 id="ai-providers-title" className="font-semibold text-gray-900 dark:text-white">AI Providers</h4>
            <p className="text-xs text-gray-600 dark:text-gray-300">Server-side credentials for Paper Scan extraction. Keys are encrypted at rest and never stored in the browser.</p>
          </div>
        </div>
      </div>

      <div className="space-y-5 p-4 sm:p-5">
        <div className="rounded-xl border border-purple-200 bg-gradient-to-br from-purple-50 to-white p-4 dark:border-purple-800 dark:from-purple-950/20 dark:to-gray-900">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <span className="text-sm font-bold text-gray-900 dark:text-white">{PROVIDER_LABELS.gemini}</span>
              <StatusBadge status={status?.status || (statusLoading ? 'not_configured' : 'not_configured')} />
            </div>
            <div className="flex items-center gap-2 text-xs text-gray-500 dark:text-gray-400">
              <span>Model: {MODEL_LABEL}</span>
            </div>
          </div>

          {statusLoading ? (
            <p className="mt-3 flex items-center gap-2 text-xs text-gray-500 dark:text-gray-400"><Loader2 className="h-3.5 w-3.5 animate-spin" /> Loading provider status…</p>
          ) : statusError ? (
            <p className="mt-3 text-xs font-semibold text-red-600 dark:text-red-400">{statusError}</p>
          ) : (
            <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-3">
              <div className="rounded-xl border border-gray-200 bg-gray-50 p-3 dark:border-gray-700 dark:bg-gray-900/40">
                <p className="text-[11px] font-bold uppercase tracking-wide text-gray-500 dark:text-gray-400">API Key</p>
                <p className="mt-1 text-sm font-semibold text-gray-900 dark:text-white">
                  {configured ? `••••••••••••••${status.maskedSuffix || '••••'}` : 'Not configured'}
                </p>
              </div>
              <div className="rounded-xl border border-gray-200 bg-gray-50 p-3 dark:border-gray-700 dark:bg-gray-900/40">
                <p className="text-[11px] font-bold uppercase tracking-wide text-gray-500 dark:text-gray-400">Last verified</p>
                <p className="mt-1 text-sm font-semibold text-gray-900 dark:text-white">
                  {status?.lastVerified ? new Date(status.lastVerified).toLocaleString() : 'Never'}
                </p>
              </div>
              <div className="rounded-xl border border-gray-200 bg-gray-50 p-3 dark:border-gray-700 dark:bg-gray-900/40">
                <p className="text-[11px] font-bold uppercase tracking-wide text-gray-500 dark:text-gray-400">Storage</p>
                <p className="mt-1 text-sm font-semibold text-gray-900 dark:text-white">Encrypted server-side</p>
              </div>
            </div>
          )}

          <div className="mt-4 space-y-3">
            <div>
              <label htmlFor="ai-gemini-key" className="mb-1 block text-xs font-bold text-gray-700 dark:text-gray-300">
                {configured ? 'Replace Gemini API Key' : 'Gemini API Key'}
              </label>
              <div className="relative">
                <input
                  id="ai-gemini-key"
                  type={showSecret ? 'text' : 'password'}
                  autoComplete="new-password"
                  value={secret}
                  onChange={(event) => setSecret(event.target.value)}
                  placeholder={configured ? 'Paste a new key to replace the stored one' : 'Paste your Gemini API key'}
                  className="w-full rounded-xl border border-gray-300 bg-white py-2 pl-3 pr-10 text-sm text-gray-900 outline-none transition-colors focus:border-purple-500 dark:border-gray-600 dark:bg-gray-900 dark:text-white"
                />
                <button
                  type="button"
                  onClick={() => setShowSecret((open) => !open)}
                  aria-label={showSecret ? 'Hide key' : 'Show key'}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 dark:hover:text-gray-200"
                >
                  {showSecret ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
              <p className="mt-1 text-[11px] text-gray-500 dark:text-gray-400">The key is transmitted once over HTTPS and stored encrypted server-side. The full value is never shown again.</p>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                disabled={busy || !secret.trim()}
                onClick={handleSaveAndTest}
                className="inline-flex min-h-[40px] items-center gap-2 rounded-xl bg-purple-600 px-4 py-2 text-sm font-bold text-white transition-colors hover:bg-purple-700 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <KeyRound className="h-4 w-4" />}
                {configured ? 'Replace & Test' : 'Save & Test'}
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={handleTest}
                className="inline-flex min-h-[40px] items-center gap-2 rounded-xl border border-purple-300 bg-white px-4 py-2 text-sm font-bold text-purple-700 transition-colors hover:bg-purple-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-purple-700 dark:bg-purple-900/20 dark:text-purple-200"
              >
                <RefreshCw className="h-4 w-4" />
                Test Connection
              </button>
              {configured && (
                <button
                  type="button"
                  disabled={busy}
                  onClick={handleRemove}
                  className="inline-flex min-h-[40px] items-center gap-2 rounded-xl border border-red-300 bg-white px-4 py-2 text-sm font-bold text-red-600 transition-colors hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-red-800 dark:bg-red-900/20 dark:text-red-300"
                >
                  <Trash2 className="h-4 w-4" />
                  Remove Key
                </button>
              )}
            </div>

            {message && (
              <p className={`rounded-lg px-3 py-2 text-xs font-semibold ${messageKind === 'error' ? 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300' : messageKind === 'success' ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300' : 'bg-amber-100 text-amber-800 dark:bg-amber-900/35 dark:text-amber-200'}`}>
                {message}
              </p>
            )}
          </div>
        </div>

        <p className="text-[11px] leading-5 text-gray-500 dark:text-gray-400">
          Only a workspace administrator/owner can manage AI provider keys. When no stored key exists, extraction falls back to the
          server&apos;s GEMINI_API_KEY environment variable for existing deployments.
        </p>
      </div>
    </section>
  )
}

export default AiProvidersSection
