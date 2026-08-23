-- Migration 005: Add follow-up + intent fields to work_orders
-- Date: 2026-08-23
-- Purpose: AI receptionist should always capture (a) what the customer said,
-- (b) explicit info (name), (c) their tendency/intent, and (d) follow-up
-- recommendation for the boss. Currently we only capture the AI's decision +
-- summary, which loses a lot of valuable info when the AI rejects a call
-- or hands off to human.

ALTER TABLE work_orders
  -- Extracted from transcript (more reliable than Vapi's caller-ID name).
  -- Common patterns: "my name is X", "I'm X", "this is X", "name's X"
  ADD COLUMN IF NOT EXISTS customer_name_extracted TEXT,

  -- Free-text summary of what the customer was asking about / saying.
  -- Always populated, even when decision is "rejected" — so the boss can
  -- see what the customer wanted and decide if they can serve them after all.
  ADD COLUMN IF NOT EXISTS intent_summary TEXT,

  -- Classified customer tendency (helps boss prioritize callbacks):
  --   "service_inquiry"  - asking what we can do / what's covered
  --   "scheduling"       - explicitly setting up an appointment
  --   "price_shopping"   - asking rates / comparing prices
  --   "considering"      - "let me think about it / call you back"
  --   "complaint"        - unhappy with prior service
  --   "urgent"           - emergency situation
  --   "uncertain"        - couldn't clearly identify intent
  ADD COLUMN IF NOT EXISTS customer_tendency TEXT,

  -- All topics the customer mentioned (e.g. "water pump", "garbage disposal",
  -- "electrical removal"). Used for follow-up context. Stored as a TEXT array
  -- for easy filtering and full-text search later.
  ADD COLUMN IF NOT EXISTS mentioned_topics TEXT[] DEFAULT '{}',

  -- Follow-up recommendation for the boss:
  --   "high"   - customer wanted something we can do but AI missed it
  --   "medium" - customer may convert with a callback
  --   "low"    - low-value lead, not worth immediate follow-up
  --   "none"   - no follow-up needed (junk call, fully handled, etc.)
  ADD COLUMN IF NOT EXISTS follow_up_priority TEXT,

  -- Free-text explanation of why this priority
  ADD COLUMN IF NOT EXISTS follow_up_notes TEXT,

  -- Did the AI hand off to a human for callback? True when decision="unsure"
  -- or when AI explicitly called flag_uncertain.
  ADD COLUMN IF NOT EXISTS follow_up_recommended BOOLEAN DEFAULT false;

-- Index for the dashboard "needs follow-up" filter
CREATE INDEX IF NOT EXISTS work_orders_follow_up_idx
  ON work_orders (follow_up_priority, follow_up_recommended, created_at DESC)
  WHERE follow_up_recommended = true;

-- GIN index for searching mentioned topics
CREATE INDEX IF NOT EXISTS work_orders_topics_gin_idx
  ON work_orders USING GIN (mentioned_topics);
