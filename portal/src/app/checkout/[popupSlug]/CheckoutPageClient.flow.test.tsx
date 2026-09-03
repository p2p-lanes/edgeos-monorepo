import { render, screen } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { setActiveRequestLanguage } from "@/lib/language-storage"
import CheckoutPageClient from "./CheckoutPageClient"

let runtime: {
  popup: { id: string; slug: string; name: string }
  selected_flow: { id: string; slug: string }
  products: never[]
  buyer_form: never[]
  ticketing_steps: never[]
  flow_type?: string
  theme_config?: { colors?: { mode?: "dark"; primary_color?: string } }
} = {
  popup: { id: "popup-1", slug: "festival-2026", name: "Festival" },
  selected_flow: { id: "flow-id", slug: "merch-store" },
  products: [],
  buyer_form: [],
  ticketing_steps: [],
}

vi.mock("./hooks/useCheckoutRuntime", () => ({
  useCheckoutRuntime: () => ({
    data: runtime,
    isLoading: false,
    isError: false,
  }),
}))

vi.mock("@/components/checkout-flow/OpenCheckoutRuntime", () => ({
  OpenCheckoutRuntime: ({ flowSlug }: { flowSlug: string }) => (
    <div>selected-flow:{flowSlug}</div>
  ),
}))

vi.mock("./ApplicationCheckoutRedirect", () => ({
  ApplicationCheckoutRedirect: ({ flowId }: { flowId?: string }) => (
    <div>application-checkout:{flowId ?? "missing"}</div>
  ),
}))

vi.mock("@/hooks/useAuth", () => ({ default: () => ({ user: null }) }))
vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}))

describe("CheckoutPageClient flow propagation", () => {
  beforeEach(() => {
    setActiveRequestLanguage("en")
    runtime = {
      popup: { id: "popup-1", slug: "festival-2026", name: "Festival" },
      selected_flow: { id: "flow-id", slug: "merch-store" },
      products: [],
      buyer_form: [],
      ticketing_steps: [],
    }
  })

  it("passes the named flow to the purchase runtime", () => {
    render(
      <CheckoutPageClient popupSlug="festival-2026" flowSlug="merch-store" />,
    )

    expect(screen.getByText("selected-flow:merch-store")).toBeTruthy()
  })

  it("keeps the selected flow theme inside the checkout subtree", () => {
    document.documentElement.style.setProperty(
      "--background",
      "rgb(245 245 245)",
    )
    runtime = {
      ...runtime,
      theme_config: {
        colors: {
          mode: "dark",
          primary_color: "#112233",
        },
      },
    }

    render(
      <CheckoutPageClient popupSlug="festival-2026" flowSlug="merch-store" />,
    )

    const checkoutScope = screen
      .getByText("selected-flow:merch-store")
      .closest("[style*='--background']")
    expect(checkoutScope?.getAttribute("style")).toContain(
      "--background: oklch(0.145 0 0)",
    )
    expect(
      document.documentElement.style.getPropertyValue("--background"),
    ).toBe("rgb(245 245 245)")
  })

  it("preserves the selected application flow identity for the portal checkout handoff", () => {
    runtime = {
      ...runtime,
      selected_flow: { id: "application-flow-id", slug: "attendee-pass" },
      flow_type: "application",
    }

    render(
      <CheckoutPageClient popupSlug="festival-2026" flowSlug="attendee-pass" />,
    )

    expect(
      screen.getByText("application-checkout:application-flow-id"),
    ).toBeTruthy()
  })
})
