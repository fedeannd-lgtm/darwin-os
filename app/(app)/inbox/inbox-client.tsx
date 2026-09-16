"use client"

import { useState, useTransition } from "react"
import {
  Loader2, Send, X, RefreshCw, Copy, Check, ExternalLink,
  MessageSquare, Mail, ChevronDown, ChevronRight, Inbox, Sparkles,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Card } from "@/components/ui/card"
import type { ProspectReply } from "./actions"
import { sendReply, dismissReply, regenerateDraft, getReplies } from "./actions"

// ── helpers ────────────────────────────────────────────────────────────────────

function prospectLabel(r: ProspectReply): string {
  const p = r.prospects
  return p?.full_name || `${p?.first_name ?? ""} ${p?.last_name ?? ""}`.trim() || r.sender_name || "Desconocido"
}

function timeAgo(ts: string | null): string {
  if (!ts) return ""
  const diff = Date.now() - new Date(ts).getTime()
  const m = Math.floor(diff / 60000)
  if (m < 60) return `hace ${m}m`
  const h = Math.floor(m / 60)
  if (h < 24) return `hace ${h}h`
  return `hace ${Math.floor(h / 24)}d`
}

function stripHtml(html: string): string {
  return html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim()
}

// ── badge configs ───────────────────────────────────────────────────────────────

const INTENT_CFG: Record<string, { label: string; cls: string }> = {
  interested:     { label: "Interesado",     cls: "bg-green-100 text-green-800" },
  not_interested: { label: "No interesado",  cls: "bg-red-100 text-red-700" },
  question:       { label: "Pregunta",       cls: "bg-blue-100 text-blue-800" },
  other:          { label: "Otro",           cls: "bg-zinc-100 text-zinc-600" },
}

const STATUS_CFG: Record<string, { label: string; cls: string }> = {
  pending_review: { label: "Pendiente", cls: "bg-amber-100 text-amber-800" },
  draft_ready:    { label: "Draft listo", cls: "bg-blue-100 text-blue-800" },
  sent:           { label: "Enviado",   cls: "bg-green-100 text-green-800" },
  dismissed:      { label: "Descartado", cls: "bg-zinc-100 text-zinc-500" },
}

const SOURCE_CFG: Record<string, { label: string; icon: React.ReactNode }> = {
  smartlead: { label: "Email", icon: <Mail className="size-3" /> },
  heyreach:  { label: "LinkedIn", icon: <MessageSquare className="size-3" /> },
}

// ── filter helpers ─────────────────────────────────────────────────────────────

type StatusFilter = "all" | "pending_review" | "draft_ready" | "sent" | "dismissed"
type SourceFilter = "all" | "smartlead" | "heyreach"
type IntentFilter = "all" | "interested" | "not_interested" | "question" | "other"

function FilterChip({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-medium transition-colors ${
        active ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground hover:bg-accent"
      }`}
    >
      {children}
    </button>
  )
}

// ── reply card (left panel) ────────────────────────────────────────────────────

function ReplyCard({ reply, selected, onClick }: { reply: ProspectReply; selected: boolean; onClick: () => void }) {
  const intent = reply.intent ? INTENT_CFG[reply.intent] : null
  const source = SOURCE_CFG[reply.source] ?? SOURCE_CFG.smartlead
  const p = reply.prospects

  return (
    <button
      onClick={onClick}
      className={`w-full text-left rounded-lg border p-3 transition-colors hover:bg-accent ${selected ? "border-primary bg-primary/5" : "border-border bg-card"}`}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex items-center gap-1.5 flex-wrap">
            <span className="font-medium text-sm truncate">{prospectLabel(reply)}</span>
            {intent && (
              <span className={`inline-flex items-center rounded-full px-1.5 py-0 text-[10px] font-medium ${intent.cls}`}>
                {intent.label}
              </span>
            )}
          </div>
          <div className="text-xs text-muted-foreground mt-0.5 truncate">
            {p?.job_title ?? ""}{p?.job_title && p?.company_name ? " · " : ""}{p?.company_name ?? ""}
          </div>
          <div className="text-xs text-muted-foreground mt-1 line-clamp-2">
            {reply.subject ? <span className="font-medium">{reply.subject} — </span> : null}
            {stripHtml(reply.body).slice(0, 120)}
          </div>
        </div>
        <div className="flex flex-col items-end gap-1 shrink-0">
          <span className="text-[10px] text-muted-foreground">{timeAgo(reply.replied_at)}</span>
          <span className={`inline-flex items-center gap-1 rounded-full px-1.5 py-0 text-[10px] font-medium ${STATUS_CFG[reply.status]?.cls}`}>
            {STATUS_CFG[reply.status]?.label}
          </span>
          <span className="inline-flex items-center gap-0.5 text-[10px] text-muted-foreground">
            {source.icon} {source.label}
          </span>
        </div>
      </div>
    </button>
  )
}

// ── detail panel (right panel) ─────────────────────────────────────────────────

function ThreadHistory({ history }: { history: unknown }) {
  const [open, setOpen] = useState(false)
  if (!history || !Array.isArray(history) || history.length === 0) return null

  return (
    <div className="mt-3">
      <button
        onClick={() => setOpen(!open)}
        className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
      >
        {open ? <ChevronDown className="size-3" /> : <ChevronRight className="size-3" />}
        Ver historial ({(history as unknown[]).length} mensajes anteriores)
      </button>
      {open && (
        <div className="mt-2 space-y-2 border-l-2 border-border pl-3">
          {(history as Record<string, unknown>[]).map((msg, i) => {
            const type = String(msg.type ?? msg.message_type ?? "")
            const body = String(msg.email_body ?? msg.body ?? "")
            return (
              <div key={i} className="text-xs text-muted-foreground">
                <span className={`font-medium ${type === "SENT" ? "text-primary" : "text-foreground"}`}>
                  {type === "SENT" ? "Enviado" : "Recibido"}:
                </span>{" "}
                {stripHtml(body).slice(0, 300)}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

function DetailPanel({ reply, onStatusChange }: { reply: ProspectReply; onStatusChange: (id: string, status: string) => void }) {
  const [draft, setDraft] = useState(reply.ai_draft ?? "")
  const [isPending, startTransition] = useTransition()
  const [action, setAction] = useState<"send" | "dismiss" | "regen" | "copy" | null>(null)
  const [copied, setCopied] = useState(false)
  const [errorMsg, setErrorMsg] = useState("")

  const p = reply.prospects
  const intent = reply.intent ? INTENT_CFG[reply.intent] : null
  const noDraft = !reply.ai_draft && !draft
  const canSend = reply.source === "smartlead" && reply.reply_message_id

  function handleSend() {
    if (!draft.trim()) return
    setErrorMsg("")
    setAction("send")
    startTransition(async () => {
      const result = await sendReply(reply.id, draft)
      if (result.ok) {
        onStatusChange(reply.id, "sent")
      } else {
        setErrorMsg(result.error ?? "Error al enviar")
      }
      setAction(null)
    })
  }

  function handleDismiss() {
    setAction("dismiss")
    startTransition(async () => {
      await dismissReply(reply.id)
      onStatusChange(reply.id, "dismissed")
      setAction(null)
    })
  }

  function handleRegen() {
    setAction("regen")
    startTransition(async () => {
      const updated = await regenerateDraft(reply.id)
      if (updated?.ai_draft) setDraft(updated.ai_draft)
      setAction(null)
    })
  }

  function handleCopy() {
    navigator.clipboard.writeText(draft)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Header */}
      <div className="border-b px-5 py-4 shrink-0">
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="flex items-center gap-2 flex-wrap">
              <span className="font-semibold text-base">{prospectLabel(reply)}</span>
              {intent && (
                <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${intent.cls}`}>
                  {intent.label}
                </span>
              )}
              <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_CFG[reply.status]?.cls}`}>
                {STATUS_CFG[reply.status]?.label}
              </span>
            </div>
            <div className="mt-1 text-sm text-muted-foreground">
              {p?.job_title}{p?.job_title && p?.company_name ? " · " : ""}{p?.company_name}
              {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
              {(p?.accounts as any)?.industry ? ` · ${(p?.accounts as any).industry}` : ""}
            </div>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            {reply.source === "heyreach" && p?.linkedin_url && (
              <a href={p.linkedin_url} target="_blank" rel="noopener noreferrer"
                className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
                <ExternalLink className="size-3" /> LinkedIn
              </a>
            )}
            <span className="text-xs text-muted-foreground">{timeAgo(reply.replied_at)}</span>
          </div>
        </div>
        {reply.ai_reasoning && (
          <p className="mt-2 text-xs text-muted-foreground italic">
            IA: {reply.ai_reasoning}
          </p>
        )}
      </div>

      {/* Body */}
      <div className="flex-1 overflow-y-auto px-5 py-4 space-y-5">
        {/* Incoming reply */}
        <div>
          <div className="text-xs font-medium text-muted-foreground mb-2 uppercase tracking-wide">
            {reply.subject ? `"${reply.subject}" — ` : ""}Respuesta recibida
          </div>
          <div className="rounded-lg border bg-muted/30 px-4 py-3 text-sm whitespace-pre-wrap leading-relaxed">
            {stripHtml(reply.body)}
          </div>
          <ThreadHistory history={reply.thread_history} />
        </div>

        {/* AI Draft */}
        <div>
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
              Borrador IA
            </span>
            {!noDraft && (
              <button
                onClick={handleRegen}
                disabled={isPending}
                className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground disabled:opacity-50"
              >
                {action === "regen" ? <Loader2 className="size-3 animate-spin" /> : <RefreshCw className="size-3" />}
                Regenerar
              </button>
            )}
          </div>

          {noDraft ? (
            <div className="rounded-lg border bg-muted/20 px-4 py-8 flex flex-col items-center justify-center gap-3 text-sm text-muted-foreground">
              <p className="text-center text-xs">El borrador no fue generado automáticamente.</p>
              <Button
                size="sm"
                variant="outline"
                onClick={handleRegen}
                disabled={action === "regen"}
              >
                {action === "regen"
                  ? <><Loader2 className="mr-2 size-3.5 animate-spin" /> Generando…</>
                  : <><Sparkles className="mr-2 size-3.5" /> Generar borrador IA</>}
              </Button>
            </div>
          ) : (
            <textarea
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              disabled={reply.status === "sent" || reply.status === "dismissed"}
              rows={10}
              placeholder="El borrador aparecerá aquí…"
              className="w-full rounded-lg border bg-background px-4 py-3 text-sm leading-relaxed resize-none focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:opacity-60 disabled:cursor-not-allowed"
            />
          )}

          {errorMsg && (
            <p className="mt-1.5 text-xs text-destructive">{errorMsg}</p>
          )}
        </div>
      </div>

      {/* Footer actions */}
      {reply.status !== "sent" && reply.status !== "dismissed" && (
        <div className="border-t px-5 py-3 flex items-center gap-2 shrink-0 bg-background">
          {canSend ? (
            <Button
              size="sm"
              onClick={handleSend}
              disabled={isPending || !draft.trim() || noDraft}
            >
              {action === "send" ? <Loader2 className="mr-2 size-4 animate-spin" /> : <Send className="mr-2 size-4" />}
              Enviar respuesta
            </Button>
          ) : (
            <Button
              size="sm"
              variant="outline"
              onClick={handleCopy}
              disabled={!draft.trim()}
            >
              {copied ? <Check className="mr-2 size-4" /> : <Copy className="mr-2 size-4" />}
              {copied ? "Copiado" : "Copiar borrador"}
            </Button>
          )}
          <Button
            size="sm"
            variant="ghost"
            onClick={handleDismiss}
            disabled={isPending}
            className="text-muted-foreground"
          >
            {action === "dismiss" ? <Loader2 className="mr-2 size-4 animate-spin" /> : <X className="mr-2 size-4" />}
            Descartar
          </Button>
        </div>
      )}
      {reply.status === "sent" && reply.sent_body && (
        <div className="border-t px-5 py-3 shrink-0 bg-background">
          <p className="text-xs text-green-700 font-medium">Enviado · {timeAgo(reply.sent_at)}</p>
        </div>
      )}
    </div>
  )
}

// ── main component ──────────────────────────────────────────────────────────────

export function InboxClient({ initialReplies }: { initialReplies: ProspectReply[] }) {
  const [replies, setReplies] = useState<ProspectReply[]>(initialReplies)
  const [selected, setSelected] = useState<ProspectReply | null>(replies[0] ?? null)
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all")
  const [sourceFilter, setSourceFilter] = useState<SourceFilter>("all")
  const [intentFilter, setIntentFilter] = useState<IntentFilter>("all")
  const [refreshing, startRefresh] = useTransition()

  function handleRefresh() {
    startRefresh(async () => {
      const fresh = await getReplies("all")
      setReplies(fresh)
      if (selected) {
        const updated = fresh.find((r) => r.id === selected.id)
        if (updated) setSelected(updated)
      }
    })
  }

  function handleStatusChange(id: string, status: string) {
    setReplies((prev) => prev.map((r) => r.id === id ? { ...r, status } : r))
    if (selected?.id === id) setSelected((prev) => prev ? { ...prev, status } : prev)
  }

  const filtered = replies.filter((r) => {
    if (statusFilter !== "all" && r.status !== statusFilter) return false
    if (sourceFilter !== "all" && r.source !== sourceFilter) return false
    if (intentFilter !== "all" && r.intent !== intentFilter) return false
    return true
  })

  const pendingCount = replies.filter((r) => r.status === "pending_review" || r.status === "draft_ready").length

  return (
    <div className="flex flex-col h-[calc(100vh-3.5rem-3rem)] -m-6">
      {/* Top bar */}
      <div className="border-b px-6 py-3 flex items-center justify-between gap-4 shrink-0">
        <div className="flex items-center gap-3">
          <h1 className="text-lg font-semibold">Inbox</h1>
          {pendingCount > 0 && (
            <span className="inline-flex items-center rounded-full bg-primary px-2 py-0.5 text-xs font-medium text-primary-foreground">
              {pendingCount}
            </span>
          )}
        </div>
        <button onClick={handleRefresh} disabled={refreshing}
          className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground disabled:opacity-50">
          <RefreshCw className={`size-3.5 ${refreshing ? "animate-spin" : ""}`} />
          Actualizar
        </button>
      </div>

      {/* Filters */}
      <div className="border-b px-6 py-2 flex items-center gap-2 flex-wrap shrink-0 bg-muted/20">
        <div className="flex items-center gap-1">
          <FilterChip active={statusFilter === "all"} onClick={() => setStatusFilter("all")}>Todos</FilterChip>
          <FilterChip active={statusFilter === "pending_review"} onClick={() => setStatusFilter("pending_review")}>Pendiente</FilterChip>
          <FilterChip active={statusFilter === "draft_ready"} onClick={() => setStatusFilter("draft_ready")}>Draft listo</FilterChip>
          <FilterChip active={statusFilter === "sent"} onClick={() => setStatusFilter("sent")}>Enviados</FilterChip>
          <FilterChip active={statusFilter === "dismissed"} onClick={() => setStatusFilter("dismissed")}>Descartados</FilterChip>
        </div>
        <div className="w-px h-4 bg-border mx-1" />
        <div className="flex items-center gap-1">
          <FilterChip active={sourceFilter === "all"} onClick={() => setSourceFilter("all")}>Email + LinkedIn</FilterChip>
          <FilterChip active={sourceFilter === "smartlead"} onClick={() => setSourceFilter("smartlead")}>Email</FilterChip>
          <FilterChip active={sourceFilter === "heyreach"} onClick={() => setSourceFilter("heyreach")}>LinkedIn</FilterChip>
        </div>
        <div className="w-px h-4 bg-border mx-1" />
        <div className="flex items-center gap-1">
          <FilterChip active={intentFilter === "all"} onClick={() => setIntentFilter("all")}>Todos</FilterChip>
          <FilterChip active={intentFilter === "interested"} onClick={() => setIntentFilter("interested")}>Interesados</FilterChip>
          <FilterChip active={intentFilter === "not_interested"} onClick={() => setIntentFilter("not_interested")}>No interesados</FilterChip>
          <FilterChip active={intentFilter === "question"} onClick={() => setIntentFilter("question")}>Preguntas</FilterChip>
        </div>
      </div>

      {/* Main */}
      <div className="flex flex-1 overflow-hidden">
        {/* Left: reply list */}
        <div className="w-80 shrink-0 border-r overflow-y-auto">
          {filtered.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full gap-3 text-muted-foreground py-16">
              <Inbox className="size-8 opacity-30" />
              <p className="text-sm">Sin respuestas</p>
            </div>
          ) : (
            <div className="p-3 space-y-2">
              {filtered.map((r) => (
                <ReplyCard
                  key={r.id}
                  reply={r}
                  selected={selected?.id === r.id}
                  onClick={() => setSelected(r)}
                />
              ))}
            </div>
          )}
        </div>

        {/* Right: detail */}
        <div className="flex-1 overflow-hidden">
          {selected ? (
            <DetailPanel
              key={selected.id}
              reply={selected}
              onStatusChange={handleStatusChange}
            />
          ) : (
            <div className="flex flex-col items-center justify-center h-full gap-3 text-muted-foreground">
              <Inbox className="size-10 opacity-20" />
              <p className="text-sm">Seleccioná una respuesta para ver el detalle</p>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
