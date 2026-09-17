-- Isolated Phase 1 Member V2 source-month capabilities.
-- This read-only contract lets the harness omit profile fields that a trusted
-- legacy month table cannot persist; it does not alter any monthly table.

create or replace function public.member_v2_source_table_capabilities(
  p_owner_id uuid,
  p_table_name text
) returns jsonb
language plpgsql security definer set search_path = pg_catalog, public, pg_temp as $$
declare
  v_table text;
  v_fields jsonb;
begin
  v_table := public.trusted_workspace_month_from_compat_name(p_owner_id, p_table_name);
  select coalesce(jsonb_agg(attribute.attname order by attribute.attnum), '[]'::jsonb)
    into v_fields
  from pg_catalog.pg_attribute attribute
  where attribute.attrelid = to_regclass(format('public.%I', v_table))
    and attribute.attnum > 0
    and not attribute.attisdropped
    and attribute.attname = any(array[
      'Full Name', 'full_name', 'Name', 'name',
      'Phone Number', 'phone_number', 'phone',
      'Gender', 'gender', 'Age', 'age', 'Current Level', 'current_level',
      'date_of_birth', 'parent_name_1', 'parent_phone_1', 'parent_name_2',
      'parent_phone_2', 'notes', 'ministry', 'is_visitor', 'workspace',
      'Member', 'Regular', 'Newcomer', 'Manual Badge', 'Badge Type'
    ]);
  return jsonb_build_object('status', 'SUCCESS', 'table_name', v_table, 'fields', v_fields);
end;
$$;

revoke all on function public.member_v2_source_table_capabilities(uuid, text) from public, anon;
grant execute on function public.member_v2_source_table_capabilities(uuid, text) to authenticated;
notify pgrst, 'reload schema';
