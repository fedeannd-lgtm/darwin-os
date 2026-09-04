import { NextRequest, NextResponse } from "next/server"
import { supabaseAdmin } from "@/lib/supabase"
import { advanceAutoCampaigns } from "@/lib/auto-campaign-engine"

export const maxDuration = 60

const MAKE_EXTRACTION_WEBHOOK = process.env.MAKE_COMPANY_EXTRACTION_WEBHOOK_URL!
const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000"
const CRON_SECRET = process.env.CRON_SECRET

export async function GET(req: NextRequest) {
  // Vercel cron jobs send this header for security
  if (CRON_SECRET && req.headers.get("authorization") !== `Bearer ${CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  // Advance automated campaigns (state machine) — siempre, antes de cualquier otra lógica
  await advanceAutoCampaigns().catch((err) =>
    console.error("[Cron] Error advancing auto campaigns:", err)
  )

  if (!MAKE_EXTRACTION_WEBHOOK) {
    return NextResponse.json({ ok: true, triggered: 0, note: "MAKE_COMPANY_EXTRACTION_WEBHOOK_URL no configurado" })
  }

  // Buscar jobs running con datasetId listo y estimated_ready_at ya pasado
  const { data: jobs, error } = await supabaseAdmin
    .from("search_jobs")
    .select("id, dataset_id")
    .eq("status", "running")
    .eq("job_type", "company_search")
    .not("dataset_id", "is", null)
    .lt("estimated_ready_at", new Date().toISOString())

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  if (!jobs || jobs.length === 0) {
    return NextResponse.json({ ok: true, triggered: 0 })
  }

  const callbackUrl = `${APP_URL}/api/webhooks/make/company-extraction`
  const results = await Promise.allSettled(
    jobs.map((job) =>
      fetch(MAKE_EXTRACTION_WEBHOOK, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          jobId: job.id,
          defaultDatasetId: job.dataset_id,
          callbackUrl,
        }),
      })
    )
  )

  const triggered = results.filter((r) => r.status === "fulfilled").length

  return NextResponse.json({ ok: true, triggered, total: jobs.length })
}
