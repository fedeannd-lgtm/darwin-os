-- Add list_id and list_name to campaigns table
-- These columns link a campaign to a Sales Navigator account list
-- and were present in 000_install_fresh.sql but missing from incremental migrations.

alter table public.campaigns add column if not exists list_id text;
alter table public.campaigns add column if not exists list_name text;
