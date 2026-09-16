import type { LanguageModelUsage } from "ai"

export type ConversationUsageMetadata = {
  edgeosUsage: {
    eventId: string
    provider: "openai" | "google"
    model: string
    inputTokens: number
    cachedInputTokens: number
    outputTokens: number
    reasoningTokens: number
  }
}

export function conversationUsageMetadata(
  eventId: string,
  provider: "openai" | "google",
  model: string,
  usage: LanguageModelUsage,
): ConversationUsageMetadata {
  return {
    edgeosUsage: {
      eventId,
      provider,
      model,
      inputTokens: usage.inputTokens ?? 0,
      cachedInputTokens: usage.inputTokenDetails.cacheReadTokens ?? 0,
      outputTokens: usage.outputTokens ?? 0,
      reasoningTokens: usage.outputTokenDetails.reasoningTokens ?? 0,
    },
  }
}
