import { useEffect, useRef, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { createMemberService } from '../../services/member-v2/MemberService'
import { MEMBER_CONFLICT_OPERATIONS } from '../../services/member-v2/memberConflict'
import { createLocalMemberV2SupabaseClient } from './data/createLocalMemberV2SupabaseClient'
import './member-v2.css'

const supabase = createLocalMemberV2SupabaseClient()

function MemberV2Demo() {
  const [service, setService] = useState(null); const [members, setMembers] = useState([]); const [sync, setSync] = useState({ state: 'SIGN_IN_REQUIRED' }); const [message, setMessage] = useState('Local-only demo. Sign in to local Supabase, then choose an authorized workspace owner.')
  const [form, setForm] = useState({ email: '', password: '', ownerId: '', fullName: '' }); const resource = useRef(null)
  const close = async () => { await resource.current?.unsubscribe?.(); await resource.current?.service?.stop(); resource.current = null; setService(null); setMembers([]) }
  useEffect(() => () => { void close() }, [])
  const open = async (userId, ownerId) => {
    await close(); const next = await createMemberService({ supabase, userId, ownerId }); await next.start()
    const subscription = next.observeMembers().subscribe((rows) => setMembers(rows.map((row) => row.toJSON())))
    resource.current = { service: next, unsubscribe: () => subscription.unsubscribe() }; setService(next); setSync(await next.getSyncState()); setMessage(navigator.onLine ? 'Connected to local Supabase. RxDB is the visible local authority.' : 'Offline. Durable Member V2 data is available on this device.')
  }
  const signIn = async (event) => { event.preventDefault(); setMessage('Authenticating…'); const { data, error } = await supabase.auth.signInWithPassword({ email: form.email, password: form.password }); if (error) return setMessage(error.message); try { await open(data.user.id, form.ownerId); } catch (openError) { setMessage(openError.message) } }
  const add = async (event) => { event.preventDefault(); try { await service.createMember({ tableName: form.tableName, member: { full_name: form.fullName } }); setForm({ ...form, fullName: '' }); setSync(await service.getSyncState()) } catch (error) { setMessage(error.message) } }
  const edit = async (member) => { const fullName = window.prompt('New member name', member.data['Full Name'] || ''); if (!fullName?.trim()) return; try { await service.updateMember(member.id, { full_name: fullName }); setSync(await service.getSyncState()) } catch (error) { setMessage(error.message) } }
  const syncNow = async () => { setSync(await service.syncNow()); setMessage('Sync finished. Server-confirmed data and pending local changes are shown separately.') }
  return <main><p className="eyebrow">Isolated Phase 1 client harness</p><h1>DatSer Member V2</h1><p data-testid="member-v2-message" className={sync.lastError ? 'error' : ''}>{message}</p>
    {!service ? <form onSubmit={signIn}><label>Email<input required type="email" value={form.email} onChange={(event) => setForm({ ...form, email: event.target.value })} /></label><label>Password<input required type="password" value={form.password} onChange={(event) => setForm({ ...form, password: event.target.value })} /></label><label>Workspace owner UUID<input required value={form.ownerId} onChange={(event) => setForm({ ...form, ownerId: event.target.value })} /></label><button>Open local workspace</button></form> : <>
      <div className="toolbar"><span className="badge" data-testid="member-v2-sync-state">{sync.state}</span><span>Cursor: <code>{sync.cursor ?? 'none'}</code></span><span>Pending: {sync.pendingChanges || 0}</span><span>Conflicts: {sync.conflicts || 0}</span><button className="secondary" onClick={syncNow}>Sync now</button><button className="secondary" onClick={() => void close()}>Close local workspace</button></div>
      <form onSubmit={add}><label>Trusted month table<input required placeholder="December_2025" value={form.tableName || ''} onChange={(event) => setForm({ ...form, tableName: event.target.value })} /></label><label>New member<input required value={form.fullName} onChange={(event) => setForm({ ...form, fullName: event.target.value })} /></label><button>Save locally</button></form>
      <section><h2>Local members</h2>{members.map((member) => <article key={member.id} data-testid="member-v2-row"><div><strong>{member.data['Full Name'] || 'Unnamed member'}</strong><div><span className="badge">{member.save_state}</span> <code>{member.member_id}</code></div></div><div><button className="secondary" onClick={() => edit(member)}>Edit locally</button>{member.save_state === 'CONFLICT' && <button onClick={() => void service.resolveConflict(member.id, MEMBER_CONFLICT_OPERATIONS.USE_SERVER).then(async () => setSync(await service.getSyncState()))}>Use server</button>}</div></article>)}</section>
    </>}</main>
}

createRoot(document.getElementById('rxdb-member-v2-root')).render(<MemberV2Demo />)
