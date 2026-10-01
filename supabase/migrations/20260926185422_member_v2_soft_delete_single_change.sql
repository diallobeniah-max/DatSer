-- The trusted soft-delete RPC owns the Member V2 change event. Suppress the
-- month-table capture trigger for its physical deleted_at update so one
-- logical delete creates one revision and one Realtime wake signal.
create or replace function public.delete_member_v2(
  p_table_name text, p_owner_id uuid, p_member_id uuid,
  p_base_server_revision bigint, p_request_id text, p_payload_fingerprint text
) returns jsonb
language plpgsql security definer set search_path = pg_catalog, public, pg_temp as $$
declare
  v_actor uuid := auth.uid(); v_table text; v_head public.member_v2_heads%rowtype;
  v_row jsonb; v_deleted jsonb; v_revision bigint; v_expected text; v_reservation jsonb; v_response jsonb;
begin
  perform public.require_permanent_workspace_actor(p_owner_id, false);
  v_table := public.trusted_workspace_month_from_compat_name(p_owner_id, p_table_name);
  if not public.month_table_has_column(v_table, 'deleted_at') then
    raise exception 'Trusted month does not support Member V2 soft delete' using errcode = '0A000';
  end if;
  if not exists (
    select 1 from public.member_v2_claims
    where member_id = p_member_id and owner_id = p_owner_id and table_name = v_table
  ) then
    raise exception 'Member V2 claim is unavailable for this trusted month' using errcode = '42501';
  end if;
  v_expected := public.member_v2_fingerprint('delete_member_v2', p_owner_id, v_table, p_member_id, p_base_server_revision, '{}'::jsonb);
  if p_payload_fingerprint is distinct from v_expected then raise exception 'Member delete payload fingerprint does not match' using errcode = '22023'; end if;
  v_reservation := public.member_v2_reserve_mutation(p_request_id, p_owner_id, v_table, p_member_id, 'delete_member_v2', p_payload_fingerprint);
  if not coalesce((v_reservation ->> 'reserved')::boolean, false) then return v_reservation -> 'response'; end if;
  perform pg_advisory_xact_lock(hashtextextended('member_v2:' || p_owner_id::text || ':' || v_table || ':' || p_member_id::text, 0));
  select * into v_head from public.member_v2_heads where owner_id = p_owner_id and table_name = v_table and member_id = p_member_id for update;
  if not found or v_head.is_deleted or p_base_server_revision is distinct from v_head.server_revision then
    v_response := jsonb_build_object('status', 'CONFLICT', 'server_revision', v_head.server_revision, 'member', v_head.member_payload, 'table_name', v_table);
    perform public.member_v2_finish_mutation(p_request_id, 'CONFLICT', v_response); return v_response;
  end if;
  execute format('select to_jsonb(m) from public.%I m where m.id = $1 and m.workspace_owner_id = $2 for update', v_table) into v_row using p_member_id, p_owner_id;
  if v_row is null or (v_row ->> 'deleted_at') is not null then raise exception 'Active member is unavailable in the trusted month' using errcode = '42501'; end if;

  perform set_config('datser.member_v2.skip_capture', 'on', true);
  if public.month_table_has_column(v_table, 'updated_at') then
    execute format('update public.%I set deleted_at = clock_timestamp(), updated_at = clock_timestamp() where id = $1 and workspace_owner_id = $2', v_table) using p_member_id, p_owner_id;
  else
    execute format('update public.%I set deleted_at = clock_timestamp() where id = $1 and workspace_owner_id = $2', v_table) using p_member_id, p_owner_id;
  end if;
  v_deleted := public.member_v2_member_payload(v_table, p_owner_id, p_member_id, true);
  v_revision := public.member_v2_record_change(p_owner_id, v_table, p_member_id, v_deleted, true, 'delete_member_v2', p_request_id, v_actor);
  v_response := jsonb_build_object('status', 'SUCCESS', 'server_revision', v_revision, 'member', v_deleted, 'table_name', v_table);
  perform public.member_v2_finish_mutation(p_request_id, 'SUCCESS', v_response); return v_response;
end;
$$;

revoke all on function public.delete_member_v2(text, uuid, uuid, bigint, text, text) from public, anon;
grant execute on function public.delete_member_v2(text, uuid, uuid, bigint, text, text) to authenticated;
notify pgrst, 'reload schema';
