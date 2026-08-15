import uuid
from typing import NoReturn

from fastapi import APIRouter, HTTPException, status
from sqlalchemy.exc import IntegrityError
from sqlmodel import Session, select

from app.api.popup_reviewer.crud import popup_reviewers_crud
from app.api.sales_flow import crud
from app.api.sales_flow.crud import START_FRESH
from app.api.sales_flow.models import SalesFlows
from app.api.sales_flow.readiness import flow_readiness
from app.api.sales_flow.schemas import (
    EFFECTIVE_CONFIG_FIELDS,
    FlowSettingsByType,
    FlowStartPreview,
    SalesFlowCreate,
    SalesFlowPortalPublic,
    SalesFlowPublic,
    SalesFlowReadiness,
    SalesFlowReviewersMode,
    SalesFlowType,
    SalesFlowUpdate,
    fields_for,
)
from app.api.shared.response import ListModel, PaginationLimit, PaginationSkip, Paging
from app.api.ticketing_step.constants import seed_ticketing_steps_for_popup
from app.core.dependencies.users import (
    CurrentHuman,
    CurrentOperator,
    CurrentWriter,
    HumanTenantSession,
    TenantSession,
)
from app.services.restrictions.schemas import assert_restriction_rule_allowed_for_type

router = APIRouter(prefix="/sales-flows", tags=["sales-flows"])


@router.get("/portal", response_model=ListModel[SalesFlowPortalPublic])
async def list_portal_sales_flows(
    db: HumanTenantSession,
    _: CurrentHuman,
    popup_id: uuid.UUID,
) -> ListModel[SalesFlowPortalPublic]:
    """List a popup's portal-listed application flows (Portal).

    Backs the FlowPicker (sdd/sales-flows G0, task 9.4) — shown only when
    more than one flow is returned here. `direct_url_only` flows and
    non-application flows never appear, but remain reachable by direct URL
    (see the checkout runtime and `resolve_flow`).
    """
    flows = crud.sales_flows_crud.find_portal_listed(db, popup_id)
    return ListModel[SalesFlowPortalPublic](
        results=[SalesFlowPortalPublic.model_validate(f) for f in flows],
        paging=Paging(offset=0, limit=len(flows), total=len(flows)),
    )


@router.get("/portal/upsale", response_model=ListModel[SalesFlowPortalPublic])
async def list_portal_upsale_flows(
    db: HumanTenantSession,
    current_human: CurrentHuman,
    popup_id: uuid.UUID,
) -> ListModel[SalesFlowPortalPublic]:
    """List a popup's portal-listed upsale flows the current human is
    eligible for (Portal, sdd/sales-flows G0 #2/#3, D8, task 13.3).

    Deliberately a separate endpoint from `/portal` (which backs the
    application FlowPicker and assumes application-type flows only — mixing
    upsale flows into that response would break its single-flow
    auto-select semantics). Eligibility is "any APPROVED payment anywhere
    in the popup", evaluated live; an ineligible human sees an empty
    catalog here rather than an error, matching every other portal listing.
    """
    from app.api.application.crud import applications_crud  # noqa: PLC0415

    flows = applications_crud.resolve_upsale_catalog(db, current_human.id, popup_id)
    return ListModel[SalesFlowPortalPublic](
        results=[SalesFlowPortalPublic.model_validate(f) for f in flows],
        paging=Paging(offset=0, limit=len(flows), total=len(flows)),
    )


def _raise_on_default_conflict(exc: IntegrityError) -> NoReturn:
    if "uq_sales_flows_default_per_popup" in str(getattr(exc, "orig", exc)):
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="This popup already has a default sales flow",
        ) from exc
    raise exc


@router.get("", response_model=ListModel[SalesFlowPublic])
async def list_sales_flows(
    db: TenantSession,
    _: CurrentOperator,
    popup_id: uuid.UUID,
    skip: PaginationSkip = 0,
    limit: PaginationLimit = 100,
) -> ListModel[SalesFlowPublic]:
    """List sales flows for a popup (BO only)."""
    flows, total = crud.sales_flows_crud.find_by_popup(
        db, popup_id=popup_id, skip=skip, limit=limit
    )
    return ListModel[SalesFlowPublic](
        results=[SalesFlowPublic.model_validate(f) for f in flows],
        paging=Paging(offset=skip, limit=limit, total=total),
    )


@router.get("/readiness", response_model=list[SalesFlowReadiness])
async def list_sales_flow_readiness(
    db: TenantSession,
    _: CurrentOperator,
    popup_id: uuid.UUID,
) -> list[SalesFlowReadiness]:
    """What each flow of a popup is missing before it can sell (BO only).

    Declared before `/{flow_id}`: FastAPI matches routes in declaration
    order, so a literal path that a UUID converter would also accept has to
    come first.
    """
    flows, _total = crud.sales_flows_crud.find_by_popup(
        db, popup_id=popup_id, limit=100
    )
    return [flow_readiness(db, flow) for flow in flows]


@router.get("/settings-by-type", response_model=FlowSettingsByType)
async def list_settings_by_type(
    _db: TenantSession,
    _: CurrentOperator,
) -> FlowSettingsByType:
    """Which settings each kind of flow can use (BO only).

    Static, and deliberately not a constant in the backoffice: the same
    knowledge decides what a new flow is seeded with and what a copy carries
    across, so the screen that renders the fields reads it from the one place
    that already owns it.

    Declared before `/{flow_id}`, like every other literal path here.
    """
    return FlowSettingsByType(
        settings={
            flow_type.value: list(fields_for(flow_type.value))
            for flow_type in SalesFlowType
        }
    )


@router.get("/preview", response_model=FlowStartPreview)
async def preview_sales_flow_start(
    db: TenantSession,
    _: CurrentOperator,
    popup_id: uuid.UUID,
    type: SalesFlowType = SalesFlowType.application,  # noqa: A002
    start_from: str | None = None,
) -> FlowStartPreview:
    """What a way in would begin with, before anyone opens it (BO only).

    The creation screen asks somebody to choose a starting point, and the only
    way to choose well is to see what each one brings. This answers that with
    the same code that will do the seeding, so the screen cannot promise
    something creation will not deliver.

    Declared before `/{flow_id}`: FastAPI matches in declaration order, so a
    literal path a UUID converter would also accept has to come first.
    """
    from app.api.popup.crud import popups_crud  # noqa: PLC0415

    if popups_crud.get(db, popup_id) is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Popup not found",
        )

    try:
        start = crud.sales_flows_crud.resolve_start(
            db, popup_id, type.value, start_from
        )
    except ValueError as exc:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=str(exc),
        ) from exc

    usable = fields_for(type.value)
    starts_with = {
        name: start.values.get(name)
        for name in usable
        if start.values.get(name) is not None
    }
    left_empty = [name for name in usable if name not in starts_with]

    # Only what the source actually holds, so the screen says "the signing
    # secret will not come across" rather than listing settings the source
    # never had either.
    not_carried_over = [
        name
        for name in EFFECTIVE_CONFIG_FIELDS
        if name not in usable and start.values.get(name) is not None
    ]

    return FlowStartPreview(
        flow_type=type,
        source_kind=start.kind,
        source_name=start.name,
        starts_with=starts_with,
        left_empty=left_empty,
        not_carried_over=not_carried_over,
    )


@router.get("/{flow_id}", response_model=SalesFlowPublic)
async def get_sales_flow(
    flow_id: uuid.UUID,
    db: TenantSession,
    _: CurrentOperator,
) -> SalesFlowPublic:
    """Get a single sales flow (BO only)."""
    flow = crud.sales_flows_crud.get(db, flow_id)
    if not flow:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Sales flow not found",
        )
    return SalesFlowPublic.model_validate(flow)


@router.post("", response_model=SalesFlowPublic, status_code=status.HTTP_201_CREATED)
async def create_sales_flow(
    flow_in: SalesFlowCreate,
    db: TenantSession,
    _current_user: CurrentWriter,
) -> SalesFlowPublic:
    """Create a sales flow (BO only). tenant_id is derived from the popup."""
    from app.api.popup.crud import popups_crud

    popup = popups_crud.get(db, flow_in.popup_id)
    if not popup:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Popup not found",
        )

    existing = crud.sales_flows_crud.get_by_slug(db, flow_in.popup_id, flow_in.slug)
    if existing:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="A sales flow with this slug already exists for this popup",
        )

    try:
        # `create` copies the popup's channel configuration into anything
        # the caller left unset (sdd/sales-flows-rediseno slice 7).
        flow = crud.sales_flows_crud.create(db, flow_in, tenant_id=popup.tenant_id)
    except IntegrityError as exc:
        db.rollback()
        _raise_on_default_conflict(exc)

    # A door with no steps has no checkout: it renders nothing and sells
    # nothing. Somebody who asked to start fresh or start empty is asking
    # about SETTINGS, and would not expect the answer to be a way in that
    # cannot open.
    #
    # Only for that value, which is new. A caller that omits `start_from` is
    # on the historical path, where the client copies steps from a source flow
    # itself — seeding here as well would give it two of everything.
    if flow_in.start_from == START_FRESH:
        seed_ticketing_steps_for_popup(
            db,
            popup_id=flow.popup_id,
            tenant_id=flow.tenant_id,
            sales_flow_id=flow.id,
            flow_type=flow.type,
        )
        db.commit()
        db.refresh(flow)

    return SalesFlowPublic.model_validate(flow)


@router.patch("/{flow_id}", response_model=SalesFlowPublic)
async def update_sales_flow(
    flow_id: uuid.UUID,
    flow_in: SalesFlowUpdate,
    db: TenantSession,
    _current_user: CurrentWriter,
) -> SalesFlowPublic:
    """Update a sales flow (BO only)."""
    flow = crud.sales_flows_crud.get(db, flow_id)
    if not flow:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Sales flow not found",
        )

    if flow_in.slug and flow_in.slug != flow.slug:
        existing = crud.sales_flows_crud.get_by_slug(db, flow.popup_id, flow_in.slug)
        if existing:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="A sales flow with this slug already exists for this popup",
            )

    # sdd/sales-flows G3 checkpoint 12.8 (CONFIRMED 2026-08-04): a
    # type=direct flow can never resolve human_profile_field (no Humans row
    # for an anonymous buyer), so re-validate whenever EITHER the type or
    # the rule itself changes — a type flip alone can invalidate a
    # previously-valid rule left untouched by this request.
    if flow_in.type is not None or "restriction_rule" in flow_in.model_fields_set:
        effective_type = flow_in.type.value if flow_in.type is not None else flow.type
        effective_rule = (
            flow_in.restriction_rule
            if "restriction_rule" in flow_in.model_fields_set
            else flow.restriction_rule
        )
        try:
            assert_restriction_rule_allowed_for_type(
                effective_rule, flow_type=effective_type
            )
        except ValueError as exc:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=str(exc)
            ) from exc

    if flow_in.reviewers_mode is not None:
        has_flow_reviewers = popup_reviewers_crud.has_flow_reviewers(db, flow_id)
        if (
            flow_in.reviewers_mode == SalesFlowReviewersMode.override
            and not has_flow_reviewers
        ):
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=(
                    "This sales flow has no reviewers of its own. "
                    "Add a reviewer for this flow before enabling override mode."
                ),
            )
        if (
            flow_in.reviewers_mode == SalesFlowReviewersMode.inherit
            and has_flow_reviewers
        ):
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=(
                    "This sales flow still has reviewers of its own. "
                    "Remove them before switching back to the popup's shared reviewers."
                ),
            )

    # Installment terms are validated on the RESULT of the patch, not on the
    # payload: a request that only flips `installments_enabled` would otherwise
    # look valid on its own while leaving the flow promising a plan it has no
    # ceiling or deadline for — which SimpleFi rejects at the checkout, in
    # front of the buyer.
    _assert_installments_valid(flow, flow_in)

    scholarship_enabling = (
        flow_in.allows_scholarship is True and not flow.allows_scholarship
    )

    try:
        updated = crud.sales_flows_crud.update(db, flow, flow_in)
    except IntegrityError as exc:
        db.rollback()
        _raise_on_default_conflict(exc)

    # Turning scholarships on has to produce the questions that ask for one.
    # The popup's PATCH used to do this, back when the flag was the event's;
    # now the flag belongs to the flow, and so does the section it creates.
    # Idempotent: re-enabling reuses the row left by a previous cycle.
    if scholarship_enabling:
        _ensure_scholarship_section(db, updated)

    return SalesFlowPublic.model_validate(updated)


def _assert_installments_valid(flow: SalesFlows, flow_in: SalesFlowUpdate) -> None:
    """Validate the installment terms a flow will hold once this patch lands."""
    from app.api.popup.schemas import validate_popup_installments_config

    def merged(name: str):
        return (
            getattr(flow_in, name)
            if name in flow_in.model_fields_set
            else getattr(flow, name)
        )

    if not merged("installments_enabled"):
        return
    try:
        validate_popup_installments_config(
            enabled=True,
            max_installments=merged("installments_max"),
            deadline=merged("installments_deadline"),
            interval_count=merged("installments_interval_count") or 1,
        )
    except ValueError as exc:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=str(exc)
        ) from exc


def _ensure_scholarship_section(db: Session, flow: SalesFlows) -> None:
    """Give a flow the scholarship section its form needs, once."""
    from app.api.form_section.models import FormSections
    from app.api.popup.constants import DEFAULT_SECTIONS

    section_def = DEFAULT_SECTIONS["scholarship"]
    existing = db.exec(
        select(FormSections).where(
            FormSections.sales_flow_id == flow.id,
            FormSections.kind == section_def["kind"],
        )
    ).first()
    if existing is not None:
        return
    db.add(
        FormSections(
            tenant_id=flow.tenant_id,
            popup_id=flow.popup_id,
            sales_flow_id=flow.id,
            label=section_def["label"],
            order=section_def["order"],
            protected=True,
            kind=section_def["kind"],
        )
    )
    db.commit()


@router.delete("/{flow_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_sales_flow(
    flow_id: uuid.UUID,
    db: TenantSession,
    _current_user: CurrentWriter,
) -> None:
    """Delete a sales flow (BO only). The default flow of a popup cannot be deleted."""
    flow = crud.sales_flows_crud.get(db, flow_id)
    if not flow:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Sales flow not found",
        )
    if flow.is_default:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Cannot delete a popup's default sales flow",
        )

    # Deleting used to fail on anything at all that pointed at the flow, which
    # in practice meant the checkout steps the product had seeded into it
    # seconds earlier — so a flow nobody had ever sold through could not be
    # removed, and the reason given was "configuration attached", which named
    # our own doing as the obstacle.
    #
    # What must stop a delete is a record of something somebody did. Those are
    # counted and named, because "cannot be deleted" tells an operator nothing
    # about what to do next.
    blocking = crud.history_blocking_delete(db, flow.id)
    if blocking:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=(
                "This sales flow cannot be deleted because people have used it: "
                + ", ".join(
                    f"{count} {noun}{'' if count == 1 else 's'}"
                    for noun, count in blocking
                )
                + "."
            ),
        )

    try:
        crud.delete_flow_and_its_configuration(db, flow)
    except IntegrityError as exc:
        db.rollback()
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="This sales flow is still in use and cannot be deleted",
        ) from exc
