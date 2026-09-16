import { NextRequest, NextResponse } from "next/server"
import { supabaseAdmin } from "@/lib/supabase"

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

  // event_type = "every_message_reply_received"
  const eventType = String(body.event_type ?? body.eventType ?? body.type ?? "")
  if (eventType && !eventType.toLowerCase().includes("reply")) {
    return NextResponse.json({ ok: true, skipped: true })
  }

  // ── Extract fields from HeyReach payload structure ───────────────────────────

  // Message body: lives in recent_messages[].message where is_reply: true
  type HrMessage = { message?: string; is_reply?: boolean; message_type?: string }
  const recentMessages: HrMessage[] = Array.isArray(body.recent_messages)
    ? (body.recent_messages as HrMessage[])
    : []
  const replyBody = recentMessages
    .filter((m) => m.is_reply && m.message && m.message.trim() && !m.message_type)
    .map((m) => m.message!)
    .join("\n")
    .trim()

  if (!replyBody) {
    return NextResponse.json({ ok: true, skipped: true, reason: "empty body" })
  }

  // Lead info
  const lead = (body.lead ?? {}) as Record<string, unknown>
  const profileUrl = String(lead.profile_url ?? lead.profileUrl ?? "")
  const leadId     = String(lead.id ?? body.leadId ?? body.lead_id ?? "")

  // Campaign
  const campaign   = (body.campaign ?? {}) as Record<string, unknown>
  const campaignId = String(campaign.id ?? body.campaignId ?? body.campaign_id ?? "")

  // Sender (the lead who replied)
  const sender          = (body.sender ?? {}) as Record<string, unknown>
  const senderFirstName = String(sender.first_name ?? sender.firstName ?? lead.first_name ?? "")
  const senderLastName  = String(sender.last_name  ?? sender.lastName  ?? lead.last_name  ?? "")
  const senderName      = [senderFirstName, senderLastName].filter(Boolean).join(" ")

  // Timestamps & IDs
  const repliedAt      = String(body.timestamp ?? body.createdAt ?? body.created_at ?? new Date().toISOString())
  const replyMessageId = String(body.correlation_id ?? body.conversation_id ?? body.messageId ?? "")

  // ── Match prospect by LinkedIn URL ──────────────────────────────────────────
  let prospectId: string | null = null
  let dbCampaignId: string | null = null
  if (profileUrl) {
    // Extract slug from /in/SLUG/ or /company/SLUG/
    const slug = profileUrl.split("/in/")[1]?.split("/")[0]
              ?? profileUrl.split("/company/")[1]?.split("/")[0]
              ?? profileUrl
    const { data: prospect } = await supabaseAdmin
      .from("prospects")
      .select("id, campaign_id")
      .ilike("linkedin_url", `%${slug}%`)
      .maybeSingle()
    if (prospect) {
      prospectId   = prospect.id
      dbCampaignId = prospect.campaign_id
    }
  }

  // ── Insert reply ────────────────────────────────────────────────────────────
  const { data: inserted, error } = await supabaseAdmin
    .from("prospect_replies")
    .insert({
      prospect_id:         prospectId,
      campaign_id:         dbCampaignId,
      source:              "heyreach",
      external_lead_id:    leadId || null,
      external_campaign_id: campaignId || null,
      reply_message_id:    replyMessageId || null,
      replied_at:          repliedAt,
      body:                replyBody,
      sender_name:         senderName || null,
      sender_email:        String(lead.email_address ?? sender.email_address ?? "") || null,
      status:              "pending_review",
    })
    .select("id")
    .single()

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ ok: true, id: inserted.id })
}
