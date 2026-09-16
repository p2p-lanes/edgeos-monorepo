# Optional custom popup home

## Behavior

After creating a gathering, operators can edit HTML/CSS in Monaco under
**Gatherings → Edit → Home page** (syntax colors, line numbers, autocomplete,
folding, and formatting). The tab is intentionally absent during creation
because the home is a separate, versioned popup resource. The editor
stays on the left with a live preview on the right; smaller screens stack them.
Desktop/mobile controls change only the preview width, never hide the editor.
**Fullscreen preview** opens the current unsaved HTML in a viewport-sized modal,
regardless of the inline desktop/mobile setting. Closing it preserves both the
source and the selected inline preview mode.

Enable **Use custom home page**, then use the existing form's **Save Changes**
action to persist the HTML and switch. Oversized pastes are preserved for
correction, but pause preview and block saving until within the limit.

- Existing popups start with the switch off and no HTML.
- Disabled or empty HTML keeps the existing portal home, including application,
  multi-flow, and companion views.
- Disabling keeps the saved HTML for later. Popup responses expose only the
  lightweight `custom_home_enabled` signal. The dedicated portal-home endpoint
  returns 404 for disabled/empty homes, while authorized admins can still read
  the draft from the administrative home endpoint.
- Saving while enabled updates the live home. V1 has no separate draft/publish
  workflow or version history. Preview alone never saves or enables anything.
- When enabled, the custom home remains the gathering's root page and a **Home**
  item appears in the portal sidebar. The existing application/status cards move
  to `/portal/{slug}/overview` and remain available from the **Application**,
  **Overview**, or **Companion** item, depending on the gathering and participant.
  V1 does not embed that UI or add user-data placeholders to custom HTML.
- Changes appear on the portal's next home-resource fetch (reload to test immediately).
- Saves use an optimistic version. A stale editor receives HTTP 409 instead of
  overwriting a newer home.

## Template contract

Only these expressions are substituted:

| Expression | Value |
| --- | --- |
| `{{ popup.name }}` | Gathering name |
| `{{ popup.location }}` | Location |
| `{{ popup.start_date }}` | Localized start date |
| `{{ popup.end_date }}` | Localized end date |
| `{{ popup.image_url }}` | Gathering image URL |

Use expressions in HTML text or quoted HTML attributes, not CSS. Text is escaped
before sanitization. Missing/invalid dates and missing optional values become
empty strings. Dates use UTC calendar days to avoid timezone shifts and follow
the portal language. Preview uses the form's current details and default language.
Unknown expressions remain literal and trigger an editor warning. There are no
loops, conditionals, JavaScript evaluation, or recursive interpolation.

Both full documents and fragments (including `<style>` blocks) work. The maximum
source size is 200,000 UTF-8 bytes. Prefer HTTPS for image, font, and stylesheet
URLs; inline styles and CSS media queries work. Ordinary links navigate the top
page on a user click; fragment links stay inside the frame. Preview blocks links
that would leave the frame.

## Rendering and security

`@edgeos/shared-form-ui/popup-home` is a dedicated shared export used by both apps.
It interpolates the allowlisted fields, sanitizes with DOMPurify in the browser,
and inserts a restrictive CSP before user content. Scripts, event handlers,
forms, embedded pages, meta refresh, and base overrides are stripped/blocked.

The document renders in a sandboxed `srcDoc` iframe, **without** `allow-scripts`
or `allow-same-origin`. It cannot read the parent DOM, storage, or session.
The portal permits only user-activated top navigation; preview permits none.
Styles do not affect portal chrome, and portal theme styles do not leak in.
Long pages scroll inside the frame: v1 intentionally avoids a scripted resize
bridge. External images/styles/fonts can make network requests; do not include
sensitive information in custom HTML or external URLs.

The backend stores the source, not a rendered document, in the tenant-scoped
`popup_home_pages` table. Treat the dedicated API response as untrusted HTML in
any future consumer; always use the shared renderer.

## Rollout

Apply Alembic revision `e2c6a91b7d4f` before deploying the updated API. It
moves existing source—including disabled drafts—from `popups.custom_home_html`
into the RLS-protected `popup_home_pages` table and removes the wide popup
column. The small `custom_home_enabled` flag remains on `popups`. Both generated
frontend OpenAPI clients expose the dedicated administrative and portal home
endpoints. Home writes use existing tenant-scoped operator permissions and
update the flag, source, and version in one transaction.

- `GET /api/v1/popups/{popup_id}/home` returns the admin draft or an empty
  version-0 resource.
- `PATCH /api/v1/popups/{popup_id}/home` performs a version-checked upsert.
- `GET /api/v1/popups/portal/{slug}/home` returns published source only.
- Popup list/detail payloads never include the source document.

## Focused checks

From the repository root, with the normal local dependencies configured:

```sh
pnpm --filter backoffice exec vitest run src/components/forms/PopupHomeEditor.test.tsx
pnpm --filter portal test 'src/app/portal/[popupSlug]/page.test.tsx' \
  'src/app/portal/[popupSlug]/custom-home.test.tsx' \
  src/components/Portal/PopupHomeFrame.test.tsx \
  src/components/Sidebar/ResourcesMenu.test.tsx \
  src/hooks/useResources.commerce.test.tsx src/providers/discountProvider.test.tsx
pnpm --filter backoffice exec tsc -p tsconfig.build.json --noEmit
pnpm --filter portal exec tsc --noEmit
(cd backend && uv run pytest -q tests/api/popup)
```

Backend integration tests use Testcontainers. On Docker-context installations,
set `DOCKER_HOST` to the active Docker socket if the Python Docker SDK cannot
locate it.

Browser checks: save disabled HTML and confirm the old home; enable and reload;
disable and confirm the old home returns with HTML retained; switch to an
unconfigured popup; check live edits, mobile layout, fullscreen sizing/closing,
keyboard focus restoration, and oversized-source validation. Opening a preview
must never save the form or change the enable switch.
