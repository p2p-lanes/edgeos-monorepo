import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { act, renderHook, waitFor } from "@testing-library/react"
import type { ReactNode } from "react"
import { PaymentsService } from "@/client"
import { usePaymentVerification } from "./usePaymentVerification"

vi.mock("@/client", () => ({
  PaymentsService: {
    getMyLatestPayment: vi.fn(),
    getMyPaymentStatus: vi.fn(),
  },
}))

function createWrapper(): ({ children }: { children: ReactNode }) => ReactNode {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
      },
    },
  })

  return function Wrapper({ children }: { children: ReactNode }) {
    return (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    )
  }
}

async function flushPromises(): Promise<void> {
  await act(async () => {
    await Promise.resolve()
  })
}

describe("usePaymentVerification", () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.clearAllMocks()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it("returns approved without polling when disabled or identifiers are missing", () => {
    const { result } = renderHook(
      () =>
        usePaymentVerification({
          enabled: false,
        }),
      {
        wrapper: createWrapper(),
      },
    )

    expect(result.current).toEqual({
      paymentStatus: "approved",
      isVerifying: false,
    })
    expect(PaymentsService.getMyLatestPayment).not.toHaveBeenCalled()
    expect(PaymentsService.getMyPaymentStatus).not.toHaveBeenCalled()
  })

  it("uses the application path and stops polling once status is approved", async () => {
    vi.useRealTimers()
    vi.mocked(PaymentsService.getMyLatestPayment).mockResolvedValueOnce({
      id: "payment-1",
      status: "approved",
    })

    const { result } = renderHook(
      () =>
        usePaymentVerification({
          applicationId: "application-1",
          enabled: true,
        }),
      {
        wrapper: createWrapper(),
      },
    )

    await waitFor(() => {
      expect(PaymentsService.getMyLatestPayment).toHaveBeenCalledTimes(1)
      expect(result.current).toEqual({
        paymentStatus: "approved",
        isVerifying: false,
      })
    })

    expect(PaymentsService.getMyLatestPayment).toHaveBeenCalledTimes(1)
  })

  it("resets the poll counter when the payment id changes", async () => {
    vi.mocked(PaymentsService.getMyPaymentStatus).mockResolvedValue({
      id: "payment-pending",
      status: "pending",
    })

    const { rerender } = renderHook(
      ({ paymentId }) =>
        usePaymentVerification({
          paymentId,
          enabled: true,
        }),
      {
        initialProps: { paymentId: "payment-1" },
        wrapper: createWrapper(),
      },
    )

    await flushPromises()

    expect(PaymentsService.getMyPaymentStatus).toHaveBeenCalledTimes(1)

    await act(async () => {
      await vi.advanceTimersByTimeAsync(3_000 * 19)
    })

    await flushPromises()

    expect(PaymentsService.getMyPaymentStatus).toHaveBeenCalledTimes(20)

    await act(async () => {
      await vi.advanceTimersByTimeAsync(3_000)
    })

    expect(PaymentsService.getMyPaymentStatus).toHaveBeenCalledTimes(20)

    rerender({ paymentId: "payment-2" })

    await flushPromises()

    expect(PaymentsService.getMyPaymentStatus).toHaveBeenCalledTimes(21)

    await act(async () => {
      await vi.advanceTimersByTimeAsync(3_000)
    })

    await flushPromises()

    expect(PaymentsService.getMyPaymentStatus).toHaveBeenCalledTimes(22)
  })
})
