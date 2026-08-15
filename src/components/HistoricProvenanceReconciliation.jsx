import React, { useCallback, useEffect, useMemo, useState } from 'react'
import { AlertTriangle, CheckCircle2, RefreshCw, Shield } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { groupHistoricProvenanceReview } from '../services/historicMemberProvenanceReview'
import { toast } from 'react-toastify'

const HistoricProvenanceReconciliation = ({ onBack }) => {
  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(true)
  const [savingId, setSavingId] = useState(null)
  const [workspaceByMember, setWorkspaceByMember] = useState({})

  const load = useCallback(async () => {
    setLoading(true)
    const { data, error } = await supabase.rpc('get_historic_member_provenance_review')
    if (error) toast.error('This account is not authorized for historic reconciliation.')
    else setRows(Array.isArray(data) ? data : [])
    setLoading(false)
  }, [])
  useEffect(() => { load() }, [load])
  const members = useMemo(() => groupHistoricProvenanceReview(rows), [rows])
  const save = async (member) => {
    if (member.reason === 'AMBIGUOUS') return
    const workspaceId = workspaceByMember[member.memberId]
    if (!workspaceId) return
    setSavingId(member.memberId)
    const { error } = await supabase.rpc('record_workspace_member_provenance_override', {
      p_member_id: member.memberId, p_workspace_owner_id: workspaceId, p_note: null, p_reconciliation_version: 1
    })
    if (error) toast.error(error.message || 'Confirmation could not be recorded.')
    else { toast.success('Workspace confirmed.'); await load() }
    setSavingId(null)
  }
  const resolved = 312 - members.length
  return <section className="mx-auto max-w-4xl p-4 sm:p-6">
    <div className="mb-6 flex items-start justify-between gap-4"><div><h1 className="text-xl font-black text-gray-900 dark:text-white">Historic Member Workspace Reconciliation</h1><p className="mt-1 text-sm text-gray-600 dark:text-gray-300">Operator-only maintenance. Nothing changes until you confirm a workspace.</p></div><button onClick={onBack} className="rounded-lg px-3 py-2 text-sm font-semibold">Back</button></div>
    <div className="mb-5 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900 dark:border-amber-900/50 dark:bg-amber-950/30 dark:text-amber-100"><Shield className="mr-2 inline h-4 w-4"/>Resolved {resolved} / 312 unique members. The 20 ambiguous identities require separate identity repair and cannot be assigned here.</div>
    {loading ? <p className="text-sm text-gray-500">Loading reconciliation queue…</p> : <div className="space-y-3">{members.map((member) => <article key={member.memberId} className="rounded-xl border border-gray-200 bg-white p-4 dark:border-gray-700 dark:bg-gray-900"><div className="flex flex-wrap items-start justify-between gap-3"><div><p className="font-bold text-gray-900 dark:text-white">{member.displayName}</p><p className="text-xs text-gray-500">{member.phoneHint} {member.memberCode ? `· ${member.memberCode}` : ''} · {member.months.join(', ')} · {member.rowInstances} rows</p><p className="mt-1 text-xs font-bold text-amber-700 dark:text-amber-300">{member.reason === 'AMBIGUOUS' ? 'Identity conflict — do not assign all copies; use the identity-repair runbook' : 'Unmapped — operator confirmation required'}</p></div><AlertTriangle className="h-5 w-5 text-amber-500"/></div><div className="mt-3 flex flex-wrap gap-2">{member.candidateWorkspaceIds.map((id) => <span key={id} className="rounded-lg border border-amber-300 px-3 py-2 text-xs">Trusted candidate {String(id).slice(0, 8)}…</span>)}</div>{member.reason === 'UNMAPPED' && <label className="mt-3 block text-xs text-gray-500">Verified workspace owner UUID<input value={workspaceByMember[member.memberId] || ''} onChange={(event) => setWorkspaceByMember((old) => ({ ...old, [member.memberId]: event.target.value.trim() }))} className="mt-1 block w-full rounded-lg border border-gray-300 px-3 py-2 text-sm" placeholder="Paste verified owner UUID" /></label>}{member.reason === 'UNMAPPED' && <button disabled={!workspaceByMember[member.memberId] || savingId === member.memberId} onClick={() => save(member)} className="mt-3 inline-flex items-center gap-2 rounded-lg bg-orange-600 px-3 py-2 text-sm font-bold text-white disabled:opacity-50"><CheckCircle2 className="h-4 w-4"/>Confirm Workspace</button>}</article>)}</div>}
    <button onClick={load} className="mt-6 inline-flex items-center gap-2 text-sm font-semibold"><RefreshCw className="h-4 w-4"/>Validate Reconciliation</button>
  </section>
}
export default HistoricProvenanceReconciliation
