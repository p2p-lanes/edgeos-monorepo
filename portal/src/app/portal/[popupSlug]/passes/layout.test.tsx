import { render, screen, waitFor } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"

// ---------------------------------------------------------------------------
// The ended-popup gate lives in this layout rather than in each page so it
// covers /passes AND every nested route (notably /passes/buy). These tests
// pin that contract — the guard regressed once by living only in page.tsx.
// ---------------------------------------------------------------------------

const mockReplace = vi.fn()
vi.mock("next/navigation", () => ({
  useRouter: () => ({
    push: vi.fn(),
    replace: mockReplace,
    back: vi.fn(),
    forward: vi.fn(),
    refresh: vi.fn(),
    prefetch: vi.fn(),
  }),
  useParams: () => ({ popupSlug: "festival" }),
}))

let mockCity: { id: string; slug: string; status: string } | null = null
vi.mock("@/providers/cityProvider", () => ({
  useCityProvider: () => ({ getCity: () => mockCity }),
}))

vi.mock("@/providers/groupsProvider", () => ({
  GroupsProvider: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
}))

vi.mock("@/components/ui/Loader", () => ({
  Loader: () => <div data-testid="loader" />,
}))

import Layout from "./layout"

describe("passes layout ended guard", () => {
  beforeEach(() => {
    mockReplace.mockClear()
  })

  it("redirects to the popup home and hides children when the popup has ended", async () => {
    mockCity = { id: "city-1", slug: "festival", status: "ended" }

    render(
      <Layout>
        <div data-testid="child">buy passes</div>
      </Layout>,
    )

    await waitFor(() => {
      expect(mockReplace).toHaveBeenCalledWith("/portal/festival")
    })
    expect(screen.queryByTestId("child")).toBeNull()
  })

  it("renders children for an active popup", async () => {
    mockCity = { id: "city-1", slug: "festival", status: "active" }

    render(
      <Layout>
        <div data-testid="child">buy passes</div>
      </Layout>,
    )

    expect(screen.getByTestId("child")).toBeTruthy()
    expect(mockReplace).not.toHaveBeenCalled()
  })

  it("does not redirect while the city is still resolving", () => {
    mockCity = null

    render(
      <Layout>
        <div data-testid="child">buy passes</div>
      </Layout>,
    )

    expect(mockReplace).not.toHaveBeenCalled()
  })
})
