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


def seed_default_steps(db, popup, sale_type: str | None = None):
    """Seed a popup's default ticketing steps into its default flow.

    Uses the same function `POST /popups` uses, so fixtures that build a
    `Popups` row directly end up with the steps a real popup has. Since
    sdd/sales-flows-rediseno slice 4 the steps decide what the flow can
    sell, so a popup with no steps sells nothing — correct, but rarely what
    a test about products means.
    """
    from app.api.ticketing_step.constants import seed_ticketing_steps_for_popup
    from app.api.ticketing_step.models import TicketingSteps

    if sale_type is None:
        sale_type = getattr(popup.sale_type, "value", popup.sale_type)
    flow = provision_default_flow(db, popup, sale_type=sale_type)

    from sqlmodel import select

    already = db.exec(
        select(TicketingSteps).where(TicketingSteps.sales_flow_id == flow.id)
    ).first()
    if already is not None:
        return flow

    seed_ticketing_steps_for_popup(
        db,
        popup_id=popup.id,
        tenant_id=popup.tenant_id,
        sales_flow_id=flow.id,
        flow_type=flow.type,
    )
    db.commit()
    return flow


def offer_category(db, popup, category: str):
    """Give the popup's default flow a step offering `category`.

    Since slice 4 a flow sells what its steps offer, so a test about a
    category the default step set does not cover (meal_plan, for instance)
    has to say so — the same thing an organizer would do in the builder.
    """
    from app.api.ticketing_step.models import TicketingSteps

    flow = provision_default_flow(db, popup)
    step = TicketingSteps(
        tenant_id=popup.tenant_id,
        popup_id=popup.id,
        sales_flow_id=flow.id,
        step_type=category,
        product_category=category,
        title=category,
    )
    db.add(step)
    db.commit()
    return step


def application_flow_id(db, popup_id: uuid.UUID) -> uuid.UUID:
    """The flow an application belongs to when the test does not care which.

    `applications.sales_flow_id` is NOT NULL since
    sdd/sales-flows-rediseno F4, so a fixture that builds an `Applications`
    row directly has to name a flow. Unlike `default_flow_id` this builds
    the default flow when it is missing, because plenty of these fixtures
    build their popup with `Popups(...)` and never went through the creation
    path that would have given them one.

    The flow is seeded with the same steps a real popup gets at creation.
    Since slice 4 a flow sells what its steps offer, and a bare flow sells
    nothing — which would fail every purchase in a test that is not about
    restrictions at all.
    """
    from app.api.popup.crud import popups_crud
    from app.api.sales_flow.crud import sales_flows_crud

    flow = sales_flows_crud.get_default_flow(db, popup_id)
    if flow is not None:
        return flow.id

    popup = popups_crud.get(db, popup_id)
    if popup is None:
        raise AssertionError(f"popup {popup_id} does not exist")
    return seed_default_steps(db, popup, sale_type="application").id


def invite_flow_id(db, popup_id: uuid.UUID) -> uuid.UUID:
    """The flow an invite lands its recipient in.

    `invites.sales_flow_id` is NOT NULL since sdd/sales-flows-rediseno, so a
    fixture that builds an `Invites` row directly has to name one. Mirrors
    `application_flow_id`: it provisions the default flow when the fixture
    built its popup with `Popups(...)` and never went through creation.
    """
    return application_flow_id(db, popup_id)


def group_flow_id(db, popup_id: uuid.UUID) -> uuid.UUID:
    """The flow a group's members apply through.

    `groups.sales_flow_id` is NOT NULL since sdd/sales-flows-rediseno, so a
    fixture that builds a `Groups` row directly has to name one.
    """
    return application_flow_id(db, popup_id)
