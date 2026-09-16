"use server"

import { revalidatePath } from "next/cache"
import { supabase, supabaseAdmin } from "@/lib/supabase"
import { addLeadsToSmartlead, fetchSmartleadCampaigns } from "@/lib/smartlead"
import { addLeadsToHeyReach, fetchHeyReachCampaigns } from "@/lib/heyreach"

// ─── Types ────────────────────────────────────────────────────────────────────

export type Condition = {
  field: string
  operator: string
  value: string
}

// Conditions within a group are AND; groups themselves are OR-ed together
export type ConditionGroup = Condition[]

export type DistributionRoute = {
  id: string
  name: string | null
  priority: number
  conditions: ConditionGroup[]
  smartlead_campaign_id: string | null
  heyreach_campaign_id: string | null
}

export type DistributionTemplate = {
  id: string
  created_at: string
  name: string
  industry: string | null
  notes: string | null
  shortlist_filter: "all" | "only" | "exclude"
  routes: DistributionRoute[]
}

export type DistributionRun = {
  id: string
  created_at: string
  template_id: string | null
  template_name: string
  source_campaign_id: string | null
  source_campaign_label: string | null
  include_previously_sent: boolean
  status: string
  results: RunResults | null
  error: string | null
}

export type RunResults = {
  total: number
  sent: number
  skipped: number
  routes: Array<{
    route_id: string
    name: string
    matched: number
    smartlead: number
    heyreach: number
    errors: string[]
  }>
}

// ─── Templates CRUD ───────────────────────────────────────────────────────────

export async function getTemplates(): Promise<DistributionTemplate[]> {
  const { data: templates, error } = await supabase
    .from("distribution_templates")
    .select("*")
    .order("created_at", { ascending: false })
  if (error) throw new Error(error.message)

  const { data: routes } = await supabase
    .from("distribution_routes")
    .select("*")
    .order("priority", { ascending: true })

  return (templates ?? []).map((t) => ({
    ...t,
    routes: (routes ?? [])
      .filter((r) => r.template_id === t.id)
      .map((r) => ({ ...r, conditions: normalizeConditions(r.conditions) })),
  }))
}

export async function saveTemplate(template: {
  id?: string
  name: string
  shortlist_filter?: "all" | "only" | "exclude"
  industry: string | null
  notes: string | null
  routes: Omit<DistributionRoute, "id">[]
}): Promise<string> {
  if (template.id) {
    // Update existing
    await supabaseAdmin
      .from("distribution_templates")
      .update({ name: template.name, industry: template.industry, notes: template.notes, shortlist_filter: template.shortlist_filter ?? "all" })
      .eq("id", template.id)

    // Replace all routes
    await supabaseAdmin.from("distribution_routes").delete().eq("template_id", template.id)
    if (template.routes.length > 0) {
      await supabaseAdmin.from("distribution_routes").insert(
        template.routes.map((r, i) => ({ ...r, template_id: template.id, priority: i }))
      )
    }
    revalidatePath("/distribution")
    return template.id
  } else {
    // Create new
    const { data, error } = await supabaseAdmin
      .from("distribution_templates")
      .insert({ name: template.name, industry: template.industry, notes: template.notes, shortlist_filter: template.shortlist_filter ?? "all" })
      .select("id")
      .single()
    if (error || !data) throw new Error(error?.message ?? "Error al crear plantilla")

    if (template.routes.length > 0) {
      await supabaseAdmin.from("distribution_routes").insert(
        template.routes.map((r, i) => ({ ...r, template_id: data.id, priority: i }))
      )
    }
    revalidatePath("/distribution")
    return data.id
  }
}

export async function cloneTemplate(templateId: string): Promise<string> {
  const { data: t } = await supabaseAdmin
    .from("distribution_templates")
    .select("*")
    .eq("id", templateId)
    .single()
  if (!t) throw new Error("Plantilla no encontrada")

  const { data: newT, error } = await supabaseAdmin
    .from("distribution_templates")
    .insert({ name: `${t.name} (copia)`, industry: t.industry, notes: t.notes, shortlist_filter: t.shortlist_filter ?? "all" })
    .select("id")
    .single()
  if (error || !newT) throw new Error(error?.message ?? "Error al clonar")

  const { data: routes } = await supabaseAdmin
    .from("distribution_routes")
    .select("*")
    .eq("template_id", templateId)
    .order("priority", { ascending: true })

  if (routes?.length) {
    await supabaseAdmin.from("distribution_routes").insert(
      routes.map((r) => ({
        template_id: newT.id,
        name: r.name,
        priority: r.priority,
        conditions: r.conditions,
        smartlead_campaign_id: r.smartlead_campaign_id,
        heyreach_campaign_id: r.heyreach_campaign_id,
      }))
    )
  }

  revalidatePath("/distribution")
  return newT.id
}

export async function deleteTemplate(templateId: string): Promise<void> {
  await supabaseAdmin.from("distribution_templates").delete().eq("id", templateId)
  revalidatePath("/distribution")
}

// ─── Run history ──────────────────────────────────────────────────────────────

export async function getRunsForTemplate(templateId: string): Promise<DistributionRun[]> {
  const { data } = await supabase
    .from("distribution_runs")
    .select("*, campaigns(week_label, rep_name, industry)")
    .eq("template_id", templateId)
    .order("created_at", { ascending: false })
    .limit(20)

  return (data ?? []).map((r) => ({
    ...r,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    source_campaign_label: (r as any).campaigns
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ? `${(r as any).campaigns.week_label} · ${(r as any).campaigns.rep_name} · ${(r as any).campaigns.industry}`
      : null,
  }))
}

// ─── Backward compat: old routes stored conditions as Condition[] (flat AND).
//     New format is ConditionGroup[] (array of arrays). Detect and wrap.
function normalizeConditions(raw: unknown): ConditionGroup[] {
  if (!Array.isArray(raw) || raw.length === 0) return []
  if (raw[0] && typeof raw[0] === "object" && !Array.isArray(raw[0]) && "field" in raw[0]) {
    return [raw as Condition[]]
  }
  return raw as ConditionGroup[]
}

// ─── Condition evaluator ──────────────────────────────────────────────────────

type ProspectForDistribution = {
  id: string
  first_name: string
  last_name: string
  full_name: string
  email: string | null
  email_status: string | null
  icp_score: number
  icp_category: string | null
  os_score: number | null
  is_premium: boolean
  connection_degree: string
  linkedin_url: string
  company_name: string
  started_role_months: number | null
  sent_at: string | null
  shortlisted: boolean
}

function evaluateCondition(prospect: ProspectForDistribution, cond: Condition): boolean {
  const { field, operator, value } = cond

  if (field === "has_email") {
    const has = prospect.email !== null && prospect.email !== ""
    return value === "true" ? has : !has
  }
  if (field === "email_status") {
    return operator === "eq"
      ? prospect.email_status === value
      : operator === "neq"
      ? prospect.email_status !== value
      : false
  }
  if (field === "icp_score") {
    const score = prospect.icp_score ?? 0
    const v = parseInt(value, 10)
    if (operator === "gte") return score >= v
    if (operator === "lte") return score <= v
    if (operator === "eq") return score === v
  }
  if (field === "os_score") {
    const score = prospect.os_score ?? 0
    const v = parseInt(value, 10)
    if (operator === "gte") return score >= v
    if (operator === "lte") return score <= v
    if (operator === "eq") return score === v
  }
  if (field === "icp_category") {
    return prospect.icp_category === value
  }
  if (field === "is_premium") {
    return value === "true" ? prospect.is_premium : !prospect.is_premium
  }
  if (field === "connection_degree") {
    return prospect.connection_degree === value
  }
  if (field === "started_role_months") {
    if (prospect.started_role_months == null) return false
    const v = parseInt(value, 10)
    if (operator === "gte") return prospect.started_role_months >= v
    if (operator === "lte") return prospect.started_role_months <= v
    if (operator === "eq") return prospect.started_role_months === v
  }
  if (field === "shortlisted") {
    return value === "true" ? prospect.shortlisted === true : prospect.shortlisted !== true
  }
  return false
}

function prospectMatchesRoute(prospect: ProspectForDistribution, route: DistributionRoute): boolean {
  if (!route.conditions.length) return false
  // OR between groups, AND within each group
  return route.conditions.some(
    (group) => group.length > 0 && group.every((c) => evaluateCondition(prospect, c))
  )
}

// ─── Preview (count before running) ──────────────────────────────────────────

export async function previewDistribution(campaignId: string): Promise<{
  total: number
  previouslySent: number
}> {
  const { count: total } = await supabase
    .from("prospects")
    .select("id", { count: "exact", head: true })
    .eq("campaign_id", campaignId)

  const { count: previouslySent } = await supabase
    .from("prospects")
    .select("id", { count: "exact", head: true })
    .eq("campaign_id", campaignId)
    .not("sent_at", "is", null)

  return { total: total ?? 0, previouslySent: previouslySent ?? 0 }
}

// ─── Run distribution ─────────────────────────────────────────────────────────

export async function runDistribution(
  templateId: string,
  sourceCampaignId: string,
  includePreviouslySent: boolean
): Promise<string> {
  // Fetch template + routes
  const { data: t } = await supabaseAdmin
    .from("distribution_templates")
    .select("*")
    .eq("id", templateId)
    .single()
  if (!t) throw new Error("Plantilla no encontrada")

  const { data: routeRows } = await supabaseAdmin
    .from("distribution_routes")
    .select("*")
    .eq("template_id", templateId)
    .order("priority", { ascending: true })
  const routes: DistributionRoute[] = (routeRows ?? []).map((r) => ({ ...r, conditions: normalizeConditions(r.conditions) }))

  // Create run record
  const { data: run, error: runErr } = await supabaseAdmin
    .from("distribution_runs")
    .insert({
      template_id: templateId,
      template_name: t.name,
      source_campaign_id: sourceCampaignId,
      include_previously_sent: includePreviouslySent,
      status: "running",
    })
    .select("id")
    .single()
  if (runErr || !run) throw new Error(runErr?.message ?? "Error al crear corrida")

  try {
    // Fetch prospects
    let query = supabaseAdmin
      .from("prospects")
      .select("id, first_name, last_name, full_name, email, email_status, icp_score, icp_category, os_score, is_premium, connection_degree, linkedin_url, company_name, started_role_months, sent_at, shortlisted")
      .eq("campaign_id", sourceCampaignId)

    if (!includePreviouslySent) {
      query = query.is("sent_at", null)
    }

    const { data: prospects } = await query
    let allProspects = (prospects ?? []) as ProspectForDistribution[]

    // Global shortlist pre-filter (stored on template, applied before route conditions)
    const shortlistFilter = (t.shortlist_filter ?? "all") as "all" | "only" | "exclude"
    if (shortlistFilter === "only") {
      allProspects = allProspects.filter((p) => p.shortlisted === true)
    } else if (shortlistFilter === "exclude") {
      allProspects = allProspects.filter((p) => p.shortlisted !== true)
    }

    // Evaluate each route
    const routeResults: RunResults["routes"] = []
    const sentProspectIds = new Set<string>()

    for (const route of routes) {
      const matched = allProspects.filter((p) => prospectMatchesRoute(p, route))
      let slCount = 0, hrCount = 0
      const errors: string[] = []

      // Smartlead
      if (route.smartlead_campaign_id && matched.length > 0) {
        const leads = matched
          .filter((p) => p.email)
          .map((p) => ({
            email: p.email!,
            first_name: p.first_name,
            last_name: p.last_name,
            company_name: p.company_name,
            linkedin_profile: p.linkedin_url || undefined,
          }))
        if (leads.length > 0) {
          const res = await addLeadsToSmartlead(route.smartlead_campaign_id, leads)
          slCount = res.success
          if (res.error) errors.push(`Smartlead: ${res.error}`)
        }
      }

      // HeyReach
      if (route.heyreach_campaign_id && matched.length > 0) {
        const leads = matched
          .filter((p) => p.linkedin_url)
          .map((p) => ({
            linkedInProfileUrl: p.linkedin_url,
            firstName: p.first_name,
            lastName: p.last_name,
            companyName: p.company_name,
            email: p.email || undefined,
          }))
        if (leads.length > 0) {
          const res = await addLeadsToHeyReach(route.heyreach_campaign_id, leads)
          hrCount = res.success
          if (res.error) errors.push(`HeyReach: ${res.error}`)
        }
      }

      routeResults.push({
        route_id: route.id,
        name: route.name ?? `Ruta ${routes.indexOf(route) + 1}`,
        matched: matched.length,
        smartlead: slCount,
        heyreach: hrCount,
        errors,
      })

      // Mark as sent
      const toMark = matched
        .filter((p) => !sentProspectIds.has(p.id))
        .filter((p) => slCount > 0 || hrCount > 0)
      for (const p of toMark) sentProspectIds.add(p.id)
    }

    // Update prospects as sent
    if (sentProspectIds.size > 0) {
      const ids = Array.from(sentProspectIds)
      await supabaseAdmin
        .from("prospects")
        .update({ status: "sent", sent_at: new Date().toISOString() })
        .in("id", ids)
    }

    const totalSent = sentProspectIds.size
    const results: RunResults = {
      total: allProspects.length,
      sent: totalSent,
      skipped: allProspects.length - totalSent,
      routes: routeResults,
    }

    await supabaseAdmin
      .from("distribution_runs")
      .update({ status: "done", results })
      .eq("id", run.id)

    // Update campaign counter (best effort)
    try {
      await supabaseAdmin.rpc("increment_prospects_sent", {
        campaign_id: sourceCampaignId,
        amount: totalSent,
      })
    } catch { /* ignore */ }

  } catch (e) {
    await supabaseAdmin
      .from("distribution_runs")
      .update({ status: "error", error: e instanceof Error ? e.message : "Error desconocido" })
      .eq("id", run.id)
  }

  revalidatePath("/distribution")
  return run.id
}

// ─── Integration campaign list ────────────────────────────────────────────────

export type IntegrationCampaign = { id: string; name: string }

export async function loadIntegrationCampaigns(): Promise<{
  smartlead: IntegrationCampaign[]
  heyreach: IntegrationCampaign[]
}> {
  const [smartlead, heyreach] = await Promise.all([
    fetchSmartleadCampaigns(),
    fetchHeyReachCampaigns(),
  ])
  return { smartlead, heyreach }
}

// ─── Route preview (per-route match counts before running) ───────────────────

export type RoutePreviewResult = {
  total: number
  alreadySent: number
  perRoute: Array<{ routeId: string; matched: number; withEmail: number; withLinkedIn: number }>
}

export async function previewDistributionRoutes(
  routes: DistributionRoute[],
  campaignId: string
): Promise<RoutePreviewResult> {
  const { data: prospects } = await supabaseAdmin
    .from("prospects")
    .select("id, email, email_status, icp_score, icp_category, os_score, is_premium, connection_degree, linkedin_url, started_role_months, sent_at, shortlisted")
    .eq("campaign_id", campaignId)

  const all = (prospects ?? []) as ProspectForDistribution[]
  const available = all.filter((p) => !p.sent_at)

  const perRoute = routes.map((route) => {
    const matched = available.filter((p) => prospectMatchesRoute(p, route))
    return {
      routeId: route.id,
      matched: matched.length,
      withEmail: matched.filter((p) => p.email).length,
      withLinkedIn: matched.filter((p) => p.linkedin_url).length,
    }
  })

  return {
    total: all.length,
    alreadySent: all.length - available.length,
    perRoute,
  }
}

// ─── Campaigns for select ─────────────────────────────────────────────────────

export async function getCampaignsForDistribution() {
  const { data } = await supabase
    .from("campaigns")
    .select("id, week_label, rep_name, industry, prospects_found")
    .order("created_at", { ascending: false })
  return data ?? []
}
