"""Router for the backoffice scan-history endpoint.

Provides GET /check-ins with optional filtering by attendee_product_id,
popup_id, free-text search and the shared ``filters`` JSON group. One row
per scan event with full history.
"""

import uuid
from datetime import datetime

from fastapi import APIRouter, HTTPException, status
from sqlalchemy import and_, not_, or_
from sqlalchemy.orm import selectinload
from sqlmodel import Session, col, func, select
from sqlmodel import select as sa_select

from app.api.application.models import Applications
from app.api.attendee.crud import unit_authority_predicate
from app.api.attendee.models import AttendeeProducts, Attendees
from app.api.check_in.crud import record_check_in
from app.api.check_in.models import CheckIn
from app.api.check_in.schemas import (
    CHECK_IN_PRODUCT_CATEGORIES,
    CheckInFilterCondition,
    CheckInListItem,
    CheckInPayload,
    SelfCheckInOptions,
    SelfCheckInPopup,
    SelfCheckInRequest,
    SelfCheckInResult,
    SelfCheckInTicket,
    parse_check_in_filters,
)
from app.api.human.models import Humans
from app.api.payment.models import PaymentProducts, Payments
from app.api.popup.models import Popups
from app.api.product.models import Products
from app.api.sales_flow.models import SalesFlows
from app.api.shared.response import ListModel, PaginationLimit, PaginationSkip, Paging
from app.api.user.models import Users
from app.core.db import engine
from app.core.dependencies.users import (
    CurrentCheckInOperator,
    CurrentHuman,
    HumanTenantSession,
    TenantSession,
)
from app.core.filters import (
    VALUELESS_OPS,
    build_filter_expression,
    escape_like,
    text_condition_expression,
    uuid_condition_expression,
)

router = APIRouter(prefix="/check-ins", tags=["check_in"])


def _get_self_check_in_popup(
    db: Session, popup_slug: str, tenant_id: uuid.UUID
) -> Popups:
    popup = db.exec(
        select(Popups).where(Popups.slug == popup_slug, Popups.tenant_id == tenant_id)
    ).first()
    if popup is None or not popup.self_check_in_enabled:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Popup not found",
        )
    return popup


def _scannable_unit_filter():
    return Products.requires_check_in.is_(True)


def _first_check_ins_by_ticket(
    db: Session,
    ticket_ids: list[uuid.UUID],
) -> dict[uuid.UUID, datetime]:
    if not ticket_ids:
        return {}
    rows = db.exec(
        select(
            CheckIn.attendee_product_id,
            func.min(CheckIn.occurred_at).label("first_check_in_at"),
        )
        .where(CheckIn.attendee_product_id.in_(ticket_ids))  # type: ignore[union-attr]
        .group_by(CheckIn.attendee_product_id)
    ).all()
    return {row.attendee_product_id: row.first_check_in_at for row in rows}


def _build_self_check_in_ticket(
    ticket: AttendeeProducts,
    first_check_in_at: datetime | None,
) -> SelfCheckInTicket:
    attendee = ticket.attendee
    product = ticket.product
    return SelfCheckInTicket(
        attendee_product_id=ticket.id,
        attendee_name=attendee.name if attendee else None,
        attendee_category=attendee.category if attendee else None,
        product_name=product.name,
        product_category=product.category,
        duration_type=product.duration_type,
        checked_in=first_check_in_at is not None,
        first_check_in_at=first_check_in_at,
    )


@router.get("/my/{popup_slug}/options", response_model=SelfCheckInOptions)
async def get_my_check_in_options(
    popup_slug: str,
    db: HumanTenantSession,
    current_human: CurrentHuman,
) -> SelfCheckInOptions:
    popup = _get_self_check_in_popup(db, popup_slug, current_human.tenant_id)
    statement = (
        select(AttendeeProducts)
        .outerjoin(Attendees, AttendeeProducts.attendee_id == Attendees.id)  # type: ignore[arg-type]
        .join(Products, AttendeeProducts.product_id == Products.id)  # type: ignore[arg-type]
        .outerjoin(Applications, Attendees.application_id == Applications.id)  # type: ignore[arg-type]
        .outerjoin(
            PaymentProducts,
            AttendeeProducts.payment_product_id == PaymentProducts.id,  # type: ignore[arg-type]
        )
        .outerjoin(Payments, PaymentProducts.payment_id == Payments.id)  # type: ignore[arg-type]
        .where(
            AttendeeProducts.tenant_id == current_human.tenant_id,
            Products.popup_id == popup.id,
            AttendeeProducts.revoked_at.is_(None),
            _scannable_unit_filter(),
            unit_authority_predicate(current_human.id, popup.id),
        )
        .options(
            selectinload(AttendeeProducts.attendee),  # type: ignore[arg-type]
            selectinload(AttendeeProducts.product),  # type: ignore[arg-type]
        )
    )
    tickets = list(db.exec(statement).all())
    first_check_ins = _first_check_ins_by_ticket(db, [ticket.id for ticket in tickets])
    return SelfCheckInOptions(
        popup=SelfCheckInPopup(id=popup.id, name=popup.name, slug=popup.slug),
        tickets=[
            _build_self_check_in_ticket(ticket, first_check_ins.get(ticket.id))
            for ticket in tickets
        ],
    )


@router.post("/my/{popup_slug}", response_model=SelfCheckInResult)
async def confirm_my_check_in(
    popup_slug: str,
    request: SelfCheckInRequest,
    db: HumanTenantSession,
    current_human: CurrentHuman,
) -> SelfCheckInResult:
    popup = _get_self_check_in_popup(db, popup_slug, current_human.tenant_id)
    # Lock ownership-matching ticket in a single FOR UPDATE statement so we
    # never lock rows the human doesn't own and avoid a TOCTOU between the
    # lock and the ownership check.
    ticket = db.exec(
        select(AttendeeProducts)
        .outerjoin(Attendees, AttendeeProducts.attendee_id == Attendees.id)  # type: ignore[arg-type]
        .join(Products, AttendeeProducts.product_id == Products.id)  # type: ignore[arg-type]
        .outerjoin(Applications, Attendees.application_id == Applications.id)  # type: ignore[arg-type]
        .outerjoin(
            PaymentProducts,
            AttendeeProducts.payment_product_id == PaymentProducts.id,  # type: ignore[arg-type]
        )
        .outerjoin(Payments, PaymentProducts.payment_id == Payments.id)  # type: ignore[arg-type]
        .where(
            AttendeeProducts.id == request.attendee_product_id,
            AttendeeProducts.tenant_id == current_human.tenant_id,
            Products.popup_id == popup.id,
            AttendeeProducts.revoked_at.is_(None),
            unit_authority_predicate(current_human.id, popup.id),
        )
        .with_for_update(of=AttendeeProducts)
        .options(
            selectinload(AttendeeProducts.attendee),  # type: ignore[arg-type]
            selectinload(AttendeeProducts.product),  # type: ignore[arg-type]
        )
    ).first()
    if ticket is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Ticket not found"
        )

    attendee = ticket.attendee
    product = ticket.product

    if not product.requires_check_in:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Product does not require check-in",
        )

    event = record_check_in(
        db,
        attendee_product_id=ticket.id,
        popup_id=popup.id,
        payload=CheckInPayload(source="self_service", human_id=current_human.id),
        actor_user_id=None,
    )

    return SelfCheckInResult(
        attendee_product_id=ticket.id,
        attendee_name=attendee.name if attendee else None,
        attendee_category=attendee.category if attendee else None,
        product_name=product.name,
        product_category=product.category,
        duration_type=product.duration_type,
        checked_in=True,
        checked_in_at=event.occurred_at,
    )


# ── Scan history ──────────────────────────────────────────────────────────────

# Immutable snapshot first; legacy units minted before snapshots fall back to
# the live product category.
_CHECK_IN_CATEGORY = func.lower(
    func.coalesce(AttendeeProducts.product_category_snapshot, Products.category)
)
# The flow the unit was sold through. Units with no payment (comped or
# manually granted tickets) inherit the attendee's application flow.
_CHECK_IN_SALES_FLOW_ID = func.coalesce(
    Payments.sales_flow_id, Applications.sales_flow_id
)
_CHECK_IN_SOURCE = col(CheckIn.payload)["source"].astext


def _join_check_in_context(statement):
    """Join every table the scan-history filters, search and rows read.

    All joins are many-to-one from check_ins, so they never duplicate rows
    and the same joined statement serves both the page query and the count.
    Humans is joined once, as the payment's buyer.
    """
    return (
        statement.join(
            AttendeeProducts,
            col(AttendeeProducts.id) == col(CheckIn.attendee_product_id),
        )
        .join(Products, col(Products.id) == col(AttendeeProducts.product_id))
        .outerjoin(Attendees, col(Attendees.id) == col(AttendeeProducts.attendee_id))
        .outerjoin(Applications, col(Applications.id) == col(Attendees.application_id))
        .outerjoin(Payments, col(Payments.id) == col(AttendeeProducts.payment_id))
        .outerjoin(Humans, col(Humans.id) == col(Payments.buyer_human_id))
        .outerjoin(
            PaymentProducts,
            col(PaymentProducts.id) == col(AttendeeProducts.payment_product_id),
        )
        .outerjoin(SalesFlows, col(SalesFlows.id) == _CHECK_IN_SALES_FLOW_ID)
    )


def _check_in_condition_expression(condition: CheckInFilterCondition):
    """Scan-history conditions over joined columns; occurred_at uses the default."""
    if condition.field == "product_id":
        return uuid_condition_expression(
            col(AttendeeProducts.product_id), condition.op, condition.uuid_value
        )
    if condition.field == "sales_flow_id":
        value = None if condition.op in VALUELESS_OPS else condition.uuid_value
        return uuid_condition_expression(_CHECK_IN_SALES_FLOW_ID, condition.op, value)
    if condition.field == "product_category":
        if condition.value == "other":
            matches = and_(
                _CHECK_IN_CATEGORY.is_not(None),
                _CHECK_IN_CATEGORY.not_in(sorted(CHECK_IN_PRODUCT_CATEGORIES)),
            )
        else:
            matches = _CHECK_IN_CATEGORY == condition.value
        if condition.op == "eq":
            return matches
        return or_(_CHECK_IN_CATEGORY.is_(None), not_(matches))
    if condition.field == "source":
        return text_condition_expression(
            _CHECK_IN_SOURCE, condition.op, condition.value
        )
    if condition.field == "has_attendee":
        attendee_id = col(AttendeeProducts.attendee_id)
        return attendee_id.is_not(None) if condition.value else attendee_id.is_(None)
    return None


def _check_in_search_expression(search: str):
    """Case-insensitive match on who the unit belongs to, its code and product."""
    term = f"%{escape_like(search.strip())}%"
    columns = [
        col(Attendees.name),
        col(Attendees.email),
        func.concat_ws(" ", Humans.first_name, Humans.last_name),
        Humans.email,
        col(Payments.buyer_snapshot)["buyer_name"].astext,
        col(Payments.buyer_snapshot)["buyer_email"].astext,
        col(AttendeeProducts.check_in_code),
        col(Products.name),
    ]
    return or_(*(column.ilike(term, escape="\\") for column in columns))


def _buyer_identity(
    human: Humans | None, snapshot: dict | None
) -> tuple[str | None, str | None]:
    """Buyer name/email from the buyer Human, else the checkout snapshot."""
    if human is not None:
        return human.display_name, human.email
    if snapshot:
        name = snapshot.get("buyer_name")
        email = snapshot.get("buyer_email")
        return (str(name) if name else None, str(email) if email else None)
    return None, None


@router.get("", response_model=ListModel[CheckInListItem])
async def list_check_ins(
    db: TenantSession,
    current_user: CurrentCheckInOperator,
    attendee_product_id: uuid.UUID | None = None,
    popup_id: uuid.UUID | None = None,
    search: str | None = None,
    filters: str | None = None,
    skip: PaginationSkip = 0,
    limit: PaginationLimit = 50,
) -> ListModel[CheckInListItem]:
    """List check-ins with attendee, buyer, product and flow context (BO only).

    Filters:
    - attendee_product_id: exact match on the ticket UUID
    - popup_id: exact match on the popup the scan happened in
    - search: attendee or buyer name/email, check-in code, product name
    - filters: JSON filter group
      (``{"match": "all"|"any", "conditions": [{"field", "op", "value"}]}``)
      over sales_flow_id, product_id, product_category, source,
      has_attendee and occurred_at

    Ordered by occurred_at DESC. Tenant isolation is enforced both via the
    TenantSession (separate DB connection per tenant) and by an explicit
    tenant_id filter (defence-in-depth).
    """
    parsed_filters = parse_check_in_filters(filters)

    # Tenant filter — explicit defence-in-depth on top of TenantSession/RLS.
    # current_user.tenant_id is None only for superadmins, who get their own
    # TenantSession for the X-Tenant-Id header's tenant anyway.
    conditions = []
    if current_user.tenant_id is not None:
        conditions.append(CheckIn.tenant_id == current_user.tenant_id)
    if attendee_product_id is not None:
        conditions.append(CheckIn.attendee_product_id == attendee_product_id)
    if popup_id is not None:
        conditions.append(CheckIn.popup_id == popup_id)
    if search and search.strip():
        conditions.append(_check_in_search_expression(search))
    if parsed_filters is not None:
        expression = build_filter_expression(
            parsed_filters, CheckIn, _check_in_condition_expression
        )
        if expression is not None:
            conditions.append(expression)

    count_statement = _join_check_in_context(
        sa_select(func.count(CheckIn.id)).select_from(CheckIn)  # type: ignore[arg-type]
    ).where(*conditions)
    total = db.exec(count_statement).one()

    statement = (
        _join_check_in_context(
            select(
                CheckIn,
                Humans,
                Payments.buyer_snapshot,
                PaymentProducts.quantity,
                SalesFlows.id,
                SalesFlows.name,
            )
        )
        .where(*conditions)
        .options(
            selectinload(CheckIn.attendee_product).selectinload(
                AttendeeProducts.attendee
            ),  # type: ignore[arg-type]
            selectinload(CheckIn.attendee_product).selectinload(
                AttendeeProducts.product
            ),  # type: ignore[arg-type]
        )
        .order_by(col(CheckIn.occurred_at).desc())
        .offset(skip)
        .limit(limit)
    )
    rows = list(db.exec(statement).all())

    # Resolve actor user details via the main engine — tenant_role lacks SELECT
    # on the users table by design. Mirrors the pattern used in
    # application_review/router._get_reviewer_details.
    actor_ids = {row[0].actor_user_id for row in rows if row[0].actor_user_id}
    actors_by_id: dict[uuid.UUID, Users] = {}
    if actor_ids:
        with Session(engine) as main_session:
            actor_id_col = Users.id  # ty:ignore[invalid-assignment]
            actor_rows = main_session.exec(
                select(Users).where(actor_id_col.in_(actor_ids))  # type: ignore[attr-defined]
            ).all()
            actors_by_id = {u.id: u for u in actor_rows}

    results = []
    for event, buyer, buyer_snapshot, unit_count, flow_id, flow_name in rows:
        ap: AttendeeProducts | None = event.attendee_product  # type: ignore[attr-defined]
        attendee: Attendees | None = ap.attendee if ap else None  # type: ignore[union-attr]
        product: Products | None = ap.product if ap else None  # type: ignore[union-attr]
        actor = actors_by_id.get(event.actor_user_id) if event.actor_user_id else None
        buyer_name, buyer_email = _buyer_identity(buyer, buyer_snapshot)

        source: str | None = None
        if event.payload and isinstance(event.payload, dict):
            source = event.payload.get("source")

        category = (ap.product_category_snapshot if ap else None) or (
            product.category if product else None
        )

        results.append(
            CheckInListItem(
                id=event.id,
                attendee_product_id=event.attendee_product_id,
                occurred_at=event.occurred_at,
                source=source,
                attendee_name=attendee.name if attendee else None,
                attendee_email=attendee.email if attendee else None,
                product_name=product.name if product else None,
                actor_user_id=event.actor_user_id,
                actor_user_name=actor.full_name if actor else None,
                actor_user_email=actor.email if actor else None,
                payload=event.payload,
                check_in_code=ap.check_in_code if ap else None,
                product_category=category.lower() if category else None,
                unit_index=ap.unit_index if ap else None,
                unit_count=unit_count,
                buyer_name=buyer_name,
                buyer_email=buyer_email,
                sales_flow_id=flow_id,
                sales_flow_name=flow_name,
            )
        )

    return ListModel[CheckInListItem](
        results=results,
        paging=Paging(offset=skip, limit=limit, total=total),
    )
