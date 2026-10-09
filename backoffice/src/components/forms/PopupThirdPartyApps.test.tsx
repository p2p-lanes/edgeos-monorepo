import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { PopupThirdPartyApps } from "./PopupThirdPartyApps"

const mocks = vi.hoisted(() => ({
  list: vi.fn(),
  set: vi.fn(),
  copy: vi.fn(),
  toast: vi.fn(),
}))
vi.mock("@/client", () => ({
  ThirdPartySsoService: { listPopupApps: mocks.list, setPopupApp: mocks.set },
}))
vi.mock("@/hooks/useCustomToast", () => ({
  default: () => ({
    showSuccessToast: mocks.toast,
    showErrorToast: mocks.toast,
  }),
}))
vi.mock("@/utils", () => ({ createErrorHandler: () => mocks.toast }))
const app = {
  app_id: "atlas-id",
  name: "Atlas & Co",
  enabled: false,
  sso_configured: true,
  launch_path: "/portal/test/apps/atlas-id/launch",
}

function mount() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  return render(
    <QueryClientProvider client={client}>
      <PopupThirdPartyApps popupId="popup-id" />
    </QueryClientProvider>,
  )
}
beforeEach(() => {
  vi.clearAllMocks()
  mocks.list.mockResolvedValue([{ ...app }])
  mocks.set.mockResolvedValue({ ...app, enabled: true })
  mocks.copy.mockResolvedValue(undefined)
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: { writeText: mocks.copy },
  })
})
afterEach(cleanup)

describe("popup app access", () => {
  it("saves enabling separately from the home form", async () => {
    mount()
    fireEvent.click(
      await screen.findByRole("switch", { name: "Enable Atlas & Co" }),
    )
    await waitFor(() =>
      expect(mocks.set).toHaveBeenCalledWith({
        popupId: "popup-id",
        appId: "atlas-id",
        requestBody: { enabled: true },
      }),
    )
  })
  it("copies an escaped ordinary HTML link, not a token", async () => {
    mocks.list.mockResolvedValue([{ ...app, enabled: true }])
    mount()
    fireEvent.click(
      await screen.findByRole("button", { name: "Copy HTML link" }),
    )
    await waitFor(() =>
      expect(mocks.copy).toHaveBeenCalledWith(
        '<a href="/portal/test/apps/atlas-id/launch">Open Atlas &amp; Co</a>',
      ),
    )
  })
  it("cannot enable an unconfigured app", async () => {
    mocks.list.mockResolvedValue([{ ...app, sso_configured: false }])
    mount()
    expect(
      (
        await screen.findByRole("switch", { name: "Enable Atlas & Co" })
      ).hasAttribute("disabled"),
    ).toBe(true)
  })
  it("can disable a link after its app SSO URLs were cleared", async () => {
    mocks.list.mockResolvedValue([
      { ...app, enabled: true, sso_configured: false },
    ])
    mount()
    const toggle = await screen.findByRole("switch", {
      name: "Enable Atlas & Co",
    })
    expect(toggle.hasAttribute("disabled")).toBe(false)
    fireEvent.click(toggle)
    await waitFor(() =>
      expect(mocks.set).toHaveBeenCalledWith({
        popupId: "popup-id",
        appId: "atlas-id",
        requestBody: { enabled: false },
      }),
    )
  })
})
