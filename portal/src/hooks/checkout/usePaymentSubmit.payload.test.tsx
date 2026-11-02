import { act, renderHook } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { ApiError } from "@/client"
import {
  type BuyerIdentity,
  buildBuyerIdentity,
  NO_BUYER_IDENTITY,
} from "@/lib/buyerIdentity"
import type { AttendeePassState } from "@/types/Attendee"
import type {
  CheckoutRecipientDraft,
  SelectedAccommodationItem,
  SelectedDynamicItem,
  SelectedMealPlanItem,
  SelectedPassItem,
} from "@/types/checkout"
import type { ProductsPass } from "@/types/Products"
import simpleQuantityPurchase from "../../../../e2e/fixtures/simple-quantity-purchase.json"

const purchaseOpenTicketing = vi.hoisted(() =>
  vi.fn().mockResolvedValue({ status: "created" }),
)
const createMyPayment = vi.hoisted(() =>
  vi.fn().mockResolvedValue({ status: "created" }),
)
const paymentToasts = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }))
vi.mock("sonner", () => ({ toast: paymentToasts }))
const telemetry = vi.hoisted(() => ({ trackPortalTelemetry: vi.fn() }))
const queryClient = vi.hoisted(() => ({ invalidateQueries: vi.fn() }))
const routerReplace = vi.hoisted(() => vi.fn())
const navigateBrowser = vi.hoisted(() => vi.fn())
const getGABrowserIds = vi.hoisted(() =>
  vi.fn().mockResolvedValue({ ga_client_id: "123.456", ga_session_id: "789" }),
)
const trackGABeginCheckout = vi.hoisted(() => vi.fn().mockReturnValue(true))

vi.mock("@/client", () => ({
  ApiError: class ApiError extends Error {},
  CheckoutService: { purchaseOpenTicketing },
  PaymentsService: { createMyPayment },
}))
vi.mock("@tanstack/react-query", () => ({
  useQueryClient: () => queryClient,
}))
vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: routerReplace }),
}))
vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key, i18n: { language: "en" } }),
}))
vi.mock("@/helpers/checkout", () => ({
  withCheckoutLocale: (url: string, locale: string) =>
    `${url}?locale=${locale}`,
}))
vi.mock("@/lib/browser-navigation", () => ({ navigateBrowser }))
vi.mock("@/lib/attribution", () => ({
  getAttribution: () => ({}),
}))
vi.mock("@/lib/google-analytics", () => ({
  trackGABeginCheckout,
  trackGAPurchase: vi.fn(),
  getGABrowserIds,
}))
vi.mock("@/providers/tenantProvider", () => ({
  useTenant: () => ({
    tenant: { ga_tracking_enabled: true, ga_measurement_id: "G-TEST123" },
  }),
}))
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
    returnContext?: "direct" | "portal"
    buyerIdentity?: BuyerIdentity
    buyerData?: Parameters<typeof usePaymentSubmit>[0]["buyerData"]
    checkoutMode?: "pass_system" | "simple_quantity"
    previewMode?: boolean
  } = {},
) {
  const submitMode = options.submitMode ?? "open-ticketing"
  const paymentCompleteRef = { current: false }
  return renderHook(() =>
    usePaymentSubmit({
      applicationId: submitMode === "application" ? "application-1" : undefined,
      popupId: "popup-1",
      popupSlug: "festival-2026",
      popupCurrency: "USD",
      catalogProducts: [product],
      salesFlowSlug,
      appCredit: 0,
      checkoutMode: options.checkoutMode ?? "pass_system",
      attendeePasses: options.attendees ?? [attendee],
      buyerIdentity: options.buyerIdentity ?? NO_BUYER_IDENTITY,
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
      paymentCompleteRef,
      submitMode,
      returnContext: options.returnContext,
      buyerData: options.buyerData ?? {
        email: "taylor@example.com",
        firstName: "Taylor",
        lastName: "Buyer",
        formData: {},
      },
      editPassesEnabled: false,
      previewMode: options.previewMode,
    }),
  )
}

describe("usePaymentSubmit public purchase payload", () => {
  beforeEach(() => {
    purchaseOpenTicketing.mockClear()
    createMyPayment.mockClear()
    paymentToasts.success.mockClear()
    paymentToasts.error.mockClear()
    telemetry.trackPortalTelemetry.mockClear()
    queryClient.invalidateQueries.mockClear()
    routerReplace.mockClear()
    navigateBrowser.mockClear()
    trackGABeginCheckout.mockClear()
    getGABrowserIds.mockClear()
  })

  it.each([
    "application",
    "open-ticketing",
  ] as const)("tracks checkout before waiting for GA IDs or submitting %s", async (submitMode) => {
    const hook = renderPaymentSubmit("primary", { submitMode })
    await act(async () => {
      await hook.result.current.submitPayment()
    })
    expect(trackGABeginCheckout).toHaveBeenCalledOnce()
    expect(trackGABeginCheckout).toHaveBeenCalledWith(
      expect.objectContaining({
        popup: expect.objectContaining({ id: "popup-1", currency: "USD" }),
        items: expect.arrayContaining([
          expect.objectContaining({ product_id: "product-1", quantity: 2 }),
        ]),
      }),
    )
    expect(trackGABeginCheckout.mock.invocationCallOrder[0]).toBeLessThan(
      getGABrowserIds.mock.invocationCallOrder[0],
    )
  })

  it("does not repeat checkout-start for a failed attempt retried with the same cart", async () => {
    purchaseOpenTicketing.mockRejectedValueOnce(new Error("offline"))
    const hook = renderPaymentSubmit("primary")
    await act(async () => {
      await hook.result.current.submitPayment()
    })
    hook.rerender()
    await act(async () => {
      await hook.result.current.submitPayment()
    })
    expect(purchaseOpenTicketing).toHaveBeenCalledTimes(2)
    expect(trackGABeginCheckout).toHaveBeenCalledOnce()
  })

  it("does not track invalid or preview checkout", async () => {
    const preview = renderPaymentSubmit("primary", { previewMode: true })
    await act(async () => {
      await preview.result.current.submitPayment()
    })
    preview.unmount()
    const empty = renderPaymentSubmit("primary", { passes: [] })
    await act(async () => {
      await empty.result.current.submitPayment()
    })
    expect(trackGABeginCheckout).not.toHaveBeenCalled()
  })

  it("includes GA4 browser identifiers in both purchase request paths", async () => {
    const direct = renderPaymentSubmit("direct-sale")
    await act(async () => {
      await direct.result.current.submitPayment()
    })
    expect(purchaseOpenTicketing.mock.calls[0]?.[0].requestBody).toMatchObject({
      ga_client_id: "123.456",
      ga_session_id: "789",
    })
    direct.unmount()

    const application = renderPaymentSubmit("application", {
      submitMode: "application",
    })
    await act(async () => {
      await application.result.current.submitPayment()
    })
    expect(createMyPayment.mock.calls[0]?.[0].requestBody).toMatchObject({
      ga_client_id: "123.456",
      ga_session_id: "789",
    })
    expect(getGABrowserIds).toHaveBeenCalledWith("G-TEST123")
  })

  it("sends the shared backend contract for a simple-quantity ticket and merch order", async () => {
    const ticket = {
      ...product,
      id: simpleQuantityPurchase.products[0].product_id,
    }
    const merch = {
      ...product,
      id: simpleQuantityPurchase.products[1].product_id,
      category: "merch",
    }
    const { result } = renderPaymentSubmit("direct-sale", {
      checkoutMode: "simple_quantity",
      attendees: [],
      passes: [],
      dynamicItems: {
        tickets: [
          {
            productId: ticket.id,
            product: ticket,
            quantity: 2,
            price: 198,
            stepType: "tickets",
          },
        ],
        extras: [
          {
            productId: ticket.id,
            product: ticket,
            quantity: 1,
            price: 99,
            stepType: "extras",
          },
        ],
        merch: [
          {
            productId: merch.id,
            product: merch,
            quantity: 1,
            price: 20,
            stepType: "merch",
          },
        ],
      },
    })
    await act(async () => {
      await result.current.submitPayment()
    })
    expect(purchaseOpenTicketing).toHaveBeenCalledOnce()
    const body = purchaseOpenTicketing.mock.calls[0][0].requestBody
    expect({
      buyer: body.buyer,
      products: body.products,
      recipients: body.recipients,
    }).toEqual(simpleQuantityPurchase)
  })

  it("blocks unassigned ticket submission when buyer details are blank", async () => {
    const { result } = renderPaymentSubmit("direct-sale", {
      checkoutMode: "simple_quantity",
      attendees: [],
      passes: [],
      buyerData: { email: " ", firstName: " ", lastName: "", formData: {} },
      dynamicItems: {
        tickets: [
          {
            productId: product.id,
            product,
            quantity: 1,
            price: 99,
            stepType: "tickets",
          },
        ],
      },
    })
    await act(async () => {
      expect(await result.current.submitPayment()).toEqual({
        success: false,
        error: "checkout.toast_buyer_incomplete_pay",
      })
    })
    expect(purchaseOpenTicketing).not.toHaveBeenCalled()
    expect(result.current.isSubmitting).toBe(false)
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

  it("marks purchases initiated by the portal with an explicit return context", async () => {
    const { result } = renderPaymentSubmit("merch-store", {
      returnContext: "portal",
    })

    await act(async () => {
      await result.current.submitPayment()
    })

    expect(
      purchaseOpenTicketing.mock.calls[0]?.[0].requestBody.return_context,
    ).toBe("portal")
  })

  it("sends a paid portal purchase to SimpleFI with locale", async () => {
    purchaseOpenTicketing.mockResolvedValueOnce({
      status: "pending",
      checkout_url: "https://simplefi.test/checkout/payment-1",
    })
    const { result } = renderPaymentSubmit("merch-store", {
      returnContext: "portal",
    })

    await act(async () => {
      await result.current.submitPayment()
    })

    expect(navigateBrowser).toHaveBeenCalledWith(
      "https://simplefi.test/checkout/payment-1?locale=en",
    )
  })

  it("sends application context and follows the backend destination", async () => {
    const redirectUrl = "https://brand.example/thanks?lang=en&sig=signature"
    createMyPayment.mockResolvedValueOnce({
      status: "approved",
      id: "payment-1",
      redirect_url: redirectUrl,
    })
    const { result } = renderPaymentSubmit("application-store", {
      submitMode: "application",
      returnContext: "portal",
    })

    await act(async () => {
      await result.current.submitPayment()
    })

    expect(createMyPayment.mock.calls[0]?.[0].requestBody).toMatchObject({
      locale: "en",
      return_context: "portal",
    })
    expect(navigateBrowser).toHaveBeenCalledWith(redirectUrl)
  })

  it("follows the backend-resolved portal redirect for a zero-price purchase", async () => {
    const redirectUrl =
      "https://portal.test/portal/festival-2026/thank-you?lang=en"
    purchaseOpenTicketing.mockResolvedValueOnce({
      status: "approved",
      payment_id: "payment-1",
      redirect_url: redirectUrl,
    })
    const { result } = renderPaymentSubmit("merch-store", {
      returnContext: "portal",
    })

    await act(async () => {
      await result.current.submitPayment()
    })

    expect(navigateBrowser).toHaveBeenCalledWith(redirectUrl)
    expect(routerReplace).not.toHaveBeenCalled()
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
    const sideProduct = {
      ...typedProduct("ownerless-extra"),
      category: "merch",
    }
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
        guests: [{ name: "Taylor Buyer", answers: {} }],
        bookerAnswers: {},
        guestForm: null,
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

  it("sends the buyer's own details for a booking that stopped asking for them", async () => {
    // The accommodation step no longer asks the buyer for an email or a name
    // that the buyer step already collects. This is the single place those
    // answers become real ones, and the backend's `validate_answers` refuses
    // the purchase without them, so the wire is where it has to be pinned.
    const { result } = renderPaymentSubmit("merch-store", {
      passes: [],
      buyerIdentity: buildBuyerIdentity({
        buyerFormSchema: {
          base_fields: {
            email: { type: "email", label: "Email", required: true },
            first_name: { type: "text", label: "First name", required: true },
            last_name: { type: "text", label: "Last name", required: true },
          },
          custom_fields: {},
          sections: [],
        },
        buyerValues: {
          email: "ada@example.com",
          first_name: "Ada",
          last_name: "Lovelace",
        },
      }),
      accommodations: [
        {
          accommodationId: "room-1",
          productId: "room-product",
          name: "Double room",
          propertyId: "property-1",
          propertyName: "Hotel",
          checkIn: "2026-09-01",
          checkOut: "2026-09-03",
          nights: 2,
          guestCount: 1,
          guests: [{ name: "", answers: {} }],
          bookerAnswers: {},
          guestForm: null,
          subtotal: 100,
          tax: 10,
          totalPrice: 110,
        } satisfies SelectedAccommodationItem,
      ],
    })

    await act(async () => {
      await result.current.submitPayment()
    })

    const [line] = purchaseOpenTicketing.mock.calls[0][0].requestBody.products
    expect(line.purchase_metadata.booker_answers).toEqual(
      expect.objectContaining({ email: "ada@example.com" }),
    )
    expect(line.purchase_metadata.guests).toEqual([
      expect.objectContaining({ name: "Ada Lovelace" }),
    ])
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

describe("completed Portal payment presentation", () => {
  it("does not turn a completed purchase into an error or automatic navigation", async () => {
    paymentToasts.success.mockClear()
    paymentToasts.error.mockClear()
    telemetry.trackPortalTelemetry.mockClear()
    navigateBrowser.mockClear()
    const error = Object.assign(
      new ApiError({} as never, {} as never, "completed"),
      {
        body: {
          detail: {
            code: "previous_payment_completed",
            redirect_url: "https://example.com/success",
          },
        },
      },
    )
    createMyPayment.mockRejectedValueOnce(error)
    const h = renderPaymentSubmit("application", {
      submitMode: "application",
      returnContext: "portal",
    })
    await act(async () => {
      expect(await h.result.current.submitPayment()).toEqual({ success: true })
    })
    expect(paymentToasts.success).toHaveBeenCalledWith(
      "portalThankYou.confirmed_notice",
    )
    expect(paymentToasts.error).not.toHaveBeenCalled()
    expect(navigateBrowser).not.toHaveBeenCalled()
    expect(telemetry.trackPortalTelemetry).not.toHaveBeenCalledWith(
      "checkout_failed",
    )
    const calls = createMyPayment.mock.calls.length
    await act(async () => {
      await h.result.current.submitPayment()
    })
    expect(createMyPayment.mock.calls).toHaveLength(calls)
  })
})
