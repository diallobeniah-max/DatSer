import { useEffect, useRef, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { createLocalPocSupabaseClient } from './data/createLocalPocSupabaseClient'
import { createPocDatabase } from './rxdb/database/createPocDatabase'
import { startPocReplication } from './rxdb/replication/supabaseReplication'
import { createLocalMember, updateLocalMember } from './services/members/memberMutations'
import { clearLocalAttendance, setLocalAttendance } from './services/attendance/attendanceMutations'
import './poc.css'

const loginSchema = z.object({ email: z.string().email(), password: z.string().min(8), workspaceId: z.string().uuid() })
const memberSchema = z.object({ fullName: z.string().trim().min(2).max(160) })
const supabase = createLocalPocSupabaseClient()

function PocApp() {
  const [database, setDatabase] = useState(null)
  const [members, setMembers] = useState([])
  const [attendance, setAttendance] = useState([])
  const [message, setMessage] = useState('Sign in to local Supabase.')
  const [signalCounts, setSignalCounts] = useState({ members: 0, attendance: 0 })
  const workspaceRef = useRef(null)
  const resources = useRef([])
  const openingRef = useRef(false)
  const login = useForm({ resolver: zodResolver(loginSchema) })
  const member = useForm({ resolver: zodResolver(memberSchema) })

  const close = async () => {
    for (const resource of resources.current.splice(0)) await resource.cancel?.()
    if (database) await database.close()
    setDatabase(null); setMembers([]); setAttendance([])
  }
  const openWorkspace = async (userId, workspaceId) => {
    if (openingRef.current) return
    openingRef.current = true
    try {
      const db = await createPocDatabase({ userId, workspaceId })
      workspaceRef.current = workspaceId; setDatabase(db); localStorage.setItem('datser-rxdb-poc-workspace', workspaceId)
      resources.current.push(
        startPocReplication({ collection: db.members, supabase, workspaceId, entity: 'members', onRealtimeSignal: (entity) => setSignalCounts((counts) => ({ ...counts, [entity]: counts[entity] + 1 })) }),
        startPocReplication({ collection: db.attendance, supabase, workspaceId, entity: 'attendance', onRealtimeSignal: (entity) => setSignalCounts((counts) => ({ ...counts, [entity]: counts[entity] + 1 })) })
      )
      const memberSubscription = db.members.find().$.subscribe(setMembers)
      const attendanceSubscription = db.attendance.find({ selector: { is_deleted: false } }).$.subscribe(setAttendance)
      resources.current.push({ cancel: () => memberSubscription.unsubscribe() }, { cancel: () => attendanceSubscription.unsubscribe() })
      await Promise.all(resources.current.slice(0, 2).map((item) => Promise.all([item.ready, item.replicationState.awaitInitialReplication()])))
      setMessage(navigator.onLine ? 'Local Supabase authenticated · replication active' : 'Offline · RxDB data available')
    } finally { openingRef.current = false }
  }
  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => { const workspaceId = localStorage.getItem('datser-rxdb-poc-workspace'); if (data.session?.user && workspaceId) openWorkspace(data.session.user.id, workspaceId) })
    return () => { resources.current.forEach((resource) => resource.cancel?.()) }
  }, [])

  const signIn = login.handleSubmit(async ({ email, password, workspaceId }) => {
    setMessage('Authenticating…')
    const { data, error } = await supabase.auth.signInWithPassword({ email, password })
    if (error) return setMessage(error.message)
    await supabase.realtime.setAuth(data.session.access_token)
    const access = await supabase.from('poc_workspaces').select('id').eq('id', workspaceId).maybeSingle()
    if (access.error || !access.data) { await supabase.auth.signOut(); return setMessage('Workspace access denied.') }
    await openWorkspace(data.user.id, workspaceId)
  })

  const addMember = member.handleSubmit(async ({ fullName }) => {
    await createLocalMember(database.members, { workspaceId: workspaceRef.current, fullName })
    member.reset(); setMessage(navigator.onLine ? 'Saved locally; awaiting backend acknowledgement.' : 'Offline change saved locally.')
  })
  const editMember = async (row) => { const fullName = window.prompt('New synthetic member name', row.full_name); if (fullName?.trim()) await updateLocalMember(row, { fullName }) }
  const mark = async (row, status) => setLocalAttendance(database.attendance, { workspaceId: workspaceRef.current, memberId: row.id, attendanceDate: '2026-09-06', status })
  const clear = async (row) => clearLocalAttendance(database.attendance, { workspaceId: workspaceRef.current, memberId: row.id, attendanceDate: '2026-09-06' })
  const signOut = async () => { await close(); localStorage.removeItem('datser-rxdb-poc-workspace'); await supabase.auth.signOut(); setMessage('Signed out from local POC.') }

  return <main><p className="eyebrow">Isolated local experiment</p><h1>DatSer RxDB backend POC</h1><p data-testid="connection-state">{message}</p>{database && <p>Realtime signals: members <span data-testid="member-signal-count">{signalCounts.members}</span>, attendance <span data-testid="attendance-signal-count">{signalCounts.attendance}</span></p>}
    {!database ? <form onSubmit={signIn}><label>Email<input {...login.register('email')} /></label><label>Password<input type="password" {...login.register('password')} /></label><label>Workspace ID<input {...login.register('workspaceId')} /></label><button>Sign in locally</button></form>
      : <><div className="toolbar"><strong>RxDB is the UI authority</strong><button onClick={signOut}>Sign out</button></div><form onSubmit={addMember}><label>Member name<input {...member.register('fullName')} placeholder="Add a synthetic member" /></label><button>Save locally</button></form><section><h2>Members</h2>{members.map((row) => <article key={row.id} data-member-id={row.id}><div><strong>{row.full_name}</strong><span data-testid="save-state">{row.save_state}</span></div><div className="actions"><button onClick={() => editMember(row)}>Edit</button><button onClick={() => mark(row, 'present')}>Present</button><button onClick={() => mark(row, 'absent')}>Absent</button><button onClick={() => clear(row)}>Clear</button></div></article>)}</section><p>{attendance.length} active attendance record(s)</p>{attendance.map((row) => <span key={row.id} data-testid={`attendance-${row.member_id}`}>{row.status} · {row.save_state}</span>)}</>}
  </main>
}

createRoot(document.getElementById('rxdb-poc-root')).render(<PocApp />)
