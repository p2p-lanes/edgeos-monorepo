import { render } from "@testing-library/react"
import { useSearchParams } from "next/navigation"
import { renderToString } from "react-dom/server"
import { describe, expect, it, vi } from "vitest"
import AuthPage from "@/app/auth/page"
import RootLoading from "@/app/loading"
import RootPage from "@/app/page"
import { TenantProvider } from "@/providers/tenantProvider"
import { Loader } from "./Loader"

vi.mock("next/navigation", () => ({
  useRouter: () => ({}),
  useSearchParams: vi.fn(() => new URLSearchParams()),
}))
vi.mock("@/hooks/useIsAuthenticated", () => ({
  useIsAuthenticated: () => true,
}))

describe("Loader", () => {
  it("keeps content loading in normal flow with visible height", () => {
    const { container } = render(<Loader />)
    const loader = container.firstElementChild!

    for (const overlayClass of ["fixed", "absolute", "inset-0", "z-50"]) {
      expect(loader.classList.contains(overlayClass)).toBe(false)
    }
    expect(loader.classList.contains("w-full")).toBe(true)
    expect(loader.classList.contains("min-h-[50vh]")).toBe(true)
    expect(loader.querySelector(".animate-spin")).not.toBeNull()
  })

  it("preserves the viewport overlay only when explicitly requested", () => {
    const { container } = render(<Loader fullScreen />)
    const loader = container.firstElementChild!

    for (const overlayClass of ["fixed", "inset-0", "z-50", "bg-background"]) {
      expect(loader.classList.contains(overlayClass)).toBe(true)
    }
    expect(loader.querySelector(".animate-spin")).not.toBeNull()
  })

  it.each([
    ["root suspense", RootLoading],
    ["root redirect", RootPage],
    ["auth redirect", AuthPage],
    ["tenant resolution", () => <TenantProvider>{null}</TenantProvider>],
  ])("retains full-screen markup during %s bootstrap", (_name, Component) => {
    const container = document.createElement("div")
    container.innerHTML = renderToString(<Component />)
    expect(
      container.querySelector(".fixed.inset-0.z-50 .animate-spin"),
    ).not.toBeNull()
  })

  it("retains the full-screen auth suspense fallback", () => {
    vi.mocked(useSearchParams).mockImplementationOnce(() => {
      throw new Promise(() => {})
    })
    const container = document.createElement("div")
    container.innerHTML = renderToString(<AuthPage />)

    expect(
      container.querySelector(".fixed.inset-0.z-50 .animate-spin"),
    ).not.toBeNull()
  })
})
