import uuid

import pytest
from pydantic import ValidationError
from sqlmodel import Session, select

from app.api.attendee.models import Attendees
from app.api.cart.crud import carts_crud
from app.api.cart.schemas import CartState
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
            "passes": [
                {
                    "recipient_key": recipient_key,
                    "product_id": str(uuid.uuid4()),
                    "quantity": 1,
                },
                {
                    "attendee_id": str(uuid.uuid4()),
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
    assert restored.passes[0].recipient_key == recipient_key
    assert restored.passes[0].attendee_id is None
    assert restored.passes[1].attendee_id is not None
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
            "passes": [
                {
                    "recipient_key": "missing",
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
            "passes": [
                {
                    "recipient_key": "both",
                    "attendee_id": str(uuid.uuid4()),
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
