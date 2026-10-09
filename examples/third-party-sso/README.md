# Third-party SSO: local example

Minimal partner app: **Node built-ins only**, no packages, frontend build, database or login framework. It prepares state/PKCE, exchanges the code server-side, calls the real `/humans/me`, and displays the result without exposing the token.

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
3. Click **Abrir app mock**, inside the custom-home iframe.
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

1. Register both URLs in Third-party Apps. HTTPS is required; HTTP loopback is allowed only in `dev`. No query parameters, fragments or credentials in registered URLs. App registration/management and popup app configuration require an admin or superadmin JWT session; API keys are rejected regardless of scopes.
2. Enable the app for a popup and use the copied launch path in its home.
3. EdgeOS visits the registered start URL with `authorize_url`, the trusted portal destination for that popup/app. The partner must validate this destination, not act as an open redirector.
4. The partner creates a cryptographically random `state` and a PKCE verifier, stores them in a transaction bound to that browser, and redirects to `authorize_url` with:

```text
state=<random base64url value, 16–512 chars>
code_challenge=<base64url SHA-256 of verifier, without padding>
code_challenge_method=S256
```

5. The portal's trusted UI issues a POST using its existing bearer session. The callback receives `code` and the original `state`.
6. The partner validates state **before** the exchange, then sends:

```http
POST /api/v1/auth/human/third-party/sso/exchange
X-Third-Party-Api-Key: <private app credential>
Content-Type: application/json

{
  "code": "<opaque code>",
  "redirect_uri": "<exact registered callback>",
  "code_verifier": "<original verifier>"
}
```

Response: `access_token`, `token_type: bearer`, `expires_in`. Code TTL defaults to 60 seconds; access token TTL defaults to 15 minutes, configured separately via `SSO_CODE_EXPIRE_SECONDS` / `SSO_ACCESS_TOKEN_EXPIRE_MINUTES`.

Codes are hashed in PostgreSQL and consumed under a row lock. A successful exchange cannot be replayed or raced into two tokens. Incorrect app, verifier, callback, expiration, disabled link or revoked app are rejected. Scopes cannot expand between issuance and exchange.

Do not record codes, keys, verifiers or tokens in logs/analytics. Process and clean the callback before loading third parties; use `Referrer-Policy: no-referrer` and `Cache-Control: no-store`.

This is an integration-specific authorization-code flow, **not a complete OAuth/OIDC server**. No refresh tokens or public/SPA clients in v1. Existing OTP endpoints remain unchanged. Revocation blocks new issuance/exchanges; existing JWTs retain the current API's revocation semantics until expiry (do not assume universal immediate revocation).

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
