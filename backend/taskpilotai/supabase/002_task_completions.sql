-- TaskPilot AI — Task Completion Persistence
-- Paste into Supabase Dashboard → SQL Editor → New query → Run

-- ─── Task completions per user ────────────────────────────────────────────────
create table if not exists public.task_completions (
  id            uuid primary key default gen_random_uuid(),
  user_email    text not null,
  user_name     text not null,
  task_id       text not null,
  task_title    text not null,
  severity      text,
  source        text,
  due_date      text,
  score         numeric(6,2),
  completed_at  timestamptz not null default now(),
  was_on_time   boolean not null default true,
  time_spent_min int,
  unique (user_email, task_id)
);

-- ─── Task working state (in-progress) ────────────────────────────────────────
create table if not exists public.task_working (
  id            uuid primary key default gen_random_uuid(),
  user_email    text not null,
  user_name     text not null default 'Engineer',
  task_id       text not null,
  task_title    text not null,
  started_at    timestamptz not null default now(),
  unique (user_email, task_id)
);

-- ─── Manager-to-engineer task assignments ─────────────────────────────────────
create table if not exists public.manager_assignments (
  id              uuid primary key default gen_random_uuid(),
  assigned_by     text not null,
  assigned_to     text not null,
  task_id         text not null,
  task_title      text not null,
  description     text,
  severity        text not null default 'P2',
  deadline        text,
  team            text,
  status          text not null default 'pending' check (status in ('pending','in_progress','completed','cancelled')),
  created_at      timestamptz not null default now(),
  completed_at    timestamptz,
  unique (assigned_to, task_id)
);

-- ─── Enable RLS ───────────────────────────────────────────────────────────────
alter table public.task_completions   enable row level security;
alter table public.task_working       enable row level security;
alter table public.manager_assignments enable row level security;

-- ─── RLS policies ─────────────────────────────────────────────────────────────
-- task_completions: users see own, managers see all
drop policy if exists "Users can manage own completions" on public.task_completions;
create policy "Users can manage own completions"
on public.task_completions for all
using (user_email = auth.jwt() ->> 'email')
with check (user_email = auth.jwt() ->> 'email');

drop policy if exists "Anon can insert completions" on public.task_completions;
create policy "Anon can insert completions"
on public.task_completions for insert
to anon
with check (true);

drop policy if exists "Anon can select completions" on public.task_completions;
create policy "Anon can select completions"
on public.task_completions for select
to anon
using (true);

drop policy if exists "Anon can delete completions" on public.task_completions;
create policy "Anon can delete completions"
on public.task_completions for delete
to anon
using (true);

-- task_working: same open anon policy (demo app)
drop policy if exists "Anon can manage working" on public.task_working;
create policy "Anon can manage working"
on public.task_working for all
to anon
using (true)
with check (true);

-- manager_assignments: open anon policy for demo
drop policy if exists "Anon can manage assignments" on public.manager_assignments;
create policy "Anon can manage assignments"
on public.manager_assignments for all
to anon
using (true)
with check (true);

-- ─── Realtime ─────────────────────────────────────────────────────────────────
-- Enable realtime for live dashboard updates (safely ignore duplicate member errors)
do $$
begin
  alter publication supabase_realtime add table public.task_completions;
exception when duplicate_object then
  null;
end $$;

do $$
begin
  alter publication supabase_realtime add table public.task_working;
exception when duplicate_object then
  null;
end $$;

do $$
begin
  alter publication supabase_realtime add table public.manager_assignments;
exception when duplicate_object then
  null;
end $$;

-- ─── Indexes ──────────────────────────────────────────────────────────────────
create index if not exists idx_task_completions_email on public.task_completions(user_email);
create index if not exists idx_task_completions_completed_at on public.task_completions(completed_at desc);
create index if not exists idx_task_working_email on public.task_working(user_email);
create index if not exists idx_manager_assignments_to on public.manager_assignments(assigned_to);
