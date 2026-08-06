"""Complex ``filters`` query param on GET /attendees (BO list).

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

from app.api.attendee.models import AttendeeProducts, Attendees
from app.api.attendee_category.models import AttendeeCategories
from app.api.popup.models import Popups
from app.api.product.models import Products
from app.api.tenant.models import Tenants
from tests._flow_helpers import assign_to_default_flow
from tests.api.application_review.test_pending_reviews import (
    _auth,
    _make_admin,
    _make_popup,
)

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _make_category(
    db: Session, tenant: Tenants, popup: Popups, key: str
) -> AttendeeCategories:
    cat = AttendeeCategories(
        id=uuid.uuid4(), tenant_id=tenant.id, popup_id=popup.id, key=key
    )
    db.add(cat)
    db.commit()
    db.refresh(cat)
    return cat


def _make_attendee(
    db: Session,
    tenant: Tenants,
    popup: Popups,
    *,
    name: str = "Filters Attendee",
    email: str | None = None,
    gender: str | None = None,
    category_id: uuid.UUID | None = None,
    created_at: datetime | None = None,
) -> Attendees:
    attendee = Attendees(
        id=uuid.uuid4(),
        tenant_id=tenant.id,
        popup_id=popup.id,
        name=name,
        email=email,
        gender=gender,
        category_id=category_id,
    )
    if created_at is not None:
        attendee.created_at = created_at
    db.add(attendee)
    db.commit()
    db.refresh(attendee)
    return attendee


def _make_ticket(
    db: Session, tenant: Tenants, popup: Popups, attendee: Attendees
) -> None:
    product = Products(
        tenant_id=tenant.id,
        popup_id=popup.id,
        name="Filters Ticket",
        slug=f"filters-ticket-{uuid.uuid4().hex[:8]}",
        price=Decimal("10.00"),
    )
    db.add(product)
    db.flush()
    assign_to_default_flow(db, product)
    db.add(
        AttendeeProducts(
            tenant_id=tenant.id,
            attendee_id=attendee.id,
            product_id=product.id,
            check_in_code=f"FLT{uuid.uuid4().hex[:8].upper()}",
        )
    )
    db.commit()


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
    return client.get("/api/v1/attendees", params=params, headers=_auth(admin, tenant))


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


class TestAttendeeListFilters:
    def test_name_contains_and_email_eq(
        self, db: Session, tenant_a: Tenants, client: TestClient
    ) -> None:
        popup = _make_popup(db, tenant_a)
        admin = _make_admin(db, tenant_a)
        alice = _make_attendee(
            db, tenant_a, popup, name="Alice Doe", email="alice@test.com"
        )
        bob = _make_attendee(db, tenant_a, popup, name="Bob Roe", email="bob@test.com")

        response = _list(
            client, admin, tenant_a, popup, _one("name", "contains", "ali")
        )
        assert _ids(response) == {str(alice.id)}

        response = _list(
            client, admin, tenant_a, popup, _one("email", "eq", "bob@test.com")
        )
        assert _ids(response) == {str(bob.id)}

    def test_category_id_eq_and_neq(
        self, db: Session, tenant_a: Tenants, client: TestClient
    ) -> None:
        popup = _make_popup(db, tenant_a)
        admin = _make_admin(db, tenant_a)
        cat_a = _make_category(db, tenant_a, popup, key=f"a-{uuid.uuid4().hex[:6]}")
        cat_b = _make_category(db, tenant_a, popup, key=f"b-{uuid.uuid4().hex[:6]}")
        in_a = _make_attendee(db, tenant_a, popup, category_id=cat_a.id)
        in_b = _make_attendee(db, tenant_a, popup, category_id=cat_b.id)
        no_cat = _make_attendee(db, tenant_a, popup)

        response = _list(
            client, admin, tenant_a, popup, _one("category_id", "eq", str(cat_a.id))
        )
        assert _ids(response) == {str(in_a.id)}

        # neq also matches attendees without a category (NULL).
        response = _list(
            client, admin, tenant_a, popup, _one("category_id", "neq", str(cat_a.id))
        )
        assert _ids(response) == {str(in_b.id), str(no_cat.id)}

    def test_gender_is_empty(
        self, db: Session, tenant_a: Tenants, client: TestClient
    ) -> None:
        popup = _make_popup(db, tenant_a)
        admin = _make_admin(db, tenant_a)
        missing = _make_attendee(db, tenant_a, popup, gender=None)
        filled = _make_attendee(db, tenant_a, popup, gender="female")

        response = _list(client, admin, tenant_a, popup, _one("gender", "is_empty"))
        assert _ids(response) == {str(missing.id)}

        response = _list(client, admin, tenant_a, popup, _one("gender", "not_empty"))
        assert _ids(response) == {str(filled.id)}

    def test_created_at_before_and_after(
        self, db: Session, tenant_a: Tenants, client: TestClient
    ) -> None:
        popup = _make_popup(db, tenant_a)
        admin = _make_admin(db, tenant_a)
        early = _make_attendee(
            db, tenant_a, popup, created_at=datetime(2026, 3, 1, 12, 0, tzinfo=UTC)
        )
        late = _make_attendee(
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

    def test_has_tickets_virtual_field(
        self, db: Session, tenant_a: Tenants, client: TestClient
    ) -> None:
        popup = _make_popup(db, tenant_a)
        admin = _make_admin(db, tenant_a)
        with_ticket = _make_attendee(db, tenant_a, popup)
        without_ticket = _make_attendee(db, tenant_a, popup)
        _make_ticket(db, tenant_a, popup, with_ticket)

        response = _list(
            client, admin, tenant_a, popup, _one("has_tickets", "eq", True)
        )
        assert _ids(response) == {str(with_ticket.id)}

        response = _list(
            client, admin, tenant_a, popup, _one("has_tickets", "eq", False)
        )
        assert _ids(response) == {str(without_ticket.id)}

    def test_match_all_vs_any(
        self, db: Session, tenant_a: Tenants, client: TestClient
    ) -> None:
        popup = _make_popup(db, tenant_a)
        admin = _make_admin(db, tenant_a)
        both = _make_attendee(db, tenant_a, popup, name="Alice", gender="female")
        only_name = _make_attendee(db, tenant_a, popup, name="Alice", gender="male")
        only_gender = _make_attendee(db, tenant_a, popup, name="Bob", gender="female")
        _make_attendee(db, tenant_a, popup, name="Bob", gender="male")

        conditions = [
            {"field": "name", "op": "eq", "value": "Alice"},
            {"field": "gender", "op": "eq", "value": "female"},
        ]

        response = _list(
            client, admin, tenant_a, popup, {"match": "all", "conditions": conditions}
        )
        assert _ids(response) == {str(both.id)}

        response = _list(
            client, admin, tenant_a, popup, {"match": "any", "conditions": conditions}
        )
        assert _ids(response) == {
            str(both.id),
            str(only_name.id),
            str(only_gender.id),
        }

    def test_legacy_params_combine_with_filters(
        self, db: Session, tenant_a: Tenants, client: TestClient
    ) -> None:
        popup = _make_popup(db, tenant_a)
        admin = _make_admin(db, tenant_a)
        match = _make_attendee(db, tenant_a, popup, name="Alice", gender="female")
        _make_attendee(db, tenant_a, popup, name="Alice", gender="male")
        _make_attendee(db, tenant_a, popup, name="Bob", gender="female")

        response = _list(
            client,
            admin,
            tenant_a,
            popup,
            _one("gender", "eq", "female"),
            search="Alice",
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

        response = _list(client, admin, tenant_a, popup, _one("poap_url", "eq", "x"))
        assert response.status_code == 422, response.text

    def test_disallowed_op_returns_422(
        self, db: Session, tenant_a: Tenants, client: TestClient
    ) -> None:
        popup = _make_popup(db, tenant_a)
        admin = _make_admin(db, tenant_a)

        response = _list(
            client, admin, tenant_a, popup, _one("category_id", "contains", "abc")
        )
        assert response.status_code == 422, response.text

    def test_empty_conditions_is_noop(
        self, db: Session, tenant_a: Tenants, client: TestClient
    ) -> None:
        popup = _make_popup(db, tenant_a)
        admin = _make_admin(db, tenant_a)
        first = _make_attendee(db, tenant_a, popup)
        second = _make_attendee(db, tenant_a, popup)

        response = _list(
            client, admin, tenant_a, popup, {"match": "all", "conditions": []}
        )
        assert _ids(response) == {str(first.id), str(second.id)}
