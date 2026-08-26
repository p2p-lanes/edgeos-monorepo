import { act, renderHook } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"
import type { AttendeePassState } from "@/types/Attendee"
import type { SelectedPassItem } from "@/types/checkout"
import type { ProductsPass } from "@/types/Products"

const purchaseOpenTicketing = vi.hoisted(() =>
  vi.fn().mockResolvedValue({ status: "created" }),
)
const telemetry = vi.hoisted(() => ({ trackPortalTelemetry: vi.fn() }))
const queryClient = vi.hoisted(() => ({ invalidateQueries: vi.fn() }))

vi.mock("@/client", () => ({
  ApiError: class ApiError extends Error {},
  CheckoutService: { purchaseOpenTicketing },
  PaymentsService: { createMyPayment: vi.fn() },
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

function renderPaymentSubmit(salesFlowSlug: string | null) {
  return renderHook(() =>
    usePaymentSubmit({
      applicationId: undefined,
      popupId: "popup-1",
      popupSlug: "festival-2026",
      salesFlowSlug,
      appCredit: 0,
      checkoutMode: "pass_system",
      attendeePasses: [attendee],
      selectedPasses,
      housing: null,
      merch: [],
      patron: null,
      selectedMealPlans: [],
      dynamicItems: {},
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
      submitMode: "open-ticketing",
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
        products: [{ product_id: "product-1", quantity: 2 }],
        buyer: {
          email: "taylor@example.com",
          first_name: "Taylor",
          last_name: "Buyer",
          form_data: {},
        },
      }),
    })
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
