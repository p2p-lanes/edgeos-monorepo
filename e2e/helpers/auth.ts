/**
 * Portal sessions are imported through the same verified server endpoint used
 * by legacy migration. The browser receives only a host-only HttpOnly cookie.
 *
 * We still mint the token through the real API (``loginAsHuman``) so the
 * backend considers it valid — this only skips the *UI* of login, not
 * the backend flow.
 */
import type { BrowserContext, Page } from "@playwright/test"
import { PORTAL_URL } from "./env"

/**
 * Establish the cookie before the first navigation. No document init script
 * reintroduces credentials after logout.
 */
export async function loginInBrowser(
  target: BrowserContext | Page,
  token: string,
): Promise<void> {
  const context = "context" in target ? target.context() : target
  const response = await context.request.post(
    `${PORTAL_URL}/api/auth/migrate`,
    {
      headers: { Origin: new URL(PORTAL_URL).origin },
      data: { access_token: token },
    },
  )
  if (!response.ok())
    throw new Error(`Portal session setup failed (${response.status()})`)
}

/** Only tests specifically exercising the legacy import path should use this. */
export async function seedLegacyPortalSession(
  target: BrowserContext | Page,
  token: string,
): Promise<void> {
  await target.addInitScript(
    ({ token, origin }) => {
      try {
        if (
          window.location.origin !== origin ||
          localStorage.getItem("legacy-session-seeded")
        )
          return
        window.localStorage.setItem("token", token)
        localStorage.setItem("legacy-session-seeded", "true")
      } catch {
        // If localStorage isn't available yet we silently fail; the caller
        // will hit the real auth UI and the test will fail explicitly.
      }
    },
    { token, origin: new URL(PORTAL_URL).origin },
  )
}

/**
 * Backoffice counterpart of ``loginInBrowser``: backoffice reads
 * ``access_token`` (not ``token``) and needs a ``workspace_tenant_id``
 * so the WorkspaceContext resolves a tenant on boot. Optionally pins
 * the active popup via ``workspace_popup_id`` — otherwise the workspace
 * picker auto-selects the first popup it finds, which may not be the
 * one the test just seeded data into.
 */
export async function loginBackofficeInBrowser(
  target: BrowserContext | Page,
  token: string,
  tenantId: string,
  popupId?: string,
): Promise<void> {
  await target.addInitScript(
    ({ t, tid, pid }) => {
      try {
        window.localStorage.setItem("access_token", t)
        window.localStorage.setItem("workspace_tenant_id", tid)
        if (pid) window.localStorage.setItem("workspace_popup_id", pid)
      } catch {
        // Silent — real login UI will take over if this fails.
      }
    },
    { t: token, tid: tenantId, pid: popupId },
  )
}
