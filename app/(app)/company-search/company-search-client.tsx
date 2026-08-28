"use client"

import { useState, useEffect, useTransition } from "react"
import Link from "next/link"
import { Search, Building2, Loader2, CheckCircle2, XCircle, Clock, AlertTriangle, Link2, Timer, ChevronsUpDown, Check, Trash2 } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command"
import { getSearchConfig, triggerCompanySearch, getJobStatus, deleteSearchJobs, getExcludedPreviousCount } from "./actions"
import { getInboxConfig, saveInboxConfig } from "../inbox/actions"

type Campaign = {
  id: string
  week_label: string
  rep_name: string
  industry: string
  status: string
}

type SearchJob = {
  id: string
  campaign_id: string
  status: string
  sales_nav_url: string | null
  results_count: number
  start_page: number | null
  created_at: string
  completed_at: string | null
  estimated_ready_at?: string | null
  campaigns: { week_label: string; rep_name: string; industry: string } | null
}

type SearchConfig = {
  base_url: string
  current_page: number
} | null

const MAX_OPTIONS = [1, 25, 50, 100, 200]

const JOB_STATUS_CONFIG = {
  pending:    { label: "Pendiente",   icon: Clock,        class: "bg-zinc-100 text-zinc-600" },
  running:    { label: "Scrapeando",  icon: Loader2,      class: "bg-blue-50 text-blue-700" },
  extracting: { label: "Extrayendo",  icon: Loader2,      class: "bg-violet-50 text-violet-700" },
  completed:  { label: "Listo",       icon: CheckCircle2, class: "bg-green-50 text-green-700" },
  failed:     { label: "Error",       icon: XCircle,      class: "bg-red-50 text-red-700" },
}

function useCountdown(targetIso: string | null | undefined) {
  const [remaining, setRemaining] = useState<number | null>(null)

  useEffect(() => {
    if (!targetIso) { setRemaining(null); return }

    function tick() {
      const diff = Math.max(0, new Date(targetIso!).getTime() - Date.now())
      setRemaining(diff)
    }

    tick()
    const id = setInterval(tick, 1000)
    return () => clearInterval(id)
  }, [targetIso])

  return remaining
}

function formatCountdown(ms: number) {
  if (ms <= 0) return "extrayendo..."
  const totalSec = Math.ceil(ms / 1000)
  const min = Math.floor(totalSec / 60)
  const sec = totalSec % 60
  return min > 0 ? `~${min} min` : `${sec}s`
}

function pageRangeLabel(job: SearchJob): string | null {
  if (job.start_page == null) return null
  if (job.status === "completed") {
    const pages = Math.max(1, Math.ceil(job.results_count / 25))
    const end = job.start_page + pages - 1
    return end > job.start_page ? `Págs. ${job.start_page}–${end}` : `Pág. ${job.start_page}`
  }
  return `Pág. ${job.start_page}+`
}

function JobCard({ job, onDelete }: { job: SearchJob; onDelete: () => void }) {
  const cfg = JOB_STATUS_CONFIG[job.status as keyof typeof JOB_STATUS_CONFIG] ?? JOB_STATUS_CONFIG.pending
  const Icon = cfg.icon
  const remaining = useCountdown(job.status === "running" ? job.estimated_ready_at : null)
  const pageLabel = pageRangeLabel(job)
  return (
    <div className="rounded-lg border px-3 py-2.5 space-y-1.5">
      <div className="flex items-center justify-between">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ${cfg.class}`}>
              <Icon className={`size-3 ${job.status === "running" ? "animate-spin" : ""}`} />
              {cfg.label}
            </span>
            {job.status === "running" && remaining !== null && (
              <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
                <Timer className="size-3" />
                {formatCountdown(remaining)}
              </span>
            )}
            {(job.status === "running" || job.status === "completed") && job.results_count > 0 && (
              <span className="text-xs text-muted-foreground">{job.results_count} empresas</span>
            )}
            {pageLabel && (
              <span className="text-xs text-muted-foreground font-mono">{pageLabel}</span>
            )}
          </div>
          {job.campaigns && (
            <p className="mt-0.5 truncate text-xs text-muted-foreground">
              {job.campaigns.week_label} · {job.campaigns.rep_name} · {job.campaigns.industry}
            </p>
          )}
        </div>
        <div className="ml-3 flex items-center gap-2 shrink-0">
          <span className="text-xs text-muted-foreground">
            {new Date(job.created_at).toLocaleDateString("es", { day: "numeric", month: "short" })}
          </span>
          <Button variant="ghost" size="icon" className="size-6 text-muted-foreground hover:text-destructive" onClick={onDelete}>
            <Trash2 className="size-3.5" />
          </Button>
        </div>
      </div>
      {job.status === "completed" && (
        <div className="flex items-center gap-2">
          <Link href={`/campaigns/${job.campaign_id}`} className="inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-xs font-medium hover:bg-muted transition-colors">
            <Building2 className="size-3" />
            Ver empresas
          </Link>
        </div>
      )}
    </div>
  )
}

export function CompanySearchClient({
  campaigns,
  initialJobs,
  initialExcludePrevious,
}: {
  campaigns: Campaign[]
  initialJobs: SearchJob[]
  initialExcludePrevious: boolean
}) {
  const [jobs, setJobs] = useState<SearchJob[]>(initialJobs)
  const [campaignId, setCampaignId] = useState("")
  const [config, setConfig] = useState<SearchConfig>(null)
  const [configLoading, setConfigLoading] = useState(false)
  const [maxResults, setMaxResults] = useState(50)
  const [startPage, setStartPage] = useState(1)
  const [comboOpen, setComboOpen] = useState(false)
  const [excludePrevious, setExcludePrevious] = useState(initialExcludePrevious)
  const [excludedCount, setExcludedCount] = useState<number | null>(null)
  const [isPending, startTransition] = useTransition()
  const [isDeleting, startDeleting] = useTransition()
  const [isTogglingExclude, startToggleExclude] = useTransition()
  const [error, setError] = useState("")

  const selectedCampaign = campaigns.find((c) => c.id === campaignId)

  function handleDeleteJob(id: string) {
    setJobs((prev) => prev.filter((j) => j.id !== id))
    startDeleting(() => deleteSearchJobs([id]))
  }

  function handleClearAll() {
    const ids = jobs.map((j) => j.id)
    setJobs([])
    startDeleting(() => deleteSearchJobs(ids))
  }

  useEffect(() => {
    if (!selectedCampaign) {
      setConfig(null)
      return
    }
    setConfigLoading(true)
    setError("")
    getSearchConfig(selectedCampaign.rep_name, selectedCampaign.industry)
      .then((cfg) => { setConfig(cfg); if (cfg) setStartPage(cfg.current_page) })
      .catch(() => setError("Error cargando configuración"))
      .finally(() => setConfigLoading(false))
  }, [selectedCampaign?.id, selectedCampaign?.rep_name, selectedCampaign?.industry])

  // Load excluded count when toggle is on and campaign selected
  useEffect(() => {
    if (!excludePrevious || !campaignId) { setExcludedCount(null); return }
    getExcludedPreviousCount(campaignId).then(setExcludedCount)
  }, [excludePrevious, campaignId])

  // Poll running jobs every 10s
  useEffect(() => {
    const running = jobs.filter((j) => j.status === "running" || j.status === "pending")
    if (running.length === 0) return

    const interval = setInterval(async () => {
      for (const job of running) {
        const result = await getJobStatus(job.id)
        if (result) {
          setJobs((prev) =>
            prev.map((j) =>
              j.id === job.id
                ? { ...j, status: result.status, results_count: result.results_count }
                : j
            )
          )
        }
      }
    }, 10000)

    return () => clearInterval(interval)
  }, [jobs])

  function handleToggleExcludePrevious() {
    const next = !excludePrevious
    setExcludePrevious(next)
    startToggleExclude(async () => {
      const current = await getInboxConfig()
      await saveInboxConfig({ ...current, exclude_previous: next })
    })
  }

  function handleTrigger() {
    setError("")
    if (!campaignId || !selectedCampaign) { setError("Seleccioná una campaña"); return }
    if (!config) { setError("Configurá la URL de búsqueda primero"); return }

    startTransition(async () => {
      const result = await triggerCompanySearch(
        campaignId,
        selectedCampaign.rep_name,
        selectedCampaign.industry,
        maxResults,
        startPage
      )
      if ("error" in result) {
        setError(result.error)
        return
      }
      const { jobId, extensionUrl } = result
      window.open(extensionUrl, '_blank')
      const newJob: SearchJob = {
        id: jobId,
        campaign_id: campaignId,
        status: "pending",
        sales_nav_url: config.base_url,
        results_count: 0,
        start_page: null,
        created_at: new Date().toISOString(),
        completed_at: null,
        estimated_ready_at: null,
        campaigns: {
          week_label: selectedCampaign.week_label,
          rep_name: selectedCampaign.rep_name,
          industry: selectedCampaign.industry,
        },
      }
      setJobs((prev) => [newJob, ...prev])
    })
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Company Search</h1>
        <p className="mt-0.5 text-sm text-muted-foreground">
          Disparás el scraping desde acá. ProspectOS trackea el progreso y extrae los resultados automáticamente.
        </p>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        {/* Form */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Nueva búsqueda</CardTitle>
            <CardDescription>
              Seleccioná la campaña y elegí cuántas empresas querés scrapear.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-1.5">
              <label className="text-sm font-medium">Campaña</label>
              <Popover open={comboOpen} onOpenChange={setComboOpen}>
                <PopoverTrigger
                  className="flex h-9 w-full items-center justify-between rounded-md border border-input bg-background px-3 py-2 text-sm shadow-xs ring-offset-background hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  {selectedCampaign
                    ? <span>{selectedCampaign.week_label} — <span className="text-muted-foreground">{selectedCampaign.rep_name} / {selectedCampaign.industry}</span></span>
                    : <span className="text-muted-foreground">Seleccionar campaña…</span>}
                  <ChevronsUpDown className="ml-2 size-4 shrink-0 opacity-50" />
                </PopoverTrigger>
                <PopoverContent className="w-[var(--available-width)] p-0" align="start">
                  <Command>
                    <CommandInput placeholder="Buscar por rep, industria, semana…" />
                    <CommandList>
                      <CommandEmpty>Sin resultados.</CommandEmpty>
                      {Object.entries(
                        campaigns.reduce((groups, c) => {
                          if (!groups[c.rep_name]) groups[c.rep_name] = []
                          groups[c.rep_name].push(c)
                          return groups
                        }, {} as Record<string, typeof campaigns>)
                      ).map(([rep, items]) => (
                        <CommandGroup key={rep} heading={rep}>
                          {items.map((c) => (
                            <CommandItem key={c.id} value={`${c.week_label} ${c.rep_name} ${c.industry}`}
                              onSelect={() => { setCampaignId(c.id); setComboOpen(false) }}>
                              <Check className={`mr-2 size-4 ${campaignId === c.id ? "opacity-100" : "opacity-0"}`} />
                              <span>{c.week_label}</span>
                              <span className="ml-2 text-muted-foreground text-xs">{c.industry}</span>
                            </CommandItem>
                          ))}
                        </CommandGroup>
                      ))}
                    </CommandList>
                  </Command>
                </PopoverContent>
              </Popover>
            </div>

            {selectedCampaign && (
              <div className="rounded-lg border bg-muted/30 p-3 space-y-2">
                {configLoading ? (
                  <div className="flex items-center gap-2 text-sm text-muted-foreground">
                    <Loader2 className="size-3.5 animate-spin" />
                    Cargando configuración…
                  </div>
                ) : config ? (
                  <>
                    <div className="flex items-center gap-2 text-sm">
                      <CheckCircle2 className="size-4 text-green-600 shrink-0" />
                      <span className="font-medium">URL configurada</span>
                    </div>
                    <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                      <Link2 className="size-3 shrink-0" />
                      <a
                        href={config.base_url}
                        target="_blank"
                        rel="noreferrer"
                        className="truncate font-mono hover:text-foreground hover:underline transition-colors"
                        title={config.base_url}
                      >
                        {config.base_url.slice(0, 60)}…
                      </a>
                      <Link href="/settings" className="ml-auto shrink-0 text-xs text-muted-foreground hover:text-foreground transition-colors">
                        Cambiar ↗
                      </Link>
                    </div>
                    <div className="flex items-center gap-2 text-xs">
                      <span className="text-muted-foreground">Página de inicio:</span>
                      <input
                        type="number"
                        min={1}
                        value={startPage}
                        onChange={(e) => setStartPage(Math.max(1, parseInt(e.target.value) || 1))}
                        className="w-16 rounded border border-input bg-background px-2 py-0.5 text-xs font-mono text-center focus:outline-none focus:ring-1 focus:ring-ring"
                      />
                      {startPage !== config.current_page && (
                        <button
                          type="button"
                          onClick={() => setStartPage(config.current_page)}
                          className="text-muted-foreground hover:text-foreground transition-colors underline underline-offset-2"
                        >
                          Restaurar ({config.current_page})
                        </button>
                      )}
                    </div>
                  </>
                ) : (
                  <div className="flex items-center gap-2 text-sm text-amber-600">
                    <AlertTriangle className="size-4 shrink-0" />
                    <span>
                      Sin URL de Company Search para <strong>{selectedCampaign.rep_name} / {selectedCampaign.industry}</strong>.{" "}
                      <Link href="/settings" className="underline underline-offset-2 hover:text-amber-800">
                        Configurala en Settings →
                      </Link>
                    </span>
                  </div>
                )}
              </div>
            )}

            <div className="space-y-1.5">
              <label className="text-sm font-medium">Empresas a scrapear</label>
              <div className="flex gap-2">
                {MAX_OPTIONS.map((n) => (
                  <Button
                    key={n}
                    variant={maxResults === n ? "default" : "outline"}
                    size="sm"
                    className="flex-1"
                    onClick={() => setMaxResults(n)}
                  >
                    {n}
                  </Button>
                ))}
              </div>
              {selectedCampaign && config && (
                <p className="text-xs text-muted-foreground">
                  La extensión visita cada perfil · listo en ~{Math.max(1, Math.ceil(maxResults * 2.5 / 60))} min
                </p>
              )}
            </div>

            {/* Exclude previous campaigns toggle */}
            <div className="rounded-lg border p-3 space-y-2">
              <div className="flex items-center justify-between">
                <div className="space-y-0.5">
                  <p className="text-sm font-medium">Excluir campañas anteriores</p>
                  <p className="text-xs text-muted-foreground">
                    Omite empresas ya scraped en otras campañas
                  </p>
                </div>
                <button
                  role="switch"
                  aria-checked={excludePrevious}
                  onClick={handleToggleExcludePrevious}
                  disabled={isTogglingExclude}
                  className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
                    excludePrevious ? "bg-primary" : "bg-input"
                  }`}
                >
                  <span className={`pointer-events-none inline-block h-4 w-4 rounded-full bg-background shadow-lg transform transition-transform ${excludePrevious ? "translate-x-4" : "translate-x-0"}`} />
                </button>
              </div>
              {excludePrevious && campaignId && (
                <p className="text-xs text-muted-foreground">
                  {excludedCount === null
                    ? "Calculando…"
                    : excludedCount === 0
                    ? "No hay empresas de campañas anteriores para excluir"
                    : <><span className="font-medium text-foreground">{excludedCount.toLocaleString()}</span> empresas de campañas anteriores serán excluidas</>
                  }
                </p>
              )}
            </div>

            {error && <p className="text-sm text-destructive">{error}</p>}

            <Button
              className="w-full"
              onClick={handleTrigger}
              disabled={isPending || !config || !campaignId}
            >
              {isPending ? (
                <><Loader2 className="mr-2 size-4 animate-spin" /> Iniciando…</>
              ) : (
                <><Search className="mr-2 size-4" /> Buscar empresas</>
              )}
            </Button>
          </CardContent>
        </Card>

        {/* Jobs history */}
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <div>
                <CardTitle className="text-base">Historial de búsquedas</CardTitle>
                <CardDescription>Últimas 20 búsquedas</CardDescription>
              </div>
              {jobs.length > 0 && (
                <Button variant="ghost" size="sm" className="text-xs text-muted-foreground hover:text-destructive"
                  onClick={handleClearAll} disabled={isDeleting}>
                  <Trash2 className="mr-1.5 size-3.5" />
                  Limpiar todo
                </Button>
              )}
            </div>
          </CardHeader>
          <CardContent>
            {jobs.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-10 text-sm text-muted-foreground">
                <Building2 className="mb-2 size-8 opacity-30" />
                Sin búsquedas todavía
              </div>
            ) : (
              <div className="space-y-2">
                {jobs.map((job) => (
                  <JobCard key={job.id} job={job} onDelete={() => handleDeleteJob(job.id)} />
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
