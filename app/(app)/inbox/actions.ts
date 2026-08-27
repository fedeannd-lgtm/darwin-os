"use server"

import { revalidatePath } from "next/cache"
import { supabase, supabaseAdmin } from "@/lib/supabase"
import { sendSmartleadReply } from "@/lib/smartlead"

export type ProspectReply = {
  id: string
  created_at: string
  source: string
  external_lead_id: string | null
  external_campaign_id: string | null
  reply_message_id: string | null
  replied_at: string | null
  subject: string | null
  body: string
  thread_history: unknown
  sender_name: string | null
  sender_email: string | null
  intent: string | null
  ai_draft: string | null
  ai_reasoning: string | null
  status: string
  sent_at: string | null
  sent_body: string | null
  prospect_id: string | null
  campaign_id: string | null
  prospects: {
    full_name: string | null
    first_name: string | null
    last_name: string | null
    job_title: string | null
    company_name: string | null
    linkedin_url: string | null
    icp_category: string | null
    accounts: { industry: string | null } | null
  } | null
}

export type InboxConfig = {
  product_context: string | null
  calendly_link: string | null
  exclude_clients: boolean | null
}

export async function getReplies(filter: "pending_review" | "draft_ready" | "sent" | "dismissed" | "all" = "all"): Promise<ProspectReply[]> {
  let q = supabase
    .from("prospect_replies")
    .select(`
      id, created_at, source, external_lead_id, external_campaign_id,
      reply_message_id, replied_at, subject, body, thread_history,
      sender_name, sender_email, intent, ai_draft, ai_reasoning,
      status, sent_at, sent_body, prospect_id, campaign_id,
      prospects (
        full_name, first_name, last_name, job_title, company_name,
        linkedin_url, icp_category,
        accounts ( industry )
      )
    `)
    .order("replied_at", { ascending: false })

  if (filter !== "all") q = q.eq("status", filter)

  const { data, error } = await q
  if (error) throw new Error(error.message)
  return (data ?? []) as unknown as ProspectReply[]
}

export async function getPendingCount(): Promise<number> {
  const { count, error } = await supabase
    .from("prospect_replies")
    .select("id", { count: "exact", head: true })
    .in("status", ["pending_review", "draft_ready"])
  if (error) return 0
  return count ?? 0
}

export async function getInboxConfig(): Promise<InboxConfig> {
  const { data } = await supabase
    .from("inbox_config")
    .select("product_context, calendly_link, exclude_clients")
    .eq("id", 1)
    .single()
  return { product_context: data?.product_context ?? null, calendly_link: data?.calendly_link ?? null, exclude_clients: data?.exclude_clients ?? null }
}

export async function saveInboxConfig(config: InboxConfig): Promise<void> {
  await supabaseAdmin
    .from("inbox_config")
    .upsert({ id: 1, ...config, updated_at: new Date().toISOString() }, { onConflict: "id" })
  revalidatePath("/settings")
}

export async function sendReply(replyId: string, draftBody: string): Promise<{ ok: boolean; error?: string }> {
  const { data: reply, error } = await supabase
    .from("prospect_replies")
    .select("source, external_lead_id, external_campaign_id, reply_message_id, replied_at")
    .eq("id", replyId)
    .single()

  if (error || !reply) return { ok: false, error: "Reply no encontrada" }

  if (reply.source === "smartlead") {
    if (!reply.external_lead_id || !reply.external_campaign_id || !reply.reply_message_id) {
      return { ok: false, error: "Faltan datos para enviar por Smartlead" }
    }
    const result = await sendSmartleadReply({
      campaignId: reply.external_campaign_id,
      leadId: reply.external_lead_id,
      emailBody: draftBody,
      replyMessageId: reply.reply_message_id,
      replyEmailTime: new Date().toISOString(),
    })
    if (!result.ok) return { ok: false, error: result.error }
  }
  // HeyReach: no reply API confirmed yet — just mark as sent

  await supabaseAdmin
    .from("prospect_replies")
    .update({ status: "sent", sent_at: new Date().toISOString(), sent_body: draftBody })
    .eq("id", replyId)

  revalidatePath("/inbox")
  return { ok: true }
}

export async function dismissReply(replyId: string): Promise<void> {
  await supabaseAdmin.from("prospect_replies").update({ status: "dismissed" }).eq("id", replyId)
  revalidatePath("/inbox")
}

export async function regenerateDraft(replyId: string): Promise<void> {
  await supabaseAdmin.from("prospect_replies").update({ status: "pending_review", ai_draft: null, intent: null, ai_reasoning: null }).eq("id", replyId)
  const { analyzeReply } = await import("@/lib/ai-reply")
  await analyzeReply(replyId)
  revalidatePath("/inbox")
}
