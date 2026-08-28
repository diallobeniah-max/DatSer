-- Ensure active August 2026 table and all future monthly tables are added to supabase_realtime publication.

do $$
begin
  if not exists (
    select 1 from pg_publication_tables 
    where pubname = 'supabase_realtime' 
      and schemaname = 'public' 
      and tablename = 'August_2026'
  ) then
    alter publication supabase_realtime add table public."August_2026";
  end if;
end $$;

drop function if exists public.create_month_from_current(text, text, text[]);

create or replace function public.create_month_from_current(
  source_table text,
  new_table_name text,
  sunday_dates text[]
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_members_copied integer := 0;
  v_sunday text;
  v_col_name text;
begin
  if source_table is not null and source_table != '' then
    if exists (
      select 1 from information_schema.tables
      where table_schema = 'public' and information_schema.tables.table_name = source_table
    ) then
      execute format('create table public.%I (like public.%I including all)', new_table_name, source_table);
      execute format('insert into public.%I select * from public.%I', new_table_name, source_table);
      execute format('select count(*) from public.%I', new_table_name) into v_members_copied;
    else
      execute format(
        'create table public.%I (
          id uuid default gen_random_uuid() primary key,
          "Full Name" text,
          "Gender" text,
          "Phone Number" text,
          "Age" text,
          "Current Level" text,
          workspace text,
          user_id uuid,
          parent_name_1 text,
          parent_phone_1 text,
          parent_name_2 text,
          parent_phone_2 text,
          notes text,
          ministry text,
          is_visitor boolean default false,
          inserted_at timestamptz default now(),
          "Member" text,
          "Regular" text,
          "Newcomer" text,
          "Manual Badge" text,
          "Badge Type" text,
          "Join Date" text,
          "Member Status" text,
          "Manual Badges" jsonb
        )', new_table_name
      );
    end if;
  else
    execute format(
      'create table public.%I (
        id uuid default gen_random_uuid() primary key,
        "Full Name" text,
        "Gender" text,
        "Phone Number" text,
        "Age" text,
        "Current Level" text,
        workspace text,
        user_id uuid,
        parent_name_1 text,
        parent_phone_1 text,
        parent_name_2 text,
        parent_phone_2 text,
        notes text,
        ministry text,
        is_visitor boolean default false,
        inserted_at timestamptz default now(),
        "Member" text,
        "Regular" text,
        "Newcomer" text,
        "Manual Badge" text,
        "Badge Type" text,
        "Join Date" text,
        "Member Status" text,
        "Manual Badges" jsonb
      )', new_table_name
    );
  end if;

  foreach v_sunday in array sunday_dates
  loop
    v_col_name := 'attendance_' || replace(v_sunday, '-', '_');
    execute format(
      'alter table public.%I add column if not exists %I text',
      new_table_name, v_col_name
    );
  end loop;

  execute format('alter table public.%I enable row level security', new_table_name);

  execute format(
    'create policy "Users can view own rows" on public.%I for select using (user_id = auth.uid() or user_id in (select owner_id from public.collaborators where lower(email) = lower(auth.jwt()->>''email'') and status in (''pending'', ''accepted'', ''active'')))',
    new_table_name
  );

  execute format(
    'create policy "Users can insert own rows" on public.%I for insert with check (user_id = auth.uid())',
    new_table_name
  );

  execute format(
    'create policy "Users can update own rows" on public.%I for update using (user_id = auth.uid() or user_id in (select owner_id from public.collaborators where lower(email) = lower(auth.jwt()->>''email'') and status in (''pending'', ''accepted'', ''active'')))',
    new_table_name
  );

  execute format(
    'create policy "Users can delete own rows" on public.%I for delete using (user_id = auth.uid())',
    new_table_name
  );

  if not exists (
    select 1 from pg_publication_tables 
    where pubname = 'supabase_realtime' 
      and schemaname = 'public' 
      and tablename = new_table_name
  ) then
    execute format('alter publication supabase_realtime add table public.%I', new_table_name);
  end if;

  return jsonb_build_object(
    'success', true,
    'table_name', new_table_name,
    'members_copied', v_members_copied
  );
end;
$$;

notify pgrst, 'reload schema';
