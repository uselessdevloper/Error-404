-- TaskPilot AI Supabase schema
-- Paste this file into Supabase Dashboard -> SQL Editor -> New query -> Run.

create extension if not exists "pgcrypto";

create table if not exists public.departments (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  description text,
  created_at timestamptz not null default now()
);

create table if not exists public.teams (
  id uuid primary key default gen_random_uuid(),
  department_id uuid references public.departments(id) on delete set null,
  name text not null,
  code text unique,
  description text,
  created_at timestamptz not null default now()
);

create table if not exists public.engineer_profiles (
  id uuid primary key default gen_random_uuid(),
  auth_user_id uuid not null unique references auth.users(id) on delete cascade,
  role text not null default 'engineer' check (role in ('engineer', 'manager', 'admin')),
  full_name text not null,
  display_name text,
  email text not null unique,
  avatar_url text,
  employee_id text unique,
  department_id uuid references public.departments(id) on delete set null,
  team_id uuid references public.teams(id) on delete set null,
  manager_profile_id uuid references public.engineer_profiles(id) on delete set null,
  job_title text,
  seniority text check (seniority in ('intern', 'junior', 'mid', 'senior', 'staff', 'principal', 'manager', 'director')),
  location text,
  timezone text default 'Asia/Kolkata',
  phone text,
  skills text[] not null default '{}',
  primary_stack text[] not null default '{}',
  current_sprint text,
  capacity_hours_per_week numeric(4,1) not null default 35.0,
  focus_hours jsonb not null default '{"start":"10:00","end":"13:00"}'::jsonb,
  notification_channels jsonb not null default '{"slack":true,"email":true,"desktop":true}'::jsonb,
  work_preferences jsonb not null default '{"preferDeepWorkMorning":true,"autoAssignNext":true,"requireApprovalBeforeExecution":true}'::jsonb,
  onboarding_completed boolean not null default false,
  last_seen_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.task_source_connections (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.engineer_profiles(id) on delete cascade,
  source_type text not null check (source_type in ('jira', 'servicenow', 'github', 'outlook', 'slack', 'calendar', 'meeting_notes')),
  external_account_id text,
  display_name text,
  enabled boolean not null default true,
  scopes text[] not null default '{}',
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (profile_id, source_type, external_account_id)
);

create table if not exists public.agent_execution_history (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.engineer_profiles(id) on delete cascade,
  task_key text not null,
  task_title text not null,
  priority_score numeric(6,2) not null,
  priority_reason jsonb not null default '[]'::jsonb,
  definition_of_done text,
  execution_steps jsonb not null default '[]'::jsonb,
  status text not null default 'assigned' check (status in ('assigned', 'in_progress', 'blocked', 'completed', 'deferred')),
  assigned_at timestamptz not null default now(),
  completed_at timestamptz,
  user_approved_execution boolean not null default false
);

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists set_engineer_profiles_updated_at on public.engineer_profiles;
create trigger set_engineer_profiles_updated_at
before update on public.engineer_profiles
for each row execute function public.set_updated_at();

drop trigger if exists set_task_source_connections_updated_at on public.task_source_connections;
create trigger set_task_source_connections_updated_at
before update on public.task_source_connections
for each row execute function public.set_updated_at();

create or replace function public.handle_new_auth_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.engineer_profiles (
    auth_user_id,
    full_name,
    display_name,
    email,
    avatar_url,
    role,
    job_title
  )
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'full_name', new.raw_user_meta_data->>'name', split_part(new.email, '@', 1)),
    coalesce(new.raw_user_meta_data->>'name', split_part(new.email, '@', 1)),
    new.email,
    new.raw_user_meta_data->>'avatar_url',
    coalesce(new.raw_user_meta_data->>'role', 'engineer'),
    coalesce(new.raw_user_meta_data->>'job_title', 'Software Engineer')
  )
  on conflict (auth_user_id) do nothing;

  return new;
end;
$$;

drop trigger if exists on_auth_user_created_create_taskpilot_profile on auth.users;
create trigger on_auth_user_created_create_taskpilot_profile
after insert on auth.users
for each row execute function public.handle_new_auth_user();

alter table public.departments enable row level security;
alter table public.teams enable row level security;
alter table public.engineer_profiles enable row level security;
alter table public.task_source_connections enable row level security;
alter table public.agent_execution_history enable row level security;

drop policy if exists "Authenticated users can read departments" on public.departments;
create policy "Authenticated users can read departments"
on public.departments for select
to authenticated
using (true);

drop policy if exists "Authenticated users can read teams" on public.teams;
create policy "Authenticated users can read teams"
on public.teams for select
to authenticated
using (true);

drop policy if exists "Users can read own profile" on public.engineer_profiles;
create policy "Users can read own profile"
on public.engineer_profiles for select
to authenticated
using (auth.uid() = auth_user_id);

drop policy if exists "Managers can read all profiles" on public.engineer_profiles;
create policy "Managers can read all profiles"
on public.engineer_profiles for select
to authenticated
using (
  exists (
    select 1 from public.engineer_profiles p
    where p.auth_user_id = auth.uid() and p.role = 'manager'
  )
);

drop policy if exists "Users can update own profile" on public.engineer_profiles;
create policy "Users can update own profile"
on public.engineer_profiles for update
to authenticated
using (auth.uid() = auth_user_id)
with check (auth.uid() = auth_user_id);

drop policy if exists "Users can read own source connections" on public.task_source_connections;
create policy "Users can read own source connections"
on public.task_source_connections for select
to authenticated
using (
  exists (
    select 1 from public.engineer_profiles p
    where p.id = profile_id and p.auth_user_id = auth.uid()
  )
);

drop policy if exists "Users can manage own source connections" on public.task_source_connections;
create policy "Users can manage own source connections"
on public.task_source_connections for all
to authenticated
using (
  exists (
    select 1 from public.engineer_profiles p
    where p.id = profile_id and p.auth_user_id = auth.uid()
  )
)
with check (
  exists (
    select 1 from public.engineer_profiles p
    where p.id = profile_id and p.auth_user_id = auth.uid()
  )
);

drop policy if exists "Users can read own execution history" on public.agent_execution_history;
create policy "Users can read own execution history"
on public.agent_execution_history for select
to authenticated
using (
  exists (
    select 1 from public.engineer_profiles p
    where p.id = profile_id and p.auth_user_id = auth.uid()
  )
);

drop policy if exists "Managers can read all execution history" on public.agent_execution_history;
create policy "Managers can read all execution history"
on public.agent_execution_history for select
to authenticated
using (
  exists (
    select 1 from public.engineer_profiles p
    where p.auth_user_id = auth.uid() and p.role = 'manager'
  )
);

drop policy if exists "Users can manage own execution history" on public.agent_execution_history;
create policy "Users can manage own execution history"
on public.agent_execution_history for all
to authenticated
using (
  exists (
    select 1 from public.engineer_profiles p
    where p.id = profile_id and p.auth_user_id = auth.uid()
  )
)
with check (
  exists (
    select 1 from public.engineer_profiles p
    where p.id = profile_id and p.auth_user_id = auth.uid()
  )
);

insert into public.departments (name, description)
values
  ('Engineering', 'Product engineering and platform teams'),
  ('Customer Success', 'Customer escalations and account response'),
  ('Data', 'Analytics, warehouse, reporting, and data quality')
on conflict (name) do nothing;

insert into public.teams (department_id, name, code, description)
select d.id, team.name, team.code, team.description
from public.departments d
join (
  values
    ('Engineering', 'Platform Apps', 'PLAT', 'Full-stack product platform team'),
    ('Engineering', 'Identity', 'IDEN', 'Authentication and authorization team'),
    ('Data', 'Analytics', 'DATA', 'Dashboard and reporting team')
) as team(department_name, name, code, description)
on d.name = team.department_name
on conflict (code) do nothing;
