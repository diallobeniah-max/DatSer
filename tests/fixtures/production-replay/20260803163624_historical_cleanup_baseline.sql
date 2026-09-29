-- This test-only baseline stands in for the already-applied historical cleanup
-- migration. Its only effect is deleting a production-specific collaborator
-- row, and a disposable database intentionally contains no production rows.
select 1;
