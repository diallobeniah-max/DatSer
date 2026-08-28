
-- Drop the anon-only policies
DROP POLICY IF EXISTS "Public read access" ON public."February_2026";
DROP POLICY IF EXISTS "Public insert access" ON public."February_2026";
DROP POLICY IF EXISTS "Public update access" ON public."February_2026";

-- Create policies that work for ALL roles (anon + authenticated)
CREATE POLICY "Anyone can read" ON public."February_2026"
  FOR SELECT
  USING (true);

CREATE POLICY "Anyone can insert" ON public."February_2026"
  FOR INSERT
  WITH CHECK (true);

CREATE POLICY "Anyone can update" ON public."February_2026"
  FOR UPDATE
  USING (true)
  WITH CHECK (true);
;
