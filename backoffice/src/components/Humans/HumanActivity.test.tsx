/**
 * Application review comments on the human's timeline: the body is shown, the
 * author is credited, and the item links back to the application it was left
 * on, labelled with its popup.
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { render, screen } from "@testing-library/react"
import type { ReactNode } from "react"
import { describe, expect, it, vi } from "vitest"

vi.mock("@/client", () => ({
  HumansService: {
    getHumanActivity: vi.fn(),
  },
}))

vi.mock("@/hooks/useAuth", () => ({
  default: () => ({ isAdmin: false }),
}))

vi.mock("@tanstack/react-router", () => ({
  Link: ({
    children,
    params,
    className,
  }: {
    children: ReactNode
    params: { id: string }
    className?: string
  }) => (
    <a href={`/applications/${params.id}`} className={className}>
      {children}
    </a>
  ),
}))

import { HumansService } from "@/client"
import { HumanActivity } from "./HumanActivity"

const mockGetActivity = vi.mocked(HumansService.getHumanActivity)

function renderActivity() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  return render(
    <QueryClientProvider client={queryClient}>
      <HumanActivity humanId="human-1" />
    </QueryClientProvider>,
  )
}

describe("HumanActivity application comments", () => {
  it("shows the comment, its author and a link to the application", async () => {
    mockGetActivity.mockResolvedValue({
      results: [
        {
          id: "application-comment:c-1",
          kind: "application.comment_added",
          occurred_at: "2026-01-02T10:00:00Z",
          popup_id: "popup-1",
          popup_label: "Edge Esmeralda",
          application_id: "app-1",
          note: "Rejected: incomplete project description",
          actor_name: "Reviewer One",
          products: [],
        },
      ],
      paging: { offset: 0, limit: 50, total: 1 },
    } as never)

    renderActivity()

    expect(
      await screen.findByText("Rejected: incomplete project description"),
    ).toBeInTheDocument()
    expect(screen.getByText(/Reviewer One ·/)).toBeInTheDocument()
    const link = screen.getByRole("link", {
      name: "Edge Esmeralda application",
    })
    expect(link).toHaveAttribute("href", "/applications/app-1")
  })
})
