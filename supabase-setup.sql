-- USA Fuel & Mart dashboard: database setup.
-- Paste into Supabase → SQL Editor → New query, then Run. Safe to run again.
--
-- Security model: nobody can read or write anything unless their login is listed in
-- public.admins. Turn off public sign-ups too (see admin/SETUP.md).

-- ---------------------------------------------------------------------------
-- Who is allowed in
-- ---------------------------------------------------------------------------

create table if not exists public.admins (
  user_id uuid primary key references auth.users (id) on delete cascade,
  created_at timestamptz not null default now()
);

create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from public.admins where user_id = (select auth.uid()));
$$;

-- ---------------------------------------------------------------------------
-- Data
-- ---------------------------------------------------------------------------

create table if not exists public.settings (
  id int primary key default 1 check (id = 1),
  data jsonb not null,
  updated_at timestamptz not null default now()
);

create table if not exists public.daily_reports (
  report_date date primary key,
  data jsonb not null,
  updated_at timestamptz not null default now(),
  updated_by uuid default auth.uid()
);

create table if not exists public.recon_notes (
  period_start date not null,
  tank_key text not null,
  data jsonb not null,
  updated_at timestamptz not null default now(),
  primary key (period_start, tank_key)
);

-- Every edit or deletion of a daily report keeps the previous version here,
-- so inventory records can always be traced (Nassau Article XI: keep 5 years).
create table if not exists public.daily_report_history (
  id bigint generated always as identity primary key,
  report_date date not null,
  previous_data jsonb,
  action text not null,
  changed_at timestamptz not null default now(),
  changed_by uuid default auth.uid()
);

create or replace function public.keep_daily_report_history()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.daily_report_history (report_date, previous_data, action)
  values (old.report_date, old.data, tg_op);
  return coalesce(new, old);
end;
$$;

drop trigger if exists daily_reports_history on public.daily_reports;
create trigger daily_reports_history
  after update or delete on public.daily_reports
  for each row execute function public.keep_daily_report_history();

-- ---------------------------------------------------------------------------
-- Row level security: only listed admins, nothing for anyone else
-- ---------------------------------------------------------------------------

alter table public.admins enable row level security;
alter table public.settings enable row level security;
alter table public.daily_reports enable row level security;
alter table public.recon_notes enable row level security;
alter table public.daily_report_history enable row level security;

revoke all on public.admins, public.settings, public.daily_reports, public.recon_notes, public.daily_report_history from anon;

drop policy if exists "Admins see their own admin row" on public.admins;
create policy "Admins see their own admin row" on public.admins
  for select to authenticated using (user_id = (select auth.uid()));

drop policy if exists "Admins manage settings" on public.settings;
create policy "Admins manage settings" on public.settings
  for all to authenticated using ((select public.is_admin())) with check ((select public.is_admin()));

drop policy if exists "Admins manage daily reports" on public.daily_reports;
create policy "Admins manage daily reports" on public.daily_reports
  for all to authenticated using ((select public.is_admin())) with check ((select public.is_admin()));

drop policy if exists "Admins manage reconciliation notes" on public.recon_notes;
create policy "Admins manage reconciliation notes" on public.recon_notes
  for all to authenticated using ((select public.is_admin())) with check ((select public.is_admin()));

drop policy if exists "Admins read report history" on public.daily_report_history;
create policy "Admins read report history" on public.daily_report_history
  for select to authenticated using ((select public.is_admin()));

-- ---------------------------------------------------------------------------
-- Fuel prices, bank deposits, house accounts (added October 2026)
-- Each record is a JSON document with an id and a day (YYYY-MM-DD).
-- ---------------------------------------------------------------------------

create table if not exists public.price_changes (
  id text primary key, day date not null, data jsonb not null, updated_at timestamptz not null default now()
);
create table if not exists public.deposits (
  id text primary key, day date not null, data jsonb not null, updated_at timestamptz not null default now()
);
create table if not exists public.house_accounts (
  id text primary key, day date not null, data jsonb not null, updated_at timestamptz not null default now()
);
create table if not exists public.house_charges (
  id text primary key, day date not null, data jsonb not null, updated_at timestamptz not null default now()
);
create table if not exists public.house_payments (
  id text primary key, day date not null, data jsonb not null, updated_at timestamptz not null default now()
);
create index if not exists house_charges_day on public.house_charges (day);
create index if not exists house_payments_day on public.house_payments (day);

-- Expenses, compliance items, inspection checklists and repair logs (added November 2026)
create table if not exists public.expenses (
  id text primary key, day date not null, data jsonb not null, updated_at timestamptz not null default now()
);
create table if not exists public.compliance_items (
  id text primary key, day date not null, data jsonb not null, updated_at timestamptz not null default now()
);
create table if not exists public.inspections (
  id text primary key, day date not null, data jsonb not null, updated_at timestamptz not null default now()
);
create table if not exists public.maintenance (
  id text primary key, day date not null, data jsonb not null, updated_at timestamptz not null default now()
);
-- Imported Commander PLU and Deal reports (Item sales page). day = last day the report covers.
create table if not exists public.item_reports (
  id text primary key, day date not null, data jsonb not null, updated_at timestamptz not null default now()
);
create index if not exists expenses_day on public.expenses (day);
create index if not exists inspections_day on public.inspections (day);

-- Previous versions of any edited or deleted money record.
create table if not exists public.change_history (
  id bigint generated always as identity primary key,
  table_name text not null,
  record_id text not null,
  previous_data jsonb,
  action text not null,
  changed_at timestamptz not null default now(),
  changed_by uuid default auth.uid()
);

create or replace function public.keep_change_history()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.change_history (table_name, record_id, previous_data, action)
  values (tg_table_name, old.id, old.data, tg_op);
  return coalesce(new, old);
end;
$$;

do $$
declare
  t text;
begin
  foreach t in array array['price_changes', 'deposits', 'house_accounts', 'house_charges', 'house_payments', 'expenses', 'compliance_items', 'inspections', 'maintenance', 'item_reports'] loop
    execute format('drop trigger if exists %I on public.%I', t || '_history', t);
    execute format('create trigger %I after update or delete on public.%I for each row execute function public.keep_change_history()', t || '_history', t);
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from anon', t);
    execute format('drop policy if exists %I on public.%I', 'Admins manage ' || t, t);
    execute format('create policy %I on public.%I for all to authenticated using ((select public.is_admin())) with check ((select public.is_admin()))', 'Admins manage ' || t, t);
  end loop;
end;
$$;

alter table public.change_history enable row level security;
revoke all on public.change_history from anon;
drop policy if exists "Admins read change history" on public.change_history;
create policy "Admins read change history" on public.change_history
  for select to authenticated using ((select public.is_admin()));

-- ---------------------------------------------------------------------------
-- Website content (deals, announcement, holiday hours): anyone can read it,
-- because the public website shows it. Only admins can change it.
-- ---------------------------------------------------------------------------

create table if not exists public.site_content (
  key text primary key,
  data jsonb not null,
  updated_at timestamptz not null default now()
);

alter table public.site_content enable row level security;
revoke insert, update, delete on public.site_content from anon;
grant select on public.site_content to anon;

drop policy if exists "Anyone can read website content" on public.site_content;
create policy "Anyone can read website content" on public.site_content
  for select to anon, authenticated using (true);

drop policy if exists "Admins manage website content" on public.site_content;
create policy "Admins manage website content" on public.site_content
  for all to authenticated using ((select public.is_admin())) with check ((select public.is_admin()));

-- ---------------------------------------------------------------------------
-- LAST STEP: after creating your login in Authentication → Users, put your email
-- below and run just this statement.
-- ---------------------------------------------------------------------------

-- insert into public.admins (user_id)
-- select id from auth.users where email = 'you@example.com'
-- on conflict do nothing;
