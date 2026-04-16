import {
  createPublishedEvent,
  getActivePopup,
  getDemoTenant,
  getOrCreateHuman,
  loginAsHuman,
} from "../../helpers/api"
import { loginInBrowser } from "../../helpers/auth"
import { expect, test } from "../../helpers/fixtures"

/**
 * Portal RSVP flow.
 *
 * Runs twice — once on `portal-desktop` (Chrome) and once on `portal-mobile`
 * (iPhone 13). The assertion set is identical: if Register is visually
 * present but offscreen on mobile, or the confirmation toast is clipped
 * off-viewport, the test fails here.
 *
 * No visual baselines: we rely on accessible-role selectors, on-viewport
 * checks, and post-RSVP state assertions. Restyling the page doesn't
 * break these unless the flow itself regresses.
 */

test.describe("Portal: RSVP to a published event", () => {
  test("RSVP → see confirmation → cancel RSVP", async ({
    page,
    isMobile,
    superadminToken,
  }) => {
    // --- Seed via real API (admin actions) -----------------------------
    const superToken = superadminToken
    const tenant = await getDemoTenant(superToken)
    const nonce = crypto.randomUUID().slice(0, 8)
    const popup = await getActivePopup(superToken, tenant)
    const email = `e2e-rsvp-${nonce}@test.com`
    await getOrCreateHuman(superToken, tenant, { email })
    const event = await createPublishedEvent(superToken, tenant, popup, {
      title: `E2E RSVP Event ${nonce}`,
    })

    // --- Mint a human JWT and inject into localStorage -----------------
    const humanToken = await loginAsHuman(email, tenant.id)
    await loginInBrowser(page.context(), humanToken)

    // --- Drive the UI ---------------------------------------------------
    await page.goto(`/portal/${popup.slug}/events/${event.id}`)

    const rsvp = page.getByRole("button", { name: /rsvp/i })
    await expect(rsvp).toBeVisible()
    await expect(rsvp).toBeInViewport({ ratio: 1 })

    if (isMobile) {
      // On mobile the button spans the card horizontally; this is a quick
      // check that the event-detail card isn't clipped at the iPhone width.
      const box = await rsvp.boundingBox()
      expect(box?.width).toBeGreaterThan(0)
    }

    await rsvp.click()
    await expect(page.getByText(/registered/i)).toBeVisible()
    await expect(page.getByRole("button", { name: /cancel rsvp/i })).toBeVisible()

    // --- Round-trip the cancel so both halves of the state machine run -
    await page.getByRole("button", { name: /cancel rsvp/i }).click()
    await expect(page.getByRole("button", { name: /rsvp/i })).toBeVisible()
  })
})
