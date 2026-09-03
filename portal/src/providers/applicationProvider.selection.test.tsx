/**
 * Which application a portal screen is looking at.
 *
 * The provider used to filter by gathering and take `.slice(-1)[0]` — the
 * OLDEST, since the API orders by created_at descending. Someone accepted
 * as a volunteer who also applied for general entry got whichever came
 * last in the array, and the attendees shown, the balance applied and the
 * application the payment was created against all followed it silently
 * (sdd/sales-flows-rediseno).
 *
 * These cases pin the replacement: name the door, or get nothing.
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { renderHook } from "@testing-library/react"
import type { ReactNode } from "react"
import { describe, expect, it, vi } from "vitest"

vi.mock("@/hooks/useGetApplications", () => ({
  useApplicationsQuery: () => ({ data: MOCK_APPLICATIONS }),
}))

vi.mock("@/hooks/useParticipationQuery", () => ({
  useParticipationQuery: () => ({ data: null }),
}))

vi.mock("./cityProvider", () => ({
  useCityProvider: () => ({ getCity: () => ({ id: "popup-1" }) }),
}))

import ApplicationProvider, { useApplication } from "./applicationProvider"

const VOLUNTEERS = "flow-volunteers"
const GENERAL = "flow-general"

// Ordered created_at DESC, the way the API returns them. The old code took
// the last entry, so it would have picked GENERAL — the older application.
const MOCK_APPLICATIONS = [
  {
    id: "app-volunteers",
    popup_id: "popup-1",
    sales_flow_id: VOLUNTEERS,
    status: "accepted",
    attendees: [{ id: "att-1", name: "Ana" }],
  },
  {
    id: "app-general",
    popup_id: "popup-1",
    sales_flow_id: GENERAL,
    status: "in review",
    attendees: [{ id: "att-2", name: "Luis" }],
  },
]

function wrapper({ children }: { children: ReactNode }) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  return (
    <QueryClientProvider client={queryClient}>
      <ApplicationProvider>{children}</ApplicationProvider>
    </QueryClientProvider>
  )
}

describe("choosing an application", () => {
  it("returns the application of the door it was asked about", () => {
    const { result } = renderHook(() => useApplication(), { wrapper })

    expect(result.current.getRelevantApplication(VOLUNTEERS)?.id).toBe(
      "app-volunteers",
    )
    expect(result.current.getRelevantApplication(GENERAL)?.id).toBe(
      "app-general",
    )
  })

  it("returns nothing rather than another door's application", () => {
    /* The old behaviour answered with whatever was last in the list, and
       every screen below trusted it. */
    const { result } = renderHook(() => useApplication(), { wrapper })

    expect(result.current.getRelevantApplication("flow-nobody")).toBeNull()
  })

  it("refuses to choose when no door is named and there is more than one", () => {
    const { result } = renderHook(() => useApplication(), { wrapper })

    expect(result.current.getRelevantApplication()).toBeNull()
  })

  it("gives each door its own attendees", () => {
    const { result } = renderHook(() => useApplication(), { wrapper })

    expect(result.current.getAttendees(VOLUNTEERS).map((a) => a.name)).toEqual([
      "Ana",
    ])
    expect(result.current.getAttendees(GENERAL).map((a) => a.name)).toEqual([
      "Luis",
    ])
  })

  it("lists every application this person holds for the gathering", () => {
    const { result } = renderHook(() => useApplication(), { wrapper })

    expect(result.current.getApplicationsForPopup().map((a) => a.id)).toEqual([
      "app-volunteers",
      "app-general",
    ])
  })
})
