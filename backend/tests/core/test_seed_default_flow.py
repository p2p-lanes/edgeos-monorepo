"""Every popup produced by `init_db`'s dev-seed must end up with exactly
one default sales_flow — the seed builds Popups directly (not through
`PopupsCRUD.create`), so it has to provision the flow itself in the same
transaction. Provisioning remains the creation behavior even though a popup
may later have no compatibility default.
"""

from fastapi import HTTPException
from sqlmodel import Session, func, select

from app.api.application.models import Applications
from app.api.attendee.models import AttendeeProducts
from app.api.payment.models import PaymentProducts, Payments
from app.api.popup.models import Popups
from app.api.product.models import Products
from app.api.sales_flow.crud import sales_flows_crud
from app.api.sales_flow.resolver import resolve_flow
from app.api.tenant.models import Tenants
from app.core.db import init_db


def test_seeded_popups_each_get_exactly_one_default_flow(db: Session) -> None:
    init_db(db)

    tenant = db.exec(select(Tenants).where(Tenants.slug == "demo")).first()
    assert tenant is not None

    popups = db.exec(select(Popups).where(Popups.tenant_id == tenant.id)).all()
    assert len(popups) > 0, "seed_data.json should define at least one popup"

    for popup in popups:
        default_flow = sales_flows_crud.get_default_flow(db, popup.id)

        assert default_flow is not None, (
            f"popup {popup.slug!r} has no default sales_flow"
        )
        assert default_flow.is_default is True
        # `Popups.sale_type` round-trips as a plain str once reloaded from
        # the DB (its column is a raw String, not a native Postgres enum).
        assert default_flow.type == str(popup.sale_type)

        # The checkout runtime can reject a draft popup with 403, but a seeded
        # popup still has a compatibility entry point to resolve.
        try:
            resolve_flow(db, popup)
        except HTTPException as exc:
            assert exc.status_code != 500, (
                f"resolve_flow 500'd for seeded popup {popup.slug!r}: {exc.detail}"
            )

    products = db.exec(select(Products).where(Products.tenant_id == tenant.id)).all()
    snapshots = db.exec(
        select(PaymentProducts).where(PaymentProducts.tenant_id == tenant.id)
    ).all()
    holdings = db.exec(
        select(AttendeeProducts).where(AttendeeProducts.tenant_id == tenant.id)
    ).all()
    payments = db.exec(select(Payments).where(Payments.tenant_id == tenant.id)).all()
    applications = {
        application.id: application
        for application in db.exec(
            select(Applications).where(Applications.tenant_id == tenant.id)
        ).all()
    }

    assert products and snapshots and holdings and payments
    assert all(snapshot.product_category for snapshot in snapshots)
    assert {holding.product_category_snapshot for holding in holdings} == {
        "housing",
        "ticket",
    }
    assert all(
        payment.application_id is not None
        and payment.buyer_human_id == applications[payment.application_id].human_id
        for payment in payments
    )

    classified_counts = tuple(
        db.exec(select(func.count()).select_from(model)).one()
        for model in (Products, PaymentProducts, AttendeeProducts, Payments)
    )
    init_db(db)
    assert classified_counts == tuple(
        db.exec(select(func.count()).select_from(model)).one()
        for model in (Products, PaymentProducts, AttendeeProducts, Payments)
    )
