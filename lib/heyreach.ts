const BASE = "https://api.heyreach.io/api/public"
const API_KEY = process.env.HEYREACH_API_KEY!

export type HeyReachLead = {
  linkedInProfileUrl: string
  firstName?: string
  lastName?: string
  companyName?: string
  position?: string
  location?: string
  emailAddress?: string
  customUserFields?: { name: string; value: string }[]
}

// Returns campaigns with their first linkedInAccountId already embedded
export async function fetchHeyReachCampaigns(): Promise<{ id: string; name: string; linkedInAccountId?: number }[]> {
  try {
    const res = await fetch(`${BASE}/campaign/GetAll`, {
      method: "POST",
      headers: {
        "X-API-KEY": API_KEY,
        "Content-Type": "application/json",
        "Accept": "text/plain",
      },
      body: JSON.stringify({ offset: 0, limit: 100 }),
    })
    if (!res.ok) return []
    const data = await res.json()
    const list: unknown[] = data?.items ?? []
    return list
      .filter((c): c is Record<string, unknown> => !!c && typeof c === "object")
      .map((c) => {
        // HeyReach returns linkedInAccountIds (array) or linkedInAccountId (number)
        const rawIds = c.linkedInAccountIds ?? c.linkedInAccountId
        const accountIds: number[] = Array.isArray(rawIds)
          ? rawIds.map(Number).filter(Boolean)
          : rawIds ? [Number(rawIds)] : []
        return {
          id: String(c.id ?? ""),
          name: String(c.name ?? ""),
          linkedInAccountId: accountIds[0],
        }
      })
      .filter((c) => c.id && c.name)
  } catch {
    return []
  }
}

export async function addLeadsToHeyReach(
  campaignId: string,
  linkedInAccountIdOrLeads: number | HeyReachLead[],
  leadsArg?: HeyReachLead[]
): Promise<{ success: number; failed: number; error?: string }> {
  // Overload: (campaignId, leads) | (campaignId, linkedInAccountId, leads)
  const linkedInAccountId = Array.isArray(linkedInAccountIdOrLeads) ? 0 : linkedInAccountIdOrLeads
  const leads = Array.isArray(linkedInAccountIdOrLeads) ? linkedInAccountIdOrLeads : (leadsArg ?? [])
  if (!leads.length) return { success: 0, failed: 0 }
  try {
    const accountLeadPairs = leads.map((l) => ({
      ...(linkedInAccountId ? { linkedInAccountId } : {}),
      lead: {
        firstName: l.firstName,
        lastName: l.lastName,
        profileUrl: l.linkedInProfileUrl,
        companyName: l.companyName,
        position: l.position,
        location: l.location,
        emailAddress: l.emailAddress,
        customUserFields: l.customUserFields ?? [],
      },
    }))

    const res = await fetch(`${BASE}/campaign/AddLeadsToCampaignV2`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Accept": "text/plain",
        "X-API-KEY": API_KEY,
      },
      body: JSON.stringify({
        campaignId: parseInt(campaignId, 10),
        accountLeadPairs,
        resumeFinishedCampaign: false,
        resumePausedCampaign: false,
      }),
    })

    if (!res.ok) {
      const text = await res.text()
      return { success: 0, failed: leads.length, error: `HTTP ${res.status}: ${text.slice(0, 200)}` }
    }

    // Response may be a plain number or JSON
    const text = await res.text()
    const added = parseInt(text.trim(), 10)
    const count = isNaN(added) ? leads.length : added
    return { success: count, failed: leads.length - count }
  } catch (e) {
    return { success: 0, failed: leads.length, error: e instanceof Error ? e.message : "Error desconocido" }
  }
}
