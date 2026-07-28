"""Complex ``filters`` query param on GET /payments (BO list).

The param carries a JSON filter group ({match, conditions[]}) built on the
shared engine in app.core.filters and ANDed with the legacy params.
Invalid JSON, unknown fields, or disallowed operators return 422.

Each test creates a fresh popup and filters by popup_id so it is isolated
from the session-scoped shared fixtures (db / tenant_a have no per-test
rollback).
"""

import json
import uuid
from datetime import UTC, datetime
from decimal import Decimal

from fastapi.testclient import TestClient
from sqlmodel import Session

from app.api.payment.models import Payments
from app.api.payment.schemas import PaymentStatus, PaymentType
from app.api.popup.models import Popups
from app.api.tenant.models import Tenants
from tests.api.application_review.test_pending_reviews import (
    _auth,
    _make_admin,
    _make_popup,
)

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _make_payment(
    db: Session,
    tenant: Tenants,
    popup: Popups,
    *,
    status: str = PaymentStatus.PENDING.value,
    amount: Decimal = Decimal("100.00"),
    amount_charged: Decimal | None = None,
    currency: str = "USD",
    source: str | None = None,
    payment_type: str = PaymentType.PASS_PURCHASE.value,
    created_at: datetime | None = None,
) -> Payments:
    payment = Payments(
        id=uuid.uuid4(),
        tenant_id=tenant.id,
        popup_id=popup.id,
        status=status,
        amount=amount,
        amount_charged=amount_charged,
        currency=currency,
        source=source,
        payment_type=payment_type,
    )
    if created_at is not None:
        payment.created_at = created_at
    db.add(payment)
    db.commit()
    db.refresh(payment)
    return payment


def _list(
    client: TestClient,
    admin,
    tenant: Tenants,
    popup: Popups,
    filters: dict | str | None = None,
    **extra_params,
):
    params: dict = {"popup_id": str(popup.id), **extra_params}
    if filters is not None:
        params["filters"] = filters if isinstance(filters, str) else json.dumps(filters)
    return client.get("/api/v1/payments", params=params, headers=_auth(admin, tenant))


def _ids(response) -> set[str]:
    assert response.status_code == 200, response.text
    return {row["id"] for row in response.json()["results"]}


def _one(field: str, op: str, value=None) -> dict:
    return {
        "match": "all",
        "conditions": [{"field": field, "op": op, "value": value}],
    }


# ---------------------------------------------------------------------------
# Tests
# ---------------------------------------------------------------------------


class TestPaymentListFilters:
    def test_status_eq_and_neq(
        self, db: Session, tenant_a: Tenants, client: TestClient
    ) -> None:
        popup = _make_popup(db, tenant_a)
        admin = _make_admin(db, tenant_a)
        approved = _make_payment(
            db, tenant_a, popup, status=PaymentStatus.APPROVED.value
        )
        pending = _make_payment(db, tenant_a, popup)

        response = _list(
            client, admin, tenant_a, popup, _one("status", "eq", "approved")
        )
        assert _ids(response) == {str(approved.id)}

        response = _list(
            client, admin, tenant_a, popup, _one("status", "neq", "approved")
        )
        assert _ids(response) == {str(pending.id)}

    def test_status_invalid_value_returns_422(
        self, db: Session, tenant_a: Tenants, client: TestClient
    ) -> None:
        popup = _make_popup(db, tenant_a)
        admin = _make_admin(db, tenant_a)

        response = _list(
            client, admin, tenant_a, popup, _one("status", "eq", "paid-ish")
        )
        assert response.status_code == 422, response.text

    def test_amount_gt_and_lt(
        self, db: Session, tenant_a: Tenants, client: TestClient
    ) -> None:
        popup = _make_popup(db, tenant_a)
        admin = _make_admin(db, tenant_a)
        small = _make_payment(db, tenant_a, popup, amount=Decimal("50.00"))
        large = _make_payment(db, tenant_a, popup, amount=Decimal("250.00"))

        response = _list(client, admin, tenant_a, popup, _one("amount", "gt", 100))
        assert _ids(response) == {str(large.id)}

        response = _list(client, admin, tenant_a, popup, _one("amount", "lt", 100))
        assert _ids(response) == {str(small.id)}

        # String-typed numbers are accepted too (query params serialize as JSON).
        response = _list(client, admin, tenant_a, popup, _one("amount", "gte", "250"))
        assert _ids(response) == {str(large.id)}

    def test_amount_charged_is_empty(
        self, db: Session, tenant_a: Tenants, client: TestClient
    ) -> None:
        popup = _make_popup(db, tenant_a)
        admin = _make_admin(db, tenant_a)
        unsettled = _make_payment(db, tenant_a, popup, amount_charged=None)
        settled = _make_payment(db, tenant_a, popup, amount_charged=Decimal("105.00"))

        response = _list(
            client, admin, tenant_a, popup, _one("amount_charged", "is_empty")
        )
        assert _ids(response) == {str(unsettled.id)}

        response = _list(
            client, admin, tenant_a, popup, _one("amount_charged", "not_empty")
        )
        assert _ids(response) == {str(settled.id)}

    def test_source_type_and_currency_eq(
        self, db: Session, tenant_a: Tenants, client: TestClient
    ) -> None:
        popup = _make_popup(db, tenant_a)
        admin = _make_admin(db, tenant_a)
        stripe_usd = _make_payment(db, tenant_a, popup, source="Stripe")
        crypto_ars = _make_payment(
            db,
            tenant_a,
            popup,
            source="Crypto",
            currency="ARS",
            payment_type=PaymentType.APPLICATION_FEE.value,
        )

        response = _list(client, admin, tenant_a, popup, _one("source", "eq", "Stripe"))
        assert _ids(response) == {str(stripe_usd.id)}

        response = _list(
            client,
            admin,
            tenant_a,
            popup,
            _one("payment_type", "eq", PaymentType.APPLICATION_FEE.value),
        )
        assert _ids(response) == {str(crypto_ars.id)}

        response = _list(client, admin, tenant_a, popup, _one("currency", "eq", "ARS"))
        assert _ids(response) == {str(crypto_ars.id)}

    def test_created_at_before_and_after(
        self, db: Session, tenant_a: Tenants, client: TestClient
    ) -> None:
        popup = _make_popup(db, tenant_a)
        admin = _make_admin(db, tenant_a)
        early = _make_payment(
            db, tenant_a, popup, created_at=datetime(2026, 3, 1, 12, 0, tzinfo=UTC)
        )
        late = _make_payment(
            db, tenant_a, popup, created_at=datetime(2026, 3, 20, 12, 0, tzinfo=UTC)
        )

        response = _list(
            client, admin, tenant_a, popup, _one("created_at", "before", "2026-03-10")
        )
        assert _ids(response) == {str(early.id)}

        response = _list(
            client, admin, tenant_a, popup, _one("created_at", "after", "2026-03-10")
        )
        assert _ids(response) == {str(late.id)}

    def test_match_any(
        self, db: Session, tenant_a: Tenants, client: TestClient
    ) -> None:
        popup = _make_popup(db, tenant_a)
        admin = _make_admin(db, tenant_a)
        approved = _make_payment(
            db, tenant_a, popup, status=PaymentStatus.APPROVED.value
        )
        expensive = _make_payment(db, tenant_a, popup, amount=Decimal("999.00"))
        _make_payment(db, tenant_a, popup, amount=Decimal("10.00"))

        response = _list(
            client,
            admin,
            tenant_a,
            popup,
            {
                "match": "any",
                "conditions": [
                    {"field": "status", "op": "eq", "value": "approved"},
                    {"field": "amount", "op": "gt", "value": 500},
                ],
            },
        )
        assert _ids(response) == {str(approved.id), str(expensive.id)}

    def test_legacy_status_param_combines_with_filters(
        self, db: Session, tenant_a: Tenants, client: TestClient
    ) -> None:
        popup = _make_popup(db, tenant_a)
        admin = _make_admin(db, tenant_a)
        match = _make_payment(
            db,
            tenant_a,
            popup,
            status=PaymentStatus.APPROVED.value,
            amount=Decimal("300.00"),
        )
        _make_payment(
            db,
            tenant_a,
            popup,
            status=PaymentStatus.APPROVED.value,
            amount=Decimal("50.00"),
        )
        _make_payment(db, tenant_a, popup, amount=Decimal("300.00"))

        response = _list(
            client,
            admin,
            tenant_a,
            popup,
            _one("amount", "gt", 100),
            payment_status=PaymentStatus.APPROVED.value,
        )
        assert _ids(response) == {str(match.id)}

    def test_malformed_filters_json_returns_422(
        self, db: Session, tenant_a: Tenants, client: TestClient
    ) -> None:
        popup = _make_popup(db, tenant_a)
        admin = _make_admin(db, tenant_a)

        response = _list(client, admin, tenant_a, popup, "{not json")
        assert response.status_code == 422, response.text

    def test_unknown_field_returns_422(
        self, db: Session, tenant_a: Tenants, client: TestClient
    ) -> None:
        popup = _make_popup(db, tenant_a)
        admin = _make_admin(db, tenant_a)

        response = _list(client, admin, tenant_a, popup, _one("external_id", "eq", "x"))
        assert response.status_code == 422, response.text

    def test_disallowed_op_returns_422(
        self, db: Session, tenant_a: Tenants, client: TestClient
    ) -> None:
        popup = _make_popup(db, tenant_a)
        admin = _make_admin(db, tenant_a)

        response = _list(
            client, admin, tenant_a, popup, _one("amount", "contains", "1")
        )
        assert response.status_code == 422, response.text

    def test_invalid_number_returns_422(
        self, db: Session, tenant_a: Tenants, client: TestClient
    ) -> None:
        popup = _make_popup(db, tenant_a)
        admin = _make_admin(db, tenant_a)

        response = _list(client, admin, tenant_a, popup, _one("amount", "gt", "cheap"))
        assert response.status_code == 422, response.text
