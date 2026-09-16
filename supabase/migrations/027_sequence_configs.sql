-- Configuración estructurada de secuencias de LinkedIn y Cold Email
ALTER TABLE inbox_config
  ADD COLUMN IF NOT EXISTS linkedin_sequence_config jsonb,
  ADD COLUMN IF NOT EXISTS email_sequence_config    jsonb;
