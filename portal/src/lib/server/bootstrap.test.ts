// @vitest-environment node
import { dehydrate } from "@tanstack/react-query"
import { afterEach, expect, it, vi } from "vitest"
import { createServerContext } from "./bootstrap"

const tenant = {
  id: "11111111-1111-4111-8111-111111111111",
  slug: "demo",
  landing_mode: "portal" as const,
}
const idA = "22222222-2222-4222-8222-222222222222"
const idB = "33333333-3333-4333-8333-333333333333"
afterEach(() => {
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
})

it("keeps verified tokens opaque and isolates concurrent SSR query caches", async () => {
  vi.stubEnv("PORTAL_BACKEND_URL", "http://backend.test")
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: URL, init: RequestInit) => {
      const id =
        new Headers(init.headers).get("authorization") === "Bearer fake-a"
          ? idA
          : idB
      if (url.pathname.endsWith("/session"))
        return Response.json({
          human: {
            id,
            tenant_id: tenant.id,
            email: `${id}@example.com`,
            first_name: null,
            last_name: null,
            picture_url: null,
          },
          expires_at: new Date(Date.now() + 60_000).toISOString(),
        })
      await new Promise((resolve) => setTimeout(resolve, id === idA ? 5 : 0))
      return Response.json({ id })
    }),
  )
  const makeRequest = (token: string) =>
    new Request("https://demo.example.com", {
      headers: {
        host: "demo.example.com",
        cookie: `__Host-edge_session=${token}`,
      },
    })
  const [a, b] = await Promise.all([
    createServerContext(makeRequest("fake-a"), tenant),
    createServerContext(makeRequest("fake-b"), tenant),
  ])
  await Promise.all([
    a.queryClient.prefetchQuery({
      queryKey: ["private"],
      queryFn: () => a.api("/api/v1/humans/me"),
    }),
    b.queryClient.prefetchQuery({
      queryKey: ["private"],
      queryFn: () => b.api("/api/v1/humans/me"),
    }),
  ])
  expect(a.queryClient.getQueryData(["private"])).toEqual({ id: idA })
  expect(b.queryClient.getQueryData(["private"])).toEqual({ id: idB })
  expect(
    JSON.stringify({ snapshot: a.snapshot, data: dehydrate(a.queryClient) }),
  ).not.toContain("fake-a")
  expect(JSON.stringify(a)).not.toContain("fake-a")
})

it.each([
  401, 429, 503,
])("does not classify %i as a valid session or silently downgrade an outage", async (status) => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response(null, { status })),
  )
  const context = await createServerContext(
    new Request("https://demo.example.com", {
      headers: {
        host: "demo.example.com",
        cookie: "__Host-edge_session=fake-token",
      },
    }),
    tenant,
  )
  expect(context.snapshot.session).toBeNull()
  expect(context.snapshot.status).toBe(
    status === 401 ? "unknown" : "unavailable",
  )
})
