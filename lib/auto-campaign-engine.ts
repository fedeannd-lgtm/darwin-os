/**
 * Motor de avance de campañas automáticas.
 * Llamado por el cron cada 5 minutos para avanzar el estado de cada auto_campaign.
 *
 * Flujo: pending → company_search → people_search → enriching → distributing → done
 */

import { supabaseAdmin } from "@/lib/supabase"
import { addExclusionListsToUrl, updateAccountListInUrl } from "@/lib/sales-nav-lists"
import { enrichProspect } from "@/lib/enrichment"
import { classifyIcp } from "@/lib/icp"
import { calculateOsScore } from "@/lib/scoring"
import { findPhoneDatagma } from "@/lib/datagma"
import { findPhoneProspeo } from "@/lib/prospeo"
import { normalizePersonName, normalizeCompanyName } from "@/lib/process-search-results"
import { runDistribution } from "@/app/(app)/distribution/actions"

const APP_URL =
  process.env.APP_BASE_URL ||
  (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : "http://localhost:3000")

const PARALLEL_SIZE = 10   // prospects procesados en paralelo por iteración
const TIME_BUDGET_MS = 50_000  // detener a 50s para no agotar el maxDuration de 60s

// ─── Types ────────────────────────────────────────────────────────────────────

type AutoCampaign = {
  id: string
  campaign_id: string
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
  status: string
  enrichment_offset: number
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function setError(id: string, message: string) {
  await supabaseAdmin
    .from("auto_campaigns")
    .update({ status: "error", error_message: message })
    .eq("id", id)
  console.error(`[AutoCampaign ${id}] Error:`, message)
}

async function setStatus(id: string, status: string, extra: Record<string, unknown> = {}) {
  await supabaseAdmin
    .from("auto_campaigns")
    .update({ status, ...extra })
    .eq("id", id)
}

// ─── Step 1: pending → company_search ────────────────────────────────────────

async function advancePending(auto: AutoCampaign) {
  // Build extension URL with optional exclusion lists
  let urlToOpen = auto.company_search_url
  if ((auto.start_page ?? 1) > 1) {
    const sep = urlToOpen.includes("#") ? "&" : "#"
    urlToOpen += `${sep}page=${auto.start_page}`
  }

  if (auto.exclude_previous) {
    // Get campaign identity to filter by rep + industry
    const { data: campaign } = await supabaseAdmin
      .from("campaigns")
      .select("rep_name, industry")
      .eq("id", auto.campaign_id)
      .single()

    if (campaign) {
      let prevQuery = supabaseAdmin
        .from("campaigns")
        .select("list_id, list_name, week_label")
        .eq("rep_name", campaign.rep_name)
        .eq("industry", campaign.industry)
        .not("list_id", "is", null)
        .neq("id", auto.campaign_id)

      if (auto.exclusion_date_from)
        prevQuery = prevQuery.gte("created_at", auto.exclusion_date_from)
      if (auto.exclusion_date_to)
        prevQuery = prevQuery.lte("created_at", auto.exclusion_date_to + "T23:59:59")

      const { data: prev } = await prevQuery
      if (prev?.length) {
        const lists = prev.map((c) => ({
          id: c.list_id!,
          name: c.list_name ?? c.week_label ?? c.list_id!,
        }))
        urlToOpen = addExclusionListsToUrl(urlToOpen, lists)
      }
    }
  }

  // Create company search job
  const callbackUrl = encodeURIComponent(`${APP_URL}/api/extension/results`)
  const hashSep = urlToOpen.includes("#") ? "&" : "#"
  const extensionUrl = `${urlToOpen}${hashSep}_mode=company_scrape&_job=__JOB_ID__&_campaign=${auto.campaign_id}&_max=${auto.company_count}&_cb=${callbackUrl}`

  const { data: job, error: jobErr } = await supabaseAdmin
    .from("search_jobs")
    .insert({
      campaign_id: auto.campaign_id,
      job_type: "company_search",
      sales_nav_url: urlToOpen,         // base URL (without extension params)
      status: "pending",
      max_results: auto.company_count,
      start_page: auto.start_page ?? 1,
    })
    .select("id")
    .single()

  if (jobErr || !job) {
    await setError(auto.id, jobErr?.message ?? "Error al crear job de company search")
    return
  }

  // Store extension URL on the job (reuse sales_nav_url as the full URL, job ID injected)
  const finalExtensionUrl = extensionUrl.replace("__JOB_ID__", job.id)
  await supabaseAdmin
    .from("search_jobs")
    .update({ sales_nav_url: finalExtensionUrl })
    .eq("id", job.id)

  await supabaseAdmin
    .from("campaigns")
    .update({ status: "searching" })
    .eq("id", auto.campaign_id)

  await setStatus(auto.id, "company_search", {
    current_step_detail: "Esperando que la extensión inicie el company search…",
  })
}

// ─── Step 2: company_search → creating_list ───────────────────────────────────

async function advanceCompanySearch(auto: AutoCampaign) {
  // Check if the company_search job is completed
  const { data: job } = await supabaseAdmin
    .from("search_jobs")
    .select("status")
    .eq("campaign_id", auto.campaign_id)
    .eq("job_type", "company_search")
    .order("created_at", { ascending: false })
    .limit(1)
    .single()

  if (!job || job.status !== "completed") return // still running

  // Company scrape done → wait for user to create the Sales Nav account list
  await setStatus(auto.id, "creating_list", {
    current_step_detail: "Empresas encontradas. Abrí Sales Nav para crear la lista de cuentas.",
  })
}

// ─── Step 3: creating_list → people_search ───────────────────────────────────

async function advanceCreatingList(auto: AutoCampaign) {
  // Wait for the extension to create the Account List (campaigns.list_id)
  const { data: campaign } = await supabaseAdmin
    .from("campaigns")
    .select("list_id, list_name")
    .eq("id", auto.campaign_id)
    .single()

  if (!campaign?.list_id) return // list not created yet — stay here

  // Build people search URL with the Account List injected
  const peopleUrl = updateAccountListInUrl(
    auto.people_search_url,
    campaign.list_id,
    campaign.list_name ?? ""
  )

  // Create people search job
  const callbackUrl = encodeURIComponent(`${APP_URL}/api/extension/results`)
  const hashSep = peopleUrl.includes("#") ? "&" : "#"
  const extensionUrl = `${peopleUrl}${hashSep}_mode=people_scrape&_job=__JOB_ID__&_max=${auto.people_count}&_cb=${callbackUrl}`

  const { data: psJob, error: psErr } = await supabaseAdmin
    .from("search_jobs")
    .insert({
      campaign_id: auto.campaign_id,
      job_type: "people_search",
      sales_nav_url: peopleUrl,
      status: "pending",
      max_results: auto.people_count,
    })
    .select("id")
    .single()

  if (psErr || !psJob) {
    await setError(auto.id, psErr?.message ?? "Error al crear job de people search")
    return
  }

  const finalExtensionUrl = extensionUrl.replace("__JOB_ID__", psJob.id)
  await supabaseAdmin
    .from("search_jobs")
    .update({ sales_nav_url: finalExtensionUrl })
    .eq("id", psJob.id)

  await setStatus(auto.id, "people_search", {
    current_step_detail: "Esperando que la extensión inicie el people search…",
  })
}

// ─── Step 4: people_search → enriching ───────────────────────────────────────

async function advancePeopleSearch(auto: AutoCampaign) {
  const { data: job } = await supabaseAdmin
    .from("search_jobs")
    .select("status")
    .eq("campaign_id", auto.campaign_id)
    .eq("job_type", "people_search")
    .order("created_at", { ascending: false })
    .limit(1)
    .single()

  if (!job || job.status !== "completed") return // still running

  // Normalize names before enrichment batch starts
  if (auto.normalize_names) {
    const { data: allProspects } = await supabaseAdmin
      .from("prospects")
      .select("id, first_name, last_name, full_name, company_name")
      .eq("campaign_id", auto.campaign_id)

    const updates = (allProspects ?? []).map((p) => ({
      id: p.id,
      first_name: p.first_name ? normalizePersonName(p.first_name) : p.first_name,
      last_name: p.last_name ? normalizePersonName(p.last_name) : p.last_name,
      full_name: p.full_name ? normalizePersonName(p.full_name) : p.full_name,
      company_name: p.company_name ? normalizeCompanyName(p.company_name) : p.company_name,
    }))

    // Batch upsert in chunks of 50 (single query per chunk, much faster than individual updates)
    for (let i = 0; i < updates.length; i += 50) {
      await supabaseAdmin.from("prospects").upsert(updates.slice(i, i + 50), { onConflict: "id" })
    }
  }

  await supabaseAdmin.from("campaigns").update({ status: "enriching" }).eq("id", auto.campaign_id)
  await setStatus(auto.id, "enriching", {
    enrichment_offset: 0,
    current_step_detail: "Iniciando enriquecimiento…",
  })

  // Run first enrichment batch inline — avoids unreliable fire-and-forget from within after()
  // BATCH_SIZE=5 so ~15s per batch; well within the 60s maxDuration
  await advanceEnriching({ ...auto, status: "enriching", enrichment_offset: 0 })
}

// ─── Step 5: enriching (loop paralelo, sin self-triggers) ────────────────────

async function enrichOneProspect(
  auto: AutoCampaign,
  prospect: { id: string; job_title: string | null; email: string | null; email_status: string | null }
) {
  if (auto.enrich_emails) {
    const { data: p } = await supabaseAdmin
      .from("prospects")
      .select("id, first_name, last_name, full_name, company_name, company_domain, linkedin_url, job_title, email, email_status, accounts(linkedin_url, domain)")
      .eq("id", prospect.id)
      .single()

    if (p) {
      const osScore = calculateOsScore(p.job_title ?? "")
      const skip =
        p.email &&
        (p.email_status === "valid" ||
          p.email_status === "catch-all" ||
          p.email_status === "unknown")

      if (!skip) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const acct = (p as any).accounts
        const accountLinkedIn = acct?.linkedin_url ?? null
        const accountDomain = acct?.domain ?? null
        const result = await enrichProspect({
          first_name: p.first_name ?? "",
          last_name: p.last_name ?? "",
          full_name: p.full_name ?? "",
          company_name: p.company_name ?? "",
          company_domain: p.company_domain ?? accountDomain ?? null,
          linkedin_url: p.linkedin_url ?? "",
          company_linkedin_url: accountLinkedIn,
        })
        const { category, score } = classifyIcp(p.job_title ?? "")
        await supabaseAdmin.from("prospects").update({
          email: result.email,
          email_status: result.zbStatus,
          email_provider: result.provider,
          email_validated: result.enriched,
          icp_category: category,
          icp_score: score,
          os_score: osScore,
          apollo_id: result.apolloId ?? null,
        }).eq("id", p.id)
      } else if (auto.classify_icp) {
        const { category, score } = classifyIcp(p.job_title ?? "")
        await supabaseAdmin.from("prospects").update({
          icp_category: category,
          icp_score: score,
          os_score: osScore,
        }).eq("id", p.id)
      }
    }
  } else if (auto.classify_icp) {
    const { data: p } = await supabaseAdmin
      .from("prospects")
      .select("id, job_title")
      .eq("id", prospect.id)
      .single()
    if (p) {
      const { category, score } = classifyIcp(p.job_title ?? "")
      const osScore = calculateOsScore(p.job_title ?? "")
      await supabaseAdmin.from("prospects").update({
        icp_category: category,
        icp_score: score,
        os_score: osScore,
      }).eq("id", p.id)
    }
  }

  if (auto.enrich_phones) {
    const { data: p } = await supabaseAdmin
      .from("prospects")
      .select("id, phone, first_name, last_name, full_name, company_name, linkedin_url")
      .eq("id", prospect.id)
      .single()
    if (p && !p.phone) {
      let phone: string | null = null
      if (p.linkedin_url) {
        phone = await findPhoneDatagma({
          linkedinUrl: p.linkedin_url,
          firstName: p.first_name ?? "",
          lastName: p.last_name ?? "",
          companyName: p.company_name,
        })
      }
      if (!phone) {
        phone = await findPhoneProspeo({
          linkedinUrl: p.linkedin_url,
          firstName: p.first_name ?? undefined,
          lastName: p.last_name ?? undefined,
        })
      }
      if (phone) {
        await supabaseAdmin.from("prospects").update({ phone }).eq("id", p.id)
      }
    }
  }
}

async function advanceEnriching(auto: AutoCampaign) {
  const { count: total } = await supabaseAdmin
    .from("prospects")
    .select("id", { count: "exact", head: true })
    .eq("campaign_id", auto.campaign_id)

  const totalCount = total ?? 0
  let offset = auto.enrichment_offset
  const deadline = Date.now() + TIME_BUDGET_MS

  while (offset < totalCount) {
    // Time guard: si se agota el presupuesto, guardar progreso y dejar que el cron retome
    if (Date.now() > deadline) {
      await setStatus(auto.id, "enriching", {
        enrichment_offset: offset,
        current_step_detail: `Enriqueciendo ${offset} de ${totalCount} personas…`,
      })
      console.log(`[AutoCampaign] Time budget reached at ${offset}/${totalCount}, cron will resume`)
      return  // sin self-trigger — el cron de 5 min retoma desde el offset guardado
    }

    const { data: batch } = await supabaseAdmin
      .from("prospects")
      .select("id, job_title, email, email_status")
      .eq("campaign_id", auto.campaign_id)
      .order("created_at", { ascending: true })
      .range(offset, offset + PARALLEL_SIZE - 1)

    if (!batch?.length) break

    // Procesar todos los prospects del batch en paralelo (10x más rápido que secuencial)
    await Promise.all(
      batch.map(async (prospect) => {
        try {
          await enrichOneProspect(auto, prospect)
        } catch (err) {
          console.error(`[AutoCampaign] Error enriching prospect ${prospect.id}:`, err)
        }
      })
    )

    offset += batch.length

    // Actualizar siempre (incluso en el último batch) para mostrar el total correcto
    await setStatus(auto.id, "enriching", {
      enrichment_offset: offset,
      current_step_detail: `Enriqueciendo ${offset} de ${totalCount} personas…`,
    })
  }

  // Todos los prospects procesados → shortlist → distribución inline
  // (no esperamos el cron; el budget restante es suficiente para distribución)
  await finalizeEnrichment(auto, totalCount)
  await advanceDistributing({ ...auto, status: "distributing" })
}

async function finalizeEnrichment(auto: AutoCampaign, totalCount: number) {
  // Apply auto-shortlist rules
  const shortlistIds: string[] = []

  if (auto.shortlist_icp_min !== null) {
    const { data: icpMatch } = await supabaseAdmin
      .from("prospects")
      .select("id")
      .eq("campaign_id", auto.campaign_id)
      .gte("icp_score", auto.shortlist_icp_min)

    shortlistIds.push(...(icpMatch ?? []).map((p) => p.id))
  }

  if (auto.shortlist_title_keywords) {
    const keywords = auto.shortlist_title_keywords
      .split(",")
      .map((k) => k.trim().toLowerCase())
      .filter(Boolean)

    if (keywords.length > 0) {
      const { data: allProspects } = await supabaseAdmin
        .from("prospects")
        .select("id, job_title")
        .eq("campaign_id", auto.campaign_id)

      for (const p of allProspects ?? []) {
        const title = (p.job_title ?? "").toLowerCase()
        if (keywords.some((kw) => title.includes(kw))) {
          shortlistIds.push(p.id)
        }
      }
    }
  }

  // Deduplicate and apply
  const uniqueIds = [...new Set(shortlistIds)]
  if (uniqueIds.length > 0) {
    // Batch shortlist
    for (let i = 0; i < uniqueIds.length; i += 50) {
      await supabaseAdmin
        .from("prospects")
        .update({ shortlisted: true })
        .in("id", uniqueIds.slice(i, i + 50))
    }
  }

  await supabaseAdmin.from("campaigns").update({ status: "distributing" }).eq("id", auto.campaign_id)
  await setStatus(auto.id, "distributing", {
    enrichment_offset: totalCount,
    current_step_detail: `Enriquecimiento completado. ${uniqueIds.length} personas enviadas a Shortlist.`,
  })
}

// ─── Step 5: distributing → done ─────────────────────────────────────────────

async function advanceDistributing(auto: AutoCampaign) {
  if (!auto.distribution_template_id) {
    // No template configured — skip distribution and finish
    await computeResults(auto)
    return
  }

  try {
    const runId = await runDistribution(auto.distribution_template_id, auto.campaign_id, false)

    // Fetch run results
    const { data: run } = await supabaseAdmin
      .from("distribution_runs")
      .select("results")
      .eq("id", runId)
      .single()

    await computeResults(auto, run?.results ?? null)
  } catch (err) {
    await setError(auto.id, `Error en distribución: ${err instanceof Error ? err.message : String(err)}`)
  }
}

async function computeResults(auto: AutoCampaign, distributionResults: unknown = null) {
  const [{ count: companies }, { count: people }, { count: emailsFound }, icpRes, { count: shortlisted }] =
    await Promise.all([
      supabaseAdmin.from("accounts").select("id", { count: "exact", head: true }).eq("campaign_id", auto.campaign_id),
      supabaseAdmin.from("prospects").select("id", { count: "exact", head: true }).eq("campaign_id", auto.campaign_id),
      supabaseAdmin.from("prospects").select("id", { count: "exact", head: true }).eq("campaign_id", auto.campaign_id).not("email", "is", null).in("email_status", ["valid", "catch-all", "unknown"]),
      supabaseAdmin.from("prospects").select("icp_category").eq("campaign_id", auto.campaign_id).not("icp_category", "is", null),
      supabaseAdmin.from("prospects").select("id", { count: "exact", head: true }).eq("campaign_id", auto.campaign_id).eq("shortlisted", true),
    ])

  // Build ICP distribution map
  const icpDistribution: Record<string, number> = {}
  for (const p of icpRes.data ?? []) {
    const cat = p.icp_category ?? "Genérico"
    icpDistribution[cat] = (icpDistribution[cat] ?? 0) + 1
  }

  await supabaseAdmin.from("auto_campaigns").update({
    status: "done",
    completed_at: new Date().toISOString(),
    current_step_detail: null,
    result_companies: companies ?? 0,
    result_people: people ?? 0,
    result_emails_found: emailsFound ?? 0,
    result_icp_distribution: icpDistribution,
    result_shortlisted: shortlisted ?? 0,
    result_distributed: distributionResults,
  }).eq("id", auto.id)

  await supabaseAdmin.from("campaigns").update({ status: "done" }).eq("id", auto.campaign_id)
}

// ─── Main entrypoint ──────────────────────────────────────────────────────────

export async function advanceAutoCampaigns() {
  const { data: actives, error } = await supabaseAdmin
    .from("auto_campaigns")
    .select("*")
    .in("status", ["pending", "company_search", "creating_list", "people_search", "enriching", "distributing"])
    .limit(10)

  console.log("[AutoCampaign] Found", actives?.length ?? 0, "campaigns | error:", error?.message ?? null)

  if (error) {
    console.error("[AutoCampaign] Error fetching campaigns:", error.message)
    return
  }

  for (const auto of actives ?? []) {
    try {
      switch (auto.status) {
        case "pending": {
          const scheduledAt = new Date(auto.scheduled_at)
          const now = new Date()
          console.log(`[AutoCampaign] ${auto.id} pending | scheduled: ${scheduledAt.toISOString()} | now: ${now.toISOString()} | due: ${scheduledAt <= now}`)
          if (scheduledAt <= now) {
            await advancePending(auto as AutoCampaign)
          }
          break
        }
          break
        case "company_search":
          await advanceCompanySearch(auto as AutoCampaign)
          break
        case "creating_list":
          await advanceCreatingList(auto as AutoCampaign)
          break
        case "people_search":
          await advancePeopleSearch(auto as AutoCampaign)
          break
        case "enriching":
          await advanceEnriching(auto as AutoCampaign)
          break
        case "distributing":
          await advanceDistributing(auto as AutoCampaign)
          break
      }
    } catch (err) {
      await setError(
        auto.id,
        `Error inesperado en estado ${auto.status}: ${err instanceof Error ? err.message : String(err)}`
      )
    }
  }
}
