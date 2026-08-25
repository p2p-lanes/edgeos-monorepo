"""Flow-resolution contract (sdd/sales-flows design, slice 9, task 9.1).

Single module every consumer resolves a sales flow through. Wired today:
`resolve_flow` backs the checkout runtime (`checkout/crud.py::runtime_for_slug`)
and `coupon/crud.py::validate_public` (slice 11), and, via its internal
`get_default_flow` helper, `ticketing_step/router.py` and
`form_field/router.py`'s portal schema endpoints. `build_effective_config`
has two live consumers: `reminder_dispatch.py::_run_dispatch` (slice 10,
the 9 reminder cadence fields) and `coupon/crud.py`'s `validate_public` and
`validate_coupon` (slice 11, `allows_coupons`). `resolve_active_direct_flow`
is defined and unit-tested but still awaits its custom-domain-landing
consumer — keeping this in one place is what makes each cutover a pure
read-through change (design's "Fallback-authority rule").
"""

import uuid
from collections.abc import Iterable

from fastapi import HTTPException, status
from sqlmodel import Session, select

from app.api.popup.models import Popups
from app.api.popup.schemas import PopupStatus
from app.api.sales_flow.crud import sales_flows_crud
from app.api.sales_flow.models import SalesFlows
from app.api.sales_flow.schemas import (
    EFFECTIVE_CONFIG_FIELDS,
    EffectiveFlowConfig,
    SalesFlowType,
)
from app.api.shared.enums import SaleType


def resolve_flow(
    session: Session,
    popup: Popups | None,
    flow_slug: str | None = None,
    *,
    require_types: Iterable[SalesFlowType] | None = None,
) -> SalesFlows:
    """Resolve a sales flow for `popup` per the design's gate order.

    1. popup missing -> 404
    2. flow_slug is None -> the popup's primary flow; missing flow -> 404
    3. flow_slug unknown for this popup -> 404 (never a silent fallback —
       a typo must never resolve to the wrong flow)
    4. effective status (`flow.status ?? popup.status`) != active -> 403
    5. `require_types` given and `flow.type` not in it -> 403

    `visibility` is deliberately NOT checked here — it is listing-only
    (design Threat Matrix: "direct_url_only hides from listings but never
    grants access").
    """
    if popup is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Popup not found"
        )

    if flow_slug is None:
        flow = sales_flows_crud.get_default_flow(session, popup.id)
        if flow is None:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Sales flow not found",
            )
    else:
        flow = sales_flows_crud.get_by_slug(session, popup.id, flow_slug)
        if flow is None:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Sales flow not found",
            )

    # Which of the two is shut matters to whoever reads this. It could only
    # ever be the gathering while `flow.status` was always NULL; a flow can be
    # closed on its own now, and saying "Popup is not active" about an active
    # gathering sends somebody looking in the wrong place.
    if flow.status is not None:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="This way in is closed",
        )
    if popup.status != PopupStatus.active.value:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Popup is not active",
        )

    if require_types is not None:
        allowed = {SalesFlowType(t) for t in require_types}
        if SalesFlowType(flow.type) not in allowed:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="This endpoint is not available for this sales flow",
            )

    return flow


def get_default_flow(session: Session, popup_id: uuid.UUID) -> SalesFlows:
    """Return a popup's compatibility default, or raise 404 when absent.

    Distinct from `SalesFlowsCRUD.get_default_flow`, which stays Optional:
    callers that can operate without a legacy fallback legitimately treat a
    missing default as an empty result and degrade gracefully.
    """
    flow = sales_flows_crud.get_default_flow(session, popup_id)
    if flow is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Sales flow not found",
        )
    return flow


def resolve_active_direct_flow(
    session: Session, tenant_id: uuid.UUID
) -> tuple[str, str] | None:
    """Custom-domain landing default-flow resolution.

    Extends `checkout/crud.py::resolve_active_direct_popup_slug` with the
    same ordering (`start_date ASC NULLS LAST, id ASC`), then returns that
    popup's default flow slug alongside it. Returns None when no active
    direct-sale popup with a compatibility default exists for the tenant
    (Coming Soon path).
    """
    resolved = session.exec(
        select(Popups, SalesFlows)
        .join(SalesFlows, SalesFlows.popup_id == Popups.id)
        .where(
            Popups.tenant_id == tenant_id,
            Popups.status == PopupStatus.active,
            Popups.sale_type == SaleType.direct,
            SalesFlows.is_default == True,  # noqa: E712
        )
        .order_by(
            Popups.start_date.asc().nulls_last(),  # type: ignore[attr-defined]
            Popups.id.asc(),  # type: ignore[attr-defined]
        )
        .limit(1)
    ).first()

    if resolved is None:
        return None

    popup, flow = resolved
    return popup.slug, flow.slug


def build_effective_config(
    flow: SalesFlows,
    popup: Popups | None = None,  # noqa: ARG001 — kept so existing call sites still work
) -> EffectiveFlowConfig:
    """The flow's channel configuration.

    A flow owns these columns since sdd/sales-flows-rediseno slice 7: they
    are seeded from the popup when the flow is created and never read
    through to it afterwards, so editing one flow cannot change another.

    `popup` is accepted and ignored, so the call sites that still pass it
    keep working; it goes away with the popup columns themselves.

    Pure function — no I/O, no session. `flow` may be a transient
    (unpersisted) object, which is what keeps this table-driven unit
    testable without a database.
    """
    return EffectiveFlowConfig(
        **{name: getattr(flow, name) for name in EFFECTIVE_CONFIG_FIELDS}
    )


def config_for(
    session: Session,
    *,
    sales_flow_id: uuid.UUID | None,
    popup_id: uuid.UUID,
) -> EffectiveFlowConfig:
    """The channel configuration in force for a row that names a flow.

    The one place that turns "this application / section / field config
    belongs to flow X" into "here is what X decided". Call sites hold rows,
    not flows, and having each of them fetch and unwrap one is how a
    fallback rule drifts apart across a codebase.

    A row naming no flow predates the re-key. The popup's default flow
    answers for it — the flow it would have been created under — rather than
    the popup's own copies of these columns, which are on their way out and
    which nothing else reads anymore.

    A popup with no default flow returns an all-null config rather than
    raising, so a read never takes down a request.
    """
    flow = session.get(SalesFlows, sales_flow_id) if sales_flow_id is not None else None
    if flow is None:
        flow = sales_flows_crud.get_default_flow(session, popup_id)
    if flow is None:
        return EffectiveFlowConfig(**dict.fromkeys(EFFECTIVE_CONFIG_FIELDS))
    return build_effective_config(flow)
