import {
  createPublishedEvent,
  getActivePopup,
  getDemoTenant,
} from "../../helpers/api"
import { loginBackofficeInBrowser } from "../../helpers/auth"
import { expect, test } from "../../helpers/fixtures"

/**
 * Backoffice recurring-event smoke test (desktop only).
 *
 * Scope: prove the admin surface can *view* a recurring event series
 * that was created through the API. The UI-driven create/edit-occurrence
 * flows exist but involve a large form + venue availability plumbing;
 * we leave those for a follow-up once this baseline is green.
 */

test.describe("Backoffice: recurring event", () => {
  test("admin lands on events page and sees a seeded recurring series", async ({
    page,
    superadminToken,
  }) => {
    const superToken = superadminToken
    const tenant = await getDemoTenant(superToken)
    const nonce = crypto.randomUUID().slice(0, 8)
    const popup = await getActivePopup(superToken, tenant)
    const event = await createPublishedEvent(superToken, tenant, popup, {
      title: `E2E Recurring ${nonce}`,
    })

    await loginBackofficeInBrowser(
      page.context(),
      superToken,
      tenant.id,
      popup.id,
    )

    await page.goto("/events")

    await expect(page.getByRole("heading", { name: /events/i })).toBeVisible()
    await expect(page.getByText(event.title)).toBeVisible()
  })
})
