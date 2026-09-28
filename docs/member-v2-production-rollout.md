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

The order puts all profile and attendance RPC dependencies before the server
gate that is enforced by the shared mutation reservation function. The source
capability contract is retained as a production read-only RPC: its trusted month
resolver performs permanent-workspace authorization, while its response
contains only an allowlisted schema field list.

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
policies were shipped. The replay also applies compatibility edits to copies of the three
historical migrations whose original versions must remain immutable. It then
adds the local return-type compatibility fixtures that model helpers already
present in production, while excluding the Member V2 backend and attendance
harness migrations. It uses the resulting fresh local database for the Member
V2 integration and browser suites.

The Android checklist for a later release remains: cold launch; offline
create/edit/delete and attendance; process restart; reconnect; app resume;
second-client convergence; conflict resolution.

Vercel project ownership remains unverified and must be resolved separately
before any production deployment. Hosted migrations, production cutover, push,
and deployment are outside this branch's authorization.
