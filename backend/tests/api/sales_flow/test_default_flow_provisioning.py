"""Task 5.0 — auto-provision a default sales_flow on popup creation.

New popups receive a compatibility fallback for legacy requests that omit a
flow. The slice-2 backfill added the same fallback to popups that existed
before it ran. This mirrors `PopupsCRUD.create`'s existing
`AttendeeCategoriesCRUD.seed_main_for_popup` auto-provisioning pattern:
same transaction, no commit inside the seed helper, caller owns the
transaction boundary.

Design D1: every Class B (inheritable override) column stays NULL so the
popup row remains the single source of truth.
"""

import uuid

from fastapi.testclient import TestClient
from sqlmodel import Session, select

from app.api.sales_flow.crud import resolve_default_flow_slug
from app.api.sales_flow.models import SalesFlows


class TestPopupCreateProvisionsDefaultFlow:
    def test_create_popup_provisions_exactly_one_default_flow(
        self,
        client: TestClient,
        admin_token_tenant_a: str,
        db: Session,
    ) -> None:
        unique = uuid.uuid4().hex[:8]
        resp = client.post(
            "/api/v1/popups",
            headers={"Authorization": f"Bearer {admin_token_tenant_a}"},
            json={"name": f"Provisioning Test {unique}", "sale_type": "direct"},
        )
        assert resp.status_code == 201, resp.text
        popup_id = uuid.UUID(resp.json()["id"])

        flows = db.exec(select(SalesFlows).where(SalesFlows.popup_id == popup_id)).all()
        assert len(flows) == 1

        flow = flows[0]
        assert flow.is_default is True
        assert flow.type == "direct"
        assert flow.slug == "default"
        # Named for what it does. The slug stays "default" — that one is a URL
        # and an operator may already have shared it.
        assert flow.name == "Checkout"
        assert flow.visibility == "direct_url_only"
        assert flow.reviewers_mode == "inherit"

        # The flow takes its own copy of the popup's channel configuration
        # (slice 7), so it starts offering exactly what the popup offered and
        # diverges from there rather than reading through.
        from app.api.popup.models import Popups

        popup = db.get(Popups, popup_id)
        assert flow.allows_coupons == popup.allows_coupons

        # But only the settings this kind of door can read. Nobody applies
        # through a direct sale, so an application layout and a scholarship
        # toggle are not "inherited as false" — they are undecided, and the
        # column says so (docs/sales-flows-templates.md, slice 1).
        assert flow.application_layout is None
        assert flow.allows_scholarship is None

    def test_create_popup_default_flow_type_mirrors_sale_type_application(
        self,
        client: TestClient,
        admin_token_tenant_a: str,
        db: Session,
    ) -> None:
        """Triangulation: default flow `type` tracks whichever sale_type the
        popup was created with — not hardcoded to one value."""
        unique = uuid.uuid4().hex[:8]
        resp = client.post(
            "/api/v1/popups",
            headers={"Authorization": f"Bearer {admin_token_tenant_a}"},
            json={
                "name": f"Provisioning Test App {unique}",
                "sale_type": "application",
            },
        )
        assert resp.status_code == 201, resp.text
        popup_id = uuid.UUID(resp.json()["id"])

        flow = db.exec(select(SalesFlows).where(SalesFlows.popup_id == popup_id)).one()
        assert flow.type == "application"
        assert flow.visibility == "portal_listed"


class TestResolveDefaultFlowSlugDecollision:
    """Pure function, mirrors the slice-2 backfill migration's own
    `resolve_default_flow_slug` de-collision logic (design task 5.0)."""

    def test_returns_candidate_when_free(self) -> None:
        assert resolve_default_flow_slug("default", taken=frozenset()) == "default"

    def test_suffixes_when_candidate_taken(self) -> None:
        assert (
            resolve_default_flow_slug("default", taken=frozenset({"default"}))
            == "default-flow"
        )

    def test_increments_suffix_until_free(self) -> None:
        assert (
            resolve_default_flow_slug(
                "default", taken=frozenset({"default", "default-flow"})
            )
            == "default-flow-2"
        )

    def test_reserved_slugs_are_always_blocked(self) -> None:
        assert resolve_default_flow_slug("thank-you", taken=frozenset()) != "thank-you"
