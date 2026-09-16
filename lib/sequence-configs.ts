// Tipos y defaults para configuración de secuencias de LinkedIn y Email.
// Archivo separado de "use server" para poder exportar constantes y tipos.

export type LinkedinSequenceConfig = {
  step_count: number
  step1_chars: number
  followup_chars: number
  prompt_mode: "general" | "per_step"
  general_prompt: string
  step_prompts: Record<string, string>
}

export type EmailSequenceConfig = {
  step_count: number
  prompt_mode: "general" | "per_step"
  general_prompt: string
  step_prompts: Record<string, string>
}

export const DEFAULT_LINKEDIN_CONFIG: LinkedinSequenceConfig = {
  step_count: 5,
  step1_chars: 300,
  followup_chars: 150,
  prompt_mode: "general",
  general_prompt: "",
  step_prompts: {},
}

export const DEFAULT_EMAIL_CONFIG: EmailSequenceConfig = {
  step_count: 5,
  prompt_mode: "general",
  general_prompt: "",
  step_prompts: {},
}
