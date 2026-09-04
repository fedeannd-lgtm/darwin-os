"use server"

import { revalidatePath } from "next/cache"
import { supabase, supabaseAdmin } from "@/lib/supabase"

export type IcpStat = {
  week_label: string
  industry: string
  score10: number
  score5: number
  score0: number
}

export async function getIcpStats(): Promise<IcpStat[]> {
  const { data, error } = await supabase
    .from("prospects")
    .select("icp_score, campaigns!inner(week_label, industry)")
  if (error) throw new Error(error.message)

  const map = new Map<string, IcpStat>()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ;(data ?? []).forEach((p: any) => {
    const raw = p.campaigns
    const camp: { week_label: string; industry: string } = Array.isArray(raw) ? raw[0] : raw
    if (!camp) return
    const key = `${camp.week_label}||${camp.industry}`
    if (!map.has(key)) map.set(key, { week_label: camp.week_label, industry: camp.industry, score10: 0, score5: 0, score0: 0 })
    const entry = map.get(key)!
    if (p.icp_score === 10) entry.score10++
    else if (p.icp_score === 5) entry.score5++
    else entry.score0++
  })
  return Array.from(map.values())
}

export type IcpCategoryStat = {
  week_label: string
  industry: string
  category: string
  count: number
}

export async function getIcpCategoryStats(): Promise<IcpCategoryStat[]> {
  const { data, error } = await supabase
    .from("prospects")
    .select("icp_category, campaigns!inner(week_label, industry)")
  if (error) throw new Error(error.message)

  const map = new Map<string, IcpCategoryStat>()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ;(data ?? []).forEach((p: any) => {
    const raw = p.campaigns
    const camp: { week_label: string; industry: string } = Array.isArray(raw) ? raw[0] : raw
    if (!camp) return
    const category = p.icp_category || "Generic"
    const key = `${camp.week_label}||${camp.industry}||${category}`
    if (!map.has(key)) map.set(key, { week_label: camp.week_label, industry: camp.industry, category, count: 0 })
    map.get(key)!.count++
  })
  return Array.from(map.values())
}

export async function getCampaigns() {
  const { data, error } = await supabase
    .from("campaigns")
    .select("*, accounts(count), prospects(count), sent:prospects(count).not.is.null(sent_at)")
    .order("created_at", { ascending: false })
  if (error) throw new Error(error.message)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (data ?? []).map((c: any) => {
    const accountsFound = c.accounts?.[0]?.count ?? c.accounts_found ?? 0
    const prospectsFound = c.prospects?.[0]?.count ?? c.prospects_found ?? 0
    const sentCount = c.sent?.[0]?.count ?? 0

    // Derive status from real data when the stored value is stale ('pending' but there's activity)
    let status = c.status as string
    if (status === "pending" || status === "searching") {
      if (sentCount > 0) status = "done"
      else if (prospectsFound > 0) status = "enriching"
      else if (accountsFound > 0) status = "searching"
      else status = "pending"
    }

    return {
      ...c,
      status,
      accounts_found: accountsFound,
      prospects_found: prospectsFound,
    }
  })
}

export async function createCampaign(form: {
  week_label: string
  rep_name: string
  industry: string
  notes: string
}) {
  const { error } = await supabase.from("campaigns").insert(form)
  if (error) throw new Error(error.message)
  revalidatePath("/dashboard")
}

export async function updateCampaign(
  id: string,
  form: { week_label: string; rep_name: string; industry: string; notes: string }
) {
  const { error } = await supabase.from("campaigns").update(form).eq("id", id)
  if (error) throw new Error(error.message)
  revalidatePath("/dashboard")
}

export async function getCampaignIndustries(): Promise<string[]> {
  const { data } = await supabase.from("campaigns").select("industry")
  if (!data) return []
  return [...new Set(data.map((r) => r.industry as string).filter(Boolean))].sort()
}

export async function deleteCampaign(id: string) {
  const { error } = await supabase.from("campaigns").delete().eq("id", id)
  if (error) throw new Error(error.message)
  revalidatePath("/dashboard")
}

// ─── Auto Campaign ────────────────────────────────────────────────────────────

export type AutoCampaignConfig = {
  company_search_url: string
  company_count: number
  exclude_previous: boolean
  exclusion_date_from: string | null
  exclusion_date_to: string | null
  start_page: number
  people_search_url: string
  people_count: number
  enrich_emails: boolean
  enrich_phones: boolean
  classify_icp: boolean
  normalize_names: boolean
  shortlist_icp_min: number | null
  shortlist_title_keywords: string | null
  distribution_template_id: string | null
  distribution_template_name: string | null
  scheduled_at: string
}

export type AutoCampaign = {
  id: string
  campaign_id: string
  status: string
  current_step_detail: string | null
  enrichment_offset: number
  error_message: string | null
  scheduled_at: string
  completed_at: string | null
  result_companies: number | null
  result_people: number | null
  result_emails_found: number | null
  result_icp_distribution: Record<string, number> | null
  result_shortlisted: number | null
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  result_distributed: any | null
  distribution_template_name: string | null
  people_count: number
  company_count: number
}

export async function createAutoCampaign(
  campaignData: { week_label: string; rep_name: string; industry: string; notes: string },
  autoConfig: AutoCampaignConfig
) {
  // Create campaign first
  const { data: campaign, error: campErr } = await supabaseAdmin
    .from("campaigns")
    .insert(campaignData)
    .select("id")
    .single()

  if (campErr || !campaign) throw new Error(campErr?.message ?? "Error al crear campaña")

  // Create auto_campaign config linked to it
  const { error: autoErr } = await supabaseAdmin.from("auto_campaigns").insert({
    campaign_id: campaign.id,
    ...autoConfig,
  })

  if (autoErr) {
    // Rollback campaign creation
    await supabaseAdmin.from("campaigns").delete().eq("id", campaign.id)
    throw new Error(autoErr.message)
  }

  // Advance immediately so the company_search job is created before the page reloads
  const { advanceAutoCampaigns } = await import("@/lib/auto-campaign-engine")
  await advanceAutoCampaigns().catch((err) =>
    console.error("[createAutoCampaign] Error advancing:", err)
  )

  revalidatePath("/dashboard")
  return campaign.id
}

export async function getAutoCampaignForCampaign(campaignId: string): Promise<AutoCampaign | null> {
  const { data } = await supabaseAdmin
    .from("auto_campaigns")
    .select("*")
    .eq("campaign_id", campaignId)
    .maybeSingle()
  return data as AutoCampaign | null
}

// Returns a map of campaign_id → { autoStatus, jobUrl } for campaigns that need action
export async function getAutoActionMap(): Promise<Record<string, { autoStatus: string; jobUrl: string | null }>> {
  const { data: autos } = await supabaseAdmin
    .from("auto_campaigns")
    .select("campaign_id, status")
    .in("status", ["company_search", "creating_list", "people_search", "enriching", "distributing", "pending", "done", "error"])

  if (!autos?.length) return {}

  // For search-job actions, fetch the URL from search_jobs
  const jobActionNeeded = autos.filter((a) => a.status === "company_search" || a.status === "people_search")
  const jobActionIds = jobActionNeeded.map((a) => a.campaign_id)

  let jobUrlMap: Record<string, string> = {}
  if (jobActionIds.length) {
    const { data: jobs } = await supabaseAdmin
      .from("search_jobs")
      .select("campaign_id, sales_nav_url")
      .in("campaign_id", jobActionIds)
      .order("created_at", { ascending: false })

    for (const job of jobs ?? []) {
      if (!jobUrlMap[job.campaign_id] && job.sales_nav_url) {
        jobUrlMap[job.campaign_id] = job.sales_nav_url
      }
    }
  }

  const appUrl = process.env.APP_BASE_URL
    || (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : "http://localhost:3000")

  const result: Record<string, { autoStatus: string; jobUrl: string | null }> = {}
  for (const a of autos) {
    let jobUrl: string | null = jobUrlMap[a.campaign_id] ?? null

    // For creating_list, generate the extension URL dynamically (no search_job)
    if (a.status === "creating_list") {
      jobUrl = `https://www.linkedin.com/sales/home#_mode=create_account_list&_campaign=${a.campaign_id}&_app=${encodeURIComponent(appUrl)}`
    }

    result[a.campaign_id] = { autoStatus: a.status, jobUrl }
  }
  return result
}

export async function getSavedUrlsForWizard(repName: string, industry: string) {
  const { data } = await supabase
    .from("saved_urls")
    .select("id, url, label, url_type")
    .eq("rep_name", repName)
    .eq("industry", industry)
    .in("url_type", ["company_search", "people_search"])
    .order("created_at", { ascending: false })

  return data ?? []
}

export async function getDistributionTemplatesForWizard() {
  const { data } = await supabase
    .from("distribution_templates")
    .select("id, name, industry")
    .order("name", { ascending: true })
  return data ?? []
}

// ─── Weekly stats ─────────────────────────────────────────────────────────────

export async function getWeekStats(campaignIds: string[]): Promise<{
  validEmails: number
  scoreGte5: number
  sent: number
}> {
  if (!campaignIds.length) return { validEmails: 0, scoreGte5: 0, sent: 0 }

  const [{ count: validEmails }, { count: scoreGte5 }, { count: sent }] = await Promise.all([
    supabase.from("prospects").select("id", { count: "exact", head: true })
      .in("campaign_id", campaignIds).not("email", "is", null).neq("email", ""),
    supabase.from("prospects").select("id", { count: "exact", head: true })
      .in("campaign_id", campaignIds).gte("icp_score", 5),
    supabase.from("prospects").select("id", { count: "exact", head: true })
      .in("campaign_id", campaignIds).not("sent_at", "is", null),
  ])

  return {
    validEmails: validEmails ?? 0,
    scoreGte5: scoreGte5 ?? 0,
    sent: sent ?? 0,
  }
}
