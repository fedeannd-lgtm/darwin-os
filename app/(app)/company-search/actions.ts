"use server"

import { revalidatePath } from "next/cache"
import { supabase, supabaseAdmin } from "@/lib/supabase"
import { addExclusionListsToUrl } from "@/lib/sales-nav-lists"

const APP_URL = process.env.NEXT_PUBLIC_APP_URL
  || (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : "http://localhost:3000")

export async function getCampaigns() {
  const { data, error } = await supabase
    .from("campaigns")
    .select("id, week_label, rep_name, industry, status")
    .order("created_at", { ascending: false })
  if (error) throw new Error(error.message)
  return data
}

export async function getCompanySearchJobs() {
  const { data, error } = await supabase
    .from("search_jobs")
    .select("*, campaigns(week_label, rep_name, industry, list_id, list_name)")
    .eq("job_type", "company_search")
    .order("created_at", { ascending: false })
    .limit(20)
  if (error) throw new Error(error.message)
  return data
}

export async function getSearchConfig(repName: string, industry: string) {
  const { data: savedUrl } = await supabase
    .from("saved_urls")
    .select("id, url, current_page")
    .eq("rep_name", repName)
    .eq("industry", industry)
    .eq("url_type", "company_search")
    .order("created_at", { ascending: false })
    .maybeSingle()

  if (!savedUrl) return null
  return { base_url: savedUrl.url, current_page: (savedUrl.current_page as number) ?? 1 }
}

/** Returns ISO cutoff date for a range string, or null for "all" */
function getCutoffDate(range: string): string | null {
  const daysMap: Record<string, number> = {
    week: 7, month: 30, "3months": 90, "6months": 180, year: 365,
  }
  const days = daysMap[range]
  if (!days) return null
  return new Date(Date.now() - days * 86400000).toISOString()
}

export async function triggerCompanySearch(
  campaignId: string,
  repName: string,
  industry: string,
  maxResults: number,
  startPageOverride?: number,
  excludeRange?: string
): Promise<{ jobId: string; extensionUrl: string } | { error: string }> {
  try {
    const config = await getSearchConfig(repName, industry)
    if (!config) return { error: "No hay URL configurada para este rep+industria. Configurala en Settings." }

    const startPage = startPageOverride ?? config.current_page

    const { data: job, error } = await supabase
      .from("search_jobs")
      .insert({
        campaign_id: campaignId,
        job_type: "company_search",
        sales_nav_url: config.base_url,
        status: "pending",
        max_results: maxResults,
        start_page: startPage,
      })
      .select()
      .single()

    if (error) return { error: error.message }

    const callbackUrl = encodeURIComponent(`${APP_URL}/api/extension/results`)
    let urlToOpen = config.base_url
    if (startPage > 1) {
      const pageSep = urlToOpen.includes('#') ? '&' : '#'
      urlToOpen += `${pageSep}page=${startPage}`
    }

    // Embed previous campaign lists as EXCLUDED filters in the Sales Nav URL
    const { data: cfg } = await supabaseAdmin
      .from("inbox_config").select("exclude_previous").eq("id", 1).single()
    if (cfg?.exclude_previous) {
      let prevQuery = supabaseAdmin
        .from("campaigns")
        .select("list_id, list_name, week_label")
        .eq("industry", industry)
        .eq("rep_name", repName)
        .not("list_id", "is", null)
      const cutoff = getCutoffDate(excludeRange ?? "all")
      if (cutoff) prevQuery = prevQuery.gte("created_at", cutoff)
      const { data: prevCampaigns } = await prevQuery
      if (prevCampaigns?.length) {
        const lists = prevCampaigns.map((c: { list_id: string | null; list_name: string | null; week_label: string }) => ({
          id: c.list_id!,
          name: c.list_name ?? c.week_label ?? c.list_id!,
        }))
        urlToOpen = addExclusionListsToUrl(urlToOpen, lists)
      }
    }

    const hashSep = urlToOpen.includes('#') ? '&' : '#'
    const extensionUrl = `${urlToOpen}${hashSep}_mode=company_scrape&_job=${job.id}&_campaign=${campaignId}&_max=${maxResults}&_cb=${callbackUrl}`

    revalidatePath("/company-search")
    return { jobId: job.id, extensionUrl }
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Error al iniciar la búsqueda" }
  }
}

export async function advanceSearchPage(
  repName: string,
  industry: string,
  resultsCount: number,
  startPage: number = 1
) {
  const pagesConsumed = Math.max(1, Math.ceil(resultsCount / 25))
  const nextPage = startPage + pagesConsumed
  const { data: savedUrl } = await supabaseAdmin
    .from("saved_urls")
    .select("id")
    .eq("rep_name", repName)
    .eq("industry", industry)
    .eq("url_type", "company_search")
    .order("created_at", { ascending: false })
    .maybeSingle()
  if (!savedUrl) return
  await supabaseAdmin
    .from("saved_urls")
    .update({ current_page: nextPage })
    .eq("id", savedUrl.id)
}

export async function deleteSearchJobs(ids: string[]): Promise<void> {
  if (!ids.length) return
  const { error } = await supabaseAdmin.from("search_jobs").delete().in("id", ids)
  if (error) throw new Error(error.message)
  revalidatePath("/company-search")
}

export async function getExcludedPreviousCount(campaignId: string, excludeRange = "all"): Promise<number> {
  const { data: campaign } = await supabaseAdmin
    .from("campaigns").select("industry, rep_name").eq("id", campaignId).single()
  if (!campaign?.industry || !campaign?.rep_name) return 0

  let query = supabaseAdmin
    .from("campaigns")
    .select("list_id")
    .eq("industry", campaign.industry)
    .eq("rep_name", campaign.rep_name)
    .not("list_id", "is", null)
  const cutoff = getCutoffDate(excludeRange)
  if (cutoff) query = query.gte("created_at", cutoff)
  const { data } = await query
  if (!data) return 0
  return new Set(data.map((c) => c.list_id)).size
}

export async function getPreviewUrl(
  repName: string,
  industry: string,
  startPage: number,
  excludePrevious: boolean,
  excludeRange = "all"
): Promise<string | null> {
  const config = await getSearchConfig(repName, industry)
  if (!config) return null

  let urlToOpen = config.base_url
  if (startPage > 1) {
    const pageSep = urlToOpen.includes("#") ? "&" : "#"
    urlToOpen += `${pageSep}page=${startPage}`
  }

  if (excludePrevious) {
    let prevQuery = supabaseAdmin
      .from("campaigns")
      .select("list_id, list_name, week_label")
      .eq("industry", industry)
      .eq("rep_name", repName)
      .not("list_id", "is", null)
    const cutoff = getCutoffDate(excludeRange)
    if (cutoff) prevQuery = prevQuery.gte("created_at", cutoff)
    const { data: prevCampaigns } = await prevQuery
    if (prevCampaigns?.length) {
      const lists = prevCampaigns.map((c: { list_id: string | null; list_name: string | null; week_label: string }) => ({
        id: c.list_id!,
        name: c.list_name ?? c.week_label ?? c.list_id!,
      }))
      urlToOpen = addExclusionListsToUrl(urlToOpen, lists)
    }
  }

  return urlToOpen
}

export async function getJobStatus(jobId: string) {
  const { data, error } = await supabase
    .from("search_jobs")
    .select("status, results_count, estimated_ready_at")
    .eq("id", jobId)
    .single()
  if (error) return null
  return data
}
