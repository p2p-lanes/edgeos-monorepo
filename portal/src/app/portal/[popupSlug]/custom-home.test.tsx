import { cleanup, render, screen } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import Home from "./page"

const state = vi.hoisted(() => ({
  city: null as Record<string, unknown> | null,
  loaded: true,
  replace: vi.fn(),
  defaultHome: vi.fn(),
  homeQuery: {
    data: undefined as
      | { html: string; version: number; updated_at: string }
      | undefined,
    isPending: false,
  },
  search: "",
  application: null as Record<string, unknown> | null,
  getRelevantApplication: vi.fn(),
  feeConfirmation: vi.fn(),
}))

vi.mock("@tanstack/react-query", () => ({
  useQuery: () => state.homeQuery,
}))
vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: state.replace }),
  useSearchParams: () => new URLSearchParams(state.search),
}))
vi.mock("react-i18next", () => ({
  useTranslation: () => ({ i18n: { resolvedLanguage: "en" } }),
}))
vi.mock("@/providers/cityProvider", () => ({
  useCityProvider: () => ({
    getCity: () => state.city,
    popupsLoaded: state.loaded,
  }),
}))
vi.mock("@/providers/applicationProvider", () => ({
  useApplication: () => ({
    getRelevantApplication: state.getRelevantApplication,
  }),
}))
vi.mock("./application/components/fee-payment-banner", () => ({
  useFeePaymentConfirmation: (...args: unknown[]) =>
    state.feeConfirmation(...args),
}))
vi.mock("@/components/Portal/DefaultPopupHome", () => ({
  default: () => {
    state.defaultHome()
    return <div>Existing application and companion home</div>
  },
}))
vi.mock("@/components/ui/Loader", () => ({
  Loader: () => <div>Loading popups</div>,
}))

afterEach(cleanup)
beforeEach(() => {
  vi.clearAllMocks()
  state.city = { id: "one", name: "Gathering", slug: "gathering" }
  state.loaded = true
  state.homeQuery = { data: undefined, isPending: false }
  state.search = ""
  state.application = null
  state.getRelevantApplication.mockImplementation(() => state.application)
})

describe("optional popup home resource", () => {
  it.each([
    {},
    { custom_home_enabled: false },
  ])("preserves the existing home for %j", (settings) => {
    state.city = { ...state.city, ...settings }
    render(<Home />)
    expect(
      screen.getByText("Existing application and companion home"),
    ).toBeTruthy()
    expect(screen.queryByTitle("Gathering")).toBeNull()
  })

  it("loads an enabled home before rendering its isolated document", () => {
    state.city = { ...state.city, custom_home_enabled: true }
    state.homeQuery = { data: undefined, isPending: true }
    const { rerender } = render(<Home />)
    expect(screen.getByText("Loading popups")).toBeTruthy()
    expect(state.defaultHome).not.toHaveBeenCalled()

    state.homeQuery = {
      data: {
        html: "<h1>{{ popup.name }}</h1>",
        version: 1,
        updated_at: "2026-01-01T00:00:00Z",
      },
      isPending: false,
    }
    rerender(<Home />)
    expect(screen.getByTitle("Gathering").getAttribute("srcdoc")).toContain(
      "<h1>Gathering</h1>",
    )
    expect(state.defaultHome).not.toHaveBeenCalled()
  })

  it("falls back if the publication signal has no usable resource", () => {
    state.city = { ...state.city, custom_home_enabled: true }
    state.homeQuery = {
      data: {
        html: " \n ",
        version: 1,
        updated_at: "2026-01-01T00:00:00Z",
      },
      isPending: false,
    }
    render(<Home />)
    expect(
      screen.getByText("Existing application and companion home"),
    ).toBeTruthy()
  })

  it("keeps fee confirmation polling alive behind a custom home", () => {
    const application = { id: "application", status: "pending_fee" }
    state.application = application
    state.search = "flow=flow-1&checkout=success"
    state.city = { ...state.city, custom_home_enabled: true }
    state.homeQuery = {
      data: {
        html: "<h1>Custom</h1>",
        version: 1,
        updated_at: "2026-01-01T00:00:00Z",
      },
      isPending: false,
    }
    render(<Home />)
    expect(state.getRelevantApplication).toHaveBeenCalledWith("flow-1")
    expect(state.feeConfirmation).toHaveBeenCalledWith(application, true)
  })

  it("does not retain the previous popup document", () => {
    state.city = {
      ...state.city,
      custom_home_enabled: true,
    }
    state.homeQuery = {
      data: {
        html: "<h1>Gathering</h1>",
        version: 1,
        updated_at: "2026-01-01T00:00:00Z",
      },
      isPending: false,
    }
    const { rerender } = render(<Home />)
    expect(screen.getByTitle("Gathering")).toBeTruthy()

    state.city = { id: "two", name: "Other", slug: "other" }
    rerender(<Home />)
    expect(screen.queryByTitle("Gathering")).toBeNull()
    expect(state.defaultHome).toHaveBeenCalled()
  })

  it("retains loading and missing-popup behavior", () => {
    state.city = null
    state.loaded = false
    const { rerender } = render(<Home />)
    expect(screen.getByText("Loading popups")).toBeTruthy()
    expect(state.replace).not.toHaveBeenCalled()
    state.loaded = true
    rerender(<Home />)
    expect(state.replace).toHaveBeenCalledWith("/portal")
  })
})
