"use client"

import { useState, useTransition, useMemo } from "react"
import { CheckCircle2, XCircle, Loader2, Plus, Trash2, Copy, Check, Link2, AlertTriangle, AlertCircle, MinusCircle, Activity, ChevronsUpDown, Users, ExternalLink } from "lucide-react"
import type { ProviderStatus } from "./provider-status"
import type { ProviderUsage } from "./actions"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command"
import { Badge } from "@/components/ui/badge"
import { createSavedUrl, deleteSavedUrl, saveClientCompanies, updateClientCompanyLinkedinUrl, type SavedUrl, type ClientCompany } from "./actions"
import { getProviderStatus } from "./provider-status"
import { REPS, INDUSTRIES } from "@/lib/reps"
import { getInboxConfig, saveInboxConfig, type InboxConfig } from "../inbox/actions"
const URL_TYPE_LABELS: Record<string, string> = {
  company_search: "Company Search",
  people_search: "People Search",
}

// ─── Saved URL row ────────────────────────────────────────────────────────────

function UrlRow({ url, onDelete }: { url: SavedUrl; onDelete: () => void }) {
  const [copied, setCopied] = useState(false)
  const [deleting, startDelete] = useTransition()

  function handleCopy() {
    navigator.clipboard.writeText(url.url)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  function handleDelete() {
    startDelete(async () => {
      await deleteSavedUrl(url.id)
      onDelete()
    })
  }

  return (
    <div className="flex items-start gap-3 rounded-lg border p-3">
      <Link2 className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
      <div className="flex-1 min-w-0 space-y-1">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-sm font-medium">{url.rep_name}</span>
          <Badge variant="outline" className="text-xs font-normal">{url.industry}</Badge>
          <Badge
            variant="secondary"
            className={`text-xs font-normal ${url.url_type === "company_search" ? "bg-blue-50 text-blue-700" : "bg-purple-50 text-purple-700"}`}
          >
            {URL_TYPE_LABELS[url.url_type]}
          </Badge>
          {url.label && <span className="text-xs text-muted-foreground">— {url.label}</span>}
          {url.url_type === "people_search" && url.times_used > 0 && (
            <span className="text-xs text-muted-foreground">· {url.times_used}× usada</span>
          )}
        </div>
        <p className="text-xs text-muted-foreground font-mono truncate">{url.url}</p>
      </div>
      <div className="flex items-center gap-1 shrink-0">
        <Button variant="ghost" size="sm" className="h-7 w-7 p-0" onClick={handleCopy}>
          {copied ? <Check className="size-3.5 text-green-600" /> : <Copy className="size-3.5" />}
        </Button>
        <Button
          variant="ghost"
          size="sm"
          className="h-7 w-7 p-0 text-destructive hover:text-destructive"
          onClick={handleDelete}
          disabled={deleting}
        >
          {deleting ? <Loader2 className="size-3.5 animate-spin" /> : <Trash2 className="size-3.5" />}
        </Button>
      </div>
    </div>
  )
}

// ─── Add URL form ─────────────────────────────────────────────────────────────

type NewUrlForm = {
  rep_name: string
  industry: string
  url_type: "company_search" | "people_search" | ""
  url: string
  label: string
}

const EMPTY_URL_FORM: NewUrlForm = { rep_name: "", industry: "", url_type: "", url: "", label: "" }

function AddUrlForm({ onAdded, allIndustries }: { onAdded: (url: SavedUrl) => void; allIndustries: string[] }) {
  const [form, setForm] = useState<NewUrlForm>(EMPTY_URL_FORM)
  const [industryOpen, setIndustryOpen] = useState(false)
  const [isPending, startTransition] = useTransition()
  const [error, setError] = useState("")

  const isValid = form.rep_name && form.industry && form.url_type && form.url.trim()

  function handleSubmit() {
    if (!isValid) return
    setError("")
    startTransition(async () => {
      try {
        const created = await createSavedUrl({
          rep_name: form.rep_name,
          industry: form.industry,
          url_type: form.url_type as "company_search" | "people_search",
          url: form.url.trim(),
          label: form.label.trim() || null,
        })
        setForm(EMPTY_URL_FORM)
        onAdded(created)
      } catch (e) {
        setError(e instanceof Error ? e.message : "Error guardando URL")
      }
    })
  }

  return (
    <div className="rounded-lg border border-dashed p-4 space-y-3 bg-muted/30">
      <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Nueva URL</p>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Select value={form.rep_name} onValueChange={(v) => { if (v) setForm((f) => ({ ...f, rep_name: v })) }}>
          <SelectTrigger className="h-8 text-xs">
            <SelectValue placeholder="SDR" />
          </SelectTrigger>
          <SelectContent>
            {REPS.map((r) => <SelectItem key={r} value={r} className="text-xs">{r}</SelectItem>)}
          </SelectContent>
        </Select>

        {/* Industry combobox with free-text support */}
        <Popover open={industryOpen} onOpenChange={setIndustryOpen}>
          <PopoverTrigger className="flex h-8 w-full items-center justify-between rounded-md border border-input bg-background px-2 text-xs hover:bg-accent hover:text-accent-foreground">
            <span className={form.industry ? "" : "text-muted-foreground"}>
              {form.industry || "Industria"}
            </span>
            <ChevronsUpDown className="size-3 text-muted-foreground" />
          </PopoverTrigger>
          <PopoverContent className="w-52 p-0" align="start">
            <Command>
              <CommandInput
                placeholder="Buscar o escribir…"
                value={form.industry}
                onValueChange={(v) => setForm((f) => ({ ...f, industry: v }))}
                className="h-8 text-xs"
              />
              <CommandList>
                <CommandEmpty>
                  <button
                    className="w-full px-3 py-2 text-left text-xs hover:bg-muted/50"
                    onClick={() => setIndustryOpen(false)}
                  >
                    Usar &quot;{form.industry}&quot;
                  </button>
                </CommandEmpty>
                <CommandGroup>
                  {allIndustries.map((i) => (
                    <CommandItem
                      key={i}
                      value={i}
                      className="text-xs"
                      onSelect={() => { setForm((f) => ({ ...f, industry: i })); setIndustryOpen(false) }}
                    >
                      <Check className={`mr-2 size-3 ${form.industry === i ? "opacity-100" : "opacity-0"}`} />
                      {i}
                    </CommandItem>
                  ))}
                </CommandGroup>
              </CommandList>
            </Command>
          </PopoverContent>
        </Popover>

        <Select value={form.url_type} onValueChange={(v) => { if (v) setForm((f) => ({ ...f, url_type: v as NewUrlForm["url_type"] })) }}>
          <SelectTrigger className="h-8 text-xs">
            <SelectValue placeholder="Tipo" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="company_search" className="text-xs">Company Search</SelectItem>
            <SelectItem value="people_search" className="text-xs">People Search</SelectItem>
          </SelectContent>
        </Select>

        <Input
          value={form.label}
          onChange={(e) => setForm((f) => ({ ...f, label: e.target.value }))}
          placeholder="Etiqueta (opcional)"
          className="h-8 text-xs"
        />
      </div>

      <div className="flex gap-2">
        <Input
          value={form.url}
          onChange={(e) => setForm((f) => ({ ...f, url: e.target.value }))}
          placeholder="https://www.linkedin.com/sales/search/..."
          className="h-8 text-xs font-mono flex-1"
        />
        <Button
          size="sm"
          className="h-8 shrink-0"
          onClick={handleSubmit}
          disabled={!isValid || isPending}
        >
          {isPending ? <Loader2 className="size-3.5 animate-spin" /> : <><Plus className="size-3.5 mr-1" />Guardar</>}
        </Button>
      </div>
      {error && <p className="text-xs text-destructive">{error}</p>}
    </div>
  )
}

// ─── Saved URLs card ──────────────────────────────────────────────────────────

function SavedUrlsCard({ initialUrls, allIndustries }: { initialUrls: SavedUrl[]; allIndustries: string[] }) {
  const [urls, setUrls] = useState<SavedUrl[]>(initialUrls)
  const [showAdd, setShowAdd] = useState(false)
  const [filterRep, setFilterRep] = useState("all")
  const [filterIndustry, setFilterIndustry] = useState("all")
  const [filterType, setFilterType] = useState("all")

  const filtered = useMemo(() => {
    return urls.filter((u) => {
      if (filterRep !== "all" && u.rep_name !== filterRep) return false
      if (filterIndustry !== "all" && u.industry !== filterIndustry) return false
      if (filterType !== "all" && u.url_type !== filterType) return false
      return true
    })
  }, [urls, filterRep, filterIndustry, filterType])

  function handleDelete(id: string) {
    setUrls((prev) => prev.filter((u) => u.id !== id))
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle className="text-base">Repositorio de URLs</CardTitle>
            <CardDescription>
              URLs de Company Search y People Search guardadas por SDR e industria.
            </CardDescription>
          </div>
          <Button
            variant="outline"
            size="sm"
            className="h-8 text-xs"
            onClick={() => setShowAdd((v) => !v)}
          >
            {showAdd ? "Cancelar" : <><Plus className="size-3.5 mr-1" />Agregar URL</>}
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {showAdd && (
          <AddUrlForm allIndustries={allIndustries} onAdded={(newUrl) => {
            setUrls((prev) => [...prev, newUrl])
            setShowAdd(false)
          }} />
        )}

        {/* Filters */}
        <div className="flex flex-wrap gap-2">
          <Select value={filterRep} onValueChange={(v) => { if (v) setFilterRep(v) }}>
            <SelectTrigger className="h-7 w-[110px] text-xs">
              <SelectValue placeholder="SDR" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all" className="text-xs">Todos los SDR</SelectItem>
              {REPS.map((r) => <SelectItem key={r} value={r} className="text-xs">{r}</SelectItem>)}
            </SelectContent>
          </Select>

          <Select value={filterIndustry} onValueChange={(v) => { if (v) setFilterIndustry(v) }}>
            <SelectTrigger className="h-7 w-[160px] text-xs">
              <SelectValue placeholder="Industria" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all" className="text-xs">Todas las industrias</SelectItem>
              {allIndustries.map((i) => <SelectItem key={i} value={i} className="text-xs">{i}</SelectItem>)}
            </SelectContent>
          </Select>

          <Select value={filterType} onValueChange={(v) => { if (v) setFilterType(v) }}>
            <SelectTrigger className="h-7 w-[140px] text-xs">
              <SelectValue placeholder="Tipo" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all" className="text-xs">Todos los tipos</SelectItem>
              <SelectItem value="company_search" className="text-xs">Company Search</SelectItem>
              <SelectItem value="people_search" className="text-xs">People Search</SelectItem>
            </SelectContent>
          </Select>

          {(filterRep !== "all" || filterIndustry !== "all" || filterType !== "all") && (
            <Button
              variant="ghost"
              size="sm"
              className="h-7 text-xs text-muted-foreground"
              onClick={() => { setFilterRep("all"); setFilterIndustry("all"); setFilterType("all") }}
            >
              Limpiar filtros
            </Button>
          )}
        </div>

        {/* URL list */}
        {filtered.length === 0 ? (
          <p className="text-sm text-muted-foreground text-center py-6">
            {urls.length === 0 ? "No hay URLs guardadas todavía." : "Ninguna URL coincide con los filtros."}
          </p>
        ) : (
          <div className="space-y-2">
            {filtered.map((u) => (
              <UrlRow key={u.id} url={u} onDelete={() => handleDelete(u.id)} />
            ))}
          </div>
        )}

        {filtered.length > 0 && (
          <p className="text-xs text-muted-foreground">
            {filtered.length} URL{filtered.length !== 1 ? "s" : ""}
            {urls.length !== filtered.length ? ` de ${urls.length}` : ""}
          </p>
        )}
      </CardContent>
    </Card>
  )
}

// ─── Main export ──────────────────────────────────────────────────────────────

const STATUS_CFG = {
  ok:           { icon: CheckCircle2, cls: "text-green-600",  bg: "bg-green-50",  label: "OK" },
  low:          { icon: AlertTriangle, cls: "text-yellow-600", bg: "bg-yellow-50", label: "Pocos créditos" },
  out:          { icon: AlertCircle,   cls: "text-red-600",    bg: "bg-red-50",    label: "Sin créditos" },
  unconfigured: { icon: MinusCircle,   cls: "text-zinc-400",   bg: "bg-zinc-50",   label: "No configurado" },
  error:        { icon: XCircle,       cls: "text-red-600",    bg: "bg-red-50",    label: "Error" },
}

function ProviderRow({ p }: { p: ProviderStatus }) {
  const cfg = STATUS_CFG[p.status]
  const Icon = cfg.icon
  return (
    <div className="flex items-center justify-between py-2">
      <div className="flex items-center gap-2">
        <Icon className={`size-4 ${cfg.cls}`} />
        <span className="text-sm font-medium">{p.label}</span>
      </div>
      <div className="flex items-center gap-2">
        {p.credits != null && (
          <span className="text-xs text-muted-foreground">{p.credits.toLocaleString()} créditos</span>
        )}
        <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${cfg.bg} ${cfg.cls}`}>
          {p.detail}
        </span>
      </div>
    </div>
  )
}

// ── Client list card ──────────────────────────────────────────────────────────

const APP_URL = process.env.NEXT_PUBLIC_APP_URL || "https://darwin-os.vercel.app"

function ClientListCard({
  initialCompanies,
  initialExclude,
  initialExcludePrevious,
}: {
  initialCompanies: ClientCompany[]
  initialExclude: boolean
  initialExcludePrevious: boolean
}) {
  const [companies, setCompanies] = useState<ClientCompany[]>(initialCompanies)
  const [excludeClients, setExcludeClients] = useState(initialExclude)
  const [excludePrevious, setExcludePrevious] = useState(initialExcludePrevious)
  const [isPending, startTransition] = useTransition()
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState("")

  // Parse textarea: "Nombre" or "Nombre, linkedin_url" or "Nombre, linkedin_url, dominio.com"
  const [raw, setRaw] = useState(() =>
    initialCompanies
      .map((c) => {
        const parts = [c.company_name]
        if (c.linkedin_url) parts.push(c.linkedin_url)
        if (c.domain) parts.push(c.domain)
        return parts.join(", ")
      })
      .join("\n")
  )

  function parseRaw(text: string): { company_name: string; linkedin_url: string | null; domain: string | null }[] {
    return text
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => {
        const parts = line.split(",").map((p) => p.trim())
        const company_name = parts[0] ?? ""
        const second = parts[1] ?? ""
        const third = parts[2] ?? ""
        const linkedin_url = second.includes("linkedin.com/company/") ? second : null
        // domain: third field, or second if it doesn't look like a LinkedIn URL
        const rawDomain = third || (!second.includes("linkedin.com") && second ? second : "")
        const domain = rawDomain && /\.[a-z]{2,}/.test(rawDomain) ? rawDomain.replace(/^https?:\/\/(www\.)?/, "").split("/")[0] : null
        return { company_name, linkedin_url, domain }
      })
      .filter((e) => e.company_name)
  }

  function handleSave() {
    setError("")
    const entries = parseRaw(raw)
    if (!entries.length) { setError("Ingresá al menos una empresa"); return }
    startTransition(async () => {
      await saveClientCompanies(entries)
      // Optimistic update
      setCompanies(entries.map((e, i) => ({ id: String(i), ...e, sales_nav_id: null, domain: e.domain ?? null })))
      setSaved(true)
      setTimeout(() => setSaved(false), 3000)
    })
  }

  function handleToggleExclude() {
    const next = !excludeClients
    setExcludeClients(next)
    startTransition(async () => {
      const current = await getInboxConfig()
      await saveInboxConfig({ ...current, exclude_clients: next })
    })
  }

  function handleToggleExcludePrevious() {
    const next = !excludePrevious
    setExcludePrevious(next)
    startTransition(async () => {
      const current = await getInboxConfig()
      await saveInboxConfig({ ...current, exclude_previous: next })
    })
  }

  function buildTriggerUrl() {
    const cb = encodeURIComponent(APP_URL)
    return `https://www.linkedin.com/sales/lists/people?prospectOS=create_client_list&_cb=${cb}`
  }

  const resolved = companies.filter((c) => c.sales_nav_id).length
  const total = companies.length
  // Companies the extension couldn't find (only meaningful once some ARE found)
  const notFound = companies.filter((c) => !c.sales_nav_id)
  const showNotFound = notFound.length > 0 && resolved > 0

  // Inline LinkedIn URL edits for unfound companies
  const [urlEdits, setUrlEdits] = useState<Record<string, string>>({})
  const [savingId, setSavingId] = useState<string | null>(null)

  async function handleSaveUrl(company: ClientCompany) {
    const url = (urlEdits[company.id] ?? company.linkedin_url ?? "").trim() || null
    setSavingId(company.id)
    await updateClientCompanyLinkedinUrl(company.id, url)
    setCompanies((prev) =>
      prev.map((c) => (c.id === company.id ? { ...c, linkedin_url: url } : c))
    )
    // Also update raw textarea so it stays in sync
    setRaw((prev) => {
      const lines = prev.split("\n").map((line) => {
        const parts = line.split(",").map((p) => p.trim())
        if ((parts[0] ?? "") === company.company_name) {
          const newParts = [company.company_name]
          if (url) newParts.push(url)
          if (parts[2]) newParts.push(parts[2])
          return newParts.join(", ")
        }
        return line
      })
      return lines.join("\n")
    })
    setSavingId(null)
    setUrlEdits((prev) => { const next = { ...prev }; delete next[company.id]; return next })
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-start justify-between gap-4">
          <div>
            <CardTitle className="text-base flex items-center gap-2">
              <Users className="size-4" /> Lista de clientes
            </CardTitle>
            <CardDescription>
              Empresas que ya son clientes. La extensión crea la lista en Sales Navigator y pueden excluirse de búsquedas futuras.
            </CardDescription>
          </div>
          {total > 0 && (
            <span className="text-xs text-muted-foreground shrink-0 pt-0.5">
              {resolved}/{total} en Sales Nav
            </span>
          )}
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-1.5">
          <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
            Empresas <span className="normal-case font-normal">(una por línea — LinkedIn URL y dominio son opcionales)</span>
          </label>
          <textarea
            rows={8}
            value={raw}
            onChange={(e) => setRaw(e.target.value)}
            placeholder={"Ransa\nCencosud, https://www.linkedin.com/company/cencosud/, cencosud.com\nFalabella, https://www.linkedin.com/company/falabella/\nWalmex, , walmex.mx"}
            className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm font-mono leading-relaxed resize-y focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring placeholder:text-muted-foreground"
          />
          <p className="text-xs text-muted-foreground">
            Formato: <code className="bg-muted px-1 rounded">Nombre</code> o <code className="bg-muted px-1 rounded">Nombre, linkedin_url, dominio.com</code> — cada campo separado por coma
          </p>
        </div>

        {/* Company list preview */}
        {companies.length > 0 && (
          <div className="rounded-md border divide-y max-h-48 overflow-y-auto">
            {companies.map((c, i) => (
              <div key={c.id ?? i} className="flex items-center gap-2 px-3 py-2">
                <span className="text-sm flex-1 truncate">{c.company_name}</span>
                <div className="flex items-center gap-1.5 shrink-0">
                  {c.linkedin_url && (
                    <a href={c.linkedin_url} target="_blank" rel="noopener noreferrer"
                      className="text-muted-foreground hover:text-foreground">
                      <ExternalLink className="size-3" />
                    </a>
                  )}
                  {c.sales_nav_id ? (
                    <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-green-50 text-green-700 font-medium">En Sales Nav</span>
                  ) : c.linkedin_url ? (
                    <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-amber-50 text-amber-700 font-medium">Con LinkedIn</span>
                  ) : (
                    <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-muted text-muted-foreground font-medium">Solo nombre</span>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Not-found section — appears after extension has run (some found, some not) */}
        {showNotFound && (
          <div className="rounded-md border border-amber-200 bg-amber-50/40 dark:border-amber-900 dark:bg-amber-950/20 overflow-hidden">
            <div className="px-3 py-2 border-b border-amber-200 dark:border-amber-900 flex items-center gap-2">
              <AlertTriangle className="size-3.5 text-amber-600 shrink-0" />
              <span className="text-xs font-medium text-amber-800 dark:text-amber-300 flex-1">
                No encontradas en Sales Nav ({notFound.length})
              </span>
              <span className="text-[10px] text-amber-700 dark:text-amber-400">
                Agregá la URL de LinkedIn para mejorar la búsqueda
              </span>
            </div>
            <div className="divide-y divide-amber-100 dark:divide-amber-900">
              {notFound.map((c) => {
                const currentUrl = urlEdits[c.id] ?? c.linkedin_url ?? ""
                const dirty = c.id in urlEdits && urlEdits[c.id] !== (c.linkedin_url ?? "")
                return (
                  <div key={c.id} className="flex items-center gap-2 px-3 py-2">
                    <span className="text-sm flex-1 min-w-0 truncate text-amber-900 dark:text-amber-200">
                      {c.company_name}
                    </span>
                    <input
                      type="url"
                      value={currentUrl}
                      onChange={(e) => setUrlEdits((prev) => ({ ...prev, [c.id]: e.target.value }))}
                      placeholder="https://linkedin.com/company/..."
                      className="text-xs border border-amber-200 dark:border-amber-800 rounded px-2 py-1 w-60 bg-white dark:bg-amber-950/50 focus:outline-none focus:ring-1 focus:ring-amber-400 placeholder:text-amber-400"
                    />
                    <button
                      onClick={() => handleSaveUrl(c)}
                      disabled={savingId === c.id || !dirty}
                      className={`text-[10px] px-2 py-1 rounded font-medium transition-colors ${
                        dirty
                          ? "bg-amber-600 text-white hover:bg-amber-700"
                          : "bg-amber-100 text-amber-400 dark:bg-amber-900 dark:text-amber-600 cursor-not-allowed"
                      }`}
                    >
                      {savingId === c.id ? "…" : "Guardar"}
                    </button>
                  </div>
                )
              })}
            </div>
          </div>
        )}

        {error && <p className="text-sm text-destructive">{error}</p>}

        <div className="flex items-center gap-3 flex-wrap">
          <Button size="sm" onClick={handleSave} disabled={isPending}>
            {isPending ? <Loader2 className="mr-1.5 size-3.5 animate-spin" /> : null}
            Guardar lista
          </Button>
          {companies.length > 0 && (
            <a href={buildTriggerUrl()} target="_blank" rel="noopener noreferrer">
              <Button size="sm" variant="outline" type="button">
                <ExternalLink className="mr-1.5 size-3.5" /> Crear en Sales Navigator
              </Button>
            </a>
          )}
          {saved && (
            <span className="inline-flex items-center gap-1 text-xs text-green-700">
              <CheckCircle2 className="size-3" /> Guardado
            </span>
          )}
        </div>

        {/* Exclusion toggles */}
        <div className="flex items-center justify-between rounded-lg border p-3">
          <div className="space-y-0.5">
            <p className="text-sm font-medium">Excluir de company search</p>
            <p className="text-xs text-muted-foreground">
              Las empresas de esta lista no se guardarán en búsquedas futuras
            </p>
          </div>
          <button
            role="switch"
            aria-checked={excludeClients}
            onClick={handleToggleExclude}
            disabled={isPending}
            className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
              excludeClients ? "bg-primary" : "bg-input"
            }`}
          >
            <span className={`pointer-events-none inline-block h-4 w-4 rounded-full bg-background shadow-lg transform transition-transform ${excludeClients ? "translate-x-4" : "translate-x-0"}`} />
          </button>
        </div>

        <div className="flex items-center justify-between rounded-lg border p-3">
          <div className="space-y-0.5">
            <p className="text-sm font-medium">Excluir empresas de campañas anteriores</p>
            <p className="text-xs text-muted-foreground">
              Si una empresa ya fue scraped en otra campaña, no se vuelve a agregar
            </p>
          </div>
          <button
            role="switch"
            aria-checked={excludePrevious}
            onClick={handleToggleExcludePrevious}
            disabled={isPending}
            className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
              excludePrevious ? "bg-primary" : "bg-input"
            }`}
          >
            <span className={`pointer-events-none inline-block h-4 w-4 rounded-full bg-background shadow-lg transform transition-transform ${excludePrevious ? "translate-x-4" : "translate-x-0"}`} />
          </button>
        </div>
      </CardContent>
    </Card>
  )
}

function InboxSettingsCard({ initialConfig }: { initialConfig: InboxConfig }) {
  const [productContext, setProductContext] = useState(initialConfig.product_context ?? "")
  const [calendlyLink, setCalendlyLink] = useState(initialConfig.calendly_link ?? "")
  const [isPending, startTransition] = useTransition()
  const [saved, setSaved] = useState(false)

  function handleSave() {
    startTransition(async () => {
      const current = await getInboxConfig()
      await saveInboxConfig({ ...current, product_context: productContext || null, calendly_link: calendlyLink || null })
      setSaved(true)
      setTimeout(() => setSaved(false), 3000)
    })
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Inbox IA</CardTitle>
        <CardDescription>
          Contexto del producto y link de Calendly que usa la IA para generar borradores de respuesta.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-1.5">
          <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Link de Calendly</label>
          <Input
            value={calendlyLink}
            onChange={(e) => setCalendlyLink(e.target.value)}
            placeholder="https://calendly.com/tu-link"
            className="text-sm"
          />
        </div>
        <div className="space-y-1.5">
          <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Contexto del producto (Lara)</label>
          <textarea
            value={productContext}
            onChange={(e) => setProductContext(e.target.value)}
            rows={10}
            placeholder="Describí las features de Lara, casos de uso por industria, y los pain points que resuelve. La IA usará este texto para generar respuestas personalizadas."
            className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm leading-relaxed resize-none focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring placeholder:text-muted-foreground"
          />
          <p className="text-xs text-muted-foreground">
            Incluí features por industria, objeciones comunes y cómo responderlas, y el tono de voz del equipo.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <Button size="sm" onClick={handleSave} disabled={isPending}>
            {isPending ? <Loader2 className="mr-2 size-3.5 animate-spin" /> : null}
            Guardar
          </Button>
          {saved && (
            <span className="inline-flex items-center gap-1 text-xs text-green-700">
              <CheckCircle2 className="size-3" /> Guardado
            </span>
          )}
        </div>
      </CardContent>
    </Card>
  )
}

export function SettingsClient({ savedUrls, providerStatus: initialProviderStatus, providerUsage, inboxConfig, campaignIndustries, clientCompanies }: {
  savedUrls: SavedUrl[]
  providerStatus: ProviderStatus[]
  providerUsage: ProviderUsage[]
  inboxConfig: InboxConfig
  campaignIndustries: string[]
  clientCompanies: ClientCompany[]
}) {
  // Merge predefined industries with custom ones from campaigns, deduplicated and sorted
  const allIndustries = useMemo(() => {
    const merged = [...new Set([...INDUSTRIES, ...campaignIndustries])]
    return merged.sort()
  }, [campaignIndustries])
  const [providerStatus, setProviderStatus] = useState<ProviderStatus[]>(initialProviderStatus)
  const [refreshing, startRefresh] = useTransition()

  function handleRefreshProviders() {
    startRefresh(async () => {
      const fresh = await getProviderStatus()
      setProviderStatus(fresh)
    })
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Settings</h1>
        <p className="mt-0.5 text-sm text-muted-foreground">
          Configuración de URLs e integraciones por SDR.
        </p>
      </div>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <div>
            <CardTitle className="text-base">Estado de providers</CardTitle>
            <CardDescription>Créditos disponibles por servicio de enriquecimiento.</CardDescription>
          </div>
          <Button variant="outline" size="sm" onClick={handleRefreshProviders} disabled={refreshing}>
            {refreshing ? <Loader2 className="size-3.5 animate-spin" /> : <Activity className="size-3.5" />}
            <span className="ml-1.5">{refreshing ? "Actualizando…" : "Actualizar"}</span>
          </Button>
        </CardHeader>
        <CardContent className="divide-y">
          {providerStatus.map((p) => <ProviderRow key={p.name} p={p} />)}
        </CardContent>
      </Card>

      {providerUsage.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <Activity className="size-4" /> Consumo por provider
            </CardTitle>
            <CardDescription>Emails encontrados exitosamente por cada servicio.</CardDescription>
          </CardHeader>
          <CardContent>
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-xs text-muted-foreground">
                  <th className="pb-2 text-left font-medium">Provider</th>
                  <th className="pb-2 text-right font-medium">Hoy</th>
                  <th className="pb-2 text-right font-medium">7 días</th>
                  <th className="pb-2 text-right font-medium">Este mes</th>
                  <th className="pb-2 text-right font-medium">Total</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {providerUsage.map((u) => (
                  <tr key={u.provider}>
                    <td className="py-2 font-medium">{u.label}</td>
                    <td className="py-2 text-right tabular-nums">{u.today || "—"}</td>
                    <td className="py-2 text-right tabular-nums">{u.week || "—"}</td>
                    <td className="py-2 text-right tabular-nums">{u.month || "—"}</td>
                    <td className="py-2 text-right tabular-nums font-medium">{u.total}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </CardContent>
        </Card>
      )}

      <SavedUrlsCard initialUrls={savedUrls} allIndustries={allIndustries} />

      <ClientListCard initialCompanies={clientCompanies} initialExclude={inboxConfig.exclude_clients ?? false} initialExcludePrevious={inboxConfig.exclude_previous ?? false} />

      <InboxSettingsCard initialConfig={inboxConfig} />
    </div>
  )
}
