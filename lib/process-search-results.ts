import { supabaseAdmin } from "@/lib/supabase"
import { advanceSearchPage } from "@/app/(app)/company-search/actions"

export type RawCompany = {
  companyName?: string
  id?: string
  website?: string
}

export type RawPerson = {
  firstName?: string
  lastName?: string
  fullName?: string
  jobTitle?: string
  headline?: string
  profileUrl?: string
  companyName?: string
  location?: string
  premium?: boolean
  connectionType?: number
  startedRoleMonths?: number | null
  currentPositions?: Array<{ title?: string; startedOn?: { month?: number; year?: number } }>
  highlights?: Array<{ name?: string; description?: string }>
}

export function extractDomain(raw: string): string {
  if (!raw) return ""
  try {
    const url = raw.startsWith("http") ? raw : `https://${raw}`
    return new URL(url).hostname.replace(/^www\./, "").toLowerCase()
  } catch {
    return raw.replace(/^https?:\/\/(www\.)?/, "").split("/")[0].toLowerCase()
  }
}

export function normalizePersonName(name: string): string {
  if (!name.trim()) return name
  return name
    .trim()
    .split(/\s+/)
    .map(word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join(' ')
}

export function normalizeCompanyName(name: string): string {
  let s = name
    .toLowerCase()
    .replace(/\./g, " ") // dots → spaces so "S.A." becomes "s a"
    .replace(/\s+/g, " ")
    .trim()

  // Legal entity suffixes — compound forms first (longer match wins)
  const legal = [
    /\bs\s*a\s*a\s*i\b/g,        // S.A.A.I.
    /\bs\s*a\s*s\b/g,             // S.A.S., SAS
    /\br\s*l\s+de\s+c\s*v\b/g,   // R.L. de CV
    /\bs\s*a\s+de\s+c\s*v\b/g,   // S.A. de C.V.
    /\bsa\s+de\s+cv\b/g,          // SA De CV
    /\bde\s+c\s*v\b/g,            // de C.V.
    /\bs\s*a\s*c\b/g,             // SAC, S.A.C., Sac
    /\bs\s*r\s*l\b/g,             // SRL, S.R.L.
    /\bs\s*a\b/g,                  // SA, S.A., S A
    /\bltda?\b/g,                  // Ltda, Ltd
    /\bcia\b/g,                    // Cia.
    /\binc\b/g,                    // Inc.
    /\bcorp\b/g,                   // Corp.
    /\bb\s*v\b/g,                  // B.V., BV
    /\bllc\b/g,                    // LLC
  ]
  for (const p of legal) s = s.replace(p, " ")

  // Country names (longer phrases first)
  const geo = [
    /\bde\s+m[eé]xico\b/g,
    /\bm[eé]xico\b/g,
    /\bde\s+chile\b/g,
    /\bargentina\b/g,
    /\bparaguay\b/g,
    /\buruguay\b/g,
    /\bchile\b/g,
    /\bcolombia\b/g,
    /\becuador\b/g,
  ]
  for (const p of geo) s = s.replace(p, " ")

  return s
    .replace(/[^a-z0-9\s]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\b\w/g, (c) => c.toUpperCase())
}

const STOPWORDS = new Set(["del", "los", "las", "una", "uno", "con", "por", "que", "son", "sus", "and", "the", "for"])

function sigWords(s: string): string[] {
  return s.split(/\s+/).filter((w) => w.length >= 3 && !STOPWORDS.has(w))
}

export async function processCompanySearch(
  jobId: string,
  job: { campaign_id: string; start_page?: number | null; campaigns: unknown },
  companies: RawCompany[]
) {
  const accounts = companies.map((c) => ({
    campaign_id: job.campaign_id,
    company_name: (c.companyName ?? "") as string,
    domain: (c.website ?? "") as string,
    sales_nav_id: (c.id ?? "") as string,
  }))

  if (accounts.length > 0) await supabaseAdmin.from("accounts").insert(accounts)

  // Count total accounts for this campaign (includes prior partial batches)
  const { count: totalCount } = await supabaseAdmin
    .from("accounts")
    .select("*", { count: "exact", head: true })
    .eq("campaign_id", job.campaign_id)
  const finalCount = totalCount ?? accounts.length

  await supabaseAdmin
    .from("search_jobs")
    .update({ status: "completed", results_count: finalCount, completed_at: new Date().toISOString() })
    .eq("id", jobId)

  await supabaseAdmin
    .from("campaigns")
    .update({ accounts_found: finalCount })
    .eq("id", job.campaign_id)

  const campaign = job.campaigns as { rep_name: string; industry: string } | null
  if (campaign) {
    await advanceSearchPage(campaign.rep_name, campaign.industry, finalCount, job.start_page ?? 1)
  }
}

export async function processPeopleSearch(
  jobId: string,
  job: { campaign_id: string },
  people: RawPerson[]
) {
  const { data: accounts } = await supabaseAdmin
    .from("accounts")
    .select("id, company_name, domain, campaign_id")

  type AccountVal = { id: string; domain: string; norm: string }
  const nameToAccount = new Map<string, AccountVal>()
  const sorted = [...(accounts ?? [])].sort((a, b) =>
    a.campaign_id === job.campaign_id ? 1 : b.campaign_id === job.campaign_id ? -1 : 0
  )
  sorted.forEach((a) => {
    if (a.company_name) {
      const norm = normalizeCompanyName(a.company_name)
      const val = { id: a.id, domain: extractDomain(a.domain ?? ""), norm }
      const existing = nameToAccount.get(norm)
      // Prefer accounts with domain over those without
      if (!existing || (!existing.domain && val.domain)) {
        nameToAccount.set(norm, val)
      }
    }
  })

  function findBestMatch(companyName: string): AccountVal | null {
    if (!companyName) return null
    const norm = normalizeCompanyName(companyName)
    if (!norm) return null
    const exact = nameToAccount.get(norm)
    if (exact) return exact
    let subMatch: AccountVal | null = null
    let bestSubLen = 0
    for (const [accountNorm, val] of nameToAccount.entries()) {
      if (accountNorm.length >= 6 && norm.includes(accountNorm) && accountNorm.length > bestSubLen) {
        subMatch = val; bestSubLen = accountNorm.length
      } else if (norm.length >= 6 && accountNorm.includes(norm) && norm.length > bestSubLen) {
        subMatch = val; bestSubLen = norm.length
      }
    }
    if (subMatch) return subMatch
    const pWords = sigWords(norm)
    if (pWords.length < 2) return null
    let best: AccountVal | null = null
    let bestCount = 0
    for (const [accountNorm, val] of nameToAccount.entries()) {
      const aWords = sigWords(accountNorm)
      const shared = pWords.filter((w) => aWords.includes(w)).length
      if (shared >= 2 && shared > bestCount) { bestCount = shared; best = val }
    }
    return best
  }

  const degreeLabel: Record<number, string> = { 1: "FIRST", 2: "SECOND", 3: "THIRD" }

  const prospects = people.map((p) => {
    const matched = findBestMatch(p.companyName ?? "")
    const startedOnMonth = p.currentPositions?.[0]?.startedOn?.month ?? null
    const highlights = p.highlights
      ?.map((h) => h.name || h.description || "")
      .filter(Boolean)
      .join(", ") || null

    return {
      campaign_id: job.campaign_id,
      account_id: matched?.id ?? null,
      first_name: p.firstName ?? "",
      last_name: p.lastName ?? "",
      full_name: p.fullName ?? `${p.firstName ?? ""} ${p.lastName ?? ""}`.trim(),
      job_title: p.jobTitle ?? p.currentPositions?.[0]?.title ?? p.headline ?? "",
      linkedin_url: p.profileUrl ?? "",
      company_name: p.companyName ?? "",
      company_domain: matched?.domain ?? "",
      is_premium: p.premium ?? false,
      connection_degree: p.connectionType ? (degreeLabel[p.connectionType] ?? String(p.connectionType)) : "",
      location: p.location ?? "",
      started_role_months: startedOnMonth,
      highlights,
    }
  })

  if (prospects.length > 0) await supabaseAdmin.from("prospects").insert(prospects)

  // Count total prospects for this campaign (includes prior partial batches)
  const { count: totalCount } = await supabaseAdmin
    .from("prospects")
    .select("*", { count: "exact", head: true })
    .eq("campaign_id", job.campaign_id)
  const finalCount = totalCount ?? prospects.length

  await supabaseAdmin
    .from("search_jobs")
    .update({ status: "completed", results_count: finalCount, completed_at: new Date().toISOString() })
    .eq("id", jobId)

  await supabaseAdmin
    .from("campaigns")
    .update({ prospects_found: finalCount })
    .eq("id", job.campaign_id)
}
