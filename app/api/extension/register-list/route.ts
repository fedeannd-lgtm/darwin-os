import { NextRequest, NextResponse } from "next/server"
import { supabaseAdmin } from "@/lib/supabase"

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
  "Access-Control-Allow-Private-Network": "true",
}

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS })
}

export async function POST(req: NextRequest) {
  const { campaignId, listId, listName } = await req.json()
  if (!campaignId || !listId) {
    return NextResponse.json({ error: "campaignId y listId requeridos" }, { status: 400, headers: CORS })
  }
  const { error } = await supabaseAdmin
    .from("campaigns")
    .update({ list_id: String(listId), list_name: listName ?? null })
    .eq("id", campaignId)
  if (error) return NextResponse.json({ error: error.message }, { status: 500, headers: CORS })
  return NextResponse.json({ ok: true }, { headers: CORS })
}
