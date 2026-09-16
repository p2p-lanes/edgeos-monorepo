import { describe, expect, it } from "vitest"
import { conversationUsageMetadata } from "./usage.js"

describe("conversation usage metadata", () => {
  it("keeps normalized provider token counts without raw usage", () => {
    expect(
      conversationUsageMetadata("event-1", "openai", "gpt-edgeos", {
        inputTokens: 120,
        inputTokenDetails: {
          noCacheTokens: 100,
          cacheReadTokens: 20,
          cacheWriteTokens: undefined,
        },
        outputTokens: 40,
        outputTokenDetails: { textTokens: 30, reasoningTokens: 10 },
        totalTokens: 160,
        raw: { provider_detail: "must not be persisted" },
      }),
    ).toEqual({
      edgeosUsage: {
        eventId: "event-1",
        provider: "openai",
        model: "gpt-edgeos",
        inputTokens: 120,
        cachedInputTokens: 20,
        outputTokens: 40,
        reasoningTokens: 10,
      },
    })
  })
})
