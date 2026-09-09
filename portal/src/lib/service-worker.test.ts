// @vitest-environment node
import { readFileSync } from "node:fs"
import vm from "node:vm"
import { afterEach, describe, expect, it, vi } from "vitest"
import { ensureSafeServiceWorker } from "./service-worker"
import { authRequest } from "./session-lifecycle"

function workerHarness() {
  const handlers: Record<string, (event: Record<string, unknown>) => void> = {}
  const keys = new Set(["edge-portal-v1", "edge-portal-v0", "unrelated-app"])
  const put = vi.fn()
  const caches = {
    keys: async () => [...keys],
    delete: vi.fn(async (key: string) => keys.delete(key)),
    open: vi.fn(async () => ({ put })),
    match: vi.fn(async () => undefined),
  }
  const claim = vi.fn()
  const fetch = vi.fn(async () => ({
    ok: true,
    type: "basic",
    headers: new Headers({ "Content-Type": "application/javascript" }),
    clone: (): string => "static-copy",
  }))
  vm.runInNewContext(
    readFileSync(new URL("../../public/sw.js", import.meta.url), "utf8"),
    {
      self: {
        addEventListener: (
          type: string,
          handler: (typeof handlers)[string],
        ) => {
          handlers[type] = handler
        },
        skipWaiting: vi.fn(),
        clients: { claim },
        location: { origin: "https://demo.example.com" },
      },
      caches,
      fetch,
      URL,
      Response,
    },
  )
  async function activate() {
    let pending: Promise<unknown> | undefined
    handlers.activate({
      waitUntil: (promise: Promise<unknown>) => {
        pending = promise
      },
    })
    await pending
  }
  return { handlers, keys, caches, claim, fetch, put, activate }
}

afterEach(() => {
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
  vi.useRealTimers()
})

describe("public-static worker upgrade", () => {
  it("deletes all legacy private caches before claiming existing documents", async () => {
    const worker = workerHarness()
    worker.claim.mockImplementation(() =>
      expect([...worker.keys]).toEqual(["unrelated-app"]),
    )
    await worker.activate()
    expect(worker.caches.delete).toHaveBeenCalledWith("edge-portal-v1")
    expect(worker.claim).toHaveBeenCalledOnce()
  })
  it.each([
    ["/api/auth/session", {}],
    ["/api/v1/humans/me", {}],
    ["/portal", {}],
    ["/checkout/popup/flow", {}],
    ["/portal?_rsc=abc", {}],
    ["/_next/static/fake.js", { RSC: "1" }],
    ["/_next/static/fake.js", { "Next-Router-State-Tree": "fake" }],
    ["/_next/static/fake.js", { Accept: "text/html" }],
    ["/_next/static/fake.js", { Accept: "text/x-component" }],
    ["/arbitrary.js", {}],
    ["https://s3.example.com/upload", {}],
  ])("does not intercept private or non-allowlisted GET %s", async (url, headers) => {
    const worker = workerHarness()
    await worker.activate()
    const respondWith = vi.fn()
    worker.handlers.fetch({
      request: new Request(new URL(url, "https://demo.example.com"), {
        headers,
      }),
      respondWith,
    })
    expect(respondWith).not.toHaveBeenCalled()
    expect(worker.fetch).not.toHaveBeenCalled()
    expect(worker.put).not.toHaveBeenCalled()
  })
  it("caches explicit public static assets only", async () => {
    const worker = workerHarness()
    await worker.activate()
    let response: Promise<unknown> | undefined
    worker.handlers.fetch({
      request: new Request(
        "https://demo.example.com/_next/static/chunks/fake.js",
      ),
      respondWith: (promise: Promise<unknown>) => {
        response = promise
      },
    })
    await response
    await Promise.resolve()
    expect(worker.put).toHaveBeenCalledOnce()
  })
  it("honors private response headers even for allowlisted static paths", async () => {
    const worker = workerHarness()
    await worker.activate()
    worker.fetch.mockResolvedValue({
      ok: true,
      type: "basic",
      headers: new Headers({ "Cache-Control": "private, no-store" }),
      clone: () => "private",
    })
    let response: Promise<unknown> | undefined
    worker.handlers.fetch({
      request: new Request("https://demo.example.com/_next/static/fake.js"),
      respondWith: (promise: Promise<unknown>) => {
        response = promise
      },
    })
    await response
    expect(worker.put).not.toHaveBeenCalled()
  })
  it("acknowledges readiness only after retiring caches, including worker restarts", async () => {
    const worker = workerHarness()
    const postMessage = vi.fn(() =>
      expect(worker.keys.has("edge-portal-v1")).toBe(false),
    )
    let pending: Promise<unknown> | undefined
    worker.handlers.message({
      data: { type: "PORTAL_STATIC_CACHE_READY" },
      ports: [{ postMessage }],
      waitUntil: (promise: Promise<unknown>) => {
        pending = promise
      },
    })
    expect(postMessage).not.toHaveBeenCalled()
    await pending
    expect(postMessage).toHaveBeenCalledWith({
      type: "PORTAL_STATIC_CACHE_READY",
      version: 2,
    })
  })
})

describe("controlling-worker migration barrier", () => {
  it("does not require optional worker installation for a verified clean production browser", async () => {
    vi.stubEnv("NODE_ENV", "production")
    const workers = {
      controller: null,
      getRegistrations: vi.fn(async () => []),
      register: vi.fn(async () => {
        throw new Error("Fake installation failure")
      }),
    }
    vi.stubGlobal("navigator", { serviceWorker: workers })
    const fetchMock = vi.fn(async () => Response.json({ session: null }))
    vi.stubGlobal("fetch", fetchMock)
    await authRequest("session")
    expect(workers.getRegistrations).toHaveBeenCalled()
    expect(workers.register).not.toHaveBeenCalled()
    expect(fetchMock).toHaveBeenCalledOnce()
  })
  it.each([
    "active",
    "waiting",
    "installing",
  ])("does not mistake a null controller with an %s registration for a clean browser", async (state) => {
    vi.stubGlobal("navigator", {
      serviceWorker: {
        controller: null,
        getRegistrations: vi.fn(async () => [{ [state]: {} }]),
        register: vi.fn(async () => {
          throw new Error("Fake update failure")
        }),
      },
    })
    const fetchMock = vi.fn()
    vi.stubGlobal("fetch", fetchMock)
    await expect(
      authRequest("verify", { email: "fake@example.com", code: "123456" }),
    ).rejects.toThrow("Fake update failure")
    expect(fetchMock).not.toHaveBeenCalled()
  })
  it("does not assume worker absence when registration discovery fails", async () => {
    vi.stubGlobal("navigator", {
      serviceWorker: {
        controller: null,
        getRegistrations: vi.fn(async () => {
          throw new Error("Fake discovery failure")
        }),
      },
    })
    const fetchMock = vi.fn()
    vi.stubGlobal("fetch", fetchMock)
    await expect(authRequest("session")).rejects.toThrow(
      "Fake discovery failure",
    )
    expect(fetchMock).not.toHaveBeenCalled()
  })
  it("does not treat unregister as retirement; waits for an acknowledged new controller", async () => {
    vi.stubEnv("NODE_ENV", "production")
    const oldController = { postMessage: vi.fn() }
    const newController = {
      postMessage: vi.fn((_data, ports) =>
        ports[0].postMessage({ type: "PORTAL_STATIC_CACHE_READY", version: 2 }),
      ),
    }
    const workers = {
      controller: oldController,
      getRegistrations: vi.fn(async () => [{}]),
      register: vi.fn(async () => ({
        update: vi.fn(async () => {
          workers.controller = newController
        }),
      })),
    }
    vi.stubGlobal("navigator", { serviceWorker: workers })
    await ensureSafeServiceWorker()
    expect(oldController.postMessage).toHaveBeenCalled()
    expect(newController.postMessage).toHaveBeenCalled()
    expect(workers.register).toHaveBeenCalledWith("/sw.js", {
      scope: "/",
      updateViaCache: "none",
    })
  })
  it("fails closed when a safe controller cannot be established", async () => {
    vi.useFakeTimers()
    vi.stubEnv("NODE_ENV", "production")
    vi.stubGlobal("navigator", {
      serviceWorker: {
        controller: { postMessage: vi.fn() },
        getRegistrations: vi.fn(async () => [{}]),
        register: vi.fn(async () => ({ update: vi.fn(async () => {}) })),
      },
    })
    const pending = expect(ensureSafeServiceWorker()).rejects.toThrow(
      "Private cache retirement is not ready",
    )
    await vi.advanceTimersByTimeAsync(11_000)
    await pending
  })
})
