import random
import string
import uuid

from fastapi import HTTPException, status
from sqlalchemy.orm import selectinload
from sqlmodel import Session, func, select

from app.api.attendee.models import AttendeeProducts, Attendees
from app.api.attendee.schemas import AttendeeCreate, AttendeeUpdate
from app.api.shared.crud import BaseCRUD


def generate_check_in_code(prefix: str = "") -> str:
    """Generate a unique check-in code with optional prefix."""
    code = "".join(random.choices(string.ascii_uppercase, k=4))
    return f"{prefix}{code}"


class AttendeesCRUD(BaseCRUD[Attendees, AttendeeCreate, AttendeeUpdate]):
    """CRUD operations for Attendees."""

    def __init__(self) -> None:
        super().__init__(Attendees)

    def get_by_check_in_code(self, session: Session, code: str) -> Attendees | None:
        """Get an attendee by check-in code."""
        statement = select(Attendees).where(Attendees.check_in_code == code)
        return session.exec(statement).first()

    def find_by_application(
        self,
        session: Session,
        application_id: uuid.UUID,
    ) -> list[Attendees]:
        """Get all attendees for an application."""
        statement = select(Attendees).where(Attendees.application_id == application_id)
        return list(session.exec(statement).all())

    def find_by_email(
        self,
        session: Session,
        email: str,
        skip: int = 0,
        limit: int = 100,
    ) -> tuple[list[Attendees], int]:
        """Find attendees by email."""
        statement = select(Attendees).where(Attendees.email == email.lower())

        count_statement = select(func.count()).select_from(statement.subquery())
        total = session.exec(count_statement).one()

        statement = statement.offset(skip).limit(limit)
        results = list(session.exec(statement).all())

        return results, total

    def find_by_popup(
        self,
        session: Session,
        popup_id: uuid.UUID,
        skip: int = 0,
        limit: int = 100,
        search: str | None = None,
    ) -> tuple[list[Attendees], int]:
        """Find attendees by popup_id with eager loading.

        Queries directly on Attendees.popup_id (denormalized). Covers both
        application-based attendees (popup_id backfilled from application)
        and direct-sale attendees (popup_id set at creation, no application).
        """
        base_statement = select(Attendees).where(Attendees.popup_id == popup_id)

        if search:
            search_term = f"%{search}%"
            base_statement = base_statement.where(
                Attendees.name.ilike(search_term) | Attendees.email.ilike(search_term)  # type: ignore[union-attr]
            )

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
        category: str,
        check_in_code: str,
        email: str | None = None,
        gender: str | None = None,
        human_id: uuid.UUID | None = None,
    ) -> Attendees:
        """Create an attendee with internal fields.

        If email is provided and human_id is not, attempts to find an existing
        Human with matching email+tenant_id and links them.

        popup_id is REQUIRED — it's a NOT NULL column on attendees. Callers
        that work with an application should pass application.popup_id.
        """
        # If email provided but no human_id, try to find matching Human
        if email and not human_id:
            human_id = self._find_human_id_by_email(session, email, tenant_id)

        attendee = Attendees(
            tenant_id=tenant_id,
            application_id=application_id,
            popup_id=popup_id,
            name=name,
            category=category,
            check_in_code=check_in_code,
            email=email,
            gender=gender,
            human_id=human_id,
        )
        session.add(attendee)
        session.commit()
        session.refresh(attendee)
        return attendee

    def find_direct_attendee(
        self,
        session: Session,
        human_id: uuid.UUID,
        popup_id: uuid.UUID,
    ) -> Attendees | None:
        """Find the direct-sale attendee for a (human, popup) pair.

        Direct-sale attendees have application_id=NULL. Returns the existing
        attendee so repeated direct purchases by the same human reuse the
        same record (one attendee per human per popup for direct sales).
        """
        statement = (
            select(Attendees)
            .where(
                Attendees.human_id == human_id,
                Attendees.popup_id == popup_id,
                Attendees.application_id.is_(None),  # type: ignore[union-attr]
            )
            .limit(1)
        )
        return session.exec(statement).first()

    def create_direct_attendee(
        self,
        session: Session,
        human_id: uuid.UUID,
        popup_id: uuid.UUID,
        tenant_id: uuid.UUID,
        name: str,
        email: str | None = None,
    ) -> Attendees:
        """Create a direct-sale attendee (no application).

        Used for popups with sale_type="direct". The attendee is bound to a
        Human and a Popup directly — application_id remains NULL.
        """
        prefix = ""
        # Short prefix from popup slug if available
        from app.api.popup.models import Popups

        popup = session.get(Popups, popup_id)
        if popup and popup.slug:
            prefix = popup.slug[:3].upper()
        check_in_code = generate_check_in_code(prefix)

        attendee = Attendees(
            tenant_id=tenant_id,
            application_id=None,
            popup_id=popup_id,
            human_id=human_id,
            name=name,
            category="main",
            check_in_code=check_in_code,
            email=email.lower() if email else None,
        )
        session.add(attendee)
        session.commit()
        session.refresh(attendee)
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
            .options(selectinload(Attendees.application))  # type: ignore[arg-type]
            .limit(1)
        )
        return session.exec(statement).first()

    def _human_popup_attendee_ids(
        self,
        session: Session,
        human_id: uuid.UUID,
        popup_id: uuid.UUID,
    ):
        """Return a subquery of Attendee IDs owned by (human_id, popup_id).

        Uses a UNION of two ownership legs:
        1. Application-linked leg: attendees whose Application.human_id == human_id
           AND Application.popup_id == popup_id.
        2. Direct-sale leg: attendees with human_id == human_id AND popup_id == popup_id
           AND application_id IS NULL.

        Shared by find_purchases_by_human_popup and find_by_human_popup so both
        functions use the same dual-path ownership predicate.
        """
        from app.api.application.models import Applications

        app_leg = (
            select(Attendees.id)
            .join(Applications, Attendees.application_id == Applications.id)  # type: ignore[arg-type]
            .where(
                Applications.human_id == human_id,
                Applications.popup_id == popup_id,
            )
        )

        direct_leg = select(Attendees.id).where(
            Attendees.human_id == human_id,
            Attendees.popup_id == popup_id,
            Attendees.application_id.is_(None),  # type: ignore[union-attr]
        )

        return app_leg.union(direct_leg).subquery()

    def find_by_human_popup(
        self,
        session: Session,
        human_id: uuid.UUID,
        popup_id: uuid.UUID,
        skip: int = 0,
        limit: int = 50,
    ) -> tuple[list[Attendees], int]:
        """Return ALL attendees owned by (human_id, popup_id), both legs.

        Uses the UNION subquery from _human_popup_attendee_ids so the same
        dual-path ownership predicate is applied consistently with
        find_purchases_by_human_popup. Eager-loads attendee_products → product
        so callers can build AttendeeWithOriginPublic without extra queries.

        Returns (rows, total_count) for paginated response building.
        """
        union_ids = self._human_popup_attendee_ids(session, human_id, popup_id)

        count_statement = select(func.count()).where(
            Attendees.id.in_(select(union_ids.c.id))  # type: ignore[arg-type]
        )
        total = session.exec(count_statement).one()

        statement = (
            select(Attendees)
            .where(Attendees.id.in_(select(union_ids.c.id)))  # type: ignore[arg-type]
            .options(
                selectinload(Attendees.attendee_products).selectinload(  # type: ignore[arg-type]
                    AttendeeProducts.product  # ty: ignore[invalid-argument-type]
                ),
            )
            .offset(skip)
            .limit(limit)
        )
        results = list(session.exec(statement).all())
        return results, total

    def find_purchases_by_human_popup(
        self,
        session: Session,
        human_id: uuid.UUID,
        popup_id: uuid.UUID,
    ) -> list[Attendees]:
        """Find attendees with purchased products for a human+popup combination.

        Includes both application-linked attendees (via Applications.human_id) and
        direct-sale attendees (application_id IS NULL, keyed by human_id + popup_id).
        Uses a UNION subquery so both legs are covered without duplicates.
        """
        union_ids = self._human_popup_attendee_ids(session, human_id, popup_id)

        statement = (
            select(Attendees)
            .where(Attendees.id.in_(select(union_ids.c.id)))  # type: ignore[arg-type]
            .options(
                selectinload(Attendees.attendee_products).selectinload(  # type: ignore[arg-type]
                    AttendeeProducts.product  # ty: ignore[invalid-argument-type]
                ),
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
        quantity: int = 1,
    ) -> AttendeeProducts:
        """Add a product to an attendee."""
        # Check if already exists
        statement = select(AttendeeProducts).where(
            AttendeeProducts.attendee_id == attendee_id,
            AttendeeProducts.product_id == product_id,
        )
        existing = session.exec(statement).first()

        if existing:
            existing.quantity += quantity
            session.add(existing)
        else:
            existing = AttendeeProducts(
                attendee_id=attendee_id,
                product_id=product_id,
                quantity=quantity,
            )
            session.add(existing)

        session.commit()
        session.refresh(existing)
        return existing

    def remove_product(
        self,
        session: Session,
        attendee_id: uuid.UUID,
        product_id: uuid.UUID,
    ) -> None:
        """Remove a product from an attendee."""
        statement = select(AttendeeProducts).where(
            AttendeeProducts.attendee_id == attendee_id,
            AttendeeProducts.product_id == product_id,
        )
        ap = session.exec(statement).first()
        if ap:
            session.delete(ap)
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


attendees_crud = AttendeesCRUD()
