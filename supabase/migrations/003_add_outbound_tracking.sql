-- =====================================================
-- Migration 003: Emergency outbound call tracking
-- =====================================================
-- Adds columns to track when we called the boss about an urgent job,
-- how many times, and what the boss decided.

alter table public.work_orders
  add column if not exists outbound_attempts int not null default 0,
  add column if not exists last_outbound_at timestamptz,
  add column if not exists outbound_call_id text,
  add column if not exists boss_decision text
    check (boss_decision in ('callback_initiated', 'queued'));
