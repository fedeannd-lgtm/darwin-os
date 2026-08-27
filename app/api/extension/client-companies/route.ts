import { NextRequest, NextResponse } from "next/server"
import { supabase, supabaseAdmin } from "@/lib/supabase"

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
  "Access-Control-Allow-Private-Network": "true",
}

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS })
}

// GET — extensión pide la lista para resolverla en Sales Nav
export async function GET() {
  const { data, error } = await supabase
    .from("client_companies")
    .select("company_name, linkedin_url, sales_nav_id")
    .order("company_name")

  if (error) return NextResponse.json({ error: error.message }, { status: 500, headers: CORS })

  return NextResponse.json({ companies: data ?? [] }, { headers: CORS })
}

// POST — extensión reporta los IDs que encontró
export async function POST(req: NextRequest) {
  const body = await req.json() as { results: { company_name: string; sales_nav_id: string }[] }

  if (!Array.isArray(body?.results)) {
    return NextResponse.json({ error: "results array required" }, { status: 400, headers: CORS })
  }

  for (const { company_name, sales_nav_id } of body.results) {
    if (company_name && sales_nav_id) {
      await supabaseAdmin
        .from("client_companies")
        .update({ sales_nav_id })
        .eq("company_name", company_name)
    }
  }

  return NextResponse.json({ ok: true, updated: body.results.length }, { headers: CORS })
}
