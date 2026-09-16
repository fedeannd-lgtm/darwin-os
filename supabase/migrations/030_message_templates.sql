-- Message templates for LinkedIn prompts, Email prompts, and WhatsApp messages.
-- Templates can be optionally scoped to an industry.
CREATE TABLE IF NOT EXISTS message_templates (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  name        text        NOT NULL,
  channel     text        NOT NULL CHECK (channel IN ('linkedin', 'email', 'whatsapp')),
  content     text        NOT NULL,
  industry    text,
  created_at  timestamptz DEFAULT now()
);
