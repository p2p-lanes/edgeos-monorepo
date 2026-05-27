import random
import string
import uuid
from typing import Any

from fastapi import HTTPException, status
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import selectinload
from sqlmodel import Session, func, select

from app.api.attendee.models import AttendeeProducts, Attendees
from app.api.attendee.schemas import AttendeeCreate, AttendeeUpdate
from app.api.shared.crud import BaseCRUD


def generate_check_in_code(prefix: str = "") -> str:
    """Generate a unique check-in code with optional prefix.

    Produces a prefix + 8 random uppercase letters. The 8-letter random part
    gives ~208 billion combinations (26^8), reducing collision probability
    during bulk migration explosion of quantity>1 rows.
    """
    code = "".join(random.choices(string.ascii_uppercase, k=8))
    return f"{prefix}{code}"


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
            .where(AttendeeProducts.check_in_code == code)
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
        category: str | None = None,
        email: str | None = None,
        gender: str | None = None,
        human_id: uuid.UUID | None = None,
        category_id: uuid.UUID | None = None,
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
        )
        session.add(attendee)
        session.commit()
        session.refresh(attendee)
        return attendee

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

        category_id is looked up from the popup's primary (main) category.
        Check-in codes live on AttendeeProducts (one per purchased ticket).
        """
        from app.api.attendee_category.crud import attendee_categories_crud

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
        session.commit()
        session.refresh(attendee)
        return attendee

    def find_or_create_direct_attendee(
        self,
        session: Session,
        human_id: uuid.UUID,
        popup_id: uuid.UUID,
        tenant_id: uuid.UUID,
        name: str,
        email: str | None = None,
    ) -> Attendees:
        """Find or create the single direct-sale attendee for a (human, popup) pair.

        Implements SELECT → INSERT → IntegrityError → re-SELECT so concurrent
        purchases by the same human for the same popup converge on one row.
        Does NOT call session.commit() — callers control the transaction boundary.

        One attendee is shared across all direct purchases by the same human for
        the same popup. Tickets are tracked via AttendeeProducts rows.
        """
        existing = self.find_direct_attendee(session, human_id, popup_id)
        if existing:
            return existing

        from app.api.attendee_category.crud import attendee_categories_crud

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
            existing = self.find_direct_attendee(session, human_id, popup_id)
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
            )
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
                selectinload(Attendees.payment_products),  # type: ignore[arg-type]
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
        tenant_id: uuid.UUID | None = None,
        payment_id: uuid.UUID | None = None,
        check_in_code_prefix: str = "",
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
        )
        session.add(ticket)
        session.commit()
        session.refresh(ticket)
        return ticket

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
