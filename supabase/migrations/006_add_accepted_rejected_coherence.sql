-- Migration 006: Add accepted/rejected topics + transcript coherence
-- Date: 2026-08-23
-- Purpose: Capture the FULL call story (what customer asked → what AI accepted/rejected)
-- so the boss can see multi-issue conversations (e.g. roofing→rejected, hvac→accepted)
-- rather than just the final mixed topic list.

ALTER TABLE work_orders
  -- Topics the AI said YES to (in_trade=true for check_trade).
  -- Multi-issue calls split: Matt's call has ["hvac"] here, ["roof"] in rejected_topics.
  ADD COLUMN IF NOT EXISTS accepted_topics TEXT[] DEFAULT '{}',

  -- Topics the AI said NO to (in_trade=false for check_trade, or end_call with rejected).
  -- Useful for understanding what the customer actually wanted but we don't do.
  ADD COLUMN IF NOT EXISTS rejected_topics TEXT[] DEFAULT '{}',

  -- Coherence score: "low" / "medium" / "high"
  --   low = short / broken transcript (likely wrong number, misdial, or STT failure)
  --   high = full coherent conversation with clear service request
  -- Drives follow-up priority — low-coherence calls shouldn't get medium follow-up.
  ADD COLUMN IF NOT EXISTS transcript_coherence TEXT;

-- Index for the "needs follow-up" filter (combines with follow_up_priority)
CREATE INDEX IF NOT EXISTS work_orders_accepted_topics_gin_idx
  ON work_orders USING GIN (accepted_topics);

CREATE INDEX IF NOT EXISTS work_orders_rejected_topics_gin_idx
  ON work_orders USING GIN (rejected_topics);
