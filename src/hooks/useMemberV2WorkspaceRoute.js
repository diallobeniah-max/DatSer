import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { isMemberV2HostedRolloutAllowed, isMemberV2SharedRouteEnabled } from '../experiments/rxdb-member-phase1/memberV2FeatureFlag'

// Never persist eligibility or reuse it across an actor/workspace switch,
// including A -> B -> A. Each mounted scope requires its own server decision.
export const useMemberV2WorkspaceRoute = ({ client, userId, ownerId, workspace, ready, online, env = import.meta.env }) => {
  const hosted = isMemberV2HostedRolloutAllowed(env)
  const scope = useMemo(() => ({ client, userId, ownerId, workspace, ready, hosted }), [client, userId, ownerId, workspace, ready, hosted])
  const [eligibility, setEligibility] = useState(null)
  const activeLookup = useRef(null)

  useLayoutEffect(() => {
    const lookup = { scope, online }
    activeLookup.current = lookup
    // Revalidate before routing on reconnect. A confirmed pilot can still use
    // its own offline queue in this session; an offline start fails closed.
    if (online) setEligibility(null)
    return () => { if (activeLookup.current === lookup) activeLookup.current = null }
  }, [scope, online])

  useEffect(() => {
    if (!hosted || !ready || !client || !userId || !ownerId || !online) return undefined
    const lookup = activeLookup.current
    let cancelled = false
    const check = async () => {
      try {
        const { data, error } = await client.rpc('member_v2_workspace_eligible', { p_owner_id: ownerId })
        if (!cancelled && activeLookup.current === lookup) {
          setEligibility({ scope, enabled: !error && data === true })
        }
      } catch {
        if (!cancelled && activeLookup.current === lookup) setEligibility({ scope, enabled: false })
      }
    }
    void check()
    return () => { cancelled = true }
  }, [client, hosted, online, ownerId, ready, scope, userId])

  return isMemberV2SharedRouteEnabled(env, ready && eligibility?.scope === scope && eligibility.enabled)
}
