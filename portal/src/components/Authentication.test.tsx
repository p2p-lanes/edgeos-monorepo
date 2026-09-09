import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { queryKeys } from "@/lib/query-keys"
import type { SessionSnapshot } from "@/lib/session-contract"
import { SessionProvider } from "@/providers/sessionProvider"
import Authentication from "./Authentication"

const mockReplace = vi.fn()
vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: mockReplace }),
  usePathname: () => window.location.pathname,
}))
vi.mock("@/lib/service-worker", () => ({
  ensureSafeServiceWorker: vi.fn(async () => {}),
}))
vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}))
vi.mock("@/components/ui/Loader", () => ({
  Loader: () => <div data-testid="loader" />,
}))

function entry(snapshot: SessionSnapshot) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  client.setQueryData(queryKeys.profile.current, { id: "cached-human" })
  return render(
    <SessionProvider initial={snapshot} onNavigate={vi.fn()}>
      <QueryClientProvider client={client}>
        <Authentication>
          <div>Portal content</div>
        </Authentication>
      </QueryClientProvider>
    </SessionProvider>,
  )
}

describe("Authentication", () => {
  beforeEach(() => {
    mockReplace.mockClear()
    localStorage.clear()
    window.history.replaceState(
      {},
      "",
      "/portal/tech-summit-2025?tab=events#schedule",
    )
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json({ session: null })),
    )
  })
  afterEach(() => {
    cleanup()
    vi.unstubAllGlobals()
  })

  it("preserves the requested popup URL when sending a confirmed anonymous visitor to login", async () => {
    entry({ status: "anonymous", session: null })
    await waitFor(() =>
      expect(mockReplace).toHaveBeenCalledWith(
        "/auth?redirect=%2Fportal%2Ftech-summit-2025%3Ftab%3Devents%23schedule",
      ),
    )
    expect(screen.queryByText("Portal content")).toBeNull()
  })
  it("renders only for a verified unexpired identity", async () => {
    entry({
      status: "authenticated",
      session: {
        human: { id: "human", tenant_id: "tenant", email: "fake@example.com" },
        expires_at: new Date(Date.now() + 60_000).toISOString(),
      },
    })
    await act(async () => {})
    expect(screen.getByText("Portal content")).toBeTruthy()
    expect(mockReplace).not.toHaveBeenCalled()
  })
  it("does not use cached profile data as auth proof or fake an anonymous result on outage", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json({ code: "session_unavailable" }, { status: 503 }),
      ),
    )
    entry({ status: "unknown", session: null })
    await act(async () => {})
    expect(screen.queryByText("Portal content")).toBeNull()
    expect(mockReplace).not.toHaveBeenCalled()
    expect(screen.getByText("auth.network_error")).toBeTruthy()
    fireEvent.click(screen.getByText("auth.sign_up_or_log_in"))
    expect(mockReplace).toHaveBeenCalledWith(
      "/auth?redirect=%2Fportal%2Ftech-summit-2025%3Ftab%3Devents%23schedule",
    )
  })
  it("does not render an expired snapshot even before the expiry effect runs", () => {
    entry({
      status: "authenticated",
      session: {
        human: { id: "human", tenant_id: "tenant", email: "fake@example.com" },
        expires_at: "2020-01-01T00:00:00Z",
      },
    })
    expect(screen.queryByText("Portal content")).toBeNull()
  })
})
