-- Instrucciones personalizadas para mensajes de LinkedIn en shortlist
ALTER TABLE inbox_config
  ADD COLUMN IF NOT EXISTS linkedin_instructions text;
