import uuid
from decimal import Decimal

import pytest
from sqlalchemy import event
from sqlmodel import Session

from app.api.payment.crud import payments_crud
from app.api.payment.models import PaymentProducts, PaymentRecipients, Payments
from app.api.payment.schemas import PaymentFilter, PaymentPublic
from app.api.tenant.models import Tenants
from tests.api.payment.test_payment_recipients import _payment_context


@pytest.mark.parametrize("list_path", ["popup", "filter"])
def test_payment_list_loads_recipient_snapshots_without_per_row_queries(
    db: Session, test_engine, tenant_a: Tenants, list_path: str
) -> None:
    popup, _, _, _, application, product = _payment_context(db, tenant_a)
    expected: dict[uuid.UUID, dict[str, str]] = {}

    for payment_index in range(3):
        payment = Payments(
            tenant_id=tenant_a.id,
            popup_id=popup.id,
            application_id=application.id,
            amount=Decimal("50"),
        )
        db.add(payment)
        db.flush()

        expected[payment.id] = {}
        for recipient_index in range(2):
            key = f"recipient-{recipient_index}"
            name = f"Recipient {payment_index}-{recipient_index}"
            recipient = PaymentRecipients(
                tenant_id=tenant_a.id,
                payment_id=payment.id,
                recipient_key=key,
                name=name,
            )
            db.add(recipient)
            db.flush()
            db.add(
                PaymentProducts(
                    tenant_id=tenant_a.id,
                    payment_id=payment.id,
                    product_id=product.id,
                    payment_recipient_id=recipient.id,
                    product_name="Recipient pass",
                    product_price=Decimal("25"),
                    product_category="ticket",
                )
            )
            expected[payment.id][key] = name
    db.commit()

    recipient_selects: list[str] = []

    def count_recipient_selects(
        _connection, _cursor, statement, _parameters, _context, _executemany
    ):
        if (
            statement.lstrip().lower().startswith("select")
            and "payment_recipients" in statement
        ):
            recipient_selects.append(statement)

    event.listen(test_engine, "before_cursor_execute", count_recipient_selects)
    try:
        # A fresh session ensures the identity map cannot hide lazy loads.
        with Session(test_engine) as session:
            if list_path == "popup":
                payments, total = payments_crud.find_by_popup(session, popup.id)
            else:
                payments, total = payments_crud.find_by_filter(
                    session, PaymentFilter(application_id=application.id)
                )
            public = [PaymentPublic.model_validate(payment) for payment in payments]
    finally:
        event.remove(test_engine, "before_cursor_execute", count_recipient_selects)

    assert total == len(public) == 3
    for payment in public:
        assert {
            recipient.recipient_key: recipient.name for recipient in payment.recipients
        } == expected[payment.id]
        assert {
            product_snapshot.recipient_key: product_snapshot.attendee_name
            for product_snapshot in payment.products_snapshot
        } == expected[payment.id]
    assert len(recipient_selects) == 2
