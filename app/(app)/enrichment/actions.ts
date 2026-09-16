"use server"

import { revalidatePath } from "next/cache"
import { supabase, supabaseAdmin } from "@/lib/supabase"
import { enrichProspect } from "@/lib/enrichment"
import { classifyIcp } from "@/lib/icp"
import { calculateOsScore } from "@/lib/scoring"
import { findPhoneDatagma } from "@/lib/datagma"
import { findPhoneProspeo } from "@/lib/prospeo"
import { normalizeCompanyName, normalizePersonName } from "@/lib/process-search-results"

export async function getCampaigns() {
  const { data, error } = await supabase
    .from("campaigns")
    .select("id, week_label, rep_name, industry, status, prospects_found")
    .order("created_at", { ascending: false })
  if (error) throw new Error(error.message)
  return data ?? []
}

export async function getProspectsForEnrichment(campaignId: string) {
  const { data, error } = await supabase
    .from("prospects")
    .select("id, first_name, last_name, full_name, job_title, company_name, company_domain, linkedin_url, email, email_status, email_provider, icp_score, icp_category, os_score, started_role_months, phone, phone_wa, apollo_id, status, accounts(headcount_range)")
    .eq("campaign_id", campaignId)
    .order("created_at", { ascending: false })
  if (error) throw new Error(error.message)
  return data ?? []
}

export async function enrichOneProspect(prospectId: string): Promise<{
  email: string | null
  provider: string | null
  zbStatus: string | null
  icpCategory: string
  icpScore: number
  osScore: number
  apolloId: string | null
}> {
  const { data: p } = await supabase
    .from("prospects")
    .select("id, first_name, last_name, full_name, company_name, company_domain, linkedin_url, job_title, email, email_status, icp_score, accounts(linkedin_url, domain)")
    .eq("id", prospectId)
    .single()

  if (!p) throw new Error("Prospecto no encontrado")

  const osScore = calculateOsScore(p.job_title)

  // Skip if already has a valid email (unknown = ZB couldn't verify, but we trust the source)
  if (p.email && (p.email_status === "valid" || p.email_status === "catch-all" || p.email_status === "unknown")) {
    const { category, score } = classifyIcp(p.job_title ?? "")
    await supabaseAdmin.from("prospects").update({ os_score: osScore }).eq("id", prospectId)
    return { email: p.email, provider: null, zbStatus: p.email_status, icpCategory: category, icpScore: score, osScore, apolloId: null }
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const accountLinkedIn = (p as any).accounts?.linkedin_url ?? null
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const accountDomain = (p as any).accounts?.domain ?? null

  // Use account domain as fallback when prospect has no company_domain; strip protocol/www
  const cleanAccountDomain = accountDomain
    ? accountDomain.replace(/^https?:\/\/(www\.)?/, "").replace(/\/.*$/, "").toLowerCase()
    : null
  const effectiveDomain = p.company_domain || cleanAccountDomain

  const result = await enrichProspect({
    first_name: p.first_name ?? "",
    last_name: p.last_name ?? "",
    full_name: p.full_name ?? "",
    company_name: p.company_name ?? "",
    company_domain: effectiveDomain,
    linkedin_url: p.linkedin_url ?? "",
    company_linkedin_url: accountLinkedIn,
  })

  const { category, score } = classifyIcp(p.job_title ?? "")

  const updatePayload: Record<string, unknown> = {
    email: result.email ?? null,
    email_status: result.zbStatus ?? null,
    email_validated: result.enriched,
    email_provider: result.provider ?? null,
    icp_category: category,
    icp_score: score,
    os_score: osScore,
    apollo_id: result.apolloId ?? null,
    status: result.enriched ? "enriched" : "not_found",
  }
  // Backfill canonical LinkedIn URL from Apollo if we didn't already have one
  if (result.apolloLinkedInUrl && !p.linkedin_url?.includes("linkedin.com/in/")) {
    updatePayload.linkedin_url = result.apolloLinkedInUrl
  }
  // Backfill company_domain: prefer account domain, then extract from found email
  if (!p.company_domain) {
    if (cleanAccountDomain) {
      updatePayload.company_domain = cleanAccountDomain
    } else if (result.email) {
      const emailDomain = result.email.split("@")[1]
      const GENERIC = /^(gmail|hotmail|outlook|yahoo|icloud|live|proton|zoho)\./i
      if (emailDomain && !GENERIC.test(emailDomain)) {
        updatePayload.company_domain = emailDomain
      }
    }
  }

  await supabaseAdmin
    .from("prospects")
    .update(updatePayload)
    .eq("id", prospectId)

  revalidatePath("/enrichment")
  revalidatePath("/prospects")

  return {
    email: result.email,
    provider: result.provider,
    zbStatus: result.zbStatus,
    icpCategory: category,
    icpScore: score,
    osScore,
    apolloId: result.apolloId ?? null,
  }
}

export async function classifyAllIcp(campaignId: string): Promise<number> {
  const { data, error } = await supabase
    .from("prospects")
    .select("id, job_title")
    .eq("campaign_id", campaignId)
  if (error) throw new Error(error.message)
  if (!data?.length) return 0

  let updated = 0
  for (const p of data) {
    const { category, score } = classifyIcp(p.job_title ?? "")
    const osScore = calculateOsScore(p.job_title)
    await supabaseAdmin
      .from("prospects")
      .update({ icp_category: category, icp_score: score, os_score: osScore })
      .eq("id", p.id)
    updated++
  }

  revalidatePath("/enrichment")
  return updated
}

export async function addToShortlist(prospectIds: string[]): Promise<void> {
  await supabaseAdmin
    .from("prospects")
    .update({ shortlisted: true })
    .in("id", prospectIds)
  revalidatePath("/enrichment")
  revalidatePath("/shortlist")
}

export async function enrichPhoneForProspect(prospectId: string): Promise<string | null> {
  const { data: p } = await supabase
    .from("prospects")
    .select("id, first_name, last_name, company_name, company_domain, linkedin_url, email, phone, phone_wa")
    .eq("id", prospectId)
    .single()

  if (!p) throw new Error("Prospecto no encontrado")
  if (p.phone) return p.phone

  // 1. Datagma — preferred (LinkedIn URL + email)
  let phone = await findPhoneDatagma({
    linkedinUrl: p.linkedin_url,
    email: p.email,
    firstName: p.first_name ?? "",
    lastName: p.last_name ?? "",
    companyName: p.company_name,
  })

  // 2. Prospeo fallback
  if (!phone) {
    phone = await findPhoneProspeo({
      linkedinUrl: p.linkedin_url,
      email: p.email,
      firstName: p.first_name ?? "",
      lastName: p.last_name ?? "",
      companyDomain: p.company_domain,
    })
  }

  if (phone) {
    // phone = lo que encontró el enriquecimiento (solo lectura en la UI)
    // phone_wa = base editable del link de WhatsApp; se autocompleta si está vacía
    const update: Record<string, string> = { phone }
    if (!p.phone_wa) update.phone_wa = phone
    await supabaseAdmin.from("prospects").update(update).eq("id", prospectId)
  }

  return phone
}

export async function setProspectWhatsappPhone(prospectId: string, phone: string): Promise<void> {
  const trimmed = phone.trim()
  await supabaseAdmin.from("prospects").update({ phone_wa: trimmed || null }).eq("id", prospectId)
  revalidatePath("/enrichment")
}

export async function normalizeNamesForCampaign(campaignId: string): Promise<number> {
  const { data, error } = await supabase
    .from("prospects")
    .select("id, first_name, last_name, full_name, company_name")
    .eq("campaign_id", campaignId)
  if (error) throw new Error(error.message)
  if (!data?.length) return 0

  let updated = 0
  for (const p of data) {
    const patch: Record<string, string> = {}

    const firstName = normalizePersonName(p.first_name ?? "")
    if (firstName && firstName !== p.first_name) patch.first_name = firstName

    const lastName = normalizePersonName(p.last_name ?? "")
    if (lastName && lastName !== p.last_name) patch.last_name = lastName

    const fullName = normalizePersonName(p.full_name ?? "")
    if (fullName && fullName !== p.full_name) patch.full_name = fullName

    const company = normalizeCompanyName(p.company_name ?? "")
    if (company && company !== p.company_name) patch.company_name = company

    if (Object.keys(patch).length > 0) {
      await supabaseAdmin.from("prospects").update(patch).eq("id", p.id)
      updated++
    }
  }

  revalidatePath("/enrichment")
  return updated
}
