-- Migration 007: Add llm_usage table for cost tracking
-- Date: 2026-08-23
-- Purpose: Track every OpenAI API call so we can monitor cost, identify
-- expensive calls, and detect regressions in the prompt.

CREATE TABLE IF NOT EXISTS llm_usage (
  id BIGSERIAL PRIMARY KEY,
  call_id TEXT,                          -- Vapi call id (nullable for non-call usage)
  source TEXT NOT NULL,                  -- 'webhook' | 'reclassify' | 'manual'
  model TEXT NOT NULL,                   -- e.g. 'gpt-4o-mini-2024-07-18'
  prompt_tokens INT NOT NULL DEFAULT 0,
  completion_tokens INT NOT NULL DEFAULT 0,
  total_tokens INT NOT NULL DEFAULT 0,
  cost_usd NUMERIC(10, 6) NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Index for time-range queries
CREATE INDEX IF NOT EXISTS llm_usage_created_at_idx
  ON llm_usage (created_at DESC);

-- Index for call_id lookups
CREATE INDEX IF NOT EXISTS llm_usage_call_id_idx
  ON llm_usage (call_id) WHERE call_id IS NOT NULL;
