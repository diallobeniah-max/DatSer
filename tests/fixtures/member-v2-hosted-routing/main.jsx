import React, { useMemo, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { createClient } from '@supabase/supabase-js'
import { useMemberV2WorkspaceRoute } from '../../../src/hooks/useMemberV2WorkspaceRoute'
import { assertLegacyMemberFlowIsSafe, updateMemberV2LocalFlowGuard } from '../../../src/experiments/rxdb-member-phase1/memberV2FeatureFlag'

// This page is outside the product entry point and only runs on local Vite.
if (!import.meta.env.DEV || !['127.0.0.1', 'localhost'].includes(location.hostname)) throw new Error('Local test harness only')
const fixture = window.__memberV2RoutingFixture
const client = createClient(import.meta.env.VITE_SUPABASE_URL, import.meta.env.VITE_SUPABASE_ANON_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
})
const signedIn = await client.auth.setSession(fixture.sessions.pilot)
if (signedIn.error) throw signedIn.error
const hostedEnv = { PROD: true, VITE_DATSER_MEMBER_V2_HOSTED_ROLLOUT: 'true' }

const Harness = () => {
  const [actor, setActor] = useState(fixture.pilot)
  const [owner, setOwner] = useState(fixture.pilot)
  const [ready, setReady] = useState(true)
  const [online, setOnline] = useState(!fixture.offlineStart)
  const [scopeVersion, setScopeVersion] = useState(0)
  const [calls, setCalls] = useState(0)
  const [legacyResult, setLegacyResult] = useState('unchecked')
  const eligibilityClient = useMemo(() => ({ rpc: (...args) => {
    setCalls((count) => count + 1)
    return client.rpc(...args)
  } }), [])
  const enabled = useMemberV2WorkspaceRoute({ client: eligibilityClient, userId: actor, ownerId: owner,
    workspace: `owner-${owner}-${scopeVersion}`, ready, online, env: hostedEnv })
  const switchActor = async () => {
    setReady(false)
    const next = actor === fixture.pilot ? fixture.legacy : fixture.pilot
    setActor(next)
    const result = await client.auth.setSession(fixture.sessions[next === fixture.pilot ? 'pilot' : 'legacy'])
    setReady(!result.error)
  }
  return <main>
    <output data-testid="route">{enabled ? 'V2' : 'legacy'}</output>
    <output data-testid="calls">{calls}</output>
    <button onClick={() => setOwner(fixture.pilot)}>Pilot workspace</button>
    <button onClick={() => setOwner(fixture.legacy)}>Legacy workspace</button>
    <button onClick={() => setOnline(false)}>Go offline</button>
    <button onClick={() => setOnline(true)}>Reconnect</button>
    <button onClick={() => setScopeVersion((value) => value + 1)}>New workspace scope</button>
    <button onClick={switchActor}>Switch actor</button>
    {['pendingChanges', 'failedChanges', 'conflicts'].map((field) => <button key={field} onClick={() =>
      updateMemberV2LocalFlowGuard({ userId: actor, ownerId: owner, syncState: { [field]: 1 } })}>{field}</button>)}
    <button onClick={() => {
      try { assertLegacyMemberFlowIsSafe({ userId: actor, ownerId: owner }); setLegacyResult('allowed') }
      catch { setLegacyResult('blocked') }
    }}>Check legacy writer</button>
    <output data-testid="legacy-result">{legacyResult}</output>
  </main>
}
createRoot(document.getElementById('root')).render(<Harness />)
