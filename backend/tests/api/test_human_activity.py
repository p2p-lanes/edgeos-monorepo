"""Tests for the per-human activity timeline (aggregate-on-read + manual notes).

The timeline merges applications, payments and attendees from the source tables
with manual notes stored in `audit_logs`, sorted newest-first by an effective
timestamp (`occurred_at`). These tests cover the aggregation shape, manual-note
ordering, tenant isolation (RLS), permissions and pagination.
"""

import uuid
from datetime import UTC, datetime
from decimal import Decimal

from fastapi.testclient import TestClient
from sqlmodel import Session, select

from app.api.application.models import Applications, ApplicationSnapshots
from app.api.attendee.models import Attendees
from app.api.audit_log.constants import AuditAction, AuditEntityType
from app.api.audit_log.models import AuditLog
from app.api.human.models import Humans
from app.api.payment.models import PaymentProducts, Payments
from app.api.popup.models import Popups
from app.api.product.models import Products
from app.api.tenant.models import Tenants


def _auth(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


def _make_human(db: Session, tenant: Tenants) -> Humans:
    human = Humans(
        id=uuid.uuid4(),
        tenant_id=tenant.id,
        email=f"activity-{uuid.uuid4().hex[:8]}@test.com",
        first_name="Activity",
        last_name="Tester",
    )
    db.add(human)
    db.commit()
    db.refresh(human)
    return human


def _seed_history(db: Session, tenant: Tenants, popup: Popups, human: Humans) -> None:
    """Seed one application (submitted+accepted), one approved payment with two
    products, and one attendee — one of each timeline kind, with controlled times.
    """
    application = Applications(
        id=uuid.uuid4(),
        tenant_id=tenant.id,
        popup_id=popup.id,
        human_id=human.id,
        status="accepted",
        submitted_at=datetime(2023, 1, 1, tzinfo=UTC),
        created_at=datetime(2023, 1, 1, tzinfo=UTC),
    )
    db.add(application)
    db.commit()

    db.add(
        ApplicationSnapshots(
            id=uuid.uuid4(),
            tenant_id=tenant.id,
            application_id=application.id,
            event="accepted",
            email=human.email,
            status="accepted",
            created_at=datetime(2023, 2, 1, tzinfo=UTC),
        )
    )
    db.commit()

    attendee = Attendees(
        id=uuid.uuid4(),
        tenant_id=tenant.id,
        popup_id=popup.id,
        human_id=human.id,
        name="Activity Attendee",
        created_at=datetime(2023, 4, 1, tzinfo=UTC),
    )
    db.add(attendee)

    product = Products(
        id=uuid.uuid4(),
        tenant_id=tenant.id,
        popup_id=popup.id,
        name=f"Activity Product {uuid.uuid4().hex[:6]}",
        slug=f"activity-prod-{uuid.uuid4().hex[:6]}",
        price=Decimal("100"),
        category="ticket",
    )
    db.add(product)
    db.commit()

    payment = Payments(
        id=uuid.uuid4(),
        tenant_id=tenant.id,
        application_id=application.id,
        popup_id=popup.id,
        status="approved",
        amount=Decimal("250.00"),
        currency="USD",
        created_at=datetime(2023, 3, 1, tzinfo=UTC),
    )
    db.add(payment)
    db.commit()

    for name, category, qty in (("General", "ticket", 2), ("VIP", "ticket", 1)):
        db.add(
            PaymentProducts(
                id=uuid.uuid4(),
                tenant_id=tenant.id,
                payment_id=payment.id,
                product_id=product.id,
                attendee_id=attendee.id,
                quantity=qty,
                product_name=name,
                product_price=Decimal("100"),
                product_category=category,
            )
        )
    db.commit()


class TestHumanActivityAggregation:
    def test_returns_one_item_per_kind_newest_first(
        self,
        client: TestClient,
        db: Session,
        tenant_a: Tenants,
        popup_tenant_a: Popups,
        admin_token_tenant_a: str,
    ) -> None:
        human = _make_human(db, tenant_a)
        _seed_history(db, tenant_a, popup_tenant_a, human)

        resp = client.get(
            f"/api/v1/humans/{human.id}/activity", headers=_auth(admin_token_tenant_a)
        )
        assert resp.status_code == 200
        body = resp.json()
        results = body["results"]

        # Newest-first: attendee (Apr) > payment (Mar) > accepted (Feb) > submitted (Jan)
        kinds = [item["kind"] for item in results]
        assert kinds == [
            "ticket.added",
            "payment.completed",
            "application.accepted",
            "application.submitted",
        ]
        assert body["paging"]["total"] == 4

        payment_item = next(i for i in results if i["kind"] == "payment.completed")
        assert payment_item["amount"] == "250.00"
        assert payment_item["currency"] == "USD"
        product_summary = {
            (p["product_name"], p["quantity"]) for p in payment_item["products"]
        }
        assert product_summary == {("General", 2), ("VIP", 1)}

        # Popup labels are filled in for source-derived items.
        assert payment_item["popup_label"] == popup_tenant_a.name


class TestHumanActivityNotes:
    def test_note_orders_by_occurred_at_not_created_at(
        self,
        client: TestClient,
        db: Session,
        tenant_a: Tenants,
        popup_tenant_a: Popups,
        admin_token_tenant_a: str,
    ) -> None:
        human = _make_human(db, tenant_a)
        _seed_history(db, tenant_a, popup_tenant_a, human)

        # occurred_at far in the past — older than every seeded item — even though
        # the audit row's created_at is "now". A created_at sort would put it
        # first; an occurred_at sort puts it last.
        past = "2000-01-01T00:00:00+00:00"
        create = client.post(
            f"/api/v1/humans/{human.id}/activity",
            headers=_auth(admin_token_tenant_a),
            json={"note": "Met them at a prior event", "occurred_at": past},
        )
        assert create.status_code == 201
        created = create.json()
        assert created["kind"] == "note.added"
        assert created["note"] == "Met them at a prior event"
        assert created["actor_name"] is not None

        resp = client.get(
            f"/api/v1/humans/{human.id}/activity", headers=_auth(admin_token_tenant_a)
        )
        results = resp.json()["results"]
        assert results[-1]["kind"] == "note.added"
        assert results[-1]["note"] == "Met them at a prior event"

        # An audit_logs row with the note action exists for this human.
        rows = db.exec(
            select(AuditLog).where(
                AuditLog.entity_type == AuditEntityType.HUMAN,
                AuditLog.entity_id == human.id,
                AuditLog.action == AuditAction.HUMAN_NOTE_ADDED,
            )
        ).all()
        assert len(rows) == 1
        assert rows[0].details["note"] == "Met them at a prior event"


class TestHumanActivityIsolationAndPermissions:
    def test_other_tenant_human_not_returned(
        self,
        client: TestClient,
        db: Session,
        tenant_b: Tenants,
        admin_token_tenant_a: str,
    ) -> None:
        other = _make_human(db, tenant_b)
        resp = client.get(
            f"/api/v1/humans/{other.id}/activity", headers=_auth(admin_token_tenant_a)
        )
        assert resp.status_code == 404

    def test_missing_human_returns_404(
        self,
        client: TestClient,
        admin_token_tenant_a: str,
    ) -> None:
        resp = client.get(
            f"/api/v1/humans/{uuid.uuid4()}/activity",
            headers=_auth(admin_token_tenant_a),
        )
        assert resp.status_code == 404

    def test_non_admin_forbidden_on_both_endpoints(
        self,
        client: TestClient,
        db: Session,
        tenant_a: Tenants,
        viewer_token_tenant_a: str,
    ) -> None:
        human = _make_human(db, tenant_a)
        get_resp = client.get(
            f"/api/v1/humans/{human.id}/activity", headers=_auth(viewer_token_tenant_a)
        )
        assert get_resp.status_code == 403

        post_resp = client.post(
            f"/api/v1/humans/{human.id}/activity",
            headers=_auth(viewer_token_tenant_a),
            json={"note": "x", "occurred_at": "2024-01-01T00:00:00+00:00"},
        )
        assert post_resp.status_code == 403


class TestHumanActivityPagination:
    def test_skip_and_limit_slice_with_full_total(
        self,
        client: TestClient,
        db: Session,
        tenant_a: Tenants,
        popup_tenant_a: Popups,
        admin_token_tenant_a: str,
    ) -> None:
        human = _make_human(db, tenant_a)
        _seed_history(db, tenant_a, popup_tenant_a, human)

        resp = client.get(
            f"/api/v1/humans/{human.id}/activity?skip=1&limit=2",
            headers=_auth(admin_token_tenant_a),
        )
        assert resp.status_code == 200
        body = resp.json()
        assert len(body["results"]) == 2
        assert body["paging"]["total"] == 4
        assert body["paging"]["offset"] == 1
        assert body["paging"]["limit"] == 2
        # Page two of newest-first = payment, accepted.
        assert [i["kind"] for i in body["results"]] == [
            "payment.completed",
            "application.accepted",
        ]
