import {
  createWithdrawnApplicationFixture,
  loginAsHuman,
} from "../../helpers/api"
import { loginInBrowser } from "../../helpers/auth"
import { expect, test } from "../../helpers/fixtures"

test("withdrawn application stays withdrawn on its home, direct form URL, and history", async ({
  page,
  superadminToken,
}) => {
  test.setTimeout(60_000)
  const { tenant, popup, application, email } =
    await createWithdrawnApplicationFixture(superadminToken)
  const token = await loginAsHuman(email, tenant.id)
  await loginInBrowser(page, token)
  await page.goto(`/portal/${popup.slug}`)
  await expect(
    page.getByText("Application withdrawn", { exact: true }),
  ).toBeVisible()
  await expect(
    page.getByRole("button", {
      name: /^(Apply|Resume Application|View application)$/,
    }),
  ).toHaveCount(0)
  await page.goto(
    `/portal/${popup.slug}/application?flow=${application.sales_flow_id}`,
  )
  await expect(page).toHaveURL(new RegExp(`/portal/${popup.slug}$`), {
    timeout: 30_000,
  })
  await expect(
    page.getByText("Application withdrawn", { exact: true }),
  ).toBeVisible()
  await page.goto("/portal/profile")
  await expect(
    page.getByRole("heading", { name: popup.name, exact: true }),
  ).toBeVisible()
  await expect(
    page.getByText("Application withdrawn", { exact: true }),
  ).toBeVisible()
  await expect(page.getByText("No events found", { exact: true })).toHaveCount(
    0,
  )
})
