import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { cleanup, renderHook, waitFor } from "@testing-library/react"
import type { ReactNode } from "react"
import { afterEach, expect, it, vi } from "vitest"
import { EventParticipantsService } from "@/client"
import { useCanRsvp } from "./useCanRsvp"

vi.mock("@/client", () => ({
  EventParticipantsService: { getPortalRsvpEligibility: vi.fn() },
}))
vi.mock("@/providers/cityProvider", () => ({
  useCityProvider: () => ({ getCity: () => ({ id: "gathering-1" }) }),
}))
afterEach(cleanup)

it.each([
  "rejected",
  "no_tickets",
  null,
] as const)("reflects the server eligibility decision: %s", async (reason) => {
  vi.mocked(
    EventParticipantsService.getPortalRsvpEligibility,
  ).mockResolvedValue({ allowed: reason === null, reason })
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  )
  const { result } = renderHook(() => useCanRsvp(), { wrapper })
  await waitFor(() => expect(result.current.isLoading).toBe(false))
  expect(result.current.canRsvp).toBe(reason === null)
  expect(result.current.reason).toBe(reason)
  expect(
    EventParticipantsService.getPortalRsvpEligibility,
  ).toHaveBeenCalledWith({ popupId: "gathering-1" })
})
