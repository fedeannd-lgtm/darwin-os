-- Add shortlist_filter to distribution_templates
-- 'all' = todos, 'only' = solo shortlisted, 'exclude' = excluir shortlisted
ALTER TABLE distribution_templates
  ADD COLUMN IF NOT EXISTS shortlist_filter text NOT NULL DEFAULT 'all'
  CHECK (shortlist_filter IN ('all', 'only', 'exclude'));
