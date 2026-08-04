"""Upsale flow eligibility (sdd/sales-flows design D8, G0 #2/#3, task 13.1).

Eligibility for an upsale-type flow = the calling human has at least one
APPROVED payment anywhere in the popup ("any approved payment in the popup"
per G0 #3 — not scoped to a specific flow: `payments.sales_flow_id` stays
provenance-only per design D7, never a request-path authorization filter).

Evaluated LIVE at both catalog render and purchase time (design D8) — never
snapshotted. A refund or cancellation must immediately revoke access, so
this module deliberately has no caching layer of its own; callers that need
to avoid repeating the query within one request memoize the boolean
themselves (it is invariant per (human, popup) within a single request).

`identity_mode=portal_auth` (schemas.SalesFlowIdentityMode) is the only
implemented mode in v1 — an upsale flow is unreachable without a portal
human token. `identity_mode.anonymous` stays reserved (unimplemented).
"""

import uuid
from typing import TYPE_CHECKING

from fastapi import HTTPException, status
from sqlalchemy import exists as sa_exists
from sqlmodel import Session, select

from app.api.sales_flow.schemas import SalesFlowType

if TYPE_CHECKING:
    from app.api.human.schemas import HumanPublic
    from app.api.sales_flow.models import SalesFlows


def has_approved_payment(
    session: Session, human_id: uuid.UUID, popup_id: uuid.UUID
) -> bool:
    """Does `human_id` have >=1 APPROVED payment anywhere in `popup_id`?

    Mirrors `application/crud.py::resolve_popup_access`'s Step 5 payment
    predicate (application-leg + direct-sale-leg), narrowed to
    `status=APPROVED`. Two lightweight `EXISTS` probes, short-circuited —
    no full row is loaded.
    """
    from app.api.application.models import Applications
    from app.api.attendee.models import Attendees
    from app.api.payment.models import PaymentProducts, Payments
    from app.api.payment.schemas import PaymentStatus

    # Application-leg: an APPROVED payment linked to an application owned by
    # this human for this popup.
    app_payment_exists = select(
        sa_exists()
        .where(Payments.popup_id == popup_id)
        .where(Payments.status == PaymentStatus.APPROVED.value)
        .where(
            Payments.application_id.in_(  # type: ignore[union-attr]
                select(Applications.id).where(
                    Applications.human_id == human_id,
                    Applications.popup_id == popup_id,
                )
            )
        )
    )
    if session.exec(app_payment_exists).one():
        return True

    # Direct-sale leg: an APPROVED payment via product snapshot -> attendee
    # owned by this human, with no application in the picture.
    direct_payment_exists = select(
        sa_exists()
        .where(Payments.popup_id == popup_id)
        .where(Payments.status == PaymentStatus.APPROVED.value)
        .where(Payments.application_id.is_(None))  # type: ignore[union-attr]
        .where(
            Payments.id.in_(  # type: ignore[union-attr]
                select(PaymentProducts.payment_id)
                .join(Attendees, PaymentProducts.attendee_id == Attendees.id)
                .where(
                    Attendees.human_id == human_id,
                    Attendees.popup_id == popup_id,
                    Attendees.application_id.is_(None),  # type: ignore[union-attr]
                )
            )
        )
    )
    return session.exec(direct_payment_exists).one()


def assert_upsale_eligible(
    session: Session,
    flow: "SalesFlows",
    popup_id: uuid.UUID,
    tenant_id: uuid.UUID,
    current_human: "HumanPublic | None",
) -> None:
    """Gate an upsale-type flow to portal-authenticated, eligible humans.

    No-op unless `flow.type == upsale` — direct and application-type flows
    are unaffected.

    Anonymous caller (no token, or a non-human token) -> 401: no
    credentials were presented at all, so "sign in" is the correct signal.
    Authenticated but cross-tenant, or no approved payment in the popup ->
    403: credentials were presented and are valid, they simply do not grant
    access here. Neither response leaks new information about the flow: its
    existence is already URL-addressable (design Threat Matrix), so a
    uniform "sign in" / "no access" pair is enough — no need to collapse
    them further for anti-enumeration purposes.
    """
    if SalesFlowType(flow.type) != SalesFlowType.upsale:
        return

    if current_human is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Sign in to access this checkout",
            headers={"WWW-Authenticate": "Bearer"},
        )

    if current_human.tenant_id != tenant_id or not has_approved_payment(
        session, current_human.id, popup_id
    ):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="You don't have access to this checkout",
        )
