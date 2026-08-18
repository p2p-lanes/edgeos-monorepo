import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import type { ReactNode } from "react"
import { beforeEach, describe, expect, it, vi } from "vitest"

import { ApplicationsService, type PreviousApplicationSummary } from "@/client"
import { PreviousApplicationsSection } from "@/components/applications/PreviousApplicationsSection"

vi.mock("@/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/client")>()
  return {
    ...actual,
    ApplicationsService: {
      listPreviousApplications: vi.fn(),
    },
  }
})

vi.mock("@tanstack/react-router", () => ({
  Link: ({
    children,
    to,
    params,
  }: {
    children: ReactNode
    to: string
    params?: Record<string, string>
  }) => (
    <a href={to} data-params={JSON.stringify(params)}>
      {children}
    </a>
  ),
}))

function summary(
  overrides: Partial<PreviousApplicationSummary> = {},
): PreviousApplicationSummary {
  return {
    id: "application-past",
    popup_id: "popup-past",
    popup_name: "Edge Esmeralda",
    popup_start_date: "2024-10-01T00:00:00Z",
    status: "accepted",
    tickets_count: 3,
    spend: [{ currency: "USD", amount: "1200.00" }],
    ...overrides,
  }
}

function renderSection() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  })

  return render(
    <QueryClientProvider client={queryClient}>
      <PreviousApplicationsSection applicationId="application-1" />
    </QueryClientProvider>,
  )
}

describe("PreviousApplicationsSection", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("lists each previous popup with its status, tickets and spend", async () => {
    vi.mocked(ApplicationsService.listPreviousApplications).mockResolvedValue([
      summary(),
      summary({
        id: "application-past-2",
        popup_id: "popup-past-2",
        popup_name: "Edge Austin",
        status: "rejected",
        tickets_count: 0,
        spend: [],
      }),
    ])

    renderSection()

    await waitFor(() =>
      expect(ApplicationsService.listPreviousApplications).toHaveBeenCalledWith(
        {
          applicationId: "application-1",
        },
      ),
    )

    expect(await screen.findByText("Edge Esmeralda")).toBeInTheDocument()
    expect(screen.getByText("Edge Austin")).toBeInTheDocument()
    expect(screen.getByText("1,200.00")).toBeInTheDocument()
    expect(
      screen.getByRole("heading", { name: /previous applications 2/i }),
    ).toBeInTheDocument()

    // Each row links to that application's own detail page.
    expect(
      screen.getByRole("link", { name: /edge esmeralda/i }),
    ).toHaveAttribute("data-params", JSON.stringify({ id: "application-past" }))
  })

  it("renders zero spend as a dash rather than a zero amount", async () => {
    vi.mocked(ApplicationsService.listPreviousApplications).mockResolvedValue([
      summary({
        tickets_count: 0,
        spend: [{ currency: "USD", amount: "0.00" }],
      }),
    ])

    renderSection()

    expect(await screen.findByText("—")).toBeInTheDocument()
    expect(screen.queryByText("0.00")).not.toBeInTheDocument()
  })

  it("shows every currency separately instead of summing them", async () => {
    vi.mocked(ApplicationsService.listPreviousApplications).mockResolvedValue([
      summary({
        spend: [
          { currency: "ARS", amount: "500.00" },
          { currency: "USD", amount: "100.00" },
        ],
      }),
    ])

    renderSection()

    expect(await screen.findByText("500.00")).toBeInTheDocument()
    expect(screen.getByText("ARS")).toBeInTheDocument()
    expect(screen.getByText("100.00")).toBeInTheDocument()
    expect(screen.getByText("USD")).toBeInTheDocument()
  })

  it("tells the reviewer when there is no history instead of hiding the section", async () => {
    vi.mocked(ApplicationsService.listPreviousApplications).mockResolvedValue(
      [],
    )

    renderSection()

    expect(
      await screen.findByText("No previous applications in other popups."),
    ).toBeInTheDocument()
    expect(
      screen.getByRole("heading", { name: /previous applications/i }),
    ).toBeInTheDocument()
  })

  it("shows a distinct error state and retries the request", async () => {
    vi.mocked(ApplicationsService.listPreviousApplications)
      .mockRejectedValueOnce(new Error("network error"))
      .mockResolvedValueOnce([summary()])

    const user = userEvent.setup()
    renderSection()

    expect(
      await screen.findByText("Unable to load previous applications."),
    ).toBeInTheDocument()
    expect(
      screen.queryByText("No previous applications in other popups."),
    ).not.toBeInTheDocument()

    await user.click(screen.getByRole("button", { name: "Retry" }))

    await waitFor(() =>
      expect(
        ApplicationsService.listPreviousApplications,
      ).toHaveBeenCalledTimes(2),
    )
    expect(await screen.findByText("Edge Esmeralda")).toBeInTheDocument()
  })

  it("falls back to a placeholder when the popup no longer exists", async () => {
    vi.mocked(ApplicationsService.listPreviousApplications).mockResolvedValue([
      summary({ popup_name: null, popup_start_date: null }),
    ])

    renderSection()

    expect(await screen.findByText("Unknown popup")).toBeInTheDocument()
  })
})
