import { cleanup, render, screen } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import Home from "./page"

const state = vi.hoisted(() => ({
  city: null as Record<string, unknown> | null,
  loaded: true,
  replace: vi.fn(),
  defaultHome: vi.fn(),
}))

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: state.replace }),
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
})

describe("optional popup home", () => {
  it.each([
    {},
    { custom_home_enabled: false, custom_home_html: "<h1>Saved</h1>" },
    { custom_home_enabled: true, custom_home_html: null },
    { custom_home_enabled: true, custom_home_html: " \n " },
  ])("preserves the existing home for %j", (settings) => {
    state.city = { ...state.city, ...settings }
    render(<Home />)
    expect(
      screen.getByText("Existing application and companion home"),
    ).toBeTruthy()
    expect(screen.queryByTitle("Gathering")).toBeNull()
  })

  it("renders custom HTML without mounting the application-dependent default home", () => {
    state.city = {
      ...state.city,
      custom_home_enabled: true,
      custom_home_html: "<h1>{{ popup.name }}</h1>",
    }
    const { rerender } = render(<Home />)
    expect(screen.getByTitle("Gathering").getAttribute("srcdoc")).toContain(
      "<h1>Gathering</h1>",
    )
    expect(state.defaultHome).not.toHaveBeenCalled()
    state.city = { id: "two", name: "Other gathering" }
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
