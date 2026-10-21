import { createWithdrawnApplicationFixture } from "../../helpers/api"
import { loginBackofficeInBrowser } from "../../helpers/auth"
import { expect, test } from "../../helpers/fixtures"

test("withdrawn applications have a badge, can be filtered, and show the correct detail", async ({
  page,
  superadminToken,
}) => {
  test.setTimeout(60_000)
  const { tenant, popup, email } =
    await createWithdrawnApplicationFixture(superadminToken)
  await loginBackofficeInBrowser(page, superadminToken, tenant.id, popup.id)
  await page.goto("/applications")
  // Dismiss onboarding if this is the first visit to a fresh browser context.
  const skipTour = page.getByRole("button", { name: "Skip tour", exact: true })
  await skipTour
    .waitFor({ state: "visible", timeout: 3000 })
    .then(() => skipTour.click())
    .catch(() => {})
  await expect(
    page
      .getByRole("row")
      .filter({ hasText: email })
      .getByText("Withdrawn", { exact: true }),
  ).toBeVisible()
  await expect(
    page.getByRole("cell", { name: "Accepted E2E", exact: true }),
  ).toBeVisible()
  await page.getByRole("button", { name: "Filter", exact: true }).click()
  await page.getByRole("button", { name: "Add filter", exact: true }).click()
  await page.getByRole("combobox").filter({ hasText: "Value" }).click()
  await page.getByRole("option", { name: "Withdrawn", exact: true }).click()
  await page.getByRole("heading", { name: "Applications", exact: true }).click()
  await expect(
    page.getByRole("cell", { name: "Accepted E2E", exact: true }),
  ).toHaveCount(0)
  await page.getByRole("cell", { name: "Withdrawn E2E", exact: true }).click()
  await expect(
    page.getByRole("heading", { name: "Application Details", exact: true }),
  ).toBeVisible()
  await expect(page.getByText("Withdrawn", { exact: true })).toHaveCount(2)
  await expect(page.getByText("Accepted", { exact: true })).toHaveCount(0)
})
