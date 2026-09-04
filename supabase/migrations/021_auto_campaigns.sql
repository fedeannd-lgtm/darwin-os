-- Tabla de campañas automáticas
-- Cada row representa una campaña configurada para correr sola en un horario determinado.
-- El motor (lib/auto-campaign-engine.ts) lee esta tabla cada 5 min y avanza el estado.

CREATE TABLE IF NOT EXISTS auto_campaigns (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at timestamptz DEFAULT now(),

  -- Campaña de ProspectOS a la que pertenece (creada junto con este row)
  campaign_id uuid NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,

  -- Company Search
  company_search_url    text NOT NULL,
  company_count         int  NOT NULL DEFAULT 50,
  exclude_previous      boolean NOT NULL DEFAULT true,
  exclusion_date_from   date,
  exclusion_date_to     date,
  start_page            int  NOT NULL DEFAULT 1,

  -- People Search
  people_search_url     text NOT NULL,
  people_count          int  NOT NULL DEFAULT 100,

  -- Enrichment
  enrich_emails         boolean NOT NULL DEFAULT true,
  enrich_phones         boolean NOT NULL DEFAULT false,
  classify_icp          boolean NOT NULL DEFAULT true,
  normalize_names       boolean NOT NULL DEFAULT true,
  shortlist_icp_min     int  NOT NULL DEFAULT 10,
  shortlist_title_keywords text,         -- "CEO,Founder,Director" (comma-sep, case-insensitive)

  -- Distribución
  distribution_template_id   uuid REFERENCES distribution_templates(id) ON DELETE SET NULL,
  distribution_template_name text,

  -- Programación
  scheduled_at timestamptz NOT NULL,

  -- Estado de ejecución
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','company_search','people_search','enriching','distributing','done','error')),

  current_step_detail text,        -- "Enriqueciendo 43/120..."
  enrichment_offset   int NOT NULL DEFAULT 0,

  -- Error
  error_message text,

  -- Resultados finales (se pueblan al pasar a done)
  result_companies        int,
  result_people           int,
  result_emails_found     int,
  result_icp_distribution jsonb,   -- { "Experience": 12, "Helpdesk": 8, ... }
  result_shortlisted      int,
  result_distributed      jsonb,   -- copia de distribution_runs.results
  completed_at            timestamptz
);

-- Índices útiles para el cron
CREATE INDEX IF NOT EXISTS idx_auto_campaigns_status ON auto_campaigns(status);
CREATE INDEX IF NOT EXISTS idx_auto_campaigns_scheduled ON auto_campaigns(scheduled_at) WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS idx_auto_campaigns_campaign ON auto_campaigns(campaign_id);
