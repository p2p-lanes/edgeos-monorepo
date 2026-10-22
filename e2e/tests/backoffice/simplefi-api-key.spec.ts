import { randomUUID } from "node:crypto"
import { getActivePopup, getDemoTenant } from "../../helpers/api"
import { loginBackofficeInBrowser } from "../../helpers/auth"
import { BACKEND_URL } from "../../helpers/env"
import { expect, test } from "../../helpers/fixtures"

const inputs = [
  ["Bearer mock-simplefi-token", "mock-simplefi-token"],
  ["mock-plain-token", "mock-plain-token"],
  ["  bEaReR   mock-mixed-case-token  ", "mock-mixed-case-token"],
  ["  mock-padded-token  ", "mock-padded-token"],
  ["BearerLikeToken", "BearerLikeToken"],
] as const

for (const target of ["popup", "flow"] as const) {
  test(`${target}: SimpleFi keys normalize when saved and persist after reload`, async ({
    page,
    request,
    superadminToken,
  }) => {
    test.setTimeout(90_000)
    const tenant = await getDemoTenant(superadminToken)
    const popup = await getActivePopup(superadminToken, tenant)
    const headers = {
      Authorization: `Bearer ${superadminToken}`,
      "X-Tenant-Id": tenant.id,
    }
    await loginBackofficeInBrowser(page, superadminToken, tenant.id, popup.id)
    const apiPath =
      target === "popup" ? "/api/v1/popups" : "/api/v1/sales-flows"
    const keyInput = () =>
      target === "popup"
        ? page.locator("#simplefi_api_key")
        : page.getByRole("textbox", { name: "SimpleFi API Key", exact: true })
    let id: string
    if (target === "popup") {
      await page.goto("/popups/new")
      const skipTour = page.getByRole("button", {
        name: "Skip tour",
        exact: true,
      })
      await skipTour
        .waitFor({ state: "visible", timeout: 3000 })
        .then(() => skipTour.click())
        .catch(() => {})
      await page
        .getByPlaceholder("Gathering Name")
        .fill(`SimpleFi E2E ${randomUUID()}`)
      await page.getByRole("tab", { name: "Commerce", exact: true }).click()
      await keyInput().fill("Bearer mock-created-token")
      const createdPromise = page.waitForResponse(
        (r) => r.url().endsWith(apiPath) && r.request().method() === "POST",
      )
      await page
        .getByRole("button", { name: "Create Event", exact: true })
        .click()
      const created = await createdPromise
      expect(created.ok()).toBeTruthy()
      expect(created.request().postDataJSON().simplefi_api_key).toBe(
        "mock-created-token",
      )
      id = (await created.json()).id
    } else {
      const created = await request.post(`${BACKEND_URL}${apiPath}`, {
        headers,
        data: {
          popup_id: popup.id,
          name: "SimpleFi E2E",
          slug: `simplefi-${randomUUID()}`,
          type: "application",
          simplefi_api_key: "mock-created-token",
        },
      })
      expect(created.ok()).toBeTruthy()
      id = (await created.json()).id
      await page.goto(`/sales-flows/${id}/edit`)
      const skipTour = page.getByRole("button", {
        name: "Skip tour",
        exact: true,
      })
      await skipTour
        .waitFor({ state: "visible", timeout: 3000 })
        .then(() => skipTour.click())
        .catch(() => {})
    }
    const resourcePath = `${apiPath}/${id}`
    const editPath =
      target === "popup" ? `/popups/${id}/edit` : `/sales-flows/${id}/edit`
    const readKey = async () => {
      const response = await request.get(`${BACKEND_URL}${resourcePath}`, {
        headers,
      })
      expect(response.ok()).toBeTruthy()
      return (await response.json()).simplefi_api_key
    }
    expect(await readKey()).toBe("mock-created-token")
    for (const [input, expected] of inputs) {
      await page.goto(editPath)
      if (target === "popup") {
        await page.getByRole("tab", { name: "Commerce", exact: true }).click()
      } else {
        await page.getByRole("button", { name: /^Payment Provider/ }).click()
      }
      await keyInput().fill(input)
      const savedPromise = page.waitForResponse(
        (r) =>
          r.url().endsWith(resourcePath) && r.request().method() === "PATCH",
      )
      await page
        .getByRole("button", { name: "Save Changes", exact: true })
        .click()
      const saved = await savedPromise
      expect(saved.ok()).toBeTruthy()
      expect(saved.request().postDataJSON().simplefi_api_key).toBe(expected)
      expect(await readKey()).toBe(expected)
      await page.reload()
      expect(await readKey()).toBe(expected)
    }
  })
}
