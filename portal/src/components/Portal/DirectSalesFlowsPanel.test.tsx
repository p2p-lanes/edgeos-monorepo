import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { render, screen, waitFor } from "@testing-library/react"
import type { ReactNode } from "react"
import { describe, expect, it, vi } from "vitest"
import { SalesFlowsService } from "@/client"
import { DirectSalesFlowsPanel } from "./DirectSalesFlowsPanel"

vi.mock("@/client", () => ({
  SalesFlowsService: {
    listPortalDirectSalesFlows: vi.fn(),
  },
}))

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}))

vi.mock("next/link", () => ({
  default: ({ href, children }: { href: string; children: ReactNode }) => (
    <a href={href}>{children}</a>
  ),
}))

function renderWithClient(ui: ReactNode) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  return render(
    <QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>,
  )
}

describe("DirectSalesFlowsPanel", () => {
  it("renders nothing when there are no listed direct sales options", async () => {
    vi.mocked(SalesFlowsService.listPortalDirectSalesFlows).mockResolvedValue({
      results: [],
      paging: { offset: 0, limit: 0, total: 0 },
    } as never)

    const { container } = renderWithClient(
      <DirectSalesFlowsPanel popupSlug="my-event" popupId="popup-1" />,
    )

    await waitFor(() => {
      expect(SalesFlowsService.listPortalDirectSalesFlows).toHaveBeenCalled()
    })
    expect(container.innerHTML).toBe("")
  })

  it("renders organiser names with named public checkout links", async () => {
    vi.mocked(SalesFlowsService.listPortalDirectSalesFlows).mockResolvedValue({
      results: [
        { id: "flow-1", slug: "weekend", name: "Weekend Pass", order: 0 },
        { id: "flow-2", slug: "full-stay", name: "Full Stay", order: 1 },
      ],
      paging: { offset: 0, limit: 2, total: 2 },
    } as never)

    renderWithClient(
      <DirectSalesFlowsPanel popupSlug="my-event" popupId="popup-1" />,
    )

    const weekend = await screen.findByRole("link", { name: "Weekend Pass" })
    const fullStay = screen.getByRole("link", { name: "Full Stay" })
    expect(weekend.getAttribute("href")).toBe("/checkout/my-event/weekend")
    expect(fullStay.getAttribute("href")).toBe("/checkout/my-event/full-stay")
    expect(screen.queryByText(/flow/i)).toBeNull()
  })
})
