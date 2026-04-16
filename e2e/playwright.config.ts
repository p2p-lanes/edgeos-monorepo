import { defineConfig, devices } from "@playwright/test"

/**
 * Playwright config for the EdgeOS monorepo.
 *
 * Projects:
 * - `portal-desktop` / `portal-mobile`: portal flows run on both viewports.
 *   Mobile uses iPhone 13 (viewport + userAgent + isMobile/hasTouch).
 * - `backoffice-desktop`: admin flows only on desktop. The backoffice is not
 *   mobile-optimized, so there's no value in running it under iPhone.
 *
 * Running these requires the dev stack up (`docker compose up`) — see
 * `e2e/README.md`. No visual baselines are used; assertions are all
 * functional so UI restyling doesn't churn snapshots.
 */
export default defineConfig({
  testDir: "./tests",
  globalSetup: "./scripts/global-setup.ts",
  timeout: 30_000,
  expect: { timeout: 5_000 },
  // Serial execution. Parallel workers race for the shared Mailpit
  // inbox and the single-tenant seed data (popup list, venue list…).
  // E2E is a handful of tests — the parallelism isn't worth the
  // flakiness. If we grow to 30+ tests, revisit per-worker Mailpit
  // namespacing or switch to playwright-test's test.parallel().
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  // `list` is a compact CLI reporter; `html` lands in playwright-report/.
  reporter: process.env.CI ? "github" : [["list"], ["html", { open: "never" }]],
  use: {
    trace: "retain-on-failure",
    video: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [
    {
      name: "portal-desktop",
      testMatch: /portal\/.*\.spec\.ts$/,
      use: {
        ...devices["Desktop Chrome"],
        baseURL: process.env.E2E_PORTAL_URL || "http://demo.localhost:3000",
      },
    },
    {
      name: "portal-mobile",
      testMatch: /portal\/.*\.spec\.ts$/,
      use: {
        // Use Chromium with iPhone 13 viewport/userAgent instead of the
        // default (WebKit). We still get layout/touch coverage without
        // pulling in the system libs WebKit needs (libevent, gstreamer —
        // install-deps requires sudo). Trade-off: no Safari-specific
        // rendering quirks. If a bug appears that only reproduces on
        // Safari, switch this project back to ``...devices['iPhone 13']``.
        ...devices["Desktop Chrome"],
        viewport: devices["iPhone 13"].viewport,
        userAgent: devices["iPhone 13"].userAgent,
        hasTouch: true,
        isMobile: true,
        deviceScaleFactor: devices["iPhone 13"].deviceScaleFactor,
        baseURL: process.env.E2E_PORTAL_URL || "http://demo.localhost:3000",
      },
    },
    {
      name: "backoffice-desktop",
      testMatch: /backoffice\/.*\.spec\.ts$/,
      use: {
        ...devices["Desktop Chrome"],
        baseURL: process.env.BACKOFFICE_URL || "http://localhost:5173",
      },
    },
  ],
  // Auto-start frontend dev servers if they aren't already running. The
  // docker stack (backend, mailpit, db, redis) is *not* managed here —
  // it's slower to boot and we don't want to tear it down between runs.
  // The preflight script fails fast with a clear message if it's down.
  webServer: [
    {
      command: "pnpm --filter portal dev",
      url: process.env.E2E_PORTAL_URL || "http://demo.localhost:3000",
      reuseExistingServer: true,
      timeout: 120_000,
      stdout: "ignore",
      stderr: "pipe",
    },
    {
      command: "pnpm --filter backoffice dev",
      url: process.env.BACKOFFICE_URL || "http://localhost:5173",
      reuseExistingServer: true,
      timeout: 60_000,
      stdout: "ignore",
      stderr: "pipe",
    },
  ],
})
