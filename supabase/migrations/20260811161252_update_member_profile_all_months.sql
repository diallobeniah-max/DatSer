-- Migration: All-Month Profile Correction (Paper Scan Review Apply)
-- Corrects current/global identity fields (Full Name, Phone Number, Gender,
-- date_of_birth) across every month table holding the canonical member UUID.
-- NEVER touches attendance, Age, Current Level, tags, badges, member_code,
-- deleted rows, or control columns.

create or replace function public.update_member_profile_all_months(
  p_owner_id uuid,
  p_member_id uuid,
  p_request_id text,
  p_updates jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_requester_id uuid;
  v_reserved_request_id text;
  v_existing_response jsonb;
  v_table_name text;
  v_new_key text;
  v_new_val jsonb;
  v_column_name text;
  v_set_clause text;
  v_sql text;
  v_old_row jsonb;
  v_new_row jsonb;
  v_old_slim jsonb;
  v_new_slim jsonb;
  v_scoped boolean;
  v_has_deleted boolean;
  v_has_updated boolean;
  v_rows_updated integer := 0;
  v_tables jsonb := '[]'::jsonb;
  v_now timestamptz := now();
  v_error_message text;
  v_response jsonb;
  v_success boolean := false;
  v_skipped_deleted text[] := array[]::text[];
  v_not_found text[] := array[]::text[];
  v_updated_count integer := 0;
  v_had_updates boolean := false;
  v_where constant text :=
    '(t.user_id = $2 or t.user_id in (
       select c.collaborator_user_id from public.collaborators c
       where c.owner_id = $2 and c.status in (''accepted'', ''active'')
     ))';
begin
  v_requester_id := public.authorize_workspace_actor(p_owner_id);

  if p_member_id is null then
    raise exception 'Member id is required';
  end if;

  if p_request_id is null or btrim(p_request_id) = '' then
    raise exception 'Request id is required';
  end if;

  if p_updates is null or jsonb_typeof(p_updates) <> 'object' then
    raise exception 'Updates payload must be a JSON object';
  end if;

  for v_new_key, v_new_val in select key, value from jsonb_each(p_updates)
  loop
    if v_new_key not in ('Full Name', 'Phone Number', 'Gender', 'date_of_birth') then
      raise exception 'Field % is not a propagate-safe profile field', v_new_key;
    end if;
    v_had_updates := true;
  end loop;

  if not v_had_updates then
    raise exception 'No propagate-safe profile fields supplied';
  end if;

  insert into public.member_mutation_idempotency (
    owner_id, table_name, operation_name, request_id, created_by, status, response
  )
  values (
    p_owner_id, '__profile_all_months', 'update_member_profile_all_months',
    p_request_id, v_requester_id, 'processing', null
  )
  on conflict (owner_id, table_name, operation_name, request_id) do nothing
  returning request_id into v_reserved_request_id;

  if v_reserved_request_id is null then
    select m.response into v_existing_response
    from public.member_mutation_idempotency m
    where m.owner_id = p_owner_id
      and m.table_name = '__profile_all_months'
      and m.operation_name = 'update_member_profile_all_months'
      and m.request_id = p_request_id;

    if v_existing_response is not null then
      return v_existing_response;
    end if;

    return jsonb_build_object(
      'success', false,
      'error_message', 'Duplicate request is still being processed'
    );
  end if;

  insert into public.member_bundle_audit_log (
    owner_id, table_name, operation_name, request_id, actor_id, status
  )
  values (
    p_owner_id, '__profile_all_months', 'update_member_profile_all_months',
    p_request_id, v_requester_id, 'processing'
  )
  on conflict (owner_id, table_name, operation_name, request_id) do nothing;

  begin
    for v_table_name in
      select umt.table_name
      from public.user_month_tables umt
      where umt.user_id = p_owner_id
      order by umt.created_at desc, umt.id desc
    loop
      if to_regclass(format('public.%I', v_table_name)) is null then
        continue;
      end if;

      select public.month_table_column_exists(v_table_name, 'deleted_at') into v_has_deleted;
      select public.month_table_column_exists(v_table_name, 'updated_at') into v_has_updated;

      v_sql := format('select exists(select 1 from %I t where t.id = $1 and %s)', v_table_name, v_where);
      execute v_sql into v_scoped using p_member_id, p_owner_id;

      if not v_scoped then
        v_not_found := v_not_found || v_table_name;
        continue;
      end if;

      if v_has_deleted then
        v_sql := format(
          'select (t.deleted_at is not null) from %I t where t.id = $1 and %s',
          v_table_name, v_where
        );
        execute v_sql into v_scoped using p_member_id, p_owner_id;

        if v_scoped then
          v_skipped_deleted := v_skipped_deleted || v_table_name;
          continue;
        end if;
      end if;

      if v_has_deleted then
        v_sql := format(
          'select to_jsonb(t.*) from %I t where t.id = $1 and %s and t.deleted_at is null for update',
          v_table_name, v_where
        );
      else
        v_sql := format(
          'select to_jsonb(t.*) from %I t where t.id = $1 and %s for update',
          v_table_name, v_where
        );
      end if;
      execute v_sql into v_old_row using p_member_id, p_owner_id;

      if v_old_row is null then
        v_not_found := v_not_found || v_table_name;
        continue;
      end if;

      v_set_clause := '';
      for v_new_key, v_new_val in select key, value from jsonb_each(p_updates)
      loop
        if v_new_key = 'Full Name' then
          if public.month_table_column_exists(v_table_name, 'Full Name') then
            v_column_name := 'Full Name';
          elsif public.month_table_column_exists(v_table_name, 'full_name') then
            v_column_name := 'full_name';
          else
            continue;
          end if;
        elsif v_new_key = 'Phone Number' then
          if public.month_table_column_exists(v_table_name, 'Phone Number') then
            v_column_name := 'Phone Number';
          elsif public.month_table_column_exists(v_table_name, 'phone_number') then
            v_column_name := 'phone_number';
          else
            continue;
          end if;
        elsif v_new_key = 'Gender' then
          if public.month_table_column_exists(v_table_name, 'Gender') then
            v_column_name := 'Gender';
          else
            continue;
          end if;
        else
          if public.month_table_column_exists(v_table_name, 'date_of_birth') then
            v_column_name := 'date_of_birth';
          elsif public.month_table_column_exists(v_table_name, 'Date of Birth') then
            v_column_name := 'Date of Birth';
          else
            continue;
          end if;
        end if;

        if v_set_clause <> '' then
          v_set_clause := v_set_clause || ', ';
        end if;

        if v_new_val is null or v_new_val = 'null'::jsonb then
          v_set_clause := v_set_clause || format('%I = null', v_column_name);
        else
          v_set_clause := v_set_clause || format('%I = %L', v_column_name, v_new_val #>> '{}');
        end if;
      end loop;

      if v_set_clause = '' then
        continue;
      end if;

      if v_has_updated then
        v_set_clause := v_set_clause || ', updated_at = now()';
      end if;

      if v_has_deleted then
        v_sql := format(
          'update %I t set %s where t.id = $1 and %s and t.deleted_at is null',
          v_table_name, v_set_clause, v_where
        );
      else
        v_sql := format('update %I t set %s where t.id = $1 and %s', v_table_name, v_set_clause, v_where);
      end if;
      execute v_sql using p_member_id, p_owner_id;
      get diagnostics v_rows_updated = row_count;

      if v_rows_updated = 0 then
        if v_has_deleted then
          v_sql := format(
            'select (t.deleted_at is not null) from %I t where t.id = $1 and %s',
            v_table_name, v_where
          );
          execute v_sql into v_scoped using p_member_id, p_owner_id;
          if v_scoped then
            v_skipped_deleted := v_skipped_deleted || v_table_name;
            continue;
          end if;
        end if;
        v_not_found := v_not_found || v_table_name;
        continue;
      end if;
      v_updated_count := v_updated_count + 1;

      v_sql := format('select to_jsonb(t.*) from %I t where t.id = $1 and %s', v_table_name, v_where);
      execute v_sql into v_new_row using p_member_id, p_owner_id;

      select jsonb_build_object(
        'Full Name',     coalesce(v_old_row #>> '{Full Name}', v_old_row #>> '{full_name}'),
        'Phone Number',  coalesce(v_old_row #>> '{Phone Number}', v_old_row #>> '{phone_number}'),
        'Gender',        v_old_row #>> '{Gender}',
        'date_of_birth', coalesce(v_old_row #>> '{date_of_birth}', v_old_row #>> '{Date of Birth}')
      ) into v_old_slim;

      select jsonb_build_object(
        'Full Name',     coalesce(v_new_row #>> '{Full Name}', v_new_row #>> '{full_name}'),
        'Phone Number',  coalesce(v_new_row #>> '{Phone Number}', v_new_row #>> '{phone_number}'),
        'Gender',        v_new_row #>> '{Gender}',
        'date_of_birth', coalesce(v_new_row #>> '{date_of_birth}', v_new_row #>> '{Date of Birth}')
      ) into v_new_slim;

      v_tables := v_tables || jsonb_build_object(
        'table_name', v_table_name,
        'member_id', p_member_id,
        'changed', true,
        'old', v_old_slim,
        'new', v_new_slim
      );
    end loop;

    if v_updated_count = 0 then
      raise exception 'Member % has no active workspace month rows to correct (skipped_deleted=% , not_found=% )',
        p_member_id,
        coalesce(array_length(v_skipped_deleted, 1), 0),
        coalesce(array_length(v_not_found, 1), 0);
    end if;

    v_success := true;
    v_response := jsonb_build_object(
      'success', true,
      'request_id', p_request_id,
      'member_id', p_member_id,
      'operation', 'update_member_profile_all_months',
      'updated_tables_count', v_updated_count,
      'tables', v_tables,
      'skipped_deleted', to_jsonb(v_skipped_deleted),
      'not_found', to_jsonb(v_not_found),
      'recovered', false,
      'receipt', jsonb_build_object(
        'request_id', p_request_id,
        'timestamp', v_now,
        'status', 'success'
      )
    );
  exception when others then
    v_error_message := SQLERRM;
    v_response := jsonb_build_object(
      'success', false,
      'request_id', p_request_id,
      'member_id', p_member_id,
      'operation', 'update_member_profile_all_months',
      'error_message', v_error_message,
      'tables', v_tables,
      'skipped_deleted', to_jsonb(v_skipped_deleted),
      'not_found', to_jsonb(v_not_found),
      'recovered', false,
      'receipt', jsonb_build_object(
        'request_id', p_request_id,
        'timestamp', v_now,
        'status', 'failed'
      )
    );
  end;

  update public.member_mutation_idempotency m
  set response = v_response,
      status = case when v_success then 'success' else 'failed' end,
      error_message = case when v_success then null else v_response->>'error_message' end,
      completed_at = now()
  where m.owner_id = p_owner_id
    and m.table_name = '__profile_all_months'
    and m.operation_name = 'update_member_profile_all_months'
    and m.request_id = p_request_id;

  update public.member_bundle_audit_log a
  set response = v_response,
      status = case when v_success then 'success' else 'failed' end,
      error_message = case when v_success then null else v_response->>'error_message' end,
      completed_at = now()
  where a.owner_id = p_owner_id
    and a.table_name = '__profile_all_months'
    and a.operation_name = 'update_member_profile_all_months'
    and a.request_id = p_request_id;

  return v_response;
end;
$$;

revoke all on function public.update_member_profile_all_months(uuid, uuid, text, jsonb) from public, anon;
grant execute on function public.update_member_profile_all_months(uuid, uuid, text, jsonb) to authenticated;

notify pgrst, 'reload schema';;
