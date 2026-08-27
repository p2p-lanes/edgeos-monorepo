import { describe, expect, it } from "vitest"
import { approvalSecretForContext } from "./context.js"

const baseContext = {
  tenantId: "tenant-1",
  popup: { id: "popup-1", tenant_id: "tenant-1", name: "Gathering" },
  user: { id: "user-1", email: "admin@example.com", role: "admin" as const },
}

describe("approvalSecretForContext", () => {
  it("binds approvals to the user, organization, and active gathering", () => {
    const original = approvalSecretForContext("root-secret", baseContext)

    expect(approvalSecretForContext("root-secret", baseContext)).toEqual(
      original,
    )
    expect(
      approvalSecretForContext("root-secret", {
        ...baseContext,
        popup: { ...baseContext.popup, id: "popup-2" },
      }),
    ).not.toEqual(original)
    expect(
      approvalSecretForContext("root-secret", {
        ...baseContext,
        tenantId: "tenant-2",
      }),
    ).not.toEqual(original)
    expect(
      approvalSecretForContext("root-secret", {
        ...baseContext,
        user: { ...baseContext.user, id: "user-2" },
      }),
    ).not.toEqual(original)
  })
})
