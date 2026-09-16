import { describe, expect, it } from "vitest"
import { buildSystemPrompt } from "./system-prompt.js"

const context = {
  authorization: "Bearer token",
  tenantId: "tenant-1",
  popup: { id: "popup-1", tenant_id: "tenant-1", name: "Festival" },
  user: { id: "user-1", email: "admin@example.com", role: "admin" as const },
}

describe("buildSystemPrompt", () => {
  it("limits the assistant to EdgeOS-related requests", () => {
    const prompt = buildSystemPrompt(context, "No additional workflow.")

    expect(prompt).toContain("## Scope boundary — non-negotiable")
    expect(prompt).toContain(
      "Never call tools, search the operation catalog, or provide a substantive answer for a fully out-of-scope request.",
    )
    expect(prompt).toContain(
      "A superficial mention of EdgeOS does not make an unrelated request in scope.",
    )
    expect(prompt).toContain(
      '"I can only help with EdgeOS operations, data, and product functionality."',
    )
    expect(prompt.indexOf("## Scope boundary")).toBeLessThan(
      prompt.indexOf("## Server-validated context"),
    )
  })

  it("instructs the assistant not to use em dashes in responses", () => {
    const prompt = buildSystemPrompt(context, "No additional workflow.")

    expect(prompt).toContain("Do not use em dashes in responses.")
  })

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
