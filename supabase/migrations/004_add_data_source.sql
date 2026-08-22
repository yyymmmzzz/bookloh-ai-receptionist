-- Migration 004: Add data_source column to work_orders
-- Distinguishes between:
--   demo        — pre-seeded sample data for showing clients what the system looks like
--   production  — real calls from Vapi (webhook)
--   test        — automated regression test scenarios (test-scenarios.js)

ALTER TABLE work_orders
  ADD COLUMN IF NOT EXISTS data_source TEXT NOT NULL DEFAULT 'production'
  CHECK (data_source IN ('demo', 'production', 'test'));

-- Index for fast filtering by source
CREATE INDEX IF NOT EXISTS idx_work_orders_data_source
  ON work_orders (data_source, created_at DESC);

-- Comment for clarity
COMMENT ON COLUMN work_orders.data_source IS
  'Origin of this record: demo = pre-seeded sample; production = real Vapi call; test = automated regression scenario';
