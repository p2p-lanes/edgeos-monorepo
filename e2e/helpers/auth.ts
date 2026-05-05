/**
 * Browser-side auth helpers: inject a JWT into localStorage before the
 * portal boots so ``useAuth()`` / ``useIsAuthenticated()`` see the user
 * as logged in without going through the code-entry UI.
 *
 * We still mint the token through the real API (``loginAsHuman``) so the
 * backend considers it valid — this only skips the *UI* of login, not
 * the backend flow.
 */
import type { BrowserContext, Page } from "@playwright/test"

/**
 * Seed localStorage with a human JWT before page scripts run. Must be
 * called on the BrowserContext (or Page) *before* the first ``goto``.
 */
export async function loginInBrowser(
  target: BrowserContext | Page,
  token: string,
): Promise<void> {
  await target.addInitScript((t) => {
    try {
      window.localStorage.setItem("token", t)
    } catch {
      // If localStorage isn't available yet we silently fail; the caller
      // will hit the real auth UI and the test will fail explicitly.
    }
  }, token)
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
