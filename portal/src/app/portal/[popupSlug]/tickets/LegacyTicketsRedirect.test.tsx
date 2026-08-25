import { render, waitFor } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"

const replace = vi.fn()

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace }),
}))

import { LegacyTicketsRedirect } from "./LegacyTicketsRedirect"

describe("LegacyTicketsRedirect", () => {
  it("redirects the legacy passes route to Tickets & Access", async () => {
    render(<LegacyTicketsRedirect popupSlug="summit" />)

    await waitFor(() => {
      expect(replace).toHaveBeenCalledWith("/portal/summit/tickets")
    })
  })
})
