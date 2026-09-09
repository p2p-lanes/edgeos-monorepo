import assert from "node:assert/strict"
import { spawn } from "node:child_process"
import { once } from "node:events"
import http from "node:http"
import { fileURLToPath } from "node:url"

// This harness requires a prior Portal build. It starts an isolated production
// Next process and a fake backend on ephemeral loopback ports, never the dev API.
const tenant = {
  id: "11111111-1111-4111-8111-111111111111",
  slug: "demo",
  name: "SSR Tenant",
  custom_domain_active: false,
  landing_mode: "portal",
  active_popup_slug: null,
}
const session = {
  human: {
    id: "33333333-3333-4333-8333-333333333333",
    tenant_id: tenant.id,
    email: "fake@example.com",
    first_name: "SSR Buyer A",
    last_name: null,
    picture_url: null,
  },
  expires_at: new Date(Date.now() + 600_000).toISOString(),
}
const calls = []
const popup = {
  id: "44444444-4444-4444-8444-444444444444",
  slug: "gathering",
  name: "SSR Gathering",
  status: "active",
  takes_applications: true,
  currency: "USD",
  default_language: "en",
  supported_languages: ["en"],
  start_date: "2026-10-01",
  end_date: "2026-10-31",
  allows_coupons: false,
}
const flow = {
  id: "55555555-5555-4555-8555-555555555555",
  slug: "general",
  name: "SSR General",
  flow_type: "application",
}
const product = {
  id: "66666666-6666-4666-8666-666666666666",
  popup_id: popup.id,
  tenant_id: tenant.id,
  name: "SSR Admission Pass",
  category: "ticket",
  price: "25.00",
  is_active: true,
  duration_type: "full",
  compare_price: null,
  max_per_order: 1,
}
const runtime = {
  popup,
  selected_flow: flow,
  flow_type: "application",
  products: [product],
  buyer_form: [],
  attendee_categories: [],
  ticketing_steps: [
    {
      id: "77777777-7777-4777-8777-777777777777",
      sales_flow_id: flow.id,
      popup_id: popup.id,
      tenant_id: tenant.id,
      step_type: "tickets",
      title: "Choose SSR Admission",
      order: 0,
      is_enabled: true,
      product_category: "ticket",
      template: null,
      template_config: null,
    },
  ],
}
const secondSession = {
  ...session,
  human: {
    ...session.human,
    id: "88888888-8888-4888-8888-888888888888",
    email: "second@example.com",
    first_name: "SSR Buyer B",
  },
}
let sessionUnavailable = false
let tenantUnavailable = false
const backend = http.createServer((request, response) => {
  calls.push({ path: request.url, headers: request.headers })
  const currentSession =
    request.headers.authorization === "Bearer fake-runtime-token-b"
      ? secondSession
      : session
  response.setHeader("content-type", "application/json")
  if (request.url.startsWith("/api/v1/tenants/public/")) {
    if (tenantUnavailable) {
      response.statusCode = 503
      response.end(JSON.stringify({ detail: "Fake tenant outage" }))
      return
    }
    response.end(JSON.stringify(tenant))
  } else if (request.url === "/api/v1/auth/human/session") {
    if (sessionUnavailable) {
      response.statusCode = 503
      response.end(JSON.stringify({ detail: "Fake session read outage" }))
      return
    }
    response.end(JSON.stringify(currentSession))
  } else if (request.url === "/api/v1/auth/human/authenticate") {
    response.end(JSON.stringify({ access_token: "fake-runtime-token" }))
  } else if (request.url === "/api/v1/humans/me") {
    response.end(JSON.stringify(currentSession.human))
  } else if (request.url === "/api/v1/popups/portal/list") {
    response.end(JSON.stringify([popup]))
  } else if (request.url === "/api/v1/applications/my/applications") {
    response.end(
      JSON.stringify({
        results: [
          {
            id: "99999999-9999-4999-8999-999999999999",
            popup_id: popup.id,
            tenant_id: tenant.id,
            human_id: currentSession.human.id,
            status: "accepted",
            sales_flow_id: flow.id,
            attendees: [],
            credit: 0,
          },
        ],
      }),
    )
  } else if (
    request.url.startsWith("/api/v1/checkout/gathering/general/runtime")
  ) {
    response.end(JSON.stringify(runtime))
  } else if (request.url.endsWith("/access")) {
    response.end(
      JSON.stringify({
        allowed: true,
        source: "application",
        application_status: "accepted",
      }),
    )
  } else if (request.url.includes("/participation/")) {
    response.end(JSON.stringify({ type: "applicant" }))
  } else if (request.url.startsWith("/api/v1/attendees/my/popup/")) {
    response.end(
      JSON.stringify({
        results: [
          {
            id: currentSession.human.id,
            human_id: currentSession.human.id,
            popup_id: popup.id,
            tenant_id: tenant.id,
            name: currentSession.human.first_name,
            email: currentSession.human.email,
            category: "main",
            products: [],
            origin: "application",
          },
        ],
      }),
    )
  } else if (request.url.startsWith("/api/v1/products/portal/products")) {
    response.end(JSON.stringify({ results: [product] }))
  } else if (request.url.startsWith("/api/v1/carts/my/")) {
    response.end("null")
  } else if (
    request.url.startsWith("/api/v1/payments/my/") &&
    request.url.endsWith("/invoice")
  ) {
    response.setHeader("content-type", "application/pdf")
    response.setHeader(
      "content-disposition",
      "attachment; filename=invoice.pdf",
    )
    response.end(Buffer.from([0, 1, 255]))
  } else if (request.url.startsWith("/api/v1/payments/my/popup/")) {
    response.end(JSON.stringify({ results: [] }))
  } else {
    response.statusCode = 404
    response.end("{}")
  }
})
backend.listen(0, "127.0.0.1")
await once(backend, "listening")

const probe = http.createServer()
probe.listen(0, "127.0.0.1")
await once(probe, "listening")
const port = probe.address().port
await new Promise((resolve) => probe.close(resolve))
const child = spawn(
  process.execPath,
  [
    "node_modules/next/dist/bin/next",
    "start",
    "--hostname",
    "127.0.0.1",
    "--port",
    String(port),
  ],
  {
    cwd: fileURLToPath(new URL("../", import.meta.url)),
    env: {
      ...process.env,
      PORTAL_BACKEND_URL: `http://127.0.0.1:${backend.address().port}`,
      CUSTOM_DOMAINS_ENABLED: "false",
      // Exercise local production behavior even if the test runner is Fargate.
      NODE_ENV: "production",
      AWS_EXECUTION_ENV: undefined,
    },
    stdio: ["ignore", "ignore", "ignore"],
  },
)
const host = `demo.localhost:${port}`
const headers = {
  host,
  origin: `http://${host}`,
  "content-type": "application/json",
}

// Node 25 fetch replaces an explicit Host header with the connection host.
// Use HTTP directly to exercise tenant Host independently of loopback transport.
function call(path, init = {}) {
  return new Promise((resolve, reject) => {
    const request = http.request(
      {
        hostname: "127.0.0.1",
        port,
        path,
        method: init.method || "GET",
        headers: init.headers || headers,
        timeout: 5000,
      },
      (response) => {
        const chunks = []
        response.on("data", (chunk) => chunks.push(chunk))
        response.on("end", () =>
          resolve(
            new Response(
              response.statusCode === 204 ? null : Buffer.concat(chunks),
              {
                status: response.statusCode,
                headers: Object.fromEntries(
                  Object.entries(response.headers).map(([key, value]) => [
                    key,
                    Array.isArray(value) ? value.join(", ") : value,
                  ]),
                ),
              },
            ),
          ),
        )
      },
    )
    request.on("error", reject)
    request.on("timeout", () =>
      request.destroy(new Error("Isolated runtime request timed out")),
    )
    request.end(init.body)
  })
}

try {
  let ready = false
  for (let attempt = 0; attempt < 100; attempt++) {
    try {
      if ((await call("/api/auth/session")).status === 200) {
        ready = true
        break
      }
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
  assert.ok(
    ready,
    "The isolated production Next server must be ready; run pnpm --filter portal run build first",
  )
  let response = await call("/api/auth/verify", {
    method: "POST",
    body: JSON.stringify({ email: "fake@example.com", code: "123456" }),
  })
  assert.equal(response.status, 200)
  const cookie = response.headers.get("set-cookie")
  assert.ok(cookie.includes("HttpOnly"))
  assert.ok(cookie.startsWith("edge_session_dev="))
  const payload = await response.json()
  assert.deepEqual(payload, { session })
  assert.ok(!JSON.stringify(payload).includes("fake-runtime-token"))

  const bffStart = performance.now()
  const bffBefore = calls.length
  response = await call("/api/v1/humans/me", {
    headers: {
      ...headers,
      cookie: cookie.split(";")[0],
      authorization: "Bearer fake-spoof-token",
      "x-tenant-id": "forged",
      "x-forwarded-for": "1.2.3.4",
    },
  })
  assert.equal(response.status, 200)
  assert.equal((await response.json()).id, session.human.id)
  assert.equal(
    calls.length - bffBefore,
    3,
    "BFF retains host lookup + session introspection + resource fetch",
  )
  const bffMilliseconds = performance.now() - bffStart
  const upstream = calls.at(-1)
  assert.equal(upstream.headers.authorization, "Bearer fake-runtime-token")
  assert.equal(upstream.headers["x-tenant-id"], tenant.id)
  for (const name of ["x-forwarded-for", "origin", "cookie"])
    assert.equal(upstream.headers[name], undefined)

  response = await call("/api/auth/logout", {
    method: "POST",
    headers: { ...headers, origin: "https://evil.example" },
  })
  assert.equal(response.status, 403)
  assert.equal((await call("/api/v1/users")).status, 404)

  const before = calls.length
  response = await call("/sw.js")
  assert.equal(response.status, 200)
  assert.ok(response.headers.get("cache-control").includes("no-store"))
  assert.equal(calls.length, before)

  response = await call("/api/auth/migrate", {
    method: "POST",
    headers: {
      host: "demo.example.com",
      origin: "https://demo.example.com",
      "content-type": "application/json",
    },
    body: JSON.stringify({ access_token: "fake-runtime-token" }),
  })
  assert.equal(response.status, 200)
  assert.ok(
    response.headers.get("set-cookie").startsWith("__Host-edge_session="),
  )
  assert.ok(response.headers.get("set-cookie").includes("Secure"))
  const beforeSsr = calls.length
  response = await call("/portal/gathering/shop/general", {
    headers: { ...headers, cookie: cookie.split(";")[0] },
  })
  assert.equal(response.status, 200)
  const html = await response.text()
  assert.ok(response.headers.get("cache-control").includes("no-store"))
  const markup = html.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, "")
  // A lone attendee is labeled by category in the existing UI. Its actual card
  // identity, not a name hidden in hydration JSON, proves the data reached SSR.
  assert.ok(
    markup.includes(`id="attendee-card-${session.human.id}"`),
    "Authenticated attendee card must be present in initial HTML",
  )
  assert.ok(
    markup.includes("SSR Admission Pass"),
    "Application product must be in initial HTML before browser APIs",
  )
  assert.ok(
    !html.includes("fake-runtime-token"),
    "Bearer must never be serialized",
  )
  const ssrCalls = calls.slice(beforeSsr)
  assert.equal(
    ssrCalls.filter((item) => item.path === "/api/v1/auth/human/session")
      .length,
    1,
    "One session validation per SSR request",
  )
  assert.equal(
    ssrCalls.filter((item) => item.path.startsWith("/api/v1/tenants/public/"))
      .length,
    1,
    "One host resolution per SSR request",
  )
  const [responseA, responseB] = await Promise.all([
    call("/portal/gathering/shop/general", {
      headers: { ...headers, cookie: cookie.split(";")[0] },
    }),
    call("/portal/gathering/shop/general", {
      headers: { ...headers, cookie: "edge_session_dev=fake-runtime-token-b" },
    }),
  ])
  const [htmlA, htmlB] = await Promise.all([responseA.text(), responseB.text()])
  assert.ok(
    !htmlA.includes("SSR Buyer B") && !htmlB.includes("SSR Buyer A"),
    "Concurrent SSR must not cross user identities",
  )
  const beforeSpanish = calls.length
  const spanishHtml = await (
    await call("/portal/gathering/shop/general?lang=es", {
      headers: { ...headers, cookie: cookie.split(";")[0] },
    })
  ).text()
  const spanishRuntimeCalls = calls
    .slice(beforeSpanish)
    .filter(
      (item) => item.path === "/api/v1/checkout/gathering/general/runtime",
    )
  assert.equal(
    spanishRuntimeCalls.length,
    1,
    "Layout and page must share the same language/audience runtime key",
  )
  assert.equal(spanishRuntimeCalls[0].headers["accept-language"], "es")
  assert.ok(
    spanishHtml
      .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, "")
      .includes("Continuar"),
    "Initial checkout HTML uses the requested locale",
  )
  response = await call("/api/v1/payments/my/fake-payment/invoice", {
    headers: { ...headers, cookie: cookie.split(";")[0] },
  })
  assert.deepEqual(
    new Uint8Array(await response.arrayBuffer()),
    new Uint8Array([0, 1, 255]),
  )
  assert.equal(response.headers.get("content-type"), "application/pdf")
  response = await call("/api/auth/logout", { method: "POST" })
  assert.ok(response.headers.get("set-cookie").includes("Max-Age=0"))
  const anonymousHtml = await (
    await call("/portal/gathering/shop/general")
  ).text()
  assert.ok(
    !anonymousHtml.includes("SSR Buyer A") &&
      !anonymousHtml.includes("SSR Admission Pass"),
    "Logged-out navigation must not include private SSR data",
  )
  for (const staticHost of [
    "static.edgeos.world",
    "static-origin.edgeos.world",
  ]) {
    const count = calls.length
    assert.equal(
      (
        await call("/portal/gathering/shop/general", {
          headers: { ...headers, host: staticHost },
        })
      ).status,
      404,
    )
    assert.equal(
      (
        await call("/api/auth/session", {
          headers: { ...headers, host: staticHost },
        })
      ).status,
      404,
    )
    assert.equal(calls.length, count)
    assert.equal(
      (await call("/sw.js", { headers: { ...headers, host: staticHost } }))
        .status,
      200,
    )
  }
  sessionUnavailable = true
  const failedCheckEntry = await (
    await call("/auth", {
      headers: { ...headers, cookie: cookie.split(";")[0] },
    })
  ).text()
  const entryMarkup = failedCheckEntry.replace(
    /<script\b[^>]*>[\s\S]*?<\/script>/gi,
    "",
  )
  assert.ok(
    !entryMarkup.includes('role="alert"'),
    "An unavailable session read must not replace public sign-in entry with a global alert",
  )
  assert.ok(
    !entryMarkup.includes("SSR Buyer A"),
    "Failed verification must not expose private profile data",
  )
  const failedProtectedEntry = await (
    await call("/portal/gathering/shop/general", {
      headers: { ...headers, cookie: cookie.split(";")[0] },
    })
  ).text()
  assert.ok(
    !failedProtectedEntry.includes("SSR Admission Pass"),
    "An unverified server request must not render private checkout content",
  )
  sessionUnavailable = false
  tenantUnavailable = true
  const failedTenantEntry = await (await call("/auth")).text()
  assert.ok(
    failedTenantEntry.includes("Network error. Please check your connection."),
    "Missing tenant bootstrap needs honest connectivity recovery, not an invented tenant",
  )
  tenantUnavailable = false
  console.log(
    `PASS: isolated production Next authenticated checkout HTML, concurrent identity isolation, logout privacy, binary routes and static-host denial. Local fake-backend BFF sample: 3 upstream requests in ${bffMilliseconds.toFixed(1)} ms (not production latency).`,
  )
} finally {
  if (child.exitCode === null && child.signalCode === null) {
    child.kill("SIGTERM")
    await once(child, "exit")
  }
  await new Promise((resolve) => backend.close(resolve))
}
