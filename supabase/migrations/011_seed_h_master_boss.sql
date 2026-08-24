-- Migration 011: Update MY boss with H-Master real data
-- Date: 2026-08-24
-- Purpose: Replace placeholder Bookloh MY boss with real H-Master Security
-- Services Sdn. Bhd. data. H-Master is HandyLine AI's first MY client — a
-- security/alarm/CCTV/autogate company in Bintulu, Sarawak.
--
-- Sources:
--   - Company website: http://h-master.com.my
--   - Facebook: facebook.com/people/H-Master-Security-Services-SB/100063539318730/
--   - Cross-verified via 4 MY business directories (bintulubiz, businesslist.my,
--     infoisinfo.com.my, mypages.my)
--
-- Idempotent: only updates if country='MY' row exists; safe to re-run.

UPDATE bosses
SET
  company_name = 'H-Master Security Services Sdn. Bhd.',
  owner_name = 'H-Master Service Desk',
  phone = '+6086331118',
  service_base_address = 'Lot 699 & 698, Jalan Sultan Iskandar, 2½ Miles, Light Industries Estate, 97000 Bintulu, Sarawak',
  service_base_zip = '97000',
  service_radius_miles = 31,           -- 50 km ≈ 31 miles (Bintulu + surrounding)
  service_radius_km = 50,
  service_postal_prefixes = ARRAY['97'],   -- Bintulu + Sarawak north
  service_trades = ARRAY['security','alarm','cctv','autogate','access_control','door_lock','general'],
  diagnostic_fee = 89,                 -- RM89 trip/diagnostic fee
  -- Pricing: security/alarm/CCTV/autogate/access control/door lock (in MYR)
  price_list = '{
    "security":   {"low": 200, "high": 1500},
    "alarm":      {"low": 200, "high": 1500},
    "cctv":       {"low": 500, "high": 3000},
    "autogate":   {"low": 500, "high": 2500},
    "access_control": {"low": 300, "high": 1500},
    "door_lock":  {"low": 300, "high": 2000},
    "general":    {"low": 150, "high": 800}
  }'::jsonb,
  -- Business hours: Mon-Fri 8:00-17:30, Sat 8:00-13:00, Sun closed
  business_hours = '{
    "mon": {"start": "08:00", "end": "17:30"},
    "tue": {"start": "08:00", "end": "17:30"},
    "wed": {"start": "08:00", "end": "17:30"},
    "thu": {"start": "08:00", "end": "17:30"},
    "fri": {"start": "08:00", "end": "17:30"},
    "sat": {"start": "08:00", "end": "13:00"},
    "sun": null
  }'::jsonb,
  timezone = 'Asia/Kuala_Lumpur',
  country = 'MY',
  currency_code = 'MYR',
  currency_symbol = 'RM',
  locale = 'en-MY',
  -- No fuel surcharge for Bintulu (small city, trip fee covers transport)
  free_distance_miles = 999,
  distance_surcharge_per_mile = 0,
  routing_mode = 'after_hours',
  updated_at = now()
WHERE country = 'MY';

-- Quick verification
DO $$
DECLARE
  rec RECORD;
BEGIN
  SELECT company_name, phone, service_base_zip, currency_symbol, array_length(service_trades, 1) as trade_count
    INTO rec
    FROM bosses
   WHERE country = 'MY'
   LIMIT 1;
  RAISE NOTICE 'H-Master boss updated: % | % | % | % | % trades',
    rec.company_name, rec.phone, rec.service_base_zip, rec.currency_symbol, rec.trade_count;
END $$;
