-- Active rows have no nonempty deletion timestamp. Preserve explicit physical
-- DELETE capture and bootstrap of retained soft-deleted monthly rows.
-- Function signatures, authorization, trigger suppression and grants are unchanged.

create or replace function public.member_v2_capture_month_row()
returns trigger
language plpgsql security definer set search_path = pg_catalog, public, pg_temp as $$
declare
  v_row jsonb := case when tg_op = 'DELETE' then to_jsonb(old) else to_jsonb(new) end;
  v_old_projection jsonb := case when tg_op = 'UPDATE' then public.member_v2_profile_projection(to_jsonb(old)) else null end;
  v_projection jsonb := public.member_v2_profile_projection(v_row);
  v_owner_id uuid;
  v_member_id uuid;
  v_deleted boolean;
begin
  if current_setting('datser.member_v2.skip_capture', true) = 'on' then
    if tg_op = 'DELETE' then return old; end if;
    return new;
  end if;
  if tg_op = 'UPDATE' and v_old_projection is not distinct from v_projection then
    return new;
  end if;
  begin
    v_owner_id := nullif(v_row ->> 'workspace_owner_id', '')::uuid;
    v_member_id := nullif(v_row ->> 'id', '')::uuid;
  exception when invalid_text_representation then
    if tg_op = 'DELETE' then return old; end if;
    return new;
  end;
  if v_owner_id is null or v_member_id is null then
    if tg_op = 'DELETE' then return old; end if;
    return new;
  end if;
  v_deleted := nullif(v_row ->> 'deleted_at', '') is not null or tg_op = 'DELETE';
  perform public.member_v2_record_change(
    v_owner_id,
    tg_table_name,
    v_member_id,
    coalesce(public.member_v2_member_payload(tg_table_name, v_owner_id, v_member_id, true), v_projection) ||
      case when tg_op = 'DELETE' then jsonb_build_object('id', v_member_id::text, '__source_table', tg_table_name, '__canonical_member_id', v_member_id::text) else '{}'::jsonb end,
    v_deleted,
    lower(tg_op),
    null,
    auth.uid()
  );
  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;

create or replace function public.member_v2_bootstrap_head(
  p_owner_id uuid,
  p_table_name text,
  p_member_id uuid
) returns bigint
language plpgsql security definer set search_path = pg_catalog, public, pg_temp as $$
declare
  v_existing bigint;
  v_payload jsonb;
  v_deleted boolean;
begin
  perform pg_advisory_xact_lock(hashtextextended(
    'member_v2_head:' || p_owner_id::text || ':' || p_table_name || ':' || p_member_id::text,
    0
  ));
  select server_revision into v_existing
  from public.member_v2_heads
  where owner_id = p_owner_id and table_name = p_table_name and member_id = p_member_id
  for update;
  if v_existing is not null then
    return v_existing;
  end if;
  v_payload := public.member_v2_member_payload(p_table_name, p_owner_id, p_member_id, true);
  if v_payload is null then
    raise exception 'Member is unavailable for synchronization' using errcode = '42501';
  end if;
  v_deleted := nullif(v_payload ->> 'deleted_at', '') is not null;
  return public.member_v2_record_change(
    p_owner_id, p_table_name, p_member_id, v_payload, v_deleted, 'bootstrap', null, auth.uid()
  );
end;
$$;

notify pgrst, 'reload schema';
