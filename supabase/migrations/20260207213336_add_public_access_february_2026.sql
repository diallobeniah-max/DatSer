
-- Allow anonymous (no sign-in) read access to February_2026
CREATE POLICY "Public read access" ON public."February_2026"
  FOR SELECT TO anon
  USING (true);

-- Allow anonymous insert
CREATE POLICY "Public insert access" ON public."February_2026"
  FOR INSERT TO anon
  WITH CHECK (true);

-- Allow anonymous update
CREATE POLICY "Public update access" ON public."February_2026"
  FOR UPDATE TO anon
  USING (true)
  WITH CHECK (true);
;
