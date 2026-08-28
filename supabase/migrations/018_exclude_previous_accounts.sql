ALTER TABLE inbox_config ADD COLUMN IF NOT EXISTS exclude_previous boolean DEFAULT false;
