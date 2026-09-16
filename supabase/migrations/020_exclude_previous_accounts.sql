-- Toggle: exclude accounts already scraped in previous campaigns from new company searches
ALTER TABLE inbox_config ADD COLUMN IF NOT EXISTS exclude_previous boolean DEFAULT false;
