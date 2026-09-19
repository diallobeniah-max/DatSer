import { useEffect, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../context/AuthContext'
import { useApp } from '../../context/AppContext'
import { isMemberV2LocalExperimentEnabled } from './memberV2FeatureFlag'
import { getRealDatserMemberV2Connectivity } from './realDatserConnectivity'
import { getRealMemberV2UiAdapter } from './realMemberUiAdapter'

const initialState = { pendingChanges: 0, state: 'STARTING', updatedAt: null }

// Intentionally local-development only. It gives the POC operator an honest
// sync signal without exposing member data, credentials, or a second authority.
export default function RealMemberV2LocalDiagnostics() {
  const { user } = useAuth()
  const { dataOwnerId, offlineMode, isOnline, memberHydrationState } = useApp()
  const [syncState, setSyncState] = useState(initialState)
  const [diagnosticMessage, setDiagnosticMessage] = useState('')

  useEffect(() => {
    if (!isMemberV2LocalExperimentEnabled() || !user?.id) return undefined
    const ownerId = dataOwnerId || user.id
    let cancelled = false
    let timer = null

    const refresh = async () => {
      try {
        const adapter = await getRealMemberV2UiAdapter({ supabase, userId: user.id, ownerId })
        const next = await adapter.refreshGuard()
        if (!cancelled) setSyncState(next)
      } catch (error) {
        if (!cancelled) setSyncState((current) => ({ ...current, state: 'FAILED_RETRYABLE', lastError: error?.message || 'Unable to read local Member V2 state.' }))
      }
    }

    void refresh()
    const connectivity = getRealDatserMemberV2Connectivity()
    const unsubscribe = connectivity.subscribe(() => { void refresh() })
    timer = window.setInterval(() => { void refresh() }, 500)
    return () => {
      cancelled = true
      unsubscribe()
      window.clearInterval(timer)
    }
  }, [dataOwnerId, isOnline, memberHydrationState, offlineMode, user?.id])

  if (!isMemberV2LocalExperimentEnabled()) return null
  const connectivity = getRealDatserMemberV2Connectivity().getState() === 'ONLINE' ? 'ONLINE' : 'OFFLINE'
  const lastConfirmation = syncState.pendingChanges === 0 && syncState.updatedAt
    ? new Date(syncState.updatedAt).toLocaleTimeString()
    : 'Pending confirmation'

  const copySafeDiagnostics = async () => {
    try {
      const ownerId = dataOwnerId || user?.id
      const adapter = await getRealMemberV2UiAdapter({ supabase, userId: user?.id, ownerId })
      const diagnostic = await adapter.getSafeSyncDiagnostics()
      if (!navigator.clipboard?.writeText) throw new Error('Clipboard access is unavailable on this device.')
      await navigator.clipboard.writeText(JSON.stringify(diagnostic, null, 2))
      setDiagnosticMessage('Safe local sync diagnostics copied. It excludes profiles, passwords, tokens, and mutation payloads.')
    } catch (error) {
      setDiagnosticMessage(error?.message || 'Could not copy local sync diagnostics.')
    }
  }

  return (
    <section data-testid="member-v2-local-diagnostics" className="mx-3 mb-3 rounded-xl border border-dashed border-emerald-400/70 bg-emerald-50/60 px-3 py-2 text-[11px] text-emerald-950 dark:border-emerald-700 dark:bg-emerald-950/20 dark:text-emerald-100">
      <div className="font-bold uppercase tracking-wide">Member V2 local diagnostics</div>
      <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1">
        <span>Member V2: ENABLED</span>
        <span>Connectivity: {connectivity}</span>
        <span>Member mutations pending: {syncState.pendingChanges || 0}</span>
        <span>Sync state: {syncState.state || 'STARTING'}</span>
        <span>Last server confirmation: {lastConfirmation}</span>
      </div>
      <button type="button" className="mt-2 rounded border border-emerald-500/70 px-2 py-1 font-semibold" onClick={() => void copySafeDiagnostics()}>Copy safe sync diagnostics</button>
      {diagnosticMessage && <p className="mt-1">{diagnosticMessage}</p>}
    </section>
  )
}
