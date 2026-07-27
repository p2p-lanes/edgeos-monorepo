import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import type { ReactNode } from "react"
import { beforeEach, describe, expect, it, vi } from "vitest"

import {
  type ApplicationPublic,
  type PaymentPublic,
  PaymentsService,
} from "@/client"
import {
  ApplicationRelatedRecords,
  RELATED_PAYMENTS_LIMIT,
} from "@/components/applications/ApplicationRelatedRecords"

vi.mock("@/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/client")>()
  return {
    ...actual,
    PaymentsService: {
      listPayments: vi.fn(),
    },
  }
})

vi.mock("@tanstack/react-router", () => ({
  Link: ({
    children,
    to,
    params,
    search,
  }: {
    children: ReactNode
    to: string
    params?: Record<string, string>
    search?: Record<string, string>
  }) => (
    <a
      href={to}
      data-params={JSON.stringify(params)}
      data-search={JSON.stringify(search)}
    >
      {children}
    </a>
  ),
}))

const application: ApplicationPublic = {
  id: "application-1",
  tenant_id: "tenant-1",
  popup_id: "popup-1",
  human_id: "human-1",
  status: "in review",
  human: {
    id: "human-1",
    tenant_id: "tenant-1",
    email: "henry@example.com",
    first_name: "Henry",
    last_name: "Wilson",
    residence: "Denver, CO",
    gender: "male",
    age: "35-44",
    rating: "green_flag",
  },
  attendees: [
    {
      id: "attendee-1",
      tenant_id: "tenant-1",
      popup_id: "popup-1",
      application_id: "application-1",
      name: "Henry Wilson",
      category: "main",
      products: [],
    },
  ],
}

function payment(index: number): PaymentPublic {
  return {
    id: `payment-${index}`,
    tenant_id: "tenant-1",
    popup_id: "popup-1",
    application_id: "application-1",
    amount: `${index}.00`,
    currency: "USD",
    status: "pending",
    created_at: `2026-07-${String(index).padStart(2, "0")}T00:00:00Z`,
  }
}

function renderRelatedRecords() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0 },
    },
  })

  return render(
    <QueryClientProvider client={queryClient}>
      <ApplicationRelatedRecords application={application} />
    </QueryClientProvider>,
  )
}

describe("ApplicationRelatedRecords", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("requests only the preview rows and displays the real payment total", async () => {
    vi.mocked(PaymentsService.listPayments).mockResolvedValue({
      results: [payment(1), payment(2), payment(3), payment(4)],
      paging: { limit: RELATED_PAYMENTS_LIMIT, offset: 0, total: 12 },
    })

    renderRelatedRecords()

    await waitFor(() =>
      expect(PaymentsService.listPayments).toHaveBeenCalledWith({
        applicationId: "application-1",
        limit: RELATED_PAYMENTS_LIMIT,
      }),
    )

    expect(await screen.findByText("1.00 USD")).toBeInTheDocument()
    expect(
      screen.getByRole("heading", { name: /payments 12/i }),
    ).toBeInTheDocument()
    expect(screen.getByText("3.00 USD")).toBeInTheDocument()
    expect(screen.queryByText("4.00 USD")).not.toBeInTheDocument()
  })

  it("shows a distinct error state and retries the payments request", async () => {
    vi.mocked(PaymentsService.listPayments)
      .mockRejectedValueOnce(new Error("network error"))
      .mockResolvedValueOnce({
        results: [payment(7)],
        paging: { limit: RELATED_PAYMENTS_LIMIT, offset: 0, total: 1 },
      })

    const user = userEvent.setup()
    renderRelatedRecords()

    expect(
      await screen.findByText("Unable to load payments."),
    ).toBeInTheDocument()
    expect(
      screen.queryByText("No payments associated with this application."),
    ).not.toBeInTheDocument()

    await user.click(screen.getByRole("button", { name: "Retry" }))

    await waitFor(() =>
      expect(PaymentsService.listPayments).toHaveBeenCalledTimes(2),
    )
    expect(await screen.findByText("7.00 USD")).toBeInTheDocument()
  })

  it("keeps direct navigation to the related human and attendees", async () => {
    vi.mocked(PaymentsService.listPayments).mockResolvedValue({
      results: [],
      paging: { limit: RELATED_PAYMENTS_LIMIT, offset: 0, total: 0 },
    })

    renderRelatedRecords()

    const humanLink = screen.getByRole("link", { name: /open profile/i })
    const attendeesLink = screen.getByRole("link", { name: /view all/i })

    expect(humanLink).toHaveAttribute(
      "data-params",
      JSON.stringify({ id: "human-1" }),
    )
    expect(attendeesLink).toHaveAttribute(
      "data-search",
      JSON.stringify({ applicationId: "application-1" }),
    )
    expect(await screen.findAllByText("Henry Wilson")).toHaveLength(2)
  })
})
