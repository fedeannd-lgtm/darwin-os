-- Aggregate prospect funnel metrics by ISO week, server-side.
-- Avoids the PostgREST 1000-row default limit.
-- "enviados" covers both flows:
--   - old distribution flow: sent_at IS NOT NULL
--   - new shortlist flow:    shortlist_status = 'Enviado'
CREATE OR REPLACE FUNCTION get_prospect_scorecard()
RETURNS TABLE(
  iso_week        text,
  shortlisted     bigint,
  enriched        bigint,
  enviados        bigint,
  reuniones       bigint,
  reuniones_total bigint
) LANGUAGE sql SECURITY DEFINER AS $$
  SELECT
    to_char(date_trunc('week', created_at AT TIME ZONE 'UTC'), 'IYYY"-W"IW') AS iso_week,
    COUNT(*) FILTER (WHERE shortlisted = true)                                               AS shortlisted,
    COUNT(*) FILTER (WHERE email IS NOT NULL AND email <> '')                                AS enriched,
    COUNT(*) FILTER (WHERE sent_at IS NOT NULL OR shortlist_status = 'Enviado')             AS enviados,
    COUNT(DISTINCT COALESCE(split_part(email, '@', 2), company_name))
      FILTER (WHERE shortlist_status = 'Reunión Agendada')                                  AS reuniones,
    COUNT(DISTINCT COALESCE(split_part(email, '@', 2), company_name))
      FILTER (WHERE shortlist_status IN ('Reunión Agendada', 'Reunión No SQL'))             AS reuniones_total
  FROM prospects
  GROUP BY 1
  ORDER BY 1 DESC;
$$;
