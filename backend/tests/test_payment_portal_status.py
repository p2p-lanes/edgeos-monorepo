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
from app.api.product.models import Products
from app.api.shared.enums import SaleType
from app.api.tenant.models import Tenants
from app.core.security import create_access_token


def _make_popup(
    db: Session,
    tenant: Tenants,
    *,
    slug_suffix: str,
    sale_type: SaleType = SaleType.application,
    with_invoice: bool = False,
) -> Popups:
    popup = Popups(
        name=f"Payment Portal Status {slug_suffix}",
        slug=f"payment-portal-status-{slug_suffix}-{uuid.uuid4().hex[:6]}",
        tenant_id=tenant.id,
        sale_type=sale_type,
        invoice_company_name="ACME LLC" if with_invoice else None,
        invoice_company_address="123 Main St" if with_invoice else None,
        invoice_company_email="billing@example.com" if with_invoice else None,
    )
    db.add(popup)
    db.commit()
    db.refresh(popup)
    return popup


def _make_human(db: Session, tenant: Tenants, *, email: str, label: str) -> Humans:
    human = Humans(
        tenant_id=tenant.id,
        email=email,
        first_name=label,
        last_name="Tester",
    )
    db.add(human)
    db.commit()
    db.refresh(human)
    return human


def _make_application(
    db: Session,
    tenant: Tenants,
    popup: Popups,
    human: Humans,
) -> Applications:
    application = Applications(
        tenant_id=tenant.id,
        popup_id=popup.id,
        human_id=human.id,
        status=ApplicationStatus.ACCEPTED.value,
    )
    db.add(application)
    db.commit()
    db.refresh(application)
    return application


def _make_attendee(
    db: Session,
    tenant: Tenants,
    popup: Popups,
    *,
    human: Humans,
    application: Applications | None = None,
    name: str,
) -> Attendees:
    attendee = Attendees(
        tenant_id=tenant.id,
        application_id=application.id if application else None,
        popup_id=popup.id,
        human_id=human.id,
        name=name,
        category="main",
        email=human.email,
        check_in_code=f"PAY{uuid.uuid4().hex[:6].upper()}",
    )
    db.add(attendee)
    db.commit()
    db.refresh(attendee)
    return attendee


def _make_product(
    db: Session, tenant: Tenants, popup: Popups, *, slug_suffix: str
) -> Products:
    product = Products(
        tenant_id=tenant.id,
        popup_id=popup.id,
        name=f"Product {slug_suffix}",
        slug=f"product-{slug_suffix}-{uuid.uuid4().hex[:6]}",
        price=Decimal("120.00"),
        category="ticket",
    )
    db.add(product)
    db.commit()
    db.refresh(product)
    return product


def _make_payment(
    db: Session,
    tenant: Tenants,
    popup: Popups,
    *,
    status: PaymentStatus,
    application: Applications | None = None,
) -> Payments:
    payment = Payments(
        tenant_id=tenant.id,
        popup_id=popup.id,
        application_id=application.id if application else None,
        status=status.value,
        amount=Decimal("120.00"),
        currency="USD",
    )
    db.add(payment)
    db.commit()
    db.refresh(payment)
    return payment


def _add_payment_snapshot(
    db: Session,
    tenant: Tenants,
    payment: Payments,
    attendee: Attendees,
    product: Products,
    *,
    quantity: int = 1,
) -> None:
    snapshot = PaymentProducts(
        tenant_id=tenant.id,
        payment_id=payment.id,
        product_id=product.id,
        attendee_id=attendee.id,
        quantity=quantity,
        product_name=product.name,
        product_description=product.description,
        product_price=product.price,
        product_category=product.category,
        product_currency="USD",
    )
    db.add(snapshot)
    db.commit()


class TestPaymentPortalStatus:
    def test_get_my_payment_status_returns_owned_application_payment(
        self,
        client: TestClient,
        db: Session,
        tenant_a: Tenants,
    ) -> None:
        popup = _make_popup(db, tenant_a, slug_suffix="application-status")
        human = _make_human(
            db,
            tenant_a,
            email=f"application-owner-{uuid.uuid4().hex[:8]}@test.com",
            label="Applicant",
        )
        application = _make_application(db, tenant_a, popup, human)
        payment = _make_payment(
            db,
            tenant_a,
            popup,
            status=PaymentStatus.PENDING,
            application=application,
        )
        human_token = create_access_token(subject=human.id, token_type="human")

        response = client.get(
            f"/api/v1/payments/my/{payment.id}/status",
            headers={"Authorization": f"Bearer {human_token}"},
        )

        assert response.status_code == 200, response.text
        assert response.json() == {
            "id": str(payment.id),
            "status": PaymentStatus.PENDING.value,
        }

    def test_get_my_payment_status_returns_owned_direct_sale_payment_for_any_snapshot_attendee(
        self,
        client: TestClient,
        db: Session,
        tenant_a: Tenants,
    ) -> None:
        popup = _make_popup(
            db,
            tenant_a,
            slug_suffix="direct-status",
            sale_type=SaleType.direct,
        )
        owner = _make_human(
            db,
            tenant_a,
            email=f"direct-owner-{uuid.uuid4().hex[:8]}@test.com",
            label="Owner",
        )
        other_human = _make_human(
            db,
            tenant_a,
            email=f"direct-other-{uuid.uuid4().hex[:8]}@test.com",
            label="Other",
        )
        other_attendee = _make_attendee(
            db,
            tenant_a,
            popup,
            human=other_human,
            name="First Snapshot Attendee",
        )
        owner_attendee = _make_attendee(
            db,
            tenant_a,
            popup,
            human=owner,
            name="Second Snapshot Attendee",
        )
        product = _make_product(db, tenant_a, popup, slug_suffix="direct-status")
        payment = _make_payment(db, tenant_a, popup, status=PaymentStatus.APPROVED)
        _add_payment_snapshot(db, tenant_a, payment, other_attendee, product)
        _add_payment_snapshot(db, tenant_a, payment, owner_attendee, product)
        owner_token = create_access_token(subject=owner.id, token_type="human")

        response = client.get(
            f"/api/v1/payments/my/{payment.id}/status",
            headers={"Authorization": f"Bearer {owner_token}"},
        )

        assert response.status_code == 200, response.text
        assert response.json() == {
            "id": str(payment.id),
            "status": PaymentStatus.APPROVED.value,
        }

    def test_get_my_payment_status_returns_404_for_missing_or_foreign_payment(
        self,
        client: TestClient,
        db: Session,
        tenant_a: Tenants,
    ) -> None:
        popup = _make_popup(db, tenant_a, slug_suffix="foreign-status")
        owner = _make_human(
            db,
            tenant_a,
            email=f"foreign-owner-{uuid.uuid4().hex[:8]}@test.com",
            label="Owner",
        )
        stranger = _make_human(
            db,
            tenant_a,
            email=f"foreign-stranger-{uuid.uuid4().hex[:8]}@test.com",
            label="Stranger",
        )
        application = _make_application(db, tenant_a, popup, owner)
        payment = _make_payment(
            db,
            tenant_a,
            popup,
            status=PaymentStatus.REJECTED,
            application=application,
        )
        stranger_token = create_access_token(subject=stranger.id, token_type="human")

        for payment_id in (payment.id, uuid.uuid4()):
            response = client.get(
                f"/api/v1/payments/my/{payment_id}/status",
                headers={"Authorization": f"Bearer {stranger_token}"},
            )

            assert response.status_code == 404, response.text
            assert response.json() == {"detail": "Payment not found"}

    def test_get_my_invoice_uses_same_ownership_rule_for_direct_sale_payment(
        self,
        client: TestClient,
        db: Session,
        tenant_a: Tenants,
        monkeypatch,
    ) -> None:
        popup = _make_popup(
            db,
            tenant_a,
            slug_suffix="direct-invoice",
            sale_type=SaleType.direct,
            with_invoice=True,
        )
        owner = _make_human(
            db,
            tenant_a,
            email=f"invoice-owner-{uuid.uuid4().hex[:8]}@test.com",
            label="Invoice",
        )
        other_human = _make_human(
            db,
            tenant_a,
            email=f"invoice-other-{uuid.uuid4().hex[:8]}@test.com",
            label="Other",
        )
        other_attendee = _make_attendee(
            db,
            tenant_a,
            popup,
            human=other_human,
            name="Invoice First Snapshot",
        )
        owner_attendee = _make_attendee(
            db,
            tenant_a,
            popup,
            human=owner,
            name="Invoice Second Snapshot",
        )
        product = _make_product(db, tenant_a, popup, slug_suffix="direct-invoice")
        payment = _make_payment(db, tenant_a, popup, status=PaymentStatus.APPROVED)
        _add_payment_snapshot(db, tenant_a, payment, other_attendee, product)
        _add_payment_snapshot(db, tenant_a, payment, owner_attendee, product)
        owner_token = create_access_token(subject=owner.id, token_type="human")
        captured: dict[str, str] = {}

        def fake_generate_invoice_pdf(**kwargs) -> bytes:
            captured["client_name"] = kwargs["client_name"]
            return b"pdf-bytes"

        monkeypatch.setattr(
            "app.core.invoice.generate_invoice_pdf",
            fake_generate_invoice_pdf,
        )

        response = client.get(
            f"/api/v1/payments/my/{payment.id}/invoice",
            headers={"Authorization": f"Bearer {owner_token}"},
        )

        assert response.status_code == 200, response.text
        assert response.content == b"pdf-bytes"
        assert captured["client_name"] == "Invoice Tester"

    def test_get_my_invoice_returns_404_for_missing_or_foreign_payment(
        self,
        client: TestClient,
        db: Session,
        tenant_a: Tenants,
    ) -> None:
        popup = _make_popup(
            db,
            tenant_a,
            slug_suffix="invoice-404",
            with_invoice=True,
        )
        owner = _make_human(
            db,
            tenant_a,
            email=f"invoice-404-owner-{uuid.uuid4().hex[:8]}@test.com",
            label="Owner",
        )
        stranger = _make_human(
            db,
            tenant_a,
            email=f"invoice-404-stranger-{uuid.uuid4().hex[:8]}@test.com",
            label="Stranger",
        )
        application = _make_application(db, tenant_a, popup, owner)
        payment = _make_payment(
            db,
            tenant_a,
            popup,
            status=PaymentStatus.APPROVED,
            application=application,
        )
        stranger_token = create_access_token(subject=stranger.id, token_type="human")

        for payment_id in (payment.id, uuid.uuid4()):
            response = client.get(
                f"/api/v1/payments/my/{payment_id}/invoice",
                headers={"Authorization": f"Bearer {stranger_token}"},
            )

            assert response.status_code == 404, response.text
            assert response.json() == {"detail": "Payment not found"}
