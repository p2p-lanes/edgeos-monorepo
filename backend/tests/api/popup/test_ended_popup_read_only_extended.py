"""HTTP integration tests for the ended-popup read-only guard on the
application/purchase surface (applications, attendees, groups, payments,
carts, portal products).

Complements ``tests/api/event/test_ended_popup_read_only.py``, which covers
the event/RSVP/venue surface. Backoffice/admin endpoints are not gated and
are not covered here.
"""

import uuid

from fastapi.testclient import TestClient
from sqlmodel import Session

from app.api.application.models import Applications
from app.api.application.schemas import ApplicationStatus
from app.api.group.models import GroupLeaders, Groups
from app.api.human.models import Humans
from app.api.popup.models import Popups
from app.api.product.models import Products
from app.api.tenant.models import Tenants
from app.core.security import create_access_token

READ_ONLY_DETAIL = "This popup has ended and is read-only."

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _make_popup(
    db: Session, tenant: Tenants, *, suffix: str, status: str = "ended"
) -> Popups:
    popup = Popups(
        id=uuid.uuid4(),
        tenant_id=tenant.id,
        name=f"Ended RO Ext Popup {suffix} {uuid.uuid4().hex[:6]}",
        slug=f"ended-ro-ext-{suffix}-{uuid.uuid4().hex[:6]}",
        status=status,
    )
    db.add(popup)
    db.commit()
    db.refresh(popup)
    return popup


def _make_human(db: Session, tenant: Tenants, *, suffix: str) -> Humans:
    human = Humans(
        id=uuid.uuid4(),
        tenant_id=tenant.id,
        email=f"ended-ro-ext-{suffix}-{uuid.uuid4().hex[:8]}@test.com",
    )
    db.add(human)
    db.commit()
    db.refresh(human)
    return human


def _make_application(
    db: Session, tenant: Tenants, popup: Popups, human: Humans
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


def _make_group_with_leader(
    db: Session, tenant: Tenants, popup: Popups, leader: Humans
) -> Groups:
    group = Groups(
        tenant_id=tenant.id,
        popup_id=popup.id,
        name=f"Ended RO Ext Group {uuid.uuid4().hex[:6]}",
        slug=f"ended-ro-ext-group-{uuid.uuid4().hex[:6]}",
    )
    db.add(group)
    db.flush()
    db.add(GroupLeaders(tenant_id=tenant.id, group_id=group.id, human_id=leader.id))
    db.commit()
    db.refresh(group)
    return group


def _make_product(
    db: Session, tenant: Tenants, popup: Popups, *, is_active: bool = True
) -> Products:
    product = Products(
        tenant_id=tenant.id,
        popup_id=popup.id,
        name=f"Ended RO Ext Product {uuid.uuid4().hex[:6]}",
        slug=f"ended-ro-ext-product-{uuid.uuid4().hex[:6]}",
        price=100,
        is_active=is_active,
    )
    db.add(product)
    db.commit()
    db.refresh(product)
    return product


def _auth(human: Humans) -> dict[str, str]:
    token = create_access_token(subject=human.id, token_type="human")
    return {"Authorization": f"Bearer {token}"}


def _member_payload() -> dict:
    return {
        "first_name": "Ended",
        "last_name": "Member",
        "email": f"ended-ro-ext-member-{uuid.uuid4().hex[:8]}@test.com",
    }


# ---------------------------------------------------------------------------
# Tests: portal mutations blocked on ended popups
# ---------------------------------------------------------------------------


class TestEndedPopupPortalWritesBlocked:
    def test_application_create_blocked(
        self, client: TestClient, db: Session, tenant_a: Tenants
    ) -> None:
        popup = _make_popup(db, tenant_a, suffix="app-create")
        human = _make_human(db, tenant_a, suffix="app-create")

        response = client.post(
            "/api/v1/applications/my",
            headers=_auth(human),
            json={
                "popup_id": str(popup.id),
                "first_name": "Ended",
                "last_name": "Applicant",
            },
        )

        assert response.status_code == 403, response.text
        assert response.json()["detail"] == READ_ONLY_DETAIL

    def test_application_update_blocked(
        self, client: TestClient, db: Session, tenant_a: Tenants
    ) -> None:
        popup = _make_popup(db, tenant_a, suffix="app-update")
        human = _make_human(db, tenant_a, suffix="app-update")
        _make_application(db, tenant_a, popup, human)

        response = client.patch(
            f"/api/v1/applications/my/{popup.id}",
            headers=_auth(human),
            json={"first_name": "New Name"},
        )

        assert response.status_code == 403, response.text
        assert response.json()["detail"] == READ_ONLY_DETAIL

    def test_detach_companion_blocked(
        self, client: TestClient, db: Session, tenant_a: Tenants
    ) -> None:
        popup = _make_popup(db, tenant_a, suffix="detach")
        human = _make_human(db, tenant_a, suffix="detach")

        # The guard fires before the companion lookup, so no companion row is
        # needed to reach it.
        response = client.post(
            "/api/v1/applications/my/detach-companion",
            headers=_auth(human),
            json={"popup_id": str(popup.id)},
        )

        assert response.status_code == 403, response.text
        assert response.json()["detail"] == READ_ONLY_DETAIL

    def test_application_attendee_add_blocked(
        self, client: TestClient, db: Session, tenant_a: Tenants
    ) -> None:
        popup = _make_popup(db, tenant_a, suffix="app-att-add")
        human = _make_human(db, tenant_a, suffix="app-att-add")
        _make_application(db, tenant_a, popup, human)

        response = client.post(
            f"/api/v1/applications/my/{popup.id}/attendees",
            headers=_auth(human),
            json={"name": "Ended Companion", "category": "spouse"},
        )

        assert response.status_code == 403, response.text
        assert response.json()["detail"] == READ_ONLY_DETAIL

    def test_application_attendee_update_blocked(
        self, client: TestClient, db: Session, tenant_a: Tenants
    ) -> None:
        popup = _make_popup(db, tenant_a, suffix="app-att-update")
        human = _make_human(db, tenant_a, suffix="app-att-update")
        application = _make_application(db, tenant_a, popup, human)

        from app.api.attendee.crud import attendees_crud

        attendee = attendees_crud.create_internal(
            session=db,
            tenant_id=tenant_a.id,
            application_id=application.id,
            popup_id=popup.id,
            name="Ended Companion",
            category="spouse",
        )

        response = client.patch(
            f"/api/v1/applications/my/{popup.id}/attendees/{attendee.id}",
            headers=_auth(human),
            json={"name": "Renamed Companion"},
        )

        assert response.status_code == 403, response.text
        assert response.json()["detail"] == READ_ONLY_DETAIL

    def test_application_attendee_delete_blocked(
        self, client: TestClient, db: Session, tenant_a: Tenants
    ) -> None:
        popup = _make_popup(db, tenant_a, suffix="app-att-delete")
        human = _make_human(db, tenant_a, suffix="app-att-delete")
        application = _make_application(db, tenant_a, popup, human)

        from app.api.attendee.crud import attendees_crud

        attendee = attendees_crud.create_internal(
            session=db,
            tenant_id=tenant_a.id,
            application_id=application.id,
            popup_id=popup.id,
            name="Ended Companion",
            category="spouse",
        )

        response = client.delete(
            f"/api/v1/applications/my/{popup.id}/attendees/{attendee.id}",
            headers=_auth(human),
        )

        assert response.status_code == 403, response.text
        assert response.json()["detail"] == READ_ONLY_DETAIL

    def test_attendee_create_blocked(
        self, client: TestClient, db: Session, tenant_a: Tenants
    ) -> None:
        popup = _make_popup(db, tenant_a, suffix="att-create")
        human = _make_human(db, tenant_a, suffix="att-create")
        _make_application(db, tenant_a, popup, human)

        response = client.post(
            f"/api/v1/attendees/my/popup/{popup.id}",
            headers=_auth(human),
            json={"name": "Ended Companion", "category": "spouse"},
        )

        assert response.status_code == 403, response.text
        assert response.json()["detail"] == READ_ONLY_DETAIL

    def test_attendee_delete_blocked(
        self, client: TestClient, db: Session, tenant_a: Tenants
    ) -> None:
        popup = _make_popup(db, tenant_a, suffix="att-delete")
        human = _make_human(db, tenant_a, suffix="att-delete")
        application = _make_application(db, tenant_a, popup, human)

        from app.api.attendee.crud import attendees_crud

        attendee = attendees_crud.create_internal(
            session=db,
            tenant_id=tenant_a.id,
            application_id=application.id,
            popup_id=popup.id,
            name="Ended Companion",
            category="spouse",
        )

        response = client.delete(
            f"/api/v1/attendees/my/popup/{popup.id}/{attendee.id}",
            headers=_auth(human),
        )

        assert response.status_code == 403, response.text
        assert response.json()["detail"] == READ_ONLY_DETAIL

    def test_group_update_blocked(
        self, client: TestClient, db: Session, tenant_a: Tenants
    ) -> None:
        popup = _make_popup(db, tenant_a, suffix="group-update")
        leader = _make_human(db, tenant_a, suffix="group-update-leader")
        group = _make_group_with_leader(db, tenant_a, popup, leader)

        response = client.patch(
            f"/api/v1/groups/my/{group.id}",
            headers=_auth(leader),
            json={"description": "Updated description"},
        )

        assert response.status_code == 403, response.text
        assert response.json()["detail"] == READ_ONLY_DETAIL

    def test_group_add_member_blocked(
        self, client: TestClient, db: Session, tenant_a: Tenants
    ) -> None:
        popup = _make_popup(db, tenant_a, suffix="group-add")
        leader = _make_human(db, tenant_a, suffix="group-add-leader")
        group = _make_group_with_leader(db, tenant_a, popup, leader)

        response = client.post(
            f"/api/v1/groups/my/{group.id}/members",
            headers=_auth(leader),
            json=_member_payload(),
        )

        assert response.status_code == 403, response.text
        assert response.json()["detail"] == READ_ONLY_DETAIL

    def test_group_add_members_batch_blocked(
        self, client: TestClient, db: Session, tenant_a: Tenants
    ) -> None:
        popup = _make_popup(db, tenant_a, suffix="group-batch")
        leader = _make_human(db, tenant_a, suffix="group-batch-leader")
        group = _make_group_with_leader(db, tenant_a, popup, leader)

        # The entry guard rejects the whole request with 403 instead of a 207
        # multi-status with per-member failures.
        response = client.post(
            f"/api/v1/groups/my/{group.id}/members/batch",
            headers=_auth(leader),
            json={"members": [_member_payload()]},
        )

        assert response.status_code == 403, response.text
        assert response.json()["detail"] == READ_ONLY_DETAIL

    def test_group_remove_member_blocked(
        self, client: TestClient, db: Session, tenant_a: Tenants
    ) -> None:
        popup = _make_popup(db, tenant_a, suffix="group-remove")
        leader = _make_human(db, tenant_a, suffix="group-remove-leader")
        group = _make_group_with_leader(db, tenant_a, popup, leader)

        # The guard fires before the membership lookup, so a nonexistent
        # member id still hits the 403.
        response = client.delete(
            f"/api/v1/groups/my/{group.id}/members/{uuid.uuid4()}",
            headers=_auth(leader),
        )

        assert response.status_code == 403, response.text
        assert response.json()["detail"] == READ_ONLY_DETAIL

    def test_payment_application_fee_blocked(
        self, client: TestClient, db: Session, tenant_a: Tenants
    ) -> None:
        popup = _make_popup(db, tenant_a, suffix="pay-fee")
        human = _make_human(db, tenant_a, suffix="pay-fee")
        application = _make_application(db, tenant_a, popup, human)

        response = client.post(
            "/api/v1/payments/my/application-fee",
            headers=_auth(human),
            json={"application_id": str(application.id)},
        )

        assert response.status_code == 403, response.text
        assert response.json()["detail"] == READ_ONLY_DETAIL

    def test_payment_create_blocked(
        self, client: TestClient, db: Session, tenant_a: Tenants
    ) -> None:
        popup = _make_popup(db, tenant_a, suffix="pay-create")
        human = _make_human(db, tenant_a, suffix="pay-create")
        application = _make_application(db, tenant_a, popup, human)

        # The guard fires before product resolution, so placeholder ids are
        # enough to reach it.
        response = client.post(
            "/api/v1/payments/my",
            headers=_auth(human),
            json={
                "application_id": str(application.id),
                "products": [
                    {
                        "product_id": str(uuid.uuid4()),
                        "attendee_id": str(uuid.uuid4()),
                    }
                ],
            },
        )

        assert response.status_code == 403, response.text
        assert response.json()["detail"] == READ_ONLY_DETAIL

    def test_cart_update_blocked(
        self, client: TestClient, db: Session, tenant_a: Tenants
    ) -> None:
        popup = _make_popup(db, tenant_a, suffix="cart-update")
        human = _make_human(db, tenant_a, suffix="cart-update")

        response = client.put(
            f"/api/v1/carts/my/{popup.id}",
            headers=_auth(human),
            json={"items": {}},
        )

        assert response.status_code == 403, response.text
        assert response.json()["detail"] == READ_ONLY_DETAIL

    def test_cart_delete_blocked(
        self, client: TestClient, db: Session, tenant_a: Tenants
    ) -> None:
        popup = _make_popup(db, tenant_a, suffix="cart-delete")
        human = _make_human(db, tenant_a, suffix="cart-delete")

        response = client.delete(
            f"/api/v1/carts/my/{popup.id}",
            headers=_auth(human),
        )

        assert response.status_code == 403, response.text
        assert response.json()["detail"] == READ_ONLY_DETAIL


# ---------------------------------------------------------------------------
# Tests: portal products listing (recap keeps scoped visibility, unscoped
# listing hides ended-popup products)
# ---------------------------------------------------------------------------


class TestEndedPopupPortalProductsHidden:
    def test_products_list_returns_products_for_ended_popup(
        self, client: TestClient, db: Session, tenant_a: Tenants
    ) -> None:
        # Scoped listing keeps returning ended-popup products: the portal
        # recap views (e.g. groups via PassesProvider) still need them, and
        # purchasing is blocked at the payment/cart/application layers.
        popup = _make_popup(db, tenant_a, suffix="products-ended")
        human = _make_human(db, tenant_a, suffix="products-ended")
        product = _make_product(db, tenant_a, popup)

        response = client.get(
            "/api/v1/products/portal/products",
            headers=_auth(human),
            params={"popup_id": str(popup.id)},
        )

        assert response.status_code == 200, response.text
        ids = [p["id"] for p in response.json()["results"]]
        assert str(product.id) in ids

    def test_products_list_returns_products_for_active_popup(
        self, client: TestClient, db: Session, tenant_a: Tenants
    ) -> None:
        popup = _make_popup(db, tenant_a, suffix="products-active", status="active")
        human = _make_human(db, tenant_a, suffix="products-active")
        product = _make_product(db, tenant_a, popup)

        response = client.get(
            "/api/v1/products/portal/products",
            headers=_auth(human),
            params={"popup_id": str(popup.id)},
        )

        assert response.status_code == 200, response.text
        ids = [p["id"] for p in response.json()["results"]]
        assert str(product.id) in ids

    def test_unscoped_products_list_excludes_ended_popup_products(
        self, client: TestClient, db: Session, tenant_a: Tenants
    ) -> None:
        ended_popup = _make_popup(db, tenant_a, suffix="products-unscoped-ended")
        active_popup = _make_popup(
            db, tenant_a, suffix="products-unscoped-active", status="active"
        )
        human = _make_human(db, tenant_a, suffix="products-unscoped")
        ended_product = _make_product(db, tenant_a, ended_popup)
        active_product = _make_product(db, tenant_a, active_popup)

        # Paginate through the full unscoped listing so the assertions stay
        # deterministic when the shared test DB already has other products.
        ids: list[str] = []
        skip = 0
        while True:
            response = client.get(
                "/api/v1/products/portal/products",
                headers=_auth(human),
                params={"skip": skip, "limit": 100},
            )
            assert response.status_code == 200, response.text
            results = response.json()["results"]
            ids.extend(p["id"] for p in results)
            if len(results) < 100:
                break
            skip += 100

        assert str(ended_product.id) not in ids
        assert str(active_product.id) in ids

    def test_unscoped_products_list_honors_is_active_filter(
        self, client: TestClient, db: Session, tenant_a: Tenants
    ) -> None:
        popup = _make_popup(db, tenant_a, suffix="products-is-active", status="active")
        human = _make_human(db, tenant_a, suffix="products-is-active")
        active_product = _make_product(db, tenant_a, popup, is_active=True)
        inactive_product = _make_product(db, tenant_a, popup, is_active=False)

        # Paginate through the full unscoped listing so the assertions stay
        # deterministic when the shared test DB already has other products.
        ids: list[str] = []
        skip = 0
        while True:
            response = client.get(
                "/api/v1/products/portal/products",
                headers=_auth(human),
                params={"is_active": True, "skip": skip, "limit": 100},
            )
            assert response.status_code == 200, response.text
            results = response.json()["results"]
            assert all(p["is_active"] is True for p in results)
            ids.extend(p["id"] for p in results)
            if len(results) < 100:
                break
            skip += 100

        assert str(active_product.id) in ids
        assert str(inactive_product.id) not in ids


# ---------------------------------------------------------------------------
# Tests: same calls stay writable on active popups
# ---------------------------------------------------------------------------


class TestActivePopupPortalWritesAllowed:
    def test_application_create_succeeds_on_active_popup(
        self, client: TestClient, db: Session, tenant_a: Tenants
    ) -> None:
        popup = _make_popup(db, tenant_a, suffix="active-app-create", status="active")
        human = _make_human(db, tenant_a, suffix="active-app-create")

        response = client.post(
            "/api/v1/applications/my",
            headers=_auth(human),
            json={
                "popup_id": str(popup.id),
                "first_name": "Active",
                "last_name": "Applicant",
            },
        )

        assert response.status_code == 201, response.text
        assert response.json()["popup_id"] == str(popup.id)

    def test_cart_update_succeeds_on_active_popup(
        self, client: TestClient, db: Session, tenant_a: Tenants
    ) -> None:
        popup = _make_popup(db, tenant_a, suffix="active-cart", status="active")
        human = _make_human(db, tenant_a, suffix="active-cart")

        response = client.put(
            f"/api/v1/carts/my/{popup.id}",
            headers=_auth(human),
            json={"items": {}},
        )

        assert response.status_code == 200, response.text
        assert response.json()["popup_id"] == str(popup.id)
