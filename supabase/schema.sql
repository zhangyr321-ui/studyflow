-- StudyFlow cloud sync: one private JSON document per authenticated user.
-- Run this SQL in the Supabase SQL Editor for your StudyFlow project.

create table if not exists public.studyflow_user_data (
  user_id uuid primary key references auth.users (id) on delete cascade,
  data jsonb not null default '{}'::jsonb check (jsonb_typeof(data) = 'object'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.studyflow_user_data enable row level security;

-- Remove/recreate the policy so this script can be safely re-run.
drop policy if exists "Users can manage their own StudyFlow data"
  on public.studyflow_user_data;

create policy "Users can manage their own StudyFlow data"
  on public.studyflow_user_data
  for all
  to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

revoke all on public.studyflow_user_data from anon;
grant select, insert, update, delete
  on public.studyflow_user_data to authenticated;

create or replace function public.set_studyflow_updated_at()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists set_studyflow_user_data_updated_at
  on public.studyflow_user_data;

create trigger set_studyflow_user_data_updated_at
before update on public.studyflow_user_data
for each row
execute function public.set_studyflow_updated_at();
