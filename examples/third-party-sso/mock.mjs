// Local-only partner: Node built-ins, no dependencies, no authentication framework.
import { randomBytes, createHash, timingSafeEqual } from "node:crypto"
import { createServer } from "node:http"
import { existsSync } from "node:fs"
import { fileURLToPath } from "node:url"

const random = () => randomBytes(32).toString("base64url")
const escape = (value) => String(value).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c])
const same = (a, b) => {
  if (typeof a !== "string") return false
  const left = Buffer.from(a), right = Buffer.from(b)
  return left.length === right.length && timingSafeEqual(left, right)
}

export function createMockApp(config) {
  for (const value of [config.apiUrl, config.authorizeUrl, config.callbackUrl]) {
    const host = new URL(value).hostname
    if (host !== "localhost" && host !== "127.0.0.1" && !host.endsWith(".localhost")) throw new Error("This example only accepts local URLs")
  }
  if (!config.appKey) throw new Error("Missing APP_KEY")
  const sessions = new Map()
  const server = createServer(async (req, res) => {
    res.setHeader("Cache-Control", "no-store")
    res.setHeader("Referrer-Policy", "no-referrer")
    res.setHeader("X-Content-Type-Options", "nosniff")
    res.setHeader("Content-Security-Policy", "default-src 'none'; style-src 'unsafe-inline'; frame-ancestors 'none'; base-uri 'none'")
    const redirect = (url) => { res.writeHead(303, { Location: url }); res.end() }
    const page = (status, title, text) => {
      res.writeHead(status, { "Content-Type": "text/html; charset=utf-8" })
      res.end(`<!doctype html><html lang="es"><meta name="viewport" content="width=device-width"><title>${escape(title)}</title><style>body{font:16px/1.6 system-ui;max-width:680px;margin:60px auto;padding:0 24px;color:#183453}pre{padding:18px;background:#edf3ff;white-space:pre-wrap;overflow-wrap:anywhere}a{color:#285bc5}</style><h1>${escape(title)}</h1>${text}</html>`)
    }
    try {
      const url = new URL(req.url, config.callbackUrl)
      for (const [id, session] of sessions) if (session.expires <= Date.now()) sessions.delete(id)
      const sid = req.headers.cookie?.split(";").map((c) => c.trim()).find((c) => c.startsWith("edgeos_mock_sid="))?.slice("edgeos_mock_sid=".length)
      const session = sessions.get(sid)
      if (req.method !== "GET") return page(405, "Método no permitido", "")
      if (url.pathname === "/auth/start") {
        // Never follow an arbitrary return URL supplied by a browser.
        if (url.searchParams.get("authorize_url") !== config.authorizeUrl) return page(400, "Destino inválido", "<p>La URL de autorización no coincide con la configuración del mock.</p>")
        const id = random()
        const state = random()
        const verifier = random()
        sessions.set(id, { state, verifier, expires: Date.now() + 300_000 })
        res.setHeader("Set-Cookie", `edgeos_mock_sid=${id}; HttpOnly; SameSite=Lax; Path=/auth; Max-Age=300`)
        const target = new URL(config.authorizeUrl)
        target.searchParams.set("state", state)
        target.searchParams.set("code_challenge", createHash("sha256").update(verifier).digest("base64url"))
        target.searchParams.set("code_challenge_method", "S256")
        return redirect(target.toString())
      }
      if (url.pathname === "/auth/callback") {
        if (!session || session.used || !same(url.searchParams.get("state"), session.state)) return page(400, "State inválido", "<p>Este regreso no pertenece a una transacción pendiente de este navegador.</p>")
        const code = url.searchParams.get("code")
        if (!code || !/^[A-Za-z0-9_-]{43}$/.test(code)) return page(400, "Código inválido", "")
        session.used = true // A callback cannot race itself, even before the API responds.
        const response = await fetch(`${config.apiUrl}/api/v1/auth/human/third-party/sso/exchange`, {
          method: "POST", headers: { "Content-Type": "application/json", "X-Third-Party-Api-Key": config.appKey },
          body: JSON.stringify({ code, redirect_uri: config.callbackUrl, code_verifier: session.verifier }),
          redirect: "error", signal: AbortSignal.timeout(10_000),
        })
        if (!response.ok) return page(400, "Intercambio rechazado", `<p>EdgeOS respondió HTTP ${response.status}. Volvé a iniciar desde la home.</p>`)
        const token = await response.json()
        // Validate identity by using the actual API, not by trusting decoded JWT claims.
        let profile
        try {
          const me = await fetch(`${config.apiUrl}/api/v1/humans/me`, { headers: { Authorization: `Bearer ${token.access_token}` }, redirect: "error", signal: AbortSignal.timeout(10_000) })
          if (!me.ok) return page(400, "Token sin acceso al perfil", `<p>/humans/me respondió HTTP ${me.status}.</p>`)
          profile = await me.json()
        } finally {
          // Identity-only example: revoke instead of retaining an unused grant.
          // Apps making later API calls must securely store and rotate the pair.
          const revoked = await fetch(`${config.apiUrl}/api/v1/auth/human/third-party/revoke`, {
            method: "POST", headers: { "Content-Type": "application/json", "X-Third-Party-Api-Key": config.appKey },
            body: JSON.stringify({ refresh_token: token.refresh_token }),
            redirect: "error", signal: AbortSignal.timeout(10_000),
          })
          if (!revoked.ok) throw new Error("Grant revocation failed")
        }
        const claims = JSON.parse(Buffer.from(token.access_token.split(".")[1], "base64url"))
        session.result = { email: profile.email, human_id: profile.id, issued_by_app_id: claims.issued_by_app_id, scopes: claims.scopes, expires_in: token.expires_in, grant_revoked: true, profile_request: "GET /humans/me → 200" }
        delete session.verifier
        delete session.state
        return redirect("/auth/result") // Remove code/state from the current URL.
      }
      if (url.pathname === "/auth/result" && session?.result) return page(200, "Conectado con EdgeOS", `<p>Token canjeado y perfil obtenido desde la API, sin un segundo OTP.</p><pre>${escape(JSON.stringify(session.result, null, 2))}</pre><p>Mock local: no muestra ni guarda el access token en el navegador.</p>`)
      return page(200, "Third-party app mock", "<p>Iniciá el acceso desde el botón de la custom home de la popup.</p>")
    } catch {
      // Never print transaction URLs, codes, credentials or access/refresh tokens.
      return page(502, "No se pudo completar el flujo", "<p>Revisá que el backend esté disponible y volvé a iniciar desde la home.</p>")
    }
  })
  return server
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const envFile = fileURLToPath(new URL(".env.local", import.meta.url))
  if (existsSync(envFile)) process.loadEnvFile(envFile)
  const port = Number(process.env.MOCK_PORT ?? 4000)
  createMockApp({ apiUrl: process.env.BACKEND_URL ?? "http://localhost:8000", authorizeUrl: process.env.AUTHORIZE_URL, callbackUrl: process.env.CALLBACK_URL ?? `http://localhost:${port}/auth/callback`, appKey: process.env.APP_KEY }).listen(port, "127.0.0.1", () => console.log(`Mock ready: http://localhost:${port}`))
}
