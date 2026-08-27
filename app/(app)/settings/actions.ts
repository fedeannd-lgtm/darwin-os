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

export async function getCampaignIndustries(): Promise<string[]> {
  const { data } = await supabase
    .from("campaigns")
    .select("industry")
  if (!data) return []
  const unique = [...new Set(data.map((r) => r.industry as string).filter(Boolean))]
  return unique.sort()
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
