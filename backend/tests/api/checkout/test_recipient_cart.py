import uuid

import pytest
from pydantic import ValidationError
from sqlmodel import Session, select

from app.api.attendee.models import Attendees
from app.api.cart._migration import migrate_cart_state
from app.api.cart.crud import carts_crud
from app.api.cart.models import Carts
from app.api.cart.schemas import CartRecipientAssignment, CartState
from app.api.human.models import Humans
from app.api.popup.models import Popups
from app.api.tenant.models import Tenants


def test_recipient_cart_round_trips_without_creating_attendees(
    db: Session, tenant_a: Tenants, popup_tenant_a: Popups
) -> None:
    buyer = Humans(
        tenant_id=tenant_a.id,
        email=f"recipient-cart-{uuid.uuid4().hex[:8]}@test.com",
    )
    db.add(buyer)
    db.flush()
    cart = carts_crud.get_or_create(
        db,
        human_id=buyer.id,
        popup_id=popup_tenant_a.id,
        tenant_id=tenant_a.id,
    )
    before = len(
        list(
            db.exec(
                select(Attendees).where(Attendees.popup_id == popup_tenant_a.id)
            ).all()
        )
    )
    recipient_key = "managed-child"
    state = CartState.model_validate(
        {
            "recipients": [
                {
                    "recipient_key": recipient_key,
                    "name": "Managed Child",
                    "email": "child@test.com",
                    "category_id": str(uuid.uuid4()),
                    "profile_snapshot": {"shirt_size": "S"},
                }
            ],
            "lines": [
                {
                    "kind": "product",
                    "assignment": {
                        "kind": "recipient",
                        "recipient_key": recipient_key,
                    },
                    "product_id": str(uuid.uuid4()),
                    "quantity": 1,
                },
                {
                    "kind": "product",
                    "assignment": {
                        "kind": "attendee",
                        "attendee_id": str(uuid.uuid4()),
                    },
                    "product_id": str(uuid.uuid4()),
                    "quantity": 1,
                },
            ],
        }
    )

    saved = carts_crud.update_items(db, cart, state)
    restored = CartState.model_validate(saved.items)

    assert restored.recipients[0].recipient_key == recipient_key
    assert restored.recipients[0].profile_snapshot == {"shirt_size": "S"}
    assert isinstance(restored.lines[0].assignment, CartRecipientAssignment)
    assert restored.lines[0].assignment.recipient_key == recipient_key
    assert restored.lines[1].assignment.kind == "attendee"
    assert (
        len(
            list(
                db.exec(
                    select(Attendees).where(Attendees.popup_id == popup_tenant_a.id)
                ).all()
            )
        )
        == before
    )


@pytest.mark.parametrize(
    "payload",
    [
        {
            "recipients": [
                {
                    "recipient_key": "same",
                    "name": "One",
                    "category_id": str(uuid.uuid4()),
                },
                {
                    "recipient_key": "same",
                    "name": "Two",
                    "category_id": str(uuid.uuid4()),
                },
            ]
        },
        {
            "lines": [
                {
                    "kind": "product",
                    "assignment": {
                        "kind": "recipient",
                        "recipient_key": "missing",
                    },
                    "product_id": str(uuid.uuid4()),
                    "quantity": 1,
                }
            ]
        },
        {
            "recipients": [
                {
                    "recipient_key": "both",
                    "name": "Both",
                    "category_id": str(uuid.uuid4()),
                }
            ],
            "lines": [
                {
                    "kind": "product",
                    "assignment": {
                        "kind": "recipient",
                        "recipient_key": "both",
                        "attendee_id": str(uuid.uuid4()),
                    },
                    "product_id": str(uuid.uuid4()),
                    "quantity": 1,
                }
            ],
        },
    ],
)
def test_recipient_cart_rejects_ambiguous_or_unresolved_identity(payload: dict) -> None:
    with pytest.raises(ValidationError):
        CartState.model_validate(payload)


def test_legacy_cart_migration_preserves_dynamic_and_assigned_lines() -> None:
    recipient_key = "managed-child"
    state, was_legacy = migrate_cart_state(
        {
            "passes": [
                {
                    "recipient_key": recipient_key,
                    "product_id": "ticket-1",
                    "quantity": 2,
                }
            ],
            "dynamic_items": [
                {
                    "step_type": "workshops",
                    "product_id": "workshop-1",
                    "quantity": 3,
                    "price": 75,
                }
            ],
            "recipients": [{"recipient_key": recipient_key, "name": "Managed Child"}],
        }
    )

    assert was_legacy is True
    assert [line.kind for line in state.lines] == ["product", "product"]
    assert state.lines[0].assignment.kind == "recipient"
    assert state.lines[1].assignment.kind == "unassigned"
    assert state.lines[1].step_type == "workshops"

    canonical, was_legacy = migrate_cart_state(state.model_dump(mode="json"))
    assert was_legacy is False
    assert canonical == state


def test_restore_items_persists_legacy_cart_without_changing_activity_time(
    db: Session, tenant_a: Tenants, popup_tenant_a: Popups
) -> None:
    buyer = Humans(
        tenant_id=tenant_a.id,
        email=f"legacy-cart-{uuid.uuid4().hex[:8]}@test.com",
    )
    db.add(buyer)
    db.flush()
    cart = Carts(
        tenant_id=tenant_a.id,
        human_id=buyer.id,
        popup_id=popup_tenant_a.id,
        items={
            "dynamic_items": [
                {
                    "step_type": "tickets",
                    "product_id": "ticket-1",
                    "quantity": 2,
                    "price": 200,
                }
            ]
        },
    )
    db.add(cart)
    db.commit()
    original_updated_at = cart.updated_at

    restored = carts_crud.restore_items(db, cart)
    db.expire_all()
    persisted = db.get(Carts, cart.id)

    assert len(restored.lines) == 1
    assert persisted is not None
    assert persisted.items == restored.model_dump(mode="json")
    assert persisted.updated_at == original_updated_at
