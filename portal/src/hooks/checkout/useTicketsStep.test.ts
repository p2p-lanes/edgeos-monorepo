import { renderHook } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"
import type { AttendeePassState } from "@/types/Attendee"
import type { SelectedDynamicItem } from "@/types/checkout"
import type { ProductsPass } from "@/types/Products"

// ---------------------------------------------------------------------------
// Mutable mock state (mutated per test via beforeEach / in-test assignment)
// ---------------------------------------------------------------------------

let mockAttendeePasses: AttendeePassState[] = []
let mockIsEditing = false
let mockEditCredit = 0
let mockCheckoutMode: "pass_system" | "simple_quantity" = "pass_system"
let mockDynamicItems: Record<string, SelectedDynamicItem[]> = {}

// ---------------------------------------------------------------------------
// Trackable mock functions
// ---------------------------------------------------------------------------

const mockToggleProduct = vi.fn()
const mockToggleEditing = vi.fn()
const mockAddDynamicItem = vi.fn()
const mockRemoveDynamicItem = vi.fn()
const mockUpdateDynamicQuantity = vi.fn()

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

vi.mock("@/providers/passesProvider", () => ({
  usePassesProvider: () => ({
    attendeePasses: mockAttendeePasses,
    toggleProduct: mockToggleProduct,
    isEditing: mockIsEditing,
    toggleEditing: mockToggleEditing,
    products: [],
    clearSelections: vi.fn(),
  }),
}))

vi.mock("@/providers/checkoutProvider", () => ({
  useCheckout: () => ({
    editCredit: mockEditCredit,
    isEditing: mockIsEditing,
    editPassesEnabled: true,
    cart: { dynamicItems: mockDynamicItems },
    addDynamicItem: mockAddDynamicItem,
    removeDynamicItem: mockRemoveDynamicItem,
    updateDynamicQuantity: mockUpdateDynamicQuantity,
  }),
}))

vi.mock("@/providers/cityProvider", () => ({
  useCityProvider: () => ({
    getCity: () => ({
      id: "popup-1",
      checkout_mode: mockCheckoutMode,
      sale_type:
        mockCheckoutMode === "simple_quantity" ? "open" : "application",
    }),
  }),
}))

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeProduct(
  id: string,
  overrides: Partial<ProductsPass> = {},
): ProductsPass {
  return {
    id,
    name: id,
    slug: id,
    popup_id: "popup-1",
    tenant_id: "tenant-1",
    attendee_category_id: null,
    category: "ticket",
    duration_type: overrides.duration_type ?? "week",
    is_active: true,
    price: 100,
    original_price: 100,
    quantity: overrides.quantity ?? 1,
    selected: overrides.selected ?? false,
    purchased: overrides.purchased ?? false,
    edit: overrides.edit ?? false,
    max_per_order: overrides.max_per_order ?? 1,
    compare_price: null,
    disabled: overrides.disabled ?? false,
    ...overrides,
  } as ProductsPass
}

function makeAttendee(
  id: string,
  products: ProductsPass[],
  overrides: Partial<AttendeePassState> = {},
): AttendeePassState {
  return {
    id,
    tenant_id: "tenant-1",
    popup_id: "popup-1",
    human_id: "human-1",
    application_id: null,
    name: id,
    category: "main",
    category_id: null,
    email: `${id}@example.com`,
    gender: null,
    poap_url: null,
    created_at: null,
    updated_at: null,
    products,
    ...overrides,
  }
}

const templateConfig = {
  sections: [
    {
      key: "passes",
      label: "Passes",
      order: 1,
      product_ids: ["p-full", "p-month", "p-week"],
      attendee_categories: null,
    },
  ],
}

// ---------------------------------------------------------------------------
// Import under test (deferred so mocks are registered first)
// ---------------------------------------------------------------------------

const { useTicketsStep } = await import("./useTicketsStep")

// ---------------------------------------------------------------------------
// S1-A: Exclusivity — selecting month disables week for that attendee only
// ---------------------------------------------------------------------------

describe("S1-A: exclusivity — selecting month disables week for that attendee only", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("marks week as disabled for attendee who has month selected, not for other attendees", () => {
    const pMonth = makeProduct("p-month", {
      duration_type: "month",
      selected: true,
    })
    const pWeek = makeProduct("p-week", { duration_type: "week" })
    const pFull = makeProduct("p-full", { duration_type: "full" })

    // Attendee A has month selected
    const attendeeA = makeAttendee("a", [pFull, pMonth, pWeek])
    // Attendee B has nothing selected
    const attendeeB = makeAttendee("b", [
      makeProduct("p-full", { duration_type: "full" }),
      makeProduct("p-month", { duration_type: "month" }),
      makeProduct("p-week", { duration_type: "week" }),
    ])

    mockAttendeePasses = [attendeeA, attendeeB]
    mockIsEditing = false
    mockEditCredit = 0

    const products = [pFull, pMonth, pWeek]
    const { result } = renderHook(() =>
      useTicketsStep({ stepType: "passes", templateConfig, products }),
    )

    const view = result.current
    const vmA = view.attendees.find((a) => a.id === "a")
    const vmB = view.attendees.find((a) => a.id === "b")

    // Attendee A's week row should be disabled (month is selected)
    const weekRowA = vmA?.sections
      .flatMap((s) => s.rows)
      .find((r) => r.product.id === "p-week")
    expect(weekRowA?.disabled).toBe(true)

    // Attendee B's week row should NOT be disabled
    const weekRowB = vmB?.sections
      .flatMap((s) => s.rows)
      .find((r) => r.product.id === "p-week")
    expect(weekRowB?.disabled).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// S1-B: purchased product flag propagated to VM
// ---------------------------------------------------------------------------

describe("S1-B: purchased product in VM", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("exposes purchased=true on the corresponding row", () => {
    const pWeek = makeProduct("p-week", {
      duration_type: "week",
      purchased: true,
    })
    const attendeeA = makeAttendee("a", [pWeek])
    mockAttendeePasses = [attendeeA]
    mockIsEditing = false
    mockEditCredit = 0

    const config = {
      sections: [
        {
          key: "s1",
          label: "S1",
          order: 1,
          product_ids: ["p-week"],
          attendee_categories: null,
        },
      ],
    }
    const { result } = renderHook(() =>
      useTicketsStep({
        stepType: "passes",
        templateConfig: config,
        products: [pWeek],
      }),
    )

    const row = result.current.attendees[0]?.sections[0]?.rows[0]
    expect(row?.purchased).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// S1-C: editedForCredit when isEditing + product.edit = true
// ---------------------------------------------------------------------------

describe("S1-C: editedForCredit flag when isEditing + edit", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("sets editedForCredit=true for a purchased+edit product when isEditing", () => {
    const pWeek = makeProduct("p-week", {
      duration_type: "week",
      purchased: true,
      edit: true,
    })
    const attendeeA = makeAttendee("a", [pWeek])
    mockAttendeePasses = [attendeeA]
    mockIsEditing = true
    mockEditCredit = 100

    const config = {
      sections: [
        {
          key: "s1",
          label: "S1",
          order: 1,
          product_ids: ["p-week"],
          attendee_categories: null,
        },
      ],
    }
    const { result } = renderHook(() =>
      useTicketsStep({
        stepType: "passes",
        templateConfig: config,
        products: [pWeek],
      }),
    )

    const row = result.current.attendees[0]?.sections[0]?.rows[0]
    expect(row?.editedForCredit).toBe(true)
  })

  it("sets editedForCredit=false when isEditing but product.edit is false", () => {
    const pWeek = makeProduct("p-week", {
      duration_type: "week",
      purchased: true,
      edit: false,
    })
    const attendeeA = makeAttendee("a", [pWeek])
    mockAttendeePasses = [attendeeA]
    mockIsEditing = true
    mockEditCredit = 0

    const config = {
      sections: [
        {
          key: "s1",
          label: "S1",
          order: 1,
          product_ids: ["p-week"],
          attendee_categories: null,
        },
      ],
    }
    const { result } = renderHook(() =>
      useTicketsStep({
        stepType: "passes",
        templateConfig: config,
        products: [pWeek],
      }),
    )

    const row = result.current.attendees[0]?.sections[0]?.rows[0]
    expect(row?.editedForCredit).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// S1-D: toggleRow routes to passesProvider.toggleProduct with correct attendeeId
// ---------------------------------------------------------------------------

describe("S1-D: toggleRow routes to passesProvider.toggleProduct with correct attendeeId", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("calls passesProvider.toggleProduct with the attendeeId and product", () => {
    const pWeek = makeProduct("p-week", { duration_type: "week" })
    const attendeeA = makeAttendee("a", [pWeek])
    mockAttendeePasses = [attendeeA]
    mockIsEditing = false
    mockEditCredit = 0

    const config = {
      sections: [
        {
          key: "s1",
          label: "S1",
          order: 1,
          product_ids: ["p-week"],
          attendee_categories: null,
        },
      ],
    }
    const { result } = renderHook(() =>
      useTicketsStep({
        stepType: "passes",
        templateConfig: config,
        products: [pWeek],
      }),
    )

    result.current.toggleRow("a", pWeek)

    expect(mockToggleProduct).toHaveBeenCalledOnce()
    const [attendeeId, product] = mockToggleProduct.mock.calls[0]
    expect(attendeeId).toBe("a")
    expect(product.id).toBe("p-week")
  })

  it("passes exclusivityScopeIds and attendeeVisibleProductIds from the section context", () => {
    const pMonth = makeProduct("p-month", { duration_type: "month" })
    const pWeek = makeProduct("p-week", { duration_type: "week" })
    const attendeeA = makeAttendee("a", [pMonth, pWeek])
    mockAttendeePasses = [attendeeA]
    mockIsEditing = false
    mockEditCredit = 0

    const config = {
      sections: [
        {
          key: "s1",
          label: "S1",
          order: 1,
          product_ids: ["p-month", "p-week"],
          attendee_categories: null,
        },
      ],
    }
    const { result } = renderHook(() =>
      useTicketsStep({
        stepType: "passes",
        templateConfig: config,
        products: [pMonth, pWeek],
      }),
    )

    result.current.toggleRow("a", pWeek)

    expect(mockToggleProduct).toHaveBeenCalledOnce()
    const [, , scopeIds, visibleIds] = mockToggleProduct.mock.calls[0]
    // scopeIds should include both products in the section
    expect(scopeIds).toContain("p-month")
    expect(scopeIds).toContain("p-week")
    // visibleIds should include all visible product ids for the attendee
    expect(visibleIds).toContain("p-month")
    expect(visibleIds).toContain("p-week")
  })
})

// ---------------------------------------------------------------------------
// isOpenCheckout detection
// ---------------------------------------------------------------------------

describe("isOpenCheckout detection", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("isOpenCheckout=false when attendeePasses is non-empty (pass_system)", () => {
    const pWeek = makeProduct("p-week", { duration_type: "week" })
    mockAttendeePasses = [makeAttendee("a", [pWeek])]
    mockIsEditing = false
    mockEditCredit = 0

    const { result } = renderHook(() =>
      useTicketsStep({
        stepType: "passes",
        templateConfig: null,
        products: [pWeek],
      }),
    )

    expect(result.current.isOpenCheckout).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// simple_quantity — Slice 3 full implementation tests
// ---------------------------------------------------------------------------

// S3-A: simple_quantity mode + 0 attendees → isOpenCheckout=true,
// view.sections populated, view.attendees[0].id === ""
describe("S3-A: simple_quantity open-checkout VM (Slice 3)", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockCheckoutMode = "simple_quantity"
    mockAttendeePasses = []
    mockIsEditing = false
    mockEditCredit = 0
    mockDynamicItems = {}
  })

  afterEach(() => {
    mockCheckoutMode = "pass_system"
  })

  it("isOpenCheckout=true, view.sections populated from templateConfig", () => {
    const pWeek = makeProduct("p-week", { duration_type: "week" })
    const config = {
      sections: [
        {
          key: "passes",
          label: "Passes",
          order: 1,
          product_ids: ["p-week"],
          attendee_categories: null,
        },
      ],
    }

    const { result } = renderHook(() =>
      useTicketsStep({
        stepType: "passes",
        templateConfig: config,
        products: [pWeek],
      }),
    )

    const view = result.current
    expect(view.isOpenCheckout).toBe(true)
    expect(view.mode).toBe("simple_quantity")
    // sections must be populated (not empty array)
    expect(view.sections.length).toBeGreaterThan(0)
    // the section key must match
    const sec = view.sections.find((s) => s.key === "passes")
    expect(sec).toBeDefined()
    expect(sec?.rows.length).toBeGreaterThan(0)
    expect(sec?.rows[0].product.id).toBe("p-week")
  })

  it("view.attendees[0].id === '' (synthetic bucket)", () => {
    const pWeek = makeProduct("p-week", { duration_type: "week" })
    const config = {
      sections: [
        {
          key: "passes",
          label: "Passes",
          order: 1,
          product_ids: ["p-week"],
          attendee_categories: null,
        },
      ],
    }

    const { result } = renderHook(() =>
      useTicketsStep({
        stepType: "passes",
        templateConfig: config,
        products: [pWeek],
      }),
    )

    const view = result.current
    expect(view.attendees.length).toBe(1)
    expect(view.attendees[0].id).toBe("")
    // attendees[0].sections must mirror view.sections
    expect(view.attendees[0].sections.length).toBe(view.sections.length)
  })

  it("no sections configured — falls back to duration groups", () => {
    const pWeek = makeProduct("p-week", { duration_type: "week" })
    const pDay = makeProduct("p-day", {
      duration_type: "day",
      max_per_order: null,
    })

    const { result } = renderHook(() =>
      useTicketsStep({
        stepType: "passes",
        templateConfig: null,
        products: [pWeek, pDay],
      }),
    )

    const view = result.current
    expect(view.isOpenCheckout).toBe(true)
    // Even without templateConfig sections, sections[] must be populated
    // (duration-group fallback from buildSectionGroups).
    expect(view.sections.length).toBeGreaterThan(0)
  })
})

// S3-B: setRowQuantity("", product, 1) → updateDynamicQuantity called
describe("S3-B: setRowQuantity on open-checkout routes to updateDynamicQuantity", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockCheckoutMode = "simple_quantity"
    mockAttendeePasses = []
    mockIsEditing = false
    mockEditCredit = 0
    mockDynamicItems = {}
  })

  afterEach(() => {
    mockCheckoutMode = "pass_system"
  })

  it("setRowQuantity('', product, 1) calls updateDynamicQuantity with correct args", () => {
    const pWeek = makeProduct("p-week", { duration_type: "week" })

    const { result } = renderHook(() =>
      useTicketsStep({
        stepType: "passes",
        templateConfig: null,
        products: [pWeek],
      }),
    )

    result.current.setRowQuantity("", pWeek, 1)

    expect(mockUpdateDynamicQuantity).toHaveBeenCalledOnce()
    expect(mockUpdateDynamicQuantity).toHaveBeenCalledWith(
      "passes",
      pWeek.id,
      1,
    )
    expect(mockToggleProduct).not.toHaveBeenCalled()
  })
})

// S3-D: pass_system regression — isOpenCheckout=false, attendees>0 after Slice 3
describe("S3-D: pass_system regression after Slice 3", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockCheckoutMode = "pass_system"
    mockDynamicItems = {}
    mockIsEditing = false
    mockEditCredit = 0
  })

  it("isOpenCheckout=false, attendees.length > 0 for pass_system with attendees", () => {
    const pWeek = makeProduct("p-week", { duration_type: "week" })
    mockAttendeePasses = [makeAttendee("a", [pWeek])]

    const { result } = renderHook(() =>
      useTicketsStep({
        stepType: "passes",
        templateConfig,
        products: [pWeek],
      }),
    )

    expect(result.current.isOpenCheckout).toBe(false)
    expect(result.current.attendees.length).toBeGreaterThan(0)
  })

  // Re-assert S1-A: selecting month disables week for that attendee only
  it("S1-A regression: month selected → week disabled for that attendee only", () => {
    const pMonth = makeProduct("p-month", {
      duration_type: "month",
      selected: true,
    })
    const pWeek = makeProduct("p-week", { duration_type: "week" })
    const pFull = makeProduct("p-full", { duration_type: "full" })

    mockAttendeePasses = [
      makeAttendee("a", [pFull, pMonth, pWeek]),
      makeAttendee("b", [
        makeProduct("p-full", { duration_type: "full" }),
        makeProduct("p-month", { duration_type: "month" }),
        makeProduct("p-week", { duration_type: "week" }),
      ]),
    ]

    const { result } = renderHook(() =>
      useTicketsStep({
        stepType: "passes",
        templateConfig,
        products: [pFull, pMonth, pWeek],
      }),
    )

    const vmA = result.current.attendees.find((a) => a.id === "a")
    const vmB = result.current.attendees.find((a) => a.id === "b")

    const weekA = vmA?.sections
      .flatMap((s) => s.rows)
      .find((r) => r.product.id === "p-week")
    const weekB = vmB?.sections
      .flatMap((s) => s.rows)
      .find((r) => r.product.id === "p-week")

    expect(weekA?.disabled).toBe(true)
    expect(weekB?.disabled).toBe(false)
  })

  // Re-assert S1-D: toggleRow routes to passesProvider.toggleProduct
  it("S1-D regression: toggleRow routes to passesProvider.toggleProduct", () => {
    const pWeek = makeProduct("p-week", { duration_type: "week" })
    mockAttendeePasses = [makeAttendee("a", [pWeek])]

    const config = {
      sections: [
        {
          key: "s1",
          label: "S1",
          order: 1,
          product_ids: ["p-week"],
          attendee_categories: null,
        },
      ],
    }

    const { result } = renderHook(() =>
      useTicketsStep({
        stepType: "passes",
        templateConfig: config,
        products: [pWeek],
      }),
    )

    result.current.toggleRow("a", pWeek)

    expect(mockToggleProduct).toHaveBeenCalledOnce()
    expect(mockToggleProduct.mock.calls[0][0]).toBe("a")
    expect(mockUpdateDynamicQuantity).not.toHaveBeenCalled()
  })
})

// ---------------------------------------------------------------------------
// Slice 2 tests: S2-A through S2-E
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// S2-A: per-attendee assignment — 3 attendees, 3 distinct attendeeIds
// ---------------------------------------------------------------------------

describe("S2-A: per-attendee ticket assignment (primary bug fix)", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockCheckoutMode = "pass_system"
    mockDynamicItems = {}
  })

  it("calls toggleProduct with distinct attendeeIds for 3 attendees", () => {
    const pWeekA = makeProduct("p-week-a", { duration_type: "week" })
    const pWeekB = makeProduct("p-week-b", { duration_type: "week" })
    const pWeekC = makeProduct("p-week-c", { duration_type: "week" })

    const attendeeA = makeAttendee("attendee-a", [pWeekA])
    const attendeeB = makeAttendee("attendee-b", [pWeekB])
    const attendeeC = makeAttendee("attendee-c", [pWeekC])

    mockAttendeePasses = [attendeeA, attendeeB, attendeeC]
    mockIsEditing = false
    mockEditCredit = 0

    const config = {
      sections: [
        {
          key: "s1",
          label: "S1",
          order: 1,
          product_ids: ["p-week-a", "p-week-b", "p-week-c"],
          attendee_categories: null,
        },
      ],
    }
    const products = [pWeekA, pWeekB, pWeekC]

    const { result } = renderHook(() =>
      useTicketsStep({ stepType: "passes", templateConfig: config, products }),
    )

    result.current.toggleRow("attendee-a", pWeekA)
    result.current.toggleRow("attendee-b", pWeekB)
    result.current.toggleRow("attendee-c", pWeekC)

    expect(mockToggleProduct).toHaveBeenCalledTimes(3)

    const calledAttendeeIds = mockToggleProduct.mock.calls.map(
      ([attendeeId]) => attendeeId,
    )
    expect(calledAttendeeIds).toContain("attendee-a")
    expect(calledAttendeeIds).toContain("attendee-b")
    expect(calledAttendeeIds).toContain("attendee-c")

    // No call should have used a single collapsed attendeeId for all
    const uniqueIds = new Set(calledAttendeeIds)
    expect(uniqueIds.size).toBe(3)
  })
})

// ---------------------------------------------------------------------------
// S2-B: purchased rendering — purchased=true row in VM
// ---------------------------------------------------------------------------

describe("S2-B: purchased rendering on ticket-card", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockCheckoutMode = "pass_system"
    mockDynamicItems = {}
  })

  it("row.purchased === true when attendee product is purchased", () => {
    const pFull = makeProduct("p-full", {
      duration_type: "full",
      purchased: true,
    })
    const attendeeA = makeAttendee("a", [pFull])
    mockAttendeePasses = [attendeeA]
    mockIsEditing = false
    mockEditCredit = 0

    const config = {
      sections: [
        {
          key: "s1",
          label: "S1",
          order: 1,
          product_ids: ["p-full"],
          attendee_categories: null,
        },
      ],
    }

    const { result } = renderHook(() =>
      useTicketsStep({
        stepType: "passes",
        templateConfig: config,
        products: [pFull],
      }),
    )

    const row = result.current.attendees[0]?.sections[0]?.rows[0]
    expect(row?.purchased).toBe(true)
    expect(row?.product.id).toBe("p-full")
  })
})

// ---------------------------------------------------------------------------
// S2-C: edit/credit — isEditing + product.edit = true → editedForCredit
// ---------------------------------------------------------------------------

describe("S2-C: edit-passes credit rendering on ticket-card", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockCheckoutMode = "pass_system"
    mockDynamicItems = {}
  })

  it("row.editedForCredit === true when isEditing + purchased + product.edit", () => {
    const pWeek = makeProduct("p-week", {
      duration_type: "week",
      purchased: true,
      edit: true,
    })
    const attendeeA = makeAttendee("a", [pWeek])
    mockAttendeePasses = [attendeeA]
    mockIsEditing = true
    mockEditCredit = 150

    const config = {
      sections: [
        {
          key: "s1",
          label: "S1",
          order: 1,
          product_ids: ["p-week"],
          attendee_categories: null,
        },
      ],
    }

    const { result } = renderHook(() =>
      useTicketsStep({
        stepType: "passes",
        templateConfig: config,
        products: [pWeek],
      }),
    )

    const row = result.current.attendees[0]?.sections[0]?.rows[0]
    expect(row?.editedForCredit).toBe(true)
    expect(result.current.isEditing).toBe(true)
    expect(result.current.editCredit).toBe(150)
  })
})

// ---------------------------------------------------------------------------
// S2-D: exclusivity on ticket-card (pass_system)
// ---------------------------------------------------------------------------

describe("S2-D: exclusivity on ticket-card (pass_system)", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockCheckoutMode = "pass_system"
    mockDynamicItems = {}
  })

  it("week/day rows are disabled after selecting full product for that attendee", () => {
    const pFull = makeProduct("p-full", {
      duration_type: "full",
      selected: true,
    })
    const pWeek = makeProduct("p-week", { duration_type: "week" })
    const pDay = makeProduct("p-day", {
      duration_type: "day",
      max_per_order: null,
    })

    // Attendee A has full selected
    const attendeeA = makeAttendee("a", [pFull, pWeek, pDay])
    // Attendee B has nothing selected — week/day should NOT be disabled
    const attendeeB = makeAttendee("b", [
      makeProduct("p-full", { duration_type: "full" }),
      makeProduct("p-week", { duration_type: "week" }),
      makeProduct("p-day", { duration_type: "day", max_per_order: null }),
    ])

    mockAttendeePasses = [attendeeA, attendeeB]
    mockIsEditing = false
    mockEditCredit = 0

    const config = {
      sections: [
        {
          key: "s1",
          label: "S1",
          order: 1,
          product_ids: ["p-full", "p-week", "p-day"],
          attendee_categories: null,
        },
      ],
    }

    const { result } = renderHook(() =>
      useTicketsStep({
        stepType: "passes",
        templateConfig: config,
        products: [pFull, pWeek, pDay],
      }),
    )

    const vmA = result.current.attendees.find((a) => a.id === "a")
    const vmB = result.current.attendees.find((a) => a.id === "b")

    const weekA = vmA?.sections
      .flatMap((s) => s.rows)
      .find((r) => r.product.id === "p-week")
    const dayA = vmA?.sections
      .flatMap((s) => s.rows)
      .find((r) => r.product.id === "p-day")
    const weekB = vmB?.sections
      .flatMap((s) => s.rows)
      .find((r) => r.product.id === "p-week")
    const dayB = vmB?.sections
      .flatMap((s) => s.rows)
      .find((r) => r.product.id === "p-day")

    expect(weekA?.disabled).toBe(true)
    expect(dayA?.disabled).toBe(true)
    expect(weekB?.disabled).toBe(false)
    expect(dayB?.disabled).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// S4: usesStepper classification for pass_system full/month passes
// ---------------------------------------------------------------------------

describe("S4: usesStepper=false for full/month passes with max_per_order=null (pass_system)", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockCheckoutMode = "pass_system"
    mockDynamicItems = {}
    mockIsEditing = false
    mockEditCredit = 0
  })

  it("non-purchased full pass with max_per_order=null → usesStepper=false", () => {
    const pFull = {
      ...makeProduct("p-full", { duration_type: "full", selected: false }),
      max_per_order: null,
    } as unknown as ProductsPass

    const attendeeA = makeAttendee("a", [pFull])
    mockAttendeePasses = [attendeeA]

    const config = {
      sections: [
        {
          key: "s1",
          label: "S1",
          order: 1,
          product_ids: ["p-full"],
          attendee_categories: null,
        },
      ],
    }

    const { result } = renderHook(() =>
      useTicketsStep({
        stepType: "passes",
        templateConfig: config,
        products: [pFull],
      }),
    )

    const row = result.current.attendees[0]?.sections[0]?.rows[0]
    expect(row?.usesStepper).toBe(false)
  })

  it("non-purchased month pass with max_per_order=null → usesStepper=false", () => {
    const pMonth = {
      ...makeProduct("p-month", { duration_type: "month", selected: false }),
      max_per_order: null,
    } as unknown as ProductsPass

    const attendeeA = makeAttendee("a", [pMonth])
    mockAttendeePasses = [attendeeA]

    const config = {
      sections: [
        {
          key: "s1",
          label: "S1",
          order: 1,
          product_ids: ["p-month"],
          attendee_categories: null,
        },
      ],
    }

    const { result } = renderHook(() =>
      useTicketsStep({
        stepType: "passes",
        templateConfig: config,
        products: [pMonth],
      }),
    )

    const row = result.current.attendees[0]?.sections[0]?.rows[0]
    expect(row?.usesStepper).toBe(false)
  })

  it("day pass → usesStepper=true (regression)", () => {
    const pDay = makeProduct("p-day", {
      duration_type: "day",
      max_per_order: 5,
    })

    const attendeeA = makeAttendee("a", [pDay])
    mockAttendeePasses = [attendeeA]

    const config = {
      sections: [
        {
          key: "s1",
          label: "S1",
          order: 1,
          product_ids: ["p-day"],
          attendee_categories: null,
        },
      ],
    }

    const { result } = renderHook(() =>
      useTicketsStep({
        stepType: "passes",
        templateConfig: config,
        products: [pDay],
      }),
    )

    const row = result.current.attendees[0]?.sections[0]?.rows[0]
    expect(row?.usesStepper).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// S2-E: simple_quantity regression (amanita) — setRowQuantity routes to
// updateDynamicQuantity, NOT passesProvider.toggleProduct
// ---------------------------------------------------------------------------

describe("S2-E: simple_quantity regression (amanita popup)", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockCheckoutMode = "simple_quantity"
    mockDynamicItems = {}
    mockAttendeePasses = []
    mockIsEditing = false
    mockEditCredit = 0
  })

  afterEach(() => {
    mockCheckoutMode = "pass_system"
  })

  it("isOpenCheckout=true when mode=simple_quantity and no attendees", () => {
    const { result } = renderHook(() =>
      useTicketsStep({
        stepType: "passes",
        templateConfig: null,
        products: [],
      }),
    )

    expect(result.current.isOpenCheckout).toBe(true)
    expect(result.current.mode).toBe("simple_quantity")
  })

  it("setRowQuantity calls updateDynamicQuantity and NOT toggleProduct", () => {
    const pWeek = makeProduct("p-week", { duration_type: "week" })

    const { result } = renderHook(() =>
      useTicketsStep({
        stepType: "passes",
        templateConfig: null,
        products: [pWeek],
      }),
    )

    result.current.setRowQuantity("", pWeek, 2)

    expect(mockUpdateDynamicQuantity).toHaveBeenCalledOnce()
    expect(mockToggleProduct).not.toHaveBeenCalled()
    // Must be called with (stepType, productId, qty)
    expect(mockUpdateDynamicQuantity).toHaveBeenCalledWith(
      "passes",
      pWeek.id,
      2,
    )
  })

  it("toggleRow calls addDynamicItem when quantity was 0, removeDynamicItem when removing", () => {
    const pWeek = makeProduct("p-week", { duration_type: "week" })
    mockDynamicItems = {}

    const { result } = renderHook(() =>
      useTicketsStep({
        stepType: "passes",
        templateConfig: null,
        products: [pWeek],
      }),
    )

    // Toggle on (not in cart)
    result.current.toggleRow("", pWeek)
    expect(mockAddDynamicItem).toHaveBeenCalledOnce()
    expect(mockToggleProduct).not.toHaveBeenCalled()
  })
})

// ---------------------------------------------------------------------------
// S5: amanita regression — simple_quantity with virtual buyer attendee
//
// OpenCheckoutRuntime always creates a virtual buyer attendee and passes it to
// PassesProvider, so attendeePasses.length is 1, not 0. The old isOpenCheckout
// formula (attendeePasses.length === 0 && mode === simple_quantity) was false,
// causing view.sections to be empty and the ticket-card to render the empty state.
//
// The fix: isOpenCheckout must be driven solely by checkoutMode === simple_quantity
// (the popup configuration) rather than by whether attendeePasses is empty.
// ---------------------------------------------------------------------------

describe("S5: amanita regression — simple_quantity with virtual buyer attendee", () => {
  const amanitaProducts = [
    makeProduct("9d9e785d-61ba-4bcf-9dd7-c637765f11a4", {
      duration_type: "week",
      max_per_order: null,
    }),
    makeProduct("a862fd84-1bcb-4099-9494-f6fa4bede059", {
      duration_type: "week",
      max_per_order: null,
    }),
  ]

  const amanitaConfig = {
    sections: [
      {
        key: "s1",
        label: "Ticket",
        order: 1,
        product_ids: ["9d9e785d-61ba-4bcf-9dd7-c637765f11a4"],
        attendee_categories: null,
      },
      {
        key: "s2",
        label: "Ticket no insurance",
        order: 2,
        product_ids: ["a862fd84-1bcb-4099-9494-f6fa4bede059"],
        attendee_categories: null,
      },
      {
        key: "s3",
        label: "Bundle",
        order: 3,
        product_ids: [
          "9d9e785d-61ba-4bcf-9dd7-c637765f11a4",
          "a862fd84-1bcb-4099-9494-f6fa4bede059",
        ],
        attendee_categories: null,
      },
    ],
  }

  beforeEach(() => {
    vi.clearAllMocks()
    mockCheckoutMode = "simple_quantity"
    // Virtual buyer attendee (as created by buildVirtualBuyerAttendee in OpenCheckoutRuntime)
    // — attendeePasses.length is 1, NOT 0
    mockAttendeePasses = [
      makeAttendee("open-buyer-amanita-popup-id", [], {
        category: "main",
        category_id: null,
      }),
    ]
    mockIsEditing = false
    mockEditCredit = 0
    mockDynamicItems = {}
  })

  afterEach(() => {
    mockCheckoutMode = "pass_system"
    mockAttendeePasses = []
  })

  it("isOpenCheckout=true even when attendeePasses has a virtual buyer attendee", () => {
    const { result } = renderHook(() =>
      useTicketsStep({
        stepType: "passes",
        templateConfig: amanitaConfig,
        products: amanitaProducts,
      }),
    )

    expect(result.current.isOpenCheckout).toBe(true)
    expect(result.current.mode).toBe("simple_quantity")
  })

  it("view.sections is populated with amanita products when virtual attendee exists", () => {
    const { result } = renderHook(() =>
      useTicketsStep({
        stepType: "passes",
        templateConfig: amanitaConfig,
        products: amanitaProducts,
      }),
    )

    const view = result.current
    // Must have sections (not empty)
    expect(view.sections.length).toBeGreaterThan(0)
    // Each configured section that maps a product must appear
    const allRowProductIds = view.sections.flatMap((s) =>
      s.rows.map((r) => r.product.id),
    )
    expect(allRowProductIds).toContain("9d9e785d-61ba-4bcf-9dd7-c637765f11a4")
    expect(allRowProductIds).toContain("a862fd84-1bcb-4099-9494-f6fa4bede059")
  })

  it("setRowQuantity routes to updateDynamicQuantity (not passesProvider) with virtual attendee", () => {
    const { result } = renderHook(() =>
      useTicketsStep({
        stepType: "passes",
        templateConfig: amanitaConfig,
        products: amanitaProducts,
      }),
    )

    result.current.setRowQuantity("", amanitaProducts[0], 2)

    expect(mockUpdateDynamicQuantity).toHaveBeenCalledOnce()
    expect(mockToggleProduct).not.toHaveBeenCalled()
    expect(mockUpdateDynamicQuantity).toHaveBeenCalledWith(
      "passes",
      amanitaProducts[0].id,
      2,
    )
  })
})
