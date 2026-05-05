"""HTTP integration tests for GET /payments/my/popup/{popup_id} — CAP-D.

Phase 4: route-level tests covering the full HTTP stack.

Spec scenarios:
1. 401 — no OTP session
2. Empty result when human has no payments for popup → 200, empty list
3. Application-linked payments appear in results
4. Direct-sale payments appear via attendee.human_id ownership
5. Both legs combined, no duplicates
6. limit=100 (max) → 200
7. limit=101 (exceeds max) → 422
8. Cross-tenant popup → 200, empty results (RLS isolates)
"""

import uuid
from decimal import Decimal

from fastapi.testclient import TestClient
from sqlmodel import Session

from app.api.application.models import Applications
from app.api.application.schemas import ApplicationStatus
from app.api.attendee.models import Attendees
from app.api.human.models import Humans
from app.api.payment.models import PaymentProducts, Payments
from app.api.payment.schemas import PaymentStatus
from app.api.popup.models import Popups
from app.api.tenant.models import Tenants
from app.core.security import create_access_token

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _human_token(human: Humans) -> str:
    return create_access_token(subject=human.id, token_type="human")


def _auth(human: Humans) -> dict[str, str]:
    return {"Authorization": f"Bearer {_human_token(human)}"}


def _make_human(db: Session, tenant: Tenants, *, suffix: str) -> Humans:
    human = Humans(
        id=uuid.uuid4(),
        tenant_id=tenant.id,
        email=f"http-capd-{suffix}-{uuid.uuid4().hex[:8]}@test.com",
    )
    db.add(human)
    db.commit()
    db.refresh(human)
    return human


def _make_popup(db: Session, tenant: Tenants, *, suffix: str) -> Popups:
    popup = Popups(
        id=uuid.uuid4(),
        tenant_id=tenant.id,
        name=f"HTTP-CAPD Popup {suffix}",
        slug=f"http-capd-{suffix}-{uuid.uuid4().hex[:6]}",
    )
    db.add(popup)
    db.commit()
    db.refresh(popup)
    return popup


def _make_app_payment(
    db: Session,
    tenant: Tenants,
    popup: Popups,
    human: Humans,
) -> Payments:
    """Create an application-linked payment owned by human."""
    application = Applications(
        id=uuid.uuid4(),
        tenant_id=tenant.id,
        popup_id=popup.id,
        human_id=human.id,
        status=ApplicationStatus.ACCEPTED.value,
    )
    db.add(application)
    db.flush()

    payment = Payments(
        id=uuid.uuid4(),
        tenant_id=tenant.id,
        application_id=application.id,
        popup_id=popup.id,
        status=PaymentStatus.APPROVED.value,
        amount=Decimal("100"),
        currency="USD",
    )
    db.add(payment)
    db.commit()
    db.refresh(payment)
    return payment


def _make_product(db: Session, tenant: Tenants, popup: Popups, *, suffix: str):
    from app.api.product.models import Products

    product = Products(
        id=uuid.uuid4(),
        tenant_id=tenant.id,
        popup_id=popup.id,
        name=f"Test Product CAPD {suffix}",
        slug=f"test-prod-capd-{suffix}-{uuid.uuid4().hex[:6]}",
        price=Decimal("50"),
        category="standard",
    )
    db.add(product)
    db.flush()
    return product


def _make_direct_payment(
    db: Session,
    tenant: Tenants,
    popup: Popups,
    human: Humans,
) -> Payments:
    """Create a direct-sale payment owned via attendee.human_id == human.id."""
    attendee = Attendees(
        id=uuid.uuid4(),
        tenant_id=tenant.id,
        application_id=None,
        popup_id=popup.id,
        human_id=human.id,
        name="Direct Buyer",
        category="main",
        check_in_code=f"DP{uuid.uuid4().hex[:4].upper()}",
    )
    db.add(attendee)
    db.flush()

    payment = Payments(
        id=uuid.uuid4(),
        tenant_id=tenant.id,
        application_id=None,
        popup_id=popup.id,
        status=PaymentStatus.APPROVED.value,
        amount=Decimal("50"),
        currency="USD",
    )
    db.add(payment)
    db.flush()

    product = _make_product(db, tenant, popup, suffix="direct-httpd")
    pp = PaymentProducts(
        tenant_id=tenant.id,
        payment_id=payment.id,
        product_id=product.id,
        attendee_id=attendee.id,
        quantity=1,
        product_name="Direct Product",
        product_price=Decimal("50"),
        product_category="standard",
        product_currency="USD",
    )
    db.add(pp)
    db.commit()
    db.refresh(payment)
    return payment


def _payments_url(popup_id: uuid.UUID) -> str:
    return f"/api/v1/payments/my/popup/{popup_id}"


# ---------------------------------------------------------------------------
# Tests
# ---------------------------------------------------------------------------


class TestListMyPaymentsByPopupHttp:
    """HTTP integration tests for GET /payments/my/popup/{popup_id} (CAP-D)."""

    def test_no_auth_returns_401(
        self, client: TestClient, db: Session, tenant_a: Tenants
    ) -> None:
        """Unauthenticated request returns 401."""
        popup = _make_popup(db, tenant_a, suffix="d-noauth")
        response = client.get(_payments_url(popup.id))
        assert response.status_code == 401

    def test_empty_result_when_no_payments(
        self, client: TestClient, db: Session, tenant_a: Tenants
    ) -> None:
        """Human with no payments for popup → 200, empty list, total=0."""
        popup = _make_popup(db, tenant_a, suffix="d-empty")
        human = _make_human(db, tenant_a, suffix="d-empty")

        response = client.get(_payments_url(popup.id), headers=_auth(human))

        assert response.status_code == 200
        body = response.json()
        assert body["results"] == []
        assert body["paging"]["total"] == 0
        assert body["paging"]["limit"] == 50

    def test_application_linked_payments_returned(
        self, client: TestClient, db: Session, tenant_a: Tenants
    ) -> None:
        """Application-linked payments appear in results."""
        popup = _make_popup(db, tenant_a, suffix="d-apppay")
        human = _make_human(db, tenant_a, suffix="d-apppay")
        payment = _make_app_payment(db, tenant_a, popup, human)

        response = client.get(_payments_url(popup.id), headers=_auth(human))

        assert response.status_code == 200
        body = response.json()
        assert body["paging"]["total"] == 1
        assert len(body["results"]) == 1
        assert body["results"][0]["id"] == str(payment.id)

    def test_direct_sale_payments_returned(
        self, client: TestClient, db: Session, tenant_a: Tenants
    ) -> None:
        """Direct-sale payments appear via attendee.human_id ownership."""
        popup = _make_popup(db, tenant_a, suffix="d-dirpay")
        human = _make_human(db, tenant_a, suffix="d-dirpay")
        payment = _make_direct_payment(db, tenant_a, popup, human)

        response = client.get(_payments_url(popup.id), headers=_auth(human))

        assert response.status_code == 200
        body = response.json()
        assert body["paging"]["total"] == 1
        assert body["results"][0]["id"] == str(payment.id)

    def test_both_legs_no_duplicates(
        self, client: TestClient, db: Session, tenant_a: Tenants
    ) -> None:
        """Both application and direct-sale payments appear, no duplicates."""
        popup = _make_popup(db, tenant_a, suffix="d-bothpay")
        human = _make_human(db, tenant_a, suffix="d-bothpay")
        app_pay = _make_app_payment(db, tenant_a, popup, human)
        dir_pay = _make_direct_payment(db, tenant_a, popup, human)

        response = client.get(_payments_url(popup.id), headers=_auth(human))

        assert response.status_code == 200
        body = response.json()
        assert body["paging"]["total"] == 2
        ids = {r["id"] for r in body["results"]}
        assert str(app_pay.id) in ids
        assert str(dir_pay.id) in ids

    def test_limit_100_is_accepted(
        self, client: TestClient, db: Session, tenant_a: Tenants
    ) -> None:
        """limit=100 (the maximum) → 200."""
        popup = _make_popup(db, tenant_a, suffix="d-maxlim")
        human = _make_human(db, tenant_a, suffix="d-maxlim")

        response = client.get(
            f"{_payments_url(popup.id)}?limit=100",
            headers=_auth(human),
        )

        assert response.status_code == 200

    def test_limit_over_100_returns_422(
        self, client: TestClient, db: Session, tenant_a: Tenants
    ) -> None:
        """limit=101 (exceeds max) → 422 validation error."""
        popup = _make_popup(db, tenant_a, suffix="d-overlim")
        human = _make_human(db, tenant_a, suffix="d-overlim")

        response = client.get(
            f"{_payments_url(popup.id)}?limit=101",
            headers=_auth(human),
        )

        assert response.status_code == 422

    def test_cross_tenant_popup_returns_empty(
        self, client: TestClient, db: Session, tenant_a: Tenants, tenant_b: Tenants
    ) -> None:
        """Popup from tenant_b viewed by tenant_a human → RLS isolates → empty results."""
        popup_b = _make_popup(db, tenant_b, suffix="d-xtenant")
        human_a = _make_human(db, tenant_a, suffix="d-xtenant")

        response = client.get(_payments_url(popup_b.id), headers=_auth(human_a))

        assert response.status_code == 200
        body = response.json()
        assert body["results"] == []
        assert body["paging"]["total"] == 0

    def test_pagination_skip_and_limit(
        self, client: TestClient, db: Session, tenant_a: Tenants
    ) -> None:
        """skip=1, limit=1 with 2 payments → 1 result, total=2."""
        popup = _make_popup(db, tenant_a, suffix="d-paged")
        human = _make_human(db, tenant_a, suffix="d-paged")
        _make_app_payment(db, tenant_a, popup, human)
        _make_direct_payment(db, tenant_a, popup, human)

        response = client.get(
            f"{_payments_url(popup.id)}?skip=1&limit=1",
            headers=_auth(human),
        )

        assert response.status_code == 200
        body = response.json()
        assert body["paging"]["total"] == 2
        assert len(body["results"]) == 1
        assert body["paging"]["offset"] == 1
        assert body["paging"]["limit"] == 1
