/**
 * Shared Playwright fixtures.
 *
 * ``superadminToken`` is read from the file that ``global-setup.ts``
 * writes once per test run, so every worker shares a single JWT instead
 * of racing the SMTP rate limiter and the one-shot login code in the
 * Mailpit inbox. Cheap enough to re-read per test (it's a local file).
 */
import { readFileSync } from "node:fs"
import { test as base } from "@playwright/test"
import { SUPERADMIN_TOKEN_FILE } from "../scripts/global-setup"

type Fixtures = {
  superadminToken: string
}

export const test = base.extend<Fixtures>({
  superadminToken: async ({}, use) => {
    const token = readFileSync(SUPERADMIN_TOKEN_FILE, "utf-8").trim()
    await use(token)
  },
})

export { expect } from "@playwright/test"
