import { NextRequest, NextResponse } from "next/server"
import { supabaseAdmin } from "@/lib/supabase"
import { processCompanySearch, processPeopleSearch, extractDomain, normalizeCompanyName, type RawCompany, type RawPerson } from "@/lib/process-search-results"

const CORS = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "POST, OPTIONS", "Access-Control-Allow-Headers": "Content-Type", "Access-Control-Allow-Private-Network": "true" }

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS })
}

export async function POST(req: NextRequest) {
  const jobId = req.nextUrl.searchParams.get("jobId")
  if (!jobId) return NextResponse.json({ error: "jobId requerido" }, { status: 400 })

  const body = await req.json() as {
    items: RawCompany[] | RawPerson[]
    done?: boolean
  }

  const { data: job } = await supabaseAdmin
    .from("search_jobs")
    .select("job_type, campaign_id, start_page, campaigns(rep_name, industry)")
    .eq("id", jobId)
    .single()

  if (!job) return NextResponse.json({ error: "Job no encontrado" }, { status: 404 })

  if (job.job_type === "company_search") {
    const campaignData = Array.isArray(job.campaigns) ? job.campaigns[0] : job.campaigns
    const campaignIndustry = (campaignData as { industry?: string } | null)?.industry ?? null

    const [{ data: cfg }, { data: clients }] = await Promise.all([
      supabaseAdmin.from("inbox_config").select("exclude_clients, exclude_previous").eq("id", 1).single(),
      supabaseAdmin.from("client_companies").select("company_name"),
    ])

    const clientSet = cfg?.exclude_clients
      ? new Set((clients ?? []).map((c: { company_name: string }) => normalizeCompanyName(c.company_name)))
      : new Set<string>()

    const previousIdSet = new Set<string>()
    const previousNameSet = new Set<string>()

    if (cfg?.exclude_previous && campaignIndustry) {
      const { data: sameCampaigns } = await supabaseAdmin
        .from("campaigns").select("id")
        .eq("industry", campaignIndustry).neq("id", job.campaign_id)
      const ids = (sameCampaigns ?? []).map((c: { id: string }) => c.id)
      if (ids.length > 0) {
        const { data: prevAccounts } = await supabaseAdmin
          .from("accounts").select("sales_nav_id, company_name").in("campaign_id", ids)
        for (const a of prevAccounts ?? []) {
          if (a.sales_nav_id) previousIdSet.add(a.sales_nav_id)
          const name = normalizeCompanyName(a.company_name ?? "")
          if (name) previousNameSet.add(name)
        }
      }
    }

    function applyFilters(items: RawCompany[]): RawCompany[] {
      return items.filter((c) => {
        if (clientSet.size > 0 && clientSet.has(normalizeCompanyName(c.companyName ?? ""))) return false
        if (c.id && previousIdSet.has(c.id)) return false
        if (previousNameSet.has(normalizeCompanyName(c.companyName ?? ""))) return false
        return true
      })
    }

    if (body.done) {
      await processCompanySearch(jobId, job, applyFilters(body.items as RawCompany[]))
    } else {
      // Partial batch — mark running, insert without closing job
      const { data: existing } = await supabaseAdmin
        .from("search_jobs")
        .select("status")
        .eq("id", jobId)
        .single()
      if (existing?.status === "pending") {
        await supabaseAdmin.from("search_jobs").update({ status: "running" }).eq("id", jobId)
      }
      const accounts = applyFilters(body.items as RawCompany[]).map((c) => ({
        campaign_id: job.campaign_id,
        company_name: c.companyName ?? "",
        domain: c.website ?? "",
        sales_nav_id: c.id ?? "",
      }))
      if (accounts.length > 0) await supabaseAdmin.from("accounts").insert(accounts)
      const prev = (existing as { results_count?: number } | null)?.results_count ?? 0
      await supabaseAdmin.from("search_jobs").update({ results_count: prev + accounts.length }).eq("id", jobId)
    }
  } else {
    if (body.done) {
      await processPeopleSearch(jobId, job, body.items as RawPerson[])
    } else {
      // Batch parcial — insertar sin cerrar el job
      // Reutilizar processPeopleSearch con done=false sería complejo,
      // así que acumulamos en DB y cerramos el job cuando done=true
      const { data: existing } = await supabaseAdmin
        .from("search_jobs")
        .select("status, results_count")
        .eq("id", jobId)
        .single()

      // Mark as running on first batch
      if (existing?.status === "pending") {
        await supabaseAdmin.from("search_jobs").update({ status: "running" }).eq("id", jobId)
      }

      // Insertar prospects parciales (sin cerrar job)
      const people = body.items as RawPerson[]
      if (people.length > 0) {
        // Look up accounts for this campaign to resolve account_id and company_domain
        const { data: campaignAccounts } = await supabaseAdmin
          .from("accounts")
          .select("id, company_name, domain")
          .eq("campaign_id", job.campaign_id)

        const accountByName = new Map<string, { id: string; domain: string }>()
        for (const a of campaignAccounts ?? []) {
          if (a.company_name) {
            const key = a.company_name.toLowerCase().trim()
            const existing = accountByName.get(key)
            // Prefer accounts with domain over those without
            if (!existing || (!existing.domain && a.domain)) {
              accountByName.set(key, { id: a.id, domain: a.domain ?? "" })
            }
          }
        }

        const degreeLabel: Record<number, string> = { 1: "FIRST", 2: "SECOND", 3: "THIRD" }
        const prospects = people.map((p) => {
          const matched = accountByName.get((p.companyName ?? "").toLowerCase().trim()) ?? null
          return {
            campaign_id: job.campaign_id,
            account_id: matched?.id ?? null,
            first_name: p.firstName ?? "",
            last_name: p.lastName ?? "",
            full_name: p.fullName ?? `${p.firstName ?? ""} ${p.lastName ?? ""}`.trim(),
            job_title: p.jobTitle ?? p.currentPositions?.[0]?.title ?? p.headline ?? "",
            linkedin_url: p.profileUrl ?? "",
            company_name: p.companyName ?? "",
            company_domain: matched?.domain ? extractDomain(matched.domain) : "",
            is_premium: p.premium ?? false,
            connection_degree: p.connectionType ? (degreeLabel[p.connectionType] ?? String(p.connectionType)) : "",
            location: p.location ?? "",
            started_role_months: p.startedRoleMonths ?? p.currentPositions?.[0]?.startedOn?.month ?? null,
            highlights: p.highlights?.map((h) => h.name || h.description || "").filter(Boolean).join(", ") || null,
          }
        })
        await supabaseAdmin.from("prospects").insert(prospects)

        const prev = (existing as { results_count?: number } | null)?.results_count ?? 0
        await supabaseAdmin
          .from("search_jobs")
          .update({ results_count: prev + people.length })
          .eq("id", jobId)
      }
    }
  }

  return NextResponse.json({ ok: true, received: body.items.length, done: body.done ?? false }, { headers: CORS })
}
