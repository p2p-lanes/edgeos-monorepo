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

    Regression guard: the breakdown used to reconstruct per-line revenue from
    product_price and discount_value, so the category total dwarfed the Total
    Revenue KPI whenever a discount, comp or migrated-snapshot price was not
    captured in discount_value. It must now anchor on the settled payment total
    (COALESCE(amount_charged, amount) minus fees), keep non-discountable lines
    and patreon donations at full nominal value, and let discountable lines
    absorb whatever remains.
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

        # Non-discountable merch and the patreon donation stay at full nominal;
        # the discountable ticket absorbs the discount (remainder = 240 - 80).
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

    def test_breakdown_anchors_on_amount_not_discount_value(
        self, db: Session, tenant_a: Tenants
    ) -> None:
        # The real production bug: a discount that never reached discount_value
        # (an unrecorded coupon/group/scholarship, a migrated snapshot, or an
        # admin comp). The old reconstruction charged full list price; the new
        # logic must still reconcile with the amount actually collected.
        popup = Popups(
            name="Revenue Breakdown Amount Anchor",
            slug="revenue-breakdown-amount-anchor",
            tenant_id=tenant_a.id,
        )
        db.add(popup)
        db.flush()

        ticket = Products(
            tenant_id=tenant_a.id,
            popup_id=popup.id,
            name="Week Ticket",
            slug="rb-anchor-ticket",
            price=Decimal("100.00"),
            category="ticket",
            discountable=True,
        )
        meal = Products(
            tenant_id=tenant_a.id,
            popup_id=popup.id,
            name="Meal Plan",
            slug="rb-anchor-meal",
            price=Decimal("50.00"),
            category="meal_plan",
            discountable=False,
        )
        db.add_all([ticket, meal])
        db.flush()

        attendee = Attendees(
            tenant_id=tenant_a.id,
            popup_id=popup.id,
            name="Buyer Two",
        )
        db.add(attendee)
        db.flush()

        # Paid 130 on a 150 list (ticket 100 + meal 50) with NO discount_value:
        # the 20 reduction is invisible to the per-line snapshot.
        paid = Payments(
            tenant_id=tenant_a.id,
            popup_id=popup.id,
            status=PaymentStatus.APPROVED.value,
            payment_type=PaymentType.PASS_PURCHASE.value,
            amount=Decimal("130.00"),
            insurance_amount=Decimal("0.00"),
            contribution_amount=Decimal("0.00"),
            discount_value=None,
        )
        # A full admin comp: collected nothing, must contribute nothing.
        comp = Payments(
            tenant_id=tenant_a.id,
            popup_id=popup.id,
            status=PaymentStatus.APPROVED.value,
            payment_type=PaymentType.PASS_PURCHASE.value,
            amount=Decimal("0.00"),
            insurance_amount=Decimal("0.00"),
            contribution_amount=Decimal("0.00"),
            discount_value=None,
        )
        db.add_all([paid, comp])
        db.flush()

        db.add_all(
            [
                PaymentProducts(
                    tenant_id=tenant_a.id,
                    payment_id=paid.id,
                    product_id=ticket.id,
                    attendee_id=attendee.id,
                    quantity=1,
                    product_name=ticket.name,
                    product_price=Decimal("100.00"),
                    product_category="ticket",
                ),
                PaymentProducts(
                    tenant_id=tenant_a.id,
                    payment_id=paid.id,
                    product_id=meal.id,
                    attendee_id=attendee.id,
                    quantity=1,
                    product_name=meal.name,
                    product_price=Decimal("50.00"),
                    product_category="meal_plan",
                ),
                PaymentProducts(
                    tenant_id=tenant_a.id,
                    payment_id=comp.id,
                    product_id=ticket.id,
                    attendee_id=attendee.id,
                    quantity=1,
                    product_name=ticket.name,
                    product_price=Decimal("100.00"),
                    product_category="ticket",
                ),
            ]
        )
        db.commit()

        breakdown = _get_revenue_breakdown(db, popup.id)
        by_category = {c.category: c.revenue for c in breakdown.by_category}

        # Non-discountable meal plan stays whole; the discountable ticket eats
        # the 20 reduction. The comp contributes nothing.
        assert by_category["meal_plan"] == Decimal("50.00")
        assert by_category["ticket"] == Decimal("80.00")

        # Category total equals the money actually collected (130 + 0), not the
        # 250 list total the old reconstruction would have reported.
        assert sum(by_category.values()) == Decimal("130.00")

    def test_breakdown_groups_by_live_category_not_snapshot(
        self, db: Session, tenant_a: Tenants
    ) -> None:
        # A ticket re-categorised after sale: the live product is category
        # "ticket" but the purchase-time snapshot still says "month". The
        # breakdown must report it under the live "ticket" category so it agrees
        # with the ticket-type / product widgets, not a ghost "month" category.
        popup = Popups(
            name="Revenue Breakdown Live Category",
            slug="revenue-breakdown-live-category",
            tenant_id=tenant_a.id,
        )
        db.add(popup)
        db.flush()

        ticket = Products(
            tenant_id=tenant_a.id,
            popup_id=popup.id,
            name="Month Pass",
            slug="rb-live-month",
            price=Decimal("500.00"),
            category="ticket",
            discountable=True,
        )
        db.add(ticket)
        db.flush()

        attendee = Attendees(
            tenant_id=tenant_a.id,
            popup_id=popup.id,
            name="Buyer Three",
        )
        db.add(attendee)
        db.flush()

        payment = Payments(
            tenant_id=tenant_a.id,
            popup_id=popup.id,
            status=PaymentStatus.APPROVED.value,
            payment_type=PaymentType.PASS_PURCHASE.value,
            amount=Decimal("500.00"),
            insurance_amount=Decimal("0.00"),
            contribution_amount=Decimal("0.00"),
            discount_value=None,
        )
        db.add(payment)
        db.flush()

        db.add(
            PaymentProducts(
                tenant_id=tenant_a.id,
                payment_id=payment.id,
                product_id=ticket.id,
                attendee_id=attendee.id,
                quantity=1,
                product_name=ticket.name,
                product_price=Decimal("500.00"),
                product_category="month",  # stale snapshot category
            )
        )
        db.commit()

        breakdown = _get_revenue_breakdown(db, popup.id)
        by_category = {c.category: c.revenue for c in breakdown.by_category}

        # Reported under the live "ticket" category, not the stale "month".
        assert by_category == {"ticket": Decimal("500.00")}
        assert "month" not in by_category
