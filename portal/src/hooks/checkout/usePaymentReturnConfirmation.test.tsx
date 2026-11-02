import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { act, renderHook } from "@testing-library/react"
import type { ReactNode } from "react"
import { afterEach, expect, it, vi } from "vitest"
import { usePaymentReturnConfirmation } from "./usePaymentReturnConfirmation"

const confirm = vi.hoisted(() => vi.fn())
vi.mock("@/client", () => ({ PaymentsService: { confirmMyPayment: confirm } }))
vi.mock("@/providers/tenantProvider", () => ({
  useTenant: () => ({ tenant: { id: "tenant-a" } }),
}))
const paymentId = "11111111-1111-4111-8111-111111111111"
function wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: Infinity } },
  })
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>
}
afterEach(() => {
  vi.useRealTimers()
  vi.clearAllMocks()
})
it("caps automatic pending confirmation at three sequential checks", async () => {
  vi.useFakeTimers()
  confirm.mockResolvedValue({ id: paymentId, status: "pending" })
  const hook = renderHook(
    () => usePaymentReturnConfirmation(paymentId, "demo"),
    { wrapper },
  )
  await act(async () => {
    await vi.advanceTimersByTimeAsync(100)
  })
  expect(hook.result.current.state).toBe("pending")
  for (let i = 0; i < 5; i++)
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2100)
    })
  expect(confirm).toHaveBeenCalledTimes(3)
  await act(async () => {
    await hook.result.current.retry()
    await vi.advanceTimersByTimeAsync(100)
  })
  expect(confirm).toHaveBeenCalledTimes(4)
})
it("keeps terminal and invalid identities unverified without retries", async () => {
  vi.useFakeTimers()
  confirm.mockResolvedValue({ id: paymentId, status: "cancelled" })
  const hook = renderHook(
    () => usePaymentReturnConfirmation(paymentId, "demo"),
    { wrapper },
  )
  await act(async () => {
    await vi.advanceTimersByTimeAsync(10000)
  })
  expect(hook.result.current.state).toBe("unverified")
  expect(confirm).toHaveBeenCalledTimes(1)
  const invalid = renderHook(
    () => usePaymentReturnConfirmation("not-an-id", "demo"),
    { wrapper },
  )
  expect(invalid.result.current.state).toBe("unverified")
  await act(async () => {
    await invalid.result.current.retry()
  })
  expect(confirm).toHaveBeenCalledTimes(1)
})
