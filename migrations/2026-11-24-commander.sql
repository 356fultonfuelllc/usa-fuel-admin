-- Commander import: new tables, store-PC (station) access, raw-report storage, realtime.
-- Additive only: no existing table is altered, no rows are changed or deleted.
-- The one change touching an existing table is a new INSERT-only policy on price_changes
-- for auto-detected price changes (owner said yes, 2026-11-24).
-- Safe to run again.

-- ---------------------------------------------------------------------------
-- Who the store PC is. Like public.admins, but for the `station` login.
-- The station is never an admin, so it can't read or change any dashboard table.
-- ---------------------------------------------------------------------------

create table if not exists public.stations (
  user_id uuid primary key references auth.users (id) on delete cascade,
  created_at timestamptz not null default now()
);

create or replace function public.is_station()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from public.stations where user_id = (select auth.uid()));
$$;

alter table public.stations enable row level security;
revoke all on public.stations from anon;
drop policy if exists "Admins read stations" on public.stations;
create policy "Admins read stations" on public.stations for select to authenticated using ((select public.is_admin()));

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------

-- One row per closed business day: the latest pull. data = dashboard.json exactly.
create table if not exists public.cmdr_days (
  business_date date primary key,
  period_name text,
  pulled_at timestamptz not null,
  data jsonb not null,
  checks jsonb,
  checks_ok boolean,
  items_count int,
  items_total numeric(12, 2),
  script_version text,
  data_hash text,
  updated_at timestamptz not null default now()
);

-- Every distinct version of a day ever uploaded. Re-uploading identical data adds nothing
-- (same business_date + data_hash), so uploads stay idempotent and old versions are kept.
create table if not exists public.cmdr_day_pulls (
  id bigint generated always as identity primary key,
  business_date date not null,
  period_name text,
  pulled_at timestamptz not null,
  data jsonb not null,
  checks jsonb,
  checks_ok boolean,
  items_count int,
  items_total numeric(12, 2),
  script_version text,
  data_hash text not null,
  uploaded_at timestamptz not null default now(),
  unique (business_date, data_hash)
);

-- Item (PLU) sales per day. The same UPC can sell at two prices in one day.
create table if not exists public.cmdr_items (
  business_date date not null,
  upc text not null,
  description text not null default '',
  customers int,
  units int not null,
  price numeric(10, 3) not null,
  sales numeric(12, 2) not null,
  primary key (business_date, upc, price)
);

create table if not exists public.cmdr_deals (
  business_date date not null,
  promotion_id text not null,
  name text not null default '',
  deal_type text not null check (deal_type in ('mix_match', 'combo')),
  customers int,
  count int not null,
  items int,
  sales numeric(12, 2) not null,
  primary key (business_date, deal_type, promotion_id)
);

-- Requests from the dashboard to the store PC (Pull live, re-pull a day, backfill).
create table if not exists public.cmdr_requests (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('live', 'day', 'backfill')),
  business_date date,
  requested_by uuid default auth.uid(),
  requested_at timestamptz not null default now(),
  status text not null default 'pending' check (status in ('pending', 'running', 'done', 'error')),
  started_at timestamptz,
  finished_at timestamptz,
  error text
);
create index if not exists cmdr_requests_pending on public.cmdr_requests (requested_at) where status = 'pending';

create table if not exists public.cmdr_live_snapshots (
  id uuid primary key default gen_random_uuid(),
  taken_at timestamptz not null,
  request_id uuid references public.cmdr_requests (id),
  data jsonb not null
);
create index if not exists cmdr_live_snapshots_taken on public.cmdr_live_snapshots (taken_at desc);

create table if not exists public.cmdr_price_observations (
  id uuid primary key default gen_random_uuid(),
  observed_at timestamptz not null,
  grade text not null check (grade in ('reg', 'mid', 'prem', 'dsl')),
  level text not null check (level in ('cash', 'credit')),
  price numeric(6, 3) not null,
  status text not null check (status in ('confirmed', 'mixed')),
  gallons_in_window numeric(12, 3)
);
create index if not exists cmdr_price_observations_at on public.cmdr_price_observations (observed_at desc);

create table if not exists public.cmdr_heartbeat (
  id int primary key default 1 check (id = 1),
  last_seen timestamptz,
  script_version text,
  last_error text,
  last_day_uploaded date
);

-- ---------------------------------------------------------------------------
-- Row-level security
-- Owner (admin): read everything, create requests. Station: write its own data only.
-- Anonymous: nothing.
-- ---------------------------------------------------------------------------

do $$
declare
  t text;
begin
  foreach t in array array['cmdr_days', 'cmdr_day_pulls', 'cmdr_items', 'cmdr_deals', 'cmdr_requests', 'cmdr_live_snapshots', 'cmdr_price_observations', 'cmdr_heartbeat'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from anon', t);
    execute format('drop policy if exists %I on public.%I', 'Admins read ' || t, t);
    execute format('create policy %I on public.%I for select to authenticated using ((select public.is_admin()))', 'Admins read ' || t, t);
    -- The station may read back what it writes (needed for upserts and the last confirmed price).
    execute format('drop policy if exists %I on public.%I', 'Station reads ' || t, t);
    execute format('create policy %I on public.%I for select to authenticated using ((select public.is_station()))', 'Station reads ' || t, t);
  end loop;

  -- Insert + update (upsert) for the station.
  foreach t in array array['cmdr_days', 'cmdr_heartbeat'] loop
    execute format('drop policy if exists %I on public.%I', 'Station inserts ' || t, t);
    execute format('create policy %I on public.%I for insert to authenticated with check ((select public.is_station()))', 'Station inserts ' || t, t);
    execute format('drop policy if exists %I on public.%I', 'Station updates ' || t, t);
    execute format('create policy %I on public.%I for update to authenticated using ((select public.is_station())) with check ((select public.is_station()))', 'Station updates ' || t, t);
  end loop;

  -- Insert only (append) for the station. Duplicate pulls are ignored by the unique key.
  foreach t in array array['cmdr_day_pulls', 'cmdr_live_snapshots', 'cmdr_price_observations'] loop
    execute format('drop policy if exists %I on public.%I', 'Station inserts ' || t, t);
    execute format('create policy %I on public.%I for insert to authenticated with check ((select public.is_station()))', 'Station inserts ' || t, t);
  end loop;
end;
$$;

-- Requests: the owner creates them; the station may only move them along.
drop policy if exists "Admins create requests" on public.cmdr_requests;
create policy "Admins create requests" on public.cmdr_requests for insert to authenticated
  with check ((select public.is_admin()) and status = 'pending' and requested_by = (select auth.uid()));
drop policy if exists "Station updates requests" on public.cmdr_requests;
create policy "Station updates requests" on public.cmdr_requests for update to authenticated
  using ((select public.is_station())) with check ((select public.is_station()));
-- Column limits: an update may only touch status, started_at, finished_at and error.
revoke update on public.cmdr_requests from authenticated;
grant update (status, started_at, finished_at, error) on public.cmdr_requests to authenticated;

-- ---------------------------------------------------------------------------
-- Functions the station calls
-- ---------------------------------------------------------------------------

-- Replace one day's items and deals in a single transaction. Touches only that date,
-- only in cmdr_items and cmdr_deals.
create or replace function public.cmdr_replace_day_items(p_date date, p_items jsonb, p_deals jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.is_station() then
    raise exception 'not allowed';
  end if;
  delete from public.cmdr_items where business_date = p_date;
  delete from public.cmdr_deals where business_date = p_date;
  insert into public.cmdr_items (business_date, upc, description, customers, units, price, sales)
    select p_date, i.upc, coalesce(i.description, ''), i.customers, i.units, i.price, i.sales
    from jsonb_to_recordset(coalesce(p_items, '[]'::jsonb))
      as i(upc text, description text, customers int, units int, price numeric, sales numeric);
  insert into public.cmdr_deals (business_date, promotion_id, name, deal_type, customers, count, items, sales)
    select p_date, d.promotion_id, coalesce(d.name, ''), d.deal_type, d.customers, d.count, d.items, d.sales
    from jsonb_to_recordset(coalesce(p_deals, '[]'::jsonb))
      as d(promotion_id text, name text, deal_type text, customers int, count int, items int, sales numeric);
end;
$$;

-- Claim the oldest pending request (safe if two agents ever run at once).
create or replace function public.cmdr_claim_request()
returns setof public.cmdr_requests
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.is_station() then
    raise exception 'not allowed';
  end if;
  return query
    update public.cmdr_requests r
    set status = 'running', started_at = now()
    where r.id = (
      select id from public.cmdr_requests
      where status = 'pending'
      order by requested_at
      limit 1
      for update skip locked
    )
    returning r.*;
end;
$$;

revoke all on function public.cmdr_replace_day_items(date, jsonb, jsonb) from public, anon;
revoke all on function public.cmdr_claim_request() from public, anon;
grant execute on function public.cmdr_replace_day_items(date, jsonb, jsonb) to authenticated;
grant execute on function public.cmdr_claim_request() to authenticated;

-- ---------------------------------------------------------------------------
-- Auto-detected price changes go into the existing price history (insert only).
-- The station can't read, change or delete any price_changes row.
-- ---------------------------------------------------------------------------

drop policy if exists "Station adds detected price changes" on public.price_changes;
create policy "Station adds detected price changes" on public.price_changes for insert to authenticated
  with check (
    (select public.is_station())
    and data ->> 'note' = 'Auto-detected from Commander'
    and jsonb_typeof(data -> 'credit') = 'object'
    and jsonb_typeof(data -> 'cash') = 'object'
  );

-- ---------------------------------------------------------------------------
-- Raw Commander XML (private), for audits and NYSDEC records: cmdr-raw/YYYY-MM-DD/<report>.xml
-- ---------------------------------------------------------------------------

insert into storage.buckets (id, name, public)
values ('cmdr-raw', 'cmdr-raw', false)
on conflict (id) do nothing;

drop policy if exists "Admins read raw Commander reports" on storage.objects;
create policy "Admins read raw Commander reports" on storage.objects for select to authenticated
  using (bucket_id = 'cmdr-raw' and (select public.is_admin()));
drop policy if exists "Station reads raw Commander reports" on storage.objects;
create policy "Station reads raw Commander reports" on storage.objects for select to authenticated
  using (bucket_id = 'cmdr-raw' and (select public.is_station()));
drop policy if exists "Station uploads raw Commander reports" on storage.objects;
create policy "Station uploads raw Commander reports" on storage.objects for insert to authenticated
  with check (bucket_id = 'cmdr-raw' and (select public.is_station()));
drop policy if exists "Station replaces raw Commander reports" on storage.objects;
create policy "Station replaces raw Commander reports" on storage.objects for update to authenticated
  using (bucket_id = 'cmdr-raw' and (select public.is_station()))
  with check (bucket_id = 'cmdr-raw' and (select public.is_station()));

-- ---------------------------------------------------------------------------
-- Realtime: the Live page and day list update as soon as the store PC writes.
-- ---------------------------------------------------------------------------

do $$
declare
  t text;
begin
  foreach t in array array['cmdr_live_snapshots', 'cmdr_requests', 'cmdr_days'] loop
    if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;
end;
$$;
