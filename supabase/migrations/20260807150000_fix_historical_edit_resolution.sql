-- Fix: historical member edits fail with "Member recovery found 0 matching rows"
-- when the historical row's user_id differs from the current workspace owner id.
--
-- Root cause: resolve_member_update_target (and the post-verification in the
-- resilient update functions) required `user_id = p_owner_id` for both the exact
-- source-row id lookup and the name/phone recovery. Older month tables contain
-- legitimate workspace rows created under collaborator/legacy account ids, so a
-- valid historical member in the requested source table could not be resolved.
--
-- Security model preserved (workspace authorization stays strict):
--   1. authorize_workspace_actor(p_owner_id) still requires the caller to be the
--      owner or an accepted collaborator of that workspace.
--   2. A row is editable only if it provably belongs to the authorized
--      workspace: row.user_id = p_owner_id, OR row.user_id is an accepted/active
--      collaborator of p_owner_id (collaborators table). NOTE: user_month_tables
--      is intentionally NOT used as an ownership proof because every workspace
--      account is registered for the shared month tables
--      (share_all_months_with_workspace_accounts); only the collaborator
--      membership of the row's user_id is a deterministic ownership signal.
--   3. Recovery still requires EXACTLY ONE safe, workspace-scoped match. 0 or >1
--      matches => "Member recovery found N matching rows; update was not applied"
--      (no silent ambiguity, no name-similarity fallback, no cross-workspace row).

create or replace function public.resolve_member_update_target(
  p_table_name text,
  p_owner_id uuid,
  p_member_id uuid,
  p_identity jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_name_column text;
  v_phone_column text;
  v_name text := nullif(btrim(coalesce(p_identity->>'full_name', '')), '');
  v_phone text := nullif(btrim(coalesce(p_identity->>'phone_number', '')), '');
  v_ids uuid[];
  v_count integer := 0;
begin
  perform public.authorize_workspace_actor(p_owner_id);

  if p_table_name is null or p_table_name = '' or p_owner_id is null or p_member_id is null then
    raise exception 'Invalid member identity parameters';
  end if;

  if to_regclass(format('public.%I', p_table_name)) is null then
    raise exception 'Month table not found';
  end if;

  -- B. Exact source-row id match, scoped to the authorized workspace: the row's
  -- user_id must be the owner or an accepted/active collaborator of the owner.
  execute format(
    'select array_agg(id), count(*) from %I
     where id = $1 and deleted_at is null
       and (user_id = $2 or user_id in (
         select collaborator_user_id from public.collaborators
         where owner_id = $2 and status in (''accepted'', ''active'')
       ))',
    p_table_name
  ) into v_ids, v_count using p_member_id, p_owner_id;

  if v_count = 1 then
    return jsonb_build_object(
      'member_id', v_ids[1],
      'table_name', p_table_name,
      'recovered', false
    );
  end if;

  select case
      when public.month_table_column_exists(p_table_name, 'Full Name') then 'Full Name'
      when public.month_table_column_exists(p_table_name, 'full_name') then 'full_name'
      else null
    end,
    case
      when public.month_table_column_exists(p_table_name, 'Phone Number') then 'Phone Number'
      when public.month_table_column_exists(p_table_name, 'phone_number') then 'phone_number'
      else null
    end
  into v_name_column, v_phone_column;

  if v_name is null or v_name_column is null then
    raise exception 'Member row was not found and no safe recovery identity is available';
  end if;

  -- D. Recovery: exactly ONE safe, workspace-scoped row must match (0 or >1 => error).
  if v_phone is not null and v_phone_column is not null then
    execute format(
      'select array_agg(id), count(*) from %I
       where deleted_at is null
         and lower(btrim(%I)) = lower($1)
         and btrim(coalesce(%I, '''')) = $2
         and (user_id = $3 or user_id in (
           select collaborator_user_id from public.collaborators
           where owner_id = $3 and status in (''accepted'', ''active'')
         ))',
      p_table_name,
      v_name_column,
      v_phone_column
    ) into v_ids, v_count using v_name, v_phone, p_owner_id;
  else
    execute format(
      'select array_agg(id), count(*) from %I
       where deleted_at is null
         and lower(btrim(%I)) = lower($1)
         and (user_id = $2 or user_id in (
           select collaborator_user_id from public.collaborators
           where owner_id = $2 and status in (''accepted'', ''active'')
         ))',
      p_table_name,
      v_name_column
    ) into v_ids, v_count using v_name, p_owner_id;
  end if;

  if v_count <> 1 then
    raise exception 'Member recovery found % matching rows; update was not applied', v_count;
  end if;

  return jsonb_build_object(
    'member_id', v_ids[1],
    'table_name', p_table_name,
    'recovered', true
  );
end;
$$;

create or replace function public.update_member_record_resilient(
  p_table_name text,
  p_member_id uuid,
  p_updates jsonb,
  p_owner_id uuid,
  p_identity jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_target jsonb;
  v_resolved_id uuid;
  v_row jsonb;
begin
  v_target := public.resolve_member_update_target(
    p_table_name,
    p_owner_id,
    p_member_id,
    p_identity
  );
  v_resolved_id := (v_target->>'member_id')::uuid;

  perform public.update_member_record(p_table_name, v_resolved_id, p_updates, p_owner_id);

  execute format('select to_jsonb(t) from %I t where id = $1', p_table_name)
    into v_row using v_resolved_id;

  if v_row is null then
    raise exception 'Member verification failed after update';
  end if;

  return jsonb_build_object(
    'success', true,
    'member_id', v_resolved_id,
    'table_name', p_table_name,
    'recovered', coalesce((v_target->>'recovered')::boolean, false),
    'row', v_row
  );
end;
$$;

create or replace function public.update_member_bundle_resilient(
  p_table_name text,
  p_owner_id uuid,
  p_member_id uuid,
  p_request_id text,
  p_updates jsonb default '{}'::jsonb,
  p_badges text[] default null,
  p_tag_ids uuid[] default null,
  p_attendance jsonb default '{}'::jsonb,
  p_identity jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_target jsonb;
  v_resolved_id uuid;
  v_result jsonb;
  v_verified boolean := false;
begin
  v_target := public.resolve_member_update_target(
    p_table_name,
    p_owner_id,
    p_member_id,
    p_identity
  );
  v_resolved_id := (v_target->>'member_id')::uuid;

  v_result := public.update_member_bundle(
    p_table_name,
    p_owner_id,
    v_resolved_id,
    p_request_id,
    p_updates,
    p_badges,
    p_tag_ids,
    p_attendance
  );

  execute format('select exists(select 1 from %I where id = $1 and deleted_at is null)', p_table_name)
    into v_verified using v_resolved_id;

  if not coalesce((v_result->>'success')::boolean, false) or not v_verified then
    raise exception '%', coalesce(v_result->>'error_message', 'Member bundle verification failed');
  end if;

  return v_result || jsonb_build_object(
    'member_id', v_resolved_id,
    'table_name', p_table_name,
    'recovered', coalesce((v_target->>'recovered')::boolean, false),
    'verified', true
  );
end;
$$;

revoke all on function public.resolve_member_update_target(text, uuid, uuid, jsonb) from public;
revoke all on function public.update_member_record_resilient(text, uuid, jsonb, uuid, jsonb) from public;
revoke all on function public.update_member_bundle_resilient(text, uuid, uuid, text, jsonb, text[], uuid[], jsonb, jsonb) from public;

grant execute on function public.resolve_member_update_target(text, uuid, uuid, jsonb) to authenticated;
grant execute on function public.update_member_record_resilient(text, uuid, jsonb, uuid, jsonb) to authenticated;
grant execute on function public.update_member_bundle_resilient(text, uuid, uuid, text, jsonb, text[], uuid[], jsonb, jsonb) to authenticated;

notify pgrst, 'reload schema';
