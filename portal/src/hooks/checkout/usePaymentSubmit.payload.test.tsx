import { act, renderHook } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"
import type { AttendeePassState } from "@/types/Attendee"
import type {
  CheckoutRecipientDraft,
  SelectedAccommodationItem,
  SelectedDynamicItem,
  SelectedMealPlanItem,
  SelectedPassItem,
} from "@/types/checkout"
import type { ProductsPass } from "@/types/Products"

const purchaseOpenTicketing = vi.hoisted(() =>
  vi.fn().mockResolvedValue({ status: "created" }),
)
const createMyPayment = vi.hoisted(() =>
  vi.fn().mockResolvedValue({ status: "created" }),
)
const telemetry = vi.hoisted(() => ({ trackPortalTelemetry: vi.fn() }))
const queryClient = vi.hoisted(() => ({ invalidateQueries: vi.fn() }))

vi.mock("@/client", () => ({
  ApiError: class ApiError extends Error {},
  CheckoutService: { purchaseOpenTicketing },
  PaymentsService: { createMyPayment },
}))
vi.mock("@tanstack/react-query", () => ({
  useQueryClient: () => queryClient,
}))
vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: vi.fn() }),
}))
vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key, i18n: { language: "en" } }),
}))
vi.mock("@/helpers/checkout", () => ({
  withCheckoutLocale: (url: string) => url,
}))
vi.mock("@/lib/attribution", () => ({
  getAttribution: () => ({}),
}))
vi.mock("@/lib/google-analytics", () => ({ trackGAPurchase: vi.fn() }))
vi.mock("@/lib/portal-telemetry", () => telemetry)
vi.mock("@/lib/meta-pixel", () => ({
  getMetaAttribution: () => ({}),
  trackMetaPurchase: vi.fn(),
}))

import { usePaymentSubmit } from "./usePaymentSubmit"

const product = {
  tenant_id: "tenant-1",
  popup_id: "popup-1",
  name: "Weekend pass",
  slug: "weekend-pass",
  price: 99,
  category: "ticket",
  id: "product-1",
  is_active: true,
} satisfies ProductsPass

const typedProduct = (id: string): ProductsPass => ({ ...product, id })

const attendee = {
  tenant_id: "tenant-1",
  popup_id: "popup-1",
  human_id: null,
  application_id: null,
  name: "Taylor Buyer",
  category: "main",
  email: "taylor@example.com",
  gender: null,
  poap_url: null,
  id: "attendee-1",
  products: [],
} satisfies AttendeePassState

const selectedPasses = [
  {
    productId: product.id,
    product,
    attendeeId: attendee.id,
    attendee,
    quantity: 2,
    price: 198,
  },
] satisfies SelectedPassItem[]

function renderPaymentSubmit(
  salesFlowSlug: string | null,
  options: {
    submitMode?: "application" | "open-ticketing"
    passes?: SelectedPassItem[]
    attendees?: AttendeePassState[]
    mealPlans?: SelectedMealPlanItem[]
    accommodations?: SelectedAccommodationItem[]
    dynamicItems?: Record<string, SelectedDynamicItem[]>
  } = {},
) {
  const submitMode = options.submitMode ?? "open-ticketing"
  return renderHook(() =>
    usePaymentSubmit({
      applicationId: submitMode === "application" ? "application-1" : undefined,
      popupId: "popup-1",
      popupSlug: "festival-2026",
      salesFlowSlug,
      appCredit: 0,
      checkoutMode: "pass_system",
      attendeePasses: options.attendees ?? [attendee],
      selectedPasses: options.passes ?? selectedPasses,
      housing: null,
      accommodations: options.accommodations ?? [],
      merch: [],
      patron: null,
      selectedMealPlans: options.mealPlans ?? [],
      dynamicItems: options.dynamicItems ?? {},
      promoCode: "",
      promoCodeValid: false,
      insurance: false,
      isEditing: false,
      toggleEditing: vi.fn(),
      clearCart: vi.fn(),
      setCurrentStep: vi.fn(),
      setPromoError: vi.fn(),
      clearPromoCode: vi.fn(),
      paymentCompleteRef: { current: false },
      submitMode,
      buyerData: {
        email: "taylor@example.com",
        firstName: "Taylor",
        lastName: "Buyer",
        formData: {},
      },
      editPassesEnabled: false,
    }),
  )
}

describe("usePaymentSubmit public purchase payload", () => {
  beforeEach(() => {
    purchaseOpenTicketing.mockClear()
    createMyPayment.mockClear()
    telemetry.trackPortalTelemetry.mockClear()
    queryClient.invalidateQueries.mockClear()
  })

  it.each([
    ["named", "merch-store"],
    ["direct", "checkout"],
  ] as const)("sends the %s checkout flow without substituting another flow", async (_, salesFlowSlug) => {
    const { result } = renderPaymentSubmit(salesFlowSlug)

    await act(async () => {
      await result.current.submitPayment()
    })

    expect(purchaseOpenTicketing).toHaveBeenCalledWith({
      slug: "festival-2026",
      flowSlug: salesFlowSlug,
      requestBody: expect.objectContaining({
        products: [
          {
            product_id: "product-1",
            attendee_id: "attendee-1",
            quantity: 2,
          },
        ],
        buyer: {
          email: "taylor@example.com",
          first_name: "Taylor",
          last_name: "Buyer",
          form_data: {},
        },
      }),
    })
  })

  it.each([
    ["anonymous", "open-ticketing"],
    ["authenticated", "application"],
  ] as const)("submits restored recipient snapshots in %s mode", async (_, submitMode) => {
    const recipient = {
      recipient_key: "managed-spouse",
      existing_attendee_id: "spouse-attendee",
      name: "Sam Spouse",
      email: "sam@example.com",
      category_id: "category-spouse",
      profile_snapshot: { category: "spouse", residence: "Lisbon" },
    }
    const restoredPasses = [
      {
        ...selectedPasses[0],
        attendeeId: "recipient:managed-spouse",
        recipient,
      },
      {
        ...selectedPasses[0],
        productId: "product-2",
        product: { ...product, id: "product-2" },
        attendeeId: "recipient:managed-spouse",
        recipient,
        quantity: 1,
        price: 99,
      },
    ] satisfies SelectedPassItem[]
    const { result } = renderPaymentSubmit("merch-store", {
      submitMode,
      passes: restoredPasses,
    })

    await act(async () => {
      await result.current.submitPayment()
    })

    const service =
      submitMode === "open-ticketing" ? purchaseOpenTicketing : createMyPayment
    const requestBody = service.mock.calls[0]?.[0].requestBody
    expect(requestBody.products).toEqual([
      {
        product_id: "product-1",
        recipient_key: "managed-spouse",
        quantity: 2,
      },
      {
        product_id: "product-2",
        recipient_key: "managed-spouse",
        quantity: 1,
      },
    ])
    expect(requestBody.recipients).toEqual([recipient])
  })

  it("preserves authenticated legacy attendee identity", async () => {
    const { result } = renderPaymentSubmit("merch-store", {
      submitMode: "application",
    })

    await act(async () => {
      await result.current.submitPayment()
    })

    expect(createMyPayment.mock.calls[0]?.[0].requestBody).toMatchObject({
      products: [
        {
          product_id: "product-1",
          attendee_id: "attendee-1",
          quantity: 2,
        },
      ],
      recipients: [],
    })
  })

  it.each([
    ["anonymous", "open-ticketing"],
    ["authenticated", "application"],
  ] as const)("routes a restored mixed cart in %s mode", async (_, submitMode) => {
    const recipient = {
      recipient_key: "managed-family",
      name: "Family Member",
      profile_snapshot: { dietary_notes: "vegetarian" },
    } satisfies CheckoutRecipientDraft
    const restoredAttendee = {
      ...attendee,
      id: "recipient:managed-family",
      recipient,
    }
    const accessProduct = typedProduct("access-pass")
    const orderProduct = typedProduct("parking-order")
    const mixedPasses = [accessProduct, orderProduct].map(
      (selectedProduct) => ({
        productId: selectedProduct.id,
        product: selectedProduct,
        attendeeId: restoredAttendee.id,
        attendee: restoredAttendee,
        recipient,
        quantity: 1,
        price: selectedProduct.price,
      }),
    ) satisfies SelectedPassItem[]
    const mealPlans = [
      {
        productId: "participant-meal",
        product: {
          ...typedProduct("participant-meal"),
          category: "meal_plan",
        },
        attendeeId: restoredAttendee.id,
        dailyChoices: { "2026-09-01": "veggie" },
        dietaryRestriction: "vegetarian",
        specialRequest: null,
      },
    ] satisfies SelectedMealPlanItem[]
    const sideProduct = typedProduct("ownerless-extra")
    const { result } = renderPaymentSubmit("merch-store", {
      submitMode,
      passes: mixedPasses,
      attendees: [restoredAttendee],
      mealPlans,
      dynamicItems: {
        extras: [2, 3].map((quantity) => ({
          productId: sideProduct.id,
          product: sideProduct,
          quantity,
          price: 10,
          stepType: "extras",
        })),
      },
    })

    await act(async () => {
      await result.current.submitPayment()
    })

    const service =
      submitMode === "open-ticketing" ? purchaseOpenTicketing : createMyPayment
    const requestBody = service.mock.calls[0]?.[0].requestBody
    expect(requestBody.recipients).toEqual([recipient])
    expect(requestBody.products.slice(0, 2)).toEqual([
      {
        product_id: "access-pass",
        recipient_key: "managed-family",
        quantity: 1,
      },
      {
        product_id: "parking-order",
        recipient_key: "managed-family",
        quantity: 1,
      },
    ])
    expect(
      requestBody.products.filter(
        ({ product_id }: { product_id: string }) =>
          product_id === "ownerless-extra",
      ),
    ).toEqual(
      submitMode === "open-ticketing"
        ? [{ product_id: "ownerless-extra", quantity: 5 }]
        : [
            { product_id: "ownerless-extra", quantity: 2 },
            { product_id: "ownerless-extra", quantity: 3 },
          ],
    )
    const mealLine = requestBody.products.at(-1)
    expect(mealLine).toMatchObject({
      product_id: "participant-meal",
      recipient_key: "managed-family",
      quantity: 1,
    })
    expect(mealLine.purchase_metadata).toEqual({
      daily_choices: { "2026-09-01": "veggie" },
      dietary_restriction: "vegetarian",
      special_request: null,
    })
  })

  it("keeps two stays with the same room product as distinct metadata lines", async () => {
    const stay = (checkIn: string, checkOut: string) =>
      ({
        accommodationId: "room-1",
        productId: "room-product",
        name: "Double room",
        propertyId: "property-1",
        propertyName: "Hotel",
        checkIn,
        checkOut,
        nights: 2,
        guestCount: 1,
        guests: ["Taylor Buyer"],
        subtotal: 100,
        tax: 10,
        totalPrice: 110,
      }) satisfies SelectedAccommodationItem
    const { result } = renderPaymentSubmit("merch-store", {
      passes: [],
      accommodations: [
        stay("2026-09-01", "2026-09-03"),
        stay("2026-09-10", "2026-09-12"),
      ],
    })

    await act(async () => {
      await result.current.submitPayment()
    })

    const lines = purchaseOpenTicketing.mock.calls[0][0].requestBody.products
    expect(lines).toHaveLength(2)
    expect(
      lines.map(
        (line: { purchase_metadata: unknown }) => line.purchase_metadata,
      ),
    ).toEqual([
      expect.objectContaining({
        check_in: "2026-09-01",
        check_out: "2026-09-03",
      }),
      expect.objectContaining({
        check_in: "2026-09-10",
        check_out: "2026-09-12",
      }),
    ])
    expect(
      lines.every((line: { attendee_id?: string }) => !line.attendee_id),
    ).toBe(true)
  })

  it("invalidates the popup upsale catalog after an approved payment", async () => {
    purchaseOpenTicketing.mockResolvedValueOnce({
      status: "approved",
      id: "payment-1",
    })
    const { result } = renderPaymentSubmit("merch-store")

    await act(async () => {
      await result.current.submitPayment()
    })

    const salesFlowInvalidations = queryClient.invalidateQueries.mock.calls
      .map(([options]) => options)
      .filter(({ queryKey }) => queryKey[0] === "sales-flows")

    expect(salesFlowInvalidations).toEqual([
      {
        queryKey: ["sales-flows", "portal", "upsale", "popup-1"],
      },
    ])
  })

  it("records a checkout failure without forwarding the rejected response", async () => {
    purchaseOpenTicketing.mockRejectedValueOnce(
      new Error("payment token and buyer@example.com"),
    )
    const { result } = renderPaymentSubmit("merch-store")

    await act(async () => {
      await result.current.submitPayment()
    })

    expect(telemetry.trackPortalTelemetry).toHaveBeenCalledWith(
      "checkout_failed",
    )
  })
})
