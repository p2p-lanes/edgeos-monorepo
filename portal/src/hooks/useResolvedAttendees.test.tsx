import { renderHook } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { CHECKOUT_MODE } from "@/checkout/popupCheckoutPolicy"
import type {
  ApplicationPublic,
  AttendeeCategoryPublic,
  AttendeeWithOriginPublic,
} from "@/client"
import {
  buildBaseAttendeePasses,
  restoreRecipientDrafts,
} from "@/providers/passesProvider"
import type { ProductsPass } from "@/types/Products"
import useResolvedAttendees from "./useResolvedAttendees"

const mockUseHumanAttendeesQuery = vi.fn()
const mockUseAttendeeCategories = vi.fn()

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
  telegram?: string | null
  age?: string | null
  residence?: string | null
  picture_url?: string | null
  enriched_profile?: Record<string, unknown> | null
} | null = null
let mockApplications: ApplicationPublic[] | null = null
let mockCategories: AttendeeCategoryPublic[] | undefined

vi.mock("@/client", () => ({}))

vi.mock("@/hooks/useAuth", () => ({
  default: () => ({ user: mockUser }),
}))

vi.mock("@/hooks/useHumanAttendeesQuery", () => ({
  default: (popupId: string | null) => mockUseHumanAttendeesQuery(popupId),
}))

vi.mock("@/hooks/useCartApi", () => ({ useCart: vi.fn() }))
vi.mock("@/hooks/useGetPassesData", () => ({ default: vi.fn() }))
vi.mock("@/hooks/useGetPurchases", () => ({ usePurchasesQuery: vi.fn() }))

vi.mock("@/hooks/useAttendeeCategories", () => ({
  useAttendeeCategories: (popupId: string, salesFlowId?: string | null) => {
    mockUseAttendeeCategories(popupId, salesFlowId)
    return { categories: mockCategories }
  },
}))

vi.mock("@/providers/applicationProvider", () => ({
  useApplication: () => ({
    applications: mockApplications,
    getRelevantApplication: (salesFlowId?: string) =>
      salesFlowId
        ? (mockApplications?.find(
            (application) => application.sales_flow_id === salesFlowId,
          ) ?? null)
        : mockApplications?.length === 1
          ? mockApplications[0]
          : null,
  }),
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

const primaryCategory: AttendeeCategoryPublic = {
  id: "category-main",
  tenant_id: "tenant-1",
  popup_id: "popup-1",
  sales_flow_id: "flow-1",
  key: "main",
  is_primary: true,
}

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
      residence: "Lisbon",
      enriched_profile: { interests: ["music"] },
    }
    mockApplications = []
    mockCategories = [primaryCategory]
    mockUseHumanAttendeesQuery.mockReset()
    mockUseAttendeeCategories.mockReset()
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

  it("preserves same-product tickets with distinct physical identities", () => {
    const attendee = makeAttendee({
      id: "attendee-1",
      name: "Direct Buyer",
      products: [
        {
          id: "ticket-a",
          attendee_id: "attendee-1",
          product_id: "shared-product",
          payment_id: "payment-a",
          check_in_code: "code-a",
        },
        {
          id: "ticket-b",
          attendee_id: "attendee-1",
          product_id: "shared-product",
          payment_id: "payment-b",
          check_in_code: "code-b",
        },
      ],
    })
    mockUseHumanAttendeesQuery.mockReturnValue({ data: [attendee] })

    const { result } = renderHook(() => useResolvedAttendees())

    expect(
      result.current[0]?.ticket_entries?.map((entry) => ({
        id: entry.id,
        payment_id: entry.payment_id,
      })),
    ).toEqual([
      { id: "ticket-a", payment_id: "payment-a" },
      { id: "ticket-b", payment_id: "payment-b" },
    ])
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
      category_id: "category-main",
      recipient: {
        recipient_key: "human:human-1",
        human_id: "human-1",
        category_id: "category-main",
      },
    })
  })

  it("builds one stable application recipient from the Human and primary category", () => {
    mockCity = {
      id: "popup-1",
      sale_type: "application",
      checkout_mode: "pass_system",
      takes_applications: true,
    }
    mockApplications = [
      {
        id: "application-1",
        tenant_id: "tenant-1",
        popup_id: "popup-1",
        human_id: "human-1",
        sales_flow_id: "flow-general",
        status: "accepted",
        custom_fields: { role: "Builder" },
      },
    ] as ApplicationPublic[]
    mockUseHumanAttendeesQuery.mockReturnValue({ data: [] })

    const { result, rerender } = renderHook(() => useResolvedAttendees())
    const first = result.current[0]
    rerender()

    expect(result.current).toHaveLength(1)
    expect(result.current[0]).toEqual(first)
    expect(first).toMatchObject({
      id: "human-1",
      human_id: "human-1",
      application_id: "application-1",
      category_id: "category-main",
      category: "main",
      name: "Direct Buyer",
      email: "buyer@example.com",
      gender: null,
      products: [],
      recipient: {
        recipient_key: "human:human-1",
        human_id: "human-1",
        name: "Direct Buyer",
        email: "buyer@example.com",
        category_id: "category-main",
        profile_snapshot: {
          role: "Builder",
          first_name: "Direct",
          last_name: "Buyer",
          gender: null,
          residence: "Lisbon",
          enriched_profile: { interests: ["music"] },
          category: "main",
        },
      },
    })
    expect(mockUseAttendeeCategories).toHaveBeenCalledWith(
      "popup-1",
      "flow-general",
    )
  })

  it("uses the selected flow when a virtual attendee needs application identity", () => {
    mockCity = {
      id: "popup-1",
      sale_type: "application",
      checkout_mode: "pass_system",
      takes_applications: true,
    }
    mockApplications = [
      {
        id: "application-main",
        popup_id: "popup-1",
        human_id: "human-1",
        sales_flow_id: "flow-main",
      },
      {
        id: "application-partner",
        popup_id: "popup-1",
        human_id: "human-1",
        sales_flow_id: "flow-partner",
      },
    ] as ApplicationPublic[]
    mockUseHumanAttendeesQuery.mockReturnValue({ data: [] })

    const { result } = renderHook(() => useResolvedAttendees("flow-partner"))

    expect(result.current[0]?.application_id).toBe("application-partner")
    expect(mockUseAttendeeCategories).toHaveBeenCalledWith(
      "popup-1",
      "flow-partner",
    )
  })

  it("projects the buyer from fresh Human and Application data in the current flow", () => {
    mockCity = {
      id: "popup-1",
      sale_type: "application",
      checkout_mode: "pass_system",
      takes_applications: true,
    }
    mockApplications = [
      {
        id: "application-current",
        tenant_id: "tenant-1",
        popup_id: "popup-1",
        human_id: "human-1",
        sales_flow_id: "flow-current",
        custom_fields: {
          first_name: "Stale application name",
          role: "Builder",
        },
      },
    ] as ApplicationPublic[]
    mockUseHumanAttendeesQuery.mockReturnValue({
      data: [
        makeAttendee({
          id: "buyer-attendee",
          name: "Stale attendee name",
          human_id: "human-1",
          application_id: "application-old",
          category_id: "category-old",
          category: "old-role",
          additional_data: { residence: "Old residence" },
        }),
      ],
    })

    const { result } = renderHook(() => useResolvedAttendees("flow-current"))

    expect(result.current).toHaveLength(1)
    expect(result.current[0]).toMatchObject({
      id: "buyer-attendee",
      human_id: "human-1",
      name: "Direct Buyer",
      email: "buyer@example.com",
      category_id: "category-main",
      category: "main",
      recipient: {
        recipient_key: "human:human-1",
        human_id: "human-1",
        category_id: "category-main",
        profile_snapshot: {
          first_name: "Direct",
          last_name: "Buyer",
          residence: "Lisbon",
          role: "Builder",
          category: "main",
        },
      },
    })
    expect(result.current[0]?.recipient).not.toHaveProperty(
      "existing_attendee_id",
    )
  })

  it("recognizes only the current application's historical primary attendee as legacy self", () => {
    mockCity = {
      id: "popup-1",
      sale_type: "application",
      checkout_mode: "pass_system",
      takes_applications: true,
    }
    mockApplications = [
      {
        id: "application-current",
        tenant_id: "tenant-1",
        popup_id: "popup-1",
        human_id: "human-1",
        sales_flow_id: "flow-current",
      },
    ] as ApplicationPublic[]
    mockUseHumanAttendeesQuery.mockReturnValue({
      data: [
        makeAttendee({
          id: "legacy-self",
          name: "Legacy name",
          application_id: "application-current",
          category_id: "historical-primary",
          category: "main",
        }),
      ],
    })

    const { result } = renderHook(() => useResolvedAttendees("flow-current"))

    expect(result.current).toHaveLength(1)
    expect(result.current[0]).toMatchObject({
      id: "legacy-self",
      human_id: null,
      name: "Direct Buyer",
      category_id: "category-main",
      recipient: {
        recipient_key: "attendee:legacy-self",
        existing_attendee_id: "legacy-self",
        category_id: "category-main",
      },
    })
    expect(result.current[0]?.recipient).not.toHaveProperty("human_id")
  })

  it("treats a transferred accountless attendee from another application as a companion", () => {
    mockCity = {
      id: "popup-1",
      sale_type: "application",
      checkout_mode: "pass_system",
      takes_applications: true,
    }
    mockApplications = [
      {
        id: "application-current",
        tenant_id: "tenant-1",
        popup_id: "popup-1",
        human_id: "human-1",
        sales_flow_id: "flow-current",
      },
    ] as ApplicationPublic[]
    mockUseHumanAttendeesQuery.mockReturnValue({
      data: [
        makeAttendee({
          id: "transferred-attendee",
          name: "Managed elsewhere",
          application_id: "application-previous-owner",
          category_id: "historical-primary",
          category: "main",
        }),
      ],
    })

    const { result } = renderHook(() => useResolvedAttendees("flow-current"))

    expect(result.current).toHaveLength(2)
    expect(
      result.current.find((attendee) => attendee.id === "transferred-attendee"),
    ).toMatchObject({
      human_id: null,
      category_id: null,
      category: null,
      recipient: {
        recipient_key: "attendee:transferred-attendee",
        existing_attendee_id: "transferred-attendee",
        category_id: null,
      },
    })
  })

  it("keeps Human-linked companions attendee-owned and strips stale roles", () => {
    mockUseHumanAttendeesQuery.mockReturnValue({
      data: [
        persistedAttendee,
        makeAttendee({
          id: "linked-companion",
          name: "Linked Companion",
          human_id: "human-2",
          category_id: "category-other-flow",
          category: "spouse",
          additional_data: {
            category: "spouse",
            category_id: "category-other-flow",
            residence: "Porto",
          },
        }),
      ],
    })

    const { result } = renderHook(() => useResolvedAttendees("flow-current"))
    const companion = result.current.find(
      (attendee) => attendee.id === "linked-companion",
    )

    expect(companion).toMatchObject({
      human_id: "human-2",
      category_id: null,
      category: null,
      additional_data: { residence: "Porto" },
      recipient: {
        recipient_key: "attendee:linked-companion",
        existing_attendee_id: "linked-companion",
        category_id: null,
        profile_snapshot: { residence: "Porto" },
      },
    })
    expect(companion?.recipient).not.toHaveProperty("human_id")
  })

  it("never infers buyer-self from an accountless direct-sale attendee", () => {
    mockUseHumanAttendeesQuery.mockReturnValue({
      data: [
        makeAttendee({
          id: "fulfilled-guest",
          name: "Fulfilled Guest",
          origin: "direct_sale",
          category_id: null,
          category: null,
        }),
      ],
    })

    const { result } = renderHook(() => useResolvedAttendees("flow-current"))

    expect(result.current).toHaveLength(2)
    expect(
      result.current.find((attendee) => attendee.id === "fulfilled-guest")
        ?.recipient,
    ).toMatchObject({
      existing_attendee_id: "fulfilled-guest",
      category_id: null,
    })
    expect(
      result.current.find((attendee) => attendee.id === "human-1")?.recipient,
    ).toMatchObject({ human_id: "human-1", category_id: "category-main" })
  })

  it("keeps fresh buyer fields when restoring a stale cart recipient", () => {
    mockUseHumanAttendeesQuery.mockReturnValue({ data: [] })
    const { result } = renderHook(() => useResolvedAttendees("flow-current"))

    const restored = restoreRecipientDrafts(
      result.current,
      [
        {
          recipient_key: "human:human-1",
          human_id: "human-1",
          existing_attendee_id: "stale-attendee-id",
          name: "Stale Cart Name",
          email: "stale@example.com",
          category_id: "category-stale",
          profile_snapshot: {
            category: "stale-role",
            residence: "Stale residence",
            saved_only: true,
          },
        },
      ],
      "popup-1",
    )

    expect(restored[0]).toMatchObject({
      name: "Direct Buyer",
      email: "buyer@example.com",
      category_id: "category-main",
      category: "main",
      recipient: {
        name: "Direct Buyer",
        email: "buyer@example.com",
        category_id: "category-main",
        profile_snapshot: {
          residence: "Lisbon",
          category: "main",
        },
      },
    })
    expect(restored[0]?.recipient?.profile_snapshot).not.toHaveProperty(
      "saved_only",
    )
    expect(restored[0]?.recipient).not.toHaveProperty("existing_attendee_id")
  })

  it.each([
    ["unresolved applications", null, [primaryCategory]],
    ["missing application", [], [primaryCategory]],
    [
      "ambiguous applications",
      [
        { id: "application-1", popup_id: "popup-1" },
        { id: "application-2", popup_id: "popup-1" },
      ],
      [primaryCategory],
    ],
    ["missing primary category", [{}], []],
    ["unresolved categories", [{}], undefined],
  ])("does not guess with %s", (_case, applications, categories) => {
    mockCity = {
      id: "popup-1",
      sale_type: "application",
      checkout_mode: "pass_system",
      takes_applications: true,
    }
    mockApplications = applications as ApplicationPublic[] | null
    mockCategories = categories
    if (mockApplications?.length === 1) {
      mockApplications[0] = {
        id: "application-1",
        tenant_id: "tenant-1",
        popup_id: "popup-1",
        human_id: "human-1",
        sales_flow_id: "flow-general",
        status: "accepted",
      }
    }
    mockUseHumanAttendeesQuery.mockReturnValue({ data: [] })

    const { result } = renderHook(() => useResolvedAttendees())

    expect(result.current).toEqual([])
  })

  it.each([
    "user",
    "city",
  ])("does not synthesize without the %s context", (missingContext) => {
    mockCity = {
      id: "popup-1",
      sale_type: "application",
      checkout_mode: "pass_system",
      takes_applications: true,
    }
    mockApplications = [
      {
        id: "application-1",
        tenant_id: "tenant-1",
        popup_id: "popup-1",
        human_id: "human-1",
        sales_flow_id: "flow-general",
        status: "accepted",
      },
    ]
    mockUseHumanAttendeesQuery.mockReturnValue({ data: [] })
    if (missingContext === "user") mockUser = null
    if (missingContext === "city") mockCity = null

    const { result } = renderHook(() => useResolvedAttendees())

    expect(result.current).toEqual([])
  })

  it("keeps a persisted party instead of adding a synthetic main recipient", () => {
    mockCity = {
      id: "popup-1",
      sale_type: "application",
      checkout_mode: "pass_system",
      takes_applications: true,
    }
    mockApplications = [
      {
        id: "application-1",
        popup_id: "popup-1",
        human_id: "human-1",
        sales_flow_id: "flow-general",
      },
    ] as ApplicationPublic[]
    mockUseHumanAttendeesQuery.mockReturnValue({ data: [persistedAttendee] })

    const { result } = renderHook(() => useResolvedAttendees())

    expect(result.current).toHaveLength(1)
    expect(result.current[0]?.id).toBe("attendee-1")
    expect(result.current[0]?.recipient).toBeUndefined()
  })

  it("reconciles a restored recipient without replacing the fresh synthetic profile", () => {
    mockCity = {
      id: "popup-1",
      sale_type: "application",
      checkout_mode: "pass_system",
      takes_applications: true,
    }
    mockApplications = [
      {
        id: "application-1",
        tenant_id: "tenant-1",
        popup_id: "popup-1",
        human_id: "human-1",
        sales_flow_id: "flow-general",
        status: "accepted",
      },
    ]
    mockUseHumanAttendeesQuery.mockReturnValue({ data: [] })
    const { result } = renderHook(() => useResolvedAttendees())
    const restoredRecipient = {
      ...result.current[0]?.recipient,
      recipient_key: "human:human-1",
      human_id: "human-1",
      name: "Direct Buyer",
      profile_snapshot: { category: "main", restored: true },
    }
    const restored = restoreRecipientDrafts(
      result.current,
      [restoredRecipient],
      "popup-1",
    )
    const projected = buildBaseAttendeePasses(
      restored,
      [
        {
          id: "access-pass",
          tenant_id: "tenant-1",
          popup_id: "popup-1",
          name: "Access Pass",
          slug: "access-pass",
          category: "ticket",
          duration_type: "full",
          is_active: true,
          price: 100,
          compare_price: null,
          max_per_order: 1,
        } as ProductsPass,
      ],
      0,
      new Map(),
      CHECKOUT_MODE.PASS_SYSTEM,
    )

    expect(projected).toHaveLength(1)
    expect(projected[0]).toMatchObject({
      id: "human-1",
      recipient: result.current[0]?.recipient,
      products: [{ id: "access-pass", attendee_id: "human-1" }],
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
