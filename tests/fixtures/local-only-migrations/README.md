# Local-only Supabase migration fixtures

The SQL files in this directory are deliberately outside `supabase/migrations`,
so a normal `supabase db push` cannot apply them to hosted DatSer. They preserve
the earlier RxDB backend POC/bootstrap and isolated attendance harness.

After resetting a disposable local Supabase database with the production
migration path, `npm run test:poc:integration` applies the six POC/bootstrap
fixtures and the phase-0 POC contract before its POC integration test. The
attendance harness migration is retained here for explicit legacy-harness
reproduction only; the production Member V2 integration tests must use the
monthly attendance contract and must not apply that override.

The three historical production-applied migrations remain canonical in the
production path. Local replay compatibility is handled by the disposable replay
script under `scripts/local/`, which patches only temporary migration copies.
