# AGENTS.md

Guidance for AI coding agents working in this repo. Keep it short; package READMEs hold the details.

## Repo map
- `backend/`: FastAPI + SQLModel + Alembic (Python, `uv`). Final authority for auth, tenant isolation and business rules.
- `backoffice/`: organizer admin app (Vite + React + TanStack Router + React Query).
- `portal/`: attendee app (Next.js). Users call both apps "EdgeOS".
- `ai-service/`: "Ask EdgeOS" assistant (Hono + AI SDK). See `ai-service/README.md`.
- `packages/`: shared TS packages (`checkout-core`, `checkout-react`, `shared-events`, `shared-form-ui`).
- `e2e/`: Playwright tests. `scripts/`: repo tooling (client generation, tests).

Domain glossary: tenant = organization; popup = gathering; human = person at organization level;
application = request to join a gathering; attendee = participant; ticket = `attendee_products` row;
sales flow = one way into a gathering (apply / buy directly / add-on).

## Run locally
The official path is `docker compose watch` (see the root `README.md`, Quick Start).

If that fails (for example pnpm/corepack errors inside the containers), run infra in Docker and the apps natively:
- Infra: `docker compose up -d db redis mailpit minio minio-setup`
- Backend (from `backend/`):
  `POSTGRES_SERVER=localhost POSTGRES_PORT=5432 REDIS_URL=redis://localhost:6379 SMTP_HOST=localhost SMTP_PORT=1025 SMTP_TLS=False SMTP_SSL=False uv run fastapi dev app/main.py --port 8000`
- Migrations and seed (same env vars): `uv run alembic upgrade head`, `uv run python app/initial_data.py`
- Apps: `pnpm dev` (backoffice :5173), `pnpm dev:portal` (:3000), `pnpm dev:ai` (assistant :3002)

Notes:
- Login is passwordless: codes arrive in Mailpit (http://localhost:8025). Seeded users: `admin@example.com` (superadmin), `admin@demo.com` (admin).
- The portal resolves the tenant from the host: use http://demo.localhost:3000, not `localhost:3000`.

## Verify before handing off
- `pnpm check` runs every check; or one package: `pnpm check:backend`, `check:ai`, `check:backoffice`, `check:portal`, `check:e2e`.
- API changes: regenerate the clients with `scripts/generate-client.sh`. Never hand-edit `*.gen.ts`.
- Model changes need an Alembic migration.

## Conventions
- Branch from `dev`; PRs target `dev`, never `main`. Required CI must pass before merging.
- Branches: `type/short-slug`, same types as commits (`fix/portal-header-visibility`).
- Commits: `type(scope): summary` (`feat`, `fix`, `test`, `refactor`, `docs`…).
- Everything in the repo is in English: branch names, commits, PR titles and bodies, code and comments.
- Formatting and lint: Biome for TS (backoffice, portal, ai-service), Ruff for Python.
- Enforce permissions and business rules in the backend; UI gating is only cosmetic.
- Tenant scoping is mandatory in every query and endpoint.

## Keep in sync
- Backoffice UI changes (screens, labels, routes, sidebar) → update `ai-service/guides/`.
  `ai-service/src/guides.test.ts` fails on routes that no longer exist or sidebar items missing from `navigation.md`.
- New admin endpoints are discovered by the assistant automatically; workflows with their own rules deserve a skill in `ai-service/skills/`.

## Don't
- Commit `.env`, secrets or tokens, or log credentials and personal data.
- Bypass tenant or role checks, or "fix" a 403 by widening permissions.
- Merge to `main`, or land changes in `dev` without a PR.
