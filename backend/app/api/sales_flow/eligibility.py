"""Live positive-grant eligibility for popup upsale flows.

Accepted Applications and active self/managed access holdings grant access.
Application negatives, bare Attendees, other holding types, and Payment
ancestry do not.

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


def has_popup_products(
    session: Session, human_id: uuid.UUID, popup_id: uuid.UUID
) -> bool:
    """Whether an accessible Attendee has an active typed access holding."""
    from app.api.attendee.crud import attendees_crud
    from app.api.attendee.models import AttendeeProducts
    from app.api.product.schemas import FulfillmentType

    attendee_ids = attendees_crud._human_accessible_attendee_ids(human_id, popup_id)

    product_exists = select(
        sa_exists().where(
            AttendeeProducts.attendee_id.in_(  # type: ignore[union-attr]
                select(attendee_ids.c.id)
            ),
            AttendeeProducts.fulfillment_type == FulfillmentType.ACCESS.value,
        )
    )
    return session.exec(product_exists).one()


def has_approved_payment(
    session: Session, human_id: uuid.UUID, popup_id: uuid.UUID
) -> bool:
    """Does `human_id` have >=1 APPROVED payment anywhere in `popup_id`?

    Return Payment ancestry for diagnostics; never use it as an access grant.
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


def is_upsale_eligible(
    session: Session, human_id: uuid.UUID, popup_id: uuid.UUID
) -> bool:
    """Composed eligibility: accepted Application OR typed access holding.

    Single source of truth consumed by both `assert_upsale_eligible`
    (checkout gate) and `ApplicationsCRUD.resolve_upsale_catalog`
    (passes-page listing), so the two surfaces stay in lockstep.
    """
    from app.api.application.models import Applications
    from app.api.application.schemas import ApplicationStatus

    accepted = select(
        sa_exists().where(
            Applications.human_id == human_id,
            Applications.popup_id == popup_id,
            Applications.status == ApplicationStatus.ACCEPTED.value,
        )
    )
    return session.exec(accepted).one() or has_popup_products(
        session, human_id, popup_id
    )


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
    Authenticated but cross-tenant, or not upsale-eligible in the popup
    -> 403: credentials were presented and are valid, they simply do not
    grant access here. Neither response leaks new information about the flow: its
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

    if current_human.tenant_id != tenant_id or not is_upsale_eligible(
        session, current_human.id, popup_id
    ):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="You don't have access to this checkout",
        )


def has_accepted_application_in_flow(
    session: Session,
    human_id: uuid.UUID,
    sales_flow_id: uuid.UUID,
) -> bool:
    """Whether `human_id` has been accepted into `sales_flow_id`.

    Keyed on the flow, not the popup. Since F4 an application always names
    one, so being accepted into the general intake says nothing about a
    partner flow that asks its own questions.
    """
    from app.api.application.models import Applications
    from app.api.application.schemas import ApplicationStatus

    return bool(
        session.exec(
            select(
                sa_exists().where(
                    Applications.human_id == human_id,
                    Applications.sales_flow_id == sales_flow_id,
                    Applications.status == ApplicationStatus.ACCEPTED.value,
                )
            )
        ).first()
    )


def assert_application_flow_eligible(
    session: Session,
    flow: "SalesFlows",
    tenant_id: uuid.UUID,
    current_human: "HumanPublic | None",
) -> None:
    """Gate an application-type flow to the people it already accepted.

    An application flow used to be refused outright at the checkout route,
    on the reading that its buyers go through the portal. They do, but the
    two surfaces render the same `ScrollyCheckoutFlow`; the only real
    difference is which payment call runs. Refusing by flow TYPE used the
    wrong question — what decides an anonymous purchase from an
    application-backed one is who is buying, not what the flow is called.

    So this asks that instead, and mirrors `assert_upsale_eligible` exactly:

    Anonymous -> 401, because no credentials were presented at all.
    Authenticated but not accepted into THIS flow -> 403, because
    credentials were presented, are valid, and simply do not grant access
    here.

    The distinction matters more than for upsales: this endpoint is public
    and rate-limited, and an application flow's catalog is not something an
    anonymous caller may enumerate.
    """
    if SalesFlowType(flow.type) != SalesFlowType.application:
        return

    if current_human is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Sign in to access this checkout",
            headers={"WWW-Authenticate": "Bearer"},
        )

    if current_human.tenant_id != tenant_id or not has_accepted_application_in_flow(
        session, current_human.id, flow.id
    ):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="You don't have access to this checkout",
        )
