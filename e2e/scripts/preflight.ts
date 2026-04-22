#!/usr/bin/env node
/**
 * E2E preflight: verify the docker-compose stack is reachable before
 * Playwright spins up browsers. Fails fast with a clear message instead
 * of a cryptic fetch error deep inside a test.
 *
 * Backend + Mailpit must already be running. Frontend dev servers are
 * handled by Playwright's ``webServer`` config (auto-start if missing).
 */
import { BACKEND_URL, MAILPIT_URL } from "../helpers/env"

async function ping(url: string, label: string): Promise<string | null> {
  try {
    const resp = await fetch(url, {
      signal: AbortSignal.timeout(2_000),
    })
    return resp.ok ? null : `${label} at ${url} returned ${resp.status}`
  } catch (err) {
    return `${label} at ${url} unreachable (${(err as Error).message})`
  }
}

async function main(): Promise<void> {
  const problems = (
    await Promise.all([
      ping(`${BACKEND_URL}/health-check/`, "backend"),
      ping(`${MAILPIT_URL}/api/v1/info`, "mailpit"),
    ])
  ).filter((p): p is string => p !== null)

  if (problems.length === 0) return

  console.error("\n✗ E2E preflight failed:")
  for (const p of problems) console.error(`  - ${p}`)
  console.error(
    "\n  Start the dev stack first:\n    docker compose up -d\n",
  )
  process.exit(1)
}

void main()
