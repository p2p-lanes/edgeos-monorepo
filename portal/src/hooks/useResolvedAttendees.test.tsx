import { renderHook } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"
import type { AttendeeWithOriginPublic } from "@/client"

const city = { id: "popup-1", sale_type: "application" }
const humanAttendees: AttendeeWithOriginPublic[] = []

vi.mock("@/providers/cityProvider", () => ({
  useCityProvider: () => ({ getCity: () => city }),
}))

vi.mock("@/hooks/useAuth", () => ({
  default: () => ({ user: { id: "human-1", email: "buyer@test.com" } }),
}))

vi.mock("@/hooks/useHumanAttendeesQuery", () => ({
  default: () => ({ data: humanAttendees, isLoading: false }),
  useHumanAttendeesQuery: () => ({ data: humanAttendees, isLoading: false }),
}))

import useResolvedAttendees from "./useResolvedAttendees"

function makeAttendee(
  overrides: Partial<AttendeeWithOriginPublic> & { id: string; name: string },
): AttendeeWithOriginPublic {
  return {
    tenant_id: "tenant-1",
    popup_id: "popup-1",
    human_id: null,
    application_id: null,
    email: null,
    gender: null,
    poap_url: null,
    category: "main",
    products: [],
    origin: "application",
    ...overrides,
  } as unknown as AttendeeWithOriginPublic
}

describe("useResolvedAttendees", () => {
  beforeEach(() => {
    humanAttendees.length = 0
  })

  it("keeps the whole party when its rows hang off different doors", () => {
    // The shape the bug produced: after the one-row-per-human dedup, the
    // buyer's own row was adopted by the application they applied through
    // first, and their spouse was created while they were looking at a
    // second flow. Filing people under doors hid the buyer from themselves
    // on one screen and their spouse on the other.
    humanAttendees.push(
      makeAttendee({
        id: "attendee-self",
        name: "Buyer",
        human_id: "human-1",
        application_id: "application-default",
        category: "main",
      }),
      makeAttendee({
        id: "attendee-spouse",
        name: "Spouse",
        application_id: "application-volunteers",
        category: "spouse",
      }),
    )

    const { result } = renderHook(() => useResolvedAttendees())

    expect(result.current.map((a) => a.id)).toEqual([
      "attendee-self",
      "attendee-spouse",
    ])
  })

  it("keeps a row bought with no application at all", () => {
    humanAttendees.push(
      makeAttendee({
        id: "attendee-direct",
        name: "Buyer",
        human_id: "human-1",
        application_id: null,
        origin: "direct_sale",
      }),
    )

    const { result } = renderHook(() => useResolvedAttendees())

    expect(result.current.map((a) => a.id)).toEqual(["attendee-direct"])
  })
})
