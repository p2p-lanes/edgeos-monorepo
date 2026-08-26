import { renderHook } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"
import type { AttendeeWithOriginPublic } from "@/client"
import useResolvedAttendees from "./useResolvedAttendees"

const mockUseHumanAttendeesQuery = vi.fn()

let mockCity: {
  id: string
  sale_type: "direct" | "application"
  checkout_mode: "simple_quantity" | "pass_system"
  takes_applications?: boolean
} | null = null
let mockUser: {
  id: string
  tenant_id: string
  email: string
  first_name: string
  last_name: string
  gender: string | null
} | null = null

vi.mock("@/hooks/useAuth", () => ({
  default: () => ({ user: mockUser }),
}))

vi.mock("@/hooks/useHumanAttendeesQuery", () => ({
  default: (popupId: string | null) => mockUseHumanAttendeesQuery(popupId),
}))

vi.mock("@/providers/cityProvider", () => ({
  useCityProvider: () => ({ getCity: () => mockCity }),
}))

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

const persistedAttendee = makeAttendee({
  id: "attendee-1",
  name: "Direct Buyer",
  human_id: "human-1",
  origin: "direct_sale",
  email: "buyer@example.com",
  products: [
    {
      id: "ticket-1",
      attendee_id: "attendee-1",
      product_id: "product-1",
      check_in_code: "check-in-1",
      product_name: "Weekend Pass",
      product_category: "ticket",
      duration_type: "full",
    },
  ],
})

describe("useResolvedAttendees", () => {
  beforeEach(() => {
    mockCity = {
      id: "popup-1",
      sale_type: "direct",
      checkout_mode: "simple_quantity",
      takes_applications: false,
    }
    mockUser = {
      id: "human-1",
      tenant_id: "tenant-1",
      email: "buyer@example.com",
      first_name: "Direct",
      last_name: "Buyer",
      gender: null,
    }
    mockUseHumanAttendeesQuery.mockReset()
  })

  it("returns persisted direct-sale attendees with ticket entries", () => {
    mockUseHumanAttendeesQuery.mockReturnValue({ data: [persistedAttendee] })

    const { result } = renderHook(() => useResolvedAttendees())

    expect(mockUseHumanAttendeesQuery).toHaveBeenCalledWith("popup-1")
    expect(result.current[0]?.id).toBe("attendee-1")
    expect(result.current[0]?.ticket_entries).toEqual(
      persistedAttendee.products,
    )
  })

  it("uses the synthetic attendee after a successful empty response", () => {
    mockUseHumanAttendeesQuery.mockReturnValue({ data: [] })

    const { result } = renderHook(() => useResolvedAttendees())

    expect(result.current).toHaveLength(1)
    expect(result.current[0]).toMatchObject({
      id: "human-1",
      human_id: "human-1",
      popup_id: "popup-1",
      name: "Direct Buyer",
    })
  })

  it.each([
    undefined,
    null,
  ])("returns no synthetic attendee before the query resolves", (data) => {
    mockUseHumanAttendeesQuery.mockReturnValue({ data })

    const { result } = renderHook(() => useResolvedAttendees())

    expect(result.current).toEqual([])
  })

  it("keeps the whole party when its rows hang off different flows", () => {
    mockCity = {
      id: "popup-1",
      sale_type: "application",
      checkout_mode: "pass_system",
      takes_applications: true,
    }
    mockUseHumanAttendeesQuery.mockReturnValue({
      data: [
        makeAttendee({
          id: "attendee-self",
          name: "Buyer",
          human_id: "human-1",
          application_id: "application-default",
        }),
        makeAttendee({
          id: "attendee-spouse",
          name: "Spouse",
          application_id: "application-volunteers",
          category: "spouse",
        }),
      ],
    })

    const { result } = renderHook(() => useResolvedAttendees())

    expect(result.current.map((attendee) => attendee.id)).toEqual([
      "attendee-self",
      "attendee-spouse",
    ])
  })

  it("keeps retained attendees after a background refetch error", () => {
    mockCity = {
      id: "popup-1",
      sale_type: "application",
      checkout_mode: "pass_system",
      takes_applications: true,
    }
    mockUseHumanAttendeesQuery.mockReturnValue({
      data: [
        makeAttendee({
          id: "application-attendee-1",
          name: "Applicant",
          application_id: "application-1",
        }),
      ],
      isError: true,
    })

    const { result } = renderHook(() => useResolvedAttendees())

    expect(result.current[0]?.id).toBe("application-attendee-1")
  })
})
