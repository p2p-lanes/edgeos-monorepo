import type { NextRequest } from "next/server"
import { proxy } from "./proxy"

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeRequest(url: string, host: string): NextRequest {
  const parsedUrl = new URL(url)
  const req = new Request(url, { headers: { host } })
  // NextRequest adds a nextUrl property that mirrors the parsed URL.
  Object.defineProperty(req, "nextUrl", { value: parsedUrl, writable: false })
  return req as unknown as NextRequest
}

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

vi.mock("./lib/tenant-resolution", () => ({
  resolveHostname: (host: string) => {
    if (host.startsWith("tickets.example.com")) {
      return { isCustomDomain: true, slug: null }
    }
    return { isCustomDomain: false, slug: "festival" }
  },
}))

const mockFetch = vi.fn()
vi.stubGlobal("fetch", mockFetch)

vi.mock("next/server", async (importOriginal) => {
  const actual = await importOriginal<typeof import("next/server")>()
  return {
    ...actual,
    NextResponse: {
      next: vi.fn((opts?: unknown) => ({ type: "next", opts })),
      rewrite: vi.fn((url: URL, opts?: unknown) => ({
        type: "rewrite",
        url,
        opts,
      })),
    },
  }
})

// ---------------------------------------------------------------------------
// Test setup
// ---------------------------------------------------------------------------

beforeEach(() => {
  mockFetch.mockReset()
})

// ---------------------------------------------------------------------------
// Scenario M-4: portal mode — no rewrite
// ---------------------------------------------------------------------------

describe("portal mode tenant", () => {
  beforeEach(() => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        id: "tenant-1",
        slug: "festival",
        landing_mode: "portal",
        active_popup_slug: null,
      }),
    })
  })

  it("M-4: does not rewrite root request in portal mode", async () => {
    const req = makeRequest(
      "https://tickets.example.com/",
      "tickets.example.com",
    )
    const result = (await proxy(req)) as unknown as { type: string }

    expect(result.type).toBe("next")
  })
})

// ---------------------------------------------------------------------------
// Scenario M-1 + M-2: checkout mode + active popup
// ---------------------------------------------------------------------------

describe("checkout mode with active popup", () => {
  beforeEach(() => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        id: "tenant-1",
        slug: "festival",
        landing_mode: "checkout",
        active_popup_slug: "summer-fest",
      }),
    })
  })

  it("M-1: rewrites / to /checkout/summer-fest", async () => {
    const req = makeRequest(
      "https://tickets.example.com/",
      "tickets.example.com",
    )
    const result = (await proxy(req)) as unknown as { type: string; url: URL }

    expect(result.type).toBe("rewrite")
    expect(result.url.pathname).toBe("/checkout/summer-fest")
  })

  it("M-2: rewrites /thank-you to /checkout/summer-fest/thank-you preserving query", async () => {
    const req = makeRequest(
      "https://tickets.example.com/thank-you?payment_id=42",
      "tickets.example.com",
    )
    const result = (await proxy(req)) as unknown as { type: string; url: URL }

    expect(result.type).toBe("rewrite")
    expect(result.url.pathname).toBe("/checkout/summer-fest/thank-you")
    expect(result.url.search).toBe("?payment_id=42")
  })

  it("passes through /checkout/* paths without double-rewriting", async () => {
    const req = makeRequest(
      "https://tickets.example.com/checkout/summer-fest",
      "tickets.example.com",
    )
    const result = (await proxy(req)) as unknown as { type: string }

    expect(result.type).toBe("next")
  })
})

// ---------------------------------------------------------------------------
// Scenario M-3: checkout mode + no active popup → /coming-soon
// ---------------------------------------------------------------------------

describe("checkout mode with no active popup", () => {
  beforeEach(() => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        id: "tenant-1",
        slug: "festival",
        landing_mode: "checkout",
        active_popup_slug: null,
      }),
    })
  })

  it("M-3: rewrites / to /coming-soon when no active popup", async () => {
    const req = makeRequest(
      "https://tickets.example.com/",
      "tickets.example.com",
    )
    const result = (await proxy(req)) as unknown as { type: string; url: URL }

    expect(result.type).toBe("rewrite")
    expect(result.url.pathname).toBe("/coming-soon")
  })

  it("passes through non-root paths in no-popup checkout mode", async () => {
    const req = makeRequest(
      "https://tickets.example.com/coming-soon",
      "tickets.example.com",
    )
    const result = (await proxy(req)) as unknown as { type: string }

    expect(result.type).toBe("next")
  })
})

// ---------------------------------------------------------------------------
// Scenario M-6: headers injected for all custom domain requests
// ---------------------------------------------------------------------------

describe("header injection", () => {
  it("M-6: injects x-landing-mode and x-active-popup-slug alongside existing headers", async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        id: "tenant-1",
        slug: "festival",
        landing_mode: "checkout",
        active_popup_slug: "summer-fest",
      }),
    })

    const req = makeRequest(
      "https://tickets.example.com/other-page",
      "tickets.example.com",
    )
    const result = (await proxy(req)) as unknown as {
      type: string
      opts: { request?: { headers: Headers } }
    }

    // /other-page is not a rewrite target — we get a next() response with headers
    expect(result.type).toBe("next")
    const h = result.opts?.request?.headers
    expect(h?.get("x-landing-mode")).toBe("checkout")
    expect(h?.get("x-active-popup-slug")).toBe("summer-fest")
    expect(h?.get("x-tenant-id")).toBe("tenant-1")
    expect(h?.get("x-tenant-slug")).toBe("festival")
  })
})

// ---------------------------------------------------------------------------
// Non-custom-domain: pass-through without API call
// ---------------------------------------------------------------------------

describe("non-custom-domain request", () => {
  it("returns next() immediately without calling the API", async () => {
    const req = makeRequest("https://festival.myapp.com/", "festival.myapp.com")
    await proxy(req)

    expect(mockFetch).not.toHaveBeenCalled()
  })
})
