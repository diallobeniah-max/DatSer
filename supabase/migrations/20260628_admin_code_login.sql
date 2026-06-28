CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS public.admin_login_codes (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    owner_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    code_hash TEXT NOT NULL,
    label TEXT,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    expires_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_admin_login_codes_active
    ON public.admin_login_codes (is_active, expires_at);

CREATE TABLE IF NOT EXISTS public.admin_login_code_attempts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    ip_hash TEXT,
    attempted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    ok BOOLEAN NOT NULL DEFAULT FALSE
);

CREATE INDEX IF NOT EXISTS idx_admin_login_code_attempts_ip_time
    ON public.admin_login_code_attempts (ip_hash, attempted_at DESC);

ALTER TABLE public.admin_login_codes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.admin_login_code_attempts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS admin_login_codes_owner_access ON public.admin_login_codes;
CREATE POLICY admin_login_codes_owner_access ON public.admin_login_codes
FOR ALL USING (auth.uid() = owner_id)
WITH CHECK (auth.uid() = owner_id);

CREATE OR REPLACE FUNCTION public.touch_admin_login_code_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS touch_admin_login_codes_updated_at ON public.admin_login_codes;
CREATE TRIGGER touch_admin_login_codes_updated_at
BEFORE UPDATE ON public.admin_login_codes
FOR EACH ROW EXECUTE FUNCTION public.touch_admin_login_code_updated_at();

CREATE OR REPLACE FUNCTION public.verify_admin_code_login(p_code TEXT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_code TEXT := NULLIF(BTRIM(COALESCE(p_code, '')), '');
    v_attempt_key TEXT := ENCODE(DIGEST(COALESCE(current_setting('request.header.x-forwarded-for', true), 'unknown'), 'sha256'), 'hex');
    v_recent_failures INTEGER;
    v_match public.admin_login_codes%ROWTYPE;
    v_email TEXT;
    v_full_name TEXT;
    v_workspace TEXT;
    v_expires_at TIMESTAMPTZ := NOW() + INTERVAL '1 hour';
BEGIN
    IF v_code IS NULL THEN
        RETURN jsonb_build_object('ok', false, 'message', 'Enter the admin code');
    END IF;

    SELECT COUNT(*)
    INTO v_recent_failures
    FROM public.admin_login_code_attempts
    WHERE ip_hash = v_attempt_key
      AND attempted_at > NOW() - INTERVAL '10 minutes'
      AND ok = FALSE;

    IF COALESCE(v_recent_failures, 0) >= 8 THEN
        INSERT INTO public.admin_login_code_attempts (ip_hash, ok)
        VALUES (v_attempt_key, FALSE);
        RETURN jsonb_build_object('ok', false, 'message', 'Too many attempts. Wait a few minutes and try again.');
    END IF;

    SELECT *
    INTO v_match
    FROM public.admin_login_codes
    WHERE is_active = TRUE
      AND (expires_at IS NULL OR expires_at > NOW())
      AND code_hash = crypt(v_code, code_hash)
    ORDER BY created_at DESC
    LIMIT 1;

    INSERT INTO public.admin_login_code_attempts (ip_hash, ok)
    VALUES (v_attempt_key, v_match.id IS NOT NULL);

    IF v_match.id IS NULL THEN
        RETURN jsonb_build_object('ok', false, 'message', 'Invalid admin code');
    END IF;

    SELECT au.email,
           COALESCE(au.raw_user_meta_data ->> 'full_name', au.email),
           COALESCE(up.workspace_name, v_match.label, 'Admin Workspace')
    INTO v_email, v_full_name, v_workspace
    FROM auth.users au
    LEFT JOIN public.user_preferences up ON up.user_id = au.id
    WHERE au.id = v_match.owner_id;

    RETURN jsonb_build_object(
        'ok', true,
        'owner_id', v_match.owner_id,
        'email', v_email,
        'full_name', v_full_name,
        'workspace_name', v_workspace,
        'expires_at', v_expires_at
    );
END;
$$;

COMMENT ON FUNCTION public.verify_admin_code_login(TEXT)
IS 'Verifies hashed admin code server-side. Create a code with: insert into public.admin_login_codes(owner_id, code_hash, label) values (<owner uuid>, crypt(<code>, gen_salt(''bf'')), <label>);';
