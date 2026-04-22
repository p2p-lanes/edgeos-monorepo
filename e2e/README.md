# E2E tests (Playwright)

End-to-end tests for the EdgeOS monorepo. Two runtime surfaces are covered:

- **Portal** (`tests/portal/`): runs on both `desktop` and `mobile` (iPhone 13)
  viewport projects. Tests must pass on both — this is how we guard
  responsiveness without brittle visual baselines.
- **Backoffice** (`tests/backoffice/`): runs on `desktop` only. The admin
  surface isn't mobile-optimized; running it under iPhone adds noise, not
  signal.

No visual regression / screenshot baselines are used. Assertions are
functional (`getByRole`, `toBeVisible`, `toBeInViewport`) so UI restyles
don't force snapshot updates. If a specific component ever needs visual
protection, snapshot that **locator**, never the full page.

## Running locally

### 1. Bring the docker stack up

```bash
# From the repo root:
docker compose up -d
```

This starts:

- `backend` on `:8000`
- `mailpit` on `:8025` (HTTP) / `:1025` (SMTP)
- `db` (postgres)
- `redis`

Playwright auto-starts the portal + backoffice dev servers on first run
(via the `webServer` config). If you already have them running, it
reuses them (`reuseExistingServer: true`).

### 2. Install Playwright browsers (once)

```bash
pnpm --filter e2e exec playwright install chromium --only-shell
```

We use Chromium with an iPhone 13 viewport for the mobile project
instead of real WebKit — saves a `sudo apt-get install …` step for
libevent / gstreamer that WebKit needs. If a Safari-specific bug ever
surfaces, switch the `portal-mobile` project back to
`...devices['iPhone 13']` and install WebKit's system deps.

### 3. Run tests

From the repo root, the full check runs everything in parallel:

```bash
pnpm check                            # backend + biome + tsc + e2e
pnpm check:e2e                        # just E2E
```

Or directly via the e2e workspace:

```bash
pnpm --filter e2e test                # all projects
pnpm --filter e2e test:portal         # portal-desktop + portal-mobile
pnpm --filter e2e test:backoffice     # backoffice-desktop
pnpm --filter e2e exec playwright test --project=portal-mobile
```

HTML report lands in `e2e/playwright-report/`:

```bash
pnpm --filter e2e report
```

## How auth works in tests

Email-code login goes through for real: the helper pings `/auth/*/login`,
reads the code Mailpit captured on `:8025`, and calls `/auth/*/authenticate`
to get a JWT. The JWT is then injected into `localStorage` via
`addInitScript` so the app boots already authenticated.

This means the backend sees a valid login each time — the only thing we
skip is the *UI* of code entry (otherwise every test would need a 6-digit
code typed into a form).

The superadmin email defaults to the `.env.example` value
(`admin@example.com`); override via `SUPERADMIN_EMAIL` if your `.env` is
different.

## Environment overrides

| Variable            | Default                       | Purpose                                    |
| ------------------- | ----------------------------- | ------------------------------------------ |
| `BACKEND_URL`       | `http://localhost:8000`       | Backend API for seeding + auth             |
| `E2E_PORTAL_URL`    | `http://demo.localhost:3000`  | Portal URL (must have tenant subdomain)    |
| `BACKOFFICE_URL`    | `http://localhost:5173`       | Backoffice dev server                      |
| `MAILPIT_URL`       | `http://localhost:8025`       | Mailpit HTTP API                           |
| `SUPERADMIN_EMAIL`  | `admin@example.com`           | Seeded superadmin (also read from `.env`)  |
| `DEMO_TENANT_SLUG`  | `demo`                        | Tenant seeded by `initial_data.py`         |

Why `E2E_PORTAL_URL` and not `PORTAL_URL`? The root `.env` uses
`PORTAL_URL=http://localhost:3000` for the backend's own email-link
generation — that must stay as the bare hostname. The portal itself
extracts the tenant slug from the leftmost subdomain label, so the
browser needs `<slug>.localhost:3000`. Most Linux/macOS resolve
`*.localhost` to loopback out of the box.

## Adding a new portal test

```ts
import { expect, test } from "@playwright/test"

test("my new flow", async ({ page, isMobile }) => {
  // Seed via helpers, then drive the UI. Conditional assertions only
  // when the behavior genuinely differs across viewports.
  await page.goto("/portal/.../something")
  await expect(page.getByRole("button", { name: /do it/i })).toBeVisible()
})
```

Playwright will run it twice — once per portal project — automatically.

## Current coverage

- ✅ `portal/rsvp.spec.ts` — human RSVPs to a published event, sees
  confirmation, cancels RSVP. Runs on desktop + mobile.
- ✅ `backoffice/recurring-event.spec.ts` — admin sees a seeded event in
  the events list (smoke).

Follow-ups:

- Portal: "admin creates venue with weekly hours + exception, scheduling
  an event that collides shows the 409 in the AvailabilityIndicator".
- Backoffice: full recurrence create-edit-cancel flow driven through the
  EventForm UI.
- Wire to CI (a separate workflow job with the full stack via
  `docker compose up --wait`).
