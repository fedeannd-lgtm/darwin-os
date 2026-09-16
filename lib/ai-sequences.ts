import Anthropic from "@anthropic-ai/sdk"
import { readFileSync } from "fs"
import { join } from "path"
import { supabaseAdmin } from "./supabase"
import type { LinkedinSequenceConfig, EmailSequenceConfig } from "@/lib/sequence-configs"
import { DEFAULT_LINKEDIN_CONFIG, DEFAULT_EMAIL_CONFIG } from "@/lib/sequence-configs"

// Product context fallback: read from lib/product-context.md at startup
let PRODUCT_CONTEXT_FALLBACK = ""
try {
  PRODUCT_CONTEXT_FALLBACK = readFileSync(join(process.cwd(), "lib/product-context.md"), "utf-8")
} catch {
  // file may not exist in some environments
}

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

export type EmailStep = { step: number; subject: string; body: string }
export type LinkedinStep = { step: number; message: string }
export type Sequences = { email: EmailStep[]; linkedin: LinkedinStep[] }

// ─── Helpers para construir instrucciones desde config ────────────────────────

function buildLinkedinInstructions(liCfg: LinkedinSequenceConfig): string {
  const lines: string[] = []
  lines.push(`- Generá exactamente ${liCfg.step_count} mensajes de LinkedIn`)
  lines.push(`- Paso 1 (solicitud de conexión): máx ${liCfg.step1_chars} caracteres`)
  if (liCfg.step_count > 1) {
    lines.push(`- Pasos 2 en adelante (follow-ups): máx ${liCfg.followup_chars} caracteres cada uno`)
  }

  if (liCfg.prompt_mode === "general" && liCfg.general_prompt) {
    lines.push(`\nInstrucciones adicionales para mensajes de LinkedIn:\n${liCfg.general_prompt}`)
  } else if (liCfg.prompt_mode === "per_step") {
    const stepLines = Array.from({ length: liCfg.step_count }, (_, i) => {
      const stepNum = String(i + 1)
      const inst = liCfg.step_prompts[stepNum]
      return inst ? `  - Paso ${stepNum}: ${inst}` : null
    }).filter(Boolean)
    if (stepLines.length) {
      lines.push(`\nInstrucciones por paso de LinkedIn:\n${stepLines.join("\n")}`)
    }
  }

  return lines.join("\n")
}

function buildEmailInstructions(emailCfg: EmailSequenceConfig): string {
  const lines: string[] = []
  lines.push(`- Generá exactamente ${emailCfg.step_count} pasos de email: paso 1 es el primer contacto, pasos 2-${emailCfg.step_count} son follow-ups`)

  if (emailCfg.prompt_mode === "general" && emailCfg.general_prompt) {
    lines.push(`\nInstrucciones adicionales para emails:\n${emailCfg.general_prompt}`)
  } else if (emailCfg.prompt_mode === "per_step") {
    const stepLines = Array.from({ length: emailCfg.step_count }, (_, i) => {
      const stepNum = String(i + 1)
      const inst = emailCfg.step_prompts[stepNum]
      return inst ? `  - Paso ${stepNum}: ${inst}` : null
    }).filter(Boolean)
    if (stepLines.length) {
      lines.push(`\nInstrucciones por paso de email:\n${stepLines.join("\n")}`)
    }
  }

  return lines.join("\n")
}

function buildEmailJsonTemplate(stepCount: number): string {
  const steps = Array.from({ length: stepCount }, (_, i) => {
    const step = i + 1
    const subject = step === 1 ? "..." : "Re: ..."
    return `    {"step": ${step}, "subject": "${subject}", "body": "..."}`
  }).join(",\n")
  return `[\n${steps}\n  ]`
}

function buildLinkedinJsonTemplate(stepCount: number): string {
  const steps = Array.from({ length: stepCount }, (_, i) =>
    `    {"step": ${i + 1}, "message": "..."}`
  ).join(",\n")
  return `[\n${steps}\n  ]`
}

// ─── Fetch prospect helper ────────────────────────────────────────────────────

async function fetchProspect(prospectId: string) {
  const { data, error } = await supabaseAdmin
    .from("prospects")
    .select(`
      id, first_name, last_name, full_name, job_title, company_name,
      company_domain, linkedin_url, icp_category, icp_score, os_score,
      highlights, location, email,
      accounts ( industry, headcount_range, country )
    `)
    .eq("id", prospectId)
    .single()
  if (error || !data) throw new Error("Prospecto no encontrado")
  return data as typeof data & {
    accounts: { industry: string | null; headcount_range: string | null; country: string | null } | null
  }
}

async function fetchGlobalConfig() {
  const { data } = await supabaseAdmin
    .from("inbox_config")
    .select("product_context, calendly_link, linkedin_sequence_config, email_sequence_config")
    .eq("id", 1)
    .single()
  return {
    productContext: data?.product_context || PRODUCT_CONTEXT_FALLBACK || "(sin contexto de producto configurado)",
    calendlyLink: data?.calendly_link ?? "",
    liCfg: (data?.linkedin_sequence_config as LinkedinSequenceConfig | null) ?? DEFAULT_LINKEDIN_CONFIG,
    emailCfg: (data?.email_sequence_config as EmailSequenceConfig | null) ?? DEFAULT_EMAIL_CONFIG,
  }
}

function prospectUserPromptLines(p: ReturnType<typeof fetchProspect> extends Promise<infer T> ? T : never) {
  const name = (p.full_name ?? `${p.first_name ?? ""} ${p.last_name ?? ""}`.trim()) || "el prospecto"
  return [
    `Prospecto: ${name}${p.job_title ? `, ${p.job_title}` : ""}${p.company_name ? ` en ${p.company_name}` : ""}`,
    p.company_domain ? `Dominio: ${p.company_domain}` : "",
    p.accounts?.industry ? `Industria: ${p.accounts.industry}` : "",
    p.accounts?.headcount_range ? `Tamaño empresa: ${p.accounts.headcount_range} empleados` : "",
    p.location ? `Ubicación: ${p.location}` : "",
    p.icp_category ? `Categoría ICP: ${p.icp_category}` : "",
    p.highlights ? `LinkedIn highlights: ${p.highlights}` : "",
  ].filter(Boolean).join("\n")
}

function callClaude(systemPrompt: string, userPrompt: string, maxTokens = 4096) {
  return client.messages.create({
    model: "claude-sonnet-4-6",
    max_tokens: maxTokens,
    messages: [{ role: "user", content: userPrompt }],
    system: systemPrompt,
  })
}

function parseJson<T>(text: string): T {
  const match = text.match(/\{[\s\S]*\}/)
  if (!match) throw new Error("No JSON in response")
  return JSON.parse(match[0]) as T
}

const GENERAL_RULES = `- Personalizá usando el nombre, cargo, empresa e industria del prospecto
- Escribí en español (o en el idioma del contexto si se indica)
- Sé concreto, evitá frases genéricas de relleno
- NO incluyas placeholders como [NOMBRE] — usá el nombre real del prospecto
- NO uses doble guión (--) en ningún lugar del texto
- NO firmes los emails ni mensajes con nombre propio (sin "Federico", sin "Saludos, X", sin firma de ningún tipo)`

// ─── generateSequences (email + LinkedIn juntos) ──────────────────────────────

export async function generateSequences(
  prospectId: string,
  emailContext: string,
  linkedinContext: string,
  liConfigOverride?: LinkedinSequenceConfig,
  emailConfigOverride?: EmailSequenceConfig
): Promise<Sequences> {
  const [prospect, global] = await Promise.all([fetchProspect(prospectId), fetchGlobalConfig()])

  const liCfg = liConfigOverride ?? global.liCfg
  const emailCfg = emailConfigOverride ?? global.emailCfg

  const systemPrompt = `Sos un SDR experto en ventas B2B con mucha experiencia en outreach personalizado.
Tu tarea es generar secuencias de contacto para un prospecto específico, basándote en su perfil y en el contexto del producto.

Contexto del producto:
${global.productContext}

${global.calendlyLink ? `Link de Calendly para reuniones: ${global.calendlyLink}` : ""}

Instrucciones para emails:
${buildEmailInstructions(emailCfg)}
- Los emails deben tener asunto y cuerpo separados
- Cada paso debe ser progresivamente más conciso y directo

Instrucciones para LinkedIn:
${buildLinkedinInstructions(liCfg)}

Instrucciones generales:
${GENERAL_RULES}
- Usá el contexto de research adicional para personalizar al máximo

Devolvé ÚNICAMENTE un JSON válido sin markdown, sin texto adicional, con este formato exacto:
{
  "email": ${buildEmailJsonTemplate(emailCfg.step_count)},
  "linkedin": ${buildLinkedinJsonTemplate(liCfg.step_count)}
}`

  const userPrompt = [
    prospectUserPromptLines(prospect),
    emailContext ? `\nContexto para email:\n${emailContext}` : "",
    linkedinContext ? `\nContexto para LinkedIn:\n${linkedinContext}` : "",
  ].filter(Boolean).join("\n")

  const message = await callClaude(systemPrompt, userPrompt)
  const text = message.content[0].type === "text" ? message.content[0].text : ""
  const sequences = parseJson<Sequences>(text)

  const researchContext = [emailContext, linkedinContext].filter(Boolean).join(" | ") || null
  await supabaseAdmin.from("shortlist_sequences").insert({
    prospect_id: prospectId,
    research_context: researchContext,
    sequences,
    model_used: "claude-sonnet-4-6",
    generated_at: new Date().toISOString(),
  })

  return sequences
}

// ─── generateEmailOnly ────────────────────────────────────────────────────────

export async function generateEmailOnly(
  prospectId: string,
  emailContext: string,
  emailConfigOverride?: EmailSequenceConfig
): Promise<EmailStep[]> {
  const [prospect, global] = await Promise.all([fetchProspect(prospectId), fetchGlobalConfig()])
  const emailCfg = emailConfigOverride ?? global.emailCfg

  const systemPrompt = `Sos un SDR experto en ventas B2B con mucha experiencia en email outreach.
Tu tarea es generar una secuencia de emails para un prospecto específico.

Contexto del producto:
${global.productContext}

${global.calendlyLink ? `Link de Calendly para reuniones: ${global.calendlyLink}` : ""}

Instrucciones:
${buildEmailInstructions(emailCfg)}
- Los emails deben tener asunto y cuerpo separados
- Cada paso debe ser progresivamente más conciso y directo

Instrucciones generales:
${GENERAL_RULES}

Devolvé ÚNICAMENTE un JSON válido sin markdown, con este formato exacto:
{
  "email": ${buildEmailJsonTemplate(emailCfg.step_count)}
}`

  const userPrompt = [
    prospectUserPromptLines(prospect),
    emailContext ? `\nContexto adicional:\n${emailContext}` : "",
  ].filter(Boolean).join("\n")

  const message = await callClaude(systemPrompt, userPrompt)
  const text = message.content[0].type === "text" ? message.content[0].text : ""
  const parsed = parseJson<{ email: EmailStep[] }>(text)
  return parsed.email
}

// ─── generateLinkedinOnly ─────────────────────────────────────────────────────

export async function generateLinkedinOnly(
  prospectId: string,
  linkedinContext: string,
  liConfigOverride?: LinkedinSequenceConfig
): Promise<LinkedinStep[]> {
  const [prospect, global] = await Promise.all([fetchProspect(prospectId), fetchGlobalConfig()])
  const liCfg = liConfigOverride ?? global.liCfg

  const systemPrompt = `Sos un SDR experto en ventas B2B con mucha experiencia en outreach por LinkedIn.
Tu tarea es generar mensajes de LinkedIn para un prospecto específico.

Contexto del producto:
${global.productContext}

Instrucciones:
${buildLinkedinInstructions(liCfg)}

Instrucciones generales:
${GENERAL_RULES}

Devolvé ÚNICAMENTE un JSON válido sin markdown, con este formato exacto:
{
  "linkedin": ${buildLinkedinJsonTemplate(liCfg.step_count)}
}`

  const userPrompt = [
    prospectUserPromptLines(prospect),
    linkedinContext ? `\nContexto adicional para LinkedIn:\n${linkedinContext}` : "",
  ].filter(Boolean).join("\n")

  const message = await callClaude(systemPrompt, userPrompt, 1024)
  const text = message.content[0].type === "text" ? message.content[0].text : ""
  const parsed = parseJson<{ linkedin: LinkedinStep[] }>(text)
  return parsed.linkedin
}
