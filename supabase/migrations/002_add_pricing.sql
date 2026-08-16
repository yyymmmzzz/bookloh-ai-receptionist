-- =====================================================
-- Migration 002: Pricing breakdown + distance surcharge
-- =====================================================
-- Adds:
--   - bosses.free_distance_miles (default 15) — miles within base before surcharge kicks in
--   - bosses.distance_surcharge_per_mile (default 2.00) — $ per mile over free_distance_miles
--   - work_orders.pricing_breakdown jsonb — full price breakdown snapshot at call time
--     Schema: {
--       "trip_fee": 89,
--       "fuel_surcharge": 6,
--       "total_trip_fee": 95,
--       "range_low": 150,
--       "range_high": 400,
--       "total_low": 245,
--       "total_high": 495,
--       "distance_miles": 18,
--       "free_distance_miles": 15,
--       "surcharge_per_mile": 2
--     }
-- =====================================================

alter table public.bosses
  add column if not exists free_distance_miles int not null default 15,
  add column if not exists distance_surcharge_per_mile numeric(10, 2) not null default 2.00;

alter table public.work_orders
  add column if not exists pricing_breakdown jsonb;

-- Backfill the default boss with explicit values (so the dashboard has data even if migration ran before row creation)
update public.bosses
set
  free_distance_miles = coalesce(free_distance_miles, 15),
  distance_surcharge_per_mile = coalesce(distance_surcharge_per_mile, 2.00)
where free_distance_miles is null or distance_surcharge_per_mile is null;
