"""Test helpers for flow-owned configuration.

Since sdd/sales-flows-rediseno slices 2 and 3, ticketing steps and form
definitions belong to exactly one sales flow — there is no popup-shared
tier to leave them in. A test that builds one of those rows directly has to
say which flow owns it, and unless the test is specifically about a second
flow, that flow is the popup's default one.
"""

import uuid

from sqlmodel import Session


def default_flow_id(db: Session, popup_id: uuid.UUID) -> uuid.UUID:
    """The id of `popup_id`'s default sales flow.

    Raises rather than returning None: every popup has one (provisioned at
    creation, backfilled by `4a983282b8aa`), so its absence means the
    fixture built an impossible popup and the test would otherwise fail far
    from the cause.
    """
    from app.api.sales_flow.crud import sales_flows_crud

    flow = sales_flows_crud.get_default_flow(db, popup_id)
    if flow is None:
        raise AssertionError(
            f"popup {popup_id} has no default sales flow — build it through "
            "a fixture that provisions one"
        )
    return flow.id


def provision_default_flow(db, popup, sale_type: str = "application"):
    """Give a directly-built test popup the default flow a real one gets at
    creation. Idempotent."""
    from app.api.sales_flow.crud import sales_flows_crud

    existing = sales_flows_crud.get_default_flow(db, popup.id)
    if existing is not None:
        return existing
    flow = sales_flows_crud.provision_default_flow(
        db,
        popup_id=popup.id,
        tenant_id=popup.tenant_id,
        sale_type=sale_type,
    )
    db.commit()
    return flow
