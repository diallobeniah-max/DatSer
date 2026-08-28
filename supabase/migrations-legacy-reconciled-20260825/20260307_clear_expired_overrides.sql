create or replace function public.clear_expired_overrides()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count integer := 0;
  v_today date := current_date;
  v_today_table text := trim(to_char(v_today, 'Month')) || '_' || extract(year from v_today)::int;
  v_today_sunday date := v_today - extract(dow from v_today)::int;
  v_month_start date := date_trunc('month', v_today)::date;
  v_first_sunday date := v_month_start + ((7 - extract(dow from v_month_start)::int) % 7);
  v_active_sunday date;
  v_table_exists boolean;
begin
  if extract(month from v_today_sunday) <> extract(month from v_today) then
    v_active_sunday := v_first_sunday;
  else
    v_active_sunday := v_today_sunday;
  end if;

  v_table_exists := to_regclass(format('public.%I', v_today_table)) is not null;

  update public.user_preferences
  set
    locked_default_date = null,
    admin_sticky_month = case when v_table_exists then v_today_table else admin_sticky_month end,
    admin_sticky_year = case when v_table_exists then extract(year from v_today)::int else admin_sticky_year end,
    admin_sticky_sundays = case
      when v_table_exists then array[to_char(v_active_sunday, 'YYYY-MM-DD')]
      else admin_sticky_sundays
    end,
    updated_at = now()
  where locked_default_date is not null
    and locked_default_date ~ '^\d{4}-\d{2}-\d{2}$'
    and to_date(locked_default_date, 'YYYY-MM-DD') < v_today;

  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

grant execute on function public.clear_expired_overrides() to authenticated;

comment on function public.clear_expired_overrides() is
  'Clears expired Sunday overrides and restores the workspace to the current live Sunday when the current month table exists.';
