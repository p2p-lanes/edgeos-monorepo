import { describe, expect, it } from "vitest"
import { buildSystemPrompt } from "./system-prompt.js"

const context = {
  authorization: "Bearer token",
  tenantId: "tenant-1",
  popup: { id: "popup-1", tenant_id: "tenant-1", name: "Festival" },
  user: { id: "user-1", email: "admin@example.com", role: "admin" as const },
}

describe("buildSystemPrompt", () => {
  it("grounds the agent with authoritative live operation matches", () => {
    const prompt = buildSystemPrompt(
      context,
      "No additional workflow.",
      "- popups-update_popup | PATCH | Update Popup | gathering; body fields: start_date, end_date",
    )

    expect(prompt).toContain("popups-update_popup")
    expect(prompt).toContain("start_date, end_date")
    expect(prompt).toContain(
      "Never claim that a listed preflight operation is unavailable",
    )
  })
})
