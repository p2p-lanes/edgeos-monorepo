# Modular Ticketing Steps

Implementación de un sistema de pasos de checkout configurables por popup, reemplazando el flujo hardcodeado anterior.

---

## Resumen de cambios

### Qué había antes

El portal tenía un switch hardcodeado en `CheckoutFlow.tsx` que siempre mostraba los pasos en el mismo orden:
`passes → housing → merch → patron → confirm`

No había forma de reordenarlos, renombrarlos, deshabilitarlos ni agregar nuevos sin modificar el código del portal.

### Qué hay ahora

- El backend almacena la configuración de pasos por popup en la tabla `ticketingsteps`
- El backoffice tiene un builder drag-and-drop para configurarlos
- El portal consume la API y construye el flujo dinámicamente
- Agregar un nuevo tipo de paso (`airport_rides`, etc.) requiere cambios mínimos y localizados

---

## Backend

### Nueva tabla: `ticketingsteps`

| Columna       | Tipo      | Descripción                                      |
|---------------|-----------|--------------------------------------------------|
| `id`          | UUID PK   | Generado automáticamente                         |
| `tenant_id`   | UUID FK   | Referencia a `tenants.id`                        |
| `popup_id`    | UUID FK   | Referencia a `popups.id`                         |
| `step_type`   | string    | Identificador del tipo: `tickets`, `housing`, etc. |
| `title`       | string    | Nombre visible del paso                          |
| `description` | string?   | Descripción opcional mostrada al usuario         |
| `order`       | int       | Posición en el flujo (0-based)                   |
| `is_enabled`  | bool      | Si el paso aparece en el checkout                |
| `protected`   | bool      | Si no puede eliminarse ni deshabilitarse         |

### Pasos por defecto (seeded por popup)

| `step_type`          | `title`           | `order` | `is_enabled` | `protected` |
|----------------------|-------------------|---------|--------------|-------------|
| `tickets`            | Tickets           | 0       | ✅           | ❌          |
| `housing`            | Housing           | 1       | ✅           | ❌          |
| `merch`              | Merchandise       | 2       | ✅           | ❌          |
| `patron`             | Patron            | 3       | ✅           | ❌          |
| `insurance_checkout` | Insurance         | 4       | ❌           | ❌          |
| `confirm`            | Review & Confirm  | 5       | ✅           | ✅          |

> `insurance_checkout` viene deshabilitado por defecto. `confirm` es `protected=true`: no puede eliminarse ni deshabilitarse.

### Archivos nuevos

```
backend/app/api/ticketing_step/
├── __init__.py        — exporta router
├── models.py          — SQLModel table TicketingSteps
├── schemas.py         — TicketingStepBase, TicketingStepPublic, TicketingStepCreate, TicketingStepUpdate
├── crud.py            — TicketingStepsCRUD (find_by_popup, find_portal_by_popup)
├── router.py          — endpoints FastAPI
└── constants.py       — DEFAULT_TICKETING_STEPS + seed_ticketing_steps_for_popup()

backend/app/alembic/versions/0021_add_ticketing_steps.py
```

### Archivos modificados

| Archivo | Cambio |
|---|---|
| `backend/app/api/router.py` | Registra `ticketing_step.router` |
| `backend/app/models.py` | Importa y exporta `TicketingSteps`, `TicketingStepCreate`, `TicketingStepPublic`, `TicketingStepUpdate` |
| `backend/app/api/popup/models.py` | Agrega relación `ticketing_steps` con `cascade_delete=True` |
| `backend/app/api/popup/router.py` | Llama a `seed_ticketing_steps_for_popup()` al crear un popup |
| `backend/app/api/tenant/models.py` | Agrega relación `ticketing_steps` con `cascade_delete=True` |
| `backend/app/core/db.py` | Llama a `_seed_ticketing_steps()` en `init_db()` para popups existentes |

---

## API Endpoints

Base path: `/api/v1/ticketing-steps`

### `GET /ticketing-steps/portal?popup_id=<UUID>`
**Sin autenticación.** Uso exclusivo del portal.
Devuelve solo los pasos con `is_enabled=true`, ordenados por `order`.

```json
{
  "results": [
    {
      "id": "...",
      "popup_id": "...",
      "tenant_id": "...",
      "step_type": "tickets",
      "title": "Tickets",
      "description": null,
      "order": 0,
      "is_enabled": true,
      "protected": false
    },
    {
      "step_type": "housing",
      "title": "Housing",
      "order": 1,
      ...
    },
    {
      "step_type": "confirm",
      "title": "Review & Confirm",
      "order": 5,
      "protected": true,
      ...
    }
  ],
  "paging": { "offset": 0, "limit": 5, "total": 5 }
}
```

---

### `GET /ticketing-steps?popup_id=<UUID>`
**Requiere autenticación.** Uso del backoffice.
Devuelve todos los pasos (habilitados y deshabilitados), ordenados por `order`.

---

### `GET /ticketing-steps/<step_id>`
**Requiere autenticación.**
Devuelve un paso específico por ID.

---

### `POST /ticketing-steps`
**Requiere rol ADMIN o SUPERADMIN.**
Crea un paso personalizado. Body:

```json
{
  "popup_id": "<UUID>",
  "step_type": "airport_rides",
  "title": "Airport Rides",
  "description": "Book your shuttle",
  "order": 3,
  "is_enabled": true
}
```

---

### `PATCH /ticketing-steps/<step_id>`
**Requiere rol ADMIN o SUPERADMIN.**
Actualiza parcialmente un paso. Todos los campos son opcionales.

```json
{
  "title": "Nuevo título",
  "order": 2,
  "is_enabled": false
}
```

> ⚠️ Intentar poner `is_enabled: false` en un paso `protected=true` devuelve HTTP 400.

---

### `DELETE /ticketing-steps/<step_id>`
**Requiere rol ADMIN o SUPERADMIN.**
Elimina un paso.

> ⚠️ Intentar eliminar un paso `protected=true` devuelve HTTP 400.

---

## Backoffice

### Nueva ruta

`/ticketing-steps` — accesible desde el sidebar con el ícono `LayoutList`.

### Comportamiento esperado

1. **Carga**: al entrar, se muestran los 6 pasos del popup seleccionado ordenados por `order`
2. **Reordenar**: arrastrar una card actualiza el `order` de todos los pasos afectados via `PATCH` individual
3. **Renombrar**: hacer clic en el título de una card lo convierte en un input editable; al perder el foco hace `PATCH` con el nuevo título
4. **Habilitar/deshabilitar**: el `Switch` en cada card hace `PATCH { is_enabled: true/false }`. Está deshabilitado si `protected=true`
5. **Editar detalles**: el botón del lápiz abre un Sheet con campos de título y descripción; al guardar hace `PATCH`
6. **Badge "Protected"**: aparece en el paso `confirm` para indicar que no puede eliminarse ni deshabilitarse

### Archivos nuevos

```
backoffice/src/components/ticketing-step-builder/
├── constants.ts          — STEP_TYPE_DEFINITIONS (íconos por step_type)
├── StepCanvas.tsx         — SortableContext que renderiza las cards
├── SortableStepCard.tsx   — Card individual con drag handle, toggle, edición inline
└── StepConfigPanel.tsx    — Sheet para editar título y descripción

backoffice/src/routes/_layout/ticketing-steps/
└── index.tsx              — Página principal con DndContext
```

### Archivos modificados

| Archivo | Cambio |
|---|---|
| `backoffice/src/components/Sidebar/AppSidebar.tsx` | Agrega entrada "Ticketing Steps" al menú de popup items |
| `backoffice/src/routeTree.gen.ts` | Auto-generado por TanStack Router al agregar la nueva ruta |
| `backoffice/src/client/sdk.gen.ts` | `TicketingStepsService` con todos los métodos |
| `backoffice/src/client/types.gen.ts` | Tipos `TicketingStepPublic`, `TicketingStepCreate`, `TicketingStepUpdate` |

---

## Portal

### Comportamiento esperado

1. **Carga**: `checkoutProvider` llama a `GET /ticketing-steps/portal?popup_id=<id>` al montar
2. **Flujo dinámico**: `useCheckoutSteps` construye `availableSteps` desde la respuesta de la API en lugar del switch hardcodeado
3. **Filtrado por productos**: aunque un paso esté habilitado en la API, se omite si no hay productos de ese tipo (housing sin productos de housing no aparece)
4. **Fallback**: si la API aún no respondió (`configuredSteps.length === 0`), usa el orden basado en conteo de productos como antes
5. **Títulos dinámicos**: `CheckoutFlow` busca el `title` y `description` del paso actual en `stepConfigs` para mostrarlo en el header; si no lo encuentra usa los defaults
6. **Registro de componentes**: `STEP_COMPONENT_REGISTRY` mapea cada `step_type` a su componente React

### Mapeo step_type → componente

| `step_type`          | Componente              | Notas                                      |
|----------------------|-------------------------|--------------------------------------------|
| `tickets`            | `PassSelectionSection`  | Manejado directamente en CheckoutFlow (requiere `onAddAttendee`) |
| `housing`            | `HousingStep`           | Via registry                               |
| `merch`              | `MerchSection`          | Via registry                               |
| `patron`             | `PatronSection`         | Via registry                               |
| `insurance_checkout` | `ConfirmStep`           | Placeholder hasta que exista InsuranceStep |
| `confirm`            | `ConfirmStep`           | Via registry                               |
| `success`            | `SuccessStep`           | Manejado directamente (requiere `paymentStatus`) |

> `"tickets"` se mapea internamente a `"passes"` en `toCheckoutStep()` por compatibilidad con el código existente.

### Archivos nuevos

```
portal/src/app/checkout/components/stepRegistry.tsx
```

### Archivos modificados

| Archivo | Cambio |
|---|---|
| `portal/src/types/checkout.ts` | Agrega `"tickets"` e `"insurance_checkout"` al union `CheckoutStep` |
| `portal/src/providers/checkoutProvider.tsx` | Fetch de pasos desde API, expone `stepConfigs` en el contexto |
| `portal/src/hooks/checkout/useCheckoutSteps.ts` | Acepta `configuredSteps` y construye el flujo desde la API |
| `portal/src/app/checkout/components/CheckoutFlow.tsx` | Usa `STEP_COMPONENT_REGISTRY` y `stepConfigs` para títulos |
| `portal/src/client/sdk.gen.ts` | `TicketingStepsService` con `listPortalTicketingSteps` |
| `portal/src/client/types.gen.ts` | Tipos correspondientes |

---

## Cómo agregar un nuevo tipo de paso

Ejemplo: `airport_rides`

1. **`backend/app/api/ticketing_step/constants.py`** — agregar al array `DEFAULT_TICKETING_STEPS`:
   ```python
   {"step_type": "airport_rides", "title": "Airport Rides", "order": 4, "is_enabled": False, "protected": False}
   ```

2. **Nueva migración** — seedear para popups existentes (mismo patrón que `0021_add_ticketing_steps.py`)

3. **`backoffice/src/components/ticketing-step-builder/constants.ts`** — agregar entrada:
   ```typescript
   { step_type: "airport_rides", defaultTitle: "Airport Rides", icon: Car }
   ```

4. **Crear** `portal/src/app/checkout/components/steps/AirportRidesStep.tsx`

5. **`portal/src/app/checkout/components/stepRegistry.tsx`** — un import + una línea:
   ```typescript
   import AirportRidesStep from "./steps/AirportRidesStep"
   // ...
   airport_rides: AirportRidesStep,
   ```

6. **`portal/src/types/checkout.ts`** — agregar `"airport_rides"` al union `CheckoutStep`

> No requiere cambios en router, CRUD, provider ni CheckoutFlow.

---

## Migración

`backend/app/alembic/versions/0021_add_ticketing_steps.py`

- **upgrade**: crea la tabla `ticketingsteps` y siembra los 6 pasos por defecto para todos los popups existentes
- **downgrade**: elimina la tabla completa
- Se ejecuta automáticamente con `alembic upgrade head` (o via `prestart.sh` en el servidor)
