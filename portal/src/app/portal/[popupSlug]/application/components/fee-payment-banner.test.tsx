import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { renderHook, waitFor } from "@testing-library/react"
import { createElement, type ReactNode } from "react"
import { beforeEach, describe, expect, it, vi } from "vitest"
import type { ApplicationPortalPublic, PaymentPortalPublic } from "@/client"
import { ApplicationsService, PaymentsService } from "@/client"
import { trackGAApplicationFeePurchase } from "@/lib/google-analytics"
import { useFeePaymentConfirmation } from "./fee-payment-banner"

vi.mock("@/client", () => ({
  ApplicationsService: { listMyApplications: vi.fn() },
  PaymentsService: { listMyPayments: vi.fn() },
}))
vi.mock("@/lib/google-analytics", () => ({
  trackGAApplicationFeePurchase: vi.fn(),
}))
vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}))
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }))

const application = {
  id: "app-1",
  status: "pending_fee",
} as ApplicationPortalPublic

function wrapper({ children }: { children: ReactNode }) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  return createElement(QueryClientProvider, { client: queryClient }, children)
}

describe("useFeePaymentConfirmation GA4", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(ApplicationsService.listMyApplications).mockResolvedValue({
      results: [{ ...application, status: "in review" }],
    } as Awaited<ReturnType<typeof ApplicationsService.listMyApplications>>)
  })

  it("tracks the approved fee for the returning application", async () => {
    const fee = {
      id: "fee-1",
      application_id: application.id,
      payment_type: "application_fee",
      status: "approved",
      popup_id: "popup-1",
      amount: "999",
    } as PaymentPortalPublic
    vi.mocked(PaymentsService.listMyPayments).mockResolvedValue({
      results: [{ ...fee, id: "other", application_id: "app-2" }, fee],
    } as Awaited<ReturnType<typeof PaymentsService.listMyPayments>>)

    const { result } = renderHook(
      () => useFeePaymentConfirmation(application, true),
      { wrapper },
    )

    await waitFor(() => expect(result.current.paymentConfirmed).toBe(true))
    await waitFor(() =>
      expect(trackGAApplicationFeePurchase).toHaveBeenCalledWith({
        payment: fee,
      }),
    )
  })

  it("does not track a pending fee or a visit without a checkout return", async () => {
    vi.mocked(PaymentsService.listMyPayments).mockResolvedValue({
      results: [
        {
          id: "fee-1",
          application_id: application.id,
          payment_type: "application_fee",
          status: "pending",
        },
      ],
    } as Awaited<ReturnType<typeof PaymentsService.listMyPayments>>)

    const { result, unmount } = renderHook(
      () => useFeePaymentConfirmation(application, true),
      { wrapper },
    )
    await waitFor(() => expect(result.current.paymentConfirmed).toBe(true))
    expect(trackGAApplicationFeePurchase).not.toHaveBeenCalled()
    unmount()

    renderHook(() => useFeePaymentConfirmation(application, false), { wrapper })
    expect(trackGAApplicationFeePurchase).not.toHaveBeenCalled()
  })
})
