import { describe, expect, it } from "vitest"
import en from "./locales/en.json"
import es from "./locales/es.json"
import is from "./locales/is.json"
import zh from "./locales/zh.json"

describe("Pending fee translations", () => {
  const locales = { en, es, is, zh }

  it.each(
    Object.entries(locales),
  )("defines pending fee labels for %s", (_locale, messages) => {
    expect(messages.status.pending_fee).toBeTruthy()
    expect(messages.status.pending_fee).not.toBe("status.pending_fee")
    expect(messages.cta.pending_fee).toBeTruthy()
    expect(messages.cta.pending_fee).not.toBe("cta.pending_fee")
  })

  it("uses distinct status and action wording in English", () => {
    expect(en.status.pending_fee).toBe("Application fee due")
    expect(en.cta.pending_fee).toBe("Pay Application Fee")
  })
})
