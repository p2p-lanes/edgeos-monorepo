/**
 * Playwright global setup.
 *
 * Runs once before any worker starts. Logs in as the superadmin and
 * writes the JWT to a temp file so every worker reads the same token
 * instead of racing the SMTP rate limiter and mail inbox (one shared
 * code can only be consumed once).
 */
import { mkdirSync, writeFileSync } from "node:fs"
import { dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { loginAsSuperadmin } from "../helpers/api"
import { clearMailpit } from "../helpers/mailpit"

export const SUPERADMIN_TOKEN_FILE = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../.auth/superadmin.token",
)

export default async function globalSetup(): Promise<void> {
  // Mailpit must be empty so the single login code is unambiguous.
  await clearMailpit()
  const token = await loginAsSuperadmin()
  mkdirSync(dirname(SUPERADMIN_TOKEN_FILE), { recursive: true })
  writeFileSync(SUPERADMIN_TOKEN_FILE, token, "utf-8")
}
