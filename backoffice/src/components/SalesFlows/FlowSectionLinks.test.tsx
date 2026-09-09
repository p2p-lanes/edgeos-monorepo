import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { render, screen } from "@testing-library/react"
import type { ReactNode } from "react"
import { beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("@tanstack/react-router", () => ({
  Link: ({
    children,
    search,
    to,
  }: {
    children: ReactNode
    search: { flow: string }
    to: string
  }) => (
    <a data-flow={search.flow} href={to}>
      {children}
    </a>
  ),
}))

vi.mock("@/client", () => ({
  SalesFlowsService: { listSalesFlowReadiness: vi.fn() },
}))

import { SalesFlowsService } from "@/client"
import { FlowSectionLinks } from "./FlowSectionLinks"

const mockListReadiness = vi.mocked(SalesFlowsService.listSalesFlowReadiness)

describe("FlowSectionLinks", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockListReadiness.mockResolvedValue([] as never)
  })

  it("carries the supplied flow ID to every target", () => {
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    })

    render(
      <QueryClientProvider client={queryClient}>
        <FlowSectionLinks
          popupId="popup-1"
          flowId="current-flow"
          flowType="application"
        />
      </QueryClientProvider>,
    )

    const links = [
      screen.getByRole("link", { name: /checkout steps/i }),
      screen.getByRole("link", { name: /application form/i }),
      screen.getByRole("link", { name: /sale emails/i }),
    ]
    expect(links).toHaveLength(3)
    for (const link of links) {
      expect(link).toHaveAttribute("data-flow", "current-flow")
    }
  })
})
