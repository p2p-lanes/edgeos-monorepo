import { render, screen, waitFor } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"

const mockReplace = vi.fn()
vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: mockReplace }),
}))

let authState: { user: { id: string } | null; isUserLoading: boolean }
vi.mock("@/hooks/useAuth", () => ({
  default: () => authState,
}))

vi.mock("@/components/ui/Loader", () => ({
  Loader: () => <div data-testid="loader" />,
}))

import Authentication from "./Authentication"

describe("Authentication", () => {
  beforeEach(() => {
    mockReplace.mockClear()
    window.history.replaceState({}, "", "/")
  })

  it("preserves the requested popup URL when sending a visitor to login", async () => {
    authState = { user: null, isUserLoading: false }
    window.history.replaceState(
      {},
      "",
      "/portal/tech-summit-2025?tab=events#schedule",
    )

    render(
      <Authentication>
        <div>Portal content</div>
      </Authentication>,
    )

    await waitFor(() => {
      expect(mockReplace).toHaveBeenCalledWith(
        "/auth?redirect=%2Fportal%2Ftech-summit-2025%3Ftab%3Devents%23schedule",
      )
    })
    expect(screen.getByTestId("loader")).toBeTruthy()
    expect(screen.queryByText("Portal content")).toBeNull()
  })

  it("renders the requested page for an authenticated visitor", () => {
    authState = { user: { id: "human-1" }, isUserLoading: false }

    render(
      <Authentication>
        <div>Portal content</div>
      </Authentication>,
    )

    expect(screen.getByText("Portal content")).toBeTruthy()
    expect(mockReplace).not.toHaveBeenCalled()
  })
})
