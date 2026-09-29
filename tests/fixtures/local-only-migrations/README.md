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

Three historical production-applied versions need explicit modeling in a blank local replay: two contain production-data-only operations and one contains invalid legacy policy syntax. The `tests/fixtures/production-replay/` manifest and named baseline SQL files document those exceptions; the replay script never edits or patches copied production migration SQL. Its other compatibility fixtures are listed as test-only prerequisites in that manifest. The forward CSV policy repair remains a new tracked production migration.

The retired POC phase-0 fixture is applied only after production replay assertions, through an explicit local-only query step. It never enters `supabase/migrations` or the production replay migration path.
