-- Paper Scan extraction ledger becomes server-authoritative.
--
-- The API no longer does a check-then-record through the user's own session.
-- Instead, a single SECURITY DEFINER RPC atomically claims one extraction slot
-- under an advisory lock: quota is enforced inside the same transaction that
-- inserts the row, and duplicate request ids can never double-spend a Gemini
-- call. Direct writes from the browser session are revoked; clients can only
-- read their own rows (RLS) and call the claim RPC.

-- 1) Idempotency: one ledger row per (user, request_id). Nullable so legacy
--    rows without a request id remain valid. A legitimate re-scan of the same
--    sheet MUST use a brand-new request_id; re-sending an old request_id always
--    resolves to 'duplicate' so the same attempt cannot double-spend Gemini.
ALTER TABLE public.paper_scan_extraction
    ADD COLUMN IF NOT EXISTS request_id TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS paper_scan_extraction_user_request_idx
    ON public.paper_scan_extraction (user_id, request_id)
    WHERE request_id IS NOT NULL;

-- 2) Remove the browser-session INSERT path. The RPC is the only way in.
DROP POLICY IF EXISTS "Users record their own extractions" ON public.paper_scan_extraction;

REVOKE INSERT, UPDATE, DELETE ON TABLE public.paper_scan_extraction FROM authenticated;

-- 3) The atomic claim RPC. Reuses the existing SECURITY DEFINER
--    authorize_workspace_actor helper, so an authenticated owner or an
--    accepted/active collaborator can claim for the workspace they belong to.
CREATE OR REPLACE FUNCTION public.claim_paper_scan_extraction(
    p_owner_id UUID,
    p_request_id TEXT,
    p_image_sha256 TEXT
)
RETURNS TABLE (
    ok BOOLEAN,
    status TEXT,
    extraction_id UUID
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_requester_id UUID;
    v_duplicate BOOLEAN;
    v_new_id UUID;
    v_count INTEGER;
BEGIN
    -- Re-authenticate and re-authorize inside the RPC: even a direct caller
    -- who bypasses the API cannot claim for a workspace they do not own.
    v_requester_id := public.authorize_workspace_actor(p_owner_id);

    -- Supabase anonymous sign-in produces a valid auth.uid() with the
    -- 'authenticated' role, but must never consume extraction quota.
    IF auth.jwt() ->> 'is_anonymous' = 'true' THEN
        RAISE EXCEPTION 'Anonymous accounts cannot use extraction';
    END IF;

    IF p_request_id IS NULL OR btrim(p_request_id) = '' THEN
        RAISE EXCEPTION 'request id is required';
    END IF;
    IF p_image_sha256 IS NULL OR btrim(p_image_sha256) = '' THEN
        RAISE EXCEPTION 'image hash is required';
    END IF;

    -- Serialize claims per user so the quota check and the insert are atomic.
    PERFORM pg_advisory_xact_lock(hashtextextended(v_requester_id::text, 0));

    -- Idempotency: the same attempt must never be claimed twice.
    SELECT EXISTS (
        SELECT 1
        FROM public.paper_scan_extraction
        WHERE user_id = v_requester_id
          AND request_id = p_request_id
    ) INTO v_duplicate;
    IF v_duplicate THEN
        RETURN QUERY SELECT FALSE, 'duplicate'::TEXT, NULL::UUID;
        RETURN;
    END IF;

    -- Rolling quota: 40 claims per user per rolling hour.
    SELECT COUNT(*)::INTEGER INTO v_count
    FROM public.paper_scan_extraction
    WHERE user_id = v_requester_id
      AND created_at >= NOW() - INTERVAL '1 hour';
    IF v_count >= 40 THEN
        RETURN QUERY SELECT FALSE, 'quota_exceeded'::TEXT, NULL::UUID;
        RETURN;
    END IF;

    INSERT INTO public.paper_scan_extraction (user_id, owner_id, image_sha256, request_id)
    VALUES (v_requester_id, p_owner_id, btrim(p_image_sha256), btrim(p_request_id))
    RETURNING id INTO v_new_id;

    RETURN QUERY SELECT TRUE, 'claimed'::TEXT, v_new_id;
EXCEPTION
    -- Unique-violation fallback (e.g. concurrent claim from a different lock
    -- window) resolves to 'duplicate' instead of surfacing a raw DB error.
    WHEN unique_violation THEN
        RETURN QUERY SELECT FALSE, 'duplicate'::TEXT, NULL::UUID;
END;
$$;

REVOKE ALL ON FUNCTION public.claim_paper_scan_extraction(UUID, TEXT, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.claim_paper_scan_extraction(UUID, TEXT, TEXT) FROM anon;
GRANT EXECUTE ON FUNCTION public.claim_paper_scan_extraction(UUID, TEXT, TEXT) TO authenticated;

-- Let PostgREST pick up the new function immediately.
NOTIFY pgrst, 'reload schema';;
