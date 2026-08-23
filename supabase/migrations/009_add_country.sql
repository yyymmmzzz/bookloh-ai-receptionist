-- Migration 009: Add country field to work_orders
-- Date: 2026-08-23
-- Purpose: Differentiate US (Houston) vs SEA (Singapore/Malaysia/Indonesia) calls
-- for dashboard splitting and country-specific analytics.

ALTER TABLE work_orders
  ADD COLUMN IF NOT EXISTS country TEXT;

-- Index for fast country filtering
CREATE INDEX IF NOT EXISTS work_orders_country_idx
  ON work_orders (country)
  WHERE country IS NOT NULL;
