-- Migration 008: Add summary_hash column to work_orders for LLM caching
-- Date: 2026-08-23
-- Purpose: Avoid duplicate LLM calls when re-running imports on the same
-- transcript. Compute SHA-256 of (transcript + decision + issueType) and
-- skip LLM call if we already have a work_order with the same hash.
-- Saves 5-10% on re-runs.

ALTER TABLE work_orders
  ADD COLUMN IF NOT EXISTS summary_hash TEXT;

-- Index for cache lookup
CREATE INDEX IF NOT EXISTS work_orders_summary_hash_idx
  ON work_orders (summary_hash)
  WHERE summary_hash IS NOT NULL;
