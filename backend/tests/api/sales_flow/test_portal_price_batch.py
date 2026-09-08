"""Price-selection contracts and bounded SQL for Portal flow listings."""

import asyncio
import uuid
from datetime import UTC, datetime
from decimal import Decimal

import pytest
from sqlalchemy import event
from sqlmodel import Session

from app.api.human.schemas import HumanPublic
from app.api.sales_flow.crud import sales_flows_crud
from app.api.sales_flow.router import list_portal_sales_flows
from app.api.ticketing_step.models import TicketingSteps
from tests.api.sales_flow.test_portal_flow_listing import (
    _add_category,
    _add_primary_category,
    _human_token,
    _make_flow,
    _make_popup,
    _make_product,
    _offer_products,
)


@pytest.mark.parametrize("flow_type", ["application", "direct", "upsale"])
@pytest.mark.parametrize(
    "curation", [None, [], "malformed", [None, {"product_ids": ["invalid"]}]]
)
def test_empty_or_malformed_curation_retains_type_specific_fallback(
    db, tenant_a, flow_type, curation
):
    popup = _make_popup(db, tenant_a)
    _add_primary_category(db, popup)
    flow = _make_flow(db, popup, slug="curation", type=flow_type)
    _make_product(db, popup, price=Decimal("12.34"))
    db.add(
        TicketingSteps(
            tenant_id=popup.tenant_id,
            popup_id=popup.id,
            sales_flow_id=flow.id,
            step_type="tickets",
            title="Tickets",
            product_category="TICKET",
            template="ticket-select",
            template_config={"sections": curation},
            is_enabled=True,
        )
    )
    db.flush()
    summary = sales_flows_crud.resolve_portal_price_summaries(db, [flow])[flow.id]
    if flow_type == "application":
        assert summary is None
    else:
        assert summary is not None
        assert summary.amount == Decimal("12.34")
        assert summary.kind == "fixed"


@pytest.mark.parametrize("flow_type", ["application", "direct", "upsale"])
def test_batch_preserves_free_paid_deleted_disabled_and_patreon_rules(
    db, tenant_a, flow_type
):
    popup = _make_popup(db, tenant_a)
    _add_primary_category(db, popup)
    paid = _make_product(db, popup, price=Decimal("19.25"))
    equal = _make_product(db, popup, price=Decimal("19.25"))
    free = _make_product(db, popup, price=Decimal("0"))
    higher = _make_product(db, popup, price=Decimal("20.10"))
    inactive = _make_product(db, popup, price=Decimal("1"), is_active=False)
    deleted = _make_product(db, popup, price=Decimal("2"), deleted_at=datetime.now(UTC))
    patron = _make_product(db, popup, price=Decimal("3"), category="patreon")
    cases = [
        ([paid, equal, inactive, deleted], Decimal("19.25"), "fixed"),
        ([paid, higher], Decimal("19.25"), "from"),
        ([free], None if flow_type == "application" else Decimal("0"), "fixed"),
        (
            [paid, free],
            Decimal("19.25") if flow_type == "application" else Decimal("0"),
            "fixed" if flow_type == "application" else "from",
        ),
        (
            [paid, patron],
            Decimal("19.25") if flow_type == "application" else None,
            "fixed",
        ),
    ]
    flows = []
    for index, (products, _amount, _kind) in enumerate(cases):
        flow = _make_flow(db, popup, slug=f"case-{index}", type=flow_type)
        _offer_products(db, flow, products)
        # A disabled lower-priced step must never affect the result.
        db.add(
            TicketingSteps(
                tenant_id=popup.tenant_id,
                popup_id=popup.id,
                sales_flow_id=flow.id,
                step_type="disabled",
                title="Disabled",
                product_category="ticket",
                template="ticket-select",
                template_config={"sections": [{"product_ids": [str(free.id)]}]},
                is_enabled=False,
            )
        )
        flows.append(flow)
    db.flush()
    summaries = sales_flows_crud.resolve_portal_price_summaries(db, flows)
    for flow, (_products, amount, kind) in zip(flows, cases, strict=True):
        summary = summaries[flow.id]
        if amount is None:
            assert summary is None
        else:
            assert summary is not None
            assert (summary.amount, summary.kind, summary.currency) == (
                amount,
                kind,
                "USD",
            )
        assert sales_flows_crud.resolve_portal_price_summary(db, flow) == summary


def test_application_requires_primary_category_and_valid_primary_sections(db, tenant_a):
    popup = _make_popup(db, tenant_a)
    flow = _make_flow(db, popup, slug="primary")
    product = _make_product(db, popup, price=Decimal("40"))
    _offer_products(db, flow, [product])
    db.flush()
    assert sales_flows_crud.resolve_portal_price_summary(db, flow) is None
    _add_primary_category(db, popup)
    companion = _add_category(db, popup)
    restricted = _make_flow(db, popup, slug="companion-only")
    db.add(
        TicketingSteps(
            tenant_id=popup.tenant_id,
            popup_id=popup.id,
            sales_flow_id=restricted.id,
            step_type="tickets",
            title="Tickets",
            template="ticket-select",
            is_enabled=True,
            template_config={
                "sections": [
                    {
                        "attendee_categories": [str(companion.id)],
                        "product_ids": [str(product.id)],
                    },
                    {"attendee_categories": [], "product_ids": [str(product.id)]},
                    {
                        "attendee_categories": "invalid",
                        "product_ids": [str(product.id)],
                    },
                ]
            },
        )
    )
    db.flush()
    result = sales_flows_crud.resolve_portal_price_summaries(db, [flow, restricted])
    summary = result[flow.id]
    assert summary is not None
    assert summary.amount == Decimal("40")
    assert result[restricted.id] is None


def test_curated_ids_keep_existing_scope_while_currency_is_per_flow_popup(db, tenant_a):
    popup = _make_popup(db, tenant_a)
    other = _make_popup(db, tenant_a)
    other.currency = "EUR"
    _add_primary_category(db, popup)
    product = _make_product(db, other, price=Decimal("8.90"))
    flows = [
        _make_flow(db, popup, slug="application", type="application"),
        _make_flow(db, popup, slug="direct", type="direct"),
        _make_flow(db, other, slug="upsale", type="upsale"),
    ]
    for flow in flows:
        _offer_products(db, flow, [product])
    db.flush()
    summaries = sales_flows_crud.resolve_portal_price_summaries(db, flows)
    assert summaries[flows[0].id] is None
    direct_summary = summaries[flows[1].id]
    upsale_summary = summaries[flows[2].id]
    assert direct_summary is not None and upsale_summary is not None
    assert direct_summary.currency == "USD"
    assert upsale_summary.currency == "EUR"
    assert direct_summary.amount == upsale_summary.amount == Decimal("8.90")


def test_foreign_tenant_curated_products_do_not_leak_through_batch(
    client, db, tenant_a, tenant_b
):
    popup = _make_popup(db, tenant_a)
    foreign_popup = _make_popup(db, tenant_b)
    flow = _make_flow(db, popup, slug="direct", type="direct")
    own = _make_product(db, popup, price=Decimal("20"))
    foreign = _make_product(db, foreign_popup, price=Decimal("1"))
    _offer_products(db, flow, [own, foreign])
    db.commit()
    response = client.get(
        "/api/v1/sales-flows/portal/direct",
        params={"popup_id": str(popup.id)},
        headers={"Authorization": f"Bearer {_human_token(db, tenant_a)}"},
    )
    assert response.status_code == 200
    assert response.json()["results"][0]["price_summary"] == {
        "amount": "20.00",
        "currency": "USD",
        "kind": "fixed",
    }


def test_listing_select_count_is_constant_for_one_and_many_flows(db: Session, tenant_a):
    popup = _make_popup(db, tenant_a)
    popup_id = popup.id
    human = HumanPublic(
        id=uuid.uuid4(), tenant_id=tenant_a.id, email="reader@example.com"
    )
    _add_primary_category(db, popup)
    product = _make_product(db, popup, price=Decimal("10"))
    first = sales_flows_crud.get_default_flow(db, popup_id)
    assert first is not None
    _offer_products(db, first, [product])
    db.commit()

    def measured_listing():
        statements = []

        def before_execute(_conn, _cursor, statement, _params, _context, _many):
            if statement.lstrip().upper().startswith("SELECT"):
                statements.append(statement)

        event.listen(db.get_bind(), "before_cursor_execute", before_execute)
        try:
            result = asyncio.run(list_portal_sales_flows(db, human, popup_id))
            return result, len(statements)
        finally:
            event.remove(db.get_bind(), "before_cursor_execute", before_execute)

    single, single_count = measured_listing()
    assert len(single.results) == 1
    for index in range(12):
        flow = _make_flow(db, popup, slug=f"extra-{index}")
        _offer_products(db, flow, [product])
    db.commit()
    multiple, multiple_count = measured_listing()
    assert len(multiple.results) == 13
    assert all(
        flow.price_summary is not None and flow.price_summary.amount == Decimal("10")
        for flow in multiple.results
    )
    assert single_count == multiple_count == 5  # Listing + four batch reads.
