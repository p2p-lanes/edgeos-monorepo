import uuid

from loguru import logger
from sqlalchemy import exists, or_
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import selectinload
from sqlmodel import Session, col, func, select

from app.api.human.models import Humans
from app.api.human.schemas import (
    HumanCreate,
    HumanProfileStats,
    HumanProfileStatsPopup,
    HumanUpdate,
)
from app.api.product.schemas import CATEGORY_TICKET, TicketDuration
from app.api.shared.crud import BaseCRUD


class HumansCRUD(BaseCRUD[Humans, HumanCreate, HumanUpdate]):
    def __init__(self) -> None:
        super().__init__(Humans)

    def find_or_create(
        self,
        session: Session,
        email: str,
        tenant_id: uuid.UUID,
        *,
        default_first_name: str | None = None,
        default_last_name: str | None = None,
    ) -> Humans:
        """Return the existing Human for (email, tenant_id) or create one.

        NEVER overwrites fields on an existing row. Uses INSERT ... ON CONFLICT
        DO NOTHING pattern to handle concurrent callers safely — the unique
        constraint uq_human_email_tenant_id guarantees exactly one row.
        If the session does not support advisory INSERT/IGNORE, falls back to
        catching IntegrityError then SELECTing the existing row.
        """
        # Fast path: try to find existing row first (most callers hit this)
        existing = session.exec(
            select(Humans).where(
                Humans.email == email,
                Humans.tenant_id == tenant_id,
            )
        ).first()
        if existing is not None:
            return existing

        # Slow path: attempt INSERT; catch race on unique constraint
        new_human = Humans(
            id=uuid.uuid4(),
            email=email,
            tenant_id=tenant_id,
            first_name=default_first_name,
            last_name=default_last_name,
        )
        try:
            session.add(new_human)
            session.flush()
            session.refresh(new_human)
            session.commit()
            return new_human
        except IntegrityError:
            # Another concurrent caller won the race — roll back and fetch
            session.rollback()
            logger.info(
                "find_or_create: IntegrityError race on ({}, {}) — fetching existing row",
                email,
                tenant_id,
            )
            existing = session.exec(
                select(Humans).where(
                    Humans.email == email,
                    Humans.tenant_id == tenant_id,
                )
            ).first()
            if existing is None:
                raise RuntimeError(
                    f"find_or_create: could not find or create Human for ({email}, {tenant_id})"
                ) from None
            return existing

    def get_or_create_by_email(
        self,
        session: Session,
        email: str,
        tenant_id: uuid.UUID,
        *,
        default_first_name: str | None = None,
        default_last_name: str | None = None,
    ) -> Humans:
        """Flush-only variant of `find_or_create` for atomic admin batch flows.

        Identical lookup/insert semantics — NEVER overwrites existing fields —
        but does NOT commit, so the caller owns the transaction boundary
        (admin bulk grant rolls the entire batch back on any error).
        """
        existing = session.exec(
            select(Humans).where(
                Humans.email == email,
                Humans.tenant_id == tenant_id,
            )
        ).first()
        if existing is not None:
            return existing

        new_human = Humans(
            id=uuid.uuid4(),
            email=email,
            tenant_id=tenant_id,
            first_name=default_first_name,
            last_name=default_last_name,
        )
        # SAVEPOINT so a concurrent unique-constraint race can be recovered
        # from without poisoning the outer transaction (which holds prior
        # Humans/Applications writes from the same batch).
        nested = session.begin_nested()
        try:
            session.add(new_human)
            session.flush()
            nested.commit()
        except IntegrityError:
            nested.rollback()
            logger.info(
                "get_or_create_by_email: IntegrityError race on ({}, {}) — fetching winner",
                email,
                tenant_id,
            )
            existing = session.exec(
                select(Humans).where(
                    Humans.email == email,
                    Humans.tenant_id == tenant_id,
                )
            ).first()
            if existing is None:
                raise
            return existing
        return new_human

    def get_by_email(
        self, session: Session, email: str, tenant_id: uuid.UUID | None = None
    ) -> Humans | None:
        statement = select(Humans).where(Humans.email == email)
        if tenant_id:
            statement = statement.where(Humans.tenant_id == tenant_id)
        return session.exec(statement).first()

    def create_internal(
        self, session: Session, human_data: HumanCreate, tenant_id: uuid.UUID
    ) -> Humans:
        """Create a human with explicit tenant_id (for admin-created humans)."""
        db_obj = Humans(**human_data.model_dump(), tenant_id=tenant_id)
        session.add(db_obj)
        session.commit()
        session.refresh(db_obj)
        return db_obj

    def find_with_incomplete_application(
        self,
        session: Session,
        *,
        skip: int = 0,
        limit: int = 100,
        search: str | None = None,
        popup_id: uuid.UUID | None = None,
    ) -> tuple[list[Humans], int]:
        """Find humans with at least one draft application.

        If popup_id is provided, only draft applications for that popup are considered.
        """
        from app.api.application.models import Applications

        has_draft_application = exists().where(
            Applications.human_id == Humans.id,
            Applications.status == "draft",
        )

        if popup_id:
            has_draft_application = has_draft_application.where(
                Applications.popup_id == popup_id
            )

        statement = select(Humans).where(has_draft_application)

        if search:
            search_term = f"%{search}%"
            statement = statement.where(
                or_(
                    col(Humans.first_name).ilike(search_term),
                    col(Humans.last_name).ilike(search_term),
                    col(Humans.email).ilike(search_term),
                )
            )

        count_statement = select(func.count()).select_from(statement.subquery())
        total = session.exec(count_statement).one()

        results = list(session.exec(statement.offset(skip).limit(limit)).all())
        return results, total

    def get_profile_stats(
        self, session: Session, human_id: uuid.UUID
    ) -> HumanProfileStats:
        """Aggregate popups history + total_days for a human's profile page.

        A popup counts as "attended" when the human is either the application
        owner (Applications.human_id) or a direct-sale attendee
        (Attendees.human_id with no application). Per-popup days are derived
        from purchased tickets (AttendeeProducts.payment_id IS NOT NULL) on
        the main attendee — FULL tickets snap to the popup duration, MONTH
        adds 30, WEEK adds 7, DAY counts each row as 1, all capped at popup
        duration when known.
        """
        from app.api.application.models import Applications
        from app.api.attendee.models import AttendeeProducts, Attendees
        from app.api.popup.models import Popups

        main_attendees = list(
            session.exec(
                select(Attendees)
                .join(Applications, Attendees.application_id == Applications.id)  # type: ignore[arg-type]
                .where(Applications.human_id == human_id)
                .options(
                    selectinload(Attendees.popup),  # type: ignore[arg-type]
                    selectinload(Attendees.attendee_products).selectinload(  # type: ignore[arg-type]
                        AttendeeProducts.product  # ty: ignore[invalid-argument-type]
                    ),
                )
            ).all()
        )

        direct_attendees = list(
            session.exec(
                select(Attendees)
                .where(
                    Attendees.human_id == human_id,
                    Attendees.application_id.is_(None),  # type: ignore[union-attr]
                )
                .options(
                    selectinload(Attendees.popup),  # type: ignore[arg-type]
                    selectinload(Attendees.attendee_products).selectinload(  # type: ignore[arg-type]
                        AttendeeProducts.product  # ty: ignore[invalid-argument-type]
                    ),
                )
            ).all()
        )

        per_popup: dict[uuid.UUID, HumanProfileStatsPopup] = {}
        for attendee in [*main_attendees, *direct_attendees]:
            popup: Popups | None = attendee.popup
            if popup is None:
                continue
            popup_days = _popup_duration_days(popup)
            days = _days_for_attendee(attendee, popup_days)
            existing = per_popup.get(popup.id)
            if existing is None or days > existing.total_days:
                per_popup[popup.id] = HumanProfileStatsPopup(
                    popup_id=popup.id,
                    popup_name=popup.name,
                    start_date=popup.start_date,
                    end_date=popup.end_date,
                    location=popup.location,
                    image_url=popup.image_url,
                    total_days=days,
                )

        popups = list(per_popup.values())
        total_days = sum(p.total_days for p in popups)
        return HumanProfileStats(popups=popups, total_days=total_days)


def _popup_duration_days(popup) -> int | None:  # noqa: ANN001
    if popup.start_date is None or popup.end_date is None:
        return None
    delta = popup.end_date - popup.start_date
    return max(delta.days + 1, 0)


def _days_for_attendee(attendee, popup_days: int | None) -> int:  # noqa: ANN001
    """Sum days from purchased tickets, capped at popup duration when known."""
    total = 0
    has_full = False
    for ap in attendee.attendee_products:
        if ap.payment_id is None:
            continue
        product = ap.product
        if product is None or product.category != CATEGORY_TICKET:
            continue
        duration = product.duration_type
        if duration == TicketDuration.FULL:
            has_full = True
            break
        if duration == TicketDuration.MONTH:
            total += 30
        elif duration == TicketDuration.WEEK:
            total += 7
        elif duration == TicketDuration.DAY:
            total += 1
    if has_full and popup_days is not None:
        return popup_days
    if popup_days is not None:
        return min(total, popup_days)
    return total


humans_crud = HumansCRUD()
