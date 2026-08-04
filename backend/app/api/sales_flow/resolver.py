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
    2. flow_slug is None -> the popup's default flow; missing default is a
       500-class invariant breach (guaranteed by task 5.0 provisioning for
       every popup created through the real API)
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
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail="Popup is missing its default sales flow",
            )
    else:
        flow = sales_flows_crud.get_by_slug(session, popup.id, flow_slug)
        if flow is None:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Sales flow not found",
            )

    effective_status = flow.status or popup.status
    if effective_status != PopupStatus.active.value:
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
    """Return a popup's default flow, or raise 500 — the resolver's own
    invariant (a missing default is a breach, not a legitimate outcome).

    Distinct from `SalesFlowsCRUD.get_default_flow`, which stays Optional:
    creation-time guards (application duplicate checks, custom-domain
    fallback resolution before this contract existed) legitimately treat a
    missing default as "this popup predates task 5.0 provisioning" and
    degrade gracefully instead of erroring.
    """
    flow = sales_flows_crud.get_default_flow(session, popup_id)
    if flow is None:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Popup is missing its default sales flow",
        )
    return flow


def resolve_active_direct_flow(
    session: Session, tenant_id: uuid.UUID
) -> tuple[str, str] | None:
    """Custom-domain landing default-flow resolution.

    Extends `checkout/crud.py::resolve_active_direct_popup_slug` with the
    same ordering (`start_date ASC NULLS LAST, id ASC`), then returns that
    popup's default flow slug alongside it. Returns None when no active
    direct-sale popup exists for the tenant (Coming Soon path) — never
    raises for that case. A missing default flow on an otherwise-matching
    popup IS an invariant breach (`get_default_flow` raises 500) — task 5.0
    guarantees every real popup has one.
    """
    popup = session.exec(
        select(Popups)
        .where(
            Popups.tenant_id == tenant_id,
            Popups.status == PopupStatus.active,
            Popups.sale_type == SaleType.direct,
        )
        .order_by(
            Popups.start_date.asc().nulls_last(),  # type: ignore[attr-defined]
            Popups.id.asc(),  # type: ignore[attr-defined]
        )
        .limit(1)
    ).first()

    if popup is None:
        return None

    flow = get_default_flow(session, popup.id)
    return popup.slug, flow.slug


def build_effective_config(flow: SalesFlows, popup: Popups) -> EffectiveFlowConfig:
    """Resolve every Class B (inheritable override) column: the flow's own
    value when not NULL, else the popup's (design D1/D2).

    Pure function — no I/O, no session. `flow`/`popup` may be transient
    (unpersisted) objects, which is what keeps this table-driven unit
    testable without a database.
    """
    resolved = {
        name: (
            flow_value
            if (flow_value := getattr(flow, name)) is not None
            else getattr(popup, name)
        )
        for name in EFFECTIVE_CONFIG_FIELDS
    }
    return EffectiveFlowConfig(**resolved)
