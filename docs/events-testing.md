# Events — Manual Test Plan

Checklist para verificar el módulo de eventos end-to-end después de los cambios de permisos / layout / timezone recientes. Cada bloque asume un popup limpio salvo que se indique lo contrario.

---

## 0. Prerrequisitos

- [ ] Al menos **un popup** creado con un tenant admin y un human con acceso.
- [ ] (Opcional) Un segundo popup sin fila en `event_settings` para validar el caso "null settings".
- [ ] (Opcional) Un segundo human para validar "My events" / "owner gates".

---

## 1. Backoffice — Event Settings (`/events/settings`)

Ubicación: Events → Settings en el backoffice.

### Labels y textos
- [ ] El toggle superior dice **"Events Enabled"** y el helper habla de "create events" (no "publish").
- [ ] El select dice **"Who Can Create Events"** (no "Publish").
- [ ] Options: **Everyone** / **Admins Only**.
- [ ] Helper bajo el select menciona "Create Event button in the portal" y que en Admins Only sólo los admins pueden crear desde el backoffice.

### Persistencia
- [ ] Cambiar el toggle o el select **mutea** inmediatamente (no hay botón "Save").
- [ ] Refrescar la página preserva el valor.
- [ ] Cambiar de popup en el selector top-level **recarga** los settings (no deja valores viejos).

### Default al crear settings
- [ ] Un popup nuevo, al primer acceso, muestra `Events Enabled = ON` y `Who Can Create = Everyone`.

### Otros campos
- [ ] **Default Timezone**: cambiar → eventos en portal se reformatean con nueva TZ.
- [ ] **Allowed tags**: agregar / eliminar → el filtro de tags en portal aparece / desaparece y las chips coinciden.
- [ ] **Approval notification email**: guardarlo → al someter un evento que requiere aprobación, llega correo a esa dirección (si `settings.emails_enabled` está on).
- [ ] **Humans can create venues** / **Venues require approval**: se testean con el flujo de venues (ver §8).

---

## 2. Portal — Vista de lista (`/portal/[slug]/events`)

### Gate global
- [ ] Con `Events Enabled = OFF` → muestra "Events disabled" y oculta toolbar.
- [ ] Con `Events Enabled = ON` → carga lista.
- [ ] Popup **sin event_settings** → trata como ON + Everyone (lista carga, botón Create visible).

### Toolbar — botón Create
- [ ] `Who Can Create = Everyone` → botón **"+"** / "Create event" visible.
- [ ] `Who Can Create = Admins Only` → botón **oculto**.
- [ ] Popup sin settings → botón **visible** (default Everyone).
- [ ] Clicking abre `/portal/[slug]/events/new`.

### Toolbar — filtros y controles
- [ ] **My RSVPs**: toggle filtra sólo los eventos donde el human hizo RSVP.
- [ ] **My events** (icono Crown): filtra eventos cuyo `owner_id == current_human.id`.
- [ ] **Hidden**: deshabilitado cuando no hay ocultos; habilitado con contador cuando sí.
- [ ] **Tags filter**: aparece sólo si el popup tiene `allowed_tags`. Seleccionar chips filtra la lista. "Clear filters" vuelve todo.
- [ ] **Search**: debounce razonable, sin refetch en cada tecla duplicado.
- [ ] **List / Calendar switcher**: alterna sin recargar la URL; en mobile muestra sólo icono, label desaparece.

### Cards de evento
- [ ] Título, horario (en TZ del popup), venue, tags, y status chip.
- [ ] Recurring events muestran summary (`Every week on Mon`, etc.) o `Part of recurring series`.
- [ ] **RSVP inline**: botón "RSVP" / "Going" sólo en eventos `published`.
- [ ] **Hide / Unhide**: togglea y actualiza contador en toolbar.
- [ ] **Edit pencil**: visible sólo cuando `event.owner_id == current_human.id`.
- [ ] Evento oculto se renderiza con `opacity-60` y no aparece sin toggle "Hidden" activo.

### Performance / layout
- [ ] Lista carga sin spinner infinito cuando hay 0 eventos → empty state con icono.
- [ ] Scroll vertical funciona con `<main>` externo (la heading + toolbar scrollean con el contenido, no son sticky).

---

## 3. Portal — Vista de calendario

- [ ] Switcher cambia a la grilla mensual sin recargar.
- [ ] Día con eventos muestra marcador; click abre panel con lista de ese día.
- [ ] **Recurring events** aparecen en todas sus instancias (no sólo en el master).
- [ ] Navegación mes anterior / próximo mantiene popup + filtros.
- [ ] Día seleccionado en el panel lateral muestra título, kind, venue truncados (no rompen layout).

### Regression — horizontal overflow en mobile
- [ ] Abrir en viewport angosto (320–375 px) → **no** hay scroll horizontal del viewport.
- [ ] Evento con título muy largo en panel lateral → se trunca, no empuja el grid.
- [ ] Evento con venue_title + venue_location largos → se clampean dentro del card.

---

## 4. Portal — Crear evento (`/portal/[slug]/events/new`)

### Gates
- [ ] `Events Enabled = OFF` → muestra "Events disabled" (no el form).
- [ ] `Events Enabled = ON` + `Who Can Create = Admins Only` → muestra "Event creation is restricted" + "Only admins can create events for this pop-up" en los 3 idiomas.
- [ ] `Events Enabled = ON` + `Who Can Create = Everyone` → form carga.
- [ ] Popup sin settings → form carga (default Everyone).

### Backend enforcement (defensa en profundidad)
- [ ] `curl POST /api/v1/events/portal/events` con `can_publish_event=admin_only` → **403** (tanto para `status=draft` como `status=published`).
- [ ] Con `can_publish_event=everyone` → 201 para draft y published.
- [ ] Con `event_enabled=false` → 403 independientemente del resto.

### Campos del form
- [ ] Título required.
- [ ] Fecha / hora (en TZ del popup), duración con unidad (min / hs).
- [ ] Venue picker: lista sólo venues activas del popup; muestra hint de capacidad y booking mode.
- [ ] Visibility: public / unlisted / private.
- [ ] Max participants: warning cuando supera capacity de la venue.
- [ ] Meeting URL, tags (sólo chips del `allowed_tags`), track selector, cover image upload.
- [ ] Recurrence (RRULE): weekly / daily / custom según UI.

### Disponibilidad
- [ ] Al seleccionar venue + horario, llama `/events/check-availability` (debounced 500ms).
- [ ] Muestra conflicto si hay overlap; permite submit igual sólo si se confirma (validar flujo actual).

### Submit
- [ ] Evento sin venue approval → `PUBLISHED` + visible en lista.
- [ ] Venue con `booking_mode=approval_required` → evento cae en **`PENDING_APPROVAL`** + `visibility=UNLISTED`.
- [ ] `max_participants > venue.capacity` → también cae en `PENDING_APPROVAL`.
- [ ] En ambos casos "pending", el `approval_notification_email` recibe mail (si emails on).

---

## 5. Portal — Detalle del evento (`/portal/[slug]/events/[id]`)

- [ ] Cover image, título, descripción (markdown renderizado), horarios, venue, tags.
- [ ] Timezone label (`Times shown in <tz>`) correcto.
- [ ] **RSVP**: toggling funciona; después de RSVP, el usuario aparece en participantes.
- [ ] Max participants alcanzado → RSVP muestra waitlist / bloqueado según lógica.
- [ ] **Recurring**: muestra summary y, si aplica, link a otras instancias.
- [ ] **ICS export**: click descarga `.ics` con datetimes en UTC correctos.
- [ ] **Edit** button: sólo visible para owner.
- [ ] **Hide / Unhide**: funciona y persiste entre refreshes.

---

## 6. Portal — Editar evento (`/portal/[slug]/events/[id]/edit`)

- [ ] Solo el owner ve la página; otro human → 403 / redirect.
- [ ] Cambios al título / descripción / horario persisten.
- [ ] Cambiar venue / max_participants que fuerzan approval → evento re-cae en `PENDING_APPROVAL` (verificar lógica actual).
- [ ] Cancelar un evento recurring: ofrece "this occurrence" / "this and following" / "all".
- [ ] Editar un solo occurrence (detach) lo convierte en standalone sin tocar el master.

---

## 7. Backoffice — Event approval (`/events` list)

- [ ] Eventos `PENDING_APPROVAL` aparecen con chip distintiva.
- [ ] Click **Approve** → promueve a `PUBLISHED` + `PUBLIC`; dispara correo al owner.
- [ ] Click **Reject** → marca `REJECTED`; dispara correo con razón.
- [ ] Aprobar / rechazar un evento que no está pending → 400.
- [ ] Admin puede crear eventos vía backoffice incluso con `Who Can Create = Admins Only`.
- [ ] Admin puede editar / cancelar cualquier evento del tenant.

---

## 8. Backoffice — Venues (`/events/venues`)

- [ ] Lista venues del popup con status chips.
- [ ] Crear venue (nombre, location, capacity, booking_mode, setup/teardown minutes, horarios multi-slot).
- [ ] Toggle `status = active / inactive` → inmediatamente refleja en portal.
- [ ] Con `humans_can_create_venues = true`, portal expone la creación de venues.
- [ ] Con `venues_require_approval = true`, las venues creadas desde portal caen en `PENDING`.
- [ ] Admin PATCH `status=active` mueve la venue a portal.

---

## 9. Timezone

Escenario clave: popup en Asia/Tokyo, browser en America/Argentina/Buenos_Aires.

- [ ] Evento creado desde backoffice con `start_time = 2026-05-01 10:00 JST` muestra:
  - Backoffice list / detail: `10:00 JST` (consistente con popup tz).
  - Portal list / detail: `10:00 JST` (popup tz), **no** `-13h` del browser.
- [ ] Cambiar `timezone` en event_settings → todos los eventos del popup re-renderean con la nueva TZ sin rebuild.
- [ ] Calendar grid agrupa por día de la **TZ del popup**, no del browser.

---

## 10. Recurring events

- [ ] Crear evento con RRULE weekly → portal list muestra todas las ocurrencias dentro de la ventana de 180 días (desde hoy).
- [ ] Master fuera de la ventana pero con ocurrencias dentro → ocurrencias **aparecen** (fix de `include recurring masters outside start_time window`).
- [ ] Exdates: detach una ocurrencia → desaparece del calendar pero el evento detached existe como standalone.
- [ ] Cancelar occurrence → no aparece más en ese día.
- [ ] Cambiar RRULE en el master → ocurrencias futuras se regeneran; pasadas quedan como están.

---

## 11. Mobile / responsive

Probar en 320 px, 375 px, y 768 px.

- [ ] **Events list page**: toolbar ocupa como máximo dos filas; nada se corta.
- [ ] **Events list cards**: título truncado, no se sale del card.
- [ ] **Calendar grid**: ni el calendar ni el panel lateral causan scroll horizontal del viewport.
- [ ] **Event form**: inputs full-width, venue picker scrollable.
- [ ] **Event detail**: cover responsive, descripción no rompe con links largos.
- [ ] Switching List/Calendar en mobile conserva label activa + icono; inactiva muestra sólo icono.

---

## 12. Edge cases / estados "null"

- [ ] Popup sin row en `event_settings`:
  - Portal lista carga (treated as `enabled=true`, `everyone`).
  - Botón Create visible.
  - `/events/new` carga form (no gate).
  - Backend POST `/portal/events` → 201 (sin settings → sin bloqueo).
- [ ] Popup con `event_enabled=false` pero eventos existentes → portal oculta la sección entera.
- [ ] Human sin RSVP history → "My RSVPs" filter muestra empty state.
- [ ] Popup sin venues → create form permite crear sin venue (si la lógica actual lo permite).
- [ ] Popup con `allowed_tags=[]` → filter de tags **no** se renderiza.

---

## 13. API smoke tests (curl)

Ajustar `$TOKEN` y `$POPUP_ID`:

```bash
# Portal endpoints
curl -H "Authorization: Bearer $HUMAN_TOKEN" /api/v1/events/portal/settings/$POPUP_ID
curl -H "Authorization: Bearer $HUMAN_TOKEN" "/api/v1/events/portal/events?popup_id=$POPUP_ID"
curl -H "Authorization: Bearer $HUMAN_TOKEN" -X POST /api/v1/events/portal/events \
  -H "Content-Type: application/json" \
  -d '{"popup_id":"'$POPUP_ID'","title":"t","start_time":"...","end_time":"...","status":"draft"}'

# Backoffice
curl -H "Authorization: Bearer $ADMIN_TOKEN" /api/v1/event-settings/popups/$POPUP_ID
curl -H "Authorization: Bearer $ADMIN_TOKEN" -X PATCH /api/v1/event-settings/popups/$POPUP_ID \
  -H "Content-Type: application/json" \
  -d '{"can_publish_event":"admin_only"}'
```

Esperar:
- Portal POST con `admin_only` setting → **403** `"Only admins can create events for this popup"`.
- Portal POST con `everyone` → 201.
- Portal POST con `event_enabled=false` → 403 `"Event creation is disabled for this popup"`.

---

## Regression check — commits recientes

Verificar rápido que estos fixes siguen funcionando:

- [ ] `fix(backoffice): render event times in popup tz and fix new-event tz race` — abrir backoffice new event form sin seleccionar TZ todavía; no debería haber flicker.
- [ ] `fix(portal): fit events toolbar in two rows on mobile` — toolbar en 375 px no supera 2 filas.
- [ ] `refactor(backoffice): inline venue row actions instead of dropdown menu` — acciones de venue row son botones inline, no dropdown.
- [ ] `fix(backend): include recurring masters outside start_time window for expansion` — ver §10.
- [ ] `fix(portal): prevent events page horizontal overflow on mobile` — ver §11.
- [ ] `refactor(portal): use Crown icon for my-events toolbar button` — ver §2.
- [ ] `feat(events): rename setting to "Who Can Create Events" and gate creation entirely` — ver §1, §2, §4.
