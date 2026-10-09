# EdgeOS third-party SSO integration guide

**Audience:** partner developers and coding agents implementing a server-side integration.
**Contract:** v1, introduced in [PR #757](https://github.com/p2p-lanes/edgeos-monorepo/pull/757). Verify that your target environment has deployed this feature before using these routes. Merging into `dev` does not imply a production deployment.

This document is self-contained: a partner does not need the EdgeOS repository to implement the flow. For a runnable reference, use the [local quickstart](README.md) and [dependency-free Node mock](mock.mjs).

## 1. Goal and boundaries

An authenticated EdgeOS portal user clicks an ordinary link in a popup's custom home and enters a partner app without another email OTP. The partner exchanges a short-lived code **from its backend**, then establishes its own application session.

- This is a custom authorization-code integration, **not a complete OAuth/OIDC provider**. Do not use an OAuth SDK's default endpoints, `grant_type`, discovery document or ID-token assumptions.
- Supported: confidential clients with a backend and a private registered app credential.
- Not supported in v1: public/SPA-only clients, refresh tokens, discovery or ID tokens.
- The existing OTP integration remains unchanged. This flow does not request an OTP; if the user's portal session has expired, the portal may require its normal login first.
- An admin enabling the popup–app association preauthorizes access. No additional consent screen is shown.
- A user must be allowed to view that custom home. An accepted application is not an additional SSO requirement; ended-popup access follows the existing home visibility policy.
- Token scopes retain existing tenant-wide app semantics, subject to the API's user/resource authorization. A launch from one popup does **not** constrain the token to that popup.

## 2. Required inputs

Obtain these values from the EdgeOS administrator. Do not guess production domains or request access to unrelated tenants.

| Input | Example / meaning | Secret? |
| --- | --- | --- |
| EdgeOS API origin | `https://api.edgeos.example`, without `/api/v1` | No |
| Trusted portal origin | The actual tenant portal origin | No |
| Popup slug | Used in the portal path, not the popup UUID | No |
| Registered app ID | App UUID returned by registration | No |
| App credential | The private third-party app `raw_key`, shown once on creation/rotation | **Yes, backend only** |
| Partner start URL | `https://partner.example/auth/start` | No |
| Partner callback URL | `https://partner.example/auth/callback` | No |
| Allowed authorize URL(s) | Exact trusted portal URL(s), described below | No |
| Allowed token scopes | Include `portal:profile:read` if using `/humans/me` for identity | No |

An app registration belongs to one tenant. Use the API and portal from the same deployed environment, and the app/popup from the same tenant.

The authorize URL is a **portal page**, not an API endpoint:

```text
{TRUSTED_PORTAL_ORIGIN}/portal/{POPUP_SLUG}/apps/{APP_ID}/authorize
```

The administrator should provide the complete URL. For multiple supported popups, maintain an explicit allowlist of complete URLs. Never trust an arbitrary `authorize_url` supplied by a browser or infer trust with a string-prefix check.

## 3. Administrator setup

Partner code must not try to configure EdgeOS with its app credential. Configuration requires an **ADMIN or SUPERADMIN JWT session**; delegated API keys and human portal tokens are not accepted. A superadmin must supply `X-Tenant-Id: <tenant UUID>` on tenant-scoped configuration requests.

### Backoffice workflow

1. Open **Third-party Apps → Create/Edit**.
2. Set the desired token scopes and both **App start URL** and **Exact callback URL**.
3. Store the private app credential securely on the partner backend. Never put it in custom-home HTML or frontend environment variables.
4. Open **Gatherings → Edit → Home page → Third-party app access**.
5. Enable the app and select **Copy HTML link**. Association changes save immediately, independently of the HTML draft.
6. Paste the copied anchor into the custom home and save the home using its normal workflow.

Both registered URLs must be absolute, at most 2,048 characters, without credentials, whitespace, backslashes, query parameters or fragments. HTTPS is required. HTTP loopback/localhost is allowed only when EdgeOS runs in `dev`. Set both URLs together; clearing both disables SSO configuration. There is no separate `sso_enabled` field.

### API equivalents

All paths below are relative to the API origin and include `/api/v1`.

```http
POST /api/v1/third-party-apps
Authorization: Bearer <ADMIN_JWT>
Content-Type: application/json

{
  "name": "Partner app",
  "allowed_token_scopes": ["portal:profile:read"],
  "allowed_api_key_scopes": [],
  "sso_start_url": "https://partner.example/auth/start",
  "sso_redirect_uri": "https://partner.example/auth/callback"
}
```

Success: **201**, with the app `id` and the one-time `raw_key`. For an existing app, use `PATCH /api/v1/third-party-apps/{APP_ID}` with the URL fields. `allowed_token_scopes` controls this flow; `allowed_api_key_scopes` is a separate existing capability, not a requirement for SSO exchange.

```http
PUT /api/v1/popups/{POPUP_UUID}/apps/{APP_ID}
Authorization: Bearer <ADMIN_JWT>
Content-Type: application/json

{"enabled": true}
```

Success: **200**, with `app_id`, `name`, `enabled`, `sso_configured` and `launch_path`. List choices with `GET /api/v1/popups/{POPUP_UUID}/apps`. Use `enabled: false` to disable an association. To discover valid platform scopes, use `GET /api/v1/third-party-apps/available-scopes` with an admin JWT.

The returned `launch_path` is a relative **portal** path:

```html
<a href="/portal/{POPUP_SLUG}/apps/{APP_ID}/launch">Open partner app</a>
```

Replace placeholders or use the copied link. Do not link directly to a code-issuing API endpoint, add iframe scripts, or relax the sandbox.

## 4. Browser and server flow

```text
Browser: custom-home link
  → EdgeOS portal /launch (uses the existing portal bearer session)
  → Partner /auth/start?authorize_url=<URL-encoded trusted portal URL>
  → EdgeOS portal /authorize?state=...&code_challenge=...&code_challenge_method=S256
  → Partner registered callback?code=...&state=...

Partner backend:
  → POST EdgeOS /api/v1/auth/human/third-party/sso/exchange
  → GET EdgeOS /api/v1/humans/me, if using profile identity
  → Establish partner session; redirect browser to a clean application URL
```

The portal handles its own bearer authentication and code-issuance POST. **Do not request, copy or forward the user's portal JWT to the partner.** Navigating directly to the API does not send the portal's localStorage token.

### Start handler

1. Reject `authorize_url` unless it exactly matches a configured trusted URL.
2. Generate independent cryptographically random `state`, PKCE verifier and transaction ID. A base64url encoding of 32 random bytes works for each.
3. Store state, verifier and the trusted authorize URL **server-side**, bound to that browser's transaction ID. Give pending transactions a short expiry; the reference uses five minutes. These transactions must work across any workers/instances serving the callback.
4. Set a host-only transaction cookie with `HttpOnly`, `SameSite=Lax` and `Secure` in production. Its path must cover start/callback handlers; using the same origin for both is the simplest arrangement. The cookie contains an opaque transaction ID, not the verifier or tokens.
5. Redirect to the trusted authorize URL with the three parameters below. Use a URL builder, not manual string concatenation.

```js
// Node built-ins; do not print these generated values.
import { randomBytes, createHash } from "node:crypto"

const state = randomBytes(32).toString("base64url")
const verifier = randomBytes(32).toString("base64url")
const challenge = createHash("sha256").update(verifier, "ascii").digest("base64url")

const destination = new URL(trustedAuthorizeUrl) // already allowlisted
// Persist state + verifier in the browser-bound server transaction first.
destination.searchParams.set("state", state)
destination.searchParams.set("code_challenge", challenge)
destination.searchParams.set("code_challenge_method", "S256")
// Send an HTTP redirect to destination.toString().
```

### Callback handler

1. Load the pending transaction using the browser cookie. Reject missing, expired or already-used transactions.
2. Compare returned state to stored state in constant time. Handle unequal byte lengths safely. **Validate state before calling EdgeOS.** EdgeOS echoes state; the partner owns this browser-binding check.
3. Require a correctly shaped code. Atomically claim the partner transaction so concurrent callbacks cannot run it twice.
4. Exchange the code server-to-server using the stored verifier and the **exact configured callback URI**, not a URI reconstructed from callback query parameters or an untrusted `Host` header.

```http
POST /api/v1/auth/human/third-party/sso/exchange
X-Third-Party-Api-Key: <PRIVATE_APP_CREDENTIAL>
Content-Type: application/json

{
  "code": "<CODE_FROM_CALLBACK>",
  "redirect_uri": "https://partner.example/auth/callback",
  "code_verifier": "<VERIFIER_FROM_SERVER_TRANSACTION>"
}
```

Success: **200**:

```json
{
  "access_token": "<SERVER_ONLY_BEARER_TOKEN>",
  "token_type": "bearer",
  "expires_in": 900
}
```

`expires_in` is seconds, not milliseconds. Treat the returned value as authoritative; 900 is the default, not a client-side constant. Use the configured HTTPS API origin, and reject unexpected redirects rather than forwarding credentials or bearer tokens to another origin.

5. If using identity, verify it through the authenticated API:

```http
GET /api/v1/humans/me
Authorization: Bearer <ACCESS_TOKEN_FROM_EXCHANGE>
```

This requires `portal:profile:read`. Use the API's human `id` as the stable identity key, namespaced to the configured environment/tenant; email is a profile attribute. Do not authenticate a user by decoding an unverified JWT payload. The reference displays selected claims only **after** a successful authenticated profile request.

6. Establish/rotate the partner's own application session. Keep the EdgeOS token server-side only if the app needs subsequent EdgeOS API calls; otherwise discard it after identity lookup.
7. Remove temporary state/verifier, and redirect to a clean application URL without `code` or `state`. Do not load analytics or third-party assets on the callback page.

The local reference is a protocol demonstration, not a production session framework. Its in-memory transactions and result snapshot must be replaced with appropriate server-side storage/session handling when deploying across workers or instances.

## 5. Wire constraints and guarantees

| Field / setting | Contract |
| --- | --- |
| `state` | 16–512 ASCII characters; `A–Z`, `a–z`, `0–9`, `.`, `_`, `~`, `-` |
| `code_challenge` | Exactly 43 base64url characters, SHA-256 of the ASCII verifier, no `=` padding |
| `code_challenge_method` | Exactly `S256`; `plain` is not supported |
| `code_verifier` | 43–128 ASCII unreserved characters, same character set as state |
| `code` | Opaque 43-character base64url string; not an OTP or JWT |
| Code expiry | Default 60 seconds after issuance; operator setting `SSO_CODE_EXPIRE_SECONDS`, range 10–300 |
| Token expiry | Default 15 minutes; operator setting `SSO_ACCESS_TOKEN_EXPIRE_MINUTES`, range 1–60 |

- Codes are hashed in PostgreSQL, bound to app, tenant, human, popup, callback, challenge and a scope snapshot.
- Successful exchange commits single-use consumption before returning a token. Parallel valid exchanges cannot both succeed.
- Invalid exchange attempts do not consume the code; expiry still applies. Do not build blind retry loops: after a timeout the successful response may have been lost while the code was already consumed. Start a fresh browser transaction when success is uncertain.
- Exchange revalidates home access, app status, association and callback. Changing the registered callback invalidates outstanding codes.
- Issued scopes are the intersection of scopes captured at authorization and current allowed app scopes, within the platform ceiling. Scope additions cannot expand a pending grant.
- Disabling an association or revoking the app blocks new issuance/exchange. **Do not assume universal immediate revocation of an already-issued JWT**; existing API revocation semantics apply until expiry.
- Key rotation invalidates the old app credential. Update the partner's secret storage; never retrieve a key from list/read responses.

## 6. Authentication reference

| API route | Caller / credential | Purpose |
| --- | --- | --- |
| `/api/v1/third-party-apps` and its management routes | Admin/superadmin JWT | App registration, configuration, rotation, revocation |
| `GET /api/v1/popups/{POPUP_UUID}/apps` | Admin/superadmin JWT | List popup app choices and launch paths |
| `PUT /api/v1/popups/{POPUP_UUID}/apps/{APP_ID}` | Admin/superadmin JWT | Enable/disable association |
| `GET /api/v1/popups/portal/{POPUP_SLUG}/apps/{APP_ID}/launch` | Human **portal** JWT | Portal reads registered start URL; GET never issues a code |
| `POST /api/v1/popups/portal/{POPUP_SLUG}/apps/{APP_ID}/authorization-codes` | Human **portal** JWT | Portal submits state/challenge/method, receives `redirect_url` |
| `POST /api/v1/auth/human/third-party/sso/exchange` | `X-Third-Party-Api-Key` | Partner backend exchanges code/verifier/callback |
| `GET /api/v1/humans/me` | Exchanged human bearer token with profile-read scope | Partner verifies user identity |

A delegated third-party token cannot issue another SSO code. Admin JWTs and API keys are not substitutes for a human portal session. No new browser CORS/key-exposure scheme is required: the partner performs exchange and resource calls server-side.

## 7. Failure handling

| Symptom | Check / action |
| --- | --- |
| Portal cannot open app; launch/issuance returns 404 | Same tenant, published/nonempty enabled home, user access, active configured app, enabled popup association |
| 401 | Invalid/expired credential or revoked app. Restore the relevant session/secret; do not log credential values |
| 403 | Wrong identity type or insufficient permissions/scopes. Do not try a different credential class to bypass the guard |
| Exchange 400 | Expired/used/wrong-app code, wrong verifier/callback, changed configuration or lost home access. Return to home and start a fresh transaction |
| 422 | Missing required header, malformed fields, non-S256 challenge, invalid URL pair or schema validation failure |
| 429 | Rate limit. Back off; do not loop authorization/exchange requests |
| Callback has no matching browser transaction | Cookie path/domain/SameSite/Secure configuration, transaction expiry, other browser or stale callback. Reject without exchanging |
| Local mock stops working after re-seeding | The seed rotated the app key; restart the mock |

API error descriptions are intentionally not a user-discovery mechanism. Handle rejected attempts without exposing transaction data or distinguishing another tenant's users/apps.

## 8. Acceptance checklist for a coding agent

- [ ] Obtain explicit environment, app, popup, callback, trusted authorize URL and scope configuration; no guessed domains or secrets.
- [ ] Implement backend start/callback handlers and a browser-bound, expiring transaction store.
- [ ] Allowlist authorize destinations; enforce state and S256 PKCE; atomically claim callbacks.
- [ ] Keep app credential, verifier and exchanged token out of frontend code, URLs, logs, analytics and source control. The protocol-required code/state query parameters are temporary and must be redacted from request logs.
- [ ] Apply `Cache-Control: no-store` and `Referrer-Policy: no-referrer` to start/callback/result responses; clean the callback URL before rendering app content.
- [ ] Use `/humans/me` or another authorized API call, not unverified decoded claims, as the identity/resource authority.
- [ ] Success: one existing portal login, custom-home click, correct human returned, no additional OTP, no exchanged token in the browser.
- [ ] Reject missing/mismatched state or browser cookie before exchange; reject replay and concurrent duplicate callbacks.
- [ ] Test expired code, wrong verifier, wrong app/callback, disabled link, revoked app and missing profile scope.
- [ ] Test a user who can view the home but has no accepted application; do not add an extra acceptance gate.
- [ ] Leave custom-home HTML and iframe sandbox unchanged beyond the ordinary link.

### Copyable implementation brief

```text
Implement EdgeOS third-party SSO v1 using this guide as the contract.
Inputs must be supplied by the administrator; ask for missing configuration.
Build only server-side start/callback handlers, browser-bound state + S256
PKCE transactions, code exchange, authenticated identity lookup and a normal
partner session. Use the exact allowlisted portal authorize URL and registered
callback. Never request the portal JWT or expose app credentials/verifiers/
access tokens to the browser. Do not add OIDC, refresh tokens, SPA exchange,
new OTP requests, custom-home JavaScript or an accepted-application gate.
Verify the acceptance checklist and report exact tests and limitations.
Use the local mock only as a reference, not production session infrastructure.
```

## 9. Source of truth and local verification

If wire behavior differs, inspect the deployed API's `/api/v1/openapi.json` and these repository files rather than inventing parameters:

- [SSO schemas](../../backend/app/api/third_party_sso/schemas.py): exact request/response fields.
- [SSO routes](../../backend/app/api/third_party_sso/router.py): routes and credential requirements.
- [SSO service](../../backend/app/api/third_party_sso/service.py): code lifetime, revalidation, scope intersection and atomic consumption.
- [URL validation](../../backend/app/api/third_party_app/sso_urls.py): registered destination rules.
- [Local quickstart](README.md): isolated fixtures, setup, tests and cleanup.

Do not silently adapt to an unexpected protocol or weaken checks. Confirm environment/version with the administrator first. Local fixture scripts must not be pointed at a remote or production database.
