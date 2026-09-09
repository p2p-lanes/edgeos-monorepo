import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react"
import { useEffect } from "react"
import { renderToString } from "react-dom/server"
import { afterEach, beforeEach, expect, it, vi } from "vitest"
import AuthForm from "@/app/auth/AuthForm"
import type { TenantPublic } from "@/client"
import Authentication from "@/components/Authentication"
import { useIsAuthenticated } from "@/hooks/useIsAuthenticated"
import { queryKeys } from "@/lib/query-keys"
import { ensureSafeServiceWorker } from "@/lib/service-worker"
import type { SessionSnapshot } from "@/lib/session-contract"
import { rotateSessionRequests } from "@/lib/session-network"
import { BootstrapRecovery, SessionProvider } from "./sessionProvider"
import { TenantProvider } from "./tenantProvider"

vi.mock("next/navigation", () => ({
  usePathname: () => window.location.pathname,
  useRouter: () => ({ replace: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}))

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
  window.history.replaceState({}, "", "/portal")
  vi.mocked(ensureSafeServiceWorker).mockReset().mockResolvedValue(undefined)
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
it.each([
  "503",
  "network",
  "malformed",
])("keeps private DOM and its real query cache mounted during focus %s and same-identity retry", async (failure) => {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  client.setQueryData(queryKeys.profile.current, initial.session!.human)
  const mounted = vi.fn()
  const unmounted = vi.fn()
  function Content() {
    useEffect(() => {
      mounted()
      return unmounted
    }, [])
    return <input aria-label="Private draft" defaultValue="unsaved value" />
  }
  render(
    <SessionProvider initial={initial} onNavigate={navigate}>
      <QueryClientProvider client={client}>
        <Authentication>
          <Content />
        </Authentication>
      </QueryClientProvider>
    </SessionProvider>,
  )
  await act(async () => {})
  const input = screen.getByLabelText("Private draft")
  fireEvent.change(input, { target: { value: "edited locally" } })
  if (failure === "network")
    fetchMock.mockRejectedValueOnce(new Error("Fake network failure"))
  else
    fetchMock.mockResolvedValueOnce(
      Response.json(
        failure === "malformed" ? {} : { code: "session_unavailable" },
        { status: failure === "503" ? 503 : 200 },
      ),
    )
  await act(async () => window.dispatchEvent(new Event("focus")))
  expect(screen.getByLabelText("Private draft")).toBe(input)
  expect((input as HTMLInputElement).value).toBe("edited locally")
  expect(client.getQueryData(queryKeys.profile.current)).toEqual(
    initial.session!.human,
  )
  fetchMock.mockResolvedValueOnce(Response.json({ session: initial.session }))
  await act(async () => window.dispatchEvent(new Event("focus")))
  expect(screen.getByLabelText("Private draft")).toBe(input)
  expect(mounted).toHaveBeenCalledOnce()
  expect(unmounted).not.toHaveBeenCalled()
  expect(navigate).not.toHaveBeenCalled()
})
it("retains verified SSR content when worker readiness fails without allowing private traffic", async () => {
  vi.mocked(ensureSafeServiceWorker).mockRejectedValue(
    new Error("Fake unsafe worker"),
  )
  render(
    <SessionProvider initial={initial} onNavigate={navigate}>
      <Authentication>
        <div>Verified private content</div>
      </Authentication>
    </SessionProvider>,
  )
  await act(async () => {})
  expect(screen.getByText("Verified private content")).toBeTruthy()
  await act(async () => window.dispatchEvent(new Event("focus")))
  expect(screen.getByText("Verified private content")).toBeTruthy()
  expect(fetchMock).not.toHaveBeenCalled()
})
it.each([
  "503",
  "worker",
])("keeps the real public login form available after unknown-session %s without mounting cached private content", async (failure) => {
  window.history.replaceState({}, "", "/auth")
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  client.setQueryData(queryKeys.profile.current, initial.session!.human)
  const privateMounted = vi.fn()
  function PrivateContent() {
    privateMounted()
    return <div>Private content must stay hidden</div>
  }
  if (failure === "worker")
    vi.mocked(ensureSafeServiceWorker).mockRejectedValue(
      new Error("Fake unsafe worker"),
    )
  else
    fetchMock.mockResolvedValue(
      Response.json({ code: "session_unavailable" }, { status: 503 }),
    )
  render(
    <SessionProvider
      initial={{ status: "unknown", session: null }}
      onNavigate={navigate}
    >
      <QueryClientProvider client={client}>
        <TenantProvider
          initialTenant={
            {
              id: "tenant-a",
              slug: "demo",
              name: "Fake tenant",
              custom_domain_active: false,
            } as TenantPublic
          }
        >
          <AuthForm />
          <Authentication>
            <PrivateContent />
          </Authentication>
        </TenantProvider>
      </QueryClientProvider>
    </SessionProvider>,
  )
  await act(async () => {})
  expect(screen.getByPlaceholderText("auth.email_placeholder")).toBeTruthy()
  expect(privateMounted).not.toHaveBeenCalled()
  expect(navigate).not.toHaveBeenCalled()
  expect(screen.getByText("auth.network_error")).toBeTruthy()
})
it("keeps an uncertain personalized bootstrap retired outside the sign-in page", async () => {
  localStorage.setItem("token", "fake-legacy")
  fetchMock.mockResolvedValue(
    Response.json({ code: "session_unavailable" }, { status: 503 }),
  )
  render(
    <SessionProvider initial={initial} onNavigate={navigate}>
      <div>Personalized hydration tree</div>
    </SessionProvider>,
  )
  await act(async () => {})
  expect(screen.queryByText("Personalized hydration tree")).toBeNull()
  expect(screen.getByText("auth.sign_up_or_log_in")).toBeTruthy()
})
it("uses connectivity recovery when no tenant bootstrap exists, without inventing a sign-in tenant", () => {
  render(<BootstrapRecovery />)
  expect(screen.getByRole("alert").textContent).toBe(
    "auth.network_errorsession.retry",
  )
  expect(screen.queryByPlaceholderText("auth.email_placeholder")).toBeNull()
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
