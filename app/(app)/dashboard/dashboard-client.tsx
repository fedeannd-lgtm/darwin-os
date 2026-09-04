"use client"

import { useState, useTransition, useMemo, useEffect, useRef } from "react"
import { useRouter } from "next/navigation"
import { REPS as BASE_REPS, INDUSTRIES } from "@/lib/reps"
const REPS = ["Todos", ...BASE_REPS]
const REP_OPTIONS = BASE_REPS
import { Plus, Pencil, Trash2, Building2, Users, Send, Mail, ChevronLeft, ChevronRight, LayoutList, CalendarDays, CalendarIcon, BarChart3, ChevronsUpDown, Check, Zap, ChevronDown } from "lucide-react"
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from "recharts"
import Link from "next/link"
import { Button } from "@/components/ui/button"
import { Calendar } from "@/components/ui/calendar"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { createCampaign, updateCampaign, deleteCampaign, getWeekStats, createAutoCampaign, getSavedUrlsForWizard, getDistributionTemplatesForWizard, type IcpStat, type IcpCategoryStat, type AutoCampaignConfig } from "./actions"

function formatDate(d: Date): string {
  return d.toISOString().slice(0, 10)
}

function getWeekMonday(date: Date): string {
  const d = new Date(date)
  d.setHours(12, 0, 0, 0)
  const day = d.getDay()
  d.setDate(d.getDate() - (day === 0 ? 6 : day - 1))
  return d.toISOString().split("T")[0]
}

function addWeeks(isoMonday: string, n: number): string {
  const d = new Date(isoMonday + "T12:00:00")
  d.setDate(d.getDate() + n * 7)
  return d.toISOString().split("T")[0]
}

type CampaignStatus = "pending" | "searching" | "enriching" | "distributing" | "done"

type Campaign = {
  id: string
  week_label: string
  rep_name: string
  industry: string
  status: CampaignStatus
  accounts_found: number
  prospects_found: number
  prospects_sent: number
  notes: string | null
}

type FormData = {
  week_label: string
  rep_name: string
  industry: string
  notes: string
}

type SavedUrl = { id: string; url: string; label: string | null; url_type: string }
type DistributionTemplate = { id: string; name: string; industry: string | null }

type AutoForm = {
  // Step 2 — Company Search
  company_search_url: string
  company_count: number
  exclude_previous: boolean
  exclusion_date_from: string
  exclusion_date_to: string
  start_page: number
  // Step 3 — People Search
  people_search_url: string
  people_count: number
  // Step 4 — Enrichment
  enrich_emails: boolean
  enrich_phones: boolean
  classify_icp: boolean
  normalize_names: boolean
  auto_shortlist: boolean
  shortlist_icp_min: number
  shortlist_title_keywords: string
  // Step 5 — Distribution
  distribution_template_id: string
  distribution_template_name: string
  // Exclusion date range (optional sub-option)
  filter_by_date_range: boolean
}

function emptyAutoForm(): AutoForm {
  const now = new Date()
  now.setDate(now.getDate() + 1)
  return {
    company_search_url: "",
    company_count: 50,
    exclude_previous: true,
    exclusion_date_from: "",
    exclusion_date_to: "",
    start_page: 1,
    people_search_url: "",
    people_count: 100,
    enrich_emails: true,
    enrich_phones: false,
    classify_icp: true,
    normalize_names: true,
    auto_shortlist: true,
    shortlist_icp_min: 10,
    shortlist_title_keywords: "",
    distribution_template_id: "",
    distribution_template_name: "",
    filter_by_date_range: false,
  }
}

const STATUS_LABELS: Record<CampaignStatus, string> = {
  pending: "Pendiente",
  searching: "Buscando",
  enriching: "Enriqueciendo",
  distributing: "Distribuyendo",
  done: "Listo",
}

const STATUS_CLASSES: Record<CampaignStatus, string> = {
  pending: "bg-zinc-100 text-zinc-600 border border-zinc-200",
  searching: "bg-blue-50 text-blue-700 border border-blue-200",
  enriching: "bg-amber-50 text-amber-700 border border-amber-200",
  distributing: "bg-violet-50 text-violet-700 border border-violet-200",
  done: "bg-green-50 text-green-700 border border-green-200",
}

function emptyForm(): FormData {
  return { week_label: formatDate(new Date()), rep_name: "", industry: "", notes: "" }
}

// ─── Auto Campaign Badge ───────────────────────────────────────────────────────

const AUTO_STATUS_LABELS: Record<string, string> = {
  pending: "Programada",
  company_search: "Buscando empresas",
  creating_list: "Crear lista",
  people_search: "Buscando personas",
  enriching: "Enriqueciendo",
  distributing: "Distribuyendo",
  done: "Completada",
  error: "Error",
}

const AUTO_STATUS_CLASSES: Record<string, string> = {
  pending: "bg-zinc-100 text-zinc-600 border border-zinc-200",
  company_search: "bg-blue-50 text-blue-700 border border-blue-200",
  creating_list: "bg-orange-50 text-orange-700 border border-orange-200",
  people_search: "bg-blue-50 text-blue-700 border border-blue-200",
  enriching: "bg-amber-50 text-amber-700 border border-amber-200",
  distributing: "bg-violet-50 text-violet-700 border border-violet-200",
  done: "bg-green-50 text-green-700 border border-green-200",
  error: "bg-red-50 text-red-700 border border-red-200",
}

function AutoBadge({ status }: { status: string }) {
  return (
    <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium ${AUTO_STATUS_CLASSES[status] ?? "bg-zinc-100 text-zinc-600"}`}>
      <Zap className="size-2.5" />
      {AUTO_STATUS_LABELS[status] ?? status}
    </span>
  )
}

function StatusBadge({ status }: { status: CampaignStatus }) {
  return (
    <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${STATUS_CLASSES[status]}`}>
      {STATUS_LABELS[status]}
    </span>
  )
}

function CampaignTable({
  campaigns,
  onEdit,
  onDelete,
  isPending,
  autoActionMap = {},
}: {
  campaigns: Campaign[]
  onEdit: (c: Campaign) => void
  onDelete: (id: string) => void
  isPending: boolean
  autoActionMap?: Record<string, { autoStatus: string; jobUrl: string | null }>
}) {
  if (campaigns.length === 0) {
    return (
      <div className="flex items-center justify-center py-16 text-sm text-muted-foreground">
        Sin campañas
      </div>
    )
  }

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Fecha</TableHead>
          <TableHead>Rep</TableHead>
          <TableHead>Industria</TableHead>
          <TableHead>Estado</TableHead>
          <TableHead className="text-right">Empresas</TableHead>
          <TableHead className="text-right">Prospectos</TableHead>
          <TableHead className="text-right">Enviados</TableHead>
          <TableHead />
        </TableRow>
      </TableHeader>
      <TableBody>
        {campaigns.map((c) => {
          const autoData = autoActionMap[c.id]
          const needsAction = (autoData?.autoStatus === "company_search" || autoData?.autoStatus === "creating_list" || autoData?.autoStatus === "people_search") && autoData?.jobUrl
          const actionLabel = autoData?.autoStatus === "company_search" ? "Company Search"
            : autoData?.autoStatus === "creating_list" ? "Crear Lista"
            : "People Search"
          const actionColor = autoData?.autoStatus === "creating_list"
            ? "bg-orange-500 hover:bg-orange-600 text-white"
            : "bg-blue-600 hover:bg-blue-700 text-white"
          return (
          <TableRow key={c.id}>
            <TableCell className="font-medium whitespace-nowrap">{c.week_label}</TableCell>
            <TableCell>{c.rep_name}</TableCell>
            <TableCell className="max-w-[160px] truncate">{c.industry}</TableCell>
            <TableCell>
              <div className="flex items-center gap-1.5 flex-wrap">
                <StatusBadge status={c.status} />
                {autoData && <AutoBadge status={autoData.autoStatus} />}
              </div>
            </TableCell>
            <TableCell className="text-right tabular-nums">{c.accounts_found}</TableCell>
            <TableCell className="text-right tabular-nums">{c.prospects_found}</TableCell>
            <TableCell className="text-right tabular-nums">{c.prospects_sent}</TableCell>
            <TableCell>
              <div className="flex items-center justify-end gap-1">
                {needsAction && (
                  <Button size="sm" className={`h-7 text-xs gap-1 ${actionColor}`}
                    onClick={() => window.open(autoData.jobUrl!, "_blank", "noreferrer")}>
                    <Zap className="size-3" />
                    {actionLabel}
                  </Button>
                )}
                <Button variant="ghost" size="icon" className="size-8" onClick={() => onEdit(c)} disabled={isPending}>
                  <Pencil className="size-3.5" />
                </Button>
                <Button variant="ghost" size="icon" className="size-8 text-destructive hover:text-destructive" onClick={() => onDelete(c.id)} disabled={isPending}>
                  <Trash2 className="size-3.5" />
                </Button>
              </div>
            </TableCell>
          </TableRow>
          )
        })}
      </TableBody>
    </Table>
  )
}

const MONTHS = ["Ene", "Feb", "Mar", "Abr", "May", "Jun", "Jul", "Ago", "Sep", "Oct", "Nov", "Dic"]

function parseCampaignDate(weekLabel: string): Date | null {
  const match = weekLabel.match(/(\d{4}-\d{2}-\d{2})/)
  if (!match) return null
  const d = new Date(match[1] + "T12:00:00")
  return isNaN(d.getTime()) ? null : d
}

function getISOWeekInfo(date: Date): { key: string; week: number; year: number; monday: Date } {
  const d = new Date(date)
  d.setHours(12, 0, 0, 0)
  const day = d.getDay() || 7
  d.setDate(d.getDate() + 4 - day)
  const year = d.getFullYear()
  const jan4 = new Date(year, 0, 4)
  const week = 1 + Math.round(((d.getTime() - jan4.getTime()) / 86400000 - 3 + (jan4.getDay() || 7)) / 7)
  const monday = new Date(date)
  monday.setDate(date.getDate() - (date.getDay() || 7) + 1)
  return { key: `${year}-W${String(week).padStart(2, "0")}`, week, year, monday }
}

function formatWeekRange(monday: Date): string {
  const sunday = new Date(monday)
  sunday.setDate(monday.getDate() + 6)
  const start = `${monday.getDate()} ${MONTHS[monday.getMonth()]}`
  const end = `${sunday.getDate()} ${MONTHS[sunday.getMonth()]} ${sunday.getFullYear()}`
  return `${start} – ${end}`
}

function WeeklyView({ campaigns, autoActionMap = {} }: { campaigns: Campaign[]; autoActionMap?: Record<string, { autoStatus: string; jobUrl: string | null }> }) {
  const weeks = useMemo(() => {
    const map = new Map<string, { week: number; year: number; monday: Date; campaigns: Campaign[] }>()
    campaigns.forEach((c) => {
      const date = parseCampaignDate(c.week_label)
      if (!date) {
        const key = "__nodate__"
        if (!map.has(key)) map.set(key, { week: 0, year: 0, monday: new Date(0), campaigns: [] })
        map.get(key)!.campaigns.push(c)
        return
      }
      const info = getISOWeekInfo(date)
      if (!map.has(info.key)) map.set(info.key, { week: info.week, year: info.year, monday: info.monday, campaigns: [] })
      map.get(info.key)!.campaigns.push(c)
    })
    return Array.from(map.entries()).sort((a, b) => {
      if (a[0] === "__nodate__") return 1
      if (b[0] === "__nodate__") return -1
      return b[0].localeCompare(a[0])
    })
  }, [campaigns])

  if (weeks.length === 0) {
    return (
      <div className="flex items-center justify-center py-16 text-sm text-muted-foreground">
        Sin campañas para esta semana
      </div>
    )
  }

  return (
    <div className="space-y-8">
      {weeks.map(([key, { week, year, monday, campaigns: cams }]) => {
        const totalAccounts = cams.reduce((s, c) => s + c.accounts_found, 0)
        const totalProspects = cams.reduce((s, c) => s + c.prospects_found, 0)
        const totalSent = cams.reduce((s, c) => s + c.prospects_sent, 0)
        const label = key === "__nodate__" ? "Sin fecha" : `Semana ${week}`
        const range = key === "__nodate__" ? "" : formatWeekRange(monday)
        return (
          <div key={key}>
            <div className="flex items-center gap-3 mb-4">
              <div className="flex items-baseline gap-2">
                <h3 className="font-semibold text-base">{label}</h3>
                {range && <span className="text-sm text-muted-foreground">{range}</span>}
              </div>
              <div className="flex items-center gap-3 text-xs text-muted-foreground ml-2">
                <span className="flex items-center gap-1"><Building2 className="size-3" />{totalAccounts}</span>
                <span className="flex items-center gap-1"><Users className="size-3" />{totalProspects}</span>
                <span className="flex items-center gap-1"><Send className="size-3" />{totalSent}</span>
              </div>
              <div className="flex-1 border-t" />
            </div>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
              {cams.map((c) => {
                const autoData = autoActionMap[c.id]
                const needsAction = (autoData?.autoStatus === "company_search" || autoData?.autoStatus === "creating_list" || autoData?.autoStatus === "people_search") && autoData?.jobUrl
                const weeklyActionLabel = autoData?.autoStatus === "company_search" ? "Abrir Company Search"
                  : autoData?.autoStatus === "creating_list" ? "Crear Lista de Cuentas"
                  : "Abrir People Search"
                const weeklyActionColor = autoData?.autoStatus === "creating_list"
                  ? "bg-orange-500 hover:bg-orange-600"
                  : "bg-blue-600 hover:bg-blue-700"
                return (
                  <Link key={c.id} href={`/campaigns/${c.id}`}>
                    <div className="rounded-lg border p-3.5 hover:bg-muted/40 transition-colors cursor-pointer h-full flex flex-col gap-3">
                      <div className="flex items-start justify-between gap-2">
                        <div>
                          <p className="font-medium text-sm">{c.rep_name}</p>
                          <p className="text-xs text-muted-foreground mt-0.5">{c.industry}</p>
                        </div>
                        <div className="flex flex-col items-end gap-1">
                          <StatusBadge status={c.status} />
                          {autoData && (
                            <span className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold bg-violet-100 text-violet-700 dark:bg-violet-900/40 dark:text-violet-300">
                              <Zap className="size-2.5" /> Auto
                            </span>
                          )}
                        </div>
                      </div>
                      <div className="flex gap-4 text-xs text-muted-foreground">
                        <span className="flex items-center gap-1"><Building2 className="size-3" />{c.accounts_found}</span>
                        <span className="flex items-center gap-1"><Users className="size-3" />{c.prospects_found}</span>
                        <span className="flex items-center gap-1"><Send className="size-3" />{c.prospects_sent}</span>
                      </div>
                      {needsAction && (
                        <button
                          className={`mt-auto w-full text-xs font-medium py-1.5 px-2 rounded-md ${weeklyActionColor} text-white flex items-center justify-center gap-1.5 transition-colors`}
                          onClick={(e) => {
                            e.preventDefault()
                            e.stopPropagation()
                            window.open(autoData.jobUrl!, "_blank", "noreferrer")
                          }}
                        >
                          <Zap className="size-3" />
                          {weeklyActionLabel}
                        </button>
                      )}
                    </div>
                  </Link>
                )
              })}
            </div>
          </div>
        )
      })}
    </div>
  )
}

const ICP_CATEGORY_COLORS: Record<string, string> = {
  Experience: "#3b82f6",
  Helpdesk: "#10b981",
  Onboarding: "#f59e0b",
  Communication: "#8b5cf6",
  Generic: "#d1d5db",
}

function ChartsView({ campaigns, icpStats, icpCategoryStats }: { campaigns: Campaign[]; icpStats: IcpStat[]; icpCategoryStats: IcpCategoryStat[] }) {
  const weeklyData = useMemo(() => {
    const map = new Map<string, { label: string; order: string; empresas: number; prospectos: number; ratio: number }>()
    campaigns.forEach((c) => {
      const date = parseCampaignDate(c.week_label)
      if (!date) return
      const { key, week, year, monday } = getISOWeekInfo(date)
      if (!map.has(key)) map.set(key, { label: `${monday.getDate()} ${MONTHS[monday.getMonth()]}`, order: `${year}-${String(week).padStart(2, "0")}`, empresas: 0, prospectos: 0, ratio: 0 })
      const entry = map.get(key)!
      entry.empresas += c.accounts_found
      entry.prospectos += c.prospects_found
    })
    const result = Array.from(map.values()).sort((a, b) => a.order.localeCompare(b.order))
    result.forEach((e) => { e.ratio = e.empresas > 0 ? +(e.prospectos / e.empresas).toFixed(1) : 0 })
    return result
  }, [campaigns])

  const sdrData = useMemo(() => {
    const map = new Map<string, { rep: string; empresas: number; prospectos: number }>()
    campaigns.forEach((c) => {
      if (!map.has(c.rep_name)) map.set(c.rep_name, { rep: c.rep_name, empresas: 0, prospectos: 0 })
      const entry = map.get(c.rep_name)!
      entry.empresas += c.accounts_found
      entry.prospectos += c.prospects_found
    })
    return Array.from(map.values()).sort((a, b) => b.prospectos - a.prospectos)
  }, [campaigns])

  const industryData = useMemo(() => {
    const map = new Map<string, { industry: string; empresas: number; prospectos: number; ratio: number }>()
    campaigns.forEach((c) => {
      if (!map.has(c.industry)) map.set(c.industry, { industry: c.industry, empresas: 0, prospectos: 0, ratio: 0 })
      const entry = map.get(c.industry)!
      entry.empresas += c.accounts_found
      entry.prospectos += c.prospects_found
    })
    const result = Array.from(map.values()).sort((a, b) => b.prospectos - a.prospectos)
    result.forEach((e) => { e.ratio = e.empresas > 0 ? +(e.prospectos / e.empresas).toFixed(1) : 0 })
    return result
  }, [campaigns])

  const icpByWeek = useMemo(() => {
    const map = new Map<string, { label: string; order: string; score10: number; score5: number; score0: number }>()
    icpStats.forEach((s) => {
      const date = parseCampaignDate(s.week_label)
      if (!date) return
      const { key, week, year, monday } = getISOWeekInfo(date)
      if (!map.has(key)) map.set(key, { label: `${monday.getDate()} ${MONTHS[monday.getMonth()]}`, order: `${year}-${String(week).padStart(2, "0")}`, score10: 0, score5: 0, score0: 0 })
      const entry = map.get(key)!
      entry.score10 += s.score10
      entry.score5 += s.score5
      entry.score0 += s.score0
    })
    return Array.from(map.values()).sort((a, b) => a.order.localeCompare(b.order))
  }, [icpStats])

  const icpByIndustry = useMemo(() => {
    const map = new Map<string, { industry: string; score10: number; score5: number; score0: number }>()
    icpStats.forEach((s) => {
      if (!map.has(s.industry)) map.set(s.industry, { industry: s.industry, score10: 0, score5: 0, score0: 0 })
      const entry = map.get(s.industry)!
      entry.score10 += s.score10
      entry.score5 += s.score5
      entry.score0 += s.score0
    })
    return Array.from(map.values()).sort((a, b) => (b.score10 + b.score5) - (a.score10 + a.score5))
  }, [icpStats])

  const icpCatByWeek = useMemo(() => {
    const weekMap = new Map<string, { label: string; order: string; [k: string]: number | string }>()
    const categories = new Set<string>()
    icpCategoryStats.forEach((s) => {
      const date = parseCampaignDate(s.week_label)
      if (!date) return
      const { key, week, year, monday } = getISOWeekInfo(date)
      if (!weekMap.has(key)) weekMap.set(key, { label: `${monday.getDate()} ${MONTHS[monday.getMonth()]}`, order: `${year}-${String(week).padStart(2, "0")}` })
      const entry = weekMap.get(key)!
      entry[s.category] = ((entry[s.category] as number) || 0) + s.count
      categories.add(s.category)
    })
    return {
      data: Array.from(weekMap.values()).sort((a, b) => (a.order as string).localeCompare(b.order as string)),
      categories: Array.from(categories),
    }
  }, [icpCategoryStats])

  const icpCatByIndustry = useMemo(() => {
    const indMap = new Map<string, { industry: string; [k: string]: number | string }>()
    const categories = new Set<string>()
    icpCategoryStats.forEach((s) => {
      if (!indMap.has(s.industry)) indMap.set(s.industry, { industry: s.industry })
      const entry = indMap.get(s.industry)!
      entry[s.category] = ((entry[s.category] as number) || 0) + s.count
      categories.add(s.category)
    })
    return {
      data: Array.from(indMap.values()),
      categories: Array.from(categories),
    }
  }, [icpCategoryStats])

  const shortIndustry = (name: string) => name.split(" ")[0]

  const INDUSTRY_COLORS = ["#3b82f6","#10b981","#f59e0b","#ef4444","#8b5cf6","#06b6d4","#f97316","#84cc16"]

  const weekIndustryData = useMemo(() => {
    const weekMap = new Map<string, { label: string; order: string; [k: string]: number | string }>()
    const industries = new Set<string>()
    campaigns.forEach((c) => {
      const date = parseCampaignDate(c.week_label)
      if (!date) return
      const { key, week, year, monday } = getISOWeekInfo(date)
      if (!weekMap.has(key)) weekMap.set(key, { label: `${monday.getDate()} ${MONTHS[monday.getMonth()]}`, order: `${year}-${String(week).padStart(2, "0")}` })
      const entry = weekMap.get(key)!
      entry[c.industry] = ((entry[c.industry] as number) || 0) + c.prospects_found
      industries.add(c.industry)
    })
    return {
      data: Array.from(weekMap.values()).sort((a, b) => (a.order as string).localeCompare(b.order as string)),
      industries: Array.from(industries),
    }
  }, [campaigns])

  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
      <Card className="lg:col-span-2">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-medium">Evolución semanal</CardTitle>
        </CardHeader>
        <CardContent>
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={weeklyData} margin={{ top: 4, right: 8, left: -16, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
              <XAxis dataKey="label" tick={{ fontSize: 12 }} />
              <YAxis tick={{ fontSize: 12 }} />
              <Tooltip />
              <Legend wrapperStyle={{ fontSize: 12 }} />
              <Bar dataKey="empresas" name="Empresas" fill="#3b82f6" radius={[3, 3, 0, 0]} />
              <Bar dataKey="prospectos" name="Prospectos" fill="#10b981" radius={[3, 3, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-medium">Por SDR</CardTitle>
        </CardHeader>
        <CardContent>
          <ResponsiveContainer width="100%" height={200}>
            <BarChart data={sdrData} margin={{ top: 4, right: 8, left: -16, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
              <XAxis dataKey="rep" tick={{ fontSize: 12 }} />
              <YAxis tick={{ fontSize: 12 }} />
              <Tooltip />
              <Legend wrapperStyle={{ fontSize: 12 }} />
              <Bar dataKey="empresas" name="Empresas" fill="#3b82f6" radius={[3, 3, 0, 0]} />
              <Bar dataKey="prospectos" name="Prospectos" fill="#10b981" radius={[3, 3, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-medium">Por industria</CardTitle>
        </CardHeader>
        <CardContent>
          <ResponsiveContainer width="100%" height={200}>
            <BarChart data={industryData} layout="vertical" margin={{ top: 4, right: 16, left: 8, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" horizontal={false} />
              <XAxis type="number" tick={{ fontSize: 11 }} />
              <YAxis type="category" dataKey="industry" tick={{ fontSize: 11 }} width={80} tickFormatter={shortIndustry} />
              <Tooltip />
              <Legend wrapperStyle={{ fontSize: 12 }} />
              <Bar dataKey="empresas" name="Empresas" fill="#3b82f6" radius={[0, 3, 3, 0]} />
              <Bar dataKey="prospectos" name="Prospectos" fill="#10b981" radius={[0, 3, 3, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>

      <Card className="lg:col-span-2">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-medium">Prospectos por semana e industria</CardTitle>
        </CardHeader>
        <CardContent>
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={weekIndustryData.data} margin={{ top: 4, right: 8, left: -16, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
              <XAxis dataKey="label" tick={{ fontSize: 12 }} />
              <YAxis tick={{ fontSize: 12 }} />
              <Tooltip />
              <Legend wrapperStyle={{ fontSize: 11 }} />
              {weekIndustryData.industries.map((ind, i) => (
                <Bar key={ind} dataKey={ind} name={shortIndustry(ind)} stackId="a" fill={INDUSTRY_COLORS[i % INDUSTRY_COLORS.length]} />
              ))}
            </BarChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>

      <Card className="lg:col-span-2">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-medium">Ratio prospectos/empresa por semana</CardTitle>
        </CardHeader>
        <CardContent>
          <ResponsiveContainer width="100%" height={200}>
            <BarChart data={weeklyData} margin={{ top: 4, right: 8, left: -16, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
              <XAxis dataKey="label" tick={{ fontSize: 12 }} />
              <YAxis tick={{ fontSize: 12 }} />
              <Tooltip formatter={(v) => [`${v}`, "Ratio p/e"]} />
              <Bar dataKey="ratio" name="Ratio p/e" fill="#f97316" radius={[3, 3, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>

      <Card className="lg:col-span-2">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-medium">Ratio prospectos/empresa por industria</CardTitle>
        </CardHeader>
        <CardContent>
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={industryData} layout="vertical" margin={{ top: 4, right: 16, left: 8, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" horizontal={false} />
              <XAxis type="number" tick={{ fontSize: 11 }} />
              <YAxis type="category" dataKey="industry" tick={{ fontSize: 11 }} width={80} tickFormatter={shortIndustry} />
              <Tooltip formatter={(v) => [`${v}`, "Ratio p/e"]} />
              <Bar dataKey="ratio" name="Ratio p/e" fill="#f97316" radius={[0, 3, 3, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>

      <Card className="lg:col-span-2">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-medium">Prospectos por ICP y semana</CardTitle>
        </CardHeader>
        <CardContent>
          {icpByWeek.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">Sin datos de ICP todavía</p>
          ) : (
            <ResponsiveContainer width="100%" height={220}>
              <BarChart data={icpByWeek} margin={{ top: 4, right: 8, left: -16, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                <XAxis dataKey="label" tick={{ fontSize: 12 }} />
                <YAxis tick={{ fontSize: 12 }} />
                <Tooltip />
                <Legend wrapperStyle={{ fontSize: 12 }} />
                <Bar dataKey="score10" name="Score 10" stackId="a" fill="#10b981" />
                <Bar dataKey="score5" name="Score 5" stackId="a" fill="#f59e0b" />
                <Bar dataKey="score0" name="Score 0" stackId="a" fill="#d1d5db" radius={[3, 3, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          )}
        </CardContent>
      </Card>

      <Card className="lg:col-span-2">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-medium">Prospectos por ICP e industria</CardTitle>
        </CardHeader>
        <CardContent>
          {icpByIndustry.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">Sin datos de ICP todavía</p>
          ) : (
            <ResponsiveContainer width="100%" height={220}>
              <BarChart data={icpByIndustry} layout="vertical" margin={{ top: 4, right: 16, left: 8, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" horizontal={false} />
                <XAxis type="number" tick={{ fontSize: 11 }} />
                <YAxis type="category" dataKey="industry" tick={{ fontSize: 11 }} width={80} tickFormatter={shortIndustry} />
                <Tooltip />
                <Legend wrapperStyle={{ fontSize: 12 }} />
                <Bar dataKey="score10" name="Score 10" stackId="a" fill="#10b981" radius={[0, 0, 0, 0]} />
                <Bar dataKey="score5" name="Score 5" stackId="a" fill="#f59e0b" radius={[0, 0, 0, 0]} />
                <Bar dataKey="score0" name="Score 0" stackId="a" fill="#d1d5db" radius={[0, 3, 3, 0]} />
              </BarChart>
            </ResponsiveContainer>
          )}
        </CardContent>
      </Card>
      <Card className="lg:col-span-2">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-medium">Prospectos por ICP y semana</CardTitle>
        </CardHeader>
        <CardContent>
          {icpCatByWeek.data.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">Sin datos de ICP todavía</p>
          ) : (
            <ResponsiveContainer width="100%" height={220}>
              <BarChart data={icpCatByWeek.data} margin={{ top: 4, right: 8, left: -16, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                <XAxis dataKey="label" tick={{ fontSize: 12 }} />
                <YAxis tick={{ fontSize: 12 }} />
                <Tooltip />
                <Legend wrapperStyle={{ fontSize: 12 }} />
                {icpCatByWeek.categories.map((cat) => (
                  <Bar key={cat} dataKey={cat} name={cat} stackId="a" fill={ICP_CATEGORY_COLORS[cat] ?? "#94a3b8"} />
                ))}
              </BarChart>
            </ResponsiveContainer>
          )}
        </CardContent>
      </Card>

      <Card className="lg:col-span-2">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-medium">Prospectos por ICP e industria</CardTitle>
        </CardHeader>
        <CardContent>
          {icpCatByIndustry.data.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">Sin datos de ICP todavía</p>
          ) : (
            <ResponsiveContainer width="100%" height={220}>
              <BarChart data={icpCatByIndustry.data} layout="vertical" margin={{ top: 4, right: 16, left: 8, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" horizontal={false} />
                <XAxis type="number" tick={{ fontSize: 11 }} />
                <YAxis type="category" dataKey="industry" tick={{ fontSize: 11 }} width={80} tickFormatter={shortIndustry} />
                <Tooltip />
                <Legend wrapperStyle={{ fontSize: 12 }} />
                {icpCatByIndustry.categories.map((cat) => (
                  <Bar key={cat} dataKey={cat} name={cat} stackId="a" fill={ICP_CATEGORY_COLORS[cat] ?? "#94a3b8"} />
                ))}
              </BarChart>
            </ResponsiveContainer>
          )}
        </CardContent>
      </Card>
    </div>
  )
}

export function DashboardClient({ initialCampaigns, icpStats, icpCategoryStats, campaignIndustries = [], autoActionMap = {} }: { initialCampaigns: Campaign[]; icpStats: IcpStat[]; icpCategoryStats: IcpCategoryStat[]; campaignIndustries?: string[]; autoActionMap?: Record<string, { autoStatus: string; jobUrl: string | null }> }) {
  const [campaigns, setCampaigns] = useState<Campaign[]>(initialCampaigns)
  const [view, setView] = useState<"week" | "list" | "charts">("week")
  const [selectedWeek, setSelectedWeek] = useState(() => getWeekMonday(new Date()))
  const [weekStats, setWeekStats] = useState<{ validEmails: number; scoreGte5: number; sent: number } | null>(null)
  const [, startWeekStats] = useTransition()
  const [dialogOpen, setDialogOpen] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [form, setForm] = useState<FormData>(emptyForm())
  const [calOpen, setCalOpen] = useState(false)
  const [industryOpen, setIndustryOpen] = useState(false)
  const [isPending, startTransition] = useTransition()
  const searchRef = useRef<HTMLInputElement>(null)
  const router = useRouter()

  // Auto-refresh when there are active auto campaigns
  const activeAutoStatuses = ["pending", "company_search", "creating_list", "people_search", "enriching", "distributing"]
  const hasActiveAuto = Object.values(autoActionMap).some((a) => activeAutoStatuses.includes(a.autoStatus))
  useEffect(() => {
    if (!hasActiveAuto) return
    const interval = setInterval(() => router.refresh(), 10000)
    return () => clearInterval(interval)
  }, [hasActiveAuto, router])

  // Auto campaign wizard state
  const [campaignMode, setCampaignMode] = useState<"manual" | "auto">("manual")
  const [autoStep, setAutoStep] = useState(1)
  const [autoForm, setAutoForm] = useState<AutoForm>(emptyAutoForm())
  const [savedUrls, setSavedUrls] = useState<SavedUrl[]>([])
  const [distTemplates, setDistTemplates] = useState<DistributionTemplate[]>([])
  const [csUrlOpen, setCsUrlOpen] = useState(false)
  const [psUrlOpen, setPsUrlOpen] = useState(false)

  const allIndustries = useMemo(() => {
    const merged = new Set([...INDUSTRIES, ...campaignIndustries])
    return [...merged].sort()
  }, [campaignIndustries])

  const weekCampaigns = useMemo(() => {
    const weekKey = getISOWeekInfo(new Date(selectedWeek + "T12:00:00")).key
    return campaigns.filter((c) => {
      const date = parseCampaignDate(c.week_label)
      if (!date) return false
      return getISOWeekInfo(date).key === weekKey
    })
  }, [campaigns, selectedWeek])

  useEffect(() => {
    const ids = weekCampaigns.map((c) => c.id)
    setWeekStats(null)
    if (!ids.length) { setWeekStats({ validEmails: 0, scoreGte5: 0, sent: 0 }); return }
    startWeekStats(async () => {
      const stats = await getWeekStats(ids)
      setWeekStats(stats)
    })
  }, [selectedWeek, campaigns.length])

  const kpis = {
    campaignCount: weekCampaigns.length,
    accounts: weekCampaigns.reduce((s, c) => s + c.accounts_found, 0),
    prospects: weekCampaigns.reduce((s, c) => s + c.prospects_found, 0),
    sent: weekStats?.sent ?? null,
  }

  function openCreate() {
    setEditingId(null)
    setForm(emptyForm())
    setCampaignMode("manual")
    setAutoStep(1)
    setAutoForm(emptyAutoForm())
    setSavedUrls([])
    setDistTemplates([])
    setDialogOpen(true)
  }

  function openEdit(c: Campaign) {
    setEditingId(c.id)
    setCampaignMode("manual")
    setForm({ week_label: c.week_label, rep_name: c.rep_name, industry: c.industry, notes: c.notes ?? "" })
    setDialogOpen(true)
  }

  async function loadWizardData(repName: string, industry: string) {
    if (!repName || !industry) return
    const [urls, templates] = await Promise.all([
      getSavedUrlsForWizard(repName, industry),
      getDistributionTemplatesForWizard(),
    ])
    setSavedUrls(urls)
    setDistTemplates(templates)
  }

  function handleSave() {
    if (!form.rep_name || !form.industry || !form.week_label) return
    startTransition(async () => {
      if (editingId) {
        await updateCampaign(editingId, form)
        setCampaigns((prev) => prev.map((c) => c.id === editingId ? { ...c, ...form } : c))
      } else {
        await createCampaign(form)
        const newCampaign: Campaign = {
          id: crypto.randomUUID(),
          ...form,
          status: "pending",
          accounts_found: 0,
          prospects_found: 0,
          prospects_sent: 0,
        }
        setCampaigns((prev) => [newCampaign, ...prev])
      }
      setDialogOpen(false)
    })
  }

  function handleSaveAuto() {
    if (!form.rep_name || !form.industry || !form.week_label) return
    if (!autoForm.company_search_url || !autoForm.people_search_url) return
    startTransition(async () => {
      const scheduledAt = new Date().toISOString()
      const config: AutoCampaignConfig = {
        company_search_url: autoForm.company_search_url,
        company_count: autoForm.company_count,
        exclude_previous: autoForm.exclude_previous,
        exclusion_date_from: autoForm.exclusion_date_from || null,
        exclusion_date_to: autoForm.exclusion_date_to || null,
        start_page: autoForm.start_page,
        people_search_url: autoForm.people_search_url,
        people_count: autoForm.people_count,
        enrich_emails: autoForm.enrich_emails,
        enrich_phones: autoForm.enrich_phones,
        classify_icp: autoForm.classify_icp,
        normalize_names: autoForm.normalize_names,
        shortlist_icp_min: autoForm.auto_shortlist ? autoForm.shortlist_icp_min : null,
        shortlist_title_keywords: autoForm.auto_shortlist ? autoForm.shortlist_title_keywords || null : null,
        distribution_template_id: autoForm.distribution_template_id || null,
        distribution_template_name: autoForm.distribution_template_name || null,
        scheduled_at: scheduledAt,
      }
      const newId = await createAutoCampaign(form, config)
      const newCampaign: Campaign = {
        id: newId,
        ...form,
        status: "pending",
        accounts_found: 0,
        prospects_found: 0,
        prospects_sent: 0,
      }
      setCampaigns((prev) => [newCampaign, ...prev])
      setDialogOpen(false)
    })
  }

  function handleDelete(id: string) {
    startTransition(async () => {
      await deleteCampaign(id)
      setCampaigns((prev) => prev.filter((c) => c.id !== id))
    })
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Dashboard</h1>
          <p className="mt-0.5 text-sm text-muted-foreground">Planning semanal de campañas</p>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex rounded-md border">
            <button
              onClick={() => setView("week")}
              className={`px-2.5 py-1.5 rounded-l-md transition-colors ${view === "week" ? "bg-foreground text-background" : "hover:bg-muted/50"}`}
              title="Esta semana"
            >
              <CalendarDays className="size-4" />
            </button>
            <button
              onClick={() => setView("list")}
              className={`px-2.5 py-1.5 border-l transition-colors ${view === "list" ? "bg-foreground text-background" : "hover:bg-muted/50"}`}
              title="Todas las campañas"
            >
              <LayoutList className="size-4" />
            </button>
            <button
              onClick={() => setView("charts")}
              className={`px-2.5 py-1.5 rounded-r-md border-l transition-colors ${view === "charts" ? "bg-foreground text-background" : "hover:bg-muted/50"}`}
              title="Analytics"
            >
              <BarChart3 className="size-4" />
            </button>
          </div>
          <Button onClick={openCreate} disabled={isPending}>
            <Plus className="mr-2 size-4" />
            Nueva campaña
          </Button>
        </div>
      </div>

      {/* Week navigator — only visible in week view */}
      {view === "week" && (
        <div className="flex items-center justify-center gap-2">
          <button
            onClick={() => setSelectedWeek(addWeeks(selectedWeek, -1))}
            className="p-1.5 rounded-md hover:bg-muted/50 transition-colors"
          >
            <ChevronLeft className="size-4" />
          </button>
          <span className="text-sm font-medium w-56 text-center">
            {formatWeekRange(new Date(selectedWeek + "T12:00:00"))}
          </span>
          <button
            onClick={() => setSelectedWeek(addWeeks(selectedWeek, 1))}
            className="p-1.5 rounded-md hover:bg-muted/50 transition-colors"
          >
            <ChevronRight className="size-4" />
          </button>
        </div>
      )}

      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-1 pt-4 px-4">
            <CardTitle className="text-xs font-medium text-muted-foreground">Campañas</CardTitle>
            <CalendarDays className="size-3.5 text-muted-foreground" />
          </CardHeader>
          <CardContent className="px-4 pb-4">
            <div className="text-2xl font-bold">{view === "week" ? kpis.campaignCount : campaigns.length}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-1 pt-4 px-4">
            <CardTitle className="text-xs font-medium text-muted-foreground">Empresas</CardTitle>
            <Building2 className="size-3.5 text-muted-foreground" />
          </CardHeader>
          <CardContent className="px-4 pb-4">
            <div className="text-2xl font-bold">
              {view === "week"
                ? kpis.accounts.toLocaleString("es")
                : campaigns.reduce((s, c) => s + c.accounts_found, 0).toLocaleString("es")}
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-1 pt-4 px-4">
            <CardTitle className="text-xs font-medium text-muted-foreground">Prospectos</CardTitle>
            <Users className="size-3.5 text-muted-foreground" />
          </CardHeader>
          <CardContent className="px-4 pb-4">
            <div className="text-2xl font-bold">
              {view === "week"
                ? kpis.prospects.toLocaleString("es")
                : campaigns.reduce((s, c) => s + c.prospects_found, 0).toLocaleString("es")}
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-1 pt-4 px-4">
            <CardTitle className="text-xs font-medium text-muted-foreground">
              {view === "week" ? "Con email" : "Enviados"}
            </CardTitle>
            {view === "week" ? <Mail className="size-3.5 text-muted-foreground" /> : <Send className="size-3.5 text-muted-foreground" />}
          </CardHeader>
          <CardContent className="px-4 pb-4">
            <div className="text-2xl font-bold">
              {view === "week"
                ? (weekStats === null ? "…" : weekStats.validEmails.toLocaleString("es"))
                : campaigns.reduce((s, c) => s + c.prospects_sent, 0).toLocaleString("es")}
            </div>
          </CardContent>
        </Card>
      </div>

      {view === "week" && <WeeklyView campaigns={weekCampaigns} autoActionMap={autoActionMap} />}
      {view === "charts" && <ChartsView campaigns={campaigns} icpStats={icpStats} icpCategoryStats={icpCategoryStats} />}

      {view === "list" && <Tabs defaultValue="Todos">
        <TabsList>
          {REPS.map((r) => (
            <TabsTrigger key={r} value={r}>{r}</TabsTrigger>
          ))}
        </TabsList>
        {REPS.map((r) => {
          const tab = r === "Todos" ? campaigns : campaigns.filter((c) => c.rep_name === r)
          return (
            <TabsContent key={r} value={r} className="mt-3">
              <CampaignTable campaigns={tab} onEdit={openEdit} onDelete={handleDelete} isPending={isPending} autoActionMap={autoActionMap} />
            </TabsContent>
          )
        })}
      </Tabs>}

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className={campaignMode === "auto" && !editingId ? "sm:max-w-2xl" : "sm:max-w-md"}>
          <DialogHeader>
            <DialogTitle>{editingId ? "Editar campaña" : "Nueva campaña"}</DialogTitle>
          </DialogHeader>

          {/* Mode toggle — only on create */}
          {!editingId && (
            <div className="flex rounded-md border w-fit">
              <button
                type="button"
                onClick={() => { setCampaignMode("manual"); setAutoStep(1) }}
                className={`px-3 py-1.5 rounded-l-md text-sm transition-colors ${campaignMode === "manual" ? "bg-foreground text-background" : "hover:bg-muted/50"}`}
              >
                Manual
              </button>
              <button
                type="button"
                onClick={() => {
                  setCampaignMode("auto")
                  setAutoStep(1)
                  if (form.rep_name && form.industry) loadWizardData(form.rep_name, form.industry)
                }}
                className={`px-3 py-1.5 rounded-r-md border-l text-sm flex items-center gap-1.5 transition-colors ${campaignMode === "auto" ? "bg-foreground text-background" : "hover:bg-muted/50"}`}
              >
                <Zap className="size-3.5" />
                Automática
              </button>
            </div>
          )}

          {/* ── Step 1 / Campaign info — shared between both modes ── */}
          <div className="space-y-4 py-2">
            {campaignMode === "auto" && !editingId && (
              <div className="flex items-center gap-2 mb-1">
                {[1, 2, 3, 4, 5].map((s) => (
                  <div key={s} className="flex items-center gap-1">
                    <div className={`size-6 rounded-full flex items-center justify-center text-xs font-medium transition-colors ${autoStep === s ? "bg-primary text-primary-foreground" : autoStep > s ? "bg-green-100 text-green-700" : "bg-muted text-muted-foreground"}`}>
                      {autoStep > s ? <Check className="size-3" /> : s}
                    </div>
                    {s < 5 && <div className={`h-px w-4 ${autoStep > s ? "bg-green-300" : "bg-muted"}`} />}
                  </div>
                ))}
                <span className="ml-2 text-xs text-muted-foreground">
                  {["Campaña", "Company Search", "People Search", "Enrichment", "Horario"][autoStep - 1]}
                </span>
              </div>
            )}

            {/* Step 1: Campaign data */}
            {(campaignMode === "manual" || autoStep === 1) && (
              <>
                <div className="space-y-1.5">
                  <label className="text-sm font-medium">Fecha</label>
                  <Popover open={calOpen} onOpenChange={setCalOpen}>
                    <PopoverTrigger className="flex h-9 w-full items-center justify-start rounded-md border border-input bg-background px-3 text-sm font-normal hover:bg-accent hover:text-accent-foreground">
                      <CalendarIcon className="mr-2 size-4 text-muted-foreground" />
                      {form.week_label || "Seleccionar fecha"}
                    </PopoverTrigger>
                    <PopoverContent className="w-auto p-0" align="start">
                      <Calendar
                        mode="single"
                        selected={form.week_label ? new Date(form.week_label + "T12:00:00") : undefined}
                        onSelect={(d) => {
                          if (d) {
                            const monday = new Date(d)
                            monday.setDate(d.getDate() - (d.getDay() || 7) + 1)
                            setForm((f) => ({ ...f, week_label: formatDate(monday) }))
                            setCalOpen(false)
                          }
                        }}
                      />
                    </PopoverContent>
                  </Popover>
                </div>
                <div className="space-y-1.5">
                  <label className="text-sm font-medium">Rep</label>
                  <Select
                    value={form.rep_name}
                    onValueChange={(v) => {
                      setForm((f) => ({ ...f, rep_name: v ?? "" }))
                      const industry = form.industry
                      if (campaignMode === "auto" && v && industry) loadWizardData(v, industry)
                    }}
                  >
                    <SelectTrigger><SelectValue placeholder="Seleccionar rep" /></SelectTrigger>
                    <SelectContent>
                      {REP_OPTIONS.map((r) => <SelectItem key={r} value={r}>{r}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <label className="text-sm font-medium">Industria</label>
                  <Popover open={industryOpen} onOpenChange={setIndustryOpen}>
                    <PopoverTrigger className="flex h-9 w-full items-center justify-between rounded-md border border-input bg-background px-3 text-sm font-normal hover:bg-accent hover:text-accent-foreground">
                      <span className={form.industry ? "" : "text-muted-foreground"}>
                        {form.industry || "Seleccionar o escribir industria…"}
                      </span>
                      <ChevronsUpDown className="size-4 text-muted-foreground" />
                    </PopoverTrigger>
                    <PopoverContent className="w-[var(--radix-popover-trigger-width)] p-0" align="start">
                      <Command>
                        <CommandInput
                          placeholder="Buscar o escribir nueva…"
                          value={form.industry}
                          onValueChange={(v) => setForm((f) => ({ ...f, industry: v }))}
                        />
                        <CommandList>
                          <CommandEmpty>
                            <button
                              className="w-full px-3 py-2 text-left text-sm hover:bg-muted/50"
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
                                onSelect={() => {
                                  setForm((f) => ({ ...f, industry: i }))
                                  setIndustryOpen(false)
                                  if (campaignMode === "auto" && form.rep_name) loadWizardData(form.rep_name, i)
                                }}
                              >
                                <Check className={`mr-2 size-4 ${form.industry === i ? "opacity-100" : "opacity-0"}`} />
                                {i}
                              </CommandItem>
                            ))}
                          </CommandGroup>
                        </CommandList>
                      </Command>
                    </PopoverContent>
                  </Popover>
                </div>
                <div className="space-y-1.5">
                  <label className="text-sm font-medium text-muted-foreground">Notas (opcional)</label>
                  <Input
                    value={form.notes}
                    onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
                    placeholder="Notas..."
                  />
                </div>
              </>
            )}

            {/* Step 2: Company Search */}
            {campaignMode === "auto" && autoStep === 2 && (
              <div className="space-y-4">
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between">
                    <label className="text-sm font-medium">URL de Sales Nav (Company Search)</label>
                    {savedUrls.filter((u) => u.url_type === "company_search").length > 0 && (
                      <Popover open={csUrlOpen} onOpenChange={setCsUrlOpen}>
                        <PopoverTrigger className="inline-flex items-center gap-1 h-7 px-2 rounded-md border border-input bg-background text-xs font-medium hover:bg-accent hover:text-accent-foreground">
                          URLs guardadas <ChevronDown className="size-3" />
                        </PopoverTrigger>
                        <PopoverContent className="w-80 p-2" align="end">
                          <div className="space-y-1">
                            {savedUrls.filter((u) => u.url_type === "company_search").map((u) => (
                              <button
                                key={u.id}
                                className="w-full text-left px-2 py-1.5 rounded text-xs hover:bg-muted/50 truncate"
                                onClick={() => {
                                  setAutoForm((f) => ({ ...f, company_search_url: u.url }))
                                  setCsUrlOpen(false)
                                }}
                              >
                                {u.label || u.url.slice(0, 60) + "…"}
                              </button>
                            ))}
                          </div>
                        </PopoverContent>
                      </Popover>
                    )}
                  </div>
                  <textarea
                    className="w-full min-h-[80px] rounded-md border border-input bg-background px-3 py-2 text-sm resize-none focus:outline-none focus:ring-1 focus:ring-ring"
                    placeholder="https://www.linkedin.com/sales/search/company?..."
                    value={autoForm.company_search_url}
                    onChange={(e) => setAutoForm((f) => ({ ...f, company_search_url: e.target.value }))}
                  />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1.5">
                    <label className="text-sm font-medium">Empresas a scrapear</label>
                    <Input
                      type="number"
                      min={1}
                      max={500}
                      value={autoForm.company_count}
                      onChange={(e) => setAutoForm((f) => ({ ...f, company_count: parseInt(e.target.value) || 50 }))}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-sm font-medium">Página de inicio</label>
                    <Input
                      type="number"
                      min={1}
                      value={autoForm.start_page}
                      onChange={(e) => setAutoForm((f) => ({ ...f, start_page: parseInt(e.target.value) || 1 }))}
                    />
                  </div>
                </div>
                <div className="space-y-2">
                  <div className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      id="exclude_previous"
                      checked={autoForm.exclude_previous}
                      onChange={(e) => setAutoForm((f) => ({ ...f, exclude_previous: e.target.checked }))}
                      className="size-4"
                    />
                    <label htmlFor="exclude_previous" className="text-sm font-medium">Excluir listas de semanas anteriores</label>
                  </div>
                  {autoForm.exclude_previous && (
                    <div className="space-y-2 pl-6">
                      <div className="flex items-center gap-2">
                        <input
                          type="checkbox"
                          id="filter_by_date_range"
                          checked={autoForm.filter_by_date_range}
                          onChange={(e) => setAutoForm((f) => ({ ...f, filter_by_date_range: e.target.checked, exclusion_date_from: "", exclusion_date_to: "" }))}
                          className="size-4"
                        />
                        <label htmlFor="filter_by_date_range" className="text-sm text-muted-foreground">Filtrar por rango de fechas</label>
                      </div>
                      {autoForm.filter_by_date_range && (
                        <div className="grid grid-cols-2 gap-3">
                          <div className="space-y-1">
                            <label className="text-xs text-muted-foreground">Desde</label>
                            <Input type="date" value={autoForm.exclusion_date_from} onChange={(e) => setAutoForm((f) => ({ ...f, exclusion_date_from: e.target.value }))} className="h-8 text-sm" />
                          </div>
                          <div className="space-y-1">
                            <label className="text-xs text-muted-foreground">Hasta</label>
                            <Input type="date" value={autoForm.exclusion_date_to} onChange={(e) => setAutoForm((f) => ({ ...f, exclusion_date_to: e.target.value }))} className="h-8 text-sm" />
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* Step 3: People Search */}
            {campaignMode === "auto" && autoStep === 3 && (
              <div className="space-y-4">
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between">
                    <label className="text-sm font-medium">URL de Sales Nav (People Search)</label>
                    {savedUrls.filter((u) => u.url_type === "people_search").length > 0 && (
                      <Popover open={psUrlOpen} onOpenChange={setPsUrlOpen}>
                        <PopoverTrigger className="inline-flex items-center gap-1 h-7 px-2 rounded-md border border-input bg-background text-xs font-medium hover:bg-accent hover:text-accent-foreground">
                          URLs guardadas <ChevronDown className="size-3" />
                        </PopoverTrigger>
                        <PopoverContent className="w-80 p-2" align="end">
                          <div className="space-y-1">
                            {savedUrls.filter((u) => u.url_type === "people_search").map((u) => (
                              <button
                                key={u.id}
                                className="w-full text-left px-2 py-1.5 rounded text-xs hover:bg-muted/50 truncate"
                                onClick={() => {
                                  setAutoForm((f) => ({ ...f, people_search_url: u.url }))
                                  setPsUrlOpen(false)
                                }}
                              >
                                {u.label || u.url.slice(0, 60) + "…"}
                              </button>
                            ))}
                          </div>
                        </PopoverContent>
                      </Popover>
                    )}
                  </div>
                  <textarea
                    className="w-full min-h-[80px] rounded-md border border-input bg-background px-3 py-2 text-sm resize-none focus:outline-none focus:ring-1 focus:ring-ring"
                    placeholder="https://www.linkedin.com/sales/search/people?..."
                    value={autoForm.people_search_url}
                    onChange={(e) => setAutoForm((f) => ({ ...f, people_search_url: e.target.value }))}
                  />
                  <p className="text-xs text-muted-foreground">El Account List de las empresas scrapeadas se inyecta automáticamente en esta URL al correr.</p>
                </div>
                <div className="space-y-1.5">
                  <label className="text-sm font-medium">Personas a scrapear</label>
                  <Input
                    type="number"
                    min={1}
                    max={1000}
                    value={autoForm.people_count}
                    onChange={(e) => setAutoForm((f) => ({ ...f, people_count: parseInt(e.target.value) || 100 }))}
                  />
                </div>
              </div>
            )}

            {/* Step 4: Enrichment */}
            {campaignMode === "auto" && autoStep === 4 && (
              <div className="space-y-4">
                <div className="grid grid-cols-2 gap-3">
                  {[
                    { key: "enrich_emails", label: "Buscar emails" },
                    { key: "enrich_phones", label: "Buscar teléfonos" },
                    { key: "classify_icp", label: "Clasificar ICP" },
                    { key: "normalize_names", label: "Normalizar nombres" },
                  ].map(({ key, label }) => (
                    <div key={key} className="flex items-center gap-2">
                      <input
                        type="checkbox"
                        id={key}
                        checked={autoForm[key as keyof AutoForm] as boolean}
                        onChange={(e) => setAutoForm((f) => ({ ...f, [key]: e.target.checked }))}
                        className="size-4"
                      />
                      <label htmlFor={key} className="text-sm">{label}</label>
                    </div>
                  ))}
                </div>
                <div className="space-y-3 pt-1 border-t">
                  <div className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      id="auto_shortlist"
                      checked={autoForm.auto_shortlist}
                      onChange={(e) => setAutoForm((f) => ({ ...f, auto_shortlist: e.target.checked }))}
                      className="size-4"
                    />
                    <label htmlFor="auto_shortlist" className="text-sm font-medium">Auto-shortlist</label>
                  </div>
                  {autoForm.auto_shortlist && (
                    <div className="space-y-3 pl-6">
                      <div className="space-y-1.5">
                        <label className="text-sm font-medium">ICP score mínimo</label>
                        <Input
                          type="number"
                          min={0}
                          max={10}
                          value={autoForm.shortlist_icp_min}
                          onChange={(e) => setAutoForm((f) => ({ ...f, shortlist_icp_min: parseInt(e.target.value) ?? 10 }))}
                        />
                        <p className="text-xs text-muted-foreground">Personas con score ≥ este valor pasan directo a Shortlist</p>
                      </div>
                      <div className="space-y-1.5">
                        <label className="text-sm font-medium">Cargos para shortlist (opcional)</label>
                        <Input
                          placeholder="CEO, Founder, Director, VP…"
                          value={autoForm.shortlist_title_keywords}
                          onChange={(e) => setAutoForm((f) => ({ ...f, shortlist_title_keywords: e.target.value }))}
                        />
                        <p className="text-xs text-muted-foreground">Comma-separado, case-insensitive</p>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* Step 5: Distribution */}
            {campaignMode === "auto" && autoStep === 5 && (
              <div className="space-y-4">
                <div className="space-y-1.5">
                  <label className="text-sm font-medium">Template de distribución</label>
                  <Select
                    value={autoForm.distribution_template_id}
                    onValueChange={(v) => {
                      const tmpl = distTemplates.find((t) => t.id === v)
                      setAutoForm((f) => ({ ...f, distribution_template_id: v ?? "", distribution_template_name: tmpl?.name ?? "" }))
                    }}
                  >
                    <SelectTrigger><SelectValue placeholder="Sin distribución automática" /></SelectTrigger>
                    <SelectContent>
                      {distTemplates.map((t) => (
                        <SelectItem key={t.id} value={t.id}>{t.name}{t.industry ? ` — ${t.industry}` : ""}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <p className="text-xs text-muted-foreground">Opcional — si no elegís template, el pipeline termina en enrichment</p>
                </div>
                {/* Summary */}
                <div className="rounded-md bg-muted/40 p-3 space-y-1.5 text-sm">
                  <p className="font-medium text-xs uppercase tracking-wide text-muted-foreground mb-2">Resumen</p>
                  <p><span className="text-muted-foreground">Campaña:</span> {form.rep_name} · {form.industry} · {form.week_label}</p>
                  <p><span className="text-muted-foreground">Company Search:</span> {autoForm.company_count} empresas{autoForm.exclude_previous ? " · excluye listas anteriores" : ""}</p>
                  <p><span className="text-muted-foreground">People Search:</span> {autoForm.people_count} personas</p>
                  <p><span className="text-muted-foreground">Enrichment:</span> {[autoForm.enrich_emails && "emails", autoForm.enrich_phones && "teléfonos", autoForm.classify_icp && "ICP", autoForm.normalize_names && "normalización"].filter(Boolean).join(", ")}</p>
                  <p><span className="text-muted-foreground">Shortlist:</span> {autoForm.auto_shortlist ? `ICP ≥ ${autoForm.shortlist_icp_min}${autoForm.shortlist_title_keywords ? ` + "${autoForm.shortlist_title_keywords}"` : ""}` : "desactivado"}</p>
                  <p><span className="text-muted-foreground">Distribución:</span> {autoForm.distribution_template_name || "ninguna"}</p>
                  <p className="text-xs text-muted-foreground pt-1">La campaña arranca en los próximos minutos automáticamente.</p>
                </div>
              </div>
            )}
          </div>

          <DialogFooter className="flex-row gap-2 justify-between sm:justify-between">
            {campaignMode === "auto" && !editingId && autoStep > 1 ? (
              <Button variant="outline" onClick={() => setAutoStep((s) => s - 1)}>Atrás</Button>
            ) : (
              <Button variant="outline" onClick={() => setDialogOpen(false)}>Cancelar</Button>
            )}
            {campaignMode === "manual" || editingId ? (
              <Button onClick={handleSave} disabled={isPending || !form.rep_name || !form.industry || !form.week_label}>
                {isPending ? "Guardando..." : editingId ? "Guardar cambios" : "Crear campaña"}
              </Button>
            ) : autoStep < 5 ? (
              <Button
                onClick={() => {
                  if (autoStep === 1 && form.rep_name && form.industry) {
                    loadWizardData(form.rep_name, form.industry)
                  }
                  setAutoStep((s) => s + 1)
                }}
                disabled={
                  (autoStep === 1 && (!form.rep_name || !form.industry || !form.week_label)) ||
                  (autoStep === 2 && !autoForm.company_search_url) ||
                  (autoStep === 3 && !autoForm.people_search_url)
                }
              >
                Siguiente
              </Button>
            ) : (
              <Button
                onClick={handleSaveAuto}
                disabled={isPending}
              >
                {isPending ? "Creando..." : "Crear campaña automática"}
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
