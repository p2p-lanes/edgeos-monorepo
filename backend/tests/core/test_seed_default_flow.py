"""Every popup produced by `init_db`'s dev-seed must end up with exactly
one default sales_flow — the seed builds Popups directly (not through
`PopupsCRUD.create`), so it has to provision the flow itself in the same
transaction. A missing default flow is a 500-class invariant breach for
`resolve_flow`/`get_default_flow` (see app/api/sales_flow/resolver.py).
"""

from fastapi import HTTPException
from sqlmodel import Session, select

from app.api.popup.models import Popups
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

        # The checkout runtime's resolver must never 500 for a seeded popup
        # (a missing default flow is the only thing that raises 500 here —
        # "not active" is a legitimate 403 for draft popups).
        try:
            resolve_flow(db, popup)
        except HTTPException as exc:
            assert exc.status_code != 500, (
                f"resolve_flow 500'd for seeded popup {popup.slug!r}: {exc.detail}"
            )
