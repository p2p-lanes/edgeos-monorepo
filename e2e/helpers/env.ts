import { config as loadDotenv } from "dotenv"
import { resolve } from "node:path"
import { fileURLToPath } from "node:url"

// Pick up the root-level .env (SUPERADMIN, POSTGRES_*, etc.) so E2E
// matches the same credentials the running backend was booted with.
// `override: false` keeps explicit env-var overrides winning.
loadDotenv({
  path: resolve(fileURLToPath(import.meta.url), "../../../.env"),
  override: false,
})

/**
 * URLs for the dev stack. All defaults match `compose.override.yaml`.
 * Override via env vars if you run any service on a non-default port.
 */
export const BACKEND_URL = process.env.BACKEND_URL || "http://localhost:8000"
// Portal extracts the tenant slug from the leftmost subdomain label.
// Going directly to ``localhost:3000`` would land on "Site not available",
// so we default to ``<tenant>.localhost:3000`` (resolves to loopback on
// most Linux/macOS via systemd-resolved / nss).
//
// We deliberately use ``E2E_PORTAL_URL`` (not ``PORTAL_URL``) because the
// root ``.env`` uses ``PORTAL_URL`` for the backend's own email-link
// generation — that must stay as bare ``localhost:3000``.
export const PORTAL_URL =
  process.env.E2E_PORTAL_URL || "http://demo.localhost:3000"
export const BACKOFFICE_URL =
  process.env.BACKOFFICE_URL || "http://localhost:5173"

/** Mailpit HTTP API — used to retrieve login codes sent in dev. */
export const MAILPIT_URL = process.env.MAILPIT_URL || "http://localhost:8025"

/** Superadmin email — pulled from the root ``.env`` (``SUPERADMIN`` key),
 *  falls back to the ``.env.example`` value so CI without a local ``.env``
 *  still works. */
export const SUPERADMIN_EMAIL =
  process.env.SUPERADMIN_EMAIL ||
  process.env.SUPERADMIN ||
  "admin@example.com"

/** Demo tenant slug seeded by ``backend/app/core/seed_data.json``. */
export const DEMO_TENANT_SLUG = process.env.DEMO_TENANT_SLUG || "demo"
