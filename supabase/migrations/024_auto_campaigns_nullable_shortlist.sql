-- shortlist_icp_min puede ser null cuando el auto-shortlist está desactivado
ALTER TABLE auto_campaigns ALTER COLUMN shortlist_icp_min DROP NOT NULL;
