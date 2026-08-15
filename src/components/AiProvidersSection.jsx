import React, { useCallback, useEffect, useState } from 'react'
import { Cpu, Eye, EyeOff, KeyRound, Loader2, RefreshCw, Trash2, CheckCircle2, XCircle, ArrowRightLeft } from 'lucide-react'
import { useAuth } from '../context/AuthContext'
import { useApp } from '../context/AppContext'
import {
  PROVIDERS,
  fetchProviderStatus,
  setProviderSecret,
  testProviderConnection,
  removeProviderSecret,
  fetchRouting,
  saveRouting
} from '../services/aiProviders'

const DEFAULT_MODELS = {
  gemini: 'gemini-3.1-flash-lite',
  qwen: 'qwen-vl-plus'
}

const MODEL_OPTIONS = {
  gemini: ['gemini-3.1-flash-lite', 'gemini-3.1-pro', 'gemini-2.5-flash'],
  qwen: ['qwen-vl-plus', 'qwen-vl-max', 'qwen2.5-vl-72b-instruct']
}

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
  const good = status === 'connected' || status === 'configured'
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-bold ${entry.cls}`}>
      {good ? <CheckCircle2 className="h-3.5 w-3.5" /> : <XCircle className="h-3.5 w-3.5" />}
      {entry.text}
    </span>
  )
}

// One compact provider card. Props keep this generic so OpenAI can be added later
// without redesigning the page.
const PROVIDER_LABELS = {
  gemini: 'Gemini',
  qwen: 'Alibaba / Qwen'
}

const PROVIDER_DESCRIPTIONS = {
  gemini: 'Paper Scan image & handwriting extraction',
  qwen: 'Alternative Paper Scan extraction provider'
}

const RoutingBadge = ({ role }) => {
  if (!role) return null
  const cls = role === 'primary'
    ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300'
    : 'bg-sky-100 text-sky-700 dark:bg-sky-900/30 dark:text-sky-300'
  return (
    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-black uppercase tracking-wide ${cls}`}>
      {role}
    </span>
  )
}

// One compact provider card. Props keep this generic so OpenAI can be added later
// without redesigning the page.
const ProviderCard = ({
  provider,
  status,
  routingRole,
  busy,
  secret,
  showSecret,
  model,
  onSecretChange,
  onToggleSecret,
  onModelChange,
  onSave,
  onTest,
  onRemove,
  message,
  messageKind
}) => (
  <div className="rounded-xl border border-purple-200 bg-gradient-to-br from-purple-50 to-white p-4 dark:border-purple-800 dark:from-purple-950/20 dark:to-gray-900">
    <div className="flex flex-wrap items-start justify-between gap-2">
      <div>
        <div className="flex items-center gap-2">
          <span className="text-sm font-bold text-gray-900 dark:text-white">{PROVIDER_LABELS[provider] || provider}</span>
          <RoutingBadge role={routingRole} />
          <StatusBadge status={status?.status || 'not_configured'} />
        </div>
        <p className="mt-0.5 text-[11px] font-medium text-gray-500 dark:text-gray-400">
          {PROVIDER_DESCRIPTIONS[provider] || ''}
        </p>
      </div>
      {status?.configured ? (
        <span className="text-xs font-semibold text-gray-500 dark:text-gray-400">
          ••••••••••••••{status.maskedSuffix || '••••'}
        </span>
      ) : null}
    </div>

    <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2">
      <div>
        <label className="mb-1 block text-[11px] font-bold text-gray-700 dark:text-gray-300">API Key</label>
        <div className="relative">
          <input
            type={showSecret ? 'text' : 'password'}
            autoComplete="new-password"
            value={secret}
            onChange={onSecretChange}
            placeholder={status?.configured ? 'Paste a new key to replace' : 'Paste your API key'}
            className="w-full rounded-xl border border-gray-300 bg-white py-2 pl-3 pr-10 text-sm text-gray-900 outline-none transition-colors focus:border-purple-500 dark:border-gray-600 dark:bg-gray-900 dark:text-white"
          />
          <button
            type="button"
            onClick={onToggleSecret}
            aria-label={showSecret ? 'Hide key' : 'Show key'}
            className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 dark:hover:text-gray-200"
          >
            {showSecret ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
          </button>
        </div>
      </div>
      <div>
        <label className="mb-1 block text-[11px] font-bold text-gray-700 dark:text-gray-300">Model</label>
        <select
          value={model || DEFAULT_MODELS[provider] || ''}
          onChange={(event) => onModelChange(event.target.value)}
          className="w-full rounded-xl border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 outline-none transition-colors focus:border-purple-500 dark:border-gray-600 dark:bg-gray-900 dark:text-white"
        >
          {(MODEL_OPTIONS[provider] || []).map((option) => (
            <option key={option} value={option}>{option}</option>
          ))}
        </select>
      </div>
    </div>

    <div className="mt-3 flex flex-wrap items-center gap-2">
      <button
        type="button"
        disabled={busy || !secret.trim()}
        onClick={() => onSave()}
        className="inline-flex min-h-[40px] items-center gap-2 rounded-xl bg-purple-600 px-4 py-2 text-sm font-bold text-white transition-colors hover:bg-purple-700 disabled:cursor-not-allowed disabled:opacity-50"
      >
        {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <KeyRound className="h-4 w-4" />}
        Save
      </button>
      <button
        type="button"
        disabled={busy}
        onClick={() => onTest()}
        className="inline-flex min-h-[40px] items-center gap-2 rounded-xl border border-purple-300 bg-white px-4 py-2 text-sm font-bold text-purple-700 transition-colors hover:bg-purple-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-purple-700 dark:bg-purple-900/20 dark:text-purple-200"
      >
        <RefreshCw className="h-4 w-4" />
        Test
      </button>
      {status?.configured && (
        <button
          type="button"
          disabled={busy}
          onClick={() => onRemove()}
          className="inline-flex min-h-[40px] items-center gap-2 rounded-xl border border-red-300 bg-white px-4 py-2 text-sm font-bold text-red-600 transition-colors hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-red-800 dark:bg-red-900/20 dark:text-red-300"
        >
          <Trash2 className="h-4 w-4" />
          Remove
        </button>
      )}
    </div>

    {message && (
      <p className={`mt-2 rounded-lg px-3 py-2 text-xs font-semibold ${messageKind === 'error' ? 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300' : messageKind === 'success' ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300' : 'bg-amber-100 text-amber-800 dark:bg-amber-900/35 dark:text-amber-200'}`}>
        {message}
      </p>
    )}
  </div>
)

const AiProvidersSection = () => {
  const { user } = useAuth()
  const { dataOwnerId } = useApp() || {}
  const workspaceId = dataOwnerId || user?.id || ''
  const [bearerToken, setBearerToken] = useState('')
  const [statuses, setStatuses] = useState({})
  const [routing, setRouting] = useState({ primaryProvider: 'gemini', fallbackProvider: null })
  const [secrets, setSecrets] = useState({})
  const [showSecrets, setShowSecrets] = useState({})
  const [models, setModels] = useState({})
  const [busy, setBusy] = useState(false)
  const [messages, setMessages] = useState({}) // provider -> { text, kind }
  const [loading, setLoading] = useState(true)

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

  const loadStatuses = useCallback(async () => {
    if (!bearerToken || !workspaceId) return
    setLoading(true)
    try {
      const next = {}
      for (const provider of PROVIDERS) {
        try {
          next[provider] = await fetchProviderStatus({ bearerToken, workspaceId, provider })
        } catch {
          next[provider] = { provider, configured: false, status: 'not_configured' }
        }
      }
      setStatuses(next)
    } finally {
      setLoading(false)
    }
  }, [bearerToken, workspaceId])

  const loadRoutingPref = useCallback(async () => {
    if (!bearerToken || !workspaceId) return
    try {
      const result = await fetchRouting({ bearerToken, workspaceId })
      setRouting({ primaryProvider: result.primaryProvider || 'gemini', fallbackProvider: result.fallbackProvider || null })
    } catch {
      setRouting({ primaryProvider: 'gemini', fallbackProvider: null })
    }
  }, [bearerToken, workspaceId])

  useEffect(() => {
    if (bearerToken && workspaceId) {
      loadStatuses()
      loadRoutingPref()
    }
  }, [bearerToken, workspaceId, loadStatuses, loadRoutingPref])

  const flash = (provider, text, kind = 'info') => {
    setMessages((prev) => ({ ...prev, [provider]: { text, kind } }))
  }

  const handleSave = async (provider) => {
    const secret = (secrets[provider] || '').trim()
    if (!secret) { flash(provider, 'Enter an API key first.', 'error'); return }
    setBusy(true)
    try {
      await setProviderSecret({ bearerToken, workspaceId, provider, secret, model: models[provider] || DEFAULT_MODELS[provider] })
      setSecrets((prev) => ({ ...prev, [provider]: '' }))
      flash(provider, 'Key saved.', 'success')
      await loadStatuses()
    } catch (error) {
      flash(provider, error?.message || 'Could not save the key.', 'error')
    } finally {
      setBusy(false)
    }
  }

  const handleTest = async (provider) => {
    setBusy(true)
    try {
      const tested = await testProviderConnection({
        bearerToken,
        workspaceId,
        provider,
        secret: (secrets[provider] || '').trim(),
        model: models[provider] || DEFAULT_MODELS[provider]
      })
      if (tested?.status === 'connected') {
        flash(provider, 'Connected.', 'success')
      } else {
        flash(provider, tested?.error || `Test result: ${tested?.status || 'unknown'}`, 'warning')
      }
    } catch (error) {
      flash(provider, error?.message || 'Could not test the provider.', 'error')
    } finally {
      setBusy(false)
    }
  }

  const handleRemove = async (provider) => {
    if (!window.confirm(`Remove the stored ${PROVIDER_LABELS[provider]} API key? Future extractions will report Not Configured until a new key is saved.`)) return
    setBusy(true)
    try {
      await removeProviderSecret({ bearerToken, workspaceId, provider })
      setSecrets((prev) => ({ ...prev, [provider]: '' }))
      flash(provider, 'Key removed.', 'success')
      await loadStatuses()
    } catch (error) {
      flash(provider, error?.message || 'Could not remove the key.', 'error')
    } finally {
      setBusy(false)
    }
  }

  const handleSaveRouting = async () => {
    setBusy(true)
    try {
      const result = await saveRouting({
        bearerToken,
        workspaceId,
        primary: routing.primaryProvider,
        fallback: routing.fallbackProvider
      })
      setRouting({ primaryProvider: result.primaryProvider, fallbackProvider: result.fallbackProvider || null })
      flash('routing', 'Extraction routing saved.', 'success')
    } catch (error) {
      flash('routing', error?.message || 'Could not save routing.', 'error')
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="overflow-hidden rounded-2xl border border-purple-200 bg-white shadow-sm dark:border-purple-900/60 dark:bg-gray-800" aria-labelledby="ai-providers-title">
      <div className="border-b border-purple-100 bg-purple-50/70 px-4 py-4 dark:border-purple-900/40 dark:bg-purple-950/20 sm:px-5">
        <div className="flex flex-wrap items-center gap-2">
          <div className="grid h-9 w-9 place-items-center rounded-xl bg-purple-600 text-white"><Cpu className="h-4 w-4" /></div>
          <div className="min-w-0">
            <h4 id="ai-providers-title" className="font-semibold text-gray-900 dark:text-white">AI Providers</h4>
            <p className="text-xs text-gray-600 dark:text-gray-300">Choose a provider, paste your API key, save, and test. Keys are encrypted server-side and never stored in the browser.</p>
          </div>
        </div>
      </div>

      <div className="space-y-5 p-4 sm:p-5">
        {loading ? (
          <p className="flex items-center gap-2 text-xs text-gray-500 dark:text-gray-400"><Loader2 className="h-3.5 w-3.5 animate-spin" /> Loading provider status…</p>
        ) : (
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            {PROVIDERS.map((provider) => (
              <ProviderCard
                key={provider}
                provider={provider}
                status={statuses[provider]}
                routingRole={provider === routing.primaryProvider ? 'primary' : (provider === routing.fallbackProvider ? 'fallback' : null)}
                busy={busy}
                secret={secrets[provider] || ''}
                showSecret={showSecrets[provider]}
                model={models[provider] || statuses[provider]?.model || DEFAULT_MODELS[provider] || ''}
                onSecretChange={(event) => setSecrets((prev) => ({ ...prev, [provider]: event.target.value }))}
                onToggleSecret={() => setShowSecrets((prev) => ({ ...prev, [provider]: !prev[provider] }))}
                onModelChange={(value) => setModels((prev) => ({ ...prev, [provider]: value }))}
                onSave={() => handleSave(provider)}
                onTest={() => handleTest(provider)}
                onRemove={() => handleRemove(provider)}
                message={messages[provider]?.text}
                messageKind={messages[provider]?.kind}
              />
            ))}
          </div>
        )}

        <div className="rounded-xl border border-indigo-200 bg-gradient-to-br from-indigo-50 to-white p-4 dark:border-indigo-800 dark:from-indigo-950/20 dark:to-gray-900">
          <div className="flex items-center gap-2">
            <ArrowRightLeft className="h-4 w-4 text-indigo-600" />
            <p className="text-sm font-bold text-gray-900 dark:text-white">Extraction routing</p>
          </div>
          <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div>
              <label className="mb-1 block text-[11px] font-bold text-gray-700 dark:text-gray-300">Primary provider</label>
              <select
                value={routing.primaryProvider}
                onChange={(event) => setRouting((prev) => ({ ...prev, primaryProvider: event.target.value }))}
                className="w-full rounded-xl border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 outline-none focus:border-indigo-500 dark:border-gray-600 dark:bg-gray-900 dark:text-white"
              >
                {PROVIDERS.map((provider) => (
                  <option key={provider} value={provider}>{PROVIDER_LABELS[provider]}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="mb-1 block text-[11px] font-bold text-gray-700 dark:text-gray-300">Fallback provider</label>
              <select
                value={routing.fallbackProvider || ''}
                onChange={(event) => setRouting((prev) => ({ ...prev, fallbackProvider: event.target.value || null }))}
                className="w-full rounded-xl border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 outline-none focus:border-indigo-500 dark:border-gray-600 dark:bg-gray-900 dark:text-white"
              >
                <option value="">No fallback</option>
                {PROVIDERS.map((provider) => (
                  <option key={provider} value={provider}>{PROVIDER_LABELS[provider]}</option>
                ))}
              </select>
            </div>
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <button
              type="button"
              disabled={busy}
              onClick={handleSaveRouting}
              className="inline-flex min-h-[40px] items-center gap-2 rounded-xl bg-indigo-600 px-4 py-2 text-sm font-bold text-white transition-colors hover:bg-indigo-700 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <KeyRound className="h-4 w-4" />}
              Save routing
            </button>
            {messages.routing?.text ? (
              <p className={`rounded-lg px-3 py-2 text-xs font-semibold ${messages.routing.kind === 'error' ? 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300' : messages.routing.kind === 'success' ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300' : 'bg-amber-100 text-amber-800 dark:bg-amber-900/35 dark:text-amber-200'}`}>
                {messages.routing.text}
              </p>
            ) : null}
          </div>
          <p className="mt-2 text-[11px] leading-5 text-gray-500 dark:text-gray-400">
            When the primary provider fails with a temporary error (rate limit, quota, timeout), DatSer tries the fallback. Permanent errors like an invalid key stop and explain instead.
          </p>
        </div>

        <p className="text-[11px] leading-5 text-gray-500 dark:text-gray-400">
          Only a workspace administrator/owner can manage AI provider keys and routing. When no stored key exists for a provider, the server environment variable is used as a fallback for existing deployments.
        </p>
      </div>
    </section>
  )
}

export default AiProvidersSection
