# Member V2 productionization contract

This branch prepares Member V2 for a later production review. It does not enable
or deploy a production workspace.

## Migration order

1. `20260913074014_rxdb_member_phase1_server_contract.sql` creates the profile
   mutation, claim, change-feed, and head contracts. The tombstone expression is
   correct in this first production definition.
2. `20260913182448_rxdb_member_phase1_realtime_signal.sql` adds the
   owner-scoped, metadata-only wake signal.
3. `20260914034500_rxdb_member_v2_source_capabilities.sql` exposes only
   allowlisted column names after trusted workspace-month authorization.
4. The trusted soft-delete, single-change, and tombstone migrations apply in
   order (`20260925082837`, `20260926185422`, `20260927041513`). They keep
   deletion month-scoped and ensure one logical delete event.
5. `20260928112043_member_v2_production_attendance_contract.sql` adds the
   attendance change projection and capture trigger over the canonical monthly
   `attendance_YYYY_MM_DD` columns. The event feed is not a second store.
6. `20260928112916_member_v2_workspace_rollout_gate.sql` adds the server-side
   default-off workspace allowlist. No owner is enabled by this migration.
7. `20260928113003_repair_csv_import_storage_update_policy.sql` repairs the
   malformed historical storage policy without editing its applied version.
8. `20260928114500_fix_cross_month_attendance_phone_type.sql` preserves the
   existing cross-month RPC while matching its phone assignment to the trusted
   target table's actual column type.
9. The attendance boolean compatibility, commit ordering, and broad writer-lock
   migrations follow (`20260928150000`, `20260929073632`, `20260930015312`).
10. `20260930233323_member_v2_workspace_eligibility.sql` adds the read-only
    `member_v2_workspace_eligible(p_owner_id)` RPC. It authorizes the permanent
    actor using the existing owner/accepted-collaborator contract before returning
    one boolean. The rollout table remains private; no workspace is enabled.

The order puts all profile and attendance RPC dependencies before the server
gate that is enforced by the shared mutation reservation function. The source
capability contract is retained as a production read-only RPC: its trusted month
resolver performs permanent-workspace authorization, while its response
contains only an allowlisted schema field list.

## Hosted workspace routing

The production build flag `VITE_DATSER_MEMBER_V2_HOSTED_ROLLOUT=true` permits
eligibility checks; only an RPC result of boolean `true` enables the resolved
workspace's shared V2 routes. Missing RPCs, errors, and unknown eligibility use
legacy routes, subject to the existing durable-work/conflict guard. Pending,
failed, or conflicted V2 work blocks legacy profile and attendance writers;
changing the route never transfers V2 mutations into the legacy queue.

Eligibility is kept only for the current mounted actor/owner/workspace scope.
Switches immediately invalidate it and late responses cannot restore it. An
older access-context lookup also cannot overwrite a newer owner selection;
actor/workspace changes invalidate pending owner-resolution requests. An offline
start stays on guarded legacy routes. A pilot confirmed in this session
keeps its own V2 offline queue until reconnect, which rechecks eligibility before
routing again. Server mutation gates still enforce current rollout authorization,
including revocation while a client is open. The explicit local validation flags
retain their existing behavior.

Review and validate the forward-only eligibility migration separately before any
hosted application. Inspect the entire pending migration list; a generic database
push can apply earlier pending migrations too. Deployment and workspace activation
remain separate approval gates.

## Mixed attendance writers

Member V2 writes `Present`, `Absent`, or SQL `NULL` to the existing monthly
attendance text column. An AFTER row trigger maps legacy boolean/text forms to
the same status vocabulary and records changes in `member_v2_change_events`.
Each new change also writes one row to the existing
`member_v2_realtime_signals`; clients treat that row as a wake-up and pull the
authoritative cursor feed. Quick Sunday and cross-month legacy writers continue
to own their existing RPC flows and become visible through the trigger.

## Local-only fixtures and clean replay

POC prerequisites and the previous isolated attendance harness live under
`tests/fixtures/local-only-migrations`; they are not part of the Supabase
production migration path. `scripts/local/test-member-v2-production-replay.ps1`
creates an isolated temporary Supabase project with separate ports. For that
temporary replay, a February monthly-table fixture is installed before the
historical policy migrations because production created that month before those
policies were shipped. The replay substitutes explicit local applied-version
baselines for three historical migrations, leaving tracked originals immutable. It then
adds the local return-type compatibility fixtures that model helpers already
present in production, while excluding the Member V2 backend and attendance
harness migrations. It uses the resulting fresh local database for the Member
V2 integration and browser suites.

The Android checklist for a later release remains: cold launch; offline
create/edit/delete and attendance; process restart; reconnect; app resume;
second-client convergence; conflict resolution.

## Browser validation boundaries

The real-screen browser gate retains its navigation and behavior deadlines. It
isolates the optional external OpenDyslexic stylesheet: the original failed trace
had 127 successful local requests completed within 365 ms of navigation, while
that CDN request alone remained pending until the 10-second load deadline. Font
delivery and rendering are outside this behavioral gate. A visible login form is
still required before authentication.

Synthetic actors persist a Manual September selection through the preference
RPC so September identity/attendance assertions remain valid after that calendar
month ends. The local browser fixture models fourteen preference columns missing
from historical replay but verified by authenticated, catalog-only hosted queries
on 2026-10-01 (types/defaults included). This is a local prerequisite model, not a
new production migration or proof of the rest of the hosted schema.

The browser failures also exposed a product contract mismatch: the tracked and
hosted `get_preference_bundle(uuid)` response uses `personal` and `workspace`.
Preference hydration and conflict recovery now read those keys while preserving
the existing explicit client keys. Actor/owner metadata determines ownership when
the response has no explicit ownership flag. This requires no database migration.

`tests/member-v2-hosted-routing.spec.js` uses a separate loopback-only fixture page
to run the production routing hook against real authenticated local eligibility
RPCs. It supplies production routing flags directly and does not use the shared
web validation bypass. The normal-screen matrix separately validates mutation
ownership and offline durability. Browser artifacts have unique ignored output
directories; Vite excludes generated traces from its watcher.

`-KeepForManualTesting` retains only this task's successful disposable replay and
Vite for manual testing, with private connection material under ignored output.
The retained database includes synthetic fixtures and the explicitly local POC
compatibility fixture; it is not a hosted-state substitute.

Vercel project ownership remains unverified and must be resolved separately
before any production deployment. Hosted migrations, production cutover, push,
and deployment are outside this branch's authorization.
