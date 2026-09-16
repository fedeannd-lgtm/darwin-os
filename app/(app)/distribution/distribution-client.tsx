"use client"

import { useState, useTransition, useEffect } from "react"
import { cn } from "@/lib/utils"
import { Plus, Play, Copy, Trash2, ChevronUp, ChevronDown, X, Loader2, CheckCircle2, AlertCircle, RotateCcw, Eye } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { Command, CommandEmpty, CommandInput, CommandItem, CommandList } from "@/components/ui/command"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet"
import { Badge } from "@/components/ui/badge"
import type { DistributionTemplate, DistributionRoute, Condition, ConditionGroup, DistributionRun, RunResults } from "./actions"
import type { IntegrationCampaign, RoutePreviewResult } from "./actions"
import { saveTemplate, cloneTemplate, deleteTemplate, runDistribution, getRunsForTemplate, previewDistribution, getTemplates, loadIntegrationCampaigns, previewDistributionRoutes } from "./actions"

// ─── Condition formatter ──────────────────────────────────────────────────────

const FIELD_LABELS: Record<string, string> = {
  has_email: "Tiene email", email_status: "Estado email", icp_score: "ICP Score",
  os_score: "OS Score", icp_category: "Categoría", is_premium: "Premium", connection_degree: "Grado",
  started_role_months: "Mes inicio", shortlisted: "En shortlist",
}
const OP_LABELS: Record<string, string> = { eq: "=", neq: "≠", gte: "≥", lte: "≤" }
const VALUE_LABELS: Record<string, Record<string, string>> = {
  has_email: { true: "Sí", false: "No" },
  is_premium: { true: "Sí", false: "No" },
  shortlisted: { true: "Sí", false: "No" },
  connection_degree: { FIRST: "1°", SECOND: "2°", THIRD: "3°" },
  email_status: { valid: "Válido", "catch-all": "Catch-all", invalid: "Inválido", unknown: "Desconocido" },
}

function formatCondition(c: Condition): string {
  const field = FIELD_LABELS[c.field] ?? c.field
  const op = OP_LABELS[c.operator] ?? c.operator
  const val = VALUE_LABELS[c.field]?.[c.value] ?? c.value
  return `${field} ${op} ${val}`
}

// ─── RouteFlowPreview ─────────────────────────────────────────────────────────

function RouteFlowPreview({ routes, campaigns, integrationCampaigns }: {
  routes: DistributionRoute[]
  campaigns: { id: string; week_label: string; rep_name: string; industry: string; prospects_found: number | null }[]
  integrationCampaigns: { smartlead: IntegrationCampaign[]; heyreach: IntegrationCampaign[] } | null
}) {
  const [campaignId, setCampaignId] = useState("")
  const [preview, setPreview] = useState<RoutePreviewResult | null>(null)
  const [loading, startLoad] = useTransition()

  function handleCampaignChange(id: string | null) {
    if (!id) return
    setCampaignId(id)
    setPreview(null)
    startLoad(async () => {
      const result = await previewDistributionRoutes(routes, id)
      setPreview(result)
    })
  }

  const countMap = Object.fromEntries((preview?.perRoute ?? []).map((r) => [r.routeId, r]))
  const available = preview ? preview.total - preview.alreadySent : null
  const totalMatched = preview
    ? new Set(
        routes.flatMap((route) => {
          const c = countMap[route.id]
          return c ? [`${route.id}`] : []
        })
      ).size
    : null
  const unmatched = available != null && preview
    ? Math.max(0, available - (preview.perRoute.reduce((sum, r) => {
        // rough: if routes can overlap we can't subtract; just show per-route counts
        return sum
      }, 0)))
    : null

  const slName = (id: string | null) =>
    id ? (integrationCampaigns?.smartlead.find((c) => c.id === id)?.name ?? `ID: ${id}`) : null
  const hrName = (id: string | null) =>
    id ? (integrationCampaigns?.heyreach.find((c) => c.id === id)?.name ?? `ID: ${id}`) : null

  return (
    <div className="flex flex-col h-full">
      {/* Campaign selector */}
      <div className="pb-4 border-b space-y-3">
        <p className="text-xs text-muted-foreground">Seleccioná una campaña para ver cuántos perfiles matchearían cada ruta.</p>
        <Select value={campaignId} onValueChange={handleCampaignChange}>
          <SelectTrigger className="text-xs">
            <SelectValue placeholder="Elegí una campaña..." />
          </SelectTrigger>
          <SelectContent>
            {campaigns.map((c) => (
              <SelectItem key={c.id} value={c.id} className="text-xs">
                {c.week_label} · {c.rep_name} · {c.industry}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        {preview && (
          <div className="flex gap-4 text-xs">
            <span><span className="text-muted-foreground">Total:</span> <strong>{preview.total}</strong></span>
            <span><span className="text-muted-foreground">Ya enviados:</span> <strong>{preview.alreadySent}</strong></span>
            <span><span className="text-muted-foreground">Disponibles:</span> <strong>{available}</strong></span>
          </div>
        )}
      </div>

      {/* Flow */}
      <div className="flex-1 overflow-y-auto pt-4">
        {routes.length === 0 ? (
          <p className="text-sm text-muted-foreground text-center py-8">Sin rutas configuradas.</p>
        ) : (
          <div className="flex flex-col items-stretch gap-0">
            {/* Start node */}
            <div className="flex justify-center">
              <div className="bg-muted/50 border rounded-full px-4 py-1 text-[11px] font-semibold text-muted-foreground">
                {available != null ? `${available} perfiles disponibles` : "INICIO"}
              </div>
            </div>

            {routes.map((route, i) => {
              const count = countMap[route.id]
              const hasCount = !!count
              const sl = slName(route.smartlead_campaign_id)
              const hr = hrName(route.heyreach_campaign_id)
              return (
                <div key={route.id} className="flex flex-col items-center">
                  {/* Arrow */}
                  <div className="w-px h-5 bg-border" />

                  {/* Route card */}
                  <div className={`w-full border rounded-lg p-3 space-y-2 ${hasCount && count.matched > 0 ? "border-primary/30 bg-primary/5" : ""}`}>
                    {/* Header */}
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-xs font-semibold">
                        <span className="text-muted-foreground mr-1.5">RUTA {i + 1}</span>
                        {route.name ?? ""}
                      </span>
                      {loading && !hasCount && <Loader2 className="size-3.5 animate-spin text-muted-foreground" />}
                      {hasCount && (
                        <Badge variant={count.matched > 0 ? "default" : "secondary"} className="text-[11px]">
                          {count.matched} perfiles
                        </Badge>
                      )}
                    </div>

                    {/* Conditions */}
                    <div className="text-[11px] text-muted-foreground space-y-0.5">
                      {route.conditions.length === 0
                        ? <span className="italic">Sin condiciones (no matchea nada)</span>
                        : route.conditions.map((group, gi) => (
                          <div key={gi} className="flex flex-wrap items-center gap-1">
                            {gi > 0 && <span className="text-primary font-bold text-[10px]">O</span>}
                            {group.map((cond, ci) => (
                              <span key={ci} className="flex items-center gap-1">
                                {ci > 0 && <span className="opacity-40 text-[10px]">Y</span>}
                                <span className="bg-muted rounded px-1 py-0.5">{formatCondition(cond)}</span>
                              </span>
                            ))}
                          </div>
                        ))
                      }
                    </div>

                    {/* Destinations + sub-counts */}
                    {(sl || hr) && (
                      <div className="flex flex-wrap gap-1.5 pt-0.5 border-t border-dashed">
                        {sl && (
                          <div className="flex items-center gap-1">
                            <Badge variant="outline" className="text-[10px] font-normal">
                              SL → {sl}
                            </Badge>
                            {hasCount && <span className="text-[10px] text-muted-foreground">{count.withEmail} con email</span>}
                          </div>
                        )}
                        {hr && (
                          <div className="flex items-center gap-1">
                            <Badge variant="outline" className="text-[10px] font-normal">
                              HR → {hr}
                            </Badge>
                            {hasCount && <span className="text-[10px] text-muted-foreground">{count.withLinkedIn} con LinkedIn</span>}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              )
            })}

            {/* Arrow + end node */}
            <div className="flex flex-col items-center">
              <div className="w-px h-5 bg-border" />
              <div className="bg-muted/30 border border-dashed rounded-lg px-4 py-2 text-[11px] text-muted-foreground">
                Sin ruta → no enviado
              </div>
            </div>

            <p className="text-[10px] text-muted-foreground text-center pt-3">
              Cada ruta se evalúa de forma independiente — un perfil puede matchear más de una.
            </p>
          </div>
        )}
      </div>
    </div>
  )
}

// ─── Constants ────────────────────────────────────────────────────────────────

const CONDITION_FIELDS = [
  { value: "has_email", label: "Tiene email" },
  { value: "email_status", label: "Estado email" },
  { value: "icp_score", label: "ICP Score" },
  { value: "os_score", label: "OS Score" },
  { value: "icp_category", label: "Categoría ICP" },
  { value: "is_premium", label: "Premium LinkedIn" },
  { value: "connection_degree", label: "Grado conexión" },
  { value: "started_role_months", label: "Mes de inicio (meses)" },
  { value: "shortlisted", label: "En shortlist" },
]

const OPERATORS_FOR_FIELD: Record<string, { value: string; label: string }[]> = {
  has_email: [{ value: "eq", label: "=" }],
  email_status: [{ value: "eq", label: "=" }, { value: "neq", label: "≠" }],
  icp_score: [{ value: "gte", label: ">=" }, { value: "lte", label: "<=" }, { value: "eq", label: "=" }],
  os_score: [{ value: "gte", label: ">=" }, { value: "lte", label: "<=" }, { value: "eq", label: "=" }],
  icp_category: [{ value: "eq", label: "=" }],
  is_premium: [{ value: "eq", label: "=" }],
  connection_degree: [{ value: "eq", label: "=" }],
  started_role_months: [{ value: "gte", label: ">=" }, { value: "lte", label: "<=" }, { value: "eq", label: "=" }],
  shortlisted: [{ value: "eq", label: "=" }],
}

const VALUES_FOR_FIELD: Record<string, { value: string; label: string }[] | null> = {
  has_email: [{ value: "true", label: "Sí" }, { value: "false", label: "No" }],
  email_status: [
    { value: "valid", label: "Válido" },
    { value: "catch-all", label: "Catch-all" },
    { value: "invalid", label: "Inválido" },
    { value: "unknown", label: "Desconocido" },
  ],
  icp_score: null,
  os_score: null,
  icp_category: [
    { value: "Experience", label: "Experience" },
    { value: "Helpdesk", label: "Helpdesk" },
    { value: "Onboarding", label: "Onboarding" },
    { value: "Communication", label: "Communication" },
    { value: "Genérico", label: "Genérico" },
  ],
  is_premium: [{ value: "true", label: "Sí" }, { value: "false", label: "No" }],
  connection_degree: [
    { value: "FIRST", label: "1er grado" },
    { value: "SECOND", label: "2do grado" },
    { value: "THIRD", label: "3er grado" },
  ],
  started_role_months: null,
  shortlisted: [{ value: "true", label: "Sí (en shortlist)" }, { value: "false", label: "No (no shortlisted)" }],
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function newCondition(): Condition {
  return { field: "has_email", operator: "eq", value: "true" }
}

function newRoute(priority: number): DistributionRoute {
  return { id: crypto.randomUUID(), name: null, priority, conditions: [[newCondition()]], smartlead_campaign_id: null, heyreach_campaign_id: null }
}

// ─── ConditionRow ─────────────────────────────────────────────────────────────

function ConditionRow({ cond, onChange, onRemove }: {
  cond: Condition
  onChange: (c: Condition) => void
  onRemove: () => void
}) {
  const operators = OPERATORS_FOR_FIELD[cond.field] ?? [{ value: "eq", label: "=" }]
  const valueOptions = VALUES_FOR_FIELD[cond.field]

  function handleFieldChange(field: string | null) {
    if (!field) return
    const ops = OPERATORS_FOR_FIELD[field] ?? [{ value: "eq", label: "=" }]
    const vals = VALUES_FOR_FIELD[field]
    onChange({ field, operator: ops[0].value, value: vals ? vals[0].value : "" })
  }

  return (
    <div className="flex items-center gap-2">
      <Select value={cond.field} onValueChange={handleFieldChange}>
        <SelectTrigger className="h-7 text-xs w-36">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {CONDITION_FIELDS.map((f) => (
            <SelectItem key={f.value} value={f.value} className="text-xs">{f.label}</SelectItem>
          ))}
        </SelectContent>
      </Select>

      <Select value={cond.operator} onValueChange={(v) => v && onChange({ ...cond, operator: v })}>
        <SelectTrigger className="h-7 text-xs w-16">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {operators.map((o) => (
            <SelectItem key={o.value} value={o.value} className="text-xs">{o.label}</SelectItem>
          ))}
        </SelectContent>
      </Select>

      {valueOptions ? (
        <Select value={cond.value} onValueChange={(v) => v && onChange({ ...cond, value: v })}>
          <SelectTrigger className="h-7 text-xs w-32">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {valueOptions.map((v) => (
              <SelectItem key={v.value} value={v.value} className="text-xs">{v.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      ) : (
        <Input
          className="h-7 text-xs w-20"
          type="number"
          value={cond.value}
          onChange={(e) => onChange({ ...cond, value: e.target.value })}
          placeholder="valor"
        />
      )}

      <button onClick={onRemove} className="text-muted-foreground hover:text-destructive">
        <X className="size-3.5" />
      </button>
    </div>
  )
}

// ─── DestinationsSection ──────────────────────────────────────────────────────

function DestinationSelect({ label, options, value, onChange }: {
  label: string
  options: IntegrationCampaign[] | null
  value: string | null
  onChange: (v: string | null) => void
}) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState("")
  const resolvedName = options?.find((c) => c.id === value)?.name

  if (!options) {
    return (
      <div className="flex items-center gap-2">
        <span className="text-xs w-20 text-muted-foreground shrink-0">{label}</span>
        <Input
          className="h-7 text-xs font-mono"
          placeholder="Campaign ID — cargá campañas para buscar por nombre"
          value={value ?? ""}
          onChange={(e) => onChange(e.target.value || null)}
        />
      </div>
    )
  }

  return (
    <div className="flex items-center gap-2">
      <span className="text-xs w-20 text-muted-foreground shrink-0">{label}</span>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger className="h-7 text-xs flex-1 flex items-center justify-between rounded-md border border-input bg-background px-2 hover:bg-accent hover:text-accent-foreground truncate">
          {resolvedName
            ? <span className="truncate">{resolvedName}</span>
            : value
              ? <span className="font-mono text-amber-500 truncate">ID: {value} (no encontrado)</span>
              : <span className="text-muted-foreground">Seleccioná una campaña...</span>
          }
        </PopoverTrigger>
        <PopoverContent className="p-0 w-72" align="start">
          <Command filter={(value, search) => value.toLowerCase().includes(search.toLowerCase()) ? 1 : 0}>
            <CommandInput placeholder="Buscar campaña o pegá un ID..." className="h-8 text-xs" value={query} onValueChange={setQuery} />
            <CommandList>
              <CommandEmpty>
                {query.trim()
                  ? <button
                      className="w-full text-xs py-2 px-3 text-left hover:bg-accent"
                      onMouseDown={(e) => { e.preventDefault(); onChange(query.trim()); setQuery(""); setOpen(false) }}
                    >
                      Usar ID: <span className="font-mono">{query.trim()}</span>
                    </button>
                  : <p className="text-xs py-3 text-center text-muted-foreground">Sin resultados</p>
                }
              </CommandEmpty>
              {value && (
                <CommandItem
                  value="__clear__"
                  onSelect={() => { onChange(null); setOpen(false) }}
                  className="text-xs text-muted-foreground"
                >
                  — Sin campaña
                </CommandItem>
              )}
              {options.map((c) => (
                <CommandItem
                  key={c.id}
                  value={c.name}
                  onSelect={() => { onChange(c.id); setOpen(false) }}
                  className="text-xs"
                >
                  <span className="truncate flex-1">{c.name}</span>
                  <span className="text-[10px] text-muted-foreground font-mono ml-2 shrink-0">{c.id}</span>
                </CommandItem>
              ))}
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>
    </div>
  )
}

function DestinationsSection({ route, onChange, integrationCampaigns }: {
  route: DistributionRoute
  onChange: (r: DistributionRoute) => void
  integrationCampaigns: { smartlead: IntegrationCampaign[]; heyreach: IntegrationCampaign[] } | null
}) {
  return (
    <div className="space-y-2 pt-1 border-t">
      <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Destinos</p>
      <DestinationSelect
        label="Smartlead"
        options={integrationCampaigns?.smartlead ?? null}
        value={route.smartlead_campaign_id}
        onChange={(v) => onChange({ ...route, smartlead_campaign_id: v })}
      />
      <DestinationSelect
        label="HeyReach"
        options={integrationCampaigns?.heyreach ?? null}
        value={route.heyreach_campaign_id}
        onChange={(v) => onChange({ ...route, heyreach_campaign_id: v })}
      />
    </div>
  )
}

// ─── RouteCard ────────────────────────────────────────────────────────────────

function RouteCard({ route, index, total, onChange, onMoveUp, onMoveDown, onClone, onRemove, integrationCampaigns }: {
  route: DistributionRoute
  index: number
  total: number
  onChange: (r: DistributionRoute) => void
  onMoveUp: () => void
  onMoveDown: () => void
  onClone: () => void
  onRemove: () => void
  integrationCampaigns: { smartlead: IntegrationCampaign[]; heyreach: IntegrationCampaign[] } | null
}) {
  return (
    <div className="border rounded-lg p-4 space-y-3 bg-muted/20">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="text-xs font-semibold text-muted-foreground">RUTA {index + 1}</span>
          <Input
            className="h-6 text-xs w-48 border-0 bg-transparent px-1 focus-visible:ring-0"
            placeholder="Nombre de la ruta (opcional)"
            value={route.name ?? ""}
            onChange={(e) => onChange({ ...route, name: e.target.value || null })}
          />
        </div>
        <div className="flex items-center gap-1">
          <button onClick={onMoveUp} disabled={index === 0} className="text-muted-foreground hover:text-foreground disabled:opacity-30">
            <ChevronUp className="size-4" />
          </button>
          <button onClick={onMoveDown} disabled={index === total - 1} className="text-muted-foreground hover:text-foreground disabled:opacity-30">
            <ChevronDown className="size-4" />
          </button>
          <button onClick={onClone} className="text-muted-foreground hover:text-primary ml-1" title="Clonar ruta">
            <Copy className="size-3.5" />
          </button>
          <button onClick={onRemove} className="text-muted-foreground hover:text-destructive">
            <X className="size-4" />
          </button>
        </div>
      </div>

      {/* Conditions — AND within group, OR between groups */}
      <div className="space-y-2">
        <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Condiciones</p>

        {route.conditions.map((group, gi) => (
          <div key={gi}>
            {gi > 0 && (
              <div className="flex items-center gap-2 py-0.5">
                <div className="flex-1 border-t border-dashed border-muted-foreground/30" />
                <span className="text-[10px] font-bold text-muted-foreground px-1">O</span>
                <div className="flex-1 border-t border-dashed border-muted-foreground/30" />
              </div>
            )}
            <div className="space-y-1.5 pl-2 border-l-2 border-muted">
              {group.map((cond, ci) => (
                <ConditionRow
                  key={ci}
                  cond={cond}
                  onChange={(c) => {
                    const conditions: ConditionGroup[] = route.conditions.map((g, i) =>
                      i === gi ? g.map((x, j) => (j === ci ? c : x)) : g
                    )
                    onChange({ ...route, conditions })
                  }}
                  onRemove={() => {
                    const conditions: ConditionGroup[] = route.conditions
                      .map((g, i) => (i === gi ? g.filter((_, j) => j !== ci) : g))
                      .filter((g) => g.length > 0)
                    onChange({ ...route, conditions })
                  }}
                />
              ))}
              <button
                onClick={() => {
                  const conditions: ConditionGroup[] = route.conditions.map((g, i) =>
                    i === gi ? [...g, newCondition()] : g
                  )
                  onChange({ ...route, conditions })
                }}
                className="text-xs text-primary hover:underline flex items-center gap-1"
              >
                <Plus className="size-3" /> Agregar condición
              </button>
            </div>
          </div>
        ))}

        <button
          onClick={() => onChange({ ...route, conditions: [...route.conditions, [newCondition()]] })}
          className="text-xs text-muted-foreground hover:text-foreground flex items-center gap-1 mt-1"
        >
          <Plus className="size-3" /> Agregar grupo OR
        </button>
      </div>

      {/* Destinations */}
      <DestinationsSection route={route} onChange={onChange} integrationCampaigns={integrationCampaigns} />
    </div>
  )
}

// ─── Run modal ────────────────────────────────────────────────────────────────

function RunModal({ template, campaigns, onClose, onRun }: {
  template: DistributionTemplate
  campaigns: { id: string; week_label: string; rep_name: string; industry: string; prospects_found: number | null }[]
  onClose: () => void
  onRun: (campaignId: string, includePrev: boolean) => void
}) {
  const [campaignId, setCampaignId] = useState("")
  const [includePrev, setIncludePrev] = useState(false)
  const [preview, setPreview] = useState<{ total: number; previouslySent: number } | null>(null)
  const [loadingPreview, startPreview] = useTransition()

  function handleCampaignChange(id: string | null) {
    if (!id) return
    setCampaignId(id)
    startPreview(async () => {
      const p = await previewDistribution(id)
      setPreview(p)
    })
  }

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Correr: {template.name}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 pt-2">
          <div className="space-y-1.5">
            <label className="text-sm font-medium">Campaña de origen</label>
            <Select value={campaignId} onValueChange={handleCampaignChange}>
              <SelectTrigger>
                <SelectValue placeholder="Seleccioná una campaña..." />
              </SelectTrigger>
              <SelectContent>
                {campaigns.map((c) => (
                  <SelectItem key={c.id} value={c.id}>
                    {c.week_label} · {c.rep_name} · {c.industry}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {campaignId && (
            <div className="rounded-lg bg-muted/50 p-3 space-y-2 text-sm">
              {loadingPreview ? (
                <div className="flex items-center gap-2 text-muted-foreground"><Loader2 className="size-3.5 animate-spin" /> Calculando...</div>
              ) : preview ? (
                <>
                  <div className="flex justify-between"><span className="text-muted-foreground">Total prospectos</span><span className="font-medium">{preview.total}</span></div>
                  <div className="flex justify-between"><span className="text-muted-foreground">Ya enviados</span><span className="font-medium">{preview.previouslySent}</span></div>
                  <div className="flex justify-between"><span className="text-muted-foreground">Disponibles</span><span className="font-semibold text-primary">{preview.total - preview.previouslySent}</span></div>
                </>
              ) : null}
            </div>
          )}

          {preview && preview.previouslySent > 0 && (
            <label className="flex items-start gap-2.5 cursor-pointer">
              <input
                type="checkbox"
                className="mt-0.5"
                checked={includePrev}
                onChange={(e) => setIncludePrev(e.target.checked)}
              />
              <span className="text-sm">
                <span className="font-medium">Incluir prospectos ya enviados</span>
                <span className="text-muted-foreground"> ({preview.previouslySent} prospectos)</span>
              </span>
            </label>
          )}

          <div className="flex gap-2 pt-2">
            <Button variant="outline" className="flex-1" onClick={onClose}>Cancelar</Button>
            <Button
              className="flex-1"
              disabled={!campaignId}
              onClick={() => { onClose(); onRun(campaignId, includePrev) }}
            >
              <Play className="size-3.5 mr-1.5" /> Correr
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}

// ─── Run history ──────────────────────────────────────────────────────────────

function RunHistory({ runs }: { runs: DistributionRun[] }) {
  const [expanded, setExpanded] = useState<string | null>(null)

  if (!runs.length) return (
    <p className="text-xs text-muted-foreground py-4 text-center">Sin corridas aún</p>
  )

  return (
    <div className="space-y-2">
      {runs.map((run, i) => {
        const results = run.results as RunResults | null
        const isExpanded = expanded === run.id
        return (
          <div key={run.id} className="border rounded-lg overflow-hidden">
            <button
              className="w-full flex items-center justify-between px-3 py-2 hover:bg-muted/30 text-left"
              onClick={() => setExpanded(isExpanded ? null : run.id)}
            >
              <div className="flex items-center gap-3">
                <span className="text-xs text-muted-foreground font-mono">#{runs.length - i}</span>
                <span className="text-xs truncate max-w-[180px]">{run.source_campaign_label ?? "—"}</span>
              </div>
              <div className="flex items-center gap-2">
                {results && <span className="text-xs text-muted-foreground">{results.sent}/{results.total}</span>}
                {run.status === "done" && <CheckCircle2 className="size-3.5 text-green-600" />}
                {run.status === "running" && <Loader2 className="size-3.5 animate-spin text-blue-500" />}
                {run.status === "error" && <AlertCircle className="size-3.5 text-red-500" />}
                <span className="text-[10px] text-muted-foreground">
                  {new Date(run.created_at).toLocaleDateString("es-AR", { day: "numeric", month: "short" })}
                </span>
              </div>
            </button>

            {isExpanded && results && (
              <div className="border-t px-3 py-2 space-y-1.5 bg-muted/10">
                {results.routes.map((r) => (
                  <div key={r.route_id} className="flex items-center justify-between text-xs">
                    <span className="text-muted-foreground truncate max-w-[140px]">{r.name}</span>
                    <div className="flex items-center gap-3">
                      <span>{r.matched} matchearon</span>
                      {r.smartlead > 0 && <Badge variant="outline" className="text-[10px] py-0">SL: {r.smartlead}</Badge>}
                      {r.heyreach > 0 && <Badge variant="outline" className="text-[10px] py-0">HR: {r.heyreach}</Badge>}
                    </div>
                  </div>
                ))}
                {run.error && <p className="text-xs text-red-500">{run.error}</p>}
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}

// ─── Template editor ──────────────────────────────────────────────────────────

function TemplateEditor({ template, campaigns, onSaved, onClose }: {
  template: DistributionTemplate | null
  campaigns: { id: string; week_label: string; rep_name: string; industry: string; prospects_found: number | null }[]
  onSaved: (id: string) => void
  onClose: () => void
}) {
  const isNew = !template?.id
  const [name, setName] = useState(template?.name ?? "")
  const [industry, setIndustry] = useState(template?.industry ?? "")
  const [shortlistFilter, setShortlistFilter] = useState<"all" | "only" | "exclude">(template?.shortlist_filter ?? "all")
  const [routes, setRoutes] = useState<DistributionRoute[]>(template?.routes ?? [])
  const [saving, startSave] = useTransition()
  const [running, startRun] = useTransition()
  const [showRunModal, setShowRunModal] = useState(false)
  const [runs, setRuns] = useState<DistributionRun[]>([])
  const [loadingRuns, startLoadRuns] = useTransition()
  const [runSuccess, setRunSuccess] = useState<string | null>(null)
  const [integrationCampaigns, setIntegrationCampaigns] = useState<{ smartlead: IntegrationCampaign[]; heyreach: IntegrationCampaign[] } | null>(null)
  const [loadingCampaigns, startLoadCampaigns] = useTransition()
  const [showPreview, setShowPreview] = useState(false)

  function addRoute() {
    setRoutes((prev) => [...prev, newRoute(prev.length)])
  }

  function updateRoute(index: number, route: DistributionRoute) {
    setRoutes((prev) => prev.map((r, i) => i === index ? route : r))
  }

  function moveRoute(index: number, direction: -1 | 1) {
    setRoutes((prev) => {
      const next = [...prev]
      const swap = index + direction
      if (swap < 0 || swap >= next.length) return prev
      ;[next[index], next[swap]] = [next[swap], next[index]]
      return next
    })
  }

  function removeRoute(index: number) {
    setRoutes((prev) => prev.filter((_, i) => i !== index))
  }

  function cloneRoute(index: number) {
    setRoutes((prev) => {
      const src = prev[index]
      const srcName = src.name ?? `Ruta ${index + 1}`
      const copy: DistributionRoute = {
        ...src,
        id: crypto.randomUUID(),
        name: `Copy ${srcName}`,
        conditions: src.conditions.map((g) => [...g]),
      }
      const next = [...prev]
      next.splice(index + 1, 0, copy)
      return next
    })
  }

  function handleLoadCampaigns() {
    startLoadCampaigns(async () => {
      const campaigns = await loadIntegrationCampaigns()
      setIntegrationCampaigns(campaigns)
    })
  }

  function handleSave() {
    startSave(async () => {
      const id = await saveTemplate({ id: template?.id, name, industry: industry || null, notes: null, shortlist_filter: shortlistFilter, routes })
      onSaved(id)
    })
  }

  useEffect(() => {
    if (!template?.id) return
    startLoadRuns(async () => {
      const r = await getRunsForTemplate(template.id)
      setRuns(r)
    })
  }, [template?.id])

  function handleLoadRuns() {
    if (!template?.id) return
    startLoadRuns(async () => {
      const r = await getRunsForTemplate(template.id)
      setRuns(r)
    })
  }

  function handleRun(campaignId: string, includePrev: boolean) {
    if (!template?.id) return
    startRun(async () => {
      await runDistribution(template.id, campaignId, includePrev)
      setRunSuccess("Distribución completada.")
      handleLoadRuns()
    })
  }

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center gap-3 pb-4 border-b">
        <div className="flex-1 space-y-1">
          <Input
            className="text-base font-semibold border-0 px-0 h-8 focus-visible:ring-0"
            placeholder="Nombre de la plantilla..."
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
          <div className="flex items-center gap-3">
            <Input
              className="text-xs border-0 px-0 h-6 focus-visible:ring-0 text-muted-foreground flex-1"
              placeholder="Industria (opcional)"
              value={industry}
              onChange={(e) => setIndustry(e.target.value)}
            />
            <div className="flex items-center gap-1 shrink-0">
              <span className="text-[10px] text-muted-foreground">Shortlist:</span>
              <div className="flex rounded border overflow-hidden text-[10px]">
                {(["all", "only", "exclude"] as const).map((opt) => (
                  <button
                    key={opt}
                    type="button"
                    onClick={() => setShortlistFilter(opt)}
                    className={cn(
                      "px-1.5 py-0.5 transition-colors",
                      shortlistFilter === opt
                        ? "bg-primary text-primary-foreground font-medium"
                        : "hover:bg-muted/50 text-muted-foreground"
                    )}
                  >
                    {opt === "all" ? "Todos" : opt === "only" ? "Solo" : "Sin"}
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="sm" onClick={() => setShowPreview(true)} disabled={routes.length === 0} title="Vista previa del flujo">
            <Eye className="size-3.5 mr-1" /> Vista previa
          </Button>
          <Button variant="ghost" size="sm" onClick={handleLoadCampaigns} disabled={loadingCampaigns} title="Cargar campañas de Smartlead y HeyReach">
            {loadingCampaigns ? <Loader2 className="size-3.5 animate-spin mr-1" /> : <RotateCcw className="size-3.5 mr-1" />}
            {integrationCampaigns ? `${integrationCampaigns.smartlead.length + integrationCampaigns.heyreach.length} campañas` : "Cargar campañas"}
          </Button>
          <Button variant="outline" size="sm" onClick={handleSave} disabled={saving || !name}>
            {saving ? <Loader2 className="size-3.5 animate-spin" /> : null}
            {isNew ? "Crear" : "Guardar"}
          </Button>
          {!isNew && (
            <Button size="sm" onClick={() => setShowRunModal(true)} disabled={running}>
              {running ? <Loader2 className="size-3.5 animate-spin mr-1.5" /> : <Play className="size-3.5 mr-1.5" />}
              Run
            </Button>
          )}
        </div>
      </div>

      {runSuccess && (
        <div className="flex items-center gap-2 py-2 px-3 bg-green-50 dark:bg-green-950/20 rounded-lg text-sm text-green-700 dark:text-green-400 mt-3">
          <CheckCircle2 className="size-4 shrink-0" />
          {runSuccess}
        </div>
      )}

      {running && (
        <div className="flex items-center gap-2 py-2 px-3 bg-blue-50 dark:bg-blue-950/20 rounded-lg text-sm text-blue-700 dark:text-blue-400 mt-3">
          <Loader2 className="size-4 shrink-0 animate-spin" />
          Distribuyendo prospectos...
        </div>
      )}

      {/* Routes */}
      <div className="flex-1 overflow-y-auto py-4 space-y-3">
        {routes.map((route, i) => (
          <RouteCard
            key={route.id}
            route={route}
            index={i}
            total={routes.length}
            onChange={(r) => updateRoute(i, r)}
            onMoveUp={() => moveRoute(i, -1)}
            onMoveDown={() => moveRoute(i, 1)}
            onClone={() => cloneRoute(i)}
            onRemove={() => removeRoute(i)}
            integrationCampaigns={integrationCampaigns}
          />
        ))}
        <button
          onClick={addRoute}
          className="w-full border-2 border-dashed rounded-lg py-3 text-sm text-muted-foreground hover:text-foreground hover:border-foreground/30 flex items-center justify-center gap-2 transition-colors"
        >
          <Plus className="size-4" /> Agregar ruta
        </button>
      </div>

      {/* Run history */}
      {!isNew && (
        <div className="border-t pt-3">
          <button
            onClick={handleLoadRuns}
            className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground mb-2"
          >
            <RotateCcw className={`size-3 ${loadingRuns ? "animate-spin" : ""}`} />
            Historial de corridas
          </button>
          <RunHistory runs={runs} />
        </div>
      )}

      {showRunModal && (
        <RunModal
          template={{ ...template!, name, routes }}
          campaigns={campaigns}
          onClose={() => setShowRunModal(false)}
          onRun={handleRun}
        />
      )}

      <Sheet open={showPreview} onOpenChange={setShowPreview}>
        <SheetContent className="w-[480px] sm:max-w-[480px] flex flex-col">
          <SheetHeader className="pb-2">
            <SheetTitle>Vista previa — {name || "Plantilla"}</SheetTitle>
          </SheetHeader>
          <div className="flex-1 overflow-hidden">
            <RouteFlowPreview
              routes={routes}
              campaigns={campaigns}
              integrationCampaigns={integrationCampaigns}
            />
          </div>
        </SheetContent>
      </Sheet>
    </div>
  )
}

// ─── Main component ───────────────────────────────────────────────────────────

export function DistributionClient({ templates: initialTemplates, campaigns }: {
  templates: DistributionTemplate[]
  campaigns: { id: string; week_label: string; rep_name: string; industry: string; prospects_found: number | null }[]
}) {
  const [templates, setTemplates] = useState(initialTemplates)
  const [selected, setSelected] = useState<DistributionTemplate | null | "new">(null)
  const [cloning, startClone] = useTransition()
  const [deleting, startDelete] = useTransition()

  function handleSaved(id: string) {
    startClone(async () => {
      const updated = await getTemplates()
      setTemplates(updated)
      const saved = updated.find((t) => t.id === id) ?? null
      setSelected(saved)
    })
  }

  function handleClone(templateId: string) {
    startClone(async () => {
      const newId = await cloneTemplate(templateId)
      const updated = await getTemplates()
      setTemplates(updated)
      const cloned = updated.find((t) => t.id === newId) ?? null
      setSelected(cloned)
    })
  }

  function handleDelete(templateId: string) {
    if (!confirm("¿Eliminár esta plantilla y todas sus corridas?")) return
    startDelete(async () => {
      await deleteTemplate(templateId)
      if ((selected as DistributionTemplate)?.id === templateId) setSelected(null)
      setTemplates((prev) => prev.filter((t) => t.id !== templateId))
    })
  }

  const selectedTemplate = selected === "new" ? null : selected

  return (
    <div className="flex h-[calc(100vh-4rem)] gap-0">
      {/* Left panel — template list */}
      <div className="w-72 border-r flex flex-col shrink-0">
        <div className="p-4 border-b flex items-center justify-between">
          <h1 className="font-semibold">Distribución</h1>
          <Button size="sm" variant="outline" onClick={() => setSelected("new")}>
            <Plus className="size-3.5 mr-1" /> Nueva
          </Button>
        </div>

        <div className="flex-1 overflow-y-auto divide-y">
          {templates.length === 0 && (
            <p className="text-xs text-muted-foreground p-4 text-center">Sin plantillas. Creá la primera.</p>
          )}
          {templates.map((t) => {
            const isActive = (selected as DistributionTemplate)?.id === t.id
            return (
              <div
                key={t.id}
                className={`p-3 cursor-pointer hover:bg-muted/40 group ${isActive ? "bg-muted/60" : ""}`}
                onClick={() => setSelected(t)}
              >
                <div className="flex items-start justify-between gap-1">
                  <div className="min-w-0">
                    <p className="text-sm font-medium truncate">{t.name}</p>
                    {t.industry && <p className="text-xs text-muted-foreground">{t.industry}</p>}
                    <p className="text-[10px] text-muted-foreground mt-0.5">{t.routes.length} {t.routes.length === 1 ? "ruta" : "rutas"}</p>
                  </div>
                  <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 shrink-0">
                    <button
                      onClick={(e) => { e.stopPropagation(); handleClone(t.id) }}
                      className="p-1 hover:text-primary"
                      title="Clonar"
                    >
                      {cloning ? <Loader2 className="size-3.5 animate-spin" /> : <Copy className="size-3.5" />}
                    </button>
                    <button
                      onClick={(e) => { e.stopPropagation(); handleDelete(t.id) }}
                      className="p-1 hover:text-destructive"
                      title="Eliminar"
                    >
                      <Trash2 className="size-3.5" />
                    </button>
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      </div>

      {/* Right panel — editor */}
      <div className="flex-1 overflow-hidden p-6">
        {!selected ? (
          <div className="h-full flex items-center justify-center text-muted-foreground text-sm">
            Seleccioná una plantilla o creá una nueva
          </div>
        ) : (
          <TemplateEditor
            key={(selected as DistributionTemplate)?.id ?? "new"}
            template={selectedTemplate}
            campaigns={campaigns}
            onSaved={handleSaved}
            onClose={() => setSelected(null)}
          />
        )}
      </div>
    </div>
  )
}
