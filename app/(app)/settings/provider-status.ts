"use server"

export type ProviderStatus = {
  name: string
  label: string
  status: "ok" | "low" | "out" | "unconfigured" | "error"
  credits?: number | null
  detail: string
}

async function checkZeroBounce(): Promise<ProviderStatus> {
  const key = process.env.ZEROBOUNCE_API_KEY
  if (!key) return { name: "zerobounce", label: "ZeroBounce", status: "unconfigured", detail: "API key no configurada" }
  try {
    const res = await fetch(`https://api.zerobounce.net/v2/getcredits?api_key=${key}`)
    if (!res.ok) return { name: "zerobounce", label: "ZeroBounce", status: "error", detail: `HTTP ${res.status}` }
    const data = await res.json()
    const credits = parseInt(data?.Credits ?? data?.credits ?? "-1", 10)
    if (credits === -1) return { name: "zerobounce", label: "ZeroBounce", status: "error", credits: null, detail: "API key inválida" }
    if (credits === 0) return { name: "zerobounce", label: "ZeroBounce", status: "out", credits: 0, detail: "Sin créditos" }
    if (credits < 25) return { name: "zerobounce", label: "ZeroBounce", status: "low", credits, detail: `${credits} créditos restantes` }
    return { name: "zerobounce", label: "ZeroBounce", status: "ok", credits, detail: `${credits.toLocaleString()} créditos` }
  } catch (e) {
    return { name: "zerobounce", label: "ZeroBounce", status: "error", detail: `Error: ${e instanceof Error ? e.message : "desconocido"}` }
  }
}

async function checkHunter(): Promise<ProviderStatus> {
  const key = process.env.HUNTER_API_KEY
  if (!key) return { name: "hunter", label: "Hunter", status: "unconfigured", detail: "API key no configurada" }
  try {
    const res = await fetch(`https://api.hunter.io/v2/usage?api_key=${key}`)
    if (!res.ok) return { name: "hunter", label: "Hunter", status: "error", detail: "API key inválida" }
    const data = await res.json()
    // Formato: { data: { requests: { searches: { remaining }, verifications: { remaining } } } }
    const searches = data?.data?.requests?.searches?.remaining ?? data?.data?.requests?.credits?.remaining ?? null
    const verifications = data?.data?.requests?.verifications?.remaining ?? null
    const remaining = searches ?? verifications ?? null
    if (remaining === null) return { name: "hunter", label: "Hunter", status: "ok", detail: "Configurado" }
    if (remaining <= 0) return { name: "hunter", label: "Hunter", status: "out", credits: 0, detail: "Sin créditos" }
    if (remaining < 50) return { name: "hunter", label: "Hunter", status: "low", credits: remaining, detail: `${remaining} búsquedas restantes` }
    const detail = verifications !== null
      ? `${searches?.toLocaleString()} búsquedas · ${verifications.toLocaleString()} verificaciones`
      : `${remaining.toLocaleString()} requests`
    return { name: "hunter", label: "Hunter", status: "ok", credits: remaining, detail }
  } catch {
    return { name: "hunter", label: "Hunter", status: "error", detail: "Error al consultar" }
  }
}

function checkKey(name: string, label: string, envVar: string): ProviderStatus {
  const key = process.env[envVar]
  if (!key) return { name, label, status: "unconfigured", detail: "API key no configurada" }
  return { name, label, status: "ok", detail: "Configurado" }
}

async function checkApollo(): Promise<ProviderStatus> {
  const key = process.env.APOLLO_API_KEY
  if (!key) return { name: "apollo", label: "Apollo", status: "unconfigured", detail: "API key no configurada" }
  try {
    // credit_usage_stats — créditos de email reveal (0 créditos consumidos)
    const res = await fetch("https://api.apollo.io/api/v1/usage_stats/credit_usage_stats", {
      method: "POST",
      headers: { "Content-Type": "application/json", "Cache-Control": "no-cache", "x-api-key": key },
    })

    if (res.status === 401) return { name: "apollo", label: "Apollo", status: "error", detail: "API key inválida" }
    if (res.status === 403) return { name: "apollo", label: "Apollo", status: "ok", detail: "Configurado (key sin scope de stats)" }
    if (!res.ok) return { name: "apollo", label: "Apollo", status: "error", detail: `HTTP ${res.status}` }

    const data = await res.json()

    // Formato real: { credit_usage_stats: { lead_credit: { limit, consumed, left_over } } }
    const leadCredit = data?.credit_usage_stats?.lead_credit
    const remaining = leadCredit?.left_over ?? null
    const limit     = leadCredit?.limit ?? null
    const consumed  = leadCredit?.consumed ?? null

    if (remaining === null) {
      return { name: "apollo", label: "Apollo", status: "ok", detail: "Configurado" }
    }

    if (remaining <= 0) {
      return { name: "apollo", label: "Apollo", status: "out", credits: 0, detail: `Sin créditos${limit ? ` (${consumed}/${limit} usados)` : ""}` }
    }
    if (remaining < 100) {
      return { name: "apollo", label: "Apollo", status: "low", credits: remaining, detail: `${remaining} créditos restantes` }
    }
    return { name: "apollo", label: "Apollo", status: "ok", credits: remaining, detail: `${remaining} créditos disponibles` }
  } catch {
    return { name: "apollo", label: "Apollo", status: "error", detail: "Error al consultar" }
  }
}

async function checkFindymail(): Promise<ProviderStatus> {
  const key = process.env.FINDYMAIL_API_KEY
  if (!key) return { name: "findymail", label: "FindyEmail", status: "unconfigured", detail: "API key no configurada" }
  try {
    const res = await fetch("https://app.findymail.com/api/credits", {
      headers: { "Authorization": `Bearer ${key}`, "Content-Type": "application/json" },
    })
    if (!res.ok) return { name: "findymail", label: "FindyEmail", status: "error", detail: `HTTP ${res.status}` }
    const data = await res.json()
    const credits = data?.credits ?? data?.remaining ?? null
    if (credits === 0) return { name: "findymail", label: "FindyEmail", status: "out", credits: 0, detail: "Sin créditos" }
    if (credits !== null && credits < 10) return { name: "findymail", label: "FindyEmail", status: "low", credits, detail: `${credits} créditos restantes` }
    return { name: "findymail", label: "FindyEmail", status: "ok", credits, detail: credits !== null ? `${credits} créditos` : "Configurado" }
  } catch {
    return { name: "findymail", label: "FindyEmail", status: "error", detail: "Error al consultar" }
  }
}

async function checkProspeo(): Promise<ProviderStatus> {
  const key = process.env.PROSPEO_API_KEY
  if (!key) return { name: "prospeo", label: "Prospeo", status: "unconfigured", detail: "API key no configurada" }
  try {
    const res = await fetch("https://api.prospeo.io/account-information", {
      headers: { "X-KEY": key },
    })
    if (!res.ok) return { name: "prospeo", label: "Prospeo", status: "error", detail: res.status === 400 ? "API key inválida" : `HTTP ${res.status}` }
    const data = await res.json()
    if (data?.error) return { name: "prospeo", label: "Prospeo", status: "error", detail: "API key inválida" }
    const remaining = data?.response?.remaining_credits ?? null
    const used      = data?.response?.used_credits ?? null
    if (remaining === null) return { name: "prospeo", label: "Prospeo", status: "ok", detail: "Configurado" }
    if (remaining <= 0) return { name: "prospeo", label: "Prospeo", status: "out", credits: 0, detail: `Sin créditos${used != null ? ` (${used} usados)` : ""}` }
    if (remaining < 20) return { name: "prospeo", label: "Prospeo", status: "low", credits: remaining, detail: `${remaining} créditos restantes` }
    return { name: "prospeo", label: "Prospeo", status: "ok", credits: remaining, detail: `${remaining} créditos disponibles` }
  } catch {
    return { name: "prospeo", label: "Prospeo", status: "error", detail: "Error al consultar" }
  }
}

async function checkDatagma(): Promise<ProviderStatus> {
  const key = process.env.DATAGMA_API_KEY
  if (!key) return { name: "datagma", label: "Datagma", status: "unconfigured", detail: "API key no configurada" }
  try {
    const res = await fetch(`https://gateway.datagma.net/api/ingress/v1/mine?apiId=${encodeURIComponent(key)}`)
    if (!res.ok) return { name: "datagma", label: "Datagma", status: "error", detail: `HTTP ${res.status}` }
    const data = await res.json()
    const remaining = data?.currentCredit != null ? parseInt(data.currentCredit, 10) : null
    if (remaining === null || isNaN(remaining)) return { name: "datagma", label: "Datagma", status: "ok", detail: "Configurado" }
    if (remaining <= 0) return { name: "datagma", label: "Datagma", status: "out", credits: 0, detail: "Sin créditos" }
    if (remaining < 20) return { name: "datagma", label: "Datagma", status: "low", credits: remaining, detail: `${remaining} créditos restantes` }
    return { name: "datagma", label: "Datagma", status: "ok", credits: remaining, detail: `${remaining.toLocaleString()} créditos disponibles` }
  } catch {
    return { name: "datagma", label: "Datagma", status: "error", detail: "Error al consultar" }
  }
}

export async function getProviderStatus(): Promise<ProviderStatus[]> {
  const [apollo, zb, hunter, findymail, prospeo, datagma] = await Promise.all([checkApollo(), checkZeroBounce(), checkHunter(), checkFindymail(), checkProspeo(), checkDatagma()])
  return [
    apollo,
    findymail,
    prospeo,
    hunter,
    datagma,
    zb,
  ]
}
