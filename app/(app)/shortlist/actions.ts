"use server"

import { revalidatePath } from "next/cache"
import { supabase, supabaseAdmin } from "@/lib/supabase"
import { generateSequences, generateLinkedinOnly, generateEmailOnly, type Sequences, type LinkedinStep, type EmailStep } from "@/lib/ai-sequences"
import type { LinkedinSequenceConfig, EmailSequenceConfig } from "@/lib/sequence-configs"
import { addLeadsToSmartlead, fetchSmartleadCampaigns } from "@/lib/smartlead"
import { addLeadsToHeyReach, fetchHeyReachCampaigns } from "@/lib/heyreach"
import { enrichOneProspect, enrichPhoneForProspect } from "@/app/(app)/enrichment/actions"
import { normalizePersonName, normalizeCompanyName } from "@/lib/process-search-results"

export { fetchSmartleadCampaigns, fetchHeyReachCampaigns }

export type ShortlistedProspect = {
  id: string
  first_name: string | null
  last_name: string | null
  full_name: string | null
  job_title: string | null
  company_name: string | null
  company_domain: string | null
  linkedin_url: string | null
  email: string | null
  icp_score: number | null
  icp_category: string | null
  os_score: number | null
  highlights: string | null
  location: string | null
  phone: string | null
  apollo_id: string | null
  accounts: { industry: string | null; headcount_range: string | null } | null
  campaigns: { rep_name: string | null; week_label: string | null } | null
  shortlist_status: string | null
  next_task_date: string | null
  next_task_note: string | null
  latest_sequences: {
    id: string
    research_context: string | null
    sequences: Sequences | null
    generated_at: string | null
  } | null
}

export async function getShortlistedProspects(): Promise<ShortlistedProspect[]> {
  const { data, error } = await supabase
    .from("prospects")
    .select(`
      id, first_name, last_name, full_name, job_title, company_name,
      company_domain, linkedin_url, email, icp_score, icp_category,
      os_score, highlights, location, phone, apollo_id, shortlist_status,
      next_task_date, next_task_note,
      accounts ( industry, headcount_range ),
      campaigns ( rep_name, week_label )
    `)
    .eq("shortlisted", true)
    .order("created_at", { ascending: false })

  if (error) throw new Error(error.message)

  const prospects = (data ?? []) as unknown as ShortlistedProspect[]

  // For each prospect, fetch the latest shortlist_sequences row
  if (prospects.length === 0) return prospects

  const ids = prospects.map((p) => p.id)
  const { data: seqData } = await supabase
    .from("shortlist_sequences")
    .select("id, prospect_id, research_context, sequences, generated_at")
    .in("prospect_id", ids)
    .order("generated_at", { ascending: false })

  // Map latest sequences per prospect
  const seqMap = new Map<string, typeof seqData extends (infer T)[] | null ? T : never>()
  for (const seq of seqData ?? []) {
    if (!seqMap.has(seq.prospect_id)) seqMap.set(seq.prospect_id, seq)
  }

  return prospects
    .map((p) => ({
      ...p,
      latest_sequences: (seqMap.get(p.id) ?? null) as ShortlistedProspect["latest_sequences"],
    }))
    .sort((a, b) => {
      const indA = (a.accounts as { industry?: string | null } | null)?.industry ?? ""
      const indB = (b.accounts as { industry?: string | null } | null)?.industry ?? ""
      return indA.localeCompare(indB, "es", { sensitivity: "base" })
    })
}

export async function removeFromShortlist(prospectId: string): Promise<void> {
  await supabaseAdmin
    .from("prospects")
    .update({ shortlisted: false })
    .eq("id", prospectId)
  revalidatePath("/shortlist")
}

export async function saveProspectTask(
  prospectId: string,
  taskDate: string | null,
  taskNote: string | null
): Promise<void> {
  await supabaseAdmin
    .from("prospects")
    .update({ next_task_date: taskDate || null, next_task_note: taskNote || null })
    .eq("id", prospectId)
  revalidatePath("/shortlist")
}

export async function generateAndSaveSequences(
  prospectId: string,
  emailContext: string,
  linkedinContext: string,
  liConfig?: LinkedinSequenceConfig,
  emailConfig?: EmailSequenceConfig
): Promise<{ sequences: Sequences } | { error: string }> {
  try {
    const sequences = await generateSequences(prospectId, emailContext, linkedinContext, liConfig, emailConfig)
    revalidatePath("/shortlist")
    return { sequences }
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Error generando secuencias" }
  }
}

export async function saveEditedSequences(prospectId: string, sequences: Sequences): Promise<void> {
  // Update the most recent shortlist_sequences row for this prospect
  const { data } = await supabaseAdmin
    .from("shortlist_sequences")
    .select("id")
    .eq("prospect_id", prospectId)
    .order("generated_at", { ascending: false })
    .limit(1)
    .single()
  if (data?.id) {
    await supabaseAdmin
      .from("shortlist_sequences")
      .update({ sequences })
      .eq("id", data.id)
  }
  revalidatePath("/shortlist")
}

export async function regenerateEmailOnly(
  prospectId: string,
  emailContext: string,
  emailConfig?: EmailSequenceConfig
): Promise<{ email: EmailStep[] } | { error: string }> {
  try {
    const email = await generateEmailOnly(prospectId, emailContext, emailConfig)

    const { data: existing } = await supabaseAdmin
      .from("shortlist_sequences")
      .select("id, sequences")
      .eq("prospect_id", prospectId)
      .order("generated_at", { ascending: false })
      .limit(1)
      .single()

    if (existing?.id) {
      const current = (existing.sequences ?? {}) as Sequences
      await supabaseAdmin
        .from("shortlist_sequences")
        .update({ sequences: { ...current, email } })
        .eq("id", existing.id)
    } else {
      await supabaseAdmin.from("shortlist_sequences").insert({
        prospect_id: prospectId,
        sequences: { email, linkedin: [] },
        model_used: "claude-sonnet-4-6",
        generated_at: new Date().toISOString(),
      })
    }

    revalidatePath("/shortlist")
    return { email }
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Error regenerando email" }
  }
}

export async function regenerateLinkedinOnly(
  prospectId: string,
  linkedinContext: string,
  liConfig?: LinkedinSequenceConfig
): Promise<{ linkedin: LinkedinStep[] } | { error: string }> {
  try {
    const linkedin = await generateLinkedinOnly(prospectId, linkedinContext, liConfig)

    // Merge into latest shortlist_sequences row (preserve email steps)
    const { data: existing } = await supabaseAdmin
      .from("shortlist_sequences")
      .select("id, sequences")
      .eq("prospect_id", prospectId)
      .order("generated_at", { ascending: false })
      .limit(1)
      .single()

    if (existing?.id) {
      const currentSequences = (existing.sequences ?? {}) as Sequences
      await supabaseAdmin
        .from("shortlist_sequences")
        .update({ sequences: { ...currentSequences, linkedin } })
        .eq("id", existing.id)
    } else {
      // No row yet — create one with empty emails
      await supabaseAdmin.from("shortlist_sequences").insert({
        prospect_id: prospectId,
        sequences: { email: [], linkedin },
        model_used: "claude-sonnet-4-6",
        generated_at: new Date().toISOString(),
      })
    }

    revalidatePath("/shortlist")
    return { linkedin }
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Error regenerando LinkedIn" }
  }
}

// ── Enrichment shortcuts (reuse enrichment module logic) ─────────────────────

export async function enrichEmailForShortlist(
  prospectId: string
): Promise<{ email: string | null; provider: string | null; zbStatus: string | null }> {
  const result = await enrichOneProspect(prospectId)
  revalidatePath("/shortlist")
  return { email: result.email, provider: result.provider, zbStatus: result.zbStatus }
}

export async function enrichPhoneForShortlist(
  prospectId: string
): Promise<string | null> {
  const phone = await enrichPhoneForProspect(prospectId)
  revalidatePath("/shortlist")
  return phone
}

export async function normalizeNameForShortlist(
  prospectId: string
): Promise<{ first_name: string; last_name: string; full_name: string } | null> {
  const { data: p } = await supabaseAdmin
    .from("prospects")
    .select("id, first_name, last_name, full_name, company_name")
    .eq("id", prospectId)
    .single()
  if (!p) return null

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
    await supabaseAdmin.from("prospects").update(patch).eq("id", prospectId)
  }
  revalidatePath("/shortlist")
  return {
    first_name: (patch.first_name ?? p.first_name) || "",
    last_name: (patch.last_name ?? p.last_name) || "",
    full_name: (patch.full_name ?? p.full_name) || "",
  }
}

export async function pushToSmartlead(
  prospectId: string,
  campaignId: string
): Promise<{ ok: boolean; error?: string }> {
  const [{ data: prospect }, { data: seq }] = await Promise.all([
    supabaseAdmin
      .from("prospects")
      .select("first_name, last_name, full_name, email, company_name, linkedin_url")
      .eq("id", prospectId)
      .single(),
    supabaseAdmin
      .from("shortlist_sequences")
      .select("sequences")
      .eq("prospect_id", prospectId)
      .order("generated_at", { ascending: false })
      .limit(1)
      .single(),
  ])

  if (!prospect?.email) return { ok: false, error: "El prospecto no tiene email guardado" }

  const emailSteps = (seq?.sequences as Sequences | null)?.email ?? []
  const custom_fields: Record<string, string> = {}
  emailSteps.slice(0, 4).forEach((step, i) => {
    custom_fields[`Mail${i + 1}`] = step.body
  })

  const nameParts = (prospect.full_name ?? "").split(" ")
  const result = await addLeadsToSmartlead(campaignId, [{
    email: prospect.email,
    first_name: prospect.first_name ?? nameParts[0] ?? undefined,
    last_name: prospect.last_name ?? (nameParts.slice(1).join(" ") || undefined),
    company_name: prospect.company_name ?? undefined,
    linkedin_profile: prospect.linkedin_url ?? undefined,
    custom_fields,
  }])

  if (result.error) return { ok: false, error: result.error }
  if (result.success === 0) return { ok: false, error: "Smartlead no aceptó el lead (¿ya existe en la campaña?)" }

  // Mark as sent
  await supabaseAdmin.from("prospects").update({ shortlist_status: "Enviado" }).eq("id", prospectId)
  revalidatePath("/shortlist")
  return { ok: true }
}

export async function pushToHeyReach(
  prospectId: string,
  campaignId: string,
  linkedInAccountId?: number
): Promise<{ ok: boolean; error?: string }> {
  const [{ data: prospect }, { data: seq }] = await Promise.all([
    supabaseAdmin
      .from("prospects")
      .select("first_name, last_name, full_name, email, company_name, job_title, location, linkedin_url")
      .eq("id", prospectId)
      .single(),
    supabaseAdmin
      .from("shortlist_sequences")
      .select("sequences")
      .eq("prospect_id", prospectId)
      .order("generated_at", { ascending: false })
      .limit(1)
      .single(),
  ])

  if (!prospect?.linkedin_url) return { ok: false, error: "El prospecto no tiene LinkedIn URL" }

  const linkedinSteps = (seq?.sequences as Sequences | null)?.linkedin ?? []
  const customUserFields = linkedinSteps.slice(0, 5).map((step, i) => ({
    name: `Li${i + 1}`,
    value: step.message,
  }))

  const nameParts = (prospect.full_name ?? "").split(" ")
  const lead = {
    linkedInProfileUrl: prospect.linkedin_url,
    firstName: prospect.first_name ?? nameParts[0] ?? undefined,
    lastName: prospect.last_name ?? (nameParts.slice(1).join(" ") || undefined),
    companyName: prospect.company_name ?? undefined,
    position: prospect.job_title ?? undefined,
    location: prospect.location ?? undefined,
    emailAddress: prospect.email ?? undefined,
    customUserFields,
  }

  const result = linkedInAccountId
    ? await addLeadsToHeyReach(campaignId, linkedInAccountId, [lead])
    : await addLeadsToHeyReach(campaignId, [lead])

  if (result.error) return { ok: false, error: result.error }
  if (result.success === 0) return { ok: false, error: "HeyReach no aceptó el lead (¿ya existe en la campaña?)" }

  await supabaseAdmin.from("prospects").update({ shortlist_status: "Enviado" }).eq("id", prospectId)
  revalidatePath("/shortlist")
  return { ok: true }
}

export async function assignIndustryToCompany(companyName: string, industry: string): Promise<void> {
  await supabaseAdmin
    .from("accounts")
    .update({ industry })
    .ilike("company_name", companyName)
  revalidatePath("/shortlist")
}

export async function updateShortlistStatus(prospectId: string, status: string): Promise<void> {
  await supabaseAdmin
    .from("prospects")
    .update({ shortlist_status: status })
    .eq("id", prospectId)
  revalidatePath("/shortlist")
}

export async function addToShortlist(prospectIds: string[]): Promise<void> {
  await supabaseAdmin
    .from("prospects")
    .update({ shortlisted: true })
    .in("id", prospectIds)
  revalidatePath("/shortlist")
  revalidatePath("/enrichment")
}

export type ManualProspectInput = {
  full_name: string
  job_title?: string
  company_name?: string
  company_domain?: string
  industry?: string
  email?: string
  linkedin_url?: string
  phone?: string
  location?: string
  notes?: string
}

export async function addManualProspect(input: ManualProspectInput): Promise<{ id: string } | { error: string }> {
  const parts = input.full_name.trim().split(/\s+/)
  const first_name = parts[0] ?? ""
  const last_name = parts.slice(1).join(" ") || ""

  // Si hay empresa o industria, crear un account y linkear el prospecto
  let accountId: string | null = null
  if (input.company_name || input.industry) {
    const { data: account } = await supabaseAdmin
      .from("accounts")
      .insert({
        company_name: input.company_name || "Manual",
        domain: input.company_domain || null,
        industry: input.industry || null,
      })
      .select("id")
      .single()
    accountId = account?.id ?? null
  }

  const { data, error } = await supabaseAdmin
    .from("prospects")
    .insert({
      full_name: input.full_name.trim(),
      first_name,
      last_name,
      job_title: input.job_title || null,
      company_name: input.company_name || null,
      company_domain: input.company_domain || null,
      account_id: accountId,
      email: input.email || null,
      linkedin_url: input.linkedin_url || null,
      phone: input.phone || null,
      location: input.location || null,
      highlights: input.notes || null,
      shortlisted: true,
      shortlist_status: "Pendiente",
    })
    .select("id")
    .single()

  if (error) return { error: error.message }
  revalidatePath("/shortlist")
  return { id: data.id }
}

// ── Message templates ─────────────────────────────────────────────────────────

export type MessageTemplate = {
  id: string
  name: string
  channel: "linkedin" | "email" | "whatsapp"
  content: string
  industry: string | null
  created_at: string
}

export async function getMessageTemplates(channel: "linkedin" | "email" | "whatsapp"): Promise<MessageTemplate[]> {
  const { data } = await supabaseAdmin
    .from("message_templates")
    .select("*")
    .eq("channel", channel)
    .order("name", { ascending: true })
  return (data ?? []) as MessageTemplate[]
}

export async function saveMessageTemplate(
  name: string,
  channel: "linkedin" | "email" | "whatsapp",
  content: string,
  industry?: string | null
): Promise<{ id: string } | { error: string }> {
  const { data, error } = await supabaseAdmin
    .from("message_templates")
    .insert({ name, channel, content, industry: industry ?? null })
    .select("id")
    .single()
  if (error) return { error: error.message }
  return { id: data.id }
}

export async function deleteMessageTemplate(id: string): Promise<void> {
  await supabaseAdmin.from("message_templates").delete().eq("id", id)
}

export async function updateMessageTemplate(id: string, content: string): Promise<void> {
  await supabaseAdmin.from("message_templates").update({ content }).eq("id", id)
}
