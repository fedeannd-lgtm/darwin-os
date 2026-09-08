import { NextRequest, NextResponse } from "next/server"
import { supabaseAdmin } from "@/lib/supabase"

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
  "Access-Control-Allow-Private-Network": "true",
}

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS })
}

/**
 * GET /api/extension/auto-account-list?campaignId=XXX
 *
 * Returns the scraped company IDs + suggested list name for an auto campaign.
 * Called by the extension in create_account_list mode before creating the Sales Nav list.
 */
export async function GET(req: NextRequest) {
  const campaignId = req.nextUrl.searchParams.get("campaignId")
  if (!campaignId) {
    return NextResponse.json({ error: "campaignId requerido" }, { status: 400, headers: CORS })
  }

  // Fetch campaign to build list name
  const { data: campaign, error: campErr } = await supabaseAdmin
    .from("campaigns")
    .select("week_label, rep_name, industry")
    .eq("id", campaignId)
    .single()

  if (campErr || !campaign) {
    return NextResponse.json({ error: "Campaña no encontrada" }, { status: 404, headers: CORS })
  }

  // Fetch scraped company IDs
  const { data: accounts, error: accErr } = await supabaseAdmin
    .from("accounts")
    .select("sales_nav_id, company_name")
    .eq("campaign_id", campaignId)
    .not("sales_nav_id", "is", null)

  if (accErr) {
    return NextResponse.json({ error: accErr.message }, { status: 500, headers: CORS })
  }

  const companyIds = (accounts ?? [])
    .map((a) => a.sales_nav_id)
    .filter((id): id is string => Boolean(id))

  const listName = `${campaign.week_label} - ${campaign.industry}`

  return NextResponse.json(
    { listName, companyIds, campaignId },
    { headers: CORS }
  )
}
