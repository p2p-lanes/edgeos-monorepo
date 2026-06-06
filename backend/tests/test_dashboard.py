"""Smoke tests for the dashboard endpoints.

These exercise the full query path of the enriched dashboard (KPIs, trends,
revenue breakdown, distribution, attach rate, funnel) so a broken aggregation
query surfaces as a 500 instead of silently shipping.
"""

import uuid
from decimal import Decimal

from fastapi.testclient import TestClient
from sqlmodel import Session

from app.api.attendee.models import Attendees
from app.api.dashboard.router import _get_revenue_breakdown
from app.api.payment.models import PaymentProducts, Payments
from app.api.payment.schemas import PaymentStatus, PaymentType
from app.api.popup.models import Popups
from app.api.product.models import Products
from app.api.tenant.models import Tenants


class TestDashboardEnrichedSmoke:
    def test_enriched_executes_for_unknown_popup(
        self,
        client: TestClient,
        operator_token_tenant_a: str,
    ) -> None:
        # A random popup_id yields empty result sets but still runs every
        # aggregation query, validating the SQL compiles and executes.
        response = client.get(
            "/api/v1/dashboard/enriched?popup_id=" + str(uuid.uuid4()),
            headers={"Authorization": f"Bearer {operator_token_tenant_a}"},
        )
        assert response.status_code == 200, (
            f"GET /dashboard/enriched must execute, "
            f"got {response.status_code}: {response.text}"
        )


class TestRevenueBreakdownNetReconciliation:
    """Revenue by category must report net money collected, not gross list price.

    Regression guard: the breakdown used to sum product_price * quantity (the
    pre-discount catalog snapshot), so the category total dwarfed the Total
    Revenue KPI (sum of Payments.amount). It must now apply the payment discount
    to discountable lines, charge non-discountable lines in full, and read the
    patreon donation off effective_unit_price.
    """

    def test_breakdown_is_net_of_discounts(
        self, db: Session, tenant_a: Tenants
    ) -> None:
        popup = Popups(
            name="Revenue Breakdown Popup",
            slug="revenue-breakdown-net",
            tenant_id=tenant_a.id,
        )
        db.add(popup)
        db.flush()

        ticket = Products(
            tenant_id=tenant_a.id,
            popup_id=popup.id,
            name="Week Ticket",
            slug="rb-week-ticket",
            price=Decimal("100.00"),
            category="ticket",
            discountable=True,
        )
        merch = Products(
            tenant_id=tenant_a.id,
            popup_id=popup.id,
            name="T-Shirt",
            slug="rb-tshirt",
            price=Decimal("50.00"),
            category="merch",
            discountable=False,
        )
        patreon = Products(
            tenant_id=tenant_a.id,
            popup_id=popup.id,
            name="Donation",
            slug="rb-donation",
            price=Decimal("0.00"),
            category="patreon",
            discountable=False,
        )
        db.add_all([ticket, merch, patreon])
        db.flush()

        attendee = Attendees(
            tenant_id=tenant_a.id,
            popup_id=popup.id,
            name="Buyer One",
        )
        db.add(attendee)
        db.flush()

        # amount = net products (240) + insurance (10) + contribution (5).
        # Net products = 2*100*(1-0.20) + 1*50 + 30 = 160 + 50 + 30.
        payment = Payments(
            tenant_id=tenant_a.id,
            popup_id=popup.id,
            status=PaymentStatus.APPROVED.value,
            payment_type=PaymentType.PASS_PURCHASE.value,
            amount=Decimal("255.00"),
            insurance_amount=Decimal("10.00"),
            contribution_amount=Decimal("5.00"),
            discount_value=Decimal("20"),
        )
        db.add(payment)
        db.flush()

        db.add_all(
            [
                PaymentProducts(
                    tenant_id=tenant_a.id,
                    payment_id=payment.id,
                    product_id=ticket.id,
                    attendee_id=attendee.id,
                    quantity=2,
                    product_name=ticket.name,
                    product_price=Decimal("100.00"),
                    product_category="ticket",
                ),
                PaymentProducts(
                    tenant_id=tenant_a.id,
                    payment_id=payment.id,
                    product_id=merch.id,
                    attendee_id=attendee.id,
                    quantity=1,
                    product_name=merch.name,
                    product_price=Decimal("50.00"),
                    product_category="merch",
                ),
                PaymentProducts(
                    tenant_id=tenant_a.id,
                    payment_id=payment.id,
                    product_id=patreon.id,
                    attendee_id=attendee.id,
                    quantity=1,
                    product_name=patreon.name,
                    product_price=Decimal("0.00"),
                    effective_unit_price=Decimal("30.00"),
                    product_category="patreon",
                ),
            ]
        )
        db.commit()

        breakdown = _get_revenue_breakdown(db, popup.id)
        by_category = {c.category: c.revenue for c in breakdown.by_category}

        # Discountable ticket reduced by 20%, non-discountable merch full price,
        # patreon donation read off effective_unit_price.
        assert by_category["ticket"] == Decimal("160.00")
        assert by_category["merch"] == Decimal("50.00")
        assert by_category["patreon"] == Decimal("30.00")

        # The category total reconciles with the product portion of
        # Payments.amount (amount minus insurance and contribution fees).
        net_products = (
            payment.amount - payment.insurance_amount - payment.contribution_amount
        )
        assert sum(by_category.values()) == net_products

        # And it is no longer the inflated gross (2*100 + 50 + 0 = 250).
        assert sum(by_category.values()) != Decimal("250.00")
