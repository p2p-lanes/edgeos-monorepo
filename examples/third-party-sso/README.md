# Third-party SSO: local example

Minimal partner app: **Node built-ins only**, no packages, frontend build, database or login framework. It prepares state/PKCE, exchanges the code server-side, calls the real `/humans/me`, and displays the result without exposing the token.

## Choose a document

- **Implement a partner integration:** [SSO integration guide](INTEGRATION.md). Self-contained English contract, configuration inputs, request/response examples, credential boundaries, failure handling and a coding-agent checklist.
- **Run the local demo:** continue with this quickstart.
- **Read the reference implementation:** [mock.mjs](mock.mjs). Local protocol demonstration, not production session infrastructure.

## Start the local stack

From the repository root, with ports 5432, 1025, 8025, 8000, 3000, 5173 and 4000 free:

```bash
docker compose -p edgeos-sso -f examples/third-party-sso/compose.yaml up -d --wait

set -a
source examples/third-party-sso/env.example
set +a

(cd backend && uv run alembic upgrade head && uv run python -m app.initial_data)
(cd backend && uv run python ../examples/third-party-sso/seed.py)
```

The compose file uses an **isolated `edgeos_sso` database/volume**, not the root compose stack or its `.env`. The seed refuses to run against a remote database, production, or any database other than local `edgeos_sso`.

Start these processes in separate terminals from the repository root. Source the example environment in each terminal as above (especially for the backend):

```bash
# Backend
(cd backend && uv run uvicorn app.main:application --host 127.0.0.1 --port 8000)

# Portal
NEXT_PUBLIC_API_URL=http://localhost:8000 pnpm --dir portal dev

# Backoffice
VITE_API_URL=http://localhost:8000 VITE_PORTAL_DOMAIN=localhost:3000 pnpm --dir backoffice dev

# Partner app (Node 22+)
node examples/third-party-sso/mock.mjs
```

## Try it

1. Open **http://demo.localhost:3000/portal/sso-test**.
2. Log in as **sso@example.com**. Read the initial OTP at **http://localhost:8025**. This user intentionally has no accepted application.
3. Click the partner link inside the custom-home iframe (the seeded demo labels it **Abrir app mock**).
4. The mock prepares state and PKCE, returns through the authenticated portal, and exchanges the code using its private key.
5. You arrive at **http://localhost:4000/auth/result**. It shows `sso@example.com`, app ID, `portal:profile:read`, TTL 900 seconds, and `GET /humans/me → 200`.

There is no second OTP. The iframe remains scriptless. The result URL contains neither code nor state, and the page never contains the raw access token.

Backoffice: **http://localhost:5173**, initial admin **admin@example.com**, OTP in Mailpit. Select organization **Demo** and gathering **SSO test**.

- **Third-party Apps → Edit SSO mock**: start URL and exact callback.
- **Gatherings → Edit SSO test → Home page**: enable/disable the app and **Copy HTML link**. Paste the ordinary `<a>` into the custom home.
- Enabling the app preauthorizes automatic access for anyone who can view that home. Its token retains tenant-wide app scopes, not popup-only access.
- If disabled, a retained link fails safely with a recoverable portal error.

The seed writes `.env.local` (mock credential/config) and `.sessions.local` (local browser-testing tokens), both ignored by Git and mode 0600. Re-seeding rotates the mock key: **restart the mock afterward**. Do not use these development credentials outside this isolated stack.

## Integration contract

Use the [SSO integration guide](INTEGRATION.md) as the partner-facing contract. It documents the exact fields, validation, security responsibilities and implementation acceptance criteria. Do not infer a standard OAuth/OIDC protocol from this demo.

## Tests

```bash
# Native Node mock tests: browser state binding, PKCE, replay, no open redirect
node --test examples/third-party-sso/mock.test.mjs

# Backend tests use a disposable PostgreSQL testcontainer, not the example DB
export DOCKER_HOST="$(docker context inspect --format '{{.Endpoints.docker.Host}}')"
(cd backend && uv run pytest tests/api/auth/test_third_party_sso.py tests/api/third_party_app/test_sso_configuration.py -q)

# Portal: StrictMode must not duplicate the code-issuance POST
pnpm --dir portal test src/components/Portal/ThirdPartyAppLaunch.test.tsx
```

Stop terminal processes with Ctrl-C. Stop local DB/mail without removing data:

```bash
docker compose -p edgeos-sso -f examples/third-party-sso/compose.yaml down
```
