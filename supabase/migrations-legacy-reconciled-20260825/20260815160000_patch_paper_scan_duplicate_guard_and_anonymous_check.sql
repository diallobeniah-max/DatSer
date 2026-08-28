-- Paper Scan — patch live extraction-claim function with corrected definitions.
--
-- Additive, idempotent patch. The historical migration
-- `20260812_paper_scan_extraction_server_authoritative.sql` is ALREADY APPLIED
-- LIVE (supabase_migrations version `20260812065418`) and its local source is
-- frozen. It already shipped with the corrected logic; this patch re-declares
-- the live function so the intended behavior is explicit, auditable, and
-- idempotent on any future re-run:
--
--   FIX 1 — duplicate check uses a boolean EXISTS result (`v_duplicate`), never
--           `SELECT 1 INTO v_new_id` (which could assign an integer into a UUID
--           column and cause a runtime cast error). The claim path is:
--              candidate exists     -> 'duplicate' (no insert, no UUID cast)
--              candidate absent      -> claim + insert (UUID RETURNING id)
--   FIX 2 — anonymous Supabase users are rejected BEFORE any quota/ledger work.
--           Anonymous sign-in yields a real auth.uid() with the 'authenticated'
--           role, so it must be denied explicitly at the RPC layer:
--              auth.jwt() ->> 'is_anonymous' = 'true' -> raise
--
-- This file does NOT touch members, attendance, provenance, workspace
-- ownership, or any unrelated table. It only replaces one extraction-claim
-- function definition.

create or replace function public.claim_paper_scan_extraction(
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

    -- FIX 2: Supabase anonymous sign-in produces a valid auth.uid() with the
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

    -- FIX 1: Idempotency as a boolean EXISTS result. v_new_id is only ever
    -- assigned a UUID from RETURNING id; never an integer.
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

notify pgrst, 'reload schema';
