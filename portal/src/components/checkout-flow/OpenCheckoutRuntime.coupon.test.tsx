import { render } from "@testing-library/react"
import type { ComponentProps, ReactNode } from "react"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { type CheckoutRuntimeResponse, CouponsService } from "@/client"
import { CheckoutProvider } from "@/providers/checkoutProvider"
import { OpenCheckoutRuntime } from "./OpenCheckoutRuntime"

const route = vi.hoisted(() => ({ search: "" }))
vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams(route.search),
}))
vi.mock("@/client", () => ({
  CouponsService: { validateCouponPublic: vi.fn() },
}))
vi.mock("@tanstack/react-query", () => ({
  useQueryClient: () => ({ setQueryData: vi.fn() }),
}))
vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}))
vi.mock("@/providers/checkoutProvider", () => ({
  CheckoutProvider: vi.fn(() => null),
}))
vi.mock("@/providers/applicationProvider", async () => ({
  ApplicationContext: (await import("react")).createContext({}),
}))
vi.mock("@/providers/cityProvider", async () => ({
  CityContext: (await import("react")).createContext({}),
}))
vi.mock("@/providers/discountProvider", async () => ({
  DiscountContext: (await import("react")).createContext({}),
}))
vi.mock("@/providers/languageProvider", () => ({
  LanguageProvider: ({ children }: { children: ReactNode }) => children,
}))
vi.mock("@/providers/passesProvider", () => ({
  default: ({ children }: { children: ReactNode }) => children,
}))
vi.mock("@/providers/themeProvider", () => ({ useThemeScopeStyle: () => ({}) }))
vi.mock("@/components/checkout-flow/ScrollyCheckoutFlow", () => ({
  default: () => null,
}))
vi.mock("@/components/checkout-flow/StepperCheckoutFlow", () => ({
  default: () => null,
}))
vi.mock("@/components/checkout-flow/FaviconOverride", () => ({
  default: () => null,
}))
vi.mock("@/components/checkout-flow/OpenCheckoutQuoteStatus", () => ({
  OpenCheckoutQuoteStatus: () => null,
}))
vi.mock("@/components/common/LanguageSwitcher", () => ({
  LanguageSwitcher: () => null,
}))
vi.mock("@/lib/attribution", () => ({ captureAttribution: vi.fn() }))
vi.mock("@/lib/google-analytics", () => ({ trackGAViewItem: vi.fn() }))
vi.mock("@/lib/meta-pixel", () => ({ trackMetaViewContent: vi.fn() }))
vi.mock("@/lib/portal-telemetry", () => ({ trackPortalTelemetry: vi.fn() }))

const runtime = {
  popup: {
    id: "popup-1",
    name: "Festival",
    currency: "USD",
    allows_coupons: true,
  },
  products: [],
  selected_flow: { id: "flow-friends", slug: "friends" },
  flow_type: "direct",
  ticketing_steps: [],
} as unknown as CheckoutRuntimeResponse

function renderRuntime() {
  render(
    <OpenCheckoutRuntime
      runtime={runtime}
      popupSlug="festival"
      flowSlug="friends"
    />,
  )
  return vi.mocked(CheckoutProvider).mock.calls.at(-1)![0] as ComponentProps<
    typeof CheckoutProvider
  >
}

beforeEach(() => vi.clearAllMocks())

describe("OpenCheckoutRuntime coupon URL wiring", () => {
  it("forwards a URL-decoded coupon and validates it for the selected flow", async () => {
    route.search = "lang=es&coupon=FRIENDS%2B20"
    vi.mocked(CouponsService.validateCouponPublic).mockResolvedValue({
      discount_value: "20",
    } as never)
    const props = renderRuntime()
    expect(props.initialPromoCode).toBe("FRIENDS+20")
    expect(await props.validatePromoCodeOverride!("FRIENDS+20")).toBe(20)
    expect(CouponsService.validateCouponPublic).toHaveBeenCalledWith({
      requestBody: {
        popup_slug: "festival",
        flow_slug: "friends",
        code: "FRIENDS+20",
      },
    })
  })

  it("leaves existing checkout links without a coupon unchanged", () => {
    route.search = "lang=es"
    expect(renderRuntime().initialPromoCode).toBeNull()
    expect(CouponsService.validateCouponPublic).not.toHaveBeenCalled()
  })
})
