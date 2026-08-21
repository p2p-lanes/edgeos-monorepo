import { renderHook } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"
import type { AttendeeWithOriginPublic } from "@/client"
import useResolvedAttendees from "./useResolvedAttendees"

const mockUseHumanAttendeesQuery = vi.fn()

let mockCity: {
  id: string
  sale_type: "direct" | "application"
  checkout_mode: "simple_quantity" | "pass_system"
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

const persistedAttendee: AttendeeWithOriginPublic = {
  id: "attendee-1",
  tenant_id: "tenant-1",
  popup_id: "popup-1",
  human_id: "human-1",
  application_id: null,
  name: "Direct Buyer",
  category: "main",
  email: "buyer@example.com",
  origin: "direct_sale",
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
}

describe("useResolvedAttendees", () => {
  beforeEach(() => {
    mockCity = {
      id: "popup-1",
      sale_type: "direct",
      checkout_mode: "simple_quantity",
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

  it("returns the persisted attendee ID and preserves ticket entries", () => {
    mockUseHumanAttendeesQuery.mockReturnValue({
      data: [persistedAttendee],
      isSuccess: true,
      isLoading: false,
      isError: false,
    })

    const { result } = renderHook(() => useResolvedAttendees())

    expect(mockUseHumanAttendeesQuery).toHaveBeenCalledWith("popup-1")
    expect(result.current).toHaveLength(1)
    expect(result.current[0]?.id).toBe("attendee-1")
    expect(result.current[0]?.id).not.toBe("human-1")
    expect(result.current[0]?.ticket_entries).toEqual(
      persistedAttendee.products,
    )
  })

  it("uses the synthetic attendee after a successful empty response", () => {
    mockUseHumanAttendeesQuery.mockReturnValue({
      data: [],
      isSuccess: true,
      isLoading: false,
      isError: false,
    })

    const { result } = renderHook(() => useResolvedAttendees())

    expect(result.current).toHaveLength(1)
    expect(result.current[0]).toMatchObject({
      id: "human-1",
      human_id: "human-1",
      popup_id: "popup-1",
      name: "Direct Buyer",
      products: [],
    })
  })

  it.each([
    [
      "loading",
      { data: undefined, isSuccess: false, isLoading: true, isError: false },
    ],
    [
      "error",
      { data: undefined, isSuccess: false, isLoading: false, isError: true },
    ],
  ])("does not use the synthetic attendee while the query is %s", (_, query) => {
    mockUseHumanAttendeesQuery.mockReturnValue(query)

    const { result } = renderHook(() => useResolvedAttendees())

    expect(result.current).toEqual([])
  })

  it("keeps retained application attendees after a background refetch error", () => {
    mockCity = {
      id: "popup-1",
      sale_type: "application",
      checkout_mode: "pass_system",
    }
    const applicationAttendee: AttendeeWithOriginPublic = {
      ...persistedAttendee,
      id: "application-attendee-1",
      application_id: "application-1",
      origin: "application",
    }
    mockUseHumanAttendeesQuery.mockReturnValue({
      data: [applicationAttendee],
      isSuccess: false,
      isLoading: false,
      isError: true,
    })

    const { result } = renderHook(() => useResolvedAttendees())

    expect(result.current).toHaveLength(1)
    expect(result.current[0]?.id).toBe("application-attendee-1")
  })
})
