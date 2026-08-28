DO $$
DECLARE
  tbl record;
BEGIN
  FOR tbl IN
    SELECT tablename
    FROM pg_tables
    WHERE schemaname = 'public'
      AND tablename ~ '^(January|February|March|April|May|June|July|August|September|October|November|December)_[0-9]{4}$'
  LOOP
    EXECUTE format(
      'CREATE POLICY %I ON %I FOR DELETE TO public USING (
        user_id = auth.uid()
        OR user_id IN (
          SELECT c.owner_id
          FROM public.collaborators c
          WHERE lower(c.email) = lower(auth.jwt() ->> ''email'')
            AND c.status = ANY (ARRAY[''pending'',''accepted'',''active''])
        )
      )',
      'Users can delete own or collaborator rows',
      tbl.tablename
    );
  END LOOP;
END $$;;
