import assert from "node:assert/strict"
import { createHash } from "node:crypto"
import { createServer } from "node:http"
import { test } from "node:test"
import { createMockApp } from "./mock.mjs"

async function listen(server) {
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve))
  return `http://localhost:${server.address().port}`
}

test("mock binds state to the browser and exchanges with PKCE only once", async (t) => {
  const exchanges = []
  const revocations = []
  const refreshToken = `eos_rt_${"r".repeat(43)}`
  const claims = { issued_by_app_id: "test-app", scopes: ["portal:profile:read"] }
  const token = `header.${Buffer.from(JSON.stringify(claims)).toString("base64url")}.signature`
  const api = createServer(async (req, res) => {
    res.setHeader("Content-Type", "application/json")
    if (req.url.endsWith("/sso/exchange")) {
      const chunks = []
      for await (const chunk of req) chunks.push(chunk)
      exchanges.push(JSON.parse(Buffer.concat(chunks)))
      assert.equal(req.headers["x-third-party-api-key"], "test-key")
      res.end(JSON.stringify({ access_token: token, expires_in: 900, refresh_token: refreshToken }))
    } else if (req.url.endsWith("/revoke")) {
      const chunks = []
      for await (const chunk of req) chunks.push(chunk)
      revocations.push(JSON.parse(Buffer.concat(chunks)))
      assert.equal(req.headers["x-third-party-api-key"], "test-key")
      res.writeHead(204)
      res.end()
    } else {
      assert.equal(req.headers.authorization, `Bearer ${token}`)
      res.end(JSON.stringify({ id: "human-1", email: "ana@example.com" }))
    }
  })
  const apiUrl = await listen(api)
  const authorizeUrl = "http://demo.localhost:3000/portal/test/apps/test-app/authorize"
  const app = createMockApp({ apiUrl, authorizeUrl, callbackUrl: "http://localhost:4000/auth/callback", appKey: "test-key" })
  const base = await listen(app)
  t.after(() => { app.closeAllConnections(); app.close(); api.closeAllConnections(); api.close() })
  const start = await fetch(`${base}/auth/start?authorize_url=${encodeURIComponent(authorizeUrl)}`, { redirect: "manual" })
  assert.equal(start.status, 303)
  const cookie = start.headers.get("set-cookie").split(";")[0]
  assert.match(start.headers.get("set-cookie"), /HttpOnly; SameSite=Lax/)
  const authorization = new URL(start.headers.get("location"))
  const state = authorization.searchParams.get("state")
  const challenge = authorization.searchParams.get("code_challenge")
  const code = "c".repeat(43)
  const callback = `${base}/auth/callback?code=${code}&state=${state}`
  assert.equal((await fetch(callback, { redirect: "manual" })).status, 400)
  const mismatch = await fetch(`${base}/auth/callback?code=${code}&state=${"é".repeat(43)}`, { headers: { Cookie: cookie }, redirect: "manual" })
  assert.equal(mismatch.status, 400)
  assert.equal(exchanges.length, 0)
  const result = await fetch(callback, { headers: { Cookie: cookie }, redirect: "manual" })
  assert.equal(result.status, 303)
  assert.equal(result.headers.get("location"), "/auth/result")
  assert.equal(exchanges.length, 1)
  assert.equal(createHash("sha256").update(exchanges[0].code_verifier).digest("base64url"), challenge)
  const page = await fetch(`${base}/auth/result`, { headers: { Cookie: cookie } })
  const html = await page.text()
  assert.match(html, /ana@example.com/)
  assert.match(html, /portal:profile:read/)
  assert.ok(!html.includes(token))
  assert.ok(!html.includes(refreshToken))
  assert.deepEqual(revocations, [{ refresh_token: refreshToken }])
  assert.equal(page.headers.get("cache-control"), "no-store")
  assert.equal(page.headers.get("referrer-policy"), "no-referrer")
  assert.equal((await fetch(callback, { headers: { Cookie: cookie }, redirect: "manual" })).status, 400)
  assert.equal(exchanges.length, 1)
})

test("mock refuses an arbitrary authorization destination", async (t) => {
  const server = createMockApp({ apiUrl: "http://localhost:8000", authorizeUrl: "http://demo.localhost:3000/portal/test/apps/test/authorize", callbackUrl: "http://localhost:4000/auth/callback", appKey: "test-key" })
  const base = await listen(server)
  t.after(() => { server.closeAllConnections(); server.close() })
  const response = await fetch(`${base}/auth/start?authorize_url=https://evil.example`, { redirect: "manual" })
  assert.equal(response.status, 400)
})
