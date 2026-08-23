-- Migration 010: Multi-region support for bosses table
-- Date: 2026-08-24
-- Purpose: Extend bosses table to support multiple countries (US, SG, MY, ID).
-- Each boss row now has a country, currency, locale, and either US zip prefixes
-- or SEA postal prefixes. Existing US boss (Alex) gets backfilled.

ALTER TABLE bosses
  -- ISO 3166-1 alpha-2 country code: 'US', 'SG', 'MY', 'ID', ...
  ADD COLUMN IF NOT EXISTS country TEXT,

  -- ISO 4217 currency code: 'USD', 'SGD', 'MYR', 'IDR'
  ADD COLUMN IF NOT EXISTS currency_code TEXT DEFAULT 'USD',

  -- Display symbol: '$', 'S$', 'RM', 'Rp'
  ADD COLUMN IF NOT EXISTS currency_symbol TEXT DEFAULT '$',

  -- BCP 47 locale tag: 'en-US', 'en-SG', 'en-MY', 'id-ID'
  ADD COLUMN IF NOT EXISTS locale TEXT DEFAULT 'en-US',

  -- Generic postal prefixes (used for SEA where postcodes vary by country).
  -- For US we keep using service_zip_prefixes; for SG/MY/ID use this field.
  -- Examples:
  --   SG: {'01','02',...,'20','22',...,'28'}
  --   MY: {'50','47','10','40','30',...} (Klang Valley, Penang, JB, ...)
  --   ID: {'10','11','12','40','60',...} (Jakarta, Bandung, Surabaya, ...)
  ADD COLUMN IF NOT EXISTS service_postal_prefixes TEXT[] DEFAULT '{}',

  -- Service radius in km (for SEA where miles is awkward). US keeps service_radius_miles.
  ADD COLUMN IF NOT EXISTS service_radius_km NUMERIC;

-- Index for fast country lookup
CREATE INDEX IF NOT EXISTS bosses_country_idx ON bosses (country) WHERE country IS NOT NULL;

-- Backfill Alex (US) boss
UPDATE bosses
SET country = 'US',
    currency_code = 'USD',
    currency_symbol = '$',
    locale = 'en-US',
    service_radius_km = service_radius_miles * 1.609344
WHERE country IS NULL
  AND phone LIKE '+1%';

-- Backfill any remaining NULL countries to 'US' (safe default; existing demo is all US)
UPDATE bosses SET country = 'US' WHERE country IS NULL;

-- Backfill work_orders.country from customer_phone prefix
UPDATE work_orders
SET country = CASE
  WHEN customer_phone LIKE '+1%'  THEN 'US'
  WHEN customer_phone LIKE '+65%' THEN 'SG'
  WHEN customer_phone LIKE '+60%' THEN 'MY'
  WHEN customer_phone LIKE '+62%' THEN 'ID'
  WHEN customer_phone IS NULL OR customer_phone = '' THEN 'US'
  ELSE 'US'
END
WHERE country IS NULL;

-- Insert MY placeholder boss (Bookloh Malaysia Office) - data will be updated from Facebook scrape
-- Idempotent: only insert if no MY boss exists yet
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM bosses WHERE country = 'MY') THEN
    INSERT INTO bosses (
      owner_name, phone, company_name, country,
      currency_code, currency_symbol, locale, timezone,
      service_postal_prefixes, service_radius_km,
      service_base_zip, service_radius_miles,
      service_trades, price_list, business_hours,
      diagnostic_fee, routing_mode
    ) VALUES (
      'Bookloh MY Lead', '+60123456789', 'Bookloh Malaysia Office', 'MY',
      'MYR', 'RM', 'en-MY', 'Asia/Kuala_Lumpur',
      ARRAY['50','47','40','30','10','20','80'],  -- KL, PJ, Shah Alam, Kuantan, Penang, JB, KK
      50,  -- 50 km radius around Klang Valley
      '50000', 31,  -- 50000 = KL center; 50 km ≈ 31 miles
      ARRAY['plumbing','electrical','handyman','general'],
      '{"plumbing":{"low":80,"high":350},"electrical":{"low":100,"high":300},"handyman":{"low":80,"high":250},"general":{"low":100,"high":300}}'::jsonb,
      '{"mon":{"start":"09:00","end":"18:00"},"tue":{"start":"09:00","end":"18:00"},"wed":{"start":"09:00","end":"18:00"},"thu":{"start":"09:00","end":"18:00"},"fri":{"start":"09:00","end":"18:00"},"sat":{"start":"09:00","end":"14:00"},"sun":null}'::jsonb,
      89, 'after_hours'
    );
  END IF;
END $$;
