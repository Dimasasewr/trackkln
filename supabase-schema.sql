-- KARSA EXECUTIVE WORKSPACE
-- Internal accounts only. NO public registration.
-- Roles:
-- director          = read-only executive visibility
-- general_manager   = assign + monitor all divisions
-- operational_head  = assign + monitor all divisions
-- division_head     = view own division; can update only if explicitly assigned as PIC
-- staff             = view own division; can update only if explicitly assigned as PIC

create extension if not exists pgcrypto;

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  name text not null,
  email text not null unique,
  division text not null check (division in ('Finance','IT','Operasional','R&D')),
  role text not null check (role in ('director','general_manager','operational_head','division_head','staff')),
  title text,
  created_at timestamptz not null default now()
);

create table if not exists public.jobs (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  description text,
  assigned_division text not null check (assigned_division in ('Finance','IT','Operasional','R&D')),
  assignee_id uuid not null references public.profiles(id) on delete restrict,
  assignee_name text not null,
  deadline date not null,
  progress integer not null default 0 check (progress between 0 and 100),
  status text not null default 'Belum Mulai' check (status in ('Belum Mulai','In Progress','Menunggu','Terkendala','Siap Review','Selesai')),
  blocker text,
  next_action text,
  priority text not null default 'Normal' check (priority in ('Normal','High','Urgent')),
  created_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.progress_history (
  id bigint generated always as identity primary key,
  job_id uuid not null references public.jobs(id) on delete cascade,
  progress integer not null check (progress between 0 and 100),
  status text not null,
  note text,
  updated_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now()
);

create table if not exists public.notifications (
  id bigint generated always as identity primary key,
  user_id uuid not null references public.profiles(id) on delete cascade,
  job_id uuid references public.jobs(id) on delete cascade,
  title text not null,
  body text,
  is_read boolean not null default false,
  created_at timestamptz not null default now()
);

create index if not exists jobs_division_idx on public.jobs(assigned_division);
create index if not exists jobs_assignee_idx on public.jobs(assignee_id);
create index if not exists jobs_deadline_idx on public.jobs(deadline);
create index if not exists jobs_status_idx on public.jobs(status);

create or replace function public.current_role()
returns text language sql stable security definer set search_path=public as $$
  select role from public.profiles where id=auth.uid() limit 1;
$$;

create or replace function public.current_division()
returns text language sql stable security definer set search_path=public as $$
  select division from public.profiles where id=auth.uid() limit 1;
$$;

create or replace function public.can_assign()
returns boolean language sql stable security definer set search_path=public as $$
  select exists(
    select 1 from public.profiles
    where id=auth.uid() and role in ('general_manager','operational_head')
  );
$$;

create or replace function public.can_monitor_all()
returns boolean language sql stable security definer set search_path=public as $$
  select exists(
    select 1 from public.profiles
    where id=auth.uid() and role in ('director','general_manager','operational_head')
  );
$$;

alter table public.profiles enable row level security;
alter table public.jobs enable row level security;
alter table public.progress_history enable row level security;
alter table public.notifications enable row level security;

drop policy if exists "profiles_self_or_management" on public.profiles;
create policy "profiles_self_or_management" on public.profiles
for select using (
  id=auth.uid() or public.can_monitor_all()
);

drop policy if exists "jobs_visible_by_route" on public.jobs;
create policy "jobs_visible_by_route" on public.jobs
for select using (
  public.can_monitor_all()
  or assigned_division=public.current_division()
);

drop policy if exists "jobs_created_by_management" on public.jobs;
create policy "jobs_created_by_management" on public.jobs
for insert with check (
  public.can_assign()
  and created_by=auth.uid()
  and exists(
    select 1 from public.profiles p
    where p.id=assignee_id and p.division=assigned_division
  )
);

-- IMPORTANT:
-- Progress/status/blocker/next_action updates are ONLY allowed for the selected PIC.
-- GM/HDO do NOT update progress through this policy; they monitor and assign.
drop policy if exists "jobs_progress_only_by_assignee" on public.jobs;
create policy "jobs_progress_only_by_assignee" on public.jobs
for update using (
  assignee_id=auth.uid()
) with check (
  assignee_id=auth.uid()
  and assigned_division=public.current_division()
);

drop policy if exists "history_visible_by_route" on public.progress_history;
create policy "history_visible_by_route" on public.progress_history
for select using (
  public.can_monitor_all()
  or exists(
    select 1 from public.jobs j
    where j.id=job_id and j.assigned_division=public.current_division()
  )
);

drop policy if exists "history_insert_only_assignee" on public.progress_history;
create policy "history_insert_only_assignee" on public.progress_history
for insert with check (
  updated_by=auth.uid()
  and exists(
    select 1 from public.jobs j
    where j.id=job_id and j.assignee_id=auth.uid()
  )
);

drop policy if exists "notifications_self" on public.notifications;
create policy "notifications_self" on public.notifications
for select using (user_id=auth.uid());

drop policy if exists "notifications_update_self" on public.notifications;
create policy "notifications_update_self" on public.notifications
for update using (user_id=auth.uid());

create or replace function public.touch_updated_at()
returns trigger language plpgsql as $$
begin new.updated_at=now(); return new; end;
$$;

drop trigger if exists jobs_touch_updated_at on public.jobs;
create trigger jobs_touch_updated_at before update on public.jobs
for each row execute function public.touch_updated_at();

-- NOTE:
-- Supabase Auth users are provisioned by the included provision-users.mjs script.
-- That script creates the Auth account and matching public.profiles row.
