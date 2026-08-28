CREATE TABLE IF NOT EXISTS public.member_mutation_idempotency (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    owner_id UUID NOT NULL,
    table_name TEXT NOT NULL,
    operation_name TEXT NOT NULL,
    request_id TEXT NOT NULL,
    created_by UUID NOT NULL,
    status TEXT NOT NULL DEFAULT 'processing',
    error_message TEXT,
    response JSONB,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    completed_at TIMESTAMPTZ,
    CONSTRAINT member_mutation_idempotency_unique UNIQUE (owner_id, table_name, operation_name, request_id)
);

ALTER TABLE public.member_mutation_idempotency
    ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'processing';
ALTER TABLE public.member_mutation_idempotency
    ADD COLUMN IF NOT EXISTS error_message TEXT;

CREATE INDEX IF NOT EXISTS idx_member_mutation_idempotency_lookup
    ON public.member_mutation_idempotency (owner_id, table_name, operation_name, request_id);

CREATE TABLE IF NOT EXISTS public.member_bundle_audit_log (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    owner_id UUID NOT NULL,
    table_name TEXT NOT NULL,
    operation_name TEXT NOT NULL,
    request_id TEXT NOT NULL,
    actor_id UUID NOT NULL,
    status TEXT NOT NULL DEFAULT 'processing',
    error_message TEXT,
    response JSONB,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    completed_at TIMESTAMPTZ,
    CONSTRAINT member_bundle_audit_log_unique UNIQUE (owner_id, table_name, operation_name, request_id)
);

CREATE INDEX IF NOT EXISTS idx_member_bundle_audit_lookup
    ON public.member_bundle_audit_log (owner_id, table_name, operation_name, request_id);

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

    IF NOT (
        v_requester_id = p_owner_id OR EXISTS (
            SELECT 1
            FROM public.collaborators c
            WHERE c.owner_id = p_owner_id
              AND c.status IN ('accepted', 'active')
              AND (
                  c.collaborator_user_id = v_requester_id
                  OR EXISTS (
                      SELECT 1
                      FROM auth.users au
                      WHERE au.id = v_requester_id
                        AND (c.email = au.email OR c.email ILIKE au.email)
                  )
              )
        )
    ) THEN
        RAISE EXCEPTION 'Not authorized to mutate this workspace';
    END IF;

    RETURN v_requester_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.month_table_column_exists(
    p_table_name TEXT,
    p_column_name TEXT
)
RETURNS BOOLEAN
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
    SELECT EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = p_table_name
          AND column_name = p_column_name
    );
$$;

CREATE OR REPLACE FUNCTION public.add_attendance_column(
    table_name TEXT,
    column_name TEXT
)
RETURNS BOOLEAN
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

    IF table_name IS NULL OR table_name = '' THEN
        RAISE EXCEPTION 'Table name is required';
    END IF;

    IF column_name IS NULL OR column_name !~ '^attendance_[0-9]{4}_[0-9]{2}_[0-9]{2}$' THEN
        RAISE EXCEPTION 'Invalid attendance column name';
    END IF;

    EXECUTE format('ALTER TABLE %I ADD COLUMN IF NOT EXISTS %I TEXT', table_name, column_name);
    RETURN TRUE;
END;
$$;

CREATE OR REPLACE FUNCTION public.save_member_bundle(
    p_table_name TEXT,
    p_owner_id UUID,
    p_request_id TEXT,
    p_member JSONB,
    p_badges TEXT[] DEFAULT ARRAY[]::TEXT[],
    p_tag_ids UUID[] DEFAULT ARRAY[]::UUID[],
    p_attendance JSONB DEFAULT '{}'::JSONB
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_requester_id UUID;
    v_existing_response JSONB;
    v_reserved_request_id TEXT;
    v_insert_columns TEXT := '';
    v_insert_values TEXT := '';
    v_sql TEXT;
    v_member_id UUID;
    v_key TEXT;
    v_val JSONB;
    v_badge TEXT;
    v_tag_id UUID;
    v_date_key TEXT;
    v_attendance_value JSONB;
    v_present BOOLEAN;
    v_column_name TEXT;
    v_now TIMESTAMPTZ := NOW();
    v_error_message TEXT;
    v_response JSONB;
    v_success BOOLEAN := FALSE;
BEGIN
    v_requester_id := public.authorize_workspace_actor(p_owner_id);

    IF p_table_name IS NULL OR p_table_name = '' THEN
        RAISE EXCEPTION 'Table name is required';
    END IF;

    IF p_request_id IS NULL OR btrim(p_request_id) = '' THEN
        RAISE EXCEPTION 'Request id is required';
    END IF;

    IF p_member IS NULL OR jsonb_typeof(p_member) <> 'object' THEN
        RAISE EXCEPTION 'Member payload must be a JSON object';
    END IF;

    INSERT INTO public.member_mutation_idempotency (
        owner_id,
        table_name,
        operation_name,
        request_id,
        created_by,
        status,
        response
    )
    VALUES (
        p_owner_id,
        p_table_name,
        'save_member_bundle',
        p_request_id,
        v_requester_id,
        'processing',
        NULL
    )
    ON CONFLICT (owner_id, table_name, operation_name, request_id) DO NOTHING
    RETURNING request_id INTO v_reserved_request_id;

    IF v_reserved_request_id IS NULL THEN
        SELECT response
        INTO v_existing_response
        FROM public.member_mutation_idempotency
        WHERE owner_id = p_owner_id
          AND table_name = p_table_name
          AND operation_name = 'save_member_bundle'
          AND request_id = p_request_id;

        IF v_existing_response IS NOT NULL THEN
            RETURN v_existing_response;
        END IF;

        RETURN jsonb_build_object(
            'success', FALSE,
            'request_id', p_request_id,
            'table_name', p_table_name,
            'operation', 'save_member_bundle',
            'error_message', 'Duplicate request is still being processed',
            'receipt', jsonb_build_object(
                'request_id', p_request_id,
                'timestamp', v_now,
                'status', 'processing'
            )
        );
    END IF;

    INSERT INTO public.member_bundle_audit_log (
        owner_id,
        table_name,
        operation_name,
        request_id,
        actor_id,
        status
    )
    VALUES (
        p_owner_id,
        p_table_name,
        'save_member_bundle',
        p_request_id,
        v_requester_id,
        'processing'
    )
    ON CONFLICT (owner_id, table_name, operation_name, request_id) DO NOTHING;

    BEGIN
        FOR v_key, v_val IN SELECT key, value FROM jsonb_each(p_member)
        LOOP
            IF v_key = 'id' THEN
                CONTINUE;
            END IF;

            IF NOT public.month_table_column_exists(p_table_name, v_key) THEN
                RAISE EXCEPTION 'Column % does not exist on %', v_key, p_table_name;
            END IF;

            IF v_insert_columns <> '' THEN
                v_insert_columns := v_insert_columns || ', ';
                v_insert_values := v_insert_values || ', ';
            END IF;

            v_insert_columns := v_insert_columns || format('%I', v_key);

            IF v_val IS NULL OR v_val = 'null'::JSONB THEN
                v_insert_values := v_insert_values || 'NULL';
            ELSE
                v_insert_values := v_insert_values || format('%L', v_val #>> '{}');
            END IF;
        END LOOP;

        IF v_insert_columns = '' THEN
            RAISE EXCEPTION 'No valid member fields supplied';
        END IF;

        v_sql := format(
            'INSERT INTO %I (%s) VALUES (%s) RETURNING id',
            p_table_name,
            v_insert_columns,
            v_insert_values
        );

        EXECUTE v_sql INTO v_member_id;

        IF v_member_id IS NULL THEN
            RAISE EXCEPTION 'Member insert did not return an id';
        END IF;

        IF p_badges IS NOT NULL THEN
            IF public.month_table_column_exists(p_table_name, 'Member') THEN
                EXECUTE format('UPDATE %I SET %I = NULL WHERE id = $1', p_table_name, 'Member') USING v_member_id;
            END IF;
            IF public.month_table_column_exists(p_table_name, 'Regular') THEN
                EXECUTE format('UPDATE %I SET %I = NULL WHERE id = $1', p_table_name, 'Regular') USING v_member_id;
            END IF;
            IF public.month_table_column_exists(p_table_name, 'Newcomer') THEN
                EXECUTE format('UPDATE %I SET %I = NULL WHERE id = $1', p_table_name, 'Newcomer') USING v_member_id;
            END IF;

            FOREACH v_badge IN ARRAY COALESCE(p_badges, ARRAY[]::TEXT[])
            LOOP
                CASE lower(v_badge)
                    WHEN 'member' THEN
                        IF public.month_table_column_exists(p_table_name, 'Member') THEN
                            EXECUTE format('UPDATE %I SET %I = %L WHERE id = $1', p_table_name, 'Member', 'Yes') USING v_member_id;
                        END IF;
                    WHEN 'regular' THEN
                        IF public.month_table_column_exists(p_table_name, 'Regular') THEN
                            EXECUTE format('UPDATE %I SET %I = %L WHERE id = $1', p_table_name, 'Regular', 'Yes') USING v_member_id;
                        END IF;
                    WHEN 'newcomer' THEN
                        IF public.month_table_column_exists(p_table_name, 'Newcomer') THEN
                            EXECUTE format('UPDATE %I SET %I = %L WHERE id = $1', p_table_name, 'Newcomer', 'Yes') USING v_member_id;
                        END IF;
                    ELSE
                        RAISE EXCEPTION 'Unsupported badge value: %', v_badge;
                END CASE;
            END LOOP;
        END IF;

        IF p_tag_ids IS NOT NULL THEN
            FOREACH v_tag_id IN ARRAY COALESCE(p_tag_ids, ARRAY[]::UUID[])
            LOOP
                IF NOT EXISTS (
                    SELECT 1
                    FROM public.tags t
                    WHERE t.id = v_tag_id
                      AND t.owner_id = p_owner_id
                ) THEN
                    RAISE EXCEPTION 'Tag % not found or access denied', v_tag_id;
                END IF;

                INSERT INTO public.member_tags (tag_id, member_id, table_name)
                VALUES (v_tag_id, v_member_id, p_table_name)
                ON CONFLICT (tag_id, member_id, table_name) DO NOTHING;
            END LOOP;
        END IF;

        IF p_attendance IS NOT NULL THEN
            IF jsonb_typeof(p_attendance) <> 'object' THEN
                RAISE EXCEPTION 'Attendance payload must be a JSON object';
            END IF;

            FOR v_date_key, v_attendance_value IN SELECT key, value FROM jsonb_each(p_attendance)
            LOOP
                IF v_date_key !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' THEN
                    RAISE EXCEPTION 'Invalid attendance date key: %', v_date_key;
                END IF;

                v_column_name := 'attendance_' || replace(v_date_key, '-', '_');
                EXECUTE format('ALTER TABLE %I ADD COLUMN IF NOT EXISTS %I TEXT', p_table_name, v_column_name);

                IF v_attendance_value IS NULL OR v_attendance_value = 'null'::JSONB THEN
                    EXECUTE format('UPDATE %I SET %I = NULL WHERE id = $1', p_table_name, v_column_name) USING v_member_id;
                ELSE
                    v_present := (v_attendance_value #>> '{}')::BOOLEAN;
                    EXECUTE format(
                        'UPDATE %I SET %I = %L WHERE id = $1',
                        p_table_name,
                        v_column_name,
                        CASE WHEN v_present THEN 'Present' ELSE 'Absent' END
                    ) USING v_member_id;
                END IF;
            END LOOP;
        END IF;

        v_success := TRUE;
        v_response := jsonb_build_object(
            'success', TRUE,
            'member_id', v_member_id,
            'table_name', p_table_name,
            'request_id', p_request_id,
            'operation', 'save_member_bundle',
            'receipt', jsonb_build_object(
                'request_id', p_request_id,
                'timestamp', v_now,
                'status', 'success'
            )
        );
    EXCEPTION WHEN OTHERS THEN
        v_error_message := SQLERRM;
        v_response := jsonb_build_object(
            'success', FALSE,
            'member_id', v_member_id,
            'table_name', p_table_name,
            'request_id', p_request_id,
            'operation', 'save_member_bundle',
            'error_message', v_error_message,
            'receipt', jsonb_build_object(
                'request_id', p_request_id,
                'timestamp', v_now,
                'status', 'failed'
            )
        );
    END;

    UPDATE public.member_mutation_idempotency
    SET response = v_response,
        status = CASE WHEN v_success THEN 'success' ELSE 'failed' END,
        error_message = CASE WHEN v_success THEN NULL ELSE COALESCE(v_error_message, v_response->>'error_message') END,
        completed_at = NOW()
    WHERE owner_id = p_owner_id
      AND table_name = p_table_name
      AND operation_name = 'save_member_bundle'
      AND request_id = p_request_id;

    UPDATE public.member_bundle_audit_log
    SET response = v_response,
        status = CASE WHEN v_success THEN 'success' ELSE 'failed' END,
        error_message = CASE WHEN v_success THEN NULL ELSE COALESCE(v_error_message, v_response->>'error_message') END,
        completed_at = NOW()
    WHERE owner_id = p_owner_id
      AND table_name = p_table_name
      AND operation_name = 'save_member_bundle'
      AND request_id = p_request_id;

    RETURN v_response;
END;
$$;

CREATE OR REPLACE FUNCTION public.update_member_bundle(
    p_table_name TEXT,
    p_owner_id UUID,
    p_member_id UUID,
    p_request_id TEXT,
    p_updates JSONB DEFAULT '{}'::JSONB,
    p_badges TEXT[] DEFAULT NULL,
    p_tag_ids UUID[] DEFAULT NULL,
    p_attendance JSONB DEFAULT '{}'::JSONB
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_requester_id UUID;
    v_existing_response JSONB;
    v_reserved_request_id TEXT;
    v_set_clause TEXT := '';
    v_sql TEXT;
    v_key TEXT;
    v_val JSONB;
    v_badge TEXT;
    v_tag_id UUID;
    v_date_key TEXT;
    v_attendance_value JSONB;
    v_present BOOLEAN;
    v_column_name TEXT;
    v_now TIMESTAMPTZ := NOW();
    v_error_message TEXT;
    v_response JSONB;
    v_success BOOLEAN := FALSE;
BEGIN
    v_requester_id := public.authorize_workspace_actor(p_owner_id);

    IF p_table_name IS NULL OR p_table_name = '' THEN
        RAISE EXCEPTION 'Table name is required';
    END IF;

    IF p_member_id IS NULL THEN
        RAISE EXCEPTION 'Member id is required';
    END IF;

    IF p_request_id IS NULL OR btrim(p_request_id) = '' THEN
        RAISE EXCEPTION 'Request id is required';
    END IF;

    INSERT INTO public.member_mutation_idempotency (
        owner_id,
        table_name,
        operation_name,
        request_id,
        created_by,
        status,
        response
    )
    VALUES (
        p_owner_id,
        p_table_name,
        'update_member_bundle',
        p_request_id,
        v_requester_id,
        'processing',
        NULL
    )
    ON CONFLICT (owner_id, table_name, operation_name, request_id) DO NOTHING
    RETURNING request_id INTO v_reserved_request_id;

    IF v_reserved_request_id IS NULL THEN
        SELECT response
        INTO v_existing_response
        FROM public.member_mutation_idempotency
        WHERE owner_id = p_owner_id
          AND table_name = p_table_name
          AND operation_name = 'update_member_bundle'
          AND request_id = p_request_id;

        IF v_existing_response IS NOT NULL THEN
            RETURN v_existing_response;
        END IF;

        RETURN jsonb_build_object(
            'success', FALSE,
            'request_id', p_request_id,
            'table_name', p_table_name,
            'operation', 'update_member_bundle',
            'error_message', 'Duplicate request is still being processed',
            'receipt', jsonb_build_object(
                'request_id', p_request_id,
                'timestamp', v_now,
                'status', 'processing'
            )
        );
    END IF;

    INSERT INTO public.member_bundle_audit_log (
        owner_id,
        table_name,
        operation_name,
        request_id,
        actor_id,
        status
    )
    VALUES (
        p_owner_id,
        p_table_name,
        'update_member_bundle',
        p_request_id,
        v_requester_id,
        'processing'
    )
    ON CONFLICT (owner_id, table_name, operation_name, request_id) DO NOTHING;

    BEGIN
        IF p_updates IS NOT NULL THEN
            IF jsonb_typeof(p_updates) <> 'object' THEN
                RAISE EXCEPTION 'Update payload must be a JSON object';
            END IF;

            FOR v_key, v_val IN SELECT key, value FROM jsonb_each(p_updates)
            LOOP
                IF v_key = 'id' THEN
                    CONTINUE;
                END IF;

                IF NOT public.month_table_column_exists(p_table_name, v_key) THEN
                    RAISE EXCEPTION 'Column % does not exist on %', v_key, p_table_name;
                END IF;

                IF v_set_clause <> '' THEN
                    v_set_clause := v_set_clause || ', ';
                END IF;

                IF v_val IS NULL OR v_val = 'null'::JSONB THEN
                    v_set_clause := v_set_clause || format('%I = NULL', v_key);
                ELSE
                    v_set_clause := v_set_clause || format('%I = %L', v_key, v_val #>> '{}');
                END IF;
            END LOOP;

            IF v_set_clause <> '' THEN
                v_sql := format('UPDATE %I SET %s WHERE id = $1', p_table_name, v_set_clause);
                EXECUTE v_sql USING p_member_id;
            END IF;
        END IF;

        IF p_badges IS NOT NULL THEN
            IF public.month_table_column_exists(p_table_name, 'Member') THEN
                EXECUTE format('UPDATE %I SET %I = NULL WHERE id = $1', p_table_name, 'Member') USING p_member_id;
            END IF;
            IF public.month_table_column_exists(p_table_name, 'Regular') THEN
                EXECUTE format('UPDATE %I SET %I = NULL WHERE id = $1', p_table_name, 'Regular') USING p_member_id;
            END IF;
            IF public.month_table_column_exists(p_table_name, 'Newcomer') THEN
                EXECUTE format('UPDATE %I SET %I = NULL WHERE id = $1', p_table_name, 'Newcomer') USING p_member_id;
            END IF;

            FOREACH v_badge IN ARRAY COALESCE(p_badges, ARRAY[]::TEXT[])
            LOOP
                CASE lower(v_badge)
                    WHEN 'member' THEN
                        IF public.month_table_column_exists(p_table_name, 'Member') THEN
                            EXECUTE format('UPDATE %I SET %I = %L WHERE id = $1', p_table_name, 'Member', 'Yes') USING p_member_id;
                        END IF;
                    WHEN 'regular' THEN
                        IF public.month_table_column_exists(p_table_name, 'Regular') THEN
                            EXECUTE format('UPDATE %I SET %I = %L WHERE id = $1', p_table_name, 'Regular', 'Yes') USING p_member_id;
                        END IF;
                    WHEN 'newcomer' THEN
                        IF public.month_table_column_exists(p_table_name, 'Newcomer') THEN
                            EXECUTE format('UPDATE %I SET %I = %L WHERE id = $1', p_table_name, 'Newcomer', 'Yes') USING p_member_id;
                        END IF;
                    ELSE
                        RAISE EXCEPTION 'Unsupported badge value: %', v_badge;
                END CASE;
            END LOOP;
        END IF;

        IF p_tag_ids IS NOT NULL THEN
            DELETE FROM public.member_tags
            WHERE member_id = p_member_id
              AND table_name = p_table_name;

            FOREACH v_tag_id IN ARRAY COALESCE(p_tag_ids, ARRAY[]::UUID[])
            LOOP
                IF NOT EXISTS (
                    SELECT 1
                    FROM public.tags t
                    WHERE t.id = v_tag_id
                      AND t.owner_id = p_owner_id
                ) THEN
                    RAISE EXCEPTION 'Tag % not found or access denied', v_tag_id;
                END IF;

                INSERT INTO public.member_tags (tag_id, member_id, table_name)
                VALUES (v_tag_id, p_member_id, p_table_name)
                ON CONFLICT (tag_id, member_id, table_name) DO NOTHING;
            END LOOP;
        END IF;

        IF p_attendance IS NOT NULL THEN
            IF jsonb_typeof(p_attendance) <> 'object' THEN
                RAISE EXCEPTION 'Attendance payload must be a JSON object';
            END IF;

            FOR v_date_key, v_attendance_value IN SELECT key, value FROM jsonb_each(p_attendance)
            LOOP
                IF v_date_key !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' THEN
                    RAISE EXCEPTION 'Invalid attendance date key: %', v_date_key;
                END IF;

                v_column_name := 'attendance_' || replace(v_date_key, '-', '_');
                EXECUTE format('ALTER TABLE %I ADD COLUMN IF NOT EXISTS %I TEXT', p_table_name, v_column_name);

                IF v_attendance_value IS NULL OR v_attendance_value = 'null'::JSONB THEN
                    EXECUTE format('UPDATE %I SET %I = NULL WHERE id = $1', p_table_name, v_column_name) USING p_member_id;
                ELSE
                    v_present := (v_attendance_value #>> '{}')::BOOLEAN;
                    EXECUTE format(
                        'UPDATE %I SET %I = %L WHERE id = $1',
                        p_table_name,
                        v_column_name,
                        CASE WHEN v_present THEN 'Present' ELSE 'Absent' END
                    ) USING p_member_id;
                END IF;
            END LOOP;
        END IF;

        v_success := TRUE;
        v_response := jsonb_build_object(
            'success', TRUE,
            'member_id', p_member_id,
            'table_name', p_table_name,
            'request_id', p_request_id,
            'operation', 'update_member_bundle',
            'receipt', jsonb_build_object(
                'request_id', p_request_id,
                'timestamp', v_now,
                'status', 'success'
            )
        );
    EXCEPTION WHEN OTHERS THEN
        v_error_message := SQLERRM;
        v_response := jsonb_build_object(
            'success', FALSE,
            'member_id', p_member_id,
            'table_name', p_table_name,
            'request_id', p_request_id,
            'operation', 'update_member_bundle',
            'error_message', v_error_message,
            'receipt', jsonb_build_object(
                'request_id', p_request_id,
                'timestamp', v_now,
                'status', 'failed'
            )
        );
    END;

    UPDATE public.member_mutation_idempotency
    SET response = v_response,
        status = CASE WHEN v_success THEN 'success' ELSE 'failed' END,
        error_message = CASE WHEN v_success THEN NULL ELSE COALESCE(v_error_message, v_response->>'error_message') END,
        completed_at = NOW()
    WHERE owner_id = p_owner_id
      AND table_name = p_table_name
      AND operation_name = 'update_member_bundle'
      AND request_id = p_request_id;

    UPDATE public.member_bundle_audit_log
    SET response = v_response,
        status = CASE WHEN v_success THEN 'success' ELSE 'failed' END,
        error_message = CASE WHEN v_success THEN NULL ELSE COALESCE(v_error_message, v_response->>'error_message') END,
        completed_at = NOW()
    WHERE owner_id = p_owner_id
      AND table_name = p_table_name
      AND operation_name = 'update_member_bundle'
      AND request_id = p_request_id;

    RETURN v_response;
END;
$$;

GRANT EXECUTE ON FUNCTION public.authorize_workspace_actor(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.month_table_column_exists(TEXT, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.add_attendance_column(TEXT, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.save_member_bundle(TEXT, UUID, TEXT, JSONB, TEXT[], UUID[], JSONB) TO authenticated;
GRANT EXECUTE ON FUNCTION public.update_member_bundle(TEXT, UUID, UUID, TEXT, JSONB, TEXT[], UUID[], JSONB) TO authenticated;
