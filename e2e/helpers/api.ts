/**
 * Thin wrappers around the backend HTTP API used to seed + tear down the
 * data each E2E test needs. Keeps the spec files focused on UI assertions.
 *
 * Everything goes through the real API — no direct DB writes. That means
 * the E2E exercise the same code paths the app does, and nothing here
 * breaks when the DB schema evolves as long as the API contract holds.
 */
import { BACKEND_URL, DEMO_TENANT_SLUG, SUPERADMIN_EMAIL } from "./env"
import { waitForLoginCode } from "./mailpit"

type Json = Record<string, unknown>

class ApiError extends Error {
  constructor(
    public status: number,
    public path: string,
    public body: string,
  ) {
    super(`API ${path} → ${status}: ${body}`)
  }
}

async function request<T>(
  path: string,
  {
    method = "GET",
    headers = {},
    body,
  }: { method?: string; headers?: Record<string, string>; body?: Json } = {},
): Promise<T> {
  const resp = await fetch(`${BACKEND_URL}${path}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      ...headers,
    },
    body: body ? JSON.stringify(body) : undefined,
  })
  const text = await resp.text()
  if (!resp.ok) throw new ApiError(resp.status, path, text)
  return (text ? JSON.parse(text) : null) as T
}

// ---------------------------------------------------------------------------
// Auth
// ---------------------------------------------------------------------------

/**
 * Obtain a superadmin token by running the real email-code login flow and
 * pulling the code out of Mailpit. Uses the seeded superadmin from
 * ``settings.SUPERADMIN``.
 */
export async function loginAsSuperadmin(): Promise<string> {
  await request<Json>("/api/v1/auth/user/login", {
    method: "POST",
    body: { email: SUPERADMIN_EMAIL },
  })
  const code = await waitForLoginCode(SUPERADMIN_EMAIL)
  const { access_token } = await request<{ access_token: string }>(
    "/api/v1/auth/user/authenticate",
    { method: "POST", body: { email: SUPERADMIN_EMAIL, code } },
  )
  return access_token
}

/**
 * Same flow but for humans: hits ``/auth/human/login`` then authenticates.
 * If the human doesn't exist yet, the backend will create a pending record
 * and promote it on verify — either way we end up with a usable JWT.
 */
export async function loginAsHuman(
  email: string,
  tenantId: string,
): Promise<string> {
  await request<Json>("/api/v1/auth/human/login", {
    method: "POST",
    body: { email, tenant_id: tenantId },
  })
  const code = await waitForLoginCode(email)
  const { access_token } = await request<{ access_token: string }>(
    "/api/v1/auth/human/authenticate",
    {
      method: "POST",
      body: { email, tenant_id: tenantId, code },
    },
  )
  return access_token
}

// ---------------------------------------------------------------------------
// Superadmin lookups / seeds
// ---------------------------------------------------------------------------

export type Tenant = { id: string; slug: string; name: string }
export type Popup = { id: string; slug: string; name: string; tenant_id: string }
export type Human = { id: string; email: string; tenant_id: string }
export type EdgeEvent = {
  id: string
  title: string
  start_time: string
  end_time: string
  popup_id: string
  status: string
}

function bearer(token: string): Record<string, string> {
  return { Authorization: `Bearer ${token}` }
}

function tenantHeader(token: string, tenantId: string): Record<string, string> {
  return { ...bearer(token), "X-Tenant-Id": tenantId }
}

export async function getDemoTenant(superToken: string): Promise<Tenant> {
  const list = await request<{ results: Tenant[] }>("/api/v1/tenants", {
    headers: bearer(superToken),
  })
  const tenant = list.results.find((t) => t.slug === DEMO_TENANT_SLUG)
  if (!tenant) {
    throw new Error(
      `Demo tenant '${DEMO_TENANT_SLUG}' not found — did prestart seeds run?`,
    )
  }
  return tenant
}

/**
 * Return the first *active* popup for the tenant. E2E pin themselves to
 * the seed-data popup (``Tech Summit 2025`` by default) instead of
 * creating a fresh one per run — new popups default to ``draft`` and the
 * portal's slug router refuses to serve them, and the backoffice picker
 * would need manual switching anyway.
 *
 * Creating popups from tests would also pollute the tenant across runs.
 */
export async function getActivePopup(
  superToken: string,
  tenant: Tenant,
): Promise<Popup> {
  type PopupWithStatus = Popup & { status: string }
  const list = await request<{ results: PopupWithStatus[] }>(
    "/api/v1/popups",
    { headers: tenantHeader(superToken, tenant.id) },
  )
  const active = list.results.find((p) => p.status === "active")
  if (!active) {
    throw new Error(
      `No active popup found for tenant ${tenant.slug}. Seed one via the backoffice or ensure seed_data.json includes an active popup.`,
    )
  }
  return active
}

export async function getOrCreateHuman(
  superToken: string,
  tenant: Tenant,
  { email }: { email: string },
): Promise<Human> {
  try {
    return await request<Human>("/api/v1/humans", {
      method: "POST",
      headers: tenantHeader(superToken, tenant.id),
      body: { email },
    })
  } catch (err) {
    if (err instanceof ApiError && err.status === 409) {
      // Already exists — fetch it.
      const list = await request<{ results: Human[] }>(
        `/api/v1/humans?tenant_id=${tenant.id}&search=${encodeURIComponent(email)}`,
        { headers: tenantHeader(superToken, tenant.id) },
      )
      const existing = list.results.find((h) => h.email === email.toLowerCase())
      if (existing) return existing
    }
    throw err
  }
}

export async function createPublishedEvent(
  superToken: string,
  tenant: Tenant,
  popup: Popup,
  overrides: Partial<EdgeEvent> = {},
): Promise<EdgeEvent> {
  const start = new Date(Date.now() + 7 * 24 * 3_600_000)
  const end = new Date(start.getTime() + 3_600_000)
  return request<EdgeEvent>("/api/v1/events", {
    method: "POST",
    headers: tenantHeader(superToken, tenant.id),
    body: {
      popup_id: popup.id,
      title: overrides.title ?? `E2E Event ${Date.now()}`,
      start_time: start.toISOString(),
      end_time: end.toISOString(),
      timezone: "UTC",
      visibility: "public",
      status: "published",
    },
  })
}
