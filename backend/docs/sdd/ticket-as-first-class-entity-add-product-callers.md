# add_product Caller Audit — ticket-as-first-class-entity

**Purpose**: enumerate every direct or indirect write to `AttendeeProducts` rows
before the always-insert flip. Produced as Task 0, required before Phase 1.

---

## Direct callers of `attendees_crud.add_product`

None found in application code — `attendees_crud.add_product` is the CRUD method
but application code calls it indirectly through `_add_products_to_attendees`.

---

## Direct `AttendeeProducts(...)` constructor calls

### 1. `backend/app/api/attendee/crud.py:461` — `AttendeesCRUD.add_product`

**Current signature**: `add_product(session, attendee_id, product_id, quantity=1)`
**Current behaviour**: upsert — if `(attendee_id, product_id)` row exists,
increments `quantity`; otherwise creates new row with supplied `quantity`.
**Expected behaviour under always-insert**: every call creates a new row with a
fresh UUID PK and a fresh `check_in_code`. `quantity` param is removed.
**Treatment**: REWRITE — this is the method being flipped (Phase 4 task 4.4).
**Mark**: needs migration.

---

### 2. `backend/app/api/payment/crud.py:416` — `create_open_ticketing_payment` inner loop

**Current signature**: direct `AttendeeProducts(attendee_id=..., product_id=..., quantity=1)` constructor.
**Current behaviour**: inside `for _ in range(line.quantity)` loop, creates one
`AttendeeProducts` row **per companion attendee**. Each companion is a separate
`Attendees` row, so composite PK collision is avoided today.
**Expected behaviour under always-insert**: single `Attendees` row reused; one
`AttendeeProducts` row per ticket unit, each with own UUID and `check_in_code`.
The `for _ in range(line.quantity)` loop stays but now references the single
buyer attendee.
**Treatment**: REWRITE — this is the `create_open_ticketing_payment` rewrite
(Phase 5, task 5.2/5.4). The loop is already structured correctly (quantity=1 per
iteration); it only needs to point at a single attendee and add `id`/`check_in_code`/`payment_id`.
**Mark**: needs migration.

---

### 3. `backend/app/api/payment/crud.py:1846` — `_add_products_to_attendees`

**Current signature**: called from `approve_payment`, `create_payment` (zero-amount
path), and `update_status` via `PaymentProductRequest(product_id, attendee_id, quantity)`.
**Current behaviour**: upsert — if `(attendee_id, product_id)` row exists,
increments `quantity += req_prod.quantity`; otherwise creates new row with
`quantity=req_prod.quantity`.
**Call sites**:
  - `payment/crud.py:1401` — `create_payment` zero-amount path: calls with
    `obj.products` (list of `PaymentProductRequest`). Quantity may be > 1 if the
    user requested `quantity=N`.
  - `payment/crud.py:1662` — `approve_payment`: reconstructs from `products_snapshot`
    which mirrors the original `PaymentProductRequest.quantity`.
  - `payment/crud.py:1886` — `update_status` (approve path): same as above.

**Expected behaviour under always-insert**: for each `PaymentProductRequest` with
`quantity=N`, loop `N` times calling the new `add_product` (always-insert) once
per unit. Each unit gets its own UUID + `check_in_code` + optionally `payment_id`.

**Treatment**: REWRITE — replace the upsert body with a range loop calling the new
`attendees_crud.add_product`. The `quantity` field on `PaymentProductRequest` stays
(used for price calc); the loop is added INSIDE `_add_products_to_attendees`.
**Mark**: needs migration (Phase 4 task 4.9 / Phase 5 task 5.5).

---

### 4. `backend/app/core/db.py:651` — seed/fixture helper

**Current signature**: direct `AttendeeProducts(attendee_id=..., product_id=..., quantity=...)` constructor.
**Current behaviour**: seed data creation, presumably for dev/testing.
**Expected behaviour**: after migration, the seed should create one row per unit
(quantity=1 per row) or simply pass `quantity=1` since post-migration quantity
column is dropped.
**Treatment**: update seed to use the new model without `quantity` field once the
column is dropped. If this is test seeding only it can be updated in Phase 3 model
changes.
**Mark**: needs migration (low-risk, seed-only code).

---

### 5. `backend/scripts/migrate_from_source.py:1580` — data migration script

**Current signature**: `AttendeeProducts(tenant_id=..., attendee_id=..., product_id=..., quantity=...)`.
**Current behaviour**: one-time data migration from external source. Sets quantity
from source data.
**Expected behaviour**: after the ticket-entity migration, rows should be one-per-unit.
This script is a one-time historical migration that predates the ticket-entity change.
**Treatment**: no change needed NOW (script runs against a pre-migration DB). If
the script needs to be run again post-migration, it should be updated to loop on
quantity. Document as deferred.
**Mark**: no change needed (historical one-time script).

---

### 6. `backend/tests/api/attendee/test_http_my_attendees_by_popup.py:193` — test helper

**Current signature**: `AttendeeProducts(tenant_id=..., attendee_id=..., product_id=..., quantity=1)`.
**Current behaviour**: test fixture helper `_add_product_to_attendee`.
**Expected behaviour**: after model change, must remove `quantity` field and add
`id`/`check_in_code` fields.
**Treatment**: update test fixture in Phase 3 alongside model changes.
**Mark**: needs migration (test only).

---

## Indirect callers — `_add_products_to_attendees` call sites

All three call sites pass `PaymentProductRequest` objects with `quantity` field:

| Call site | Path | quantity > 1 possible? | Treatment |
|-----------|------|------------------------|-----------|
| `create_payment` zero-amount | `crud.py:1401` | Yes (user requests qty=N) | Loop in `_add_products_to_attendees` |
| `approve_payment` | `crud.py:1662` | Yes (from snapshot) | Loop in `_add_products_to_attendees` |
| `update_status` approve path | `crud.py:1886` | Yes (from snapshot) | Loop in `_add_products_to_attendees` |

**Decision**: The fix is concentrated in `_add_products_to_attendees`: replace the
upsert block with a range loop that calls the new `attendees_crud.add_product`
N times, where N = `req_prod.quantity`. The `PaymentProductRequest.quantity` field
is preserved for price calculation; only the attendee-product write path changes.

---

## Summary

| Caller | File | Treatment | Phase |
|--------|------|-----------|-------|
| `AttendeesCRUD.add_product` | `attendee/crud.py:442` | REWRITE (flip to always-insert) | Phase 4.4 |
| `create_open_ticketing_payment` direct constructor | `payment/crud.py:416` | REWRITE (single attendee + ticket loop) | Phase 5.2/5.4 |
| `_add_products_to_attendees` | `payment/crud.py:1815` | REWRITE (range-loop per unit) | Phase 4.9/5.5 |
| `db.py` seed | `core/db.py:651` | UPDATE (drop quantity field) | Phase 3 |
| `migrate_from_source.py` | `scripts/migrate_from_source.py:1580` | DEFERRED (historical one-time script) | Post-PR |
| Test helper | `tests/api/attendee/test_http_my_attendees_by_popup.py:193` | UPDATE (add id/check_in_code) | Phase 3 |

**No blockers found.** All callers follow the upsert-or-quantity-increment pattern;
the fix is uniform (concentrate in `_add_products_to_attendees` + the CRUD method itself).

---

*Generated: 2026-05-06 | Change: ticket-as-first-class-entity | Branch: feat/ticket-as-first-class-entity*
