"use server"

import { revalidatePath } from "next/cache"
import { supabase, supabaseAdmin } from "@/lib/supabase"

export type SavedUrl = {
  id: string
  rep_name: string
  industry: string
  url_type: "company_search" | "people_search"
  url: string
  label: string | null
  times_used: number  // DB default 0; optional when creating
  created_at: string
}

export async function incrementSavedUrlUsage(repName: string, industry: string, urlType: "company_search" | "people_search", url: string): Promise<void> {
  const { data } = await supabaseAdmin
    .from("saved_urls")
    .select("id, times_used")
    .eq("rep_name", repName)
    .eq("industry", industry)
    .eq("url_type", urlType)
    .eq("url", url)
    .maybeSingle()
  if (data) {
    await supabaseAdmin
      .from("saved_urls")
      .update({ times_used: (data.times_used ?? 0) + 1 })
      .eq("id", data.id)
  }
}

export async function getSavedUrls(): Promise<SavedUrl[]> {
  const { data, error } = await supabase
    .from("saved_urls")
    .select("*")
    .order("rep_name")
    .order("industry")
    .order("url_type")
    .order("created_at")
  if (error) throw new Error(error.message)
  return (data ?? []) as SavedUrl[]
}

export async function createSavedUrl(payload: Omit<SavedUrl, "id" | "created_at" | "times_used">): Promise<SavedUrl> {
  const { data, error } = await supabaseAdmin.from("saved_urls").insert(payload).select().single()
  if (error) throw new Error(error.message)
  revalidatePath("/settings")
  return data as SavedUrl
}

export async function deleteSavedUrl(id: string) {
  const { error } = await supabaseAdmin.from("saved_urls").delete().eq("id", id)
  if (error) throw new Error(error.message)
  revalidatePath("/settings")
}

import { REPS } from "@/lib/reps"

export async function getRepConfigs() {
  const { data, error } = await supabase
    .from("rep_configs")
    .select("rep_name, linkedin_cookie, updated_at")
    .order("rep_name")
  if (error) throw new Error(error.message)

  // Merge stored configs with known reps so all 5 always appear
  return REPS.map((rep) => {
    const stored = data?.find((r) => r.rep_name === rep)
    return {
      rep_name: rep,
      linkedin_cookie: stored?.linkedin_cookie ?? null,
      updated_at: stored?.updated_at ?? null,
    }
  })
}

export type ProviderUsage = {
  provider: string
  label: string
  today: number
  week: number
  month: number
  total: number
}

const PROVIDER_LABELS: Record<string, string> = {
  apollo: "Apollo",
  findymail: "FindyEmail",
  prospeo: "Prospeo",
  hunter: "Hunter",
  datagma: "Datagma",
  pattern: "Patrón",
}

export async function getProviderUsage(): Promise<ProviderUsage[]> {
  const now = new Date()
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString()
  const startOfWeek = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString()
  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1).toISOString()

  const { data, error } = await supabase
    .from("prospects")
    .select("email_provider, created_at")
    .not("email_provider", "is", null)
  if (error) throw new Error(error.message)

  const map = new Map<string, ProviderUsage>()

  for (const row of data ?? []) {
    const key = row.email_provider as string
    if (!map.has(key)) {
      map.set(key, { provider: key, label: PROVIDER_LABELS[key] ?? key, today: 0, week: 0, month: 0, total: 0 })
    }
    const entry = map.get(key)!
    entry.total++
    if (row.created_at >= startOfMonth) entry.month++
    if (row.created_at >= startOfWeek) entry.week++
    if (row.created_at >= startOfToday) entry.today++
  }

  const ORDER = ["apollo", "findymail", "prospeo", "hunter", "datagma", "pattern"]
  return Array.from(map.values()).sort((a, b) => {
    const ia = ORDER.indexOf(a.provider)
    const ib = ORDER.indexOf(b.provider)
    return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib)
  })
}

// ── Client companies ──────────────────────────────────────────────────────────

export type ClientCompany = {
  id: string
  company_name: string
  linkedin_url: string | null
  sales_nav_id: string | null
  domain: string | null
}

export async function getClientCompanies(): Promise<ClientCompany[]> {
  const { data, error } = await supabase
    .from("client_companies")
    .select("id, company_name, linkedin_url, sales_nav_id, domain")
    .order("company_name")
  if (error) throw new Error(error.message)
  return (data ?? []) as ClientCompany[]
}

export async function saveClientCompanies(
  entries: { company_name: string; linkedin_url?: string | null; domain?: string | null }[]
): Promise<void> {
  // Deduplicate by normalized name
  const seen = new Set<string>()
  const rows = entries
    .filter((e) => e.company_name.trim())
    .filter((e) => {
      const key = e.company_name.trim().toLowerCase()
      if (seen.has(key)) return false
      seen.add(key)
      return true
    })
    .map((e) => ({ company_name: e.company_name.trim(), linkedin_url: e.linkedin_url || null, domain: e.domain || null }))

  await supabaseAdmin.from("client_companies").delete().neq("id", "00000000-0000-0000-0000-000000000000")
  if (rows.length > 0) await supabaseAdmin.from("client_companies").insert(rows)
  revalidatePath("/settings")
}

export async function updateClientCompanySalesNavIds(
  results: { company_name: string; sales_nav_id: string }[]
): Promise<void> {
  for (const { company_name, sales_nav_id } of results) {
    await supabaseAdmin
      .from("client_companies")
      .update({ sales_nav_id })
      .eq("company_name", company_name)
  }
}

export async function updateClientCompanyLinkedinUrl(
  id: string,
  linkedin_url: string | null
): Promise<void> {
  await supabaseAdmin
    .from("client_companies")
    .update({ linkedin_url: linkedin_url || null })
    .eq("id", id)
  revalidatePath("/settings")
}

export async function getCampaignIndustries(): Promise<string[]> {
  const { data } = await supabase
    .from("campaigns")
    .select("industry")
  if (!data) return []
  const unique = [...new Set(data.map((r) => r.industry as string).filter(Boolean))]
  return unique.sort()
}

export async function upsertRepCookie(repName: string, cookie: string) {
  const { error } = await supabaseAdmin
    .from("rep_configs")
    .upsert(
      { rep_name: repName, linkedin_cookie: cookie, updated_at: new Date().toISOString() },
      { onConflict: "rep_name" }
    )
  if (error) throw new Error(error.message)
  revalidatePath("/settings")
}

// ── HubSpot sync ─────────────────────────────────────────────────────────────

/**
 * Stages that indicate a SQL-qualified meeting (Sales Qualified Lead or above).
 * Prospects from these deals get shortlist_status = 'Reunión Agendada'.
 */
/** SQL-qualified meetings → shortlist_status = 'Reunión Agendada' */
const QUALIFYING_STAGE_LABELS = new Set([
  "Interested",
  "Sales Qualified Lead",
  "Sales Qualified Opportunity",
  "Advanced Opportunity",
  "Integration in progress",
  "Trial in progress",
  "Won",
])

/**
 * Stages that mean the deal is dead — excluded from both SQL and Total counts.
 * "On Hold" and "Oppty Lost" are intentionally NOT here so they count in Total.
 */
const LOST_STAGE_LABELS = new Set([
  "Closed Lost",
  "Lost",
  "Not Interested",
  "Disqualified",
  "No Show",
])

/** Normalize a company name for fuzzy matching:
 *  - lowercase
 *  - strip trailing legal suffixes (S.A., S.R.L., II, etc.)
 *  - strip parenthetical content
 *  - trim
 */
function _normalizeCompanyName(name: string): string {
  return name
    .toLowerCase()
    .replace(/\s*\(.*?\)\s*/g, " ")       // remove (Junio 2026) etc.
    .replace(/\s+(i{1,3}|iv|v|vi{0,3}|ix|x)\s*$/i, "") // trailing roman numerals
    .replace(/\s+(s\.?a\.?s?\.?|s\.?r\.?l\.?|inc\.?|ltd\.?|llc\.?|s\.?p\.?a\.?)\s*$/i, "")
    .replace(/[^\w\s]/g, " ")             // punctuation → space
    .replace(/\s+/g, " ")
    .trim()
}

export async function syncHubspotDeals(): Promise<{ updated: number; error?: string }> {
  try {
    const { getDealPipelineStages, getAllDeals, getContactEmails, getCompanyInfo } = await import("@/lib/hubspot")

    // Resolve stage label → internal IDs
    const stages = await getDealPipelineStages()
    const qualifyingIds = new Set(
      stages.filter((s) => QUALIFYING_STAGE_LABELS.has(s.label)).map((s) => s.id)
    )
    const lostIds = new Set(
      stages.filter((s) => LOST_STAGE_LABELS.has(s.label)).map((s) => s.id)
    )

    // Pull all deals; keep only qualifying ones
    const allDeals = await getAllDeals()
    const qualifying = allDeals.filter(
      (d) => d.dealstage && qualifyingIds.has(d.dealstage)
    )

    if (qualifying.length === 0) return { updated: 0 }

    let totalUpdated = 0

    // ── Pass 1: match by contact email ────────────────────────────────────────
    const contactIds = [...new Set(qualifying.flatMap((d) => d.associatedContacts))]
    if (contactIds.length > 0) {
      const emailMap = await getContactEmails(contactIds)
      const emails = [...emailMap.values()]
      if (emails.length > 0) {
        const { error, count } = await supabaseAdmin
          .from("prospects")
          .update({ shortlist_status: "Reunión Agendada" })
          .in("email", emails)
          .neq("shortlist_status", "Reunión Agendada")
        if (error) throw new Error(error.message)
        totalUpdated += count ?? 0
      }
    }

    // ── Pass 2: match by company name / domain ────────────────────────────────
    const companyIds = [...new Set(qualifying.flatMap((d) => d.associatedCompanies))]
    if (companyIds.length > 0) {
      const companyMap = await getCompanyInfo(companyIds)

      // Build OR filter for Supabase: one ilike per company name + one eq per domain
      const orParts: string[] = []
      const domains: string[] = []

      for (const company of companyMap.values()) {
        if (company.name) {
          const normalized = _normalizeCompanyName(company.name)
          if (normalized.length >= 3) {
            // escape % and _ so they're treated as literals in the LIKE pattern
            const escaped = normalized.replace(/%/g, "\\%").replace(/_/g, "\\_")
            orParts.push(`company_name.ilike.%${escaped}%`)
          }
        }
        if (company.domain) {
          domains.push(company.domain.toLowerCase())
        }
      }

      if (orParts.length > 0 || domains.length > 0) {
        // Fetch candidates — can't do .update + .or directly on Supabase JS,
        // so select IDs first then bulk update
        let query = supabaseAdmin
          .from("prospects")
          .select("id")
          .neq("shortlist_status", "Reunión Agendada")

        const allOrParts = [
          ...orParts,
          ...(domains.length > 0 ? [`company_domain.in.(${domains.join(",")})`] : []),
        ]

        if (allOrParts.length > 0) {
          query = query.or(allOrParts.join(","))
        }

        const { data: candidates } = await query
        const ids = (candidates ?? []).map((r: { id: string }) => r.id)

        if (ids.length > 0) {
          // Update in batches of 500 to avoid URL length limits
          for (let i = 0; i < ids.length; i += 500) {
            const batch = ids.slice(i, i + 500)
            const { error, count } = await supabaseAdmin
              .from("prospects")
              .update({ shortlist_status: "Reunión Agendada" })
              .in("id", batch)
            if (error) throw new Error(error.message)
            totalUpdated += count ?? 0
          }
        }
      }
    }

    // ── Pass 3: pre-SQL active deals → 'Reunión No SQL' ─────────────────────
    // Any deal that's not qualifying (SQL+) and not lost = meeting happened but not yet qualified
    const preSql = allDeals.filter(
      (d) => d.dealstage && !qualifyingIds.has(d.dealstage) && !lostIds.has(d.dealstage)
    )
    if (preSql.length > 0) {
      // Email pass
      const preSqlContactIds = [...new Set(preSql.flatMap((d) => d.associatedContacts))]
      if (preSqlContactIds.length > 0) {
        const preSqlEmailMap = await getContactEmails(preSqlContactIds)
        const preSqlEmails = [...preSqlEmailMap.values()]
        if (preSqlEmails.length > 0) {
          await supabaseAdmin
            .from("prospects")
            .update({ shortlist_status: "Reunión No SQL" })
            .in("email", preSqlEmails)
            .not("shortlist_status", "in", '("Reunión Agendada")')
        }
      }
      // Company pass
      const preSqlCompanyIds = [...new Set(preSql.flatMap((d) => d.associatedCompanies))]
      if (preSqlCompanyIds.length > 0) {
        const preSqlCompanyMap = await getCompanyInfo(preSqlCompanyIds)
        const orParts: string[] = []
        for (const company of preSqlCompanyMap.values()) {
          if (company.name) {
            const normalized = _normalizeCompanyName(company.name)
            if (normalized.length >= 3) {
              const escaped = normalized.replace(/%/g, "\\%").replace(/_/g, "\\_")
              orParts.push(`company_name.ilike.%${escaped}%`)
            }
          }
        }
        if (orParts.length > 0) {
          const { data: candidates } = await supabaseAdmin
            .from("prospects")
            .select("id")
            .not("shortlist_status", "in", '("Reunión Agendada")')
            .neq("shortlist_status", "Reunión No SQL")
            .or(orParts.join(","))
          const ids = (candidates ?? []).map((r: { id: string }) => r.id)
          for (let i = 0; i < ids.length; i += 500) {
            await supabaseAdmin
              .from("prospects")
              .update({ shortlist_status: "Reunión No SQL" })
              .in("id", ids.slice(i, i + 500))
          }
        }
      }
    }

    revalidatePath("/shortlist")
    return { updated: totalUpdated }
  } catch (e) {
    return { updated: 0, error: e instanceof Error ? e.message : "Error desconocido" }
  }
}
