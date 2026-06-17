# Refactor conceptual del schema — EdgeOS

> Documento de discusión de modelo. En evolución.
> Fecha inicio: 2026-05-27

## TL;DR

**Se propone refactorizar el schema de EdgeOS** en la zona "asistencia a un popup" (las 6 tablas alrededor de attendees, applications, products, tickets, payments) para simplificarlo a 5 tablas core. Los motivos:

- **A. Duplicación de información.** La identidad del usuario vive en `humans` Y en `attendees`; el snapshot del producto al momento de compra vive en `payment_products` cuando podría vivir en cada ticket. Esto fuerza código de reconciliación específico (ej. `link_attendees_to_human`) que existe solo para mantener coherentes datos que no deberían estar duplicados.

- **B. Conceptos ortogonales están acoplados.** Hoy "pago" y "registración" son la misma tabla (`payments` con `amount=0` para gratuitos), y "stock" depende del lifecycle de Payment. Esto entrelaza features que deberían ser independientes: emitir un ticket gratis tiene que pasar por la maquinaria de un Payment falso; mover stock requiere pasar por el lifecycle de un Payment incluso cuando no hay dinero.

- **C. Cada feature nueva paga un impuesto creciente.** [Ver ejemplo](#caso-revelador-feature-de-admin-grants).

**Idea central**: un human aplica a un popup (applications) y/o compra productos (payments → tickets). Cada ticket es un link entre un human y un product. *Los humans tienen productos en forma de tickets.*

**5 tablas core en el modelo objetivo:**

| Tabla | Rol |
|---|---|
| `humans` | Personas |
| `applications` | Submission de un human a un popup (intención/solicitud) |
| `products` | Catálogo del popup |
| `tickets` | Derecho de un human a un producto — la entidad central |
| `payments` | Transacciones monetarias |

**Tablas a eliminar:**
- `attendees` — su rol (identidad ad-hoc + vínculo human↔popup) se absorbe en `humans` + `tickets`.
- `attendee_products` — solo existía como link a través de attendees; sin attendees pierde sentido. Su data viva (check_in_code, metadata, status) pasa a ser propiedad del ticket.
- `payment_products` — su rol (snapshot del producto al momento de la compra) se embebe en cada `tickets` row como campos denormalizados.

---

## Modelo actual

Seis entidades alrededor de la asistencia a un popup:

```
humans              ← identidad global, requiere email
applications        ← submission a un popup (1 human × 1 popup → 1 application)
attendees           ← vínculo human↔popup + atributos (name, email, gender, category, poap_url)
                      human_id NULLABLE (para +1 sin cuenta)
                      application_id NULLABLE (para direct-sale)
attendee_products   ← link "tickets de un attendee" (1 row = 1 ticket, check_in_code, payment_id nullable)
payments            ← transacción (también amount=0 para free direct-sale)
payment_products    ← snapshot del producto al momento del payment, con quantity y attendee_id
```

Problemas observados en este modelo:

- `attendees` carga dos roles a la vez: (a) identidad ad-hoc para guests sin cuenta, (b) vínculo human↔popup con atributos. Esa ambigüedad obliga a `human_id` nullable y a código de reconciliación (`link_attendees_to_human`).
- `attendee_products` solo tiene sentido como "productos de un attendee". Sin `attendees`, la idea no existe — los productos son del *human*, no del attendee.
- `payment_products` repite información del producto en otra tabla porque históricamente el ticket no llevaba precio. Genera doble-bookkeeping con `attendee_products` (mismo evento, dos representaciones: línea agregada con quantity vs. tickets individuales).
- `Payment` es la puerta de entrada al popup en direct-sale, incluso cuando no hay dinero involucrado. Eso fuerza payments-de-cero y mezcla "transacción" con "registración".
- `stock` se mueve por eventos del Payment lifecycle. Cualquier emisión fuera de Payment (admin grant, comp) tiene que duplicar la lógica de stock.

---

## Modelo objetivo

```
humans
  email NULLABLE                              ← permite +1 sin email
  (campos de perfil — sin cambios)

applications
  human_id NOT NULL, popup_id NOT NULL
  status: draft | in_review | accepted | rejected | ...
  custom_fields, referral, ...
  (sin cambios estructurales)

products
  popup_id, name, description, price, currency, category
  total_stock_cap                             ← techo (NULL = ilimitado)
  total_stock_remaining                       ← contador vivo (NULL = sin tracking)
  shared_stock_cap / shared_stock_remaining   ← para tier-groups
  max_per_order, requires_check_in, ...
  (sin cambios estructurales — el contador de stock sigue acá, pero su trigger cambia, ver Cambio 4)

tickets    ← entidad central (link humans × products)
  human_id NOT NULL                           ← a nombre de quién está el ticket
  purchaser_human_id NULLABLE                 ← quién lo compró (si difiere del recipient)
  product_id (FK)                             ← qué producto
  payment_id NULLABLE                         ← bajo qué transacción (NULL = free / comp)
  application_id NULLABLE                     ← si vino de una application
  category_id, poap_url                       ← atributos por-ticket
  invited_by_human_id NULLABLE                ← quién invitó (per-evento, no per-human)
  granted_by_user_id NULLABLE                 ← si fue admin comp
  status: pending_payment | issued | canceled | refunded
  product_name_at_issuance                    ← SNAPSHOT del producto al momento de emisión
  product_price_at_issuance                   ← SNAPSHOT
  product_currency_at_issuance                ← SNAPSHOT
  product_category_at_issuance                ← SNAPSHOT
  check_in_code, purchase_metadata, issued_at

payments
  human_id NOT NULL                           ← quién pagó
  amount > 0 invariante                       ← no más payments de cero
  currency, status, source
  popup_id, coupon_id, credit_applied
  (sin tabla intermedia — las "líneas de orden" son las tickets con ese payment_id)
```

**Idea conceptual**: cada tabla responde una pregunta única.

- `humans` → ¿quién es esta persona?
- `applications` → ¿qué solicitó esta persona para participar de un popup?
- `products` → ¿qué se puede comprar?
- `tickets` → ¿quién tiene derecho a un producto?
- `payments` → ¿cuánta plata se movió y cómo?

Un human puede aplicar a un popup (application), comprar productos (payment), y/o recibir tickets emitidos a su nombre por sí mismo o por otros. Los tres flujos (application-based, direct-sale, admin grant) producen tickets — la diferencia está en cómo se generaron, no en la entidad resultante.

**Qué cuenta como "ticket"**: cualquier producto del catálogo emitido a un human. Eso incluye entry passes / weekend passes / day passes, pero también **meal plans, donaciones patron, merch, y cualquier otra cosa que sea un producto del popup**. El flag `products.requires_check_in` distingue los productos que necesitan QR/escaneo de los que no — pero el ticket existe como entidad para ambos. Un meal plan es un ticket cuyo producto no requiere check-in; un weekend pass es un ticket cuyo producto sí lo requiere. La diferencia está en el producto, no en el ticket.

---

## Tabla resumen consolidada

| Aspecto | Hoy | Propuesto |
|---|---|---|
| Identidad de persona | `humans` + duplicado parcial en `attendees` | Solo `humans` |
| +1 sin cuenta | `attendees.human_id=NULL` | `humans` row directo (sin distinción especial) |
| Email en `humans` | Required (unique constraint) | Nullable (para +1 sin email — ej. menores) |
| Vínculo human↔popup | `attendees` (entidad) | Derivado de `tickets` (o VIEW por compat) |
| Vínculo human↔producto | `attendee_products` vía `attendees` | `tickets.human_id` + `tickets.product_id` directo |
| Atributos de asistencia (category, poap_url) | `attendees.*` (uno por persona×popup) | `tickets.*` (uno por ticket — más expresivo) |
| Tickets de Alice como main + staff | Imposible (category es por attendee) | Posible (category por ticket) |
| Snapshot del producto al comprar | `payment_products` con `quantity` agregada | Denormalizado en cada `tickets` (`product_name_at_issuance`, `product_price_at_issuance`, etc.) |
| "Comprar ticket para otra persona" | Workaround vía attendees + `creator_attendee_id` | `tickets.purchaser_human_id` ≠ `tickets.human_id` |
| Invitación / +1 lineage | No tracking | `tickets.invited_by_human_id` (per-evento) |
| Admin comp ticket | Payment sintético `amount=0` + nueva columna `granted_by_user_id` en payments | `tickets.granted_by_user_id` directamente, sin Payment |
| Direct-sale gratuito | Payment con `amount=0` | Sin Payment; ticket emitido directo |
| Direct-sale pago | Payment + attendee + ticket en webhook | Payment + ticket `pending_payment` → `issued` |
| Application aceptada | Attendee creado, ticket emitido al pagar | Ticket emitido directo (free) o vía Payment (paid) |
| Reconciliación al login del +1 | `link_attendees_to_human` específico | Auth resuelve por email match — sin código de merge |
| `payments.amount = 0` | Existe (free direct-sale) | Invariante: `amount > 0` |
| Stock decrement trigger | Payment PENDING/APPROVED/CANCELED | INSERT/DELETE en `tickets` |
| Stock para comp tickets | Lógica duplicada en `add_product` | Automático (es un ticket más) |
| Trigger único de emisión de ticket | Payment APPROVED webhook | Múltiples paths (free, paid, admin, accepted) |

---

## Caso revelador: feature de admin grants

Hay un documento de diseño (`admin-free-ticket-grants.md`, 2026-05-27) que propone agregar la capacidad de "admin asigna tickets gratis en bulk". Es un caso simple: admin selecciona personas, selecciona productos, click → tickets emitidos. No hay dinero.

**Para encajar en el schema actual la feature requiere:**

1. **Una columna nueva nullable en `Payments`** (`granted_by_user_id`) para distinguir "admin comp" de "payment real con cupón 100%-off". El doc lo dice textual:
   > "Avoids overloading `source`; `source` stays `NULL`. Fallback: add `PaymentSource.ADMIN_GRANT` — rejected because it muddies settlement-rail semantics."

2. **Crear un Payment sintético con `amount=0`** — porque hoy el único camino para emitir un ticket es a través de un Payment.
   > "Record as a synthetic $0 payment. […] consistent with how every other ticket exists."

3. **Extraer un helper nuevo** `_approve_free_payment()` porque `create_payment()` está construido como pricing engine y no se puede configurar limpiamente para un comp (la §4.1 entera del doc explica por qué).

4. **§7 enumera 12+ "considerations"** — la mayoría son artefactos del acoplamiento: patron products bypass de validación, edit_passes branch borrando tickets, stock decrement entrelazado con Payment lifecycle, etc.

**Cada workaround mapea a uno de los cambios del refactor:**

| Workaround en admin-grants | Cambio del refactor que lo elimina |
|---|---|
| Columna `granted_by_user_id` nullable en `Payments` | Cambio 3 — payments-de-cero no existen, comp es un ticket directo |
| Payment sintético con `amount=0` | Cambio 3 — emisión desacoplada de Payment |
| Helper `_approve_free_payment()` extraído | Cambios 2 + 3 — ticket es la entidad central |
| Stock decrement vía Payment lifecycle | Cambio 4 — stock en INSERT/DELETE de tickets |
| `attendee_id` propagado por todos lados | Cambios 1 + 2 — ticket habla directo con human |

Con el modelo refactorizado el endpoint de admin grants sería:

```python
for person in people:
    human = find_or_create_human(person.email, person.name)
    for product, qty in products:
        for _ in range(qty):
            tickets_crud.issue(
                human_id=human.id,
                product_id=product.id,
                granted_by_user_id=current_user.id,
            )
# commit, enviar emails
```

Sin payment sintético, sin nueva columna, sin helper extraído. **Este caso no es teórico** — el patrón se va a repetir en cada feature nueva (RSVP simple, ticket transfers, refund parcial, gift tickets, discount codes en free items). Cada una va a pagar el mismo impuesto hasta que se haga el refactor.

---

## Cambio 1: eliminar `attendees`, consolidar identidad en `humans`

### Por qué existe hoy

Históricamente `attendees` resolvía tres problemas a la vez:
1. Vincular un human a un popup con atributos por-evento (`category`, `poap_url`).
2. Permitir "guests sin cuenta" como identidades temporales (`human_id` nullable).
3. Contener tickets para applications multi-attendee (familia, +1s).

Era razonable cuando applications eran el único modelo.

### Por qué deberíamos cambiarlo

- **Duplicación de identidad**: `name`, `email`, `gender` viven también en `humans`. Hay que mantenerlos sincronizados con lógica específica (`link_attendees_to_human`).
- **Ambigüedad semántica**: una entidad cumple dos roles (identidad ad-hoc + vínculo), obligando a `human_id` nullable.
- **Limita expresividad por-ticket**: category es por attendee — imposible que Alice tenga 1 ticket `main` + 1 `staff` en el mismo popup.
- **Bloquea features**: invitations tracking, ticket transfers, multi-role attendance — todas se vuelven más simples si el ticket es el vínculo.

### Propuesta

- Convertir "+1 sin cuenta" en un row de `humans` sin tratamiento especial. Si en el futuro esa persona se loguea con su email, la capa de auth resuelve la identidad por email match — no hace falta lógica de "claim" en la base.
- Hacer `email` nullable en `humans` para casos sin email (menores, registración manual sin email).
- Mover `category_id`, `poap_url` a `tickets`.
- Agregar `tickets.invited_by_human_id` (per-evento) para captura de "quién trajo a quién".

### Beneficios

1. Single source of truth para identidad: solo `humans`.
2. Modelo mental simple: cada tabla con un rol único.
3. Expresividad por-ticket: category, role, invited_by son atributos del ticket.
4. Invitation tracking rico: red de invitaciones por evento.
5. Reduce código de reconciliación: `link_attendees_to_human` desaparece.
6. Unifica direct-sale y application-based en un solo path.
7. POAP / certificados son artefactos naturales del ticket.

### Contras

1. **Migración grande**: cada attendee → human (o reuso del existente si `human_id` ya estaba); referencias migradas.
2. **Inflación de `humans`**: cada +1 sin cuenta es una fila más; búsquedas y exports requieren filtrar por criterios (ej. "tiene tickets" o "tiene login activity") para no incluir contactos secundarios.
3. **Email nullable**: relaja un constraint hoy de facto required. La unique constraint sobre `(email, tenant_id)` sigue funcionando porque NULLs no chocan en Postgres.
4. **Pierde concepto explícito "attendee"** en el vocabulario; mitigable con VIEW.
5. **"Attendee sin ticket" deja de existir**: application aceptada → emisión de ticket (free para popups gratuitos).
6. **Breaking changes en API/frontend**: endpoints `AttendeePublic`, hooks `useAttendee*`, etc.
7. **Display name override** (`attendees.name` vs `human.full_name`) requiere decisión.
8. **Resolución de conflictos al login**: si alguien se loguea con email que ya existe como human creado por otro, la capa de auth tiene que decidir si actualizar campos vacíos, sobrescribir, o preguntar. No es código nuevo necesariamente (ya existe lógica similar), pero hay que definir la política.

### Decisiones de producto

- ¿Email nullable en `humans`?
- ¿Cómo se filtran humans "secundarios" (creados como +1, sin actividad propia) de listas administrativas y exports?
- Política de resolución cuando un human con email X se loguea y ya existe otro human con email X (auto-match? confirmación? fill-only de campos vacíos?).
- Display name override (nickname global vs override por ticket vs no existe).

---

## Cambio 2: eliminar `attendee_products` y `payment_products`, unificar en `tickets`

### Por qué existen hoy

- **`attendee_products`** (`backend/app/api/attendee/models.py:20`) — link entre attendee y product. 1 row = 1 ticket, con `check_in_code`, `payment_id`, `purchase_metadata`. Antes era una link table con `quantity`; se promovió a "first-class Ticket entity" pero el naming quedó.
- **`payment_products`** (`backend/app/api/payment/models.py:22`) — snapshot agregado del producto al momento del payment, con `quantity`, `product_name`, `product_price`, `product_currency`, etc. Existe porque el ticket históricamente no llevaba precio: alguien tenía que recordar a qué precio se cobró.

Las dos tablas representan **el mismo evento de compra** en granularidades distintas:
- `payment_products`: agregado por línea de orden (1 row con `quantity=3`).
- `attendee_products`: expandido (3 rows, una por ticket).

### Por qué deberíamos cambiarlo

- **`attendee_products` no existe sin `attendees`**: el nombre y el concepto solo tienen sentido si attendees es la entidad central. En el modelo objetivo, los productos son del *human* (vía ticket), no del attendee.
- **`payment_products` duplica información**: cada ticket podría cargar su propio snapshot y todas las queries de "qué se cobró en este payment / por este producto" siguen siendo directas.
- **Doble-bookkeeping**: la lógica tiene que mantener ambas tablas coherentes en cada compra. Es código innecesario.
- **Bloquea casos naturales**: "Alice compra ticket para Bob" hoy no se modela limpio (¿attendee de Alice? ¿attendee nuevo para Bob? `creator_attendee_id`?). Con un ticket que tiene `human_id` y `purchaser_human_id` separados, es trivial.

### Propuesta

Una sola entidad `tickets` que captura el link humans × products + todo lo que hoy vive en las otras dos tablas:

```
tickets
  human_id NOT NULL                  ← recipient (quien tiene derecho)
  purchaser_human_id NULLABLE        ← quien lo compró (si difiere)
  product_id (FK)                    ← qué producto
  payment_id NULLABLE                ← si vino de una transacción
  application_id NULLABLE            ← si vino de una application
  status                             ← pending_payment | issued | canceled | refunded
  check_in_code                      ← ya existe en attendee_products
  purchase_metadata                  ← ya existe en attendee_products
  product_name_at_issuance           ← MIGRA de payment_products
  product_price_at_issuance          ← MIGRA de payment_products
  product_currency_at_issuance       ← MIGRA de payment_products
  product_category_at_issuance       ← MIGRA de payment_products
  category_id, poap_url              ← MIGRA de attendees (Cambio 1)
  invited_by_human_id NULLABLE       ← nuevo
  granted_by_user_id NULLABLE        ← nuevo
  issued_at
```

### Beneficios

1. **Una sola entidad** representa "ticket": identidad + qué + cuándo + a qué precio + para quién.
2. **"Comprar para otra persona" se vuelve natural**: `human_id` ≠ `purchaser_human_id`. Captura gift tickets, corporate purchases, +1 paid by host.
3. **No más doble-bookkeeping**: una compra crea N tickets, fin. Sin mantener `payment_products` coherente.
4. **Refunds parciales naturales**: marcás 1 de 5 tickets como `refunded`. El payment financiero se reconcilia aparte.
5. **Queries más simples**: "qué se compró en este payment" → `SELECT * FROM tickets WHERE payment_id=X`. Sin joins.
6. **Admin comp directo**: `tickets.granted_by_user_id` sin Payment sintético.
7. **Habilita features futuras**: transferencias (`transferred_from_human_id`), substituciones, etc. se modelan limpio.

### Contras

1. **Migración**: backfillear snapshot a cada ticket existente desde `payment_products` antes de dropear esa tabla.
2. **Inflación de columnas en `tickets`**: 4-5 snapshot fields denormalizados. Para EdgeOS es irrelevante (storage no es bottleneck); para sistemas a escala billones podría importar.
3. **Pierde la vista "línea de orden con quantity"**: hoy 1 row con `quantity=3`; mañana 3 rows. Reconstruible con `GROUP BY product_id`, pero un cambio mental para queries.
4. **Reporting queries cambian**: `SUM(price * quantity)` → `SUM(price_at_issuance)`. Funcionalmente equivalente.
5. **Breaking change en API**: contratos de `PaymentProducts`, `AttendeeProducts` desaparecen.

### Decisiones de producto

- ¿Snapshot como columnas denormalizadas o como JSONB? (Recomendado: columnas, por queryability.)
- Política de refunds (DELETE vs status='refunded'). El refactor asume status update.
- ¿`payments` necesita campos agregados (subtotal, fees, tax) o todo se deriva de tickets? Probablemente `payments` carga el monto total y campos no-ticket (fees, processing), mientras tickets cargan los line items.

---

## Cambio 3: eliminar payments-de-cero, desacoplar emisión de ticket del Payment

### Por qué existe hoy

El flujo direct-sale (`payment/crud.py:512`) crea un Payment con `amount=Decimal("0")` para popups gratuitos. Razones:

- Reuso de infraestructura SimpleFI: cuando aparecieron free items, fue más barato setear amount=0 que crear un path paralelo.
- Trigger único de emisión: `_add_products_to_attendees` se llama desde el webhook approve del Payment.
- Stock decrement unificado (ver Cambio 4).
- Audit / `buyer_snapshot`.
- Coupons / discounts viven en Payment flow.

### Por qué deberíamos cambiarlo

- **Conceptualmente turbio**: un "pago de $0" no es un pago, es una **registración**. La tabla `payments` mezcla dos cosas.
- **Pollute analytics**: queries de ingresos requieren `WHERE amount > 0` para no contar registraciones.
- **`source` incorrecto**: `source=SIMPLEFI` en free direct-sale es falso — nunca pasa por SimpleFI.
- **Acopla lifecycle**: la registración hereda PENDING/APPROVED/CANCELED, webhooks, retries, sin razón.
- **Bloquea casos legítimos**: emitir comp ticket fuera del Payment flow hoy requiere o un Payment fake, o duplicar la lógica de stock.

### Propuesta

- Invariante: `payments.amount > 0` siempre.
- Emisión de ticket desacoplada de Payment:
  - **Direct-sale gratis**: emitís ticket directo (sin Payment).
  - **Direct-sale pago**: creás Payment → ticket en `pending_payment` → al APPROVED, `status='issued'`.
  - **Application aceptada**: emite ticket directo si el popup es gratis; vía Payment si es pago.
  - **Comp / admin grant**: emite ticket directo con `granted_by_user_id`.
- `buyer_snapshot` se mueve a tickets (`product_*_at_issuance` ya captura el producto; agregar `purchaser_snapshot` si hace falta capturar identidad).
- Coupons aplican a Payment; free items no necesitan coupon (porque no hay payment).

### Beneficios

1. `payments` queda con un solo significado: transacción monetaria.
2. Analytics limpias, sin filtros defensivos.
3. Emisión flexible: comp, free, post-payment — todos usan el mismo path.
4. Webhook lifecycle solo aplica a pagos reales.
5. Habilita admin-grant sin trucos.

### Contras

1. **Pérdida del trigger único de emisión**: hoy "approved payment → emit ticket" es una regla simple. Mañana hay 4 triggers. Más superficies a testear.
2. **`buyer_snapshot` distribuido**: si todos los flows necesitan capturar "quién recibió y cuándo", esa info vive en ticket o en una tabla nueva.
3. **Coupons + free items**: si Alice quiere usar un cupón sobre un item gratis, hay que decidir si los cupones aplican a registraciones.
4. **Migración de datos históricos**: payments existentes con `amount=0` son "registraciones disfrazadas" — decidir archivar / borrar / mantener.

### Decisiones de producto

- ¿Dónde vive `buyer_snapshot` cuando no hay Payment?
- ¿Coupons aplican a free items?
- ¿Datos históricos de payments-de-cero: archivar, borrar, o mantener?

---

## Cambio 4: stock atado a emisión de ticket

### Por qué existe hoy

El stock decrement se ata al Payment porque:
- **Reserva durante checkout**: Payment PENDING reserva stock; APPROVED lo confirma; CANCELED restaura.
- **Único punto de entrada**: direct-sale + application-paid + free pasan todos por Payment.
- **Concurrencia**: decrementación atómica en Payment evita race conditions.

### Por qué deberíamos cambiarlo

> Stock = cantidad de tickets disponibles. Cada ticket emitido = una unidad menos. Cada ticket cancelado = una unidad más.

El Payment es solo un camino entre varios que producen emisión. Atar stock al Payment lifecycle tiene problemas:

- **Duplicación**: `add_product` (admin path) ya tiene que hacer `decrement_total_stock` manualmente porque está fuera del Payment flow. Hoy son dos lugares con la misma lógica.
- **Free direct-sale**: el stock se mueve "vía Payment con amount=0" — en respuesta a un Payment que no es una transacción real.
- **Acopla stock a SimpleFI lifecycle**: si el webhook falla, ¿cuándo se restaura el stock? Hoy requiere jobs/cron de reconciliación.
- **Bloquea ticket-first flows**: emitir tickets directos (admin grant, RSVP, free events) requiere pasar por Payment o duplicar lógica.

### Propuesta

- El **contador de stock sigue viviendo en `products`** (`total_stock_remaining`, `shared_stock_remaining`) — no se mueve de tabla.
- Lo que cambia es **el trigger**: INSERT en `tickets` decrementa el contador del producto; DELETE / `status='canceled'` lo restaura.
- Implementación posible: trigger DB-level (atómico) o lógica centralizada en `tickets_crud.issue()` / `tickets_crud.cancel()` que decrementa `products.total_stock_remaining`.
- Payment ortogonal al stock: maneja el dinero, no toca stock.

### Cómo manejar reserva durante checkout (decisión clave)

El flujo paid direct-sale hoy: user clickea → Payment PENDING reserva stock → SimpleFI → webhook approve → ticket emitido.

Si stock se mueve en emisión de ticket, hay que decidir cuándo se emite el ticket:

**Opción A — ticket-first con estado:**
- User clickea → ticket insertado con `status='pending_payment'` → stock decrementado.
- Payment APPROVED → `status='issued'`.
- Payment CANCELED/EXPIRED → ticket deleted o `status='canceled'` → stock restaurado.

  *Pros*: stock siempre refleja "tickets vivos"; un solo modelo conceptual.
  *Cons*: tickets en `pending_payment` están "en limbo"; un crash entre Payment y ticket creation puede dejar inconsistencias (mitigable con transacciones).

**Opción B — reservation aparte:**
- User clickea → fila en `stock_reservations` (TTL corto) → reserva stock.
- Payment APPROVED → emite ticket, borra reservation.
- Payment CANCELED/EXPIRED o TTL vencido → borra reservation, restaura stock.

  *Pros*: separa "intención de compra" de "asistencia real". Tickets solo existen para gente que efectivamente va.
  *Cons*: tabla más, dos flujos de stock coherentes.

**Opción C — sin reserva:**
- Ticket se emite recién en Payment APPROVED.
- Riesgo: oversell entre click y approve.
- Solo aceptable con stock no scarce.

**Recomendación tentativa**: Opción A. Mejor encarna "stock = tickets vivos" y es más simple que B. El `pending_payment` status es información útil per se (cuántos checkouts en curso).

### Beneficios

1. Modelo coherente: stock siempre refleja "tickets emitidos". Una sola regla.
2. Habilita emisión fuera de Payment: comp, RSVPs, admin grants, free direct-sale — todos decrementan automáticamente.
3. Elimina duplicación de lógica de stock.
4. Robustez contra fallos de webhook: ticket en `pending_payment` con TTL — limpieza trivial.
5. Stock counter en tiempo real: contar tickets activos es directo.

### Contras

1. **Reescritura del flujo de stock**: migrar `decrement_total_stock` para disparar desde `tickets`.
2. **Tier-group shared stock**: hay lógica de stock compartido entre tiers; hay que asegurar que también se trigger-ee desde ticket.
3. **Tickets `pending_payment`**: introducen estado intermedio con TTL/cleanup. Si el cleanup falla, stock fantasma.
4. **Race conditions**: repensar lock strategy. Probablemente más simple (INSERT atómico) pero requiere testing.
5. **Migración**: payments PENDING actuales tienen stock reservado pero no tickets. Reconciliar al migrar (¿crear tickets pending? ¿restaurar stock?).

### Decisiones de producto

- ¿Opción A, B o C para reserva durante checkout?
- TTL para tickets en `pending_payment` (15min? 1h? por popup?).
- Stock infinito en popups sin cap — manejarlo igual (no-op).

---

## Beneficios consolidados del refactor

1. **Cinco tablas core con significado único**: `humans` (personas), `applications` (solicitudes), `products` (catálogo), `tickets` (derechos), `payments` (transacciones).
2. **Eliminación de campos / estados nullables semánticamente turbios**: `attendees.human_id`, `attendees.application_id`, `payments.amount=0`.
3. **Reducción de código de reconciliación**: `link_attendees_to_human`, `_find_human_id_by_email`, stock decrement distribuido, doble-bookkeeping payment_products↔attendee_products.
4. **Habilita features hoy bloqueadas o engorrosas**: gift tickets (`purchaser_human_id`), admin comps (`granted_by_user_id`), invitation tracking (`invited_by_human_id`), ticket transfers, refunds parciales.
5. **Analytics limpias**: payments solo cuenta plata; tickets cuenta asistencia; humans cuenta personas.
6. **Concurrencia más simple**: cada concepto tiene su propio lock surface.
7. **Mapeo directo al lenguaje de producto**: "los humans tienen tickets para productos" — la base de datos refleja exactamente cómo se habla del dominio.

## Contras consolidados

1. **Migración grande y de alto riesgo**: tocás todas las tablas core. Requiere ventana con backfill cuidadoso.
2. **Breaking changes en API y frontend**: endpoints, hooks, tests, exports — todos cambian.
3. **Múltiples decisiones de producto a tomar** (ver lista consolidada abajo).
4. **Vocabulario cambia**: "attendee" deja de existir como entidad; "payment" deja de incluir registraciones; "stock" deja de ser propiedad indirecta de payments.
5. **Inflación de `humans`** con +1s sin cuenta: requiere filtros en listas administrativas y exports.

## Decisiones de producto consolidadas

| # | Decisión | Bloquea |
|---|---|---|
| 1 | ¿Email nullable en `humans`? | Cambio 1 |
| 2 | Filtrado de humans "secundarios" en listas administrativas | Cambio 1 |
| 3 | Política de resolución al login con email match | Cambio 1 |
| 4 | Display name override (human / ticket / no existe) | Cambio 1 |
| 5 | "Asistencia" se deriva de application accepted, ticket emitido, o ambos | Cambios 1, 3 |
| 6 | Snapshot del producto: columnas denormalizadas vs JSONB | Cambio 2 |
| 7 | Política de refunds (DELETE vs status update) | Cambio 2 |
| 8 | ¿Payment carga fees / tax / subtotal aparte? | Cambio 2 |
| 9 | ¿Dónde vive buyer_snapshot sin Payment? | Cambio 3 |
| 10 | ¿Coupons aplican a free items? | Cambio 3 |
| 11 | Política de datos históricos (payments=0, attendees existentes, payment_products) | Cambios 1-3 |
| 12 | Opción A/B/C para reserva durante checkout | Cambio 4 |
| 13 | TTL para tickets en `pending_payment` | Cambio 4 |

---

## Veredicto

**Cada cambio individual es defendible. El conjunto es un refactor de schema sustancial pero coherente.**

### A favor de encararlo

- Los acoplamientos actuales **se complican más con cada feature nueva** (admin grants es la primera evidencia concreta). El costo de no refactorizar crece con el tiempo.
- El modelo objetivo es **estándar en plataformas de eventos modernas**. No es exótico.
- La superficie de código **se reduce** sustancialmente.

### En contra de encararlo

- Toca **todo el backend y todo el frontend**. No es factible en una sola PR.
- Requiere **13 decisiones de producto** que hoy nadie ha cerrado.
- El **valor inmediato es bajo**: el modelo actual funciona. El ROI viene cuando se construyen features futuras sobre el modelo nuevo.

### Cuándo sí encararlo

- Si la roadmap incluye al menos 2 de: invitations tracking, ticket transfers, admin comps, RSVP simple, multi-role tickets, gift tickets.
- Si hay capacidad para una migración por fases (3-6 meses con feature freeze parcial).
- Si se tolera 1-2 ciclos de inestabilidad mientras se estabilizan los contratos nuevos.

### Cuándo no

- Si la prioridad es shipping de features sobre el modelo actual.
- Si no hay capacidad para tomar las 13 decisiones de producto.
- Si breaking changes en API contracts no son aceptables para integraciones externas.

---

## Apéndice: ítems abiertos para futuro análisis

No cubiertos acá pero parte del mismo refactor mental:

- **`groups`** (hoy stub): cómo encaja en el modelo nuevo. ¿`humans.group_id`? ¿link table? ¿group como agregado de humans con ticket en el mismo popup?
- **`referrals`** (hoy stub): se cruza con `invited_by_human_id` en tickets. ¿Son lo mismo? ¿Referral es la versión "track-only" (sin invitación formal)?
- **`application_snapshots`**: ¿sigue teniendo sentido si los campos snapshot (name, email, etc.) se leen siempre del human? Posiblemente sí para custom_fields y referral, con subset más chico.
- **Multi-tenancy y RLS**: cada cambio tiene que verificar que las RLS policies siguen siendo correctas. Especialmente `humans` que carga +1s sin cuenta de múltiples popups del mismo tenant.
- **External integrations**: SimpleFI (Payment), Mailgun (humans), webhooks salientes (¿attendee events vs ticket events?).
- **Tickets transferibles**: si se habilita feature de transferencia, agregar `tickets.transferred_from_human_id` y un log.

---

## Apéndice: queries de ejemplo en el modelo objetivo

| Pregunta | Query |
|---|---|
| ¿Qué se compró en este payment? | `SELECT * FROM tickets WHERE payment_id = X` |
| ¿Cuántos tickets vivos de este producto? | `SELECT COUNT(*) FROM tickets WHERE product_id = X AND status = 'issued'` |
| Revenue por producto / mes | `SELECT product_id, SUM(price_at_issuance) FROM tickets WHERE issued_at >= ... GROUP BY product_id` |
| ¿Quién asiste a este popup? | `SELECT DISTINCT human_id FROM tickets t JOIN products p ON t.product_id = p.id WHERE p.popup_id = X AND t.status = 'issued'` |
| ¿Alice compró tickets para Bob? | `SELECT * FROM tickets WHERE purchaser_human_id = Alice AND human_id = Bob` |
| ¿Qué tickets emitió este admin como comp? | `SELECT * FROM tickets WHERE granted_by_user_id = X` |
| ¿Cuánto pagó Alice en total? | `SELECT SUM(amount) FROM payments WHERE human_id = Alice` |
| ¿Qué applications tiene Alice en review? | `SELECT * FROM applications WHERE human_id = Alice AND status = 'in_review'` |
| ¿Quién trajo a más gente al popup X? | `SELECT invited_by_human_id, COUNT(*) FROM tickets t JOIN products p ON ... WHERE p.popup_id = X AND invited_by_human_id IS NOT NULL GROUP BY invited_by_human_id ORDER BY 2 DESC` |
