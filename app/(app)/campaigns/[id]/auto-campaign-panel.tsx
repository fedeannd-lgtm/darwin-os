"use client"

import { useEffect, useState } from "react"
import { createClient } from "@supabase/supabase-js"
import { Zap, ExternalLink, CheckCircle2, AlertCircle, Clock, Loader2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import type { AutoCampaignData } from "./actions"

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!

const STATUS_LABELS: Record<string, string> = {
  pending: "Programada",
  company_search: "Buscando empresas",
  people_search: "Buscando personas",
  enriching: "Enriqueciendo",
  distributing: "Distribuyendo",
  done: "Completada",
  error: "Error",
}

const STATUS_PROGRESS: Record<string, number> = {
  pending: 0,
  company_search: 15,
  people_search: 35,
  enriching: 60,
  distributing: 90,
  done: 100,
  error: 0,
}

function formatDateTime(iso: string) {
  return new Date(iso).toLocaleString("es-AR", {
    dateStyle: "short",
    timeStyle: "short",
  })
}

function IcpBar({ distribution }: { distribution: Record<string, number> }) {
  const total = Object.values(distribution).reduce((a, b) => a + b, 0)
  if (!total) return null

  const COLORS: Record<string, string> = {
    Experience: "bg-blue-400",
    Helpdesk: "bg-emerald-400",
    Onboarding: "bg-amber-400",
    Communication: "bg-violet-400",
    Genérico: "bg-slate-300",
    Generic: "bg-slate-300",
  }

  return (
    <div className="space-y-1.5">
      <div className="flex h-3 rounded-full overflow-hidden gap-px">
        {Object.entries(distribution).map(([cat, count]) => (
          <div
            key={cat}
            className={`${COLORS[cat] ?? "bg-slate-300"} transition-all`}
            style={{ width: `${(count / total) * 100}%` }}
            title={`${cat}: ${count}`}
          />
        ))}
      </div>
      <div className="flex flex-wrap gap-x-3 gap-y-0.5">
        {Object.entries(distribution).map(([cat, count]) => (
          <span key={cat} className="text-xs text-muted-foreground">
            {cat} {Math.round((count / total) * 100)}%
          </span>
        ))}
      </div>
    </div>
  )
}

export function AutoCampaignPanel({
  campaignId,
  initialData,
  latestJobUrl,
  latestJobStatus,
}: {
  campaignId: string
  initialData: AutoCampaignData
  latestJobUrl: string | null
  latestJobStatus: string | null
}) {
  const [data, setData] = useState<AutoCampaignData>(initialData)
  const [jobUrl, setJobUrl] = useState<string | null>(latestJobUrl)

  // Subscribe to auto_campaigns changes via Supabase Realtime
  useEffect(() => {
    const client = createClient(supabaseUrl, supabaseAnonKey)
    const channel = client
      .channel(`auto-campaign-${campaignId}`)
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "auto_campaigns",
          filter: `campaign_id=eq.${campaignId}`,
        },
        (payload) => {
          setData((prev) => ({ ...prev, ...(payload.new as Partial<AutoCampaignData>) }))
        }
      )
      // Also listen for new search_jobs to update the job URL
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "search_jobs",
          filter: `campaign_id=eq.${campaignId}`,
        },
        async (payload) => {
          const newJob = payload.new as { sales_nav_url: string | null; status: string }
          if (newJob.sales_nav_url) {
            setJobUrl(newJob.sales_nav_url)
          }
        }
      )
      .subscribe()

    return () => { client.removeChannel(channel) }
  }, [campaignId])

  const isPending = data.status === "pending"
  const isRunning = ["company_search", "people_search", "enriching", "distributing"].includes(data.status)
  const isDone = data.status === "done"
  const isError = data.status === "error"
  const needsAction = (data.status === "company_search" || data.status === "people_search") && jobUrl

  const progress = STATUS_PROGRESS[data.status] ?? 0

  return (
    <div className="rounded-lg border bg-card shadow-sm overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b bg-muted/30">
        <div className="flex items-center gap-2">
          <Zap className="size-4 text-primary" />
          <span className="text-sm font-semibold">Campaña Automática</span>
          {data.distribution_template_name && (
            <span className="text-xs text-muted-foreground">· {data.distribution_template_name}</span>
          )}
        </div>
        <div className="flex items-center gap-2">
          {isPending && (
            <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <Clock className="size-3.5" />
              Inicia {formatDateTime(data.scheduled_at)}
            </div>
          )}
          {isDone && (
            <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <CheckCircle2 className="size-3.5 text-green-600" />
              Completada {data.completed_at ? formatDateTime(data.completed_at) : ""}
            </div>
          )}
          {isError && (
            <div className="flex items-center gap-1.5 text-xs text-red-600">
              <AlertCircle className="size-3.5" />
              Error
            </div>
          )}
        </div>
      </div>

      {/* Body */}
      <div className="px-4 py-4">
        {/* Progress bar (while running) */}
        {(isRunning || isPending) && (
          <div className="mb-4">
            <div className="flex items-center justify-between mb-1.5">
              <div className="flex items-center gap-1.5 text-sm font-medium">
                {isRunning && <Loader2 className="size-3.5 animate-spin text-primary" />}
                {STATUS_LABELS[data.status]}
              </div>
              <span className="text-xs text-muted-foreground">{progress}%</span>
            </div>
            <div className="h-2 bg-muted rounded-full overflow-hidden">
              <div
                className="h-full bg-primary rounded-full transition-all duration-700"
                style={{ width: `${progress}%` }}
              />
            </div>
            {data.current_step_detail && (
              <p className="text-xs text-muted-foreground mt-1.5">{data.current_step_detail}</p>
            )}
          </div>
        )}

        {/* Action button for extension steps */}
        {needsAction && (
          <div className="mb-4 rounded-md border border-blue-200 bg-blue-50 dark:bg-blue-950/30 dark:border-blue-900 p-3">
            <p className="text-sm font-medium text-blue-900 dark:text-blue-100 mb-2">
              {data.status === "company_search"
                ? "Abrí la URL en Chrome para que la extensión inicie el scraping de empresas"
                : "Abrí la URL en Chrome para que la extensión inicie el scraping de personas"}
            </p>
            <Button
              size="sm"
              variant="outline"
              className="gap-1.5"
              onClick={() => window.open(jobUrl!, "_blank", "noreferrer")}
            >
              <ExternalLink className="size-3.5" />
              {data.status === "company_search" ? "Abrir Company Search" : "Abrir People Search"}
            </Button>
            <p className="text-xs text-muted-foreground mt-2">La extensión corre sola una vez que abrís la URL</p>
          </div>
        )}

        {/* Error */}
        {isError && (
          <div className="rounded-md border border-red-200 bg-red-50 dark:bg-red-950/30 p-3">
            <p className="text-sm font-medium text-red-700 dark:text-red-300">Ocurrió un error</p>
            {data.error_message && (
              <p className="text-xs text-red-600 dark:text-red-400 mt-1">{data.error_message}</p>
            )}
          </div>
        )}

        {/* Results (done) */}
        {isDone && (
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
            <div>
              <p className="text-2xl font-bold tabular-nums">{data.result_companies ?? 0}</p>
              <p className="text-xs text-muted-foreground">Empresas</p>
            </div>
            <div>
              <p className="text-2xl font-bold tabular-nums">{data.result_people ?? 0}</p>
              <p className="text-xs text-muted-foreground">Personas</p>
            </div>
            <div>
              <p className="text-2xl font-bold tabular-nums text-emerald-600">
                {data.result_emails_found ?? 0}
              </p>
              <p className="text-xs text-muted-foreground">
                Emails{" "}
                {data.result_people
                  ? `(${Math.round(((data.result_emails_found ?? 0) / data.result_people) * 100)}%)`
                  : ""}
              </p>
            </div>
            <div>
              <p className="text-2xl font-bold tabular-nums text-amber-600">
                {data.result_shortlisted ?? 0}
              </p>
              <p className="text-xs text-muted-foreground">Shortlisted</p>
            </div>

            {data.result_icp_distribution && Object.keys(data.result_icp_distribution).length > 0 && (
              <div className="col-span-2 sm:col-span-4 pt-2 border-t">
                <p className="text-xs font-medium text-muted-foreground mb-2">Distribución ICP</p>
                <IcpBar distribution={data.result_icp_distribution} />
              </div>
            )}

            {data.result_distributed && (
              <div className="col-span-2 sm:col-span-4 pt-2 border-t">
                <p className="text-xs font-medium text-muted-foreground mb-1">Distribución</p>
                {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
                {(() => {
                  const r = data.result_distributed as { total?: number; sent?: number; routes?: Array<{ name: string; matched: number; smartlead: number; heyreach: number }> }
                  return (
                    <div className="space-y-1 text-xs text-muted-foreground">
                      <p>{r.sent ?? 0} enviadas de {r.total ?? 0} prospects</p>
                      {r.routes?.filter((rt) => rt.matched > 0).map((rt, i) => (
                        <p key={i}>
                          {rt.name}: {rt.matched} matches → Smartlead {rt.smartlead} · HeyReach {rt.heyreach}
                        </p>
                      ))}
                    </div>
                  )
                })()}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
