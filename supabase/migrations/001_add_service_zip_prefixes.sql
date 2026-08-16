-- Migration: add service_zip_prefixes column to bosses
-- Run this in Supabase SQL Editor
ALTER TABLE public.bosses
  ADD COLUMN IF NOT EXISTS service_zip_prefixes text[] NOT NULL DEFAULT '{770,771,772,773,774,775}';
