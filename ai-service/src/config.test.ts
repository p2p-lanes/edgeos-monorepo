import { describe, expect, it } from "vitest"
import { loadConfig } from "./config.js"

describe("loadConfig", () => {
  it("configures OpenAI with its default model", () => {
    const config = loadConfig({
      AI_PROVIDER: "openai",
      OPENAI_API_KEY: "openai-key",
    })

    expect(config.provider).toBe("openai")
    expect(config.openaiApiKey).toBe("openai-key")
    expect(config.model).toBe("gpt-5.6-terra")
  })

  it("preserves Gemini as the default for existing installations", () => {
    const config = loadConfig({ GEMINI_API_KEY: "gemini-key" })

    expect(config.provider).toBe("google")
    expect(config.geminiApiKey).toBe("gemini-key")
    expect(config.model).toBe("gemini-2.5-flash")
  })

  it("infers OpenAI when it is the only configured provider", () => {
    const config = loadConfig({ OPENAI_API_KEY: "openai-key" })

    expect(config.provider).toBe("openai")
  })

  it("allows an explicit model override", () => {
    const config = loadConfig({
      AI_PROVIDER: "openai",
      AI_MODEL: "gpt-5.1",
    })

    expect(config.model).toBe("gpt-5.1")
  })

  it("rejects unknown providers", () => {
    expect(() => loadConfig({ AI_PROVIDER: "other" })).toThrow(
      'AI_PROVIDER must be either "openai" or "google"',
    )
  })
})
