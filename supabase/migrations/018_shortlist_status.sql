ALTER TABLE prospects ADD COLUMN IF NOT EXISTS shortlist_status text DEFAULT 'Pendiente';
