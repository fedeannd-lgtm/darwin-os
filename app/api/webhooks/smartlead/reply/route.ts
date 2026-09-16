import { NextRequest, NextResponse } from "next/server"
import { supabaseAdmin } from "@/lib/supabase"

type SLMessage = { message_id?: string; html?: string; text?: string; time?: string }

export async function POST(req: NextRequest) {
  const secret = req.nextUrl.searchParams.get("secret")
  if (process.env.WEBHOOK_SECRET && secret !== process.env.WEBHOOK_SECRET) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  let body: Record<string, unknown>
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 })
  }

  const eventType = String(body.event_type ?? "")
  if (eventType && eventType !== "EMAIL_REPLY") {
    return NextResponse.json({ ok: true, skipped: true })
  }

  const replyMsg = body.reply_message as SLMessage | undefined
  const sentMsg = body.sent_message as SLMessage | undefined

  // Prefer new fields, fall back to deprecated ones
  const replyBody = replyMsg?.text || replyMsg?.html || String(body.reply_body ?? body.preview_text ?? "")
  const replyMessageId = replyMsg?.message_id || String(body.message_id ?? "")
  const repliedAt = replyMsg?.time || String(body.event_timestamp ?? body.time_replied ?? new Date().toISOString())
  const leadEmail = String(body.sl_lead_email ?? "")
  const leadId = String(body.sl_email_lead_id ?? "")
  const campaignId = String(body.campaign_id ?? "")
  const subject = String(body.subject ?? "")
  const senderName = String(body.to_name ?? "")

  // Build thread history from sent message for AI context
  const threadHistory = sentMsg
    ? [{ type: "SENT", body: sentMsg.text || sentMsg.html || "", time: sentMsg.time }]
    : null

  if (!replyBody) {
    return NextResponse.json({ error: "Missing reply body" }, { status: 400 })
  }

  let prospectId: string | null = null
  let dbCampaignId: string | null = null
  if (leadEmail) {
    const { data: prospect } = await supabaseAdmin
      .from("prospects")
      .select("id, campaign_id")
      .eq("email", leadEmail)
      .maybeSingle()
    if (prospect) {
      prospectId = prospect.id
      dbCampaignId = prospect.campaign_id
    }
  }

  const { data: inserted, error } = await supabaseAdmin
    .from("prospect_replies")
    .insert({
      prospect_id: prospectId,
      campaign_id: dbCampaignId,
      source: "smartlead",
      external_lead_id: leadId,
      external_campaign_id: campaignId,
      reply_message_id: replyMessageId,
      replied_at: repliedAt,
      subject: subject || null,
      body: replyBody,
      thread_history: threadHistory,
      sender_name: senderName || null,
      sender_email: leadEmail || null,
      status: "pending_review",
    })
    .select("id")
    .single()

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ ok: true, id: inserted.id })
}
