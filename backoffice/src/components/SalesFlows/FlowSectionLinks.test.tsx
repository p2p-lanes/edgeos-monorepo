import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { fireEvent, render, screen } from "@testing-library/react"
import type { ReactNode } from "react"
import { beforeEach, describe, expect, it, vi } from "vitest"

const prefetch = vi.hoisted(() => vi.fn())
vi.mock("@/hooks/useFlowEditorPrefetch", () => ({
  useFlowEditorPrefetch: () => ({ prefetch }),
}))

vi.mock("@tanstack/react-router", () => ({
  Link: ({
    children,
    search,
    to,
    onPointerEnter,
    onFocus,
  }: {
    children: ReactNode
    search: { flow: string }
    to: string
    onPointerEnter?: () => void
    onFocus?: () => void
  }) => (
    <a
      data-flow={search.flow}
      href={to}
      onPointerEnter={onPointerEnter}
      onFocus={onFocus}
    >
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
    expect(prefetch).not.toHaveBeenCalled()
    fireEvent.pointerEnter(links[0])
    fireEvent.focus(links[1])
    expect(prefetch).toHaveBeenNthCalledWith(
      1,
      "/ticketing-steps",
      "current-flow",
      "popup-1",
    )
    expect(prefetch).toHaveBeenNthCalledWith(
      2,
      "/form-builder",
      "current-flow",
      "popup-1",
    )
  })
})
