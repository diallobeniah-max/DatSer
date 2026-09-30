# DatSer RxDB backend Phase 0 POC

This namespace is deliberately disconnected from the production DatSer application. It proves a local-first authority model with RxDB, custom Supabase pull/push replication, stable UUID identity, durable request IDs, explicit save states, optimistic concurrency, RLS, audit logging, and transactional RPC writes.

## Current architecture map

- Production UI state is owned by `AppContext.jsx`; IndexedDB persistence and queued mutations are in `offlineStore.js`.
- Attendance writes pass through `manualAttendanceWrite.js`, while queued attendance flushing still contains a dynamic monthly-table path.
- `realtimeMerge.js` protects pending local fields; `appResumeSync.js` supplies single-flight and cooldown behavior.
- Production realtime currently updates React state and the preview cache. This POC instead treats realtime only as a wake signal: the signal runs the workspace-scoped pull RPC, feeds its authoritative batch into RxDB replication, and the UI continues to read exclusively from RxDB.
- The POC backend is normalized into workspaces, workspace membership, members, attendance, idempotency, and audit tables. Every data row is workspace-scoped.

## Safety boundary

The POC client rejects non-loopback Supabase URLs. Tables, RPCs, and realtime subscriptions use the `poc_` prefix. Nothing imports this namespace from production code. No existing monthly table, production queue, AppContext, or Android configuration is changed.

## Replication contract

Pull ordering and checkpoints use `(updated_at, id)`. Server deletes are durable `is_deleted` soft tombstones and remain separate from RxDB's internal `_deleted` flag. Pushes reuse the request ID persisted in each RxDB document. The server compares expected revisions and returns canonical conflicts. The custom conflict handler preserves the local edit, records the remote version, exposes `CONFLICT`, and clears automatic mutation metadata so an unresolved conflict cannot loop. A future resolver must create a new request ID after an explicit user choice. Transient failures remain durable and retryable. Confirmed server documents become `SERVER_CONFIRMED` only after backend acknowledgement and contain no pending operation.

Realtime payloads are not applied directly to React or RxDB documents. They only initiate an authenticated pull. Duplicate wake signals can repeat a read, but server UUIDs, RxDB primary keys, and RPC idempotency prevent duplicate logical rows or writes.

## Capacitor assessment

The free Dexie storage adapter uses IndexedDB and is suitable for a browser/Capacitor proof of concept. Capacitor's WebView storage can be reclaimed by the operating system, so a production rollout would still need device testing, backup/recovery UX, storage-pressure handling, and an explicit database migration plan. This phase makes no Android changes.

## Rollback

Stop using the standalone POC entry, remove the `src/experiments/rxdb-backend-poc` namespace, and revert the POC migration before it is ever applied outside a disposable local Supabase stack. The historical bootstrap migration edits in this branch exist only to make the disposable local stack reproducible; they are not a production migration strategy.
