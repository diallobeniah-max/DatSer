CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE OR REPLACE FUNCTION public.can_access_workspace(p_owner_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
    SELECT
        auth.uid() IS NOT NULL
        AND p_owner_id IS NOT NULL
        AND (
            auth.uid() = p_owner_id
            OR EXISTS (
                SELECT 1
                FROM public.collaborators c
                WHERE c.owner_id = p_owner_id
                  AND c.status IN ('accepted', 'active')
                  AND (
                      c.collaborator_user_id = auth.uid()
                      OR EXISTS (
                          SELECT 1
                          FROM auth.users au
                          WHERE au.id = auth.uid()
                            AND (c.email = au.email OR c.email ILIKE au.email)
                      )
                  )
            )
        );
$$;

CREATE OR REPLACE FUNCTION public.authorize_workspace_actor(
    p_owner_id UUID
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_requester_id UUID := auth.uid();
BEGIN
    IF v_requester_id IS NULL THEN
        RAISE EXCEPTION 'Authentication required';
    END IF;

    IF p_owner_id IS NULL THEN
        RAISE EXCEPTION 'Owner id is required';
    END IF;

    IF NOT public.can_access_workspace(p_owner_id) THEN
        RAISE EXCEPTION 'Not authorized to mutate this workspace';
    END IF;

    RETURN v_requester_id;
END;
$$;

CREATE TABLE IF NOT EXISTS public.members (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    owner_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    full_name TEXT NOT NULL,
    phone_number TEXT,
    parent_phone_number TEXT,
    age_group TEXT,
    gender TEXT,
    ministry_group TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.attendance_sessions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    owner_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    service_date DATE NOT NULL,
    title TEXT,
    month TEXT,
    year INTEGER,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT attendance_sessions_owner_date_unique UNIQUE (owner_id, service_date)
);

CREATE TABLE IF NOT EXISTS public.attendance_records (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    owner_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    member_id UUID NOT NULL,
    session_id UUID NOT NULL REFERENCES public.attendance_sessions(id) ON DELETE CASCADE,
    status TEXT NOT NULL DEFAULT 'unknown',
    marked_by UUID,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT attendance_records_status_check
        CHECK (status IN ('present', 'absent', 'excused', 'unknown')),
    CONSTRAINT attendance_records_member_id_fkey
        FOREIGN KEY (member_id) REFERENCES public.members(id) ON DELETE CASCADE,
    CONSTRAINT attendance_records_member_session_unique UNIQUE (member_id, session_id)
);

CREATE TABLE IF NOT EXISTS public.follow_up_records (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    owner_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    member_id UUID NOT NULL,
    reason TEXT,
    follow_up_status TEXT NOT NULL DEFAULT 'not_contacted',
    message_sent BOOLEAN NOT NULL DEFAULT FALSE,
    contacted_by UUID,
    contact_method TEXT,
    response TEXT,
    next_action_date DATE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT follow_up_records_status_check
        CHECK (follow_up_status IN (
            'not_contacted',
            'message_sent',
            'called',
            'responded',
            'promised_to_come',
            'visited',
            'resolved'
        )),
    CONSTRAINT follow_up_records_member_id_fkey
        FOREIGN KEY (member_id) REFERENCES public.members(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_members_owner_id ON public.members(owner_id);
CREATE INDEX IF NOT EXISTS idx_attendance_sessions_owner_date ON public.attendance_sessions(owner_id, service_date DESC);
CREATE INDEX IF NOT EXISTS idx_attendance_records_owner_member ON public.attendance_records(owner_id, member_id);
CREATE INDEX IF NOT EXISTS idx_attendance_records_session ON public.attendance_records(session_id);
CREATE INDEX IF NOT EXISTS idx_follow_up_records_owner_member_created
    ON public.follow_up_records(owner_id, member_id, created_at DESC);

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'attendance_records_member_id_fkey'
          AND conrelid = 'public.attendance_records'::regclass
    ) THEN
        ALTER TABLE public.attendance_records
            ADD CONSTRAINT attendance_records_member_id_fkey
            FOREIGN KEY (member_id) REFERENCES public.members(id) ON DELETE CASCADE NOT VALID;
    END IF;

    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'follow_up_records_member_id_fkey'
          AND conrelid = 'public.follow_up_records'::regclass
    ) THEN
        ALTER TABLE public.follow_up_records
            ADD CONSTRAINT follow_up_records_member_id_fkey
            FOREIGN KEY (member_id) REFERENCES public.members(id) ON DELETE CASCADE NOT VALID;
    END IF;
END $$;

CREATE OR REPLACE FUNCTION public.touch_attendance_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS touch_members_updated_at ON public.members;
CREATE TRIGGER touch_members_updated_at
BEFORE UPDATE ON public.members
FOR EACH ROW EXECUTE FUNCTION public.touch_attendance_updated_at();

DROP TRIGGER IF EXISTS touch_attendance_records_updated_at ON public.attendance_records;
CREATE TRIGGER touch_attendance_records_updated_at
BEFORE UPDATE ON public.attendance_records
FOR EACH ROW EXECUTE FUNCTION public.touch_attendance_updated_at();

DROP TRIGGER IF EXISTS touch_follow_up_records_updated_at ON public.follow_up_records;
CREATE TRIGGER touch_follow_up_records_updated_at
BEFORE UPDATE ON public.follow_up_records
FOR EACH ROW EXECUTE FUNCTION public.touch_attendance_updated_at();

ALTER TABLE public.members ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.attendance_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.attendance_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.follow_up_records ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS members_workspace_access ON public.members;
CREATE POLICY members_workspace_access ON public.members
FOR ALL USING (public.can_access_workspace(owner_id))
WITH CHECK (public.can_access_workspace(owner_id));

DROP POLICY IF EXISTS attendance_sessions_workspace_access ON public.attendance_sessions;
CREATE POLICY attendance_sessions_workspace_access ON public.attendance_sessions
FOR ALL USING (public.can_access_workspace(owner_id))
WITH CHECK (public.can_access_workspace(owner_id));

DROP POLICY IF EXISTS attendance_records_workspace_access ON public.attendance_records;
CREATE POLICY attendance_records_workspace_access ON public.attendance_records
FOR ALL USING (public.can_access_workspace(owner_id))
WITH CHECK (public.can_access_workspace(owner_id));

DROP POLICY IF EXISTS follow_up_records_workspace_access ON public.follow_up_records;
CREATE POLICY follow_up_records_workspace_access ON public.follow_up_records
FOR ALL USING (public.can_access_workspace(owner_id))
WITH CHECK (public.can_access_workspace(owner_id));

CREATE OR REPLACE FUNCTION public.normalize_attendance_status(p_status TEXT)
RETURNS TEXT
LANGUAGE sql
IMMUTABLE
AS $$
    SELECT CASE
        WHEN LOWER(COALESCE(p_status, 'unknown')) IN ('present', 'p', 'yes', 'true') THEN 'present'
        WHEN LOWER(COALESCE(p_status, 'unknown')) IN ('absent', 'a', 'no', 'false') THEN 'absent'
        WHEN LOWER(COALESCE(p_status, 'unknown')) IN ('excused', 'excuse', 'excused_absence') THEN 'excused'
        ELSE 'unknown'
    END;
$$;

CREATE OR REPLACE FUNCTION public.upsert_follow_up_member(
    p_owner_id UUID,
    p_member_id UUID,
    p_full_name TEXT,
    p_phone_number TEXT DEFAULT NULL,
    p_parent_phone_number TEXT DEFAULT NULL,
    p_age_group TEXT DEFAULT NULL,
    p_gender TEXT DEFAULT NULL,
    p_ministry_group TEXT DEFAULT NULL,
    p_created_at TIMESTAMPTZ DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    PERFORM public.authorize_workspace_actor(p_owner_id);

    IF p_member_id IS NULL THEN
        RAISE EXCEPTION 'Member id is required';
    END IF;

    IF COALESCE(NULLIF(TRIM(p_full_name), ''), '') = '' THEN
        RAISE EXCEPTION 'Full name is required';
    END IF;

    INSERT INTO public.members (
        id,
        owner_id,
        full_name,
        phone_number,
        parent_phone_number,
        age_group,
        gender,
        ministry_group,
        created_at
    )
    VALUES (
        p_member_id,
        p_owner_id,
        p_full_name,
        p_phone_number,
        p_parent_phone_number,
        p_age_group,
        p_gender,
        p_ministry_group,
        COALESCE(p_created_at, NOW())
    )
    ON CONFLICT (id)
    DO UPDATE SET
        owner_id = EXCLUDED.owner_id,
        full_name = EXCLUDED.full_name,
        phone_number = EXCLUDED.phone_number,
        parent_phone_number = EXCLUDED.parent_phone_number,
        age_group = EXCLUDED.age_group,
        gender = EXCLUDED.gender,
        ministry_group = EXCLUDED.ministry_group,
        updated_at = NOW();

    RETURN jsonb_build_object('member_id', p_member_id);
END;
$$;

CREATE OR REPLACE FUNCTION public.upsert_attendance_record(
    p_owner_id UUID,
    p_service_date DATE,
    p_member_id UUID,
    p_status TEXT,
    p_marked_by UUID DEFAULT auth.uid(),
    p_title TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_requester UUID;
    v_session_id UUID;
    v_status TEXT := public.normalize_attendance_status(p_status);
BEGIN
    v_requester := public.authorize_workspace_actor(p_owner_id);

    IF p_service_date IS NULL THEN
        RAISE EXCEPTION 'Service date is required';
    END IF;

    IF p_member_id IS NULL THEN
        RAISE EXCEPTION 'Member id is required';
    END IF;

    INSERT INTO public.attendance_sessions (owner_id, service_date, title, month, year)
    VALUES (
        p_owner_id,
        p_service_date,
        COALESCE(p_title, 'Sunday Service'),
        TO_CHAR(p_service_date, 'Month'),
        EXTRACT(YEAR FROM p_service_date)::INTEGER
    )
    ON CONFLICT (owner_id, service_date)
    DO UPDATE SET
        title = COALESCE(EXCLUDED.title, public.attendance_sessions.title),
        month = EXCLUDED.month,
        year = EXCLUDED.year
    RETURNING id INTO v_session_id;

    INSERT INTO public.attendance_records (
        owner_id,
        member_id,
        session_id,
        status,
        marked_by
    )
    VALUES (
        p_owner_id,
        p_member_id,
        v_session_id,
        v_status,
        COALESCE(p_marked_by, v_requester)
    )
    ON CONFLICT (member_id, session_id)
    DO UPDATE SET
        owner_id = EXCLUDED.owner_id,
        status = EXCLUDED.status,
        marked_by = EXCLUDED.marked_by,
        updated_at = NOW();

    RETURN jsonb_build_object(
        'session_id', v_session_id,
        'member_id', p_member_id,
        'status', v_status
    );
END;
$$;

CREATE OR REPLACE FUNCTION public.upsert_follow_up_record(
    p_owner_id UUID,
    p_member_id UUID,
    p_reason TEXT,
    p_follow_up_status TEXT DEFAULT 'not_contacted',
    p_contact_method TEXT DEFAULT NULL,
    p_response TEXT DEFAULT NULL,
    p_next_action_date DATE DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_requester UUID;
    v_stage TEXT := COALESCE(NULLIF(p_follow_up_status, ''), 'not_contacted');
    v_id UUID;
BEGIN
    v_requester := public.authorize_workspace_actor(p_owner_id);

    IF p_member_id IS NULL THEN
        RAISE EXCEPTION 'Member id is required';
    END IF;

    IF v_stage NOT IN (
        'not_contacted',
        'message_sent',
        'called',
        'responded',
        'promised_to_come',
        'visited',
        'resolved'
    ) THEN
        RAISE EXCEPTION 'Invalid follow-up status: %', v_stage;
    END IF;

    INSERT INTO public.follow_up_records (
        owner_id,
        member_id,
        reason,
        follow_up_status,
        message_sent,
        contacted_by,
        contact_method,
        response,
        next_action_date
    )
    VALUES (
        p_owner_id,
        p_member_id,
        p_reason,
        v_stage,
        v_stage = 'message_sent',
        v_requester,
        p_contact_method,
        p_response,
        p_next_action_date
    )
    RETURNING id INTO v_id;

    RETURN jsonb_build_object('id', v_id, 'member_id', p_member_id, 'follow_up_status', v_stage);
END;
$$;

CREATE OR REPLACE FUNCTION public.calculate_follow_up_status(
    p_sessions_after_registration INTEGER,
    p_present_last4 INTEGER,
    p_absent_last4 INTEGER,
    p_excused_last4 INTEGER,
    p_known_last4 INTEGER,
    p_present_last12 INTEGER,
    p_absent_last12 INTEGER,
    p_known_last12 INTEGER,
    p_consecutive_absences INTEGER,
    p_days_since_last_attended INTEGER
)
RETURNS JSONB
LANGUAGE plpgsql
IMMUTABLE
AS $$
BEGIN
    IF COALESCE(p_sessions_after_registration, 0) < 4 OR COALESCE(p_known_last4, 0) < 4 THEN
        RETURN jsonb_build_object(
            'status', 'new',
            'reason', 'New/Insufficient Data'
        );
    END IF;

    IF (
        COALESCE(p_known_last12, 0) >= 12
        AND COALESCE(p_present_last12, 0) = 0
        AND COALESCE(p_absent_last12, 0) > 0
    ) OR COALESCE(p_days_since_last_attended, 0) >= 84 THEN
        RETURN jsonb_build_object('status', 'inactive', 'reason', 'No recent attendance for about 3 months');
    END IF;

    IF COALESCE(p_present_last4, 0) >= 3 THEN
        RETURN jsonb_build_object('status', 'regular', 'reason', 'Attended 3 or more of the last 4 Sundays');
    END IF;

    IF COALESCE(p_present_last4, 0) BETWEEN 1 AND 2 THEN
        RETURN jsonb_build_object('status', 'watch', 'reason', 'Attended only 1 or 2 of the last 4 Sundays');
    END IF;

    IF COALESCE(p_excused_last4, 0) > 0 AND COALESCE(p_absent_last4, 0) < 3 THEN
        RETURN jsonb_build_object('status', 'watch', 'reason', 'Recent absence is excused, so monitor without urgent follow-up');
    END IF;

    IF COALESCE(p_present_last4, 0) = 0
       AND (COALESCE(p_absent_last4, 0) >= 4 OR COALESCE(p_consecutive_absences, 0) >= 3) THEN
        RETURN jsonb_build_object('status', 'follow_up', 'reason', 'Needs follow-up because they missed recent Sundays');
    END IF;

    RETURN jsonb_build_object('status', 'new', 'reason', 'New/Insufficient Data');
END;
$$;

CREATE OR REPLACE FUNCTION public.get_follow_up_records(p_owner_id UUID)
RETURNS SETOF public.follow_up_records
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    PERFORM public.authorize_workspace_actor(p_owner_id);

    RETURN QUERY
    SELECT *
    FROM public.follow_up_records
    WHERE owner_id = p_owner_id
    ORDER BY created_at DESC;
END;
$$;

CREATE OR REPLACE FUNCTION public.get_attendance_follow_up_report(
    p_owner_id UUID,
    p_reference_date DATE DEFAULT CURRENT_DATE
)
RETURNS TABLE (
    member_id UUID,
    full_name TEXT,
    phone_number TEXT,
    total_sessions_checked INTEGER,
    present_count INTEGER,
    absent_count INTEGER,
    excused_count INTEGER,
    attendance_rate NUMERIC,
    last_attended_date DATE,
    consecutive_absences INTEGER,
    follow_up_status TEXT,
    follow_up_reason TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    PERFORM public.authorize_workspace_actor(p_owner_id);

    RETURN QUERY
    WITH recent_sessions AS (
        SELECT s.id, s.service_date, ROW_NUMBER() OVER (ORDER BY s.service_date DESC) AS rn
        FROM public.attendance_sessions s
        WHERE s.owner_id = p_owner_id
          AND s.service_date <= p_reference_date
        ORDER BY s.service_date DESC
        LIMIT 12
    ),
    member_sessions AS (
        SELECT
            m.id AS member_id,
            m.full_name,
            m.phone_number,
            rs.service_date,
            rs.rn,
            COALESCE(ar.status, 'unknown') AS status
        FROM public.members m
        LEFT JOIN recent_sessions rs
          ON rs.service_date >= m.created_at::DATE
        LEFT JOIN public.attendance_records ar
          ON ar.owner_id = p_owner_id
         AND ar.member_id = m.id
         AND ar.session_id = rs.id
        WHERE m.owner_id = p_owner_id
    ),
    member_rollup AS (
        SELECT
            ms.member_id,
            MAX(ms.full_name) AS full_name,
            MAX(ms.phone_number) AS phone_number,
            COUNT(ms.service_date)::INTEGER AS total_sessions_checked,
            COUNT(*) FILTER (WHERE ms.status = 'present')::INTEGER AS present_count,
            COUNT(*) FILTER (WHERE ms.status = 'absent')::INTEGER AS absent_count,
            COUNT(*) FILTER (WHERE ms.status = 'excused')::INTEGER AS excused_count,
            MAX(ms.service_date) FILTER (WHERE ms.status = 'present') AS last_attended_date,
            COUNT(*) FILTER (WHERE ms.rn <= 4 AND ms.status = 'present')::INTEGER AS present_last4,
            COUNT(*) FILTER (WHERE ms.rn <= 4 AND ms.status = 'absent')::INTEGER AS absent_last4,
            COUNT(*) FILTER (WHERE ms.rn <= 4 AND ms.status = 'excused')::INTEGER AS excused_last4,
            COUNT(*) FILTER (WHERE ms.rn <= 4 AND ms.status IN ('present', 'absent', 'excused'))::INTEGER AS known_last4,
            COUNT(*) FILTER (WHERE ms.rn <= 12 AND ms.status = 'present')::INTEGER AS present_last12,
            COUNT(*) FILTER (WHERE ms.rn <= 12 AND ms.status = 'absent')::INTEGER AS absent_last12,
            COUNT(*) FILTER (WHERE ms.rn <= 12 AND ms.status IN ('present', 'absent', 'excused'))::INTEGER AS known_last12,
            COALESCE((
                SELECT COUNT(*)::INTEGER
                FROM member_sessions recent_absences
                WHERE recent_absences.member_id = ms.member_id
                  AND recent_absences.status = 'absent'
                  AND recent_absences.rn < COALESCE((
                      SELECT MIN(stop_at.rn)
                      FROM member_sessions stop_at
                      WHERE stop_at.member_id = ms.member_id
                        AND stop_at.status <> 'absent'
                  ), 13)
            ), 0)::INTEGER AS consecutive_absences
        FROM member_sessions ms
        GROUP BY ms.member_id
    ),
    classified AS (
        SELECT
            mr.*,
            public.calculate_follow_up_status(
                mr.total_sessions_checked,
                mr.present_last4,
                mr.absent_last4,
                mr.excused_last4,
                mr.known_last4,
                mr.present_last12,
                mr.absent_last12,
                mr.known_last12,
                mr.consecutive_absences,
                CASE
                    WHEN mr.last_attended_date IS NULL THEN NULL
                    ELSE (p_reference_date - mr.last_attended_date)
                END
            ) AS classification
        FROM member_rollup mr
    )
    SELECT
        c.member_id,
        c.full_name,
        c.phone_number,
        c.total_sessions_checked,
        c.present_count,
        c.absent_count,
        c.excused_count,
        CASE
            WHEN (c.present_count + c.absent_count) > 0
            THEN ROUND((c.present_count::NUMERIC / (c.present_count + c.absent_count)::NUMERIC) * 100, 0)
            ELSE 0
        END AS attendance_rate,
        c.last_attended_date,
        c.consecutive_absences,
        c.classification->>'status' AS follow_up_status,
        c.classification->>'reason' AS follow_up_reason
    FROM classified c
    ORDER BY follow_up_status, attendance_rate ASC, full_name ASC;
END;
$$;

GRANT EXECUTE ON FUNCTION public.can_access_workspace(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.authorize_workspace_actor(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.normalize_attendance_status(TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.upsert_follow_up_member(UUID, UUID, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TIMESTAMPTZ) TO authenticated;
GRANT EXECUTE ON FUNCTION public.upsert_attendance_record(UUID, DATE, UUID, TEXT, UUID, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.upsert_follow_up_record(UUID, UUID, TEXT, TEXT, TEXT, TEXT, DATE) TO authenticated;
GRANT EXECUTE ON FUNCTION public.calculate_follow_up_status(INTEGER, INTEGER, INTEGER, INTEGER, INTEGER, INTEGER, INTEGER, INTEGER, INTEGER, INTEGER) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_follow_up_records(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_attendance_follow_up_report(UUID, DATE) TO authenticated;
