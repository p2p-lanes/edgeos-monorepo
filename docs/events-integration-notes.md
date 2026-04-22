# Integración `feature/events-module` ← `origin/dev`

Fecha: 2026-04-17
Rama local: `feature/events-module` @ `f02f537`
Remoto objetivo: `origin/dev` @ `5927ee7`
Merge-base histórica: `4f25813`

## 1. Contexto

La rama `origin/dev` avanzó **38 commits** desde la última integración
(`71fb0c3 Merge remote-tracking branch 'origin/dev' into feature/events-module`),
incluyendo cambios grandes en i18n, theming y checkout. Nuestra rama sumó
**36 commits** propios (más un WIP stashed al momento de iniciar la integración).

El WIP al momento del stash está en `stash@{0}` y contiene:
- `backend/app/api/event_venue/router.py` (M)
- `backend/tests/test_venue_availability.py` (M)
- `backoffice/src/components/VenueWeekCalendar.tsx` (M)
- `backoffice/src/routeTree.gen.ts` (M)
- `backoffice/src/routes/_layout/events/index.tsx` (M)
- `backoffice/src/components/VenueDayCalendar.tsx` (untracked)
- `backoffice/src/routes/_layout/events/day-by-venue.tsx` (untracked)

## 2. Categorización de archivos

Total de archivos tocados localmente (vs. merge-base): **181**.

- **Módulo de eventos puro (nuevos)**: 110 archivos. Se listan abajo en §5.
- **Áreas compartidas tocadas por nuestra rama**: **71 archivos**. Se
  desglosan en §3.

## 3. Cambios locales fuera del módulo de eventos

Agrupados por *intención*, no sólo por path. Algunos archivos aparecen en
más de una categoría porque los tocaron varios commits.

### 3a. Cableado obligatorio del módulo (esperable)

Tocados para **enchufar** el módulo al resto del sistema; no son cambios
"ajenos".

| Archivo | Motivo |
|---|---|
| `backend/app/api/router.py` | Registrar routers `event*`, `track`, `event_venue`, etc. |
| `backend/app/models.py` | Registrar modelos SQLAlchemy de eventos |
| `backend/app/api/popup/models.py` | Relación `popup → events` |
| `backend/app/api/tenant/models.py` | Relación multi-tenant de eventos |
| `backend/app/api/upload/router.py` | Endpoint de upload reutilizado por eventos (cover images) |
| `backend/app/services/email/__init__.py` | Export de plantillas nuevas |
| `backend/app/services/email/service.py` | Envío de invitaciones/approvals |
| `backend/app/services/email/templates.py` | Registro de plantillas `event/*.html` |
| `backend/app/services/email_helpers.py` | Helpers reutilizados por emails de eventos |
| `backend/app/api/email_template/schemas.py` | Nuevos tipos de template |
| `backoffice/src/components/Sidebar/AppSidebar.tsx` | Entrada de menú "Events" |
| `backoffice/src/components/Sidebar/PopupSelector.tsx` | Selector pasó a usar rutas de eventos |
| `backoffice/src/components/Common/CommandPalette.tsx` | Atajos a rutas de eventos |
| `portal/src/components/Sidebar/BreadcrumbSegment.tsx` | Breadcrumbs de rutas `events/*` |
| `portal/src/components/Sidebar/HeaderBar.tsx` | Links a eventos en topbar |

### 3b. Archivos generados (regenerados por side-effect)

No son cambios "a mano"; se actualizan al correr el codegen.

- `backoffice/src/client/schemas.gen.ts`
- `backoffice/src/client/sdk.gen.ts`
- `backoffice/src/client/types.gen.ts`
- `portal/src/client/schemas.gen.ts`
- `portal/src/client/sdk.gen.ts`
- `portal/src/client/types.gen.ts`
- `backoffice/src/routeTree.gen.ts` (TanStack Router)

### 3c. Utilidades compartidas introducidas para eventos (reusables)

Nuevos componentes/utilidades fuera del path del módulo, pero nacidos
del trabajo de eventos. Pueden reusarse; dejarlos o reescribirlos es
decisión del equipo.

| Archivo | Rol |
|---|---|
| `backoffice/src/components/LucideIconGrid.tsx` | Grid de íconos lucide para formularios |
| `backoffice/src/components/LucideIconPicker.tsx` | Picker con búsqueda |
| `backoffice/src/lib/lucide-icon.tsx` | Resolver string → componente |
| `backoffice/src/components/ui/date-picker.tsx` | DatePicker shadcn-style |
| `backoffice/src/components/ui/datetime-picker.tsx` | Ídem con hora |
| `backoffice/src/components/ui/time-picker.tsx` | Sólo hora |
| `portal/src/components/ui/calendar.tsx` | Calendar de shadcn |
| `portal/src/components/ui/date-picker.tsx` | DatePicker portal |
| `portal/src/components/LucideIcon.tsx` | Ícono dinámico portal |
| `portal/src/components/CoverImageCropper.tsx` | Cropper para covers |

### 3d. Cambios genuinos cross-cutting (no son de eventos)

Son los que conviene revisar con lupa al integrar, porque se van a
pisar con cosas de `origin/dev`.

| Archivo | Commit(s) | Qué cambió |
|---|---|---|
| `.github/workflows/ci.yml` | `e61acef`, `bdd49ea` | Pipeline de lint + tests backend (todo backend, no sólo eventos) |
| `backend/pyproject.toml` | `0636acb`, `bdd49ea` | Deps nuevas (`icalendar`, etc.) + ruff config |
| `uv.lock` | (regen) | Lockfile backend |
| `backend/app/api/popup/router.py` | `ec75332` | Ruff cleanup + drop unused `popup_id` arg |
| `backend/app/api/product/router.py` | `ec75332` | Ruff cleanup |
| `backend/app/api/product/schemas.py` | `ec75332` | Ruff cleanup |
| `backend/app/api/ticketing_step/crud.py` | `ec75332` | Ruff cleanup |
| `backend/app/api/ticketing_step/router.py` | `ec75332` | Ruff cleanup |
| `backend/app/api/tenant/models.py` | `ec75332` | Ruff cleanup (+ wiring events) |
| `backend/app/services/approval/calculator.py` | `ec75332` | Ruff cleanup |
| `backend/scripts/migrate_from_source.py` | `ec75332` | Ruff cleanup |
| `backend/tests/test_scholarship_workflow.py` | `ec75332` | Ruff cleanup |
| `backoffice/Dockerfile` | `8136ac1` | Monorepo: copiar `packages/shared-events` |
| `portal/Dockerfile` | `8136ac1` | Ídem |
| `portal/next.config.ts` | `8136ac1` | `transpilePackages: ['@repo/shared-events']` |
| `portal/next-env.d.ts` | `c2d2bbc` | Regen Next |
| `package.json` (root) | `bdd49ea` | Scripts monorepo |
| `backoffice/package.json` | `8136ac1`, `bdd49ea` | Deps + workspace ref a shared-events |
| `portal/package.json` | `8136ac1`, `bdd49ea` | Ídem |
| `pnpm-workspace.yaml` | `8136ac1` | Añade `packages/*` |
| `pnpm-lock.yaml` | múltiples | Lockfile |
| `compose.override.yaml` | `4cf407a`, `bdd49ea` | Mailpit para tests de email |
| `.env.example` | `0636acb` | Vars de Google Calendar / iCal |
| `portal/src/app/globals.css` | `c62b927`, `86df28c`, `142ddc5` | **3 commits** de contraste page vs. card (portal general, no-events) |
| `portal/src/app/checkout/components/CheckoutFlow.tsx` | `c2d2bbc` | Ajustes menores checkout (WIP pre-merge) |
| `portal/src/app/checkout/hooks/useCheckoutState.ts` | `c2d2bbc` | Ídem |
| `portal/src/types/checkout.ts` | `c2d2bbc` | Ídem |
| `portal/src/components/checkout-flow/steps/HousingStep.tsx` | `c2d2bbc`, `bdd49ea` | Checkout housing |
| `portal/src/components/checkout-flow/steps/MerchSection.tsx` | `c2d2bbc` | Checkout merch |
| `portal/src/components/checkout-flow/steps/PatronSection.tsx` | `c2d2bbc`, `bdd49ea` | Checkout patron |
| `portal/src/components/checkout-flow/variants/VariantHousingDate.tsx` | `c2d2bbc`, `bdd49ea` | Checkout housing date |
| `portal/src/app/portal/[popupSlug]/application/page.tsx` | `c2d2bbc` | Application page |
| `portal/src/app/portal/[popupSlug]/passes/Tabs/YourPasses.tsx` | `c2d2bbc` | YourPasses (fix cancelled RSVP) |
| `portal/src/hooks/useResources.ts` | `c2d2bbc` | Hook general |
| `backoffice/src/components/forms/PopupForm.tsx` | `c2d2bbc`, `bdd49ea` | PopupForm: eventos + generales |
| `backoffice/src/components/forms/ProductForm.tsx` | `bdd49ea` | ProductForm |
| `backoffice/src/components/ticketing-step-builder/constants.ts` | `bdd49ea` | Constantes del step builder |
| `backoffice/src/routes/_layout.tsx` | `c2d2bbc` | Layout root backoffice |
| `backoffice/src/routes/_layout/abandoned-carts.tsx` | `c2d2bbc` | Carrier wiring |
| `backoffice/src/routes/_layout/popups/$id.edit.tsx` | `c2d2bbc` | Popups edit |
| `backoffice/src/routes/_layout/popups/index.tsx` | `c2d2bbc` | Popups index |
| `backoffice/src/routes/_layout/popups/new.tsx` | `c2d2bbc` | Popups new |

> Los cambios marcados en `c2d2bbc` son "WIP previo al merge" — entraron
> justo antes de fusionar `origin/dev` la vez pasada. Son los más
> propensos a chocar ahora, porque `origin/dev` también tocó esas
> áreas (theme, checkout, i18n).

## 4. Conflictos detectados (simulación `git merge-tree`)

Los siguientes **20 archivos** dan conflicto al fusionar `origin/dev` en
`feature/events-module`:

| # | Archivo | Tipo |
|---|---|---|
| 1 | `backend/app/api/popup/router.py` | content (ruff cleanup vs. upstream) |
| 2 | `backend/app/api/router.py` | content (registramos routes events vs. upstream registra translations) |
| 3 | `backend/app/models.py` | content (modelos events vs. models translation) |
| 4 | `backend/pyproject.toml` | content (deps nuestras vs. deps i18n) |
| 5 | `backoffice/src/client/schemas.gen.ts` | **generado** — regenerar post-merge |
| 6 | `backoffice/src/client/sdk.gen.ts` | **generado** — regenerar post-merge |
| 7 | `backoffice/src/client/types.gen.ts` | **generado** — regenerar post-merge |
| 8 | `backoffice/src/components/forms/PopupForm.tsx` | content (events fields vs. theme fields) |
| 9 | `pnpm-lock.yaml` | **lockfile** — re-generar con `pnpm install` |
| 10 | `portal/package.json` | content (deps) |
| 11 | `portal/src/app/checkout/components/CheckoutFlow.tsx` | content (WIP nuestro vs. checkout i18n upstream) |
| 12 | `portal/src/app/globals.css` | content (3 commits de contraste vs. theme config upstream) |
| 13 | `portal/src/app/portal/[popupSlug]/application/page.tsx` | content |
| 14 | `portal/src/app/portal/[popupSlug]/passes/Tabs/YourPasses.tsx` | content |
| 15 | `portal/src/client/schemas.gen.ts` | **generado** |
| 16 | `portal/src/client/sdk.gen.ts` | **generado** |
| 17 | `portal/src/client/types.gen.ts` | **generado** |
| 18 | `portal/src/components/Sidebar/BreadcrumbSegment.tsx` | content |
| 19 | `portal/src/hooks/useResources.ts` | content |
| 20 | `uv.lock` | **lockfile** — regenerar con `uv lock` |

Además, 18 archivos se auto-mergearon sin conflicto (ej.
`backend/app/api/product/router.py`, `ProductForm.tsx`, los
`checkout-flow/steps/*`, etc.), pero conviene revisarlos tras el merge.

### Archivos del módulo de eventos sin conflicto
Ninguno de los 110 archivos puros de eventos colisiona con `origin/dev`
(no se tocan). Eso es buena señal: el módulo es razonablemente
aislable.

## 5. Commits relevantes de nuestra rama (38 commits)

Orden cronológico. Ver detalle con `git show <sha>`.

```
c2d2bbc wip(events): checkpoint before merging origin/dev
71fb0c3 Merge remote-tracking branch 'origin/dev' into feature/events-module
0636acb feat(events): phase 1 MVP + phase 2 (recurrence, Google Calendar sync)
a2acb65 fix(events): settings upsert, property types tenant, venue UX
348be21 refactor(events): align with repo conventions
142ddc5 style(portal): subtle contrast between page and cards
86df28c style(portal): stronger background vs card contrast
c62b927 style(portal): bump page/card contrast to a perceivable level
41868ad fix(venues): resolve property icon string to a real lucide component
21240cc feat(ui): shadcn-style TimePicker replaces native time input
e73157e refactor(venues): move icon help to a tooltip, simplify input
c47f961 feat(venues): property-type delete + kebab-case icon lookup
e190667 fix(venues): flatten VenueProperties join rows in API responses
6ef8028 feat(venues): delete property types cleanly + card-style chips
6ac1692 fix(venues): use flex-wrap + fixed card size for properties
b313537 fix(venues): use static lucide imports so icons survive tree-shaking
21ea9c5 fix(portal): treat cancelled RSVP as 'not registered' again
7198129 feat(portal): humans can create events from the portal
d1ce1fb feat(events): split date + time slot picker driven by venue availability
4cf407a feat(events): duration-based picker + portal upload/invitations endpoints
739a294 feat(events): duration picker, editable start, RSVP filter, portal endpoints
d721768 feat(portal): RSVP filter visible across events list and calendar
b4e9888 feat(portal): unified events toolbar across list and calendar
b5f6aef feat(portal): identical events toolbar (search + actions) on both views
1b2862a fix(portal): identical width + compact view switcher
dc105ea refactor(portal): merge calendar + list into one page, toggle body only
4e24525 fix(venues): _set_property_types dedupes + flushes deletes first
8136ac1 refactor(events): split oversized forms + shared venue-slots package
ec75332 chore(backend): ruff cleanup + drop unused popup_id arg
fc7e34f chore(backend): remove obsolete gcal sync test
2f020c1 test(events): integration tests for venue availability
e61acef ci: add backend lint + tests workflow
183ecad docs: events testing plan
bdd49ea feat(events): portal polish, backoffice approval UI, full test + E2E harness
611e0b0 feat(backoffice): venue week calendar
f02f537 fix(backoffice): venue calendar alignment + contrast
(stash@{0}): WIP día/semana de venues
```
