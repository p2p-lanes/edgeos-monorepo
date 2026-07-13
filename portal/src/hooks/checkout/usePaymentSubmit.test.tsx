import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { act, renderHook } from "@testing-library/react"
import type { ReactNode } from "react"
import { CheckoutService } from "@/client"
import type { AttendeePassState } from "@/types/Attendee"
import type { SelectedPassItem } from "@/types/checkout"
import { usePaymentSubmit } from "./usePaymentSubmit"

vi.mock("@/client", () => ({
  ApiError: class ApiError extends Error {},
  CheckoutService: {
    purchaseOpenTicketing: vi.fn(),
  },
  PaymentsService: {
    createMyPayment: vi.fn(),
  },
}))

vi.mock("next/navigation", () => ({
  useRouter: () => ({
    push: vi.fn(),
    replace: vi.fn(),
  }),
}))

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string) => key,
    i18n: { language: "en" },
  }),
}))

vi.mock("sonner", () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
  },
}))

vi.mock("@/lib/attribution", () => ({
  getAttribution: () => ({}),
}))

vi.mock("@/lib/google-analytics", () => ({
  trackGAPurchase: vi.fn(),
}))

vi.mock("@/lib/meta-pixel", () => ({
  getMetaAttribution: () => ({}),
  trackMetaPurchase: vi.fn(),
}))

function createWrapper(): ({ children }: { children: ReactNode }) => ReactNode {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  return function Wrapper({ children }: { children: ReactNode }) {
    return (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    )
  }
}

const noopAttendeePasses: AttendeePassState[] = []

function baseParams(
  buyerData: {
    email: string
    firstName: string
    lastName: string
    phone?: string
    phone_country?: string
    formData: Record<string, unknown>
  } | null,
) {
  return {
    applicationId: undefined,
    popupId: "popup-1",
    popupSlug: "festival",
    appCredit: undefined,
    checkoutMode: "pass_system" as const,
    attendeePasses: noopAttendeePasses,
    selectedPasses: [
      { productId: "prod-1", attendeeId: "attendee-1", quantity: 1 },
    ] as unknown as SelectedPassItem[],
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
    submitMode: "open-ticketing" as const,
    buyerData,
    editPassesEnabled: false,
    popupName: "Festival",
  }
}

describe("usePaymentSubmit — open-ticketing buyer phone wiring", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(CheckoutService.purchaseOpenTicketing).mockResolvedValue({
      status: "approved",
    } as never)
  })

  it("sends phone and phone_country top-level on the buyer object, not inside form_data", async () => {
    const buyerValues = {
      email: "buyer@example.com",
      first_name: "Ana",
      last_name: "Perez",
      phone: "1122334455",
      phone_country: "AR",
    }

    const { result } = renderHook(
      () =>
        usePaymentSubmit(
          baseParams({
            email: buyerValues.email,
            firstName: buyerValues.first_name,
            lastName: buyerValues.last_name,
            phone:
              typeof buyerValues.phone === "string"
                ? buyerValues.phone
                : undefined,
            phone_country:
              typeof buyerValues.phone_country === "string"
                ? buyerValues.phone_country
                : undefined,
            formData: buyerValues,
          }),
        ),
      { wrapper: createWrapper() },
    )

    await act(async () => {
      await result.current.submitPayment()
    })

    expect(CheckoutService.purchaseOpenTicketing).toHaveBeenCalledTimes(1)
    const call = vi.mocked(CheckoutService.purchaseOpenTicketing).mock
      .calls[0][0] as {
      requestBody: { buyer: Record<string, unknown> }
    }

    expect(call.requestBody.buyer.phone).toBe("1122334455")
    expect(call.requestBody.buyer.phone_country).toBe("AR")
    // Must NOT be duplicated inside form_data — phone base fields aren't
    // custom fields, so form_data should not carry them either.
    expect(
      (call.requestBody.buyer.form_data as Record<string, unknown> | undefined)
        ?.phone,
    ).toBeUndefined()
  })
})
