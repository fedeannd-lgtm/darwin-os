const APOLLO_API_KEY = process.env.APOLLO_API_KEY!

export type ApolloResult = {
  email: string | null
  canonicalLinkedInUrl: string | null
  apolloEmailStatus: string | null
  phone: string | null
  apolloId: string | null
}

async function matchPerson(payload: Record<string, unknown>): Promise<{ person: Record<string, unknown> } | null> {
  const res = await fetch("https://api.apollo.io/api/v1/people/match", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "no-cache",
      "X-Api-Key": APOLLO_API_KEY,
    },
    body: JSON.stringify({ api_key: APOLLO_API_KEY, reveal_personal_emails: true, ...payload }),
  })
  if (!res.ok) {
    console.error(`[Apollo] matchPerson HTTP ${res.status}`, await res.text().catch(() => ""))
    return null
  }
  const data = await res.json()
  return data?.person ? data : null
}

function extractPhone(person: Record<string, unknown>): string | null {
  const numbers = (person?.phone_numbers ?? []) as Array<{ sanitized_number?: string; type?: string }>
  if (!numbers.length) return null
  // Prefer mobile > work_direct > work_hq > first available
  const priority = ["mobile", "work_direct", "work_hq"]
  for (const type of priority) {
    const match = numbers.find((n) => n.type === type && n.sanitized_number)
    if (match?.sanitized_number) return match.sanitized_number
  }
  return numbers[0]?.sanitized_number ?? null
}

function extractEmail(person: Record<string, unknown>): string | null {
  const email = person?.email as string | undefined
  if (email && email !== "email_not_unlocked@domain.com" && email.includes("@")) return email
  const contacts = (person?.contact_emails ?? []) as Array<{ email?: string }>
  return contacts.find((c) => c.email?.includes("@"))?.email ?? null
}

async function searchPeopleAtCompany(
  firstName: string,
  lastName: string,
  companyDomain: string,
): Promise<{ email: string; linkedInUrl: string | null } | null> {
  const res = await fetch("https://api.apollo.io/api/v1/mixed_people/api_search", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "no-cache",
      "X-Api-Key": APOLLO_API_KEY,
    },
    body: JSON.stringify({
      api_key: APOLLO_API_KEY,
      q_organization_domains_list: [companyDomain],
      per_page: 100,
    }),
  })
  if (!res.ok) return null
  const data = await res.json()
  const people = (data?.people ?? []) as Array<Record<string, unknown>>

  // Find by name similarity
  const firstLower = firstName.toLowerCase()
  const lastLower = lastName.split(" ")[0].toLowerCase() // first word of last name
  const match = people.find((p) => {
    const pFirst = ((p.first_name as string) ?? "").toLowerCase()
    const pLast = ((p.last_name as string) ?? "").toLowerCase()
    return pFirst.startsWith(firstLower) && pLast.startsWith(lastLower)
  })

  if (!match) return null
  const email = extractEmail(match)
  if (!email) return null
  return { email, linkedInUrl: (match.linkedin_url as string) ?? null }
}

// Returns true for standard LinkedIn slugs (/in/firstname-lastname-id)
// Returns false for encoded Sales Nav IDs (/in/ACwAABxxx...)
function isCanonicalLinkedIn(url: string): boolean {
  if (!url) return false
  const match = url.match(/linkedin\.com\/in\/([^/?]+)/)
  if (!match) return false
  const slug = match[1]
  // Encoded Sales Nav IDs start with uppercase or are very long base64-like strings
  return !(slug[0] === slug[0].toUpperCase() && slug[0] !== slug[0].toLowerCase()) && slug.length < 60
}

export async function findEmailApollo(
  firstName: string,
  lastName: string,
  fullName: string,
  companyName: string,
  linkedinUrl: string,
  companyDomain?: string | null
): Promise<ApolloResult> {
  try {
    // 1. Replicate Clay's Apollo setup: name + company identifier
    //    Domain wins over org name when both present; org name used when no domain (Clay's behavior)
    const first = await matchPerson({
      first_name: firstName,
      last_name: lastName,
      name: fullName || undefined,
      domain: companyDomain || undefined,
      organization_name: !companyDomain && companyName ? companyName : undefined,
    })

    let person = first?.person as Record<string, unknown> | undefined

    // 2. Canonical LinkedIn URL only (skip encoded Sales Nav IDs — they break Apollo matching)
    if (!person && linkedinUrl && isCanonicalLinkedIn(linkedinUrl)) {
      const urlOnly = await matchPerson({ linkedin_url: linkedinUrl })
      person = urlOnly?.person as Record<string, unknown> | undefined
    }

    // 3. name + domain (if domain available and previous attempts failed)
    if (!person && companyDomain) {
      const withDomain = await matchPerson({
        first_name: firstName,
        last_name: lastName,
        domain: companyDomain,
      })
      person = withDomain?.person as Record<string, unknown> | undefined
    }

    if (person) {
      const apolloLinkedIn = (person.linkedin_url as string) ?? null
      const apolloEmailStatus = (person.email_status as string) ?? null
      const email = extractEmail(person)
      const phone = extractPhone(person)
      const apolloId = (person.id as string) ?? null
      if (email) return { email, canonicalLinkedInUrl: apolloLinkedIn, apolloEmailStatus, phone, apolloId }

      // Force email reveal via Apollo person ID
      if (apolloId) {
        const second = await matchPerson({ id: apolloId })
        const p2 = second?.person as Record<string, unknown> | undefined
        if (p2) {
          const email2 = extractEmail(p2)
          const phone2 = extractPhone(p2) ?? phone
          const linkedin2 = (p2.linkedin_url as string) ?? apolloLinkedIn
          const status2 = (p2.email_status as string) ?? apolloEmailStatus
          const apolloId2 = (p2.id as string) ?? apolloId
          if (email2) return { email: email2, canonicalLinkedInUrl: linkedin2, apolloEmailStatus: status2, phone: phone2, apolloId: apolloId2 }
          return { email: null, canonicalLinkedInUrl: linkedin2, apolloEmailStatus: null, phone: phone2, apolloId: apolloId2 }
        }
      }
      return { email: null, canonicalLinkedInUrl: apolloLinkedIn, apolloEmailStatus: null, phone, apolloId }
    }

    // 4. mixed_people/search by company domain + name match
    if (companyDomain) {
      const found = await searchPeopleAtCompany(firstName, lastName, companyDomain)
      if (found) return { email: found.email, canonicalLinkedInUrl: found.linkedInUrl, apolloEmailStatus: null, phone: null, apolloId: null }
    }

    return { email: null, canonicalLinkedInUrl: null, apolloEmailStatus: null, phone: null, apolloId: null }
  } catch {
    return { email: null, canonicalLinkedInUrl: null, apolloEmailStatus: null, phone: null, apolloId: null }
  }
}

// Lookup a company's primary domain by name — does NOT consume lead credits
export async function apolloOrgLookup(companyName: string): Promise<string | null> {
  if (!APOLLO_API_KEY || !companyName) return null
  try {
    const res = await fetch("https://api.apollo.io/api/v1/organizations/search", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-api-key": APOLLO_API_KEY },
      body: JSON.stringify({ q_organization_name: companyName, per_page: 1 }),
    })
    if (!res.ok) return null
    const data = await res.json()
    return (data?.organizations?.[0]?.primary_domain as string) ?? null
  } catch {
    return null
  }
}

export async function findPhoneApollo(
  firstName: string,
  lastName: string,
  companyName: string,
  linkedinUrl: string,
  companyDomain?: string | null
): Promise<string | null> {
  try {
    const first = await matchPerson({
      first_name: firstName.split(" ")[0],
      last_name: lastName,
      organization_name: companyName || undefined,
    })
    let person = first?.person as Record<string, unknown> | undefined

    if (!person && linkedinUrl && isCanonicalLinkedIn(linkedinUrl)) {
      const urlOnly = await matchPerson({ linkedin_url: linkedinUrl })
      person = urlOnly?.person as Record<string, unknown> | undefined
    }

    if (!person && companyDomain) {
      const withDomain = await matchPerson({ first_name: firstName.split(" ")[0], last_name: lastName, domain: companyDomain })
      person = withDomain?.person as Record<string, unknown> | undefined
    }

    if (!person) return null

    const phone = extractPhone(person)
    if (phone) return phone

    // Force reveal via person ID
    const apolloId = person.id as string | undefined
    if (apolloId) {
      const second = await matchPerson({ id: apolloId })
      const p2 = second?.person as Record<string, unknown> | undefined
      if (p2) return extractPhone(p2)
    }

    return null
  } catch {
    return null
  }
}
