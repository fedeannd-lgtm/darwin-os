"use client"

import { useState, useTransition } from "react"
import { Loader2, Zap, Tags, CheckCircle2, ChevronsUpDown, Check, AlertTriangle, Search, X, Download, AlertCircle, ExternalLink, ChevronDown, Building2, Star } from "lucide-react"
import type { ProviderStatus } from "../settings/provider-status"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Checkbox } from "@/components/ui/checkbox"
import { Input } from "@/components/ui/input"
import { getCampaigns, getProspectsForEnrichment, enrichOneProspect, classifyAllIcp, enrichPhoneForProspect, setProspectWhatsappPhone, normalizeNamesForCampaign, addToShortlist } from "./actions"
import { calculateOsScore } from "@/lib/scoring"

type Campaign = { id: string; week_label: string; rep_name: string; industry: string; status: string; prospects_found: number | null }
type Prospect = {
  id: string; first_name: string; last_name: string; full_name: string
  job_title: string; company_name: string; company_domain: string | null
  linkedin_url: string; email: string | null; email_status: string | null
  email_provider: string | null; icp_score: number; icp_category: string | null
  os_score: number | null; started_role_months: number | null; phone: string | null; phone_wa: string | null
  apollo_id: string | null; status: string
  accounts: { headcount_range: string | null }[] | null
}

type IcpCategory = "Communication" | "Experience" | "Onboarding" | "Helpdesk" | "Genérico"

const ZB_CFG: Record<string, { label: string; cls: string }> = {
  valid:       { label: "Válido",     cls: "bg-green-50 text-green-700" },
  "catch-all": { label: "Catch-all",  cls: "bg-yellow-50 text-yellow-700" },
  invalid:     { label: "Inválido",   cls: "bg-red-50 text-red-700" },
  unknown:     { label: "Desconocido",cls: "bg-zinc-100 text-zinc-500" },
  spamtrap:    { label: "Spam trap",  cls: "bg-red-50 text-red-700" },
  abuse:       { label: "Abuso",      cls: "bg-red-50 text-red-700" },
  do_not_mail: { label: "No enviar",  cls: "bg-red-50 text-red-700" },
}

const ICP_CFG: Record<string, { cls: string }> = {
  Communication: { cls: "bg-purple-50 text-purple-700" },
  Experience:    { cls: "bg-blue-50 text-blue-700" },
  Onboarding:    { cls: "bg-cyan-50 text-cyan-700" },
  Helpdesk:      { cls: "bg-orange-50 text-orange-700" },
  "Genérico":    { cls: "bg-zinc-100 text-zinc-500" },
}

const PROVIDER_COLS: { key: string; label: string }[] = [
  { key: "apollo",    label: "Apollo"   },
  { key: "findymail", label: "Findy"    },
  { key: "prospeo",   label: "Prospeo"  },
  { key: "hunter",    label: "Hunter"   },
  { key: "datagma",   label: "Datagma"  },
]

function exportCsv(prospects: Prospect[], campaignLabel: string) {
  const esc = (v: string | null | undefined) => `"${(v ?? "").replace(/"/g, '""')}"`
  const headers = ["Nombre", "Apellido", "Nombre completo", "Cargo", "Empresa", "Tamaño", "Dominio", "LinkedIn", "Email", "ZB Status", ...PROVIDER_COLS.map((c) => c.label), "ICP Categoría", "ICP Score", "OS Score", "Estado"]
  const rows = prospects.map((p) => [
    esc(p.first_name), esc(p.last_name), esc(p.full_name),
    esc(p.job_title), esc(p.company_name), esc(p.accounts?.[0]?.headcount_range),
    esc(p.company_domain), esc(p.linkedin_url), esc(p.email), esc(p.email_status),
    ...PROVIDER_COLS.map((c) => p.email_provider === c.key ? "✓" : ""),
    esc(p.icp_category),
    p.icp_score > 0 ? p.icp_score : "",
    getOsScore(p),
    esc(p.status),
  ].join(","))
  const blob = new Blob([[headers.join(","), ...rows].join("\n")], { type: "text/csv;charset=utf-8;" })
  const url = URL.createObjectURL(blob)
  const a = document.createElement("a")
  a.href = url
  a.download = `enriquecimiento-${campaignLabel}-${new Date().toISOString().slice(0, 10)}.csv`
  a.click()
  URL.revokeObjectURL(url)
}

function getOsScore(p: Prospect): number {
  return p.os_score ?? calculateOsScore(p.job_title)
}

function hasValidEmail(p: Prospect) {
  return !!(p.email && (p.email_status === "valid" || p.email_status === "catch-all" || p.email_status === "unknown"))
}

function isClassified(p: Prospect) {
  return !!(p.icp_category)
}

function waLinkFor(phone: string): string | null {
  const digits = phone.replace(/\D/g, "")
  return digits ? `https://wa.me/${digits}` : null
}

function FoundPhoneCell({ prospect, notFound }: { prospect: Prospect; notFound: boolean }) {
  if (!prospect.phone) {
    if (notFound) return <span className="text-[10px] text-amber-600">No encontrado</span>
    return <span className="text-muted-foreground/30 text-[10px]">—</span>
  }
  return (
    <span className="inline-flex items-center gap-1">
      <CheckCircle2 className="size-3 text-green-600 shrink-0" />
      <span className="font-mono text-[10px] text-muted-foreground whitespace-nowrap">{prospect.phone}</span>
    </span>
  )
}

function WhatsappCell({ prospect, onSaved }: { prospect: Prospect; onSaved: (id: string, phoneWa: string | null) => void }) {
  const [value, setValue] = useState(prospect.phone_wa ?? "")
  const [saving, setSaving] = useState(false)

  async function commit(next: string) {
    const trimmed = next.trim()
    if (trimmed === (prospect.phone_wa ?? "")) return
    setSaving(true)
    try {
      await setProspectWhatsappPhone(prospect.id, trimmed)
      onSaved(prospect.id, trimmed || null)
    } finally {
      setSaving(false)
    }
  }

  const waLink = value.trim() ? waLinkFor(value) : null
  const canUseFound = prospect.phone && prospect.phone !== value.trim()

  return (
    <div className="flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
      <input
        className="h-6 w-24 rounded border border-input bg-background px-1.5 text-[10px] font-mono focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
        value={value}
        placeholder="+54911…"
        onChange={(e) => setValue(e.target.value)}
        onBlur={() => commit(value)}
        onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur() }}
      />
      {saving && <Loader2 className="size-3 animate-spin text-muted-foreground shrink-0" />}
      {canUseFound && (
        <button
          type="button"
          title={`Usar teléfono encontrado (${prospect.phone})`}
          onClick={() => { setValue(prospect.phone ?? ""); commit(prospect.phone ?? "") }}
          className="inline-flex items-center justify-center size-5 rounded bg-blue-500/10 text-blue-600 hover:bg-blue-500/20 transition-colors shrink-0 text-[10px]"
        >
          ↙
        </button>
      )}
      {waLink && (
        <a
          href={waLink}
          target="_blank"
          rel="noopener noreferrer"
          title="Abrir WhatsApp"
          className="inline-flex items-center justify-center size-5 rounded bg-green-500/10 text-green-600 hover:bg-green-500/20 transition-colors shrink-0"
        >
          <svg className="size-3" fill="currentColor" viewBox="0 0 24 24">
            <path d="M12.001 2C6.478 2 2 6.477 2 12c0 1.948.555 3.768 1.515 5.31L2 22l4.83-1.488A9.96 9.96 0 0012 22c5.523 0 10-4.477 10-10S17.524 2 12.001 2zm4.566 13.013c-.198.555-1.155 1.06-1.605 1.13-.41.063-.93.09-1.5-.094a3.66 3.66 0 01-.34-.106c-.6-.213-1.41-.5-2.547-1.378-1.93-1.487-3.187-3.317-3.486-3.879-.298-.562-.025-.866.225-1.14.222-.243.495-.45.66-.6.165-.15.22-.255.33-.42.11-.166.055-.31-.027-.434-.083-.124-.745-1.793-1.022-2.456-.27-.645-.544-.557-.745-.567-.193-.01-.413-.011-.633-.011-.22 0-.578.083-.88.413-.302.33-1.155 1.13-1.155 2.756 0 1.626 1.182 3.198 1.348 3.418.166.22 2.331 3.56 5.65 4.99.79.34 1.404.544 1.884.696.792.252 1.512.216 2.082.131.635-.095 1.955-.8 2.231-1.572.276-.773.276-1.434.193-1.572-.083-.138-.303-.22-.633-.385z"/>
          </svg>
        </a>
      )}
    </div>
  )
}

function MultiFilter<T extends string>({
  label, options, value, onChange, className,
}: {
  label: string
  options: { value: T; label: string }[]
  value: Set<T>
  onChange: (next: Set<T>) => void
  className?: string
}) {
  const selected = options.filter(o => value.has(o.value))
  const displayLabel = selected.length === 0
    ? label
    : selected.length === 1 ? selected[0].label : `${selected.length} selec.`

  function toggle(v: T) {
    const next = new Set(value)
    if (next.has(v)) next.delete(v)
    else next.add(v)
    onChange(next)
  }

  return (
    <Popover>
      <PopoverTrigger className={`inline-flex h-8 items-center justify-between rounded-md border border-input bg-background px-2.5 text-xs gap-1.5 hover:bg-accent transition-colors ${selected.length > 0 ? "border-primary/50 bg-primary/5 font-medium" : "text-muted-foreground"} ${className ?? ""}`}>
        {displayLabel}
        <ChevronDown className="size-3 opacity-50 shrink-0" />
      </PopoverTrigger>
      <PopoverContent className="w-44 p-1" align="start">
        {options.map(o => (
          <button key={o.value} onClick={() => toggle(o.value)}
            className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-xs hover:bg-accent transition-colors">
            <div className={`size-3.5 rounded-sm border flex items-center justify-center shrink-0 transition-colors ${value.has(o.value) ? "bg-primary border-primary" : "border-input"}`}>
              {value.has(o.value) && <Check className="size-2.5 text-primary-foreground" />}
            </div>
            {o.label}
          </button>
        ))}
        {value.size > 0 && (
          <>
            <div className="mx-2 my-1 border-t" />
            <button onClick={() => onChange(new Set())}
              className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-xs text-muted-foreground hover:bg-accent transition-colors">
              <X className="size-3" /> Limpiar
            </button>
          </>
        )}
      </PopoverContent>
    </Popover>
  )
}

export function EnrichmentClient({ campaigns, providerStatus }: { campaigns: Campaign[]; providerStatus: ProviderStatus[] }) {
  const [campaignId, setCampaignId] = useState("")
  const [comboOpen, setComboOpen] = useState(false)
  const [prospects, setProspects] = useState<Prospect[]>([])
  const [loadingProspects, setLoadingProspects] = useState(false)
  const [error, setError] = useState("")

  // ICP classification state
  const [classifying, setClassifying] = useState(false)
  const [classifyProgress, setClassifyProgress] = useState({ done: 0, total: 0 })

  // Filter state
  const [search, setSearch] = useState("")
  const [scoreFilter, setScoreFilter] = useState<Set<"gte5" | "eq10" | "eq0">>(new Set())
  const [osScoreFilter, setOsScoreFilter] = useState<Set<"tier1" | "tier2" | "tier3" | "non_icp">>(new Set())
  const [categoryFilter, setCategoryFilter] = useState<Set<IcpCategory>>(new Set())
  const [emailFilter, setEmailFilter] = useState<"all" | "pending" | "enriched">("all")
  const [mesInicioFilter, setMesInicioFilter] = useState<"all" | "con" | "sin">("all")

  // Selection state
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())

  // Enrichment state
  const [enriching, setEnriching] = useState(false)
  const [enrichProgress, setEnrichProgress] = useState({ done: 0, total: 0 })
  const [rowStatus, setRowStatus] = useState<Map<string, "enriching" | "found" | "not_found" | "error">>(new Map())

  // Phone enrichment state
  const [enrichingPhone, setEnrichingPhone] = useState(false)
  const [phoneProgress, setPhoneProgress] = useState({ done: 0, total: 0 })
  const [phoneNotFoundIds, setPhoneNotFoundIds] = useState<Set<string>>(new Set())

  // Normalize company names state
  const [normalizing, setNormalizing] = useState(false)
  const [normalizeResult, setNormalizeResult] = useState<number | null>(null)

  // Shortlist state
  const [shortlisting, startShortlist] = useTransition()
  const [shortlistDone, setShortlistDone] = useState(false)

  const selectedCampaign = campaigns.find((c) => c.id === campaignId)

  async function loadProspects(id: string) {
    setLoadingProspects(true)
    setSelectedIds(new Set())
    setError("")
    try {
      const data = await getProspectsForEnrichment(id) as Prospect[]
      setProspects(data)
      const initial = new Map<string, "enriching" | "found" | "not_found" | "error">()
      for (const p of data) {
        if (p.status === "not_found") initial.set(p.id, "not_found")
        else if (p.status === "enriched" && p.email) initial.set(p.id, "found")
      }
      setRowStatus(initial)
    } catch {
      setError("Error cargando prospectos")
    } finally {
      setLoadingProspects(false)
    }
  }

  // Derived counts
  const withEmail = prospects.filter(hasValidEmail).length
  const unclassified = prospects.filter((p) => !isClassified(p)).length

  // Filtered prospects
  const filtered = prospects.filter((p) => {
    if (search) {
      const q = search.toLowerCase()
      if (
        !p.full_name?.toLowerCase().includes(q) &&
        !p.company_name?.toLowerCase().includes(q) &&
        !p.job_title?.toLowerCase().includes(q)
      ) return false
    }
    if (scoreFilter.size > 0) {
      const s = p.icp_score ?? 0
      if (!(
        (scoreFilter.has("gte5") && s >= 5) ||
        (scoreFilter.has("eq10") && s === 10) ||
        (scoreFilter.has("eq0") && s === 0)
      )) return false
    }
    if (osScoreFilter.size > 0) {
      const os = getOsScore(p)
      if (!(
        (osScoreFilter.has("tier1") && os >= 10) ||
        (osScoreFilter.has("tier2") && os === 7) ||
        (osScoreFilter.has("tier3") && os === 4) ||
        (osScoreFilter.has("non_icp") && os <= 3)
      )) return false
    }
    if (categoryFilter.size > 0 && !categoryFilter.has(p.icp_category as IcpCategory)) return false
    if (emailFilter === "pending" && hasValidEmail(p)) return false
    if (emailFilter === "enriched" && !hasValidEmail(p)) return false
    if (mesInicioFilter === "con" && p.started_role_months == null) return false
    if (mesInicioFilter === "sin" && p.started_role_months != null) return false
    return true
  })

  const allFilteredSelected = filtered.length > 0 && filtered.every((p) => selectedIds.has(p.id))

  function toggleSelectAll() {
    if (allFilteredSelected) {
      // Deselect all visible
      setSelectedIds((prev) => {
        const next = new Set(prev)
        filtered.forEach((p) => next.delete(p.id))
        return next
      })
    } else {
      // Replace selection with only visible items (not additive)
      setSelectedIds(new Set(filtered.map((p) => p.id)))
    }
  }

  function toggleOne(id: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  async function handleClassifyIcp() {
    if (!campaignId) return
    setClassifying(true)
    setClassifyProgress({ done: 0, total: prospects.length })
    try {
      // Batch classify on server — returns count
      await classifyAllIcp(campaignId)
      // Reload to get updated values
      const data = await getProspectsForEnrichment(campaignId)
      setProspects(data as Prospect[])
      setClassifyProgress({ done: prospects.length, total: prospects.length })
    } catch {
      setError("Error al clasificar ICP")
    } finally {
      setClassifying(false)
    }
  }

  async function handleEnrichSelected() {
    const toEnrich = [...selectedIds].filter((id) => {
      const p = prospects.find((x) => x.id === id)
      return p && !hasValidEmail(p)
    })
    if (!toEnrich.length) return

    setEnriching(true)
    setError("")
    setEnrichProgress({ done: 0, total: toEnrich.length })

    for (let i = 0; i < toEnrich.length; i++) {
      const id = toEnrich[i]
      setRowStatus((prev) => new Map(prev).set(id, "enriching"))
      try {
        const result = await enrichOneProspect(id)
        setProspects((prev) =>
          prev.map((x) => {
            if (x.id !== id) return x
            if (result.email) {
              // Email found — update everything
              return { ...x, email: result.email, email_status: result.zbStatus, email_provider: result.provider, icp_category: result.icpCategory, icp_score: result.icpScore, os_score: result.osScore, apollo_id: result.apolloId ?? x.apollo_id, status: "enriched" }
            } else {
              // Not found — only update apollo_id and status, preserve existing ICP/email data
              return { ...x, apollo_id: result.apolloId ?? x.apollo_id, status: "not_found" }
            }
          })
        )
        setRowStatus((prev) => new Map(prev).set(id, result.email ? "found" : "not_found"))
      } catch {
        setRowStatus((prev) => new Map(prev).set(id, "error"))
      }
      setEnrichProgress({ done: i + 1, total: toEnrich.length })
    }

    setEnriching(false)
  }

  const withoutPhone = prospects.filter((p) => !p.phone).length

  async function handleEnrichPhones() {
    const toEnrich = [...selectedIds]
    if (!toEnrich.length) return
    setEnrichingPhone(true)
    setError("")
    setPhoneProgress({ done: 0, total: toEnrich.length })
    for (let i = 0; i < toEnrich.length; i++) {
      const id = toEnrich[i]
      try {
        const phone = await enrichPhoneForProspect(id)
        setProspects((prev) => prev.map((x) => x.id === id ? { ...x, phone, phone_wa: x.phone_wa || phone } : x))
        if (!phone) setPhoneNotFoundIds((prev) => new Set(prev).add(id))
      } catch { /* continue */ }
      setPhoneProgress({ done: i + 1, total: toEnrich.length })
    }
    setEnrichingPhone(false)
  }

  const selectedPending = [...selectedIds].filter((id) => {
    const p = prospects.find((x) => x.id === id)
    return p && !hasValidEmail(p)
  }).length

  async function handleNormalizeCompanyNames() {
    if (!campaignId) return
    setNormalizing(true)
    setNormalizeResult(null)
    try {
      const count = await normalizeNamesForCampaign(campaignId)
      setNormalizeResult(count)
      if (count > 0) {
        const data = await getProspectsForEnrichment(campaignId)
        setProspects(data as Prospect[])
      }
    } catch {
      setError("Error al normalizar nombres")
    } finally {
      setNormalizing(false)
    }
  }

  const problemProviders = providerStatus.filter((p) => p.status === "out" || p.status === "error")

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Enriquecimiento</h1>
        <p className="mt-0.5 text-sm text-muted-foreground">
          Apollo → FindyEmail → Prospeo → Hunter → Datagma · validado con ZeroBounce.
        </p>
      </div>

      {problemProviders.length > 0 && (
        <div className="flex items-start gap-3 rounded-lg border border-yellow-200 bg-yellow-50 px-4 py-3 text-sm text-yellow-800">
          <AlertCircle className="mt-0.5 size-4 shrink-0 text-yellow-600" />
          <div>
            <span className="font-medium">Providers con problemas: </span>
            {problemProviders.map((p) => `${p.label} (${p.detail})`).join(", ")}.
            {" "}El enriquecimiento sigue corriendo con los demás providers.
            {" "}<a href="/settings" className="underline font-medium">Ver estado completo →</a>
          </div>
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-[280px_1fr]">
        {/* Left panel */}
        <div className="space-y-3">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-medium">Campaña</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <Popover open={comboOpen} onOpenChange={setComboOpen}>
                <PopoverTrigger className="flex h-9 w-full items-center justify-between rounded-md border border-input bg-background px-3 py-2 text-sm shadow-xs hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                  {selectedCampaign
                    ? <span className="truncate">{selectedCampaign.week_label} — {selectedCampaign.rep_name}</span>
                    : <span className="text-muted-foreground">Seleccionar campaña…</span>}
                  <ChevronsUpDown className="ml-2 size-4 shrink-0 opacity-50" />
                </PopoverTrigger>
                <PopoverContent className="w-72 p-0" align="start">
                  <Command>
                    <CommandInput placeholder="Buscar…" />
                    <CommandList>
                      <CommandEmpty>Sin resultados.</CommandEmpty>
                      {Object.entries(
                        campaigns.reduce((g, c) => { if (!g[c.rep_name]) g[c.rep_name] = []; g[c.rep_name].push(c); return g }, {} as Record<string, Campaign[]>)
                      ).map(([rep, items]) => (
                        <CommandGroup key={rep} heading={rep}>
                          {items.map((c) => (
                            <CommandItem key={c.id} value={`${c.week_label} ${c.rep_name} ${c.industry}`}
                              onSelect={() => { setCampaignId(c.id); setComboOpen(false); loadProspects(c.id) }}>
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

              {prospects.length > 0 && (
                <div className="rounded-lg border divide-y text-sm">
                  <div className="flex justify-between px-3 py-1.5">
                    <span className="text-muted-foreground">Total</span>
                    <span className="font-medium">{prospects.length}</span>
                  </div>
                  <div className="flex justify-between px-3 py-1.5">
                    <span className="text-muted-foreground">Con email</span>
                    <span className="font-medium text-green-700">{withEmail}</span>
                  </div>
                  <div className="flex justify-between px-3 py-1.5">
                    <span className="text-muted-foreground">Sin clasificar</span>
                    <span className="font-medium text-amber-600">{unclassified}</span>
                  </div>
                  <div className="flex justify-between px-3 py-1.5">
                    <span className="text-muted-foreground">Seleccionados</span>
                    <span className="font-medium text-primary">{selectedIds.size}</span>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Classify ICP */}
          <Card>
            <CardContent className="pt-4 space-y-2">
              <Button
                variant="outline"
                className="w-full"
                onClick={handleClassifyIcp}
                disabled={!campaignId || loadingProspects || classifying || enriching}
              >
                {classifying
                  ? <><Loader2 className="mr-2 size-4 animate-spin" />Clasificando…</>
                  : <><Tags className="mr-2 size-4" />Clasificar ICP{unclassified > 0 ? ` (${unclassified})` : ""}</>}
              </Button>
              {classifying && (
                <div className="space-y-1">
                  <div className="h-1.5 rounded-full bg-muted overflow-hidden">
                    <div className="h-full bg-blue-500 transition-all" style={{ width: `${classifyProgress.total ? (classifyProgress.done / classifyProgress.total) * 100 : 0}%` }} />
                  </div>
                </div>
              )}
              <p className="text-[11px] text-muted-foreground">Clasifica sin consumir créditos de email.</p>
            </CardContent>
          </Card>

          {/* Enrich selected */}
          <Card>
            <CardContent className="pt-4 space-y-2">
              <Button
                className="w-full"
                onClick={handleEnrichSelected}
                disabled={!campaignId || loadingProspects || enriching || classifying || selectedPending === 0}
              >
                {enriching
                  ? <><Loader2 className="mr-2 size-4 animate-spin" />{enrichProgress.done}/{enrichProgress.total}</>
                  : <><Zap className="mr-2 size-4" />Enriquecer seleccionados{selectedPending > 0 ? ` (${selectedPending})` : ""}</>}
              </Button>
              {enriching && (
                <div className="h-1.5 rounded-full bg-muted overflow-hidden">
                  <div className="h-full bg-primary transition-all" style={{ width: `${enrichProgress.total ? (enrichProgress.done / enrichProgress.total) * 100 : 0}%` }} />
                </div>
              )}
              <p className="text-[11px] text-muted-foreground">Solo prospectos seleccionados sin email válido.</p>
            </CardContent>
          </Card>

          {/* Enrich phones */}
          <Card>
            <CardContent className="pt-4 space-y-2">
              <Button
                variant="outline"
                className="w-full"
                onClick={handleEnrichPhones}
                disabled={!campaignId || loadingProspects || enriching || enrichingPhone || classifying || selectedIds.size === 0}
              >
                {enrichingPhone
                  ? <><Loader2 className="mr-2 size-4 animate-spin" />{phoneProgress.done}/{phoneProgress.total}</>
                  : <><svg className="mr-2 size-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M3 5a2 2 0 012-2h3.28a1 1 0 01.948.684l1.498 4.493a1 1 0 01-.502 1.21l-2.257 1.13a11.042 11.042 0 005.516 5.516l1.13-2.257a1 1 0 011.21-.502l4.493 1.498a1 1 0 01.684.949V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 6V5z" /></svg>
                  Enriquecer teléfonos{selectedIds.size > 0 ? ` (${selectedIds.size})` : ""}</>}
              </Button>
              {enrichingPhone && (
                <div className="h-1.5 rounded-full bg-muted overflow-hidden">
                  <div className="h-full bg-blue-500 transition-all" style={{ width: `${phoneProgress.total ? (phoneProgress.done / phoneProgress.total) * 100 : 0}%` }} />
                </div>
              )}
              <p className="text-[11px] text-muted-foreground">Seleccioná prospectos antes de enriquecer teléfonos.</p>
            </CardContent>
          </Card>

          {/* Normalize company names */}
          <Card>
            <CardContent className="pt-4 space-y-2">
              <Button
                variant="outline"
                className="w-full"
                onClick={handleNormalizeCompanyNames}
                disabled={!campaignId || loadingProspects || normalizing || enriching || classifying}
              >
                {normalizing
                  ? <><Loader2 className="mr-2 size-4 animate-spin" />Normalizando…</>
                  : <><Building2 className="mr-2 size-4" />Normalizar nombres</>}
              </Button>
              {normalizeResult !== null && (
                <p className="text-[11px] text-green-700">
                  {normalizeResult === 0 ? "Sin cambios necesarios." : `${normalizeResult} nombre${normalizeResult !== 1 ? "s" : ""} actualizados.`}
                </p>
              )}
              <p className="text-[11px] text-muted-foreground">Capitaliza nombres de personas y quita S.A., SAC, SRL, Argentina, etc. de empresas.</p>
            </CardContent>
          </Card>

          {/* Shortlist */}
          <Card>
            <CardContent className="pt-4 space-y-2">
              <Button
                variant="outline"
                className="w-full"
                onClick={() => {
                  setShortlistDone(false)
                  startShortlist(async () => {
                    await addToShortlist([...selectedIds])
                    setShortlistDone(true)
                  })
                }}
                disabled={!campaignId || loadingProspects || shortlisting || selectedIds.size === 0}
              >
                {shortlisting
                  ? <><Loader2 className="mr-2 size-4 animate-spin" />Agregando…</>
                  : <><Star className="mr-2 size-4" />Shortlist{selectedIds.size > 0 ? ` (${selectedIds.size})` : ""}</>}
              </Button>
              {shortlistDone && (
                <p className="text-[11px] text-green-700">Agregados a Shortlist.</p>
              )}
              <p className="text-[11px] text-muted-foreground">Lleva prospectos seleccionados a Shortlist para generar secuencias con IA.</p>
            </CardContent>
          </Card>

          {error && (
            <div className="flex items-center gap-2 rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
              <AlertTriangle className="size-4 shrink-0" />
              {error}
            </div>
          )}
        </div>

        {/* Right panel */}
        <Card className="flex flex-col">
          {/* Filter bar */}
          <div className="border-b px-4 py-3 flex flex-wrap gap-2 items-center">
            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 size-3.5 text-muted-foreground" />
              <Input
                placeholder="Buscar nombre, empresa, cargo…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="h-8 pl-7 text-xs w-56"
              />
              {search && (
                <button onClick={() => setSearch("")} className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground">
                  <X className="size-3" />
                </button>
              )}
            </div>

            <MultiFilter
              label="Score ICP"
              options={[
                { value: "gte5", label: "Score ≥ 5" },
                { value: "eq10", label: "Score = 10" },
                { value: "eq0",  label: "Score = 0" },
              ]}
              value={scoreFilter}
              onChange={setScoreFilter}
              className="w-32"
            />

            <MultiFilter
              label="OS Score"
              options={[
                { value: "tier1",   label: "Tier 1 (OS = 10)" },
                { value: "tier2",   label: "Tier 2 (OS = 7)" },
                { value: "tier3",   label: "Tier 3 (OS = 4)" },
                { value: "non_icp", label: "No ICP (OS ≤ 3)" },
              ]}
              value={osScoreFilter}
              onChange={setOsScoreFilter}
              className="w-36"
            />

            <MultiFilter
              label="Categoría"
              options={[
                { value: "Communication", label: "Communication" },
                { value: "Experience",    label: "Experience" },
                { value: "Onboarding",    label: "Onboarding" },
                { value: "Helpdesk",      label: "Helpdesk" },
                { value: "Genérico",      label: "Genérico" },
              ]}
              value={categoryFilter}
              onChange={setCategoryFilter}
              className="w-36"
            />

            <Select value={emailFilter} onValueChange={(v) => setEmailFilter(v as typeof emailFilter)}>
              <SelectTrigger className="h-8 text-xs w-36">
                <SelectValue placeholder="Email" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todos</SelectItem>
                <SelectItem value="pending">Sin email</SelectItem>
                <SelectItem value="enriched">Con email</SelectItem>
              </SelectContent>
            </Select>

            <Select value={mesInicioFilter} onValueChange={(v) => setMesInicioFilter(v as typeof mesInicioFilter)}>
              <SelectTrigger className="h-8 text-xs w-36">
                <SelectValue placeholder="Mes inicio" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todos</SelectItem>
                <SelectItem value="con">Con mes inicio</SelectItem>
                <SelectItem value="sin">Sin mes inicio</SelectItem>
              </SelectContent>
            </Select>

            <span className="ml-auto text-xs text-muted-foreground">{filtered.length} visibles</span>
            {filtered.length > 0 && (
              <Button variant="outline" size="sm" className="h-8 text-xs" onClick={() => exportCsv(filtered, selectedCampaign?.week_label ?? "campaña")}>
                <Download className="mr-1.5 size-3" /> Exportar CSV
              </Button>
            )}
          </div>

          {/* Table */}
          <div className="flex-1 overflow-x-auto">
            {loadingProspects ? (
              <div className="flex items-center justify-center py-16">
                <Loader2 className="size-5 animate-spin text-muted-foreground" />
              </div>
            ) : prospects.length === 0 ? (
              <div className="flex items-center justify-center py-16 text-sm text-muted-foreground">
                Seleccioná una campaña para ver los prospectos
              </div>
            ) : filtered.length === 0 ? (
              <div className="flex items-center justify-center py-12 text-sm text-muted-foreground">
                Ningún prospecto coincide con los filtros
              </div>
            ) : (
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b bg-muted/50">
                    <th className="px-3 py-2.5 w-8">
                      <Checkbox
                        checked={allFilteredSelected}
                        onCheckedChange={toggleSelectAll}
                        aria-label="Seleccionar todos"
                      />
                    </th>
                    <th className="px-3 py-2.5 text-left font-medium text-muted-foreground">Nombre</th>
                    <th className="px-3 py-2.5 text-left font-medium text-muted-foreground">Cargo</th>
                    <th className="px-3 py-2.5 text-left font-medium text-muted-foreground">Empresa</th>
                    <th className="px-3 py-2.5 text-left font-medium text-muted-foreground">Dominio</th>
                    <th className="px-3 py-2.5 text-left font-medium text-muted-foreground">Tamaño</th>
                    <th className="px-3 py-2.5 text-left font-medium text-muted-foreground">ICP</th>
                    <th className="px-3 py-2.5 text-center font-medium text-muted-foreground">Score</th>
                    <th className="px-3 py-2.5 text-center font-medium text-muted-foreground">OS</th>
                    <th className="px-3 py-2.5 text-center font-medium text-muted-foreground">LI</th>
                    <th className="px-3 py-2.5 text-center font-medium text-muted-foreground">Apollo</th>
                    <th className="px-3 py-2.5 text-left font-medium text-muted-foreground">Tel. encontrado</th>
                    <th className="px-3 py-2.5 text-left font-medium text-muted-foreground">WhatsApp</th>
                    <th className="px-3 py-2.5 text-left font-medium text-muted-foreground">Email</th>
                    <th className="px-3 py-2.5 text-left font-medium text-muted-foreground">ZB</th>
                    {PROVIDER_COLS.map((c) => (
                      <th key={c.key} className="px-2 py-2.5 text-center font-medium text-muted-foreground w-14">{c.label}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((p) => {
                    const zb = p.email_status ? ZB_CFG[p.email_status] : null
                    const icp = p.icp_category ? ICP_CFG[p.icp_category] ?? ICP_CFG["Genérico"] : null
                    const valid = hasValidEmail(p)
                    return (
                      <tr
                        key={p.id}
                        className={`border-b last:border-0 hover:bg-muted/30 cursor-pointer ${selectedIds.has(p.id) ? "bg-primary/5" : ""}`}
                        onClick={() => toggleOne(p.id)}
                      >
                        <td className="px-3 py-2" onClick={(e) => e.stopPropagation()}>
                          <Checkbox
                            checked={selectedIds.has(p.id)}
                            onCheckedChange={() => toggleOne(p.id)}
                          />
                        </td>
                        <td className="px-3 py-2">
                          <div className="flex items-center gap-1.5">
                            {valid
                              ? <CheckCircle2 className="size-3 text-green-600 shrink-0" />
                              : <div className="size-3 rounded-full border border-muted-foreground/30 shrink-0" />}
                            <span className="truncate max-w-[130px]">{p.full_name || "—"}</span>
                          </div>
                        </td>
                        <td className="px-3 py-2 text-muted-foreground max-w-[140px] truncate">{p.job_title || "—"}</td>
                        <td className="px-3 py-2 text-muted-foreground max-w-[120px] truncate">{p.company_name || "—"}</td>
                        <td className="px-3 py-2 text-muted-foreground text-[11px] max-w-[120px] truncate">{p.company_domain || "—"}</td>
                        <td className="px-3 py-2 text-muted-foreground text-[10px] whitespace-nowrap">{p.accounts?.[0]?.headcount_range || "—"}</td>
                        <td className="px-3 py-2">
                          {icp ? (
                            <span className={`inline-flex rounded-full px-1.5 py-0.5 text-[10px] font-medium ${icp.cls}`}>
                              {p.icp_category}
                            </span>
                          ) : "—"}
                        </td>
                        <td className="px-3 py-2 font-medium text-center">
                          {p.icp_score > 0 ? p.icp_score : p.icp_category ? "0" : "—"}
                        </td>
                        <td className="px-3 py-2 text-center">
                          {(() => { const s = getOsScore(p); return (
                            <span className={`inline-flex rounded-full px-1.5 py-0.5 text-[10px] font-medium ${
                              s === 10 ? "bg-emerald-50 text-emerald-700" :
                              s === 7  ? "bg-blue-50 text-blue-700" :
                              s >= 4   ? "bg-yellow-50 text-yellow-700" :
                              s > 0    ? "bg-zinc-100 text-zinc-500" :
                                         "bg-zinc-50 text-zinc-400"
                            }`}>{s}</span>
                          ); })()}
                        </td>
                        <td className="px-3 py-2 text-center">
                          {p.linkedin_url ? (
                            <a href={p.linkedin_url} target="_blank" rel="noopener noreferrer" onClick={(e) => e.stopPropagation()}
                              className="inline-flex items-center justify-center size-5 rounded bg-[#0A66C2]/10 text-[#0A66C2] hover:bg-[#0A66C2]/20 transition-colors">
                              <svg className="size-3" fill="currentColor" viewBox="0 0 24 24"><path d="M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433a2.062 2.062 0 01-2.063-2.065 2.064 2.064 0 112.063 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z"/></svg>
                            </a>
                          ) : <span className="text-muted-foreground/30 text-[10px]">—</span>}
                        </td>
                        <td className="px-3 py-2 text-center">
                          {p.apollo_id ? (
                            <a href={`https://app.apollo.io/#/people/${p.apollo_id}`} target="_blank" rel="noopener noreferrer" onClick={(e) => e.stopPropagation()}
                              className="inline-flex items-center justify-center size-5 rounded bg-indigo-500/10 text-indigo-600 hover:bg-indigo-500/20 transition-colors">
                              <ExternalLink className="size-3" />
                            </a>
                          ) : <span className="text-muted-foreground/30 text-[10px]">—</span>}
                        </td>
                        <td className="px-3 py-2">
                          <FoundPhoneCell prospect={p} notFound={phoneNotFoundIds.has(p.id)} />
                        </td>
                        <td className="px-3 py-2">
                          <WhatsappCell
                            key={`${p.id}-${p.phone_wa ?? ""}`}
                            prospect={p}
                            onSaved={(id, phoneWa) => setProspects((prev) => prev.map((x) => x.id === id ? { ...x, phone_wa: phoneWa } : x))}
                          />
                        </td>
                        <td className="px-3 py-2 max-w-[160px]">
                          {rowStatus.get(p.id) === "enriching" ? (
                            <span className="flex items-center gap-1 text-xs text-muted-foreground">
                              <Loader2 className="size-3 animate-spin" /> Buscando…
                            </span>
                          ) : rowStatus.get(p.id) === "not_found" ? (
                            <span className="inline-flex rounded-full px-1.5 py-0.5 text-[10px] font-medium bg-zinc-100 text-zinc-500">No encontrado</span>
                          ) : rowStatus.get(p.id) === "error" ? (
                            <span className="inline-flex rounded-full px-1.5 py-0.5 text-[10px] font-medium bg-red-50 text-red-600">Error</span>
                          ) : p.email ? (
                            <span className="font-mono text-[10px] text-muted-foreground truncate block">{p.email}</span>
                          ) : (
                            <span className="text-muted-foreground">—</span>
                          )}
                        </td>
                        <td className="px-3 py-2">
                          {zb ? (
                            <span className={`inline-flex rounded-full px-1.5 py-0.5 text-[10px] font-medium ${zb.cls}`}>
                              {zb.label}
                            </span>
                          ) : "—"}
                        </td>
                        {PROVIDER_COLS.map((c) => (
                          <td key={c.key} className="px-2 py-2 text-center">
                            {p.email_provider === c.key ? (
                              <span className="inline-flex items-center justify-center size-5 rounded-full bg-green-100 text-green-700">
                                <Check className="size-3" />
                              </span>
                            ) : rowStatus.get(p.id) === "enriching" ? (
                              <span className="text-muted-foreground/30 text-[10px]">·</span>
                            ) : (
                              <span className="text-muted-foreground/30 text-[10px]">—</span>
                            )}
                          </td>
                        ))}
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            )}
          </div>
        </Card>
      </div>
    </div>
  )
}
