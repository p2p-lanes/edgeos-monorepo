import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import type { PortalSession, SessionSnapshot } from "./session-contract"
import { SessionLifecycle } from "./session-lifecycle"
import {
  notifyInvalidSession,
  rotateSessionRequests,
  sessionRequestSignal,
} from "./session-network"

vi.mock("./service-worker", () => ({
  ensureSafeServiceWorker: vi.fn(async () => {}),
}))
const session: PortalSession = {
  human: {
    id: "fake-human",
    tenant_id: "fake-tenant",
    email: "fake@example.com",
  },
  expires_at: new Date(Date.now() + 60_000).toISOString(),
}
const fetchMock = vi.fn()
const navigate = vi.fn()
const changed = vi.fn()
function lifecycle(
  initial: SessionSnapshot = { status: "unknown", session: null },
) {
  return new SessionLifecycle(initial, navigate, changed)
}
beforeEach(() => {
  localStorage.clear()
  fetchMock.mockReset()
  navigate.mockReset()
  changed.mockReset()
  vi.stubGlobal("fetch", fetchMock)
  rotateSessionRequests()
})
afterEach(() => {
  vi.unstubAllGlobals()
  rotateSessionRequests()
})

describe("cookie session lifecycle", () => {
  it("does not apply a late OTP response after logout has retired its identity", async () => {
    let finishVerification: (response: Response) => void = () => {}
    fetchMock
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            finishVerification = resolve
          }),
      )
      .mockResolvedValueOnce(Response.json({ session: null }))
    const store = lifecycle({ status: "authenticated", session })
    const verification = store.verify("other@example.com", "123456")
    const rejected = expect(verification).rejects.toMatchObject({
      code: "session_changing",
    })
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledOnce())
    const signal = fetchMock.mock.calls[0][1].signal as AbortSignal
    await store.logout("/auth")
    expect(signal.aborted).toBe(true)
    finishVerification(Response.json({ session }))
    await rejected
    expect(navigate).toHaveBeenCalledTimes(1)
    expect(navigate).toHaveBeenCalledWith("/auth")
  })
  it("does not classify malformed successful session JSON as anonymous", async () => {
    fetchMock.mockResolvedValue(Response.json({}))
    const store = lifecycle({ status: "authenticated", session })
    await store.revalidate()
    expect(store.getSnapshot().status).toBe("unavailable")
    expect(navigate).not.toHaveBeenCalled()
  })
  it("rejects an invalid legacy credential without logging out a valid current cookie", async () => {
    localStorage.setItem("token", "fake-expired-legacy")
    fetchMock
      .mockResolvedValueOnce(
        Response.json({ code: "session_invalid" }, { status: 401 }),
      )
      .mockResolvedValueOnce(Response.json({ session }))
    const store = lifecycle({ status: "authenticated", session })
    await store.revalidate(true)
    expect(localStorage.getItem("token")).toBeNull()
    expect(store.getSnapshot()).toEqual({ status: "authenticated", session })
    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([
      "/api/auth/migrate",
      "/api/auth/session",
    ])
    expect(navigate).not.toHaveBeenCalled()
  })
  it.each([
    429, 500, 503,
  ])("preserves a legacy credential on retryable %i", async (status) => {
    localStorage.setItem("token", "fake-legacy")
    fetchMock.mockResolvedValue(
      Response.json({ code: "session_unavailable" }, { status }),
    )
    const store = lifecycle()
    await store.revalidate(true)
    expect(localStorage.getItem("token")).toBe("fake-legacy")
    expect(store.getSnapshot().status).toBe("unavailable")
    expect(navigate).not.toHaveBeenCalled()
  })
  it("removes legacy storage only after verified import and never exposes it in state/events", async () => {
    localStorage.setItem("token", "fake-legacy")
    fetchMock.mockResolvedValue(Response.json({ session }))
    const store = lifecycle()
    await store.revalidate(true)
    expect(fetchMock.mock.calls[0][0]).toBe("/api/auth/migrate")
    expect(localStorage.getItem("token")).toBeNull()
    expect(JSON.stringify(store.getSnapshot())).not.toContain("fake-legacy")
    expect(changed).toHaveBeenCalledWith()
    expect(navigate).toHaveBeenCalledOnce()
  })
  it("leaves migration conflict recoverable without silently overwriting the current account", async () => {
    localStorage.setItem("token", "fake-legacy")
    fetchMock.mockResolvedValueOnce(
      Response.json({ code: "session_conflict" }, { status: 409 }),
    )
    const store = lifecycle()
    await store.revalidate(true)
    expect(store.getSnapshot().status).toBe("conflict")
    expect(localStorage.getItem("token")).toBe("fake-legacy")
    fetchMock.mockResolvedValueOnce(Response.json({ session }))
    await store.discardLegacy()
    expect(localStorage.getItem("token")).toBeNull()
    expect(navigate).toHaveBeenCalledOnce()
  })
  it("definitive rejection retires a legacy credential and becomes confirmed anonymous", async () => {
    localStorage.setItem("token", "fake-forged")
    fetchMock
      .mockResolvedValueOnce(
        Response.json({ code: "session_invalid" }, { status: 401 }),
      )
      .mockResolvedValueOnce(Response.json({ session: null }))
    const store = lifecycle()
    await store.revalidate(true)
    expect(store.getSnapshot()).toEqual({ status: "anonymous", session: null })
    expect(localStorage.getItem("token")).toBeNull()
  })
  it("wrong OTP does not retire an existing authenticated identity", async () => {
    fetchMock.mockResolvedValue(
      Response.json({ code: "auth_rejected" }, { status: 401 }),
    )
    const store = lifecycle({ status: "authenticated", session })
    await expect(
      store.verify("fake@example.com", "000000"),
    ).rejects.toMatchObject({ status: 401 })
    expect(store.getSnapshot()).toEqual({ status: "authenticated", session })
    expect(navigate).not.toHaveBeenCalled()
  })
  it("logout immediately removes sensitive views, aborts old requests and clears drafts", async () => {
    localStorage.setItem("open-cart:popup:flow", "fake-private-draft")
    fetchMock.mockResolvedValue(Response.json({ session: null }))
    const signal = await sessionRequestSignal()
    const store = lifecycle({ status: "authenticated", session })
    const pending = store.logout("/auth")
    expect(signal.aborted).toBe(true)
    expect(store.getSnapshot().session).toBeNull()
    expect(localStorage.getItem("open-cart:popup:flow")).toBeNull()
    await pending
    expect(navigate).toHaveBeenCalledWith("/auth")
  })
  it("cross-tab/back-navigation retirement cannot restore old server hydration", async () => {
    fetchMock.mockResolvedValue(Response.json({ session: null }))
    const store = lifecycle({ status: "authenticated", session })
    store.retireView()
    expect(store.getSnapshot().session).toBeNull()
    await store.revalidate()
    expect(navigate).toHaveBeenCalledOnce()
    expect(changed).not.toHaveBeenCalled()
  })
  it("does not repeat a validated SSR session read on initial bootstrap", async () => {
    await lifecycle({ status: "authenticated", session }).revalidate(true)
    expect(fetchMock).not.toHaveBeenCalled()
  })
  it("retries failed logout as logout, not as a sign-in revalidation", async () => {
    fetchMock
      .mockResolvedValueOnce(
        Response.json({ code: "session_unavailable" }, { status: 503 }),
      )
      .mockResolvedValueOnce(Response.json({ session: null }))
    const store = lifecycle({ status: "authenticated", session })
    await store.logout("/auth")
    expect(store.getSnapshot().status).toBe("unavailable")
    await store.retry()
    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([
      "/api/auth/logout",
      "/api/auth/logout",
    ])
    expect(navigate).toHaveBeenCalledWith("/auth")
  })
  it("hides old identity after an uncertain verification response until revalidated", async () => {
    fetchMock
      .mockRejectedValueOnce(new Error("Fake interrupted response"))
      .mockResolvedValueOnce(Response.json({ session: null }))
    const store = lifecycle({ status: "authenticated", session })
    await expect(
      store.verify("other@example.com", "123456"),
    ).rejects.toMatchObject({ status: 503 })
    expect(store.getSnapshot().session).toBeNull()
    await store.retry()
    expect(store.getSnapshot().status).toBe("anonymous")
    expect((await sessionRequestSignal()).aborted).toBe(false)
  })
  it("ignores upstream and OTP 401s but signals definitive adapter session rejection", () => {
    const invalid = vi.fn()
    window.addEventListener("portal:session-invalid", invalid)
    notifyInvalidSession(401, true, "session_invalid")
    notifyInvalidSession(401, false, "auth_rejected")
    expect(invalid).not.toHaveBeenCalled()
    notifyInvalidSession(401, false, "session_invalid")
    expect(invalid).toHaveBeenCalledOnce()
    window.removeEventListener("portal:session-invalid", invalid)
  })
})
