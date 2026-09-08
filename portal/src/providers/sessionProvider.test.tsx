import { act, cleanup, render, screen, waitFor } from "@testing-library/react"
import { renderToString } from "react-dom/server"
import { afterEach, beforeEach, expect, it, vi } from "vitest"
import { useIsAuthenticated } from "@/hooks/useIsAuthenticated"
import type { SessionSnapshot } from "@/lib/session-contract"
import { rotateSessionRequests } from "@/lib/session-network"
import { SessionProvider } from "./sessionProvider"

vi.mock("@/lib/service-worker", () => ({
  ensureSafeServiceWorker: vi.fn(async () => {}),
}))
vi.mock("@/components/ui/Loader", () => ({
  Loader: () => <div>Checking session</div>,
}))
vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}))
const initial: SessionSnapshot = {
  status: "authenticated",
  session: {
    human: { id: "human-a", tenant_id: "tenant-a", email: "fake@example.com" },
    expires_at: new Date(Date.now() + 60_000).toISOString(),
  },
}
const fetchMock = vi.fn()
const navigate = vi.fn()
function PrivateView() {
  return useIsAuthenticated() ? (
    <div>Private account A</div>
  ) : (
    <div>Anonymous</div>
  )
}
beforeEach(() => {
  fetchMock.mockReset()
  navigate.mockReset()
  localStorage.clear()
  vi.stubGlobal("fetch", fetchMock)
  rotateSessionRequests()
})
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  vi.useRealTimers()
  rotateSessionRequests()
})

it("uses the same verified session snapshot during SSR and first client render", async () => {
  const element = (
    <SessionProvider initial={initial} onNavigate={navigate}>
      <PrivateView />
    </SessionProvider>
  )
  expect(renderToString(element)).toContain("Private account A")
  render(element)
  expect(screen.getByText("Private account A")).toBeTruthy()
  await act(async () => {})
  expect(fetchMock).not.toHaveBeenCalled()
})
it("storage change retires the old view before cross-tab revalidation finishes", async () => {
  let resolve: (value: Response) => void = () => {}
  fetchMock.mockImplementation(
    () =>
      new Promise((done) => {
        resolve = done
      }),
  )
  render(
    <SessionProvider initial={initial} onNavigate={navigate}>
      <PrivateView />
    </SessionProvider>,
  )
  await act(async () => {})
  act(() =>
    window.dispatchEvent(
      new StorageEvent("storage", {
        key: "portal_session_changed",
        newValue: "non-sensitive-change",
      }),
    ),
  )
  expect(screen.queryByText("Private account A")).toBeNull()
  await waitFor(() => expect(fetchMock).toHaveBeenCalled())
  await act(async () => resolve(Response.json({ session: null })))
  expect(navigate).toHaveBeenCalled()
})
it("pagehide removes sensitive DOM before back/forward cache storage", async () => {
  render(
    <SessionProvider initial={initial} onNavigate={navigate}>
      <PrivateView />
    </SessionProvider>,
  )
  await act(async () => {})
  act(() =>
    window.dispatchEvent(
      new PageTransitionEvent("pagehide", { persisted: true }),
    ),
  )
  expect(screen.queryByText("Private account A")).toBeNull()
  fetchMock.mockResolvedValue(Response.json({ session: null }))
  await act(async () =>
    window.dispatchEvent(
      new PageTransitionEvent("pageshow", { persisted: true }),
    ),
  )
  await waitFor(() => expect(navigate).toHaveBeenCalled())
})
it("expiry retires sensitive DOM and confirms the expired cookie before logout", async () => {
  vi.useFakeTimers()
  fetchMock
    .mockResolvedValueOnce(
      Response.json({ code: "session_invalid" }, { status: 401 }),
    )
    .mockResolvedValueOnce(Response.json({ session: null }))
  render(
    <SessionProvider initial={initial} onNavigate={navigate}>
      <PrivateView />
    </SessionProvider>,
  )
  await act(async () => {
    await vi.advanceTimersByTimeAsync(61_000)
  })
  expect(screen.queryByText("Private account A")).toBeNull()
  expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([
    "/api/auth/session",
    "/api/auth/logout",
  ])
})
