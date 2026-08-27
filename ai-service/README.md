# EdgeOS AI Service

Agentic operations service for the EdgeOS backoffice. It uses Vercel AI SDK with
OpenAI or Gemini and exposes a dynamic operations broker plus dedicated custom
export tools:

- `searchOperations` discovers authorized administrative capabilities and their
  path, query, and JSON body schemas.
- `executeOperation` executes an exact discovered operation with the current
  user's identity.
- `searchExportFields` discovers server-owned export datasets, related fields,
  filters, sensitivity classes, and supported formats.
- `prepareCustomExport` validates an immutable CSV/XLSX plan and returns a
  download card without placing exported rows in model context.

The agent is not limited by a hand-written resource registry. New JSON API
operations become discoverable without adding TypeScript tools or React
components. Authentication, tenant isolation, RLS, validation, transactions,
and domain policy remain in FastAPI.

## Security model

- The service validates the backoffice JWT with `GET /api/v1/users/me` before
  using model tokens. Access is limited to superadmins, admins, and operators.
- It validates the selected organization and active gathering. The active
  gathering is the default operating context; an explicitly requested target
  in the same organization is shown as cross-context rather than silently
  rewritten.
- The model can provide only an `operationId` and path/query/body arguments; it
  cannot provide URLs, methods, hosts, auth headers, or tenant headers.
- Auth, portal/self-service, checkout, API-key, credential, and webhook
  surfaces are excluded from the dynamic catalog. Non-JSON responses are
  excluded unless they are declared supported downloads.
- FastAPI receives the user's JWT and remains the final authorization boundary.
- The default autonomy mode is **supervised**: reads execute automatically and
  every POST, PUT, PATCH, or DELETE requires signed UI approval.
- Approval cards use a read-only server preview to resolve UUIDs into live
  records, summarize impact, and keep raw arguments behind technical details.
- Approved write inputs are tied to their tool-call ID and to the current user,
  organization, and active gathering. FastAPI atomically claims each write in
  Redis before execution and stores its sanitized result afterward, preventing
  duplicate execution across AI service replicas and restarts. If Redis or the
  final result store is unavailable, writes fail closed and require state
  verification instead of an automatic retry.
- Write targets must resolve to exactly one gathering. Cross-context proposals
  identify both the active and affected gatherings; unresolved or mixed-scope
  writes fail closed. Read results identify their actual gathering context.
- JSON responses are size bounded and secret fields are redacted. Declared CSV,
  iCalendar, PDF, binary, and custom CSV/XLSX downloads are never inserted into
  model context; tools return a small descriptor and authenticated endpoints
  stream files only after the user clicks a download card.
- Custom exports use a server-owned field and relationship registry, tenant RLS,
  an exact 50,000-row/25-column bound, sensitivity warnings, formula-injection
  protection, and a fingerprint that prevents changing a previewed plan.
- Every execution emits a structured audit event with user, tenant, gathering,
  operation, tool call, status, and backend request ID.

The service does not access PostgreSQL directly and does not use a privileged
service account.

## Skills

Server-owned workflow skills live under `ai-service/skills/*/SKILL.md`. Relevant
skills are loaded into the prompt per user request and are also returned by
operation discovery. Skills teach domain workflows; they never grant permissions.

## Environment

| Variable | Required | Default |
|---|---:|---|
| `AI_PROVIDER` | No | Inferred from configured provider key |
| `OPENAI_API_KEY` | When using OpenAI | — |
| `GEMINI_API_KEY` | When using Google | — |
| `TOOL_APPROVAL_SECRET` | To use chat | — |
| `BACKEND_URL` | No | `http://localhost:8000` |
| `REDIS_URL` | For durable writes (configured by FastAPI) | `redis://redis:6379` locally |
| `AI_MODEL` | No | `gpt-5.6-terra` or `gemini-2.5-flash` |
| `PORT` | No | `3002` |

Generate the approval secret with:

```bash
openssl rand -base64 32
```

## Development

From the repository root:

```bash
pnpm install
pnpm dev:ai
```

The backoffice proxies `/api/ai/*` to port 3002. The public AI endpoints are
`GET /health-check`, `POST /api/ai/chat`, the authenticated read-only
`POST /api/ai/operations/preview` used by approval cards, authenticated
`POST /api/ai/downloads` used by domain download cards, and authenticated
`POST /api/ai/custom-exports/download` used by custom CSV/XLSX cards.

FastAPI persists each operator's sanitized conversation threads under tenant
RLS for 30 days. Prepared files, raw tool results, approval signatures, and
provider usage payloads are not retained. Normalized token usage and model names
are stored per completed response. Domain state and authorization remain owned
by FastAPI.
