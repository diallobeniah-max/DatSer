-- Phase 4C: private Saved Scans for Paper Scan Review.
--
-- Completed Gemini extractions persist so a reopened scan never re-bills
-- Gemini. Images are personal data, so every sheet image goes into a PRIVATE
-- storage bucket that is reachable ONLY through the authenticated session,
-- storage-object RLS, and signed URLs. No public bucket, no service-role
-- secret in the browser.
--
-- The table's `id` IS the client review session id, so a repeated Save of the
-- same session is an idempotent UPSERT on the same row (same id), and a
-- re-saved sheet image overwrites its own storage object with upsert=true.
--
-- Deletes only touch the scan row and its owned storage objects. Members,
-- attendance, the extraction quota ledger, and unrelated scans are never
-- touched by this feature.

-- 1) Table. Reuses the existing public.can_access_workspace(UUID) helper (a
--    SECURITY DEFINER filter that returns TRUE only for the owner or an
--    accepted/active collaborator of the workspace), so RLS stays in lockstep
--    with the extraction guard and the rest of the app.
CREATE TABLE IF NOT EXISTS public.paper_scan_saved (
    id UUID PRIMARY KEY,
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    owner_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    name TEXT NOT NULL DEFAULT 'Saved scan',
    sheet_images JSONB NOT NULL DEFAULT '[]'::JSONB,
    extraction JSONB NOT NULL DEFAULT '{}'::JSONB,
    review_state JSONB NOT NULL DEFAULT '{}'::JSONB,
    attendance JSONB NOT NULL DEFAULT '{}'::JSONB,
    usage_metadata JSONB NOT NULL DEFAULT '{}'::JSONB,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS paper_scan_saved_user_time_idx
    ON public.paper_scan_saved (user_id, updated_at DESC);

CREATE INDEX IF NOT EXISTS paper_scan_saved_owner_time_idx
    ON public.paper_scan_saved (owner_id, updated_at DESC);

ALTER TABLE public.paper_scan_saved ENABLE ROW LEVEL SECURITY;

-- Private per-user rows, additionally gated by workspace authorization so a
-- scan saved for one workspace is never readable, mutable, or deletable
-- outside that workspace (the isolation guarantee in Phase 4C).
DROP POLICY IF EXISTS "Users read their own saved scans" ON public.paper_scan_saved;
CREATE POLICY "Users read their own saved scans" ON public.paper_scan_saved
    FOR SELECT
    USING (auth.uid() = user_id AND public.can_access_workspace(owner_id));

DROP POLICY IF EXISTS "Users save their own scans" ON public.paper_scan_saved;
CREATE POLICY "Users save their own scans" ON public.paper_scan_saved
    FOR INSERT
    WITH CHECK (auth.uid() = user_id AND public.can_access_workspace(owner_id));

DROP POLICY IF EXISTS "Users update their own saved scans" ON public.paper_scan_saved;
CREATE POLICY "Users update their own saved scans" ON public.paper_scan_saved
    FOR UPDATE
    USING (auth.uid() = user_id AND public.can_access_workspace(owner_id))
    WITH CHECK (auth.uid() = user_id AND public.can_access_workspace(owner_id));

DROP POLICY IF EXISTS "Users delete their own saved scans" ON public.paper_scan_saved;
CREATE POLICY "Users delete their own saved scans" ON public.paper_scan_saved
    FOR DELETE
    USING (auth.uid() = user_id AND public.can_access_workspace(owner_id));

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.paper_scan_saved TO authenticated;

-- 2) Keep updated_at accurate for list ordering.
CREATE OR REPLACE FUNCTION public.touch_paper_scan_saved_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
    NEW.updated_at := NOW();
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS set_paper_scan_saved_updated_at ON public.paper_scan_saved;
CREATE TRIGGER set_paper_scan_saved_updated_at
    BEFORE UPDATE ON public.paper_scan_saved
    FOR EACH ROW
    EXECUTE FUNCTION public.touch_paper_scan_saved_updated_at();

-- 3) Private storage bucket for sheet images. Public is FALSE: there is no
--    public URL for these files; the browser reads them through the
--    authenticated client via signed URLs only.
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
    'paper-scan-saved',
    'paper-scan-saved',
    FALSE,
    4194304,
    ARRAY['image/jpeg', 'image/png', 'image/webp']
)
ON CONFLICT (id) DO UPDATE SET
    public = EXCLUDED.public,
    file_size_limit = EXCLUDED.file_size_limit,
    allowed_mime_types = EXCLUDED.allowed_mime_types;

-- Storage objects live under {user_id}/{scan_id}/{sheet_id}.jpg so each user
-- can only touch the objects inside their own first path segment. The scan
-- row's user_id equals the writer (auth.uid()), so this stays consistent with
-- the table RLS above.
DROP POLICY IF EXISTS "Users upload their own saved scan sheets" ON storage.objects;
CREATE POLICY "Users upload their own saved scan sheets" ON storage.objects
    FOR INSERT TO authenticated
    WITH CHECK (
        bucket_id = 'paper-scan-saved'
        AND (storage.foldername(name))[1] = (SELECT auth.uid()::TEXT)
    );

DROP POLICY IF EXISTS "Users read their own saved scan sheets" ON storage.objects;
CREATE POLICY "Users read their own saved scan sheets" ON storage.objects
    FOR SELECT TO authenticated
    USING (
        bucket_id = 'paper-scan-saved'
        AND (storage.foldername(name))[1] = (SELECT auth.uid()::TEXT)
    );

DROP POLICY IF EXISTS "Users update their own saved scan sheets" ON storage.objects;
CREATE POLICY "Users update their own saved scan sheets" ON storage.objects
    FOR UPDATE TO authenticated
    USING (
        bucket_id = 'paper-scan-saved'
        AND (storage.foldername(name))[1] = (SELECT auth.uid()::TEXT)
    )
    WITH CHECK (
        bucket_id = 'paper-scan-saved'
        AND (storage.foldername(name))[1] = (SELECT auth.uid()::TEXT)
    );

DROP POLICY IF EXISTS "Users delete their own saved scan sheets" ON storage.objects;
CREATE POLICY "Users delete their own saved scan sheets" ON storage.objects
    FOR DELETE TO authenticated
    USING (
        bucket_id = 'paper-scan-saved'
        AND (storage.foldername(name))[1] = (SELECT auth.uid()::TEXT)
    );

-- Storage signing requires the owning role; authenticated is already granted
-- create_signed_url / createSignedUrl on objects by Supabase defaults.

-- 4) Let PostgREST pick up the new table/RPC cache immediately.
NOTIFY pgrst, 'reload schema';