import { render, waitFor } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"
import HomePasses from "./page"

const mockReplace = vi.fn()
let mockPopupSlug = "festival"

vi.mock("next/navigation", () => ({
  useParams: () => ({ popupSlug: mockPopupSlug }),
  useRouter: () => ({ replace: mockReplace }),
}))

describe("LegacyPassesPage", () => {
  beforeEach(() => {
    mockReplace.mockReset()
    mockPopupSlug = "festival"
  })

  it("redirects the legacy passes route to Tickets & Access", async () => {
    render(<HomePasses />)

    await waitFor(() => {
      expect(mockReplace).toHaveBeenCalledWith("/portal/festival/tickets")
    })
  })

  it("uses the current popup slug in the redirect destination", async () => {
    mockPopupSlug = "winter-gathering"

    render(<HomePasses />)

    await waitFor(() => {
      expect(mockReplace).toHaveBeenCalledWith(
        "/portal/winter-gathering/tickets",
      )
    })
  })
})
