"use server"

import { revalidatePath } from "next/cache"
import { supabase, supabaseAdmin } from "@/lib/supabase"

export type AutoCampaignData = {
  id: string
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
  company_count: number
  people_count: number
}

export async function getAutoCampaignForCampaign(campaignId: string): Promise<AutoCampaignData | null> {
  const { data } = await supabaseAdmin
    .from("auto_campaigns")
    .select("id, status, current_step_detail, enrichment_offset, error_message, scheduled_at, completed_at, result_companies, result_people, result_emails_found, result_icp_distribution, result_shortlisted, result_distributed, distribution_template_name, company_count, people_count")
    .eq("campaign_id", campaignId)
    .maybeSingle()
  return data as AutoCampaignData | null
}

export async function getCompanySearchJobForCampaign(campaignId: string) {
  const { data } = await supabaseAdmin
    .from("search_jobs")
    .select("id, status, sales_nav_url, job_type")
    .eq("campaign_id", campaignId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle()
  return data
}

export async function getCampaignWithAccounts(campaignId: string) {
  const [campaignRes, accountsRes] = await Promise.all([
    supabase
      .from("campaigns")
      .select("id, week_label, rep_name, industry, status, accounts_found, prospects_found, list_id, list_name")
      .eq("id", campaignId)
      .single(),
    supabase
      .from("accounts")
      .select("id, company_name, domain, sales_nav_id, headcount_range, status, created_at")
      .eq("campaign_id", campaignId)
      .order("created_at", { ascending: false }),
  ])

  if (campaignRes.error) throw new Error(campaignRes.error.message)
  if (accountsRes.error) throw new Error(accountsRes.error.message)

  return { campaign: campaignRes.data, accounts: accountsRes.data ?? [] }
}

export async function updateAccount(
  accountId: string,
  campaignId: string,
  updates: { company_name?: string; domain?: string | null; sales_nav_id?: string | null; status?: string }
) {
  const { error } = await supabaseAdmin
    .from("accounts")
    .update(updates)
    .eq("id", accountId)

  if (error) throw new Error(error.message)
  revalidatePath(`/campaigns/${campaignId}`)
}


export async function deleteAccount(accountId: string, campaignId: string) {
  const { error } = await supabaseAdmin
    .from("accounts")
    .delete()
    .eq("id", accountId)

  if (error) throw new Error(error.message)

  // Update accounts_found count
  const { data: remaining } = await supabase
    .from("accounts")
    .select("id", { count: "exact" })
    .eq("campaign_id", campaignId)

  await supabaseAdmin
    .from("campaigns")
    .update({ accounts_found: remaining?.length ?? 0 })
    .eq("id", campaignId)

  revalidatePath(`/campaigns/${campaignId}`)
}
