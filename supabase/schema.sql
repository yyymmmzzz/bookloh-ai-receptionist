-- =====================================================
-- Bookloh AI Receptionist Demo — Supabase Schema
-- =====================================================
-- Run this in Supabase SQL Editor (https://app.supabase.com → SQL → New query)
-- Or via CLI: supabase db push

-- Enable UUID generation
create extension if not exists "pgcrypto";

-- =====================================================
-- Bosses (contractors)
-- =====================================================
-- For the demo we use a single boss. The schema is designed so multiple bosses
-- can be added later without changes.
create table public.bosses (
  id uuid primary key default gen_random_uuid(),

  -- Profile
  company_name text not null,
  owner_name text not null,
  phone text not null,                          -- Boss's personal cell for callbacks

  -- Address (used as origin for service radius calc)
  service_base_address text,
  service_base_zip text not null,
  service_radius_miles int not null default 25,

  -- Service config
  service_trades text[] not null default '{plumbing,electrical,hvac,handyman,general}',
  diagnostic_fee numeric(10, 2) not null default 0,

  -- Business hours as JSON: { mon: {start:"08:00", end:"18:00"}, ... }
  -- Days: mon, tue, wed, thu, fri, sat, sun
  business_hours jsonb not null default '{
    "mon":{"start":"08:00","end":"18:00"},
    "tue":{"start":"08:00","end":"18:00"},
    "wed":{"start":"08:00","end":"18:00"},
    "thu":{"start":"08:00","end":"18:00"},
    "fri":{"start":"08:00","end":"18:00"},
    "sat":{"start":"09:00","end":"14:00"},
    "sun":null
  }'::jsonb,
  timezone text not null default 'America/Chicago',

  -- Price list as JSON: { "plumbing": { "low": 150, "high": 400 }, ... }
  price_list jsonb not null default '{
    "plumbing":  { "low": 150, "high": 400 },
    "electrical":{ "low": 120, "high": 350 },
    "hvac":      { "low": 200, "high": 500 },
    "handyman":  { "low": 100, "high": 300 },
    "roofing":   { "low": 250, "high": 800 },
    "general":   { "low": 100, "high": 300 }
  }'::jsonb,

  -- Zip prefixes that count as "in service area" (fallback when Google Maps unavailable)
  service_zip_prefixes text[] not null default '{770,771,772,773,774,775}',

  -- Vapi integration
  vapi_assistant_id text,
  twilio_phone_number text,

  -- Common Q&A the AI can answer verbatim
  faq jsonb not null default '{}'::jsonb,

  -- Routing
  routing_mode text not null default 'after_hours'
    check (routing_mode in ('after_hours', 'always', 'busy')),
  routing_ring_seconds int not null default 15,

  -- Whitelist (phone numbers that always ring boss directly)
  whitelist_numbers text[] not null default '{}',

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- =====================================================
-- Customers
-- =====================================================
create table public.customers (
  id uuid primary key default gen_random_uuid(),
  boss_id uuid not null references public.bosses(id) on delete cascade,
  phone text not null,
  name text,
  address text,
  zipcode text,
  notes text,
  total_jobs int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  -- One customer per (boss, phone)
  unique (boss_id, phone)
);
create index customers_boss_id_idx on public.customers (boss_id);

-- =====================================================
-- Work orders
-- =====================================================
create table public.work_orders (
  id uuid primary key default gen_random_uuid(),

  -- Relations
  boss_id uuid not null references public.bosses(id) on delete cascade,
  customer_id uuid references public.customers(id) on delete set null,

  -- Customer info (snapshot at call time, may differ from current customer record)
  customer_name text,
  customer_phone text not null,
  customer_address text,
  customer_zipcode text,

  -- Job info
  issue_type text,
  issue_details text,
  preferred_time text,

  -- AI decision
  ai_decision text not null
    check (ai_decision in ('accepted', 'urgent', 'unsure', 'rejected')),
  ai_decision_reason text,
  quote_low numeric(10, 2),
  quote_high numeric(10, 2),

  -- Natural language summary (for SMS / quick read)
  summary text,

  -- Call artifacts
  vapi_call_id text unique,
  recording_url text,
  transcript jsonb,                              -- array of {role, text, ts}

  -- State machine
  status text not null default 'pending'
    check (status in (
      'pending',      -- AI processed, awaiting boss action
      'confirmed',    -- boss accepted
      'rejected',     -- boss rejected
      'callback',     -- needs boss callback (uncertain)
      'urgent',       -- urgent, awaiting boss response
      'completed',    -- job done
      'cancelled'     -- customer cancelled
    )),

  -- Boss action timestamps
  confirmed_at timestamptz,
  callback_initiated_at timestamptz,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index work_orders_boss_id_idx on public.work_orders (boss_id);
create index work_orders_status_idx on public.work_orders (status);
create index work_orders_created_at_idx on public.work_orders (created_at desc);
create index work_orders_vapi_call_id_idx on public.work_orders (vapi_call_id);

-- =====================================================
-- Call events (raw audit log of Vapi webhooks)
-- =====================================================
create table public.call_events (
  id uuid primary key default gen_random_uuid(),
  work_order_id uuid references public.work_orders(id) on delete cascade,
  vapi_call_id text,
  event_type text not null,                      -- 'call.started', 'call.ended', 'transcript', etc.
  payload jsonb not null,
  created_at timestamptz not null default now()
);
create index call_events_vapi_call_id_idx on public.call_events (vapi_call_id);
create index call_events_created_at_idx on public.call_events (created_at desc);

-- =====================================================
-- Notifications log (audit what we sent the boss)
-- =====================================================
create table public.notifications (
  id uuid primary key default gen_random_uuid(),
  work_order_id uuid references public.work_orders(id) on delete cascade,
  channel text not null,                         -- 'sms' | 'app' | 'email'
  recipient text not null,
  message text not null,
  status text not null,                          -- 'sent' | 'failed'
  error text,
  created_at timestamptz not null default now()
);
create index notifications_work_order_id_idx on public.notifications (work_order_id);

-- =====================================================
-- Auto-update updated_at timestamps
-- =====================================================
create or replace function public.tg_set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger bosses_set_updated_at
  before update on public.bosses
  for each row execute function public.tg_set_updated_at();

create trigger customers_set_updated_at
  before update on public.customers
  for each row execute function public.tg_set_updated_at();

create trigger work_orders_set_updated_at
  before update on public.work_orders
  for each row execute function public.tg_set_updated_at();

-- =====================================================
-- Row Level Security (RLS)
-- =====================================================
-- For the demo, we use the service role key in API routes (bypasses RLS).
-- The dashboard reads via the anon key, so we enable RLS but allow full read
-- for the demo. Tighten this in production.

alter table public.bosses enable row level security;
alter table public.customers enable row level security;
alter table public.work_orders enable row level security;
alter table public.call_events enable row level security;
alter table public.notifications enable row level security;

-- Demo policies: allow all reads, no writes from anon (writes go through API routes)
create policy "Demo: read all bosses" on public.bosses for select using (true);
create policy "Demo: read all customers" on public.customers for select using (true);
create policy "Demo: read all work_orders" on public.work_orders for select using (true);
create policy "Demo: read all call_events" on public.call_events for select using (true);
create policy "Demo: read all notifications" on public.notifications for select using (true);

-- Updates via service role (API routes only) — anon cannot update

-- =====================================================
-- Realtime (for live dashboard updates)
-- =====================================================
alter publication supabase_realtime add table public.work_orders;
alter publication supabase_realtime add table public.notifications;

-- =====================================================
-- Seed default boss (Handy Works / Alex)
-- =====================================================
insert into public.bosses (
  company_name, owner_name, phone,
  service_base_zip, service_radius_miles,
  diagnostic_fee
) values (
  'Handy Works Home Services', 'Alex', '+17135559876',
  '77002', 25, 89
)
on conflict do nothing;
