import random
import string
import uuid
from datetime import UTC, datetime
from typing import Any

from fastapi import HTTPException, status
from sqlalchemy import and_, or_
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import selectinload
from sqlmodel import Session, func, select

from app.api.attendee.models import AttendeeProducts, Attendees
from app.api.attendee.schemas import (
    AttendeeCreate,
    AttendeeFilterCondition,
    AttendeeFilters,
    AttendeeTicketMetadataUpdate,
    AttendeeUpdate,
)
from app.api.audit_log.actor import AuditActor
from app.api.audit_log.constants import AuditAction, AuditEntityType
from app.api.shared.crud import BaseCRUD
from app.core.filters import build_filter_expression


def _attendee_condition_expression(condition: AttendeeFilterCondition):
    """Attendee-specific conditions; None delegates to the shared engine."""
    if condition.field == "has_tickets":
        # Same correlated EXISTS as the legacy has_tickets query param.
        ticket_exists = _access_holding_exists()
        return ticket_exists if condition.value else ~ticket_exists
    return None


def _access_holding_exists():
    """Match an active allocated ticket unit by immutable category."""
    return (
        select(AttendeeProducts.id)
        .where(
            AttendeeProducts.attendee_id == Attendees.id,
            AttendeeProducts.revoked_at.is_(None),
            AttendeeProducts.product_category_snapshot == "ticket",
        )
        .exists()
    )


def unit_authority_predicate(human_id: uuid.UUID, popup_id: uuid.UUID):
    """Authorize a unit by allocation or immutable payment buyer lineage."""
    from app.api.application.models import Applications
    from app.api.payment.models import PaymentProducts, Payments

    allocated = and_(
        Attendees.popup_id == popup_id,
        or_(
            Attendees.human_id == human_id,
            and_(
                Applications.human_id == human_id,
                Applications.popup_id == popup_id,
                Applications.tenant_id == Attendees.tenant_id,
            ),
        ),
    )
    purchased = and_(
        PaymentProducts.id == AttendeeProducts.payment_product_id,
        PaymentProducts.payment_id == Payments.id,
        Payments.buyer_human_id == human_id,
        Payments.popup_id == popup_id,
    )
    return or_(allocated, purchased)


def build_attendee_filter_expression(filters: AttendeeFilters):
    """Combine the filter group into one boolean expression (None when empty)."""
    return build_filter_expression(
        filters,
        Attendees,
        condition_override=_attendee_condition_expression,
    )


def generate_check_in_code(prefix: str = "") -> str:
    """Generate a unique check-in code with optional prefix.

    Produces a prefix + 8 random uppercase letters. The 8-letter random part
    gives ~208 billion combinations (26^8), reducing collision probability
    during bulk migration explosion of quantity>1 rows.
    """
    code = "".join(random.choices(string.ascii_uppercase, k=8))
    return f"{prefix}{code}"


def _grant_unit_id(
    attendee_id: uuid.UUID, grant_key: str, line_index: int, unit_index: int
) -> uuid.UUID:
    """Derive a stable paymentless unit identity from one grant request."""
    return uuid.uuid5(
        attendee_id, f"product-unit-grant:{grant_key}:{line_index}:{unit_index}"
    )


def _require_ticket_product(product: Any) -> None:
    if (product.category or "").lower() != "ticket":
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Only ticket products can be granted as tickets",
        )


class AttendeesCRUD(BaseCRUD[Attendees, AttendeeCreate, AttendeeUpdate]):
    """CRUD operations for Attendees."""

    def __init__(self) -> None:
        super().__init__(Attendees)

    def get_by_check_in_code(
        self,
        session: Session,
        code: str,
    ) -> "tuple[AttendeeProducts, Attendees, Any] | None":
        """Return (ticket, attendee, product) for a given check_in_code.

        Looks up AttendeeProducts.check_in_code (Design §2.3). Returns None when
        the code is not found. Uses selectinload so product and attendee are
        available without additional queries.
        """
        statement = (
            select(AttendeeProducts)
            .where(
                AttendeeProducts.check_in_code == code,
                AttendeeProducts.revoked_at.is_(None),
                AttendeeProducts.product_category_snapshot == "ticket",
            )
            .options(
                selectinload(AttendeeProducts.attendee),  # type: ignore[arg-type]
                selectinload(AttendeeProducts.product),  # type: ignore[arg-type]
            )
            .limit(1)
        )
        ticket = session.exec(statement).first()
        if ticket is None:
            return None
        return ticket, ticket.attendee, ticket.product

    def find_by_application(
        self,
        session: Session,
        application_id: uuid.UUID,
        skip: int = 0,
        limit: int = 100,
    ) -> tuple[list[Attendees], int]:
        """Find attendees for an application with pagination and eager loading."""
        statement = select(Attendees).where(Attendees.application_id == application_id)

        count_statement = select(func.count()).select_from(statement.subquery())
        total = session.exec(count_statement).one()

        statement = (
            statement.options(
                selectinload(Attendees.attendee_products).selectinload(  # type: ignore[arg-type]
                    AttendeeProducts.product  # ty: ignore[invalid-argument-type]
                ),
                selectinload(Attendees.category_ref),  # type: ignore[arg-type]
            )
            # Stable ordering so OFFSET/LIMIT pages are deterministic.
            .order_by(Attendees.created_at, Attendees.id)  # type: ignore[arg-type]
            .offset(skip)
            .limit(limit)
        )
        results = list(session.exec(statement).all())

        return results, total

    def find_by_email(
        self,
        session: Session,
        email: str,
        skip: int = 0,
        limit: int = 100,
    ) -> tuple[list[Attendees], int]:
        """Find attendees by email."""
        from app.api.application.models import Applications

        statement = select(Attendees).where(Attendees.email == email.lower())

        count_statement = select(func.count()).select_from(statement.subquery())
        total = session.exec(count_statement).one()

        statement = (
            statement.options(
                selectinload(Attendees.attendee_products).selectinload(  # type: ignore[arg-type]
                    AttendeeProducts.product  # ty: ignore[invalid-argument-type]
                ),
                selectinload(Attendees.application).selectinload(  # type: ignore[arg-type]
                    Applications.popup  # ty: ignore[invalid-argument-type]
                ),
                selectinload(Attendees.popup),  # type: ignore[arg-type]
                selectinload(Attendees.category_ref),  # type: ignore[arg-type]
            )
            .offset(skip)
            .limit(limit)
        )
        results = list(session.exec(statement).all())

        return results, total

    def find_by_popup(
        self,
        session: Session,
        popup_id: uuid.UUID,
        skip: int = 0,
        limit: int = 100,
        search: str | None = None,
        has_tickets: bool | None = None,
        category_id: uuid.UUID | None = None,
        filters: AttendeeFilters | None = None,
    ) -> tuple[list[Attendees], int]:
        """Find attendees by popup_id with eager loading.

        Queries directly on Attendees.popup_id (denormalized). Covers both
        application-based attendees (popup_id backfilled from application)
        and direct-sale attendees (popup_id set at creation, no application).

        has_tickets means an access holding: typed ``access`` or, until drain,
        a legacy NULL holding whose Product category is ``ticket``. Participant
        holdings do not qualify. Uses a correlated EXISTS so rows are not
        multiplied.

        ``filters`` is a validated AttendeeFilters group compiled to one
        boolean expression and ANDed with the legacy params.
        """
        base_statement = select(Attendees).where(Attendees.popup_id == popup_id)

        if filters is not None:
            filter_expression = build_attendee_filter_expression(filters)
            if filter_expression is not None:
                base_statement = base_statement.where(filter_expression)

        if search:
            search_term = f"%{search}%"
            base_statement = base_statement.where(
                Attendees.name.ilike(search_term) | Attendees.email.ilike(search_term)  # type: ignore[union-attr]
            )

        if has_tickets is not None:
            ticket_exists = _access_holding_exists()
            base_statement = base_statement.where(
                ticket_exists if has_tickets else ~ticket_exists
            )

        if category_id is not None:
            base_statement = base_statement.where(Attendees.category_id == category_id)

        # Use proper count query instead of fetching all rows
        count_statement = select(func.count()).select_from(base_statement.subquery())
        total = session.exec(count_statement).one()

        # Eager load relationships to avoid N+1 queries
        statement = (
            base_statement.options(
                selectinload(Attendees.attendee_products).selectinload(  # type: ignore[arg-type]
                    AttendeeProducts.product  # ty: ignore[invalid-argument-type]
                ),
                selectinload(Attendees.application),  # type: ignore[arg-type]
                selectinload(Attendees.category_ref),  # type: ignore[arg-type]
            )
            .offset(skip)
            .limit(limit)
        )
        results = list(session.exec(statement).all())
        return results, total

    def create_internal(
        self,
        session: Session,
        tenant_id: uuid.UUID,
        application_id: uuid.UUID,
        popup_id: uuid.UUID,
        name: str,
        category: str | None = None,
        email: str | None = None,
        gender: str | None = None,
        human_id: uuid.UUID | None = None,
        category_id: uuid.UUID | None = None,
        additional_data: dict | None = None,
        commit: bool = True,
    ) -> Attendees:
        """Create an attendee with internal fields.

        If email is provided and human_id is not, attempts to find an existing
        Human with matching email+tenant_id and links them.

        popup_id is REQUIRED — it's a NOT NULL column on attendees. Callers
        that work with an application should pass application.popup_id.

        category (legacy string) is accepted but ignored — the column was
        dropped in PR 2. Use category_id (UUID FK) instead.

        Check-in codes live on AttendeeProducts (one per purchased ticket) and
        are created when the product is purchased, not when the attendee is.
        """
        from app.services.trial_limits import enforce_trial_attendee_cap

        enforce_trial_attendee_cap(session, tenant_id)

        # If email provided but no human_id, try to find matching Human
        if email and not human_id:
            human_id = self._find_human_id_by_email(session, email, tenant_id)

        attendee = Attendees(
            tenant_id=tenant_id,
            application_id=application_id,
            popup_id=popup_id,
            name=name,
            category_id=category_id,
            email=email,
            gender=gender,
            human_id=human_id,
            additional_data=additional_data or {},
        )
        session.add(attendee)
        if commit:
            session.commit()
        else:
            session.flush()
        session.refresh(attendee)
        return attendee

    def human_has_ticket_in_popup(
        self,
        session: Session,
        human_id: uuid.UUID,
        popup_id: uuid.UUID,
    ) -> bool:
        """Whether the human owns at least one ticket (attendee_product) in the
        popup. Used to gate self-serve actions (e.g. creating a referral link)
        to confirmed attendees who actually have an entry.
        """
        row = session.exec(
            select(AttendeeProducts.id)
            .join(Attendees, Attendees.id == AttendeeProducts.attendee_id)  # type: ignore[arg-type]
            .where(
                Attendees.human_id == human_id,
                Attendees.popup_id == popup_id,
            )
            .limit(1)
        ).first()
        return row is not None

    def get_main_attendee(
        self,
        session: Session,
        application_id: uuid.UUID,
    ) -> Attendees | None:
        """Return the primary (is_primary=True) attendee for an application.

        Joins through attendee_categories to pick the one whose category is
        marked primary on the popup. Falls back to the first attendee row
        when no category match is found (e.g. legacy data where category_id
        is NULL on the only main row).
        """
        from app.api.attendee_category.models import AttendeeCategories

        statement = (
            select(Attendees)
            .join(
                AttendeeCategories,
                Attendees.category_id == AttendeeCategories.id,  # type: ignore[arg-type]
            )
            .where(
                Attendees.application_id == application_id,
                AttendeeCategories.is_primary.is_(True),  # type: ignore[union-attr]
            )
            .limit(1)
        )
        primary = session.exec(statement).first()
        if primary is not None:
            return primary

        fallback = session.exec(
            select(Attendees).where(Attendees.application_id == application_id).limit(1)
        ).first()
        return fallback

    def find_attendee_for_human(
        self,
        session: Session,
        human_id: uuid.UUID,
        popup_id: uuid.UUID,
    ) -> Attendees | None:
        """Find the attendee row this human IS at this popup, if any.

        Identity, not ownership: the only test is that the row carries their
        human_id. So it also returns the row somebody else added them to as a
        companion — that row is still them at this gathering, and the tickets
        they buy for themselves belong on it.

        Ownership (_human_popup_attendee_ids) answers a different question:
        which rows a human holds, theirs plus their application's party. It
        must not be used here, because a party contains other people.

        Their own application-less row wins when several match, so a repeat
        buyer keeps landing where they landed before, and a row on an
        application of their own beats one they are a companion on. Older
        rows break what is left. Only data from before the duplicate guards
        can offer more than one row to choose from.
        """
        from app.api.application.models import Applications

        statement = (
            select(Attendees)
            .outerjoin(Applications, Attendees.application_id == Applications.id)  # type: ignore[arg-type]
            .where(
                Attendees.human_id == human_id,
                Attendees.popup_id == popup_id,
            )
            .order_by(
                Attendees.application_id.is_(None).desc(),  # type: ignore[union-attr]
                (Applications.human_id == human_id).desc(),
                Attendees.created_at,  # type: ignore[arg-type]
            )
            .limit(1)
        )
        return session.exec(statement).first()

    def adopt_or_create_for_application(
        self,
        session: Session,
        *,
        tenant_id: uuid.UUID,
        application_id: uuid.UUID,
        popup_id: uuid.UUID,
        human_id: uuid.UUID,
        name: str,
        email: str | None = None,
        gender: str | None = None,
        category_id: uuid.UUID | None = None,
    ) -> Attendees:
        """Give an application the attendee row of the person who filed it.

        The applicant can already be at this popup without an application:
        they bought a ticket before applying, or they left somebody else's
        party carrying one. That row IS them, tickets and all, so the
        application takes it over rather than making a second one.

        A row that already belongs to an application is left alone — holding
        one application per flow is deliberate, and a companion row belongs to
        its host.

        Flush-only on the adoption path; the caller owns the commit.
        """
        existing = self.find_attendee_for_human(session, human_id, popup_id)
        if existing is None or existing.application_id is not None:
            return self.create_internal(
                session,
                tenant_id=tenant_id,
                application_id=application_id,
                popup_id=popup_id,
                name=name,
                email=email,
                gender=gender,
                human_id=human_id,
                category_id=category_id,
            )

        existing.application_id = application_id
        existing.name = name
        # They are the applicant here, whatever the row called them before.
        if category_id is not None:
            existing.category_id = category_id
        if email and not existing.email:
            existing.email = email.lower()
        if gender and not existing.gender:
            existing.gender = gender
        session.add(existing)
        session.flush()
        return existing

    def human_attends_popup(
        self,
        session: Session,
        human_id: uuid.UUID,
        popup_id: uuid.UUID,
    ) -> bool:
        """Whether this human is already at this popup, in any shape.

        True when a row IS them — their own application's row, a direct-sale
        row, or a row somebody added them to as a companion — and also when
        they hold an application whose party is filed under them, which covers
        the older rows that never got a human_id stamped on them.

        The question every path that adds a person has to ask before adding
        them again.
        """
        if self.find_attendee_for_human(session, human_id, popup_id) is not None:
            return True

        from app.api.application.models import Applications

        legacy_identity = (
            select(Attendees.id)
            .join(Applications, Attendees.application_id == Applications.id)  # type: ignore[arg-type]
            .where(
                Applications.human_id == human_id,
                Applications.popup_id == popup_id,
                Applications.tenant_id == Attendees.tenant_id,
            )
            .limit(1)
        )
        return session.exec(legacy_identity).first() is not None

    def find_or_create_buyer_attendee(
        self,
        session: Session,
        human_id: uuid.UUID,
        popup_id: uuid.UUID,
        tenant_id: uuid.UUID,
        name: str,
        email: str | None = None,
    ) -> Attendees:
        """Return the attendee a direct purchase belongs to, creating it if new.

        A buyer who is already at this popup — because they applied, because
        they bought before, or because somebody listed them as a companion —
        gets that row. Only a buyer who is not there at all gets a fresh
        application-less one.

        Implements SELECT → INSERT → IntegrityError → re-SELECT so concurrent
        purchases by the same human for the same popup converge on one row.
        Does NOT call session.commit() — callers control the transaction boundary.

        Tickets are tracked via AttendeeProducts rows, so one attendee carries
        every direct purchase the buyer makes.
        """
        existing = self.find_attendee_for_human(session, human_id, popup_id)
        if existing:
            return existing

        from app.api.attendee_category.crud import attendee_categories_crud
        from app.services.trial_limits import enforce_trial_attendee_cap

        enforce_trial_attendee_cap(session, tenant_id)

        main_cat = attendee_categories_crud.get_primary_for_popup(session, popup_id)
        attendee = Attendees(
            tenant_id=tenant_id,
            application_id=None,
            popup_id=popup_id,
            human_id=human_id,
            name=name,
            category_id=main_cat.id if main_cat else None,
            email=email.lower() if email else None,
        )
        session.add(attendee)
        try:
            session.flush()
        except IntegrityError:
            session.rollback()
            # Concurrent INSERT — re-SELECT the winner
            existing = self.find_attendee_for_human(session, human_id, popup_id)
            if existing is None:
                raise  # unexpected — re-raise original error
            return existing
        return attendee

    def _find_human_id_by_email(
        self,
        session: Session,
        email: str,
        tenant_id: uuid.UUID,
    ) -> uuid.UUID | None:
        """Find a Human by email and tenant_id, return their ID if found."""
        from app.api.human.models import Humans

        statement = select(Humans.id).where(
            func.lower(Humans.email) == email.lower(),
            Humans.tenant_id == tenant_id,
        )
        return session.exec(statement).first()

    def link_attendees_to_human(
        self,
        session: Session,
        human_id: uuid.UUID,
        email: str,
        tenant_id: uuid.UUID,
    ) -> int:
        """Link all unlinked attendees with matching email to a Human.

        Returns the number of attendees linked.
        """
        statement = select(Attendees).where(
            func.lower(Attendees.email) == email.lower(),
            Attendees.tenant_id == tenant_id,
            Attendees.human_id.is_(None),  # type: ignore[union-attr]
        )
        attendees = session.exec(statement).all()
        count = 0
        for attendee in attendees:
            attendee.human_id = human_id
            session.add(attendee)
            count += 1
        if count > 0:
            session.commit()
        return count

    def find_by_human(
        self,
        session: Session,
        human_id: uuid.UUID,
        skip: int = 0,
        limit: int = 100,
    ) -> tuple[list[Attendees], int]:
        """Find all attendees linked to a Human with eager loading."""
        from app.api.application.models import Applications

        base_statement = select(Attendees).where(Attendees.human_id == human_id)

        count_statement = select(func.count()).select_from(base_statement.subquery())
        total = session.exec(count_statement).one()

        # Eager load relationships to avoid N+1 queries.
        # selectinload(Attendees.popup) covers direct-sale attendees (application_id=NULL)
        # so list_my_tickets can use attendee.popup safely for both legs.
        statement = (
            base_statement.options(
                selectinload(Attendees.attendee_products).selectinload(  # type: ignore[arg-type]
                    AttendeeProducts.product  # ty: ignore[invalid-argument-type]
                ),
                selectinload(Attendees.application).selectinload(  # type: ignore[arg-type]
                    Applications.popup  # ty: ignore[invalid-argument-type]
                ),
                selectinload(Attendees.popup),  # type: ignore[arg-type]
                selectinload(Attendees.category_ref),  # type: ignore[arg-type]
            )
            .offset(skip)
            .limit(limit)
        )
        results = list(session.exec(statement).all())

        return results, total

    def find_companion_for_popup(
        self,
        session: Session,
        human_id: uuid.UUID,
        popup_id: uuid.UUID,
    ) -> Attendees | None:
        """Find an attendee record where human is a companion (not the application owner).

        Joins Attendees → Applications and filters:
        - Attendees.human_id == human_id
        - Applications.popup_id == popup_id
        - Applications.human_id != human_id (excludes self — prevents main applicant
          from being classified as companion of their own application)
        """
        from app.api.application.models import Applications

        statement = (
            select(Attendees)
            .join(Applications, Attendees.application_id == Applications.id)  # type: ignore[arg-type]
            .where(
                Attendees.human_id == human_id,
                Applications.popup_id == popup_id,
                Applications.human_id != human_id,
            )
            .options(
                selectinload(Attendees.application),  # type: ignore[arg-type]
                selectinload(Attendees.attendee_products).selectinload(  # type: ignore[arg-type]
                    AttendeeProducts.product  # ty: ignore[invalid-argument-type]
                ),
                selectinload(Attendees.category_ref),  # type: ignore[arg-type]
            )
            .limit(1)
        )
        return session.exec(statement).first()

    def _human_accessible_attendee_ids(
        self,
        human_id: uuid.UUID,
        popup_id: uuid.UUID,
        tenant_id: uuid.UUID | None = None,
    ):
        """Return IDs accessible through self, manager, or legacy ownership."""
        from app.api.application.models import Applications

        legacy_application_owner = and_(
            Attendees.managed_by_human_id.is_(None),  # type: ignore[union-attr]
            Applications.human_id == human_id,
            Applications.popup_id == popup_id,
            Applications.tenant_id == Attendees.tenant_id,
        )
        statement = (
            select(Attendees.id)
            .outerjoin(Applications, Attendees.application_id == Applications.id)  # type: ignore[arg-type]
            .where(
                Attendees.popup_id == popup_id,
                or_(
                    Attendees.human_id == human_id,
                    Attendees.managed_by_human_id == human_id,
                    legacy_application_owner,
                ),
            )
        )
        if tenant_id is not None:
            statement = statement.where(Attendees.tenant_id == tenant_id)
        return statement.subquery()

    def _human_popup_attendee_ids(
        self,
        session: Session,
        human_id: uuid.UUID,
        popup_id: uuid.UUID,
    ):
        """Preserve the legacy bare-Attendee popup eligibility predicate.

        Portal attendee authorization must use `_human_accessible_attendee_ids`.
        This helper remains only until task 4.2 replaces the existing popup-access
        ladder with active self-or-managed ticket grants.
        """
        from app.api.application.models import Applications

        application_ids = (
            select(Attendees.id)
            .join(Applications, Attendees.application_id == Applications.id)  # type: ignore[arg-type]
            .where(
                Applications.human_id == human_id,
                Applications.popup_id == popup_id,
            )
        )
        direct_ids = select(Attendees.id).where(
            Attendees.human_id == human_id,
            Attendees.popup_id == popup_id,
            Attendees.application_id.is_(None),  # type: ignore[union-attr]
        )
        return application_ids.union(direct_ids).subquery()

    def get_for_human_popup(
        self,
        session: Session,
        *,
        attendee_id: uuid.UUID,
        human_id: uuid.UUID,
        popup_id: uuid.UUID,
        tenant_id: uuid.UUID,
    ) -> Attendees | None:
        """Return one authorized Attendee without revealing foreign rows."""
        attendee_ids = self._human_accessible_attendee_ids(
            human_id, popup_id, tenant_id
        )
        statement = (
            select(Attendees)
            .where(
                Attendees.id == attendee_id,
                Attendees.id.in_(select(attendee_ids.c.id)),  # type: ignore[arg-type]
            )
            .options(
                selectinload(Attendees.attendee_products).selectinload(  # type: ignore[arg-type]
                    AttendeeProducts.product  # ty: ignore[invalid-argument-type]
                ),
                selectinload(Attendees.payment_products),  # type: ignore[arg-type]
                selectinload(Attendees.category_ref),  # type: ignore[arg-type]
            )
        )
        return session.exec(statement).first()

    def find_by_human_popup(
        self,
        session: Session,
        human_id: uuid.UUID,
        popup_id: uuid.UUID,
        skip: int = 0,
        limit: int = 50,
        tenant_id: uuid.UUID | None = None,
    ) -> tuple[list[Attendees], int]:
        """Return all accessible Attendees for (human_id, popup_id).

        Uses the centralized self-or-manager compatibility predicate. Eager-loads
        attendee_products → product so callers can build portal responses without
        extra queries.

        Returns (rows, total_count) for paginated response building.
        """
        accessible_ids = self._human_accessible_attendee_ids(
            human_id, popup_id, tenant_id
        )

        count_statement = select(func.count()).where(
            Attendees.id.in_(select(accessible_ids.c.id))  # type: ignore[arg-type]
        )
        total = session.exec(count_statement).one()

        statement = (
            select(Attendees)
            .where(Attendees.id.in_(select(accessible_ids.c.id)))  # type: ignore[arg-type]
            .options(
                selectinload(Attendees.attendee_products).selectinload(  # type: ignore[arg-type]
                    AttendeeProducts.product  # ty: ignore[invalid-argument-type]
                ),
                selectinload(Attendees.payment_products),  # type: ignore[arg-type]
                selectinload(Attendees.category_ref),  # type: ignore[arg-type]
            )
            .offset(skip)
            .limit(limit)
        )
        results = list(session.exec(statement).all())
        return results, total

    def count_party_by_category(
        self,
        session: Session,
        human_id: uuid.UUID,
        popup_id: uuid.UUID,
        category_id: uuid.UUID,
        tenant_id: uuid.UUID | None = None,
    ) -> int:
        """How many of a human's party at this popup are of one category.

        Counted over the whole party, not one application. A person has one
        spouse at a gathering however many ways in they hold, so a cap read
        per application let the second door hand out a second one
        (sdd/sales-flows-rediseno).
        """
        accessible_ids = self._human_accessible_attendee_ids(
            human_id, popup_id, tenant_id
        )

        return session.exec(
            select(func.count()).where(
                Attendees.id.in_(select(accessible_ids.c.id)),  # type: ignore[arg-type]
                Attendees.category_id == category_id,
            )
        ).one()

    def find_purchases_by_human_popup(
        self,
        session: Session,
        human_id: uuid.UUID,
        popup_id: uuid.UUID,
        tenant_id: uuid.UUID | None = None,
    ) -> list[Attendees]:
        """Find attendees with purchased products for a human+popup combination.

        Uses the same self-or-manager compatibility predicate as portal attendee
        management so managed recipients and legacy application companions agree.
        """
        accessible_ids = self._human_accessible_attendee_ids(
            human_id, popup_id, tenant_id
        )

        statement = (
            select(Attendees)
            .where(Attendees.id.in_(select(accessible_ids.c.id)))  # type: ignore[arg-type]
            .options(
                selectinload(Attendees.attendee_products).selectinload(  # type: ignore[arg-type]
                    AttendeeProducts.product  # ty: ignore[invalid-argument-type]
                ),
                selectinload(Attendees.category_ref),  # type: ignore[arg-type]
            )
        )
        return list(session.exec(statement).all())

    def update_attendee(
        self,
        session: Session,
        attendee: Attendees,
        update_data: AttendeeUpdate,
    ) -> Attendees:
        """Update an attendee."""
        # If category is being changed and attendee has products, reject
        update_dict = update_data.model_dump(exclude_unset=True)

        for field, value in update_dict.items():
            setattr(attendee, field, value)

        session.add(attendee)
        session.commit()
        session.refresh(attendee)
        return attendee

    def delete_attendee(
        self,
        session: Session,
        attendee: Attendees,
    ) -> None:
        """Delete an attendee."""
        # Check if attendee has products
        if attendee.has_products():
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Cannot delete attendee with purchased products",
            )

        # Clear any payment_products references
        for pp in attendee.payment_products:
            session.delete(pp)

        session.delete(attendee)
        session.commit()

    def add_product(
        self,
        session: Session,
        attendee_id: uuid.UUID,
        product_id: uuid.UUID,
        tenant_id: uuid.UUID | None = None,
        payment_id: uuid.UUID | None = None,
        check_in_code_prefix: str = "",
        actor: AuditActor | None = None,
    ) -> AttendeeProducts:
        """Add one ticket (AttendeeProducts row) for an attendee.

        Always inserts a new row — callers that want N tickets must call N
        times (Design §2.2 of ticket-as-first-class-entity). Each row gets its
        own UUID PK and unique check_in_code.

        Also enforces stock decrement uniformly with the payment paths
        (locked decision §4 of product-inventory-redesign — no admin bypass):
          1. Fetch product (404 if missing)
          2. max_per_order single-ticket guard (422 if cap < 1, defensive)
          3. Atomic total-stock decrement of 1 (409 if sold out; no-op unlimited)
          4. Atomic tier-group shared-stock decrement if applicable
          5. Insert the new ticket row
        """
        from app.api.product.crud import products_crud
        from app.api.product.models import Products

        product = session.get(Products, product_id)
        if product is None:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Product not found",
            )

        # max_per_order is enforced per-cart in the calling layer; this guard
        # only catches the degenerate case where a single ticket would exceed
        # the cap (cap < 1 / 0 — invalid config).
        if product.max_per_order is not None and product.max_per_order < 1:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail=(
                    f"max_per_order ({product.max_per_order}) for "
                    f"'{product.name}' rejects all tickets"
                ),
            )

        if payment_id is not None:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail="Paid holdings must be created through payment fulfillment",
            )

        # Atomic total-stock decrement (no-op when unlimited)
        products_crud.decrement_total_stock(session, product_id, 1)

        if tenant_id is None:
            attendee = session.get(Attendees, attendee_id)
            if attendee is None:
                raise HTTPException(
                    status_code=status.HTTP_404_NOT_FOUND,
                    detail="Attendee not found",
                )
            tenant_id = attendee.tenant_id

        ticket = AttendeeProducts(
            id=uuid.uuid4(),
            tenant_id=tenant_id,
            attendee_id=attendee_id,
            product_id=product_id,
            check_in_code=generate_check_in_code(check_in_code_prefix),
            payment_id=payment_id,
            product_category_snapshot=product.category,
            requires_check_in_snapshot=product.requires_check_in,
        )
        session.add(ticket)

        # Audit only when an actor is supplied (admin manual add). The purchase
        # and grant paths pass no actor here and log through their own flows.
        if actor is not None:
            attendee = session.get(Attendees, attendee_id)
            if attendee is not None:
                self._record_ticket_event(
                    session,
                    attendee=attendee,
                    actor=actor,
                    action=AuditAction.TICKET_ADD,
                    details={
                        "products": [
                            {
                                "product_id": str(product_id),
                                "product_name": product.name,
                                "quantity": 1,
                            }
                        ],
                    },
                )

        session.commit()
        session.refresh(ticket)
        return ticket

    def add_products(
        self,
        session: Session,
        attendee_id: uuid.UUID,
        items: list[tuple[uuid.UUID, int]],
        tenant_id: uuid.UUID | None = None,
        actor: AuditActor | None = None,
        grant_key: str | None = None,
    ) -> None:
        """Add multiple tickets (product × quantity) to an attendee atomically.

        Mirrors the bulk-grant contract for a single attendee: each product must
        be active and in the attendee's popup; stock is decremented per product
        (409 if insufficient). All tickets are created in one transaction so a
        sold-out failure mid-batch rolls everything back. Records a single
        TICKET_ADD audit event listing every product/quantity added.
        """
        from app.api.product.crud import products_crud

        attendee = session.exec(
            select(Attendees).where(Attendees.id == attendee_id).with_for_update()
        ).first()
        if attendee is None:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Attendee not found",
            )
        if tenant_id is None:
            tenant_id = attendee.tenant_id

        products = []
        for line_index, (product_id, quantity) in enumerate(items):
            product = products_crud.get(session, product_id)
            if product is None or product.popup_id != attendee.popup_id:
                raise HTTPException(
                    status_code=status.HTTP_404_NOT_FOUND,
                    detail="Product not found",
                )
            if not product.is_active:
                raise HTTPException(
                    status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                    detail=f"'{product.name}' is not available",
                )
            _require_ticket_product(product)
            products.append((line_index, product, quantity))

        added: list[dict] = []
        for line_index, product, quantity in products:
            unit_ids = [
                _grant_unit_id(attendee_id, grant_key, line_index, unit_index)
                if grant_key
                else uuid.uuid4()
                for unit_index in range(quantity)
            ]
            existing = {
                unit.id: unit
                for unit in session.exec(
                    select(AttendeeProducts)
                    .where(AttendeeProducts.id.in_(unit_ids))  # type: ignore[attr-defined]
                    .with_for_update()
                ).all()
            }
            for unit in existing.values():
                if (
                    unit.tenant_id != tenant_id
                    or unit.attendee_id != attendee_id
                    or unit.product_id != product.id
                    or unit.payment_id is not None
                    or unit.payment_product_id is not None
                    or unit.unit_index is not None
                ):
                    raise HTTPException(
                        status_code=status.HTTP_409_CONFLICT,
                        detail="Grant identity conflicts with an existing product unit",
                    )
            missing_ids = [unit_id for unit_id in unit_ids if unit_id not in existing]
            if not missing_ids:
                continue
            # Atomic decrement of the whole quantity (409 if insufficient).
            products_crud.decrement_total_stock(session, product.id, len(missing_ids))

            for unit_id in missing_ids:
                session.add(
                    AttendeeProducts(
                        id=unit_id,
                        tenant_id=tenant_id,
                        attendee_id=attendee_id,
                        product_id=product.id,
                        check_in_code=generate_check_in_code(),
                        payment_id=None,
                        product_category_snapshot=product.category,
                        requires_check_in_snapshot=product.requires_check_in,
                    )
                )
            added.append(
                {
                    "product_id": str(product.id),
                    "product_name": product.name,
                    "quantity": len(missing_ids),
                }
            )

        if actor is not None and added:
            self._record_ticket_event(
                session,
                attendee=attendee,
                actor=actor,
                action=AuditAction.TICKET_ADD,
                details={"products": added},
            )

        session.commit()

    def remove_ticket(
        self,
        session: Session,
        ticket_id: uuid.UUID,
    ) -> None:
        """Delete a single AttendeeProducts row by its UUID PK.

        Design §2.4: under always-insert semantics every row is an independent
        ticket. Callers must identify *which* ticket to remove by its id.
        Deleting by (attendee_id, product_id) would arbitrarily pick one row
        when multiple tickets of the same product exist for an attendee.
        """
        ticket = session.get(AttendeeProducts, ticket_id)
        if ticket:
            session.delete(ticket)
            session.commit()

    def _record_ticket_event(
        self,
        session: Session,
        *,
        attendee: Attendees,
        actor: AuditActor,
        action: str,
        details: dict,
    ) -> None:
        """Stage an audit entry for a ticket action in the current transaction.

        Grouped under the attendee (entity_type=attendee, entity_id=attendee.id)
        so the per-attendee history is a single entity_id filter. The audit row
        is committed together with the mutation by the caller.
        """
        from app.api.audit_log.crud import audit_logs_crud

        audit_logs_crud.record(
            session,
            tenant_id=attendee.tenant_id,
            actor=actor,
            action=action,
            entity_type=AuditEntityType.ATTENDEE,
            entity_id=attendee.id,
            entity_label=attendee.name,
            popup_id=attendee.popup_id,
            details=details,
        )

    def swap_ticket_product(
        self,
        session: Session,
        attendee_id: uuid.UUID,
        ticket_id: uuid.UUID,
        new_product_id: uuid.UUID,
        actor: AuditActor | None = None,
    ) -> AttendeeProducts:
        """Change the product of a single ticket (admin, no payment).

        Operates only on the ticket layer (AttendeeProducts) plus inventory.
        The payment_products financial snapshot is intentionally left intact as
        the historical record of the original payment — _build_attendee_with_origin
        falls back to the live product when no snapshot matches the new
        (payment_id, product_id) pair, so the UI still reflects the new product.

        Steps:
          1. Resolve the ticket and assert it belongs to *attendee_id* (404).
          2. No-op when the product is unchanged.
          3. Resolve the new product (404 if missing/deleted) and reject
             cross-popup swaps (422).
          4. Atomic stock decrement of the new product (409 if sold out) then
             restore one unit of the old product. The check_in_code is preserved
             so the ticket keeps its QR identity.
        """
        from app.api.product.crud import products_crud

        ticket = session.get(AttendeeProducts, ticket_id)
        if ticket is None or ticket.attendee_id != attendee_id:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Ticket not found",
            )

        old_product_id = ticket.product_id
        if old_product_id == new_product_id:
            return ticket

        attendee = session.get(Attendees, attendee_id)
        if attendee is None:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Attendee not found",
            )

        new_product = products_crud.get(session, new_product_id)
        if new_product is None:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Product not found",
            )
        if new_product.popup_id != attendee.popup_id:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail="Product belongs to a different popup",
            )
        _require_ticket_product(new_product)

        # Decrement the new product first so a sold-out 409 aborts before any
        # mutation. Restore the old product only once the new one is secured.
        products_crud.decrement_total_stock(session, new_product_id, 1)
        products_crud.restore_total_stock(session, old_product_id, 1)

        ticket.product_id = new_product_id
        ticket.product_category_snapshot = new_product.category
        ticket.requires_check_in_snapshot = new_product.requires_check_in
        session.add(ticket)

        if actor is not None:
            from app.api.product.models import Products

            old_product = session.get(Products, old_product_id)
            self._record_ticket_event(
                session,
                attendee=attendee,
                actor=actor,
                action=AuditAction.TICKET_SWAP,
                details={
                    "ticket_id": str(ticket.id),
                    "old_product_id": str(old_product_id),
                    "old_product_name": old_product.name if old_product else None,
                    "new_product_id": str(new_product_id),
                    "new_product_name": new_product.name,
                },
            )

        session.commit()
        session.refresh(ticket)
        return ticket

    def update_ticket_metadata(
        self,
        session: Session,
        attendee_id: uuid.UUID,
        ticket_id: uuid.UUID,
        choices: "AttendeeTicketMetadataUpdate",
    ) -> AttendeeProducts:
        """Edit a meal-plan ticket's choices in place (portal, no payment).

        Mutates only the ticket-layer ``purchase_metadata`` blob — the three
        choice keys (daily_choices, dietary_restriction, special_request). It
        does NOT touch stock, payments, or the payment_products financial
        snapshot: the receipt records what was bought and is allowed to diverge
        from the current (editable) choices.

        Steps:
          1. Resolve the ticket; 404 if missing or not owned by *attendee_id*.
          2. Resolve its product; 404 if missing.
          3. Lock: if the week's sale has ended (derive_product_state == ended)
             reject with 409 ``meal_plan_week_locked``. ``sale_ends_at = None``
             → on_sale → editable (documented decision).
          4. Resolve the meal-plan config for the product; 422
             ``not_meal_plan_ticket`` when the product is not a meal-plan week.
          5. Validate daily_choices against coverage + menu keys (422).
          6. Merge-replace the three keys and persist (flag_modified for JSONB).
        """
        from sqlalchemy.orm.attributes import flag_modified

        from app.api.product.models import Products
        from app.api.product.product_state import (
            ProductSaleState,
            derive_product_state,
        )
        from app.api.ticketing_step.meal_plan import (
            resolve_meal_plan_product_config,
            validate_daily_choices,
        )

        ticket = session.get(AttendeeProducts, ticket_id)
        if ticket is None or ticket.attendee_id != attendee_id:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Ticket not found",
            )

        product = session.get(Products, ticket.product_id)
        if product is None:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Product not found",
            )

        # Week lock: a meal-plan week whose sale window has ended is read-only
        # (the kitchen closed orders). Stock-based sold_out does not lock edits.
        if derive_product_state(product) is ProductSaleState.ended:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail={
                    "code": "meal_plan_week_locked",
                    "message": "This meal-plan week is closed for edits.",
                },
            )

        resolved = resolve_meal_plan_product_config(
            session, product.popup_id, product.id
        )
        if resolved is None:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail={
                    "code": "not_meal_plan_ticket",
                    "message": "This ticket is not an editable meal-plan week.",
                },
            )
        section_product, chef = resolved

        validate_daily_choices(choices.daily_choices, section_product, chef)

        md = dict(ticket.purchase_metadata or {})
        md["daily_choices"] = choices.daily_choices
        md["dietary_restriction"] = choices.dietary_restriction
        md["special_request"] = choices.special_request
        ticket.purchase_metadata = md
        flag_modified(ticket, "purchase_metadata")
        session.add(ticket)
        session.commit()
        session.refresh(ticket)
        return ticket

    def remove_product(
        self,
        session: Session,
        attendee_id: uuid.UUID,
        ticket_id: uuid.UUID,
        actor: AuditActor | None = None,
    ) -> None:
        """Revoke one paymentless unit and restore its stock exactly once."""
        from app.api.product.crud import products_crud
        from app.api.product.models import Products

        ticket = session.exec(
            select(AttendeeProducts)
            .where(AttendeeProducts.id == ticket_id)
            .with_for_update()
            .execution_options(populate_existing=True)
        ).first()
        if ticket is None or ticket.attendee_id != attendee_id:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Ticket not found",
            )
        if ticket.payment_id is not None:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="Paid product units can only be revoked by cancelling their payment",
            )

        if ticket.revoked_at is not None:
            session.commit()
            return

        products_crud.restore_total_stock(session, ticket.product_id, 1)
        ticket.revoked_at = datetime.now(UTC)
        session.add(ticket)

        if actor is not None:
            attendee = session.get(Attendees, attendee_id)
            product = session.get(Products, ticket.product_id)
            if attendee is not None:
                self._record_ticket_event(
                    session,
                    attendee=attendee,
                    actor=actor,
                    action=AuditAction.TICKET_REMOVE,
                    details={
                        "ticket_id": str(ticket.id),
                        "product_id": str(ticket.product_id),
                        "product_name": product.name if product else None,
                    },
                )

        session.commit()

    def clear_products(
        self,
        session: Session,
        attendee_id: uuid.UUID,
    ) -> None:
        """Remove all products from an attendee."""
        statement = select(AttendeeProducts).where(
            AttendeeProducts.attendee_id == attendee_id
        )
        products = session.exec(statement).all()
        for ap in products:
            session.delete(ap)
        session.commit()

    def find_unsent_checkin_pass_tickets(
        self,
        session: Session,
        popup_id: uuid.UUID,
        *,
        sales_flow_id: uuid.UUID | None = None,
        include_flowless: bool = False,
    ) -> list[AttendeeProducts]:
        """Return scannable tickets in *popup_id* that have not been emailed yet.

        Filters AttendeeProducts joined with Attendees and Products by:
        - ``Attendees.popup_id == popup_id``
        - ``Products.requires_check_in IS TRUE``
        - ``AttendeeProducts.checkin_pass_sent_at IS NULL``

        ``sales_flow_id`` narrows to the door a ticket was bought through, so
        each flow can send on its own schedule. ``include_flowless`` adds
        tickets on attendees with no application at all — direct purchases,
        which name no door — and is meant for the popup's default flow, the
        same absorption rule `reminder_dispatch._scoped_to_flow` applies.

        Eager-loads ``attendee → application → human`` and ``product`` so the
        check-in pass dispatcher can build per-ticket QR items and resolve the
        buyer (application owner) without N+1 queries. ``Attendees.human`` is
        already ``lazy="selectin"`` on the model so the direct-sale fallback
        path is also covered.
        """
        from app.api.application.models import Applications
        from app.api.product.models import Products

        statement = (
            select(AttendeeProducts)
            .join(Attendees, AttendeeProducts.attendee_id == Attendees.id)  # type: ignore[arg-type]
            .join(Products, AttendeeProducts.product_id == Products.id)  # type: ignore[arg-type]
            .outerjoin(Applications, Attendees.application_id == Applications.id)  # type: ignore[arg-type]
            .where(
                Attendees.popup_id == popup_id,
                AttendeeProducts.revoked_at.is_(None),
                AttendeeProducts.product_category_snapshot == "ticket",
                Products.requires_check_in.is_(True),
                AttendeeProducts.checkin_pass_sent_at.is_(None),  # type: ignore[union-attr]
            )
            .options(
                selectinload(AttendeeProducts.product),  # type: ignore[arg-type]
                selectinload(AttendeeProducts.attendee)  # type: ignore[arg-type]
                .selectinload(Attendees.application)  # ty: ignore[invalid-argument-type]
                .selectinload(Applications.human),  # ty: ignore[invalid-argument-type]
            )
        )
        if sales_flow_id is not None:
            scope = Applications.sales_flow_id == sales_flow_id
            if include_flowless:
                scope = or_(scope, Attendees.application_id.is_(None))  # type: ignore[union-attr]
            statement = statement.where(scope)
        return list(session.exec(statement).all())

    def mark_checkin_pass_sent(
        self,
        session: Session,
        tickets: list[AttendeeProducts],
        sent_at: datetime,
    ) -> None:
        """Stamp ``checkin_pass_sent_at`` on each ticket and commit.

        Called after a successful send so repeated cron runs don't re-email the
        same ticket. Caller controls failure isolation: if the send fails the
        tickets should not be passed in.
        """
        for ticket in tickets:
            ticket.checkin_pass_sent_at = sent_at
            session.add(ticket)
        session.commit()


attendees_crud = AttendeesCRUD()
