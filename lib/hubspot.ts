// HubSpot API client (Service Key auth)

const BASE = "https://api.hubapi.com"

function hs_headers() {
  return {
    Authorization: `Bearer ${process.env.HUBSPOT_API_KEY}`,
    "Content-Type": "application/json",
  }
}

export type HubspotDeal = {
  id: string
  dealname: string | null
  dealstage: string | null // internal stage ID
  associatedContacts: string[] // contact IDs
  associatedCompanies: string[] // company IDs
}

export type HubspotCompany = {
  id: string
  name: string | null
  domain: string | null
}

export type HubspotPipelineStage = {
  id: string
  label: string
}

// ── Pipelines ────────────────────────────────────────────────────────────────

export async function getDealPipelineStages(): Promise<HubspotPipelineStage[]> {
  const res = await fetch(`${BASE}/crm/v3/pipelines/deals`, {
    headers: hs_headers(),
    cache: "no-store",
  })
  if (!res.ok) {
    const body = await res.text()
    throw new Error(`HubSpot pipelines ${res.status}: ${body.slice(0, 200)}`)
  }
  const json = await res.json()
  const stages: HubspotPipelineStage[] = []
  for (const pipeline of json.results ?? []) {
    for (const stage of pipeline.stages ?? []) {
      stages.push({ id: stage.id, label: stage.label })
    }
  }
  return stages
}

// ── Deals ────────────────────────────────────────────────────────────────────

export async function getAllDeals(): Promise<HubspotDeal[]> {
  const deals: HubspotDeal[] = []
  let after: string | undefined

  do {
    const params = new URLSearchParams({
      limit: "100",
      properties: "dealname,dealstage",
      associations: "contacts,companies",
    })
    if (after) params.set("after", after)

    const res = await fetch(`${BASE}/crm/v3/objects/deals?${params}`, {
      headers: hs_headers(),
      cache: "no-store",
    })
    if (!res.ok) {
      const body = await res.text()
      throw new Error(`HubSpot deals ${res.status}: ${body.slice(0, 200)}`)
    }
    const json = await res.json()

    for (const deal of json.results ?? []) {
      const contactIds = (
        deal.associations?.contacts?.results ?? []
      ).map((c: { id: string }) => c.id)
      const companyIds = (
        deal.associations?.companies?.results ?? []
      ).map((c: { id: string }) => c.id)
      deals.push({
        id: deal.id,
        dealname: deal.properties?.dealname ?? null,
        dealstage: deal.properties?.dealstage ?? null,
        associatedContacts: contactIds,
        associatedCompanies: companyIds,
      })
    }

    after = json.paging?.next?.after
  } while (after)

  return deals
}

// ── Companies ────────────────────────────────────────────────────────────────

/** Returns map companyId → { name, domain } for the given company IDs */
export async function getCompanyInfo(
  companyIds: string[]
): Promise<Map<string, HubspotCompany>> {
  const map = new Map<string, HubspotCompany>()
  if (companyIds.length === 0) return map

  for (let i = 0; i < companyIds.length; i += 100) {
    const batch = companyIds.slice(i, i + 100)
    const res = await fetch(`${BASE}/crm/v3/objects/companies/batch/read`, {
      method: "POST",
      headers: hs_headers(),
      body: JSON.stringify({
        inputs: batch.map((id) => ({ id })),
        properties: ["name", "domain"],
      }),
      cache: "no-store",
    })
    if (!res.ok) continue
    const json = await res.json()
    for (const company of json.results ?? []) {
      map.set(company.id, {
        id: company.id,
        name: company.properties?.name ?? null,
        domain: company.properties?.domain ?? null,
      })
    }
  }

  return map
}

// ── Contacts ─────────────────────────────────────────────────────────────────

/** Returns map contactId → email (lowercase) for the given contact IDs */
export async function getContactEmails(
  contactIds: string[]
): Promise<Map<string, string>> {
  const emailMap = new Map<string, string>()
  if (contactIds.length === 0) return emailMap

  // Batch read supports up to 100 per request
  for (let i = 0; i < contactIds.length; i += 100) {
    const batch = contactIds.slice(i, i + 100)
    const res = await fetch(`${BASE}/crm/v3/objects/contacts/batch/read`, {
      method: "POST",
      headers: hs_headers(),
      body: JSON.stringify({
        inputs: batch.map((id) => ({ id })),
        properties: ["email"],
      }),
      cache: "no-store",
    })
    if (!res.ok) continue
    const json = await res.json()
    for (const contact of json.results ?? []) {
      const email: string | null = contact.properties?.email ?? null
      if (email) emailMap.set(contact.id, email.toLowerCase())
    }
  }

  return emailMap
}
