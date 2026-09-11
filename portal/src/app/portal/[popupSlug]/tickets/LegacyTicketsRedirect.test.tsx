import { render, waitFor } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"

const replace = vi.fn()
let searchParams = new URLSearchParams()

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace }),
  useSearchParams: () => searchParams,
}))

import { LegacyTicketsRedirect } from "./LegacyTicketsRedirect"

describe("LegacyTicketsRedirect", () => {
  it("redirects legacy Tickets to canonical Passes", async () => {
    searchParams = new URLSearchParams()
    render(<LegacyTicketsRedirect popupSlug="summit" />)

    await waitFor(() => {
      expect(replace).toHaveBeenCalledWith("/portal/summit/passes")
    })
  })

  it("preserves only an encoded flow identifier that Passes can validate", async () => {
    searchParams = new URLSearchParams({
      flow: "volunteer flow",
      unrelated: "discarded",
    })
    render(<LegacyTicketsRedirect popupSlug="summit" />)

    await waitFor(() => {
      expect(replace).toHaveBeenCalledWith(
        "/portal/summit/passes?flow=volunteer+flow",
      )
    })
  })
})
