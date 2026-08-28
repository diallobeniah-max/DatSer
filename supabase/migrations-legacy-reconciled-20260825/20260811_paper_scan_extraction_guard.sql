-- Paper Scan extraction safeguard ledger.
-- Records every Gemini extraction per user so the API can reject duplicate
-- sheets and enforce a rolling quota. Rows are scoped to the authenticated
-- caller; the server writes and reads through the user's own session (RLS).

CREATE TABLE IF NOT EXISTS public.paper_scan_extraction (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    owner_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    image_sha256 TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS paper_scan_extraction_user_time_idx
    ON public.paper_scan_extraction (user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS paper_scan_extraction_owner_time_idx
    ON public.paper_scan_extraction (owner_id, created_at DESC);

ALTER TABLE public.paper_scan_extraction ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users read their own extraction usage" ON public.paper_scan_extraction;
CREATE POLICY "Users read their own extraction usage" ON public.paper_scan_extraction
    FOR SELECT
    USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users record their own extractions" ON public.paper_scan_extraction;
CREATE POLICY "Users record their own extractions" ON public.paper_scan_extraction
    FOR INSERT
    WITH CHECK (auth.uid() = user_id);

GRANT SELECT, INSERT ON TABLE public.paper_scan_extraction TO authenticated;