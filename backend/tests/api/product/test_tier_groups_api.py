"""Integration tests for /ticket-tier-groups API (Phase 2).

Tasks covered:
  2.3 RED/GREEN — Role guards, duplicate order 422, cross-tenant isolation,
                   SUPERADMIN without X-Tenant-Id → 400, feature flag off → 404.
  2.5 RED/GREEN — Concurrency: 51 parallel buyers vs shared_stock_cap=50.
  2.7 RED/GREEN — GET /products includes tier_group + phase when flag on;
                   null for ungrouped products.
"""

import threading
import uuid

import pytest
from fastapi.testclient import TestClient
from sqlmodel import Session

from app.api.popup.models import Popups
from app.api.product.models import TicketTierGroup

# ---------------------------------------------------------------------------
# Helper utilities
# ---------------------------------------------------------------------------


def _auth(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


def _admin_a_headers(token: str, tenant_id: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}", "X-Tenant-Id": tenant_id}


def _create_product(
    client: TestClient,
    token: str,
    popup_id: str,
    name: str | None = None,
) -> dict:
    payload = {
        "popup_id": popup_id,
        "name": name or f"Product-{uuid.uuid4().hex[:6]}",
        "price": "10.00",
        "category": "ticket",
    }
    resp = client.post(
        "/api/v1/products",
        json=payload,
        headers=_auth(token),
    )
    assert resp.status_code in (200, 201), resp.text
    return resp.json()


def _enable_tier_progression(db: Session, popup: Popups) -> None:
    """Set tier_progression_enabled=True on a popup and commit."""
    popup.tier_progression_enabled = True
    db.add(popup)
    db.commit()
    db.refresh(popup)


def _disable_tier_progression(db: Session, popup: Popups) -> None:
    """Set tier_progression_enabled=False on a popup and commit."""
    popup.tier_progression_enabled = False
    db.add(popup)
    db.commit()
    db.refresh(popup)


# ---------------------------------------------------------------------------
# 2.3 — Role guards
# ---------------------------------------------------------------------------


class TestTierGroupRoleGuards:
    """TG-5: VIEWER cannot create or mutate tier groups (403).
    SUPERADMIN without X-Tenant-Id header gets 400.
    """

    def test_viewer_cannot_post_tier_group(
        self,
        client: TestClient,
        viewer_token_tenant_a: str,
        popup_tenant_a: Popups,
        admin_token_tenant_a: str,
        db: Session,
    ) -> None:
        """VIEWER POST → 403."""
        _enable_tier_progression(db, popup_tenant_a)
        try:
            resp = client.post(
                "/api/v1/ticket-tier-groups",
                json={"name": "Viewer group", "popup_id": str(popup_tenant_a.id)},
                headers=_auth(viewer_token_tenant_a),
            )
            assert resp.status_code == 403, resp.text
        finally:
            _disable_tier_progression(db, popup_tenant_a)

    def test_superadmin_without_tenant_id_gets_400(
        self,
        client: TestClient,
        superadmin_token: str,
        popup_tenant_a: Popups,
        db: Session,
    ) -> None:
        """SUPERADMIN POST without X-Tenant-Id → 400."""
        _enable_tier_progression(db, popup_tenant_a)
        try:
            resp = client.post(
                "/api/v1/ticket-tier-groups",
                json={"name": "SA group", "popup_id": str(popup_tenant_a.id)},
                headers={"Authorization": f"Bearer {superadmin_token}"},
                # Intentionally no X-Tenant-Id
            )
            assert resp.status_code == 400, resp.text
        finally:
            _disable_tier_progression(db, popup_tenant_a)

    def test_viewer_cannot_patch_tier_group(
        self,
        client: TestClient,
        admin_token_tenant_a: str,
        viewer_token_tenant_a: str,
        popup_tenant_a: Popups,
        db: Session,
        tenant_a,
    ) -> None:
        """VIEWER PATCH → 403."""
        _enable_tier_progression(db, popup_tenant_a)
        try:
            # Admin creates a group
            resp = client.post(
                "/api/v1/ticket-tier-groups",
                json={"name": "Patchable group", "popup_id": str(popup_tenant_a.id)},
                headers=_auth(admin_token_tenant_a),
            )
            assert resp.status_code in (200, 201), resp.text
            group_id = resp.json()["id"]

            # Viewer tries to patch
            patch_resp = client.patch(
                f"/api/v1/ticket-tier-groups/{group_id}",
                json={"name": "Viewer rename"},
                headers=_auth(viewer_token_tenant_a),
            )
            assert patch_resp.status_code == 403, patch_resp.text
        finally:
            _disable_tier_progression(db, popup_tenant_a)


# ---------------------------------------------------------------------------
# 2.3 — Feature flag guard
# ---------------------------------------------------------------------------


class TestTierGroupFeatureFlag:
    """Endpoints return 404 when tier_progression_enabled is False."""

    def test_post_returns_404_when_flag_off(
        self,
        client: TestClient,
        admin_token_tenant_a: str,
        popup_tenant_a: Popups,
        db: Session,
    ) -> None:
        _disable_tier_progression(db, popup_tenant_a)
        resp = client.post(
            "/api/v1/ticket-tier-groups",
            json={"name": "Should fail", "popup_id": str(popup_tenant_a.id)},
            headers=_auth(admin_token_tenant_a),
        )
        assert resp.status_code == 404, resp.text

    def test_get_list_returns_404_when_flag_off(
        self,
        client: TestClient,
        admin_token_tenant_a: str,
        popup_tenant_a: Popups,
        db: Session,
    ) -> None:
        _disable_tier_progression(db, popup_tenant_a)
        resp = client.get(
            f"/api/v1/ticket-tier-groups?popup_id={popup_tenant_a.id}",
            headers=_auth(admin_token_tenant_a),
        )
        assert resp.status_code == 404, resp.text


# ---------------------------------------------------------------------------
# 2.3 — Duplicate (group_id, order) → 422
# ---------------------------------------------------------------------------


class TestTierGroupDuplicateOrder:
    """TG-4: duplicate (group_id, order) → 422."""

    def test_duplicate_phase_order_returns_422(
        self,
        client: TestClient,
        admin_token_tenant_a: str,
        popup_tenant_a: Popups,
        db: Session,
        tenant_a,
    ) -> None:
        _enable_tier_progression(db, popup_tenant_a)
        try:
            # Create group
            grp_resp = client.post(
                "/api/v1/ticket-tier-groups",
                json={"name": "Dup-order group", "popup_id": str(popup_tenant_a.id)},
                headers=_auth(admin_token_tenant_a),
            )
            assert grp_resp.status_code in (200, 201), grp_resp.text
            group_id = grp_resp.json()["id"]

            # Create two products
            prod1 = _create_product(
                client, admin_token_tenant_a, str(popup_tenant_a.id)
            )
            prod2 = _create_product(
                client, admin_token_tenant_a, str(popup_tenant_a.id)
            )

            # Assign phase order=1 to prod1
            phase1_resp = client.post(
                f"/api/v1/ticket-tier-groups/{group_id}/phases",
                json={
                    "product_id": prod1["id"],
                    "order": 1,
                    "label": "Early Bird",
                },
                headers=_auth(admin_token_tenant_a),
            )
            assert phase1_resp.status_code in (200, 201), phase1_resp.text

            # Attempt to assign phase order=1 again (different product, same order)
            phase2_resp = client.post(
                f"/api/v1/ticket-tier-groups/{group_id}/phases",
                json={
                    "product_id": prod2["id"],
                    "order": 1,
                    "label": "Early Bird Dupe",
                },
                headers=_auth(admin_token_tenant_a),
            )
            assert phase2_resp.status_code == 422, phase2_resp.text
        finally:
            _disable_tier_progression(db, popup_tenant_a)


# ---------------------------------------------------------------------------
# 2.3 — Cross-tenant isolation
# ---------------------------------------------------------------------------


class TestTierGroupCrossTenantIsolation:
    """Tenant A admin cannot read Tenant B tier groups via RLS."""

    def test_tenant_a_cannot_see_tenant_b_groups(
        self,
        client: TestClient,
        admin_token_tenant_a: str,
        admin_token_tenant_b: str,
        popup_tenant_a: Popups,
        popup_tenant_b: Popups,
        db: Session,
    ) -> None:
        _enable_tier_progression(db, popup_tenant_a)
        _enable_tier_progression(db, popup_tenant_b)
        try:
            # Tenant B admin creates a group
            b_resp = client.post(
                "/api/v1/ticket-tier-groups",
                json={"name": "Tenant B group", "popup_id": str(popup_tenant_b.id)},
                headers=_auth(admin_token_tenant_b),
            )
            assert b_resp.status_code in (200, 201), b_resp.text
            b_group_id = b_resp.json()["id"]

            # Tenant A admin tries to GET that group
            a_resp = client.get(
                f"/api/v1/ticket-tier-groups/{b_group_id}",
                headers=_auth(admin_token_tenant_a),
            )
            # RLS should block it → 403 or 404
            assert a_resp.status_code in (403, 404), a_resp.text
        finally:
            _disable_tier_progression(db, popup_tenant_a)
            _disable_tier_progression(db, popup_tenant_b)


# ---------------------------------------------------------------------------
# 2.5 — Concurrency: 51 buyers vs shared_stock_cap=50
# ---------------------------------------------------------------------------


class TestSharedStockConcurrency:
    """SI-2/AC-2: exactly one 409 among 51 concurrent buyers.

    Uses independent SQLAlchemy sessions (one per thread) to bypass the shared
    connection pool limit of TestClient. Each thread gets its own Session from
    the test_engine, which avoids pool exhaustion while preserving real
    concurrent DB write semantics.
    """

    def test_51_buyers_vs_cap_50(
        self,
        client: TestClient,
        admin_token_tenant_a: str,
        popup_tenant_a: Popups,
        db: Session,
        test_engine,
    ) -> None:
        """51 concurrent decrement calls against shared_stock_cap=50.

        Expected: exactly 50 succeed, exactly 1 fails (HTTPException 409),
        shared_stock_remaining ends at 0.
        """
        from fastapi import HTTPException
        from sqlmodel import Session as SyncSession

        from app.api.product.crud import tier_groups_crud

        _enable_tier_progression(db, popup_tenant_a)
        try:
            # Create a tier group with shared_stock_cap=50 via admin HTTP
            grp_resp = client.post(
                "/api/v1/ticket-tier-groups",
                json={
                    "name": f"Concurrency-{uuid.uuid4().hex[:6]}",
                    "popup_id": str(popup_tenant_a.id),
                    "shared_stock_cap": 50,
                },
                headers=_auth(admin_token_tenant_a),
            )
            assert grp_resp.status_code in (200, 201), grp_resp.text
            group_id = uuid.UUID(grp_resp.json()["id"])

            successes: list[bool] = []
            conflicts: list[bool] = []
            lock = threading.Lock()

            def decrement_one() -> None:
                """Each thread opens its own session to ensure independent connections.

                The CRUD method no longer commits internally — callers own the
                transaction. Each thread must commit explicitly for the UPDATE
                to persist and be visible to siblings.
                """
                with SyncSession(test_engine) as session:
                    try:
                        tier_groups_crud.decrement_shared_stock(session, group_id, 1)
                        session.commit()
                        with lock:
                            successes.append(True)
                    except HTTPException as exc:
                        session.rollback()
                        if exc.status_code == 409:
                            with lock:
                                conflicts.append(True)
                        else:
                            with lock:
                                # Unexpected error — still record it
                                conflicts.append(False)

            threads = [threading.Thread(target=decrement_one) for _ in range(51)]
            for t in threads:
                t.start()
            for t in threads:
                t.join()

            ok_count = len(successes)
            conflict_count = len(conflicts)

            assert ok_count == 50, (
                f"Expected 50 successes, got {ok_count} (conflicts: {conflict_count})"
            )
            assert conflict_count == 1, (
                f"Expected 1 conflict, got {conflict_count} (successes: {ok_count})"
            )

            # Verify DB final state
            db.expire_all()
            grp = db.get(TicketTierGroup, group_id)
            assert grp is not None
            assert grp.shared_stock_remaining == 0, (
                f"Expected remaining=0, got {grp.shared_stock_remaining}"
            )

        finally:
            _disable_tier_progression(db, popup_tenant_a)


# ---------------------------------------------------------------------------
# 2.7 — GET /products enrichment
# ---------------------------------------------------------------------------


class TestProductsEnrichment:
    """Products endpoint returns tier_group + phase when flag on, null when off."""

    def test_ungrouped_product_has_null_tier_fields(
        self,
        client: TestClient,
        admin_token_tenant_a: str,
        popup_tenant_a: Popups,
        db: Session,
    ) -> None:
        """BC-2: ungrouped product → tier_group=null, phase=null."""
        _enable_tier_progression(db, popup_tenant_a)
        try:
            prod = _create_product(
                client,
                admin_token_tenant_a,
                str(popup_tenant_a.id),
                name=f"Ungrouped-{uuid.uuid4().hex[:6]}",
            )
            product_id = prod["id"]

            resp = client.get(
                f"/api/v1/products/{product_id}",
                headers=_auth(admin_token_tenant_a),
            )
            assert resp.status_code == 200, resp.text
            data = resp.json()
            assert data.get("tier_group") is None
            assert data.get("phase") is None
        finally:
            _disable_tier_progression(db, popup_tenant_a)

    def test_grouped_product_has_tier_fields(
        self,
        client: TestClient,
        admin_token_tenant_a: str,
        popup_tenant_a: Popups,
        db: Session,
        tenant_a,
    ) -> None:
        """Grouped product → tier_group and phase are populated."""
        _enable_tier_progression(db, popup_tenant_a)
        try:
            # Create group
            grp_resp = client.post(
                "/api/v1/ticket-tier-groups",
                json={"name": "Early Bird Group", "popup_id": str(popup_tenant_a.id)},
                headers=_auth(admin_token_tenant_a),
            )
            assert grp_resp.status_code in (200, 201), grp_resp.text
            group_id = grp_resp.json()["id"]

            # Create product and assign to phase
            prod = _create_product(
                client,
                admin_token_tenant_a,
                str(popup_tenant_a.id),
                name=f"EB-{uuid.uuid4().hex[:6]}",
            )
            product_id = prod["id"]

            phase_resp = client.post(
                f"/api/v1/ticket-tier-groups/{group_id}/phases",
                json={
                    "product_id": product_id,
                    "order": 1,
                    "label": "Early Bird",
                },
                headers=_auth(admin_token_tenant_a),
            )
            assert phase_resp.status_code in (200, 201), phase_resp.text

            # Fetch the product — should have tier fields
            resp = client.get(
                f"/api/v1/products/{product_id}",
                headers=_auth(admin_token_tenant_a),
            )
            assert resp.status_code == 200, resp.text
            data = resp.json()
            assert data.get("tier_group") is not None, "tier_group should be populated"
            assert data.get("phase") is not None, "phase should be populated"
            assert data["tier_group"]["id"] == group_id
            assert data["phase"]["order"] == 1
            assert data["phase"]["label"] == "Early Bird"
            # Derived fields must be present
            assert "sales_state" in data["phase"]
            assert "is_purchasable" in data["phase"]
        finally:
            _disable_tier_progression(db, popup_tenant_a)

    def test_tier_fields_absent_when_flag_off(
        self,
        client: TestClient,
        admin_token_tenant_a: str,
        popup_tenant_a: Popups,
        db: Session,
    ) -> None:
        """When tier_progression_enabled=False, product response has no tier fields."""
        _disable_tier_progression(db, popup_tenant_a)
        prod = _create_product(
            client,
            admin_token_tenant_a,
            str(popup_tenant_a.id),
            name=f"NoFlag-{uuid.uuid4().hex[:6]}",
        )
        product_id = prod["id"]

        resp = client.get(
            f"/api/v1/products/{product_id}",
            headers=_auth(admin_token_tenant_a),
        )
        assert resp.status_code == 200, resp.text
        data = resp.json()
        # Either absent or null — both are acceptable when flag is off
        assert data.get("tier_group") is None
        assert data.get("phase") is None


# ---------------------------------------------------------------------------
# 2.6 — Purchase flow decrements shared_stock_remaining (SI-2)
# ---------------------------------------------------------------------------


class TestSharedStockDecrementOnPurchase:
    """SI-2: completing a purchase MUST decrement shared_stock_remaining
    atomically and roll back the whole transaction if the cap is exceeded.

    Exercises the `_decrement_shared_tier_stocks` helper that
    `create_payment` / `create_direct_payment` invoke before committing.
    Direct CRUD calls here avoid dragging SimpleFI / application fixtures
    into a backend-only regression test.
    """

    def _setup_group_with_phase(
        self,
        client: TestClient,
        admin_token: str,
        popup_id: str,
        *,
        shared_stock_cap: int,
    ) -> tuple[uuid.UUID, uuid.UUID]:
        """Create a tier group with a shared cap and one phase bound to a new product.

        Returns ``(group_id, product_id)``.
        """
        grp_resp = client.post(
            "/api/v1/ticket-tier-groups",
            json={
                "name": f"Purchase-{uuid.uuid4().hex[:6]}",
                "popup_id": popup_id,
                "shared_stock_cap": shared_stock_cap,
            },
            headers=_auth(admin_token),
        )
        assert grp_resp.status_code in (200, 201), grp_resp.text
        group_id = uuid.UUID(grp_resp.json()["id"])

        prod = _create_product(
            client,
            admin_token,
            popup_id,
            name=f"PhaseProduct-{uuid.uuid4().hex[:6]}",
        )
        product_id = uuid.UUID(prod["id"])

        phase_resp = client.post(
            f"/api/v1/ticket-tier-groups/{group_id}/phases",
            json={
                "product_id": str(product_id),
                "order": 1,
                "label": "Early Bird",
            },
            headers=_auth(admin_token),
        )
        assert phase_resp.status_code in (200, 201), phase_resp.text
        return group_id, product_id

    def test_purchase_helper_decrements_shared_stock(
        self,
        client: TestClient,
        admin_token_tenant_a: str,
        popup_tenant_a: Popups,
        db: Session,
    ) -> None:
        """Successful purchase lowers shared_stock_remaining by requested quantity."""
        from app.api.payment.crud import payments_crud
        from app.api.payment.schemas import PaymentProductRequest

        _enable_tier_progression(db, popup_tenant_a)
        try:
            group_id, product_id = self._setup_group_with_phase(
                client,
                admin_token_tenant_a,
                str(popup_tenant_a.id),
                shared_stock_cap=2,
            )

            request = [
                PaymentProductRequest(
                    product_id=product_id,
                    attendee_id=uuid.uuid4(),
                    quantity=1,
                )
            ]
            payments_crud._decrement_shared_tier_stocks(db, request)
            db.commit()

            db.expire_all()
            grp = db.get(TicketTierGroup, group_id)
            assert grp is not None
            assert grp.shared_stock_remaining == 1

            # Second purchase drains the cap to zero.
            payments_crud._decrement_shared_tier_stocks(db, request)
            db.commit()

            db.expire_all()
            grp = db.get(TicketTierGroup, group_id)
            assert grp is not None
            assert grp.shared_stock_remaining == 0
        finally:
            _disable_tier_progression(db, popup_tenant_a)

    def test_purchase_helper_raises_409_when_sold_out(
        self,
        client: TestClient,
        admin_token_tenant_a: str,
        popup_tenant_a: Popups,
        db: Session,
    ) -> None:
        """Attempting to purchase when cap is 0 raises 409 — caller rolls back."""
        from fastapi import HTTPException

        from app.api.payment.crud import payments_crud
        from app.api.payment.schemas import PaymentProductRequest

        _enable_tier_progression(db, popup_tenant_a)
        try:
            group_id, product_id = self._setup_group_with_phase(
                client,
                admin_token_tenant_a,
                str(popup_tenant_a.id),
                shared_stock_cap=1,
            )

            request = [
                PaymentProductRequest(
                    product_id=product_id,
                    attendee_id=uuid.uuid4(),
                    quantity=1,
                )
            ]
            payments_crud._decrement_shared_tier_stocks(db, request)
            db.commit()

            with pytest.raises(HTTPException) as exc_info:
                payments_crud._decrement_shared_tier_stocks(db, request)
            assert exc_info.value.status_code == 409
            db.rollback()

            # Cap must still be at 0 — no leak.
            db.expire_all()
            grp = db.get(TicketTierGroup, group_id)
            assert grp is not None
            assert grp.shared_stock_remaining == 0
        finally:
            _disable_tier_progression(db, popup_tenant_a)

    def test_purchase_helper_noop_without_tier_group(
        self,
        client: TestClient,
        admin_token_tenant_a: str,
        popup_tenant_a: Popups,
        db: Session,
    ) -> None:
        """Products not mapped to any tier phase must not decrement anything."""
        from app.api.payment.crud import payments_crud
        from app.api.payment.schemas import PaymentProductRequest

        prod = _create_product(
            client,
            admin_token_tenant_a,
            str(popup_tenant_a.id),
            name=f"Plain-{uuid.uuid4().hex[:6]}",
        )
        product_id = uuid.UUID(prod["id"])

        request = [
            PaymentProductRequest(
                product_id=product_id,
                attendee_id=uuid.uuid4(),
                quantity=5,
            )
        ]
        # Should succeed without touching any tier_group rows.
        payments_crud._decrement_shared_tier_stocks(db, request)

    def test_purchase_helper_noop_when_group_has_no_cap(
        self,
        client: TestClient,
        admin_token_tenant_a: str,
        popup_tenant_a: Popups,
        db: Session,
    ) -> None:
        """Group with shared_stock_remaining NULL must not raise or update."""
        from app.api.payment.crud import payments_crud
        from app.api.payment.schemas import PaymentProductRequest

        _enable_tier_progression(db, popup_tenant_a)
        try:
            # Create group without a shared cap.
            grp_resp = client.post(
                "/api/v1/ticket-tier-groups",
                json={
                    "name": f"NoCap-{uuid.uuid4().hex[:6]}",
                    "popup_id": str(popup_tenant_a.id),
                },
                headers=_auth(admin_token_tenant_a),
            )
            assert grp_resp.status_code in (200, 201), grp_resp.text
            group_id = uuid.UUID(grp_resp.json()["id"])

            prod = _create_product(
                client,
                admin_token_tenant_a,
                str(popup_tenant_a.id),
                name=f"PhaseNoCap-{uuid.uuid4().hex[:6]}",
            )
            product_id = uuid.UUID(prod["id"])

            phase_resp = client.post(
                f"/api/v1/ticket-tier-groups/{group_id}/phases",
                json={
                    "product_id": str(product_id),
                    "order": 1,
                    "label": "Regular",
                },
                headers=_auth(admin_token_tenant_a),
            )
            assert phase_resp.status_code in (200, 201), phase_resp.text

            request = [
                PaymentProductRequest(
                    product_id=product_id,
                    attendee_id=uuid.uuid4(),
                    quantity=10,
                )
            ]
            # No cap → helper skips the UPDATE path entirely.
            payments_crud._decrement_shared_tier_stocks(db, request)

            db.expire_all()
            grp = db.get(TicketTierGroup, group_id)
            assert grp is not None
            assert grp.shared_stock_remaining is None
        finally:
            _disable_tier_progression(db, popup_tenant_a)
