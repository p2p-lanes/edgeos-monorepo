import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { render, screen, waitFor } from "@testing-library/react"
import type { ReactNode } from "react"
import { describe, expect, it, vi } from "vitest"
import { SalesFlowsService } from "@/client"
import { UpsaleFlowsPanel } from "./UpsaleFlowsPanel"

vi.mock("@/client", () => ({
  SalesFlowsService: {
    listPortalUpsaleFlows: vi.fn(),
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

describe("UpsaleFlowsPanel", () => {
  it("renders nothing while there are no eligible upsale flows", async () => {
    vi.mocked(SalesFlowsService.listPortalUpsaleFlows).mockResolvedValue({
      results: [],
      paging: { offset: 0, limit: 0, total: 0 },
    } as never)

    const { container } = renderWithClient(
      <UpsaleFlowsPanel popupSlug="my-event" popupId="popup-1" />,
    )

    await waitFor(() => {
      expect(SalesFlowsService.listPortalUpsaleFlows).toHaveBeenCalled()
    })
    expect(container.innerHTML).toBe("")
  })

  it("links to each eligible upsale flow's checkout page", async () => {
    vi.mocked(SalesFlowsService.listPortalUpsaleFlows).mockResolvedValue({
      results: [
        { id: "flow-1", slug: "vip-addon", name: "VIP Add-on", order: 0 },
      ],
      paging: { offset: 0, limit: 1, total: 1 },
    } as never)

    renderWithClient(
      <UpsaleFlowsPanel popupSlug="my-event" popupId="popup-1" />,
    )

    const link = await screen.findByRole("link", { name: "VIP Add-on" })
    expect(link.getAttribute("href")).toBe("/checkout/my-event/vip-addon")
  })
})
