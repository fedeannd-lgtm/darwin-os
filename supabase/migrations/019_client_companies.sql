-- Lista de empresas clientes (para crear lista en Sales Nav y excluir de búsquedas)
CREATE TABLE IF NOT EXISTS client_companies (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at timestamptz DEFAULT now(),
  company_name text NOT NULL,
  linkedin_url text,      -- URL de LinkedIn de la empresa (opcional, mejora precisión)
  sales_nav_id text,      -- poblado por la extensión tras resolverlo
  domain text
);

ALTER TABLE client_companies ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow all on client_companies" ON client_companies FOR ALL USING (true) WITH CHECK (true);

-- Toggle de exclusión en la configuración singleton de inbox
ALTER TABLE inbox_config ADD COLUMN IF NOT EXISTS exclude_clients boolean DEFAULT false;
