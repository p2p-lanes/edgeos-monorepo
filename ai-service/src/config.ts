type Environment = Record<string, string | undefined>

const optional = (environment: Environment, name: string): string | undefined =>
  environment[name]?.trim() || undefined

export type AIProvider = "google" | "openai"

export type Config = {
  port: number
  backendUrl: string
  provider: AIProvider
  geminiApiKey?: string
  openaiApiKey?: string
  model: string
  toolApprovalSecret?: string
}

export function loadConfig(environment: Environment = process.env): Config {
  const port = Number.parseInt(environment.PORT ?? "3002", 10)
  if (!Number.isInteger(port) || port <= 0 || port > 65535) {
    throw new Error("PORT must be a valid TCP port")
  }

  const geminiApiKey = optional(environment, "GEMINI_API_KEY")
  const openaiApiKey = optional(environment, "OPENAI_API_KEY")
  const configuredProvider = optional(environment, "AI_PROVIDER")
  if (
    configuredProvider !== undefined &&
    configuredProvider !== "google" &&
    configuredProvider !== "openai"
  ) {
    throw new Error('AI_PROVIDER must be either "openai" or "google"')
  }

  // Preserve existing Gemini installations while preferring OpenAI when its key
  // is the only provider configuration present.
  const provider: AIProvider =
    configuredProvider ?? (openaiApiKey && !geminiApiKey ? "openai" : "google")

  return {
    port,
    backendUrl: (environment.BACKEND_URL ?? "http://localhost:8000").replace(
      /\/$/,
      "",
    ),
    provider,
    geminiApiKey,
    openaiApiKey,
    model:
      optional(environment, "AI_MODEL") ??
      (provider === "openai" ? "gpt-5.6-terra" : "gemini-2.5-flash"),
    toolApprovalSecret: optional(environment, "TOOL_APPROVAL_SECRET"),
  }
}
