"use server"

import { revalidatePath } from "next/cache"
import { supabase, supabaseAdmin } from "@/lib/supabase"

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
    .select("*, campaigns(week_label, rep_name, industry)")
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

export async function triggerCompanySearch(
  campaignId: string,
  repName: string,
  industry: string,
  maxResults: number,
  startPageOverride?: number
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
    const hashSep = urlToOpen.includes('#') ? '&' : '#'
    const extensionUrl = `${urlToOpen}${hashSep}_mode=company_scrape&_job=${job.id}&_max=${maxResults}&_cb=${callbackUrl}`

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

export async function getExcludedPreviousCount(campaignId: string): Promise<number> {
  const { data } = await supabaseAdmin
    .from("accounts")
    .select("sales_nav_id")
    .neq("campaign_id", campaignId)
    .not("sales_nav_id", "is", null)
  return new Set((data ?? []).map((a) => a.sales_nav_id)).size
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
