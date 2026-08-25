import { render, screen, waitFor } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"

// ---------------------------------------------------------------------------
// Compatibility redirects now live in the route pages. The layout must stay
// transparent so legacy /passes routes can reach their canonical destinations.
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

describe("passes compatibility layout", () => {
  beforeEach(() => {
    mockReplace.mockClear()
  })

  it("keeps legacy route children available when the popup has ended", async () => {
    mockCity = { id: "city-1", slug: "festival", status: "ended" }

    render(
      <Layout>
        <div data-testid="child">buy passes</div>
      </Layout>,
    )

    expect(screen.getByTestId("child")).toBeTruthy()
    await waitFor(() => expect(mockReplace).not.toHaveBeenCalled())
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
