"""Task 9.4 — GET /sales-flows/portal (portal-facing flow listing).

Design: sdd/sales-flows G0 (Portal flow listing) + Threat Matrix. Lists a
popup's `portal_listed`, `type=application` sales flows, ordered by `order`
then `created_at` — backs the portal FlowPicker (shown only when >1 exists).
`direct_url_only` flows are reachable by URL (see checkout runtime tests)
but never appear here.

TDD: RED -> GREEN.
"""

import uuid
from datetime import UTC, datetime
from decimal import Decimal

from fastapi.testclient import TestClient
from sqlmodel import Session

from app.api.attendee_category.models import AttendeeCategories
from app.api.popup.models import Popups
from app.api.product.models import Products
from app.api.sales_flow.crud import sales_flows_crud
from app.api.sales_flow.models import SalesFlows
from app.api.tenant.models import Tenants
from app.api.ticketing_step.models import TicketingSteps


def _make_popup(db: Session, tenant: Tenants) -> Popups:
    slug = f"portal-listing-{uuid.uuid4().hex[:8]}"
    popup = Popups(tenant_id=tenant.id, name=f"Popup {slug}", slug=slug)
    db.add(popup)
    db.flush()
    sales_flows_crud.provision_default_flow(
        db, popup_id=popup.id, tenant_id=tenant.id, sale_type="application"
    )
    db.flush()
    return popup


def _make_flow(
    db: Session,
    popup: Popups,
    *,
    slug: str,
    visibility: str = "portal_listed",
    type: str = "application",  # noqa: A002
    order: int = 0,
    status: str | None = None,
) -> SalesFlows:
    flow = SalesFlows(
        tenant_id=popup.tenant_id,
        popup_id=popup.id,
        slug=slug,
        name=f"Flow {slug}",
        visibility=visibility,
        type=type,
        order=order,
        status=status,
    )
    db.add(flow)
    db.flush()
    return flow


def _human_token(db: Session, tenant: Tenants) -> str:
    from app.api.human.models import Humans
    from app.core.security import create_access_token

    human = Humans(
        tenant_id=tenant.id,
        email=f"portal-listing-{uuid.uuid4().hex[:8]}@test.com",
        first_name="Pat",
        last_name="Doe",
    )
    db.add(human)
    db.commit()
    return create_access_token(subject=human.id, token_type="human")


def _make_product(
    db: Session,
    popup: Popups,
    *,
    price: Decimal,
    category: str = "ticket",
    is_active: bool = True,
    deleted_at: datetime | None = None,
) -> Products:
    product = Products(
        tenant_id=popup.tenant_id,
        popup_id=popup.id,
        name=f"Product {uuid.uuid4().hex[:8]}",
        slug=f"product-{uuid.uuid4().hex[:8]}",
        price=price,
        category=category,
        is_active=is_active,
        deleted_at=deleted_at,
    )
    db.add(product)
    db.flush()
    return product


def _add_primary_category(db: Session, popup: Popups) -> AttendeeCategories:
    category = AttendeeCategories(
        tenant_id=popup.tenant_id,
        popup_id=popup.id,
        key=f"primary-{uuid.uuid4().hex[:8]}",
        is_primary=True,
    )
    db.add(category)
    db.flush()
    return category


def _add_category(db: Session, popup: Popups) -> AttendeeCategories:
    category = AttendeeCategories(
        tenant_id=popup.tenant_id,
        popup_id=popup.id,
        key=f"companion-{uuid.uuid4().hex[:8]}",
    )
    db.add(category)
    db.flush()
    return category


def _offer_sections(
    db: Session,
    flow: SalesFlows,
    sections: list[dict[str, object]],
    *,
    is_enabled: bool = True,
    template: str = "ticket-select",
) -> None:
    db.add(
        TicketingSteps(
            tenant_id=flow.tenant_id,
            popup_id=flow.popup_id,
            sales_flow_id=flow.id,
            step_type="tickets",
            title="Tickets",
            product_category="ticket",
            is_enabled=is_enabled,
            template=template,
            template_config={"sections": sections},
        )
    )


def _offer_products(db: Session, flow: SalesFlows, products: list[Products]) -> None:
    _offer_sections(
        db,
        flow,
        [
            {
                "key": "tickets",
                "label": "Tickets",
                "product_ids": [str(product.id) for product in products],
            }
        ],
    )


class TestPortalFlowListing:
    def test_application_listing_reports_a_fixed_price_summary(
        self, client: TestClient, db: Session, tenant_a: Tenants
    ) -> None:
        popup = _make_popup(db, tenant_a)
        flow = _make_flow(db, popup, slug="priced")
        _add_primary_category(db, popup)
        _offer_products(db, flow, [_make_product(db, popup, price=Decimal("50"))])
        db.commit()

        response = client.get(
            "/api/v1/sales-flows/portal",
            params={"popup_id": str(popup.id)},
            headers={"Authorization": f"Bearer {_human_token(db, tenant_a)}"},
        )

        assert response.status_code == 200, response.text
        priced_flow = next(
            item for item in response.json()["results"] if item["slug"] == flow.slug
        )
        assert priced_flow["price_summary"] == {
            "amount": "50.00",
            "currency": "USD",
            "kind": "fixed",
        }

    def test_application_listing_uses_only_equal_paid_tickets_visible_to_primary_attendee(
        self, client: TestClient, db: Session, tenant_a: Tenants
    ) -> None:
        popup = _make_popup(db, tenant_a)
        flow = _make_flow(db, popup, slug="primary-fixed")
        primary = _add_primary_category(db, popup)
        companion = _add_category(db, popup)
        primary_ticket = _make_product(db, popup, price=Decimal("50"))
        companion_ticket = _make_product(db, popup, price=Decimal("5"))
        free_ticket = _make_product(db, popup, price=Decimal("0"))
        non_ticket = _make_product(db, popup, price=Decimal("1"), category="merch")
        inactive_ticket = _make_product(db, popup, price=Decimal("2"), is_active=False)
        deleted_ticket = _make_product(
            db,
            popup,
            price=Decimal("3"),
            deleted_at=datetime.now(UTC),
        )
        _offer_sections(
            db,
            flow,
            [
                {
                    "key": "primary",
                    "label": "Primary",
                    "attendee_categories": [str(primary.id)],
                    "product_ids": [
                        str(primary_ticket.id),
                        str(free_ticket.id),
                        str(non_ticket.id),
                        str(inactive_ticket.id),
                        str(deleted_ticket.id),
                    ],
                },
                {
                    "key": "companion",
                    "label": "Companion",
                    "attendee_categories": [str(companion.id)],
                    "product_ids": [str(companion_ticket.id)],
                },
            ],
        )
        db.commit()

        response = client.get(
            "/api/v1/sales-flows/portal",
            params={"popup_id": str(popup.id)},
            headers={"Authorization": f"Bearer {_human_token(db, tenant_a)}"},
        )

        assert response.status_code == 200, response.text
        flow_result = next(
            item for item in response.json()["results"] if item["slug"] == flow.slug
        )
        assert flow_result["price_summary"] == {
            "amount": "50.00",
            "currency": "USD",
            "kind": "fixed",
        }

    def test_application_listing_uses_the_lowest_differing_paid_primary_ticket_price(
        self, client: TestClient, db: Session, tenant_a: Tenants
    ) -> None:
        popup = _make_popup(db, tenant_a)
        flow = _make_flow(db, popup, slug="primary-variable")
        primary = _add_primary_category(db, popup)
        companion = _add_category(db, popup)
        low_ticket = _make_product(db, popup, price=Decimal("40"))
        high_ticket = _make_product(db, popup, price=Decimal("90"))
        companion_ticket = _make_product(db, popup, price=Decimal("5"))
        _offer_sections(
            db,
            flow,
            [
                {
                    "key": "primary",
                    "label": "Primary",
                    "attendee_categories": [str(primary.id)],
                    "product_ids": [str(low_ticket.id), str(high_ticket.id)],
                },
                {
                    "key": "companion",
                    "label": "Companion",
                    "attendee_categories": [str(companion.id)],
                    "product_ids": [str(companion_ticket.id)],
                },
            ],
        )
        db.commit()

        response = client.get(
            "/api/v1/sales-flows/portal",
            params={"popup_id": str(popup.id)},
            headers={"Authorization": f"Bearer {_human_token(db, tenant_a)}"},
        )

        assert response.status_code == 200, response.text
        flow_result = next(
            item for item in response.json()["results"] if item["slug"] == flow.slug
        )
        assert flow_result["price_summary"] == {
            "amount": "40.00",
            "currency": "USD",
            "kind": "from",
        }

    def test_application_listing_returns_null_when_no_paid_primary_ticket_is_eligible(
        self, client: TestClient, db: Session, tenant_a: Tenants
    ) -> None:
        popup = _make_popup(db, tenant_a)
        flow = _make_flow(db, popup, slug="no-primary-ticket")
        primary = _add_primary_category(db, popup)
        companion = _add_category(db, popup)
        companion_ticket = _make_product(db, popup, price=Decimal("75"))
        disabled_ticket = _make_product(db, popup, price=Decimal("20"))
        unlisted_ticket = _make_product(db, popup, price=Decimal("30"))
        _offer_sections(
            db,
            flow,
            [
                {
                    "key": "companion",
                    "label": "Companion",
                    "attendee_categories": [str(companion.id)],
                    "product_ids": [str(companion_ticket.id)],
                },
                {"key": "malformed", "label": "Malformed", "product_ids": "invalid"},
            ],
        )
        _offer_sections(
            db,
            flow,
            [
                {
                    "key": "disabled",
                    "label": "Disabled",
                    "attendee_categories": [str(primary.id)],
                    "product_ids": [str(disabled_ticket.id)],
                }
            ],
            is_enabled=False,
        )
        _offer_sections(
            db,
            flow,
            [
                {
                    "key": "not-a-ticket-select",
                    "label": "Not a ticket select",
                    "attendee_categories": [str(primary.id)],
                    "product_ids": [str(unlisted_ticket.id)],
                }
            ],
            template="content",
        )
        db.commit()

        response = client.get(
            "/api/v1/sales-flows/portal",
            params={"popup_id": str(popup.id)},
            headers={"Authorization": f"Bearer {_human_token(db, tenant_a)}"},
        )

        assert response.status_code == 200, response.text
        flow_result = next(
            item for item in response.json()["results"] if item["slug"] == flow.slug
        )
        assert flow_result["price_summary"] is None

    def test_application_listing_returns_null_without_a_primary_category(
        self, client: TestClient, db: Session, tenant_a: Tenants
    ) -> None:
        popup = _make_popup(db, tenant_a)
        flow = _make_flow(db, popup, slug="no-primary-category")
        _offer_products(db, flow, [_make_product(db, popup, price=Decimal("50"))])
        db.commit()

        response = client.get(
            "/api/v1/sales-flows/portal",
            params={"popup_id": str(popup.id)},
            headers={"Authorization": f"Bearer {_human_token(db, tenant_a)}"},
        )

        assert response.status_code == 200, response.text
        flow_result = next(
            item for item in response.json()["results"] if item["slug"] == flow.slug
        )
        assert flow_result["price_summary"] is None

    def test_lists_portal_listed_application_flows_ordered(
        self, client: TestClient, db: Session, tenant_a: Tenants
    ) -> None:
        popup = _make_popup(db, tenant_a)
        _make_flow(db, popup, slug="second", order=2)
        _make_flow(db, popup, slug="first", order=1)
        db.commit()
        token = _human_token(db, tenant_a)

        response = client.get(
            "/api/v1/sales-flows/portal",
            params={"popup_id": str(popup.id)},
            headers={"Authorization": f"Bearer {token}"},
        )
        assert response.status_code == 200, response.text
        slugs = [f["slug"] for f in response.json()["results"]]
        # The default flow (order=0, provisioned by _make_popup) sorts first.
        assert slugs[-2:] == ["first", "second"]

    def test_direct_url_only_flow_excluded(
        self, client: TestClient, db: Session, tenant_a: Tenants
    ) -> None:
        """Threat matrix: direct_url_only never appears in the listing, but
        is still reachable by direct URL (see checkout runtime tests)."""
        popup = _make_popup(db, tenant_a)
        _make_flow(db, popup, slug="hidden", visibility="direct_url_only")
        db.commit()
        token = _human_token(db, tenant_a)

        response = client.get(
            "/api/v1/sales-flows/portal",
            params={"popup_id": str(popup.id)},
            headers={"Authorization": f"Bearer {token}"},
        )
        assert response.status_code == 200, response.text
        slugs = [f["slug"] for f in response.json()["results"]]
        assert "hidden" not in slugs

    def test_non_application_flow_excluded(
        self, client: TestClient, db: Session, tenant_a: Tenants
    ) -> None:
        popup = _make_popup(db, tenant_a)
        _make_flow(db, popup, slug="direct-flow", type="direct")
        db.commit()
        token = _human_token(db, tenant_a)

        response = client.get(
            "/api/v1/sales-flows/portal",
            params={"popup_id": str(popup.id)},
            headers={"Authorization": f"Bearer {token}"},
        )
        assert response.status_code == 200, response.text
        slugs = [f["slug"] for f in response.json()["results"]]
        assert "direct-flow" not in slugs

    def test_cross_tenant_popup_returns_empty(
        self, client: TestClient, db: Session, tenant_a: Tenants
    ) -> None:
        """Threat matrix: tenant isolation on the portal listing."""
        from app.api.tenant.models import Tenants as TenantsModel

        tenant_b = TenantsModel(
            name=f"Portal Listing Tenant B {uuid.uuid4().hex[:6]}",
            slug=f"portal-listing-b-{uuid.uuid4().hex[:6]}",
        )
        db.add(tenant_b)
        db.commit()
        popup_b = _make_popup(db, tenant_b)
        db.commit()
        token = _human_token(db, tenant_a)

        response = client.get(
            "/api/v1/sales-flows/portal",
            params={"popup_id": str(popup_b.id)},
            headers={"Authorization": f"Bearer {token}"},
        )
        assert response.status_code == 200, response.text
        assert response.json()["results"] == []


class TestPortalDirectFlowListing:
    def test_reports_from_and_unavailable_price_summaries(
        self, client: TestClient, db: Session, tenant_a: Tenants
    ) -> None:
        popup = _make_popup(db, tenant_a)
        variable_flow = _make_flow(db, popup, slug="variable", type="direct", order=1)
        unavailable_flow = _make_flow(
            db, popup, slug="unavailable", type="direct", order=2
        )
        _offer_products(
            db,
            variable_flow,
            [
                _make_product(db, popup, price=Decimal("40")),
                _make_product(db, popup, price=Decimal("90")),
            ],
        )
        db.commit()

        response = client.get(
            "/api/v1/sales-flows/portal/direct",
            params={"popup_id": str(popup.id)},
            headers={"Authorization": f"Bearer {_human_token(db, tenant_a)}"},
        )

        assert response.status_code == 200, response.text
        flows = {item["slug"]: item for item in response.json()["results"]}
        assert flows[variable_flow.slug]["price_summary"] == {
            "amount": "40.00",
            "currency": "USD",
            "kind": "from",
        }
        assert flows[unavailable_flow.slug]["price_summary"] is None

    def test_lists_only_open_portal_listed_direct_flows_ordered(
        self, client: TestClient, db: Session, tenant_a: Tenants
    ) -> None:
        popup = _make_popup(db, tenant_a)
        _make_flow(db, popup, slug="second", type="direct", order=2)
        _make_flow(db, popup, slug="first", type="direct", order=1)
        _make_flow(
            db,
            popup,
            slug="hidden",
            type="direct",
            visibility="direct_url_only",
        )
        _make_flow(db, popup, slug="application", type="application")
        _make_flow(db, popup, slug="upsale", type="upsale")
        _make_flow(db, popup, slug="closed", type="direct", status="closed")
        db.commit()
        token = _human_token(db, tenant_a)

        response = client.get(
            "/api/v1/sales-flows/portal/direct",
            params={"popup_id": str(popup.id)},
            headers={"Authorization": f"Bearer {token}"},
        )

        assert response.status_code == 200, response.text
        assert [flow["slug"] for flow in response.json()["results"]] == [
            "first",
            "second",
        ]

    def test_anonymous_caller_rejected(
        self, client: TestClient, db: Session, tenant_a: Tenants
    ) -> None:
        popup = _make_popup(db, tenant_a)
        db.commit()

        response = client.get(
            "/api/v1/sales-flows/portal/direct",
            params={"popup_id": str(popup.id)},
        )

        assert response.status_code in (401, 403), response.text

    def test_cross_tenant_popup_returns_empty(
        self, client: TestClient, db: Session, tenant_a: Tenants
    ) -> None:
        tenant_b = Tenants(
            name=f"Direct Listing Tenant B {uuid.uuid4().hex[:6]}",
            slug=f"direct-listing-b-{uuid.uuid4().hex[:6]}",
        )
        db.add(tenant_b)
        db.commit()
        popup_b = _make_popup(db, tenant_b)
        _make_flow(db, popup_b, slug="other-tenant", type="direct")
        db.commit()
        token = _human_token(db, tenant_a)

        response = client.get(
            "/api/v1/sales-flows/portal/direct",
            params={"popup_id": str(popup_b.id)},
            headers={"Authorization": f"Bearer {token}"},
        )

        assert response.status_code == 200, response.text
        assert response.json()["results"] == []
