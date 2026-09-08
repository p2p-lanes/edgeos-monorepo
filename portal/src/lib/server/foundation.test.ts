// @vitest-environment node
import { NextRequest } from "next/server"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { POST as login } from "@/app/api/auth/login/route"
import { POST as logout } from "@/app/api/auth/logout/route"
import { POST as migrate } from "@/app/api/auth/migrate/route"
import { GET as sessionGet } from "@/app/api/auth/session/route"
import { POST as verify } from "@/app/api/auth/verify/route"
import { GET as apiGet } from "@/app/api/v1/[...path]/route"
import { handlePortalApi } from "./api-handler"
import { allowedPortalPath } from "./api-policy"
import { backendFetch, backendOrigin } from "./backend"
import { readSession } from "./session"
import { resolveRequestTenant, trustedOrigin } from "./tenant"

const tenantId = "11111111-1111-4111-8111-111111111111"
const otherTenantId = "22222222-2222-4222-8222-222222222222"
const humanId = "33333333-3333-4333-8333-333333333333"
const tenant = {
  id: tenantId,
  slug: "demo",
  landing_mode: "portal" as const,
  active_popup_slug: null,
}
const session = {
  human: {
    id: humanId,
    tenant_id: tenantId,
    email: "fake@example.com",
    first_name: null,
    last_name: null,
    picture_url: null,
  },
  expires_at: new Date(Date.now() + 600_000).toISOString(),
}
const fetchMock = vi.fn()

function request(
  path: string,
  method = "POST",
  body?: unknown,
  headers: Record<string, string> = {},
) {
  return new NextRequest(`https://demo.example.com${path}`, {
    method,
    headers: {
      host: "demo.example.com",
      origin: "https://demo.example.com",
      "content-type": "application/json",
      ...headers,
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  })
}

beforeEach(() => {
  vi.stubEnv("AWS_EXECUTION_ENV", undefined)
  vi.stubEnv("PORTAL_BACKEND_URL", "http://backend.test:8000")
  vi.stubEnv("CUSTOM_DOMAINS_ENABLED", "false")
  vi.stubGlobal("fetch", fetchMock)
  fetchMock.mockReset()
  fetchMock.mockImplementation(async (url: URL) => {
    if (url.pathname.startsWith("/api/v1/tenants/public/"))
      return Response.json(tenant)
    if (url.pathname === "/api/v1/auth/human/session")
      return Response.json(session)
    if (url.pathname === "/api/v1/auth/human/authenticate")
      return Response.json({ access_token: "fake-verified-token" })
    return Response.json({ ok: true })
  })
})
afterEach(() => {
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
})

describe("host and fixed upstream authority", () => {
  it("uses runtime backend configuration, not compiled browser configuration", () => {
    vi.stubEnv("NEXT_PUBLIC_API_URL", "http://localhost:8000")
    expect(backendOrigin()).toBe("http://backend.test:8000")
  })
  it.each([
    "https://user:password@backend.test",
    "https://backend.test/path",
    "file:///tmp/backend",
  ])("rejects invalid configured origin %s", (origin) => {
    vi.stubEnv("PORTAL_BACKEND_URL", origin)
    expect(() => backendOrigin()).toThrow("server_configuration_unavailable")
  })
  it("ignores forwarded and internal tenant authority", async () => {
    const headers = new Headers({
      host: "demo.localhost:3000",
      "x-forwarded-host": "evil.example",
      "x-forwarded-proto": "https",
      "x-tenant-id": otherTenantId,
      origin: "https://evil.example",
    })
    expect(trustedOrigin(headers)).toBe("http://demo.localhost:3000")
    await resolveRequestTenant(headers)
    expect(fetchMock.mock.calls[0][0].pathname).toBe(
      "/api/v1/tenants/public/demo",
    )
    expect(fetchMock.mock.calls[0][1].headers).toBeUndefined()
  })
  it("resolves all hosts by domain in custom-domain mode", async () => {
    vi.stubEnv("CUSTOM_DOMAINS_ENABLED", "true")
    await resolveRequestTenant(new Headers({ host: "demo.example.com:444" }))
    expect(fetchMock.mock.calls[0][0].pathname).toBe(
      "/api/v1/tenants/public/by-domain/demo.example.com",
    )
  })
  it.each([
    "evil.example/path",
    "demo.example.com,evil.example",
    "user@demo.example.com",
    "demo.example.com%2f",
  ])("rejects ambiguous Host %s", async (host) => {
    await expect(resolveRequestTenant(new Headers({ host }))).rejects.toThrow(
      "invalid_host",
    )
    expect(fetchMock).not.toHaveBeenCalled()
  })
  it("rejects upstream redirects and uses bounded no-store fetches", async () => {
    fetchMock.mockResolvedValue(
      new Response(null, {
        status: 307,
        headers: { Location: "https://evil.example" },
      }),
    )
    await expect(backendFetch("/api/v1/humans/me")).rejects.toThrow(
      "upstream_redirect_rejected",
    )
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(fetchMock.mock.calls[0][1]).toMatchObject({
      cache: "no-store",
      credentials: "omit",
      redirect: "manual",
    })
    expect(fetchMock.mock.calls[0][1].signal).toBeInstanceOf(AbortSignal)
  })
})

describe("explicit session routes", () => {
  it.each([
    login,
    verify,
    migrate,
    logout,
  ])("rejects missing, null and foreign origins before I/O", async (handler) => {
    for (const origin of [
      "",
      "null",
      "https://evil.example",
      "http://demo.example.com",
    ]) {
      const req = request("/api/auth/test", "POST", {}, { origin })
      if (!origin) req.headers.delete("origin")
      expect((await handler(req)).status).toBe(403)
    }
    expect(fetchMock).not.toHaveBeenCalled()
  })
  it("login and resend retain backend validation and rate limiting without tenant injection", async () => {
    fetchMock
      .mockResolvedValueOnce(Response.json(tenant))
      .mockResolvedValueOnce(
        new Response(null, { status: 429, headers: { "Retry-After": "37" } }),
      )
    const response = await login(
      request("/api/auth/login", "POST", {
        email: "fake@example.com",
        tenant_id: otherTenantId,
      }),
    )
    expect(response.status).toBe(429)
    expect(response.headers.get("retry-after")).toBe("37")
    expect(await response.json()).toMatchObject({ retryable: true })
    expect(JSON.parse(fetchMock.mock.calls[1][1].body)).toEqual({
      email: "fake@example.com",
      tenant_id: tenantId,
    })
  })
  it("verify intercepts the bearer, validates it, and sets a host-only secure cookie", async () => {
    const response = await verify(
      request("/api/auth/verify", "POST", {
        email: "fake@example.com",
        code: "123456",
      }),
    )
    expect(response.status).toBe(200)
    const text = await response.text()
    expect(JSON.parse(text)).toEqual({ session })
    expect(text).not.toContain("fake-verified-token")
    expect(text).not.toContain("access_token")
    const cookie = response.headers.get("set-cookie")!
    expect(cookie).toContain("__Host-edge_session=fake-verified-token")
    for (const flag of [
      "HttpOnly",
      "Secure",
      "Path=/",
      "SameSite=lax",
      `Expires=${new Date(session.expires_at).toUTCString()}`,
    ])
      expect(cookie).toContain(flag)
    expect(cookie).not.toContain("Domain=")
    expect(cookie).not.toContain("Max-Age=")
    expect(response.headers.get("cache-control")).toContain("no-store")
  })
  it("migrates opaque legacy tokens without decoding or renewing their expiry", async () => {
    const response = await migrate(
      request("/api/auth/migrate", "POST", {
        access_token: "fake-legacy-token",
      }),
    )
    expect(response.status).toBe(200)
    expect(response.headers.get("set-cookie")).toContain(
      `Expires=${new Date(session.expires_at).toUTCString()}`,
    )
    expect(fetchMock.mock.calls[1][1].headers.Authorization).toBe(
      "Bearer fake-legacy-token",
    )
  })
  it("refuses a different valid cookie identity", async () => {
    fetchMock.mockImplementation(async (url: URL, init: RequestInit) => {
      if (url.pathname.includes("tenants")) return Response.json(tenant)
      const isExisting =
        new Headers(init.headers).get("authorization") ===
        "Bearer fake-existing-token"
      return Response.json(
        isExisting
          ? { ...session, human: { ...session.human, id: otherTenantId } }
          : session,
      )
    })
    const response = await migrate(
      request(
        "/api/auth/migrate",
        "POST",
        { access_token: "fake-import-token" },
        { cookie: "__Host-edge_session=fake-existing-token" },
      ),
    )
    expect(response.status).toBe(409)
    expect(response.headers.get("set-cookie")).toBeNull()
  })
  it("preserves an existing same-identity cookie and its expiration", async () => {
    const response = await migrate(
      request(
        "/api/auth/migrate",
        "POST",
        { access_token: "fake-import-token" },
        { cookie: "__Host-edge_session=fake-existing-token" },
      ),
    )
    expect(response.status).toBe(200)
    expect(response.headers.get("set-cookie")).toBeNull()
  })
  it.each([
    401, 403, 404, 429, 500, 503,
  ])("classifies verification status %i without clearing cookies", async (status) => {
    fetchMock
      .mockResolvedValueOnce(Response.json(tenant))
      .mockResolvedValueOnce(new Response(null, { status }))
    const response = await migrate(
      request("/api/auth/migrate", "POST", {
        access_token: "fake-import-token",
      }),
    )
    expect(response.status).toBe(status < 429 ? 401 : status)
    expect((await response.json()).retryable).toBe(status >= 429)
    expect(response.headers.get("set-cookie")).toBeNull()
  })
  it("does not overwrite an existing cookie during a validation outage", async () => {
    fetchMock
      .mockResolvedValueOnce(Response.json(tenant))
      .mockResolvedValueOnce(Response.json(session))
      .mockRejectedValueOnce(new Error("fake timeout"))
    const response = await migrate(
      request(
        "/api/auth/migrate",
        "POST",
        { access_token: "fake-import-token" },
        { cookie: "__Host-edge_session=fake-existing-token" },
      ),
    )
    expect(response.status).toBe(503)
    expect(response.headers.get("set-cookie")).toBeNull()
  })
  it.each([
    "wrong-tenant",
    "expired",
    "malformed",
  ])("rejects invalid verified metadata: %s", async (kind) => {
    const metadata =
      kind === "wrong-tenant"
        ? { ...session, human: { ...session.human, tenant_id: otherTenantId } }
        : kind === "expired"
          ? { ...session, expires_at: "2020-01-01T00:00:00Z" }
          : { access_token: "not-a-session" }
    fetchMock
      .mockResolvedValueOnce(Response.json(tenant))
      .mockResolvedValueOnce(Response.json(metadata))
    const response = await migrate(
      request("/api/auth/migrate", "POST", {
        access_token: "fake-import-token",
      }),
    )
    expect(response.status).toBe(kind === "malformed" ? 502 : 401)
    expect(response.headers.get("set-cookie")).toBeNull()
  })
  it("returns anonymous metadata with no bearer and ignores browser Authorization", async () => {
    const response = await sessionGet(
      request("/api/auth/session", "GET", undefined, {
        authorization: "Bearer fake-browser-token",
      }),
    )
    expect(await response.json()).toEqual({ session: null })
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })
  it("supports explicit loopback HTTP without weakening deployed cookies", async () => {
    const req = new NextRequest("http://demo.localhost:3000/api/auth/migrate", {
      method: "POST",
      headers: {
        host: "demo.localhost:3000",
        origin: "http://demo.localhost:3000",
        "content-type": "application/json",
      },
      body: JSON.stringify({ access_token: "fake-import-token" }),
    })
    const response = await migrate(req)
    expect(response.status).toBe(200)
    expect(response.headers.get("set-cookie")).toContain("edge_session_dev=")
    expect(response.headers.get("set-cookie")).not.toContain("Secure")
  })
  it("logout deletes with identical cookie semantics without requiring a healthy backend", async () => {
    const response = await logout(request("/api/auth/logout"))
    expect(response.status).toBe(200)
    expect(response.headers.get("set-cookie")).toContain(
      "__Host-edge_session=; Path=/; Expires=Thu, 01 Jan 1970",
    )
    expect(response.headers.get("set-cookie")).toContain("Max-Age=0")
    for (const flag of ["HttpOnly", "Secure", "SameSite=lax"])
      expect(response.headers.get("set-cookie")).toContain(flag)
    expect(fetchMock).not.toHaveBeenCalled()
  })
  it("isolates concurrent server session reads with no shared token state", async () => {
    fetchMock.mockImplementation(async (_url: URL, init: RequestInit) => {
      const id = new Headers(init.headers).get("x-tenant-id")!
      const token = new Headers(init.headers).get("authorization")
      await new Promise((resolve) =>
        setTimeout(resolve, id === tenantId ? 5 : 0),
      )
      return Response.json({
        ...session,
        human: {
          ...session.human,
          tenant_id: id,
          email: token === "Bearer fake-a" ? "a@example.com" : "b@example.com",
        },
      })
    })
    const [a, b] = await Promise.all([
      readSession(
        request("/", "GET", undefined, {
          cookie: "__Host-edge_session=fake-a",
        }),
        tenant,
      ),
      readSession(
        request("/", "GET", undefined, {
          cookie: "__Host-edge_session=fake-b",
        }),
        { ...tenant, id: otherTenantId },
      ),
    ])
    expect(a?.human).toMatchObject({
      tenant_id: tenantId,
      email: "a@example.com",
    })
    expect(b?.human).toMatchObject({
      tenant_id: otherTenantId,
      email: "b@example.com",
    })
  })
})

describe("bounded same-origin API adapter", () => {
  it("permits the current host's public tenant lookup but rejects foreign domains", async () => {
    const own = ["tenants", "public", "by-domain", "demo.example.com"]
    expect(
      (await handlePortalApi(request(`/api/v1/${own.join("/")}`, "GET"), own))
        .status,
    ).toBe(200)
    const foreign = ["tenants", "public", "by-domain", "evil.example.com"]
    expect(
      (
        await handlePortalApi(
          request(`/api/v1/${foreign.join("/")}`, "GET"),
          foreign,
        )
      ).status,
    ).toBe(404)
  })
  it.each([
    "auth/human/authenticate",
    "auth/user/login",
    "users",
    "tenants",
    "payments/webhook/simplefi",
    "humans",
    "events",
    "debug",
    "backoffice/api-keys",
    "checkout/a/b/runtime/extra",
  ])("denies unrelated route %s", async (path) => {
    const response = await handlePortalApi(
      request(`/api/v1/${path}`, "GET"),
      path.split("/"),
    )
    expect(response.status).toBe(404)
    expect(fetchMock).not.toHaveBeenCalled()
  })
  it.each([
    "..",
    ".",
    "%2f",
    "%252f",
    "a/b",
    "a\\b",
    "",
    "https://evil.example",
  ])("rejects noncanonical segment %s", (segment) => {
    expect(
      allowedPortalPath("GET", ["checkout", segment, "flow", "runtime"]),
    ).toBe(false)
  })
  it("denies encoded aliases even when route params are decoded", async () => {
    const response = await apiGet(request("/api/v1/humans/%6de", "GET"), {
      params: Promise.resolve({ path: ["humans", "me"] }),
    })
    expect(response.status).toBe(404)
  })
  it("forwards only approved headers and uses cookie/host authority", async () => {
    const req = request(
      "/api/v1/humans/me?tenant_id=foreign",
      "GET",
      undefined,
      {
        cookie:
          "__Host-edge_session=fake-cookie-token; other=fake-other-cookie",
        authorization: "Bearer fake-browser-token",
        "x-tenant-id": otherTenantId,
        referer: "https://evil.example",
        "x-forwarded-for": "1.2.3.4",
        "x-forwarded-host": "evil.example",
        "x-custom-domain": "true",
        "x-checkout-preview-token": "fake-preview",
        "accept-language": "en",
        accept: "application/json",
      },
    )
    const response = await handlePortalApi(req, ["humans", "me"])
    expect(response.status).toBe(200)
    const [url, init] = fetchMock.mock.calls[2]
    expect(url.origin).toBe("http://backend.test:8000")
    expect(url.searchParams.get("tenant_id")).toBe(tenantId)
    expect(Object.fromEntries(init.headers)).toEqual({
      authorization: "Bearer fake-cookie-token",
      "x-tenant-id": tenantId,
      "accept-language": "en",
      accept: "application/json",
      "content-type": "application/json",
    })
    expect(response.headers.get("cache-control")).toContain("no-store")
  })
  it("preserves scoped preview errors without clearing human auth", async () => {
    fetchMock
      .mockResolvedValueOnce(Response.json(tenant))
      .mockResolvedValueOnce(Response.json(session))
      .mockResolvedValueOnce(
        Response.json({ detail: "Invalid preview token" }, { status: 401 }),
      )
    const response = await handlePortalApi(
      request("/api/v1/checkout/popup/flow/runtime", "GET", undefined, {
        cookie: "__Host-edge_session=fake-cookie-token",
        "x-checkout-preview-token": "fake-preview",
      }),
      ["checkout", "popup", "flow", "runtime"],
    )
    expect(response.status).toBe(401)
    expect(response.headers.get("x-portal-response")).toBe("upstream")
    expect(response.headers.get("set-cookie")).toBeNull()
    expect(
      fetchMock.mock.calls[2][1].headers.get("x-checkout-preview-token"),
    ).toBe("fake-preview")
    expect(await response.json()).toEqual({ detail: "Invalid preview token" })
  })
  it("never forwards preview credentials to mutations", async () => {
    await handlePortalApi(
      request(
        "/api/v1/checkout/popup/flow/purchase",
        "POST",
        {},
        { "x-checkout-preview-token": "fake-preview" },
      ),
      ["checkout", "popup", "flow", "purchase"],
    )
    expect(
      fetchMock.mock.calls[1][1].headers.has("x-checkout-preview-token"),
    ).toBe(false)
  })
  it("preserves API-key creation secrets intentionally", async () => {
    fetchMock
      .mockResolvedValueOnce(Response.json(tenant))
      .mockResolvedValueOnce(Response.json(session))
      .mockResolvedValueOnce(
        Response.json({ key: "fake-new-api-key" }, { status: 201 }),
      )
    const response = await handlePortalApi(
      request(
        "/api/v1/api-keys",
        "POST",
        {},
        { cookie: "__Host-edge_session=fake-cookie-token" },
      ),
      ["api-keys"],
    )
    expect(response.status).toBe(201)
    expect(await response.json()).toEqual({ key: "fake-new-api-key" })
  })
  it("streams binary invoices with safe headers", async () => {
    fetchMock
      .mockResolvedValueOnce(Response.json(tenant))
      .mockResolvedValueOnce(
        new Response(new Uint8Array([0, 1, 255]), {
          headers: {
            "Content-Type": "application/pdf",
            "Content-Disposition": "attachment; filename=invoice.pdf",
            "Set-Cookie": "bad=value",
            "Access-Control-Allow-Origin": "*",
            "Cache-Control": "public",
          },
        }),
      )
    const response = await handlePortalApi(
      request("/api/v1/payments/my/fake-payment/invoice", "GET"),
      ["payments", "my", "fake-payment", "invoice"],
    )
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(
      new Uint8Array([0, 1, 255]),
    )
    expect(response.headers.get("content-type")).toBe("application/pdf")
    expect(response.headers.get("content-disposition")).toContain("invoice.pdf")
    expect(response.headers.get("set-cookie")).toBeNull()
    expect(response.headers.get("access-control-allow-origin")).toBeNull()
  })
  it("preserves 204 and enforces mutation CSRF", async () => {
    const path = ["api-keys", "fake-key"]
    expect(
      (
        await handlePortalApi(
          request("/api/v1/api-keys/fake-key", "DELETE", undefined, {
            origin: "null",
          }),
          path,
        )
      ).status,
    ).toBe(403)
    fetchMock
      .mockResolvedValueOnce(Response.json(tenant))
      .mockResolvedValueOnce(new Response(null, { status: 204 }))
    const response = await handlePortalApi(
      request("/api/v1/api-keys/fake-key", "DELETE"),
      path,
    )
    expect(response.status).toBe(204)
    expect(await response.text()).toBe("")
  })
})
