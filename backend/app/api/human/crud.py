import uuid
from typing import TypedDict

from loguru import logger
from sqlalchemy import delete, exists, or_, update
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


class HardDeleteSummary(TypedDict):
    applications: int
    attendees: int
    payments: int
    attendee_products: int
    payment_products: int
    payment_installments: int
    application_snapshots: int
    carts: int
    group_memberships: int
    ambassador_groups: int


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
        """Create a human with explicit tenant_id (for admin-created humans).

        After committing the new human row, runs the whitelist resolution hook
        best-effort (Design Decision 1g): looks up group_whitelisted_emails
        matching the new human's email and inserts group_members rows.
        Any failure in the hook is logged and swallowed — signup always succeeds.
        """
        db_obj = Humans(**human_data.model_dump(), tenant_id=tenant_id)
        session.add(db_obj)
        session.commit()
        session.refresh(db_obj)

        # Best-effort whitelist resolution — never blocks signup
        try:
            resolve_whitelist_memberships(session, db_obj)
        except Exception:
            logger.exception(
                "Whitelist resolution failed for human {} — signup continues",
                db_obj.id,
            )

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

    def hard_delete_cascade(
        self, session: Session, human_id: uuid.UUID
    ) -> HardDeleteSummary:
        """Permanently delete a Human and every row reachable from them.

        Runs as a single transaction. Iterates from leaves up to roots so each
        DELETE leaves no dangling RESTRICT FKs. Ambassador-owned groups are
        deleted along with the human; foreign references from other humans'
        applications/payments to those groups are nulled (group_id is
        nullable).
        """
        from app.api.application.models import Applications, ApplicationSnapshots
        from app.api.attendee.models import AttendeeProducts, Attendees
        from app.api.cart.models import Carts
        from app.api.group.models import (
            GroupLeaders,
            GroupMembers,
            GroupProducts,
            Groups,
            GroupWhitelistedEmails,
        )
        from app.api.payment.models import (
            PaymentInstallments,
            PaymentProducts,
            Payments,
        )

        application_ids = list(
            session.exec(
                select(Applications.id).where(Applications.human_id == human_id)
            ).all()
        )
        attendee_conds = [Attendees.human_id == human_id]
        if application_ids:
            attendee_conds.append(col(Attendees.application_id).in_(application_ids))
        attendee_ids = list(
            session.exec(select(Attendees.id).where(or_(*attendee_conds))).all()
        )
        payment_ids = (
            list(
                session.exec(
                    select(Payments.id).where(
                        col(Payments.application_id).in_(application_ids)
                    )
                ).all()
            )
            if application_ids
            else []
        )
        ambassador_group_ids = list(
            session.exec(
                select(Groups.id).where(Groups.ambassador_id == human_id)
            ).all()
        )

        summary: HardDeleteSummary = {
            "applications": len(application_ids),
            "attendees": len(attendee_ids),
            "payments": len(payment_ids),
            "attendee_products": 0,
            "payment_products": 0,
            "payment_installments": 0,
            "application_snapshots": 0,
            "carts": 0,
            "group_memberships": 0,
            "ambassador_groups": len(ambassador_group_ids),
        }

        try:
            if attendee_ids or payment_ids:
                conds = []
                if attendee_ids:
                    conds.append(col(AttendeeProducts.attendee_id).in_(attendee_ids))
                if payment_ids:
                    conds.append(col(AttendeeProducts.payment_id).in_(payment_ids))
                result = session.execute(delete(AttendeeProducts).where(or_(*conds)))
                summary["attendee_products"] = result.rowcount or 0

            if payment_ids or attendee_ids:
                conds = []
                if payment_ids:
                    conds.append(col(PaymentProducts.payment_id).in_(payment_ids))
                if attendee_ids:
                    conds.append(col(PaymentProducts.attendee_id).in_(attendee_ids))
                result = session.execute(delete(PaymentProducts).where(or_(*conds)))
                summary["payment_products"] = result.rowcount or 0

            if payment_ids:
                result = session.execute(
                    delete(PaymentInstallments).where(
                        col(PaymentInstallments.payment_id).in_(payment_ids)
                    )
                )
                summary["payment_installments"] = result.rowcount or 0

            # check_ins.attendee_product_id has ON DELETE CASCADE in the DB,
            # so they are removed automatically when attendee_products go away.

            if payment_ids:
                session.execute(
                    delete(Payments).where(col(Payments.id).in_(payment_ids))
                )

            if attendee_ids:
                session.execute(
                    delete(Attendees).where(col(Attendees.id).in_(attendee_ids))
                )

            if application_ids:
                result = session.execute(
                    delete(ApplicationSnapshots).where(
                        col(ApplicationSnapshots.application_id).in_(application_ids)
                    )
                )
                summary["application_snapshots"] = result.rowcount or 0
                # application_reviews cascades via ON DELETE CASCADE
                session.execute(
                    delete(Applications).where(
                        col(Applications.id).in_(application_ids)
                    )
                )

            gm_result = session.execute(
                delete(GroupMembers).where(GroupMembers.human_id == human_id)
            )
            gl_result = session.execute(
                delete(GroupLeaders).where(GroupLeaders.human_id == human_id)
            )
            summary["group_memberships"] = (gm_result.rowcount or 0) + (
                gl_result.rowcount or 0
            )

            if ambassador_group_ids:
                # Null group_id on rows owned by other humans before dropping
                # the groups (groups.id is RESTRICT-referenced by applications
                # and payments via nullable group_id columns).
                session.execute(
                    update(Applications)
                    .where(col(Applications.group_id).in_(ambassador_group_ids))
                    .values(group_id=None)
                )
                session.execute(
                    update(Payments)
                    .where(col(Payments.group_id).in_(ambassador_group_ids))
                    .values(group_id=None)
                )
                session.execute(
                    delete(GroupMembers).where(
                        col(GroupMembers.group_id).in_(ambassador_group_ids)
                    )
                )
                session.execute(
                    delete(GroupLeaders).where(
                        col(GroupLeaders.group_id).in_(ambassador_group_ids)
                    )
                )
                session.execute(
                    delete(GroupProducts).where(
                        col(GroupProducts.group_id).in_(ambassador_group_ids)
                    )
                )
                session.execute(
                    delete(GroupWhitelistedEmails).where(
                        col(GroupWhitelistedEmails.group_id).in_(ambassador_group_ids)
                    )
                )
                session.execute(
                    delete(Groups).where(col(Groups.id).in_(ambassador_group_ids))
                )

            result = session.execute(delete(Carts).where(Carts.human_id == human_id))
            summary["carts"] = result.rowcount or 0

            # api_keys, event_invitations, event_hidden_by_human cascade via DB
            session.execute(delete(Humans).where(Humans.id == human_id))
            session.commit()
        except Exception:
            session.rollback()
            raise

        logger.info("hard_delete_cascade: human {} purged — {}", human_id, summary)
        return summary


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


def resolve_whitelist_memberships(session: Session, human: Humans) -> None:
    """Add a newly created human to all groups that whitelisted their email.

    Best-effort — caller must wrap in try/except and never let exceptions
    propagate to the HTTP layer.  Idempotent: INSERT ... ON CONFLICT DO NOTHING
    semantics via a check-before-insert guard so re-running is a no-op.

    Design Decision 1g:
    - Lookup group_whitelisted_emails case-insensitively by human.email
    - For each matching group, insert into group_members if not already present
      and the group is below its max_members cap.
    - Never touches applications — M:N membership only
    """
    from sqlalchemy import func
    from sqlmodel import select as _select

    from app.api.group.models import GroupMembers, Groups, GroupWhitelistedEmails

    email_lower = human.email.lower()

    matching_wl_rows = session.exec(
        _select(GroupWhitelistedEmails).where(
            func.lower(GroupWhitelistedEmails.email) == email_lower
        )
    ).all()

    added = False
    for wl in matching_wl_rows:
        # Idempotency: skip if already a member
        existing = session.exec(
            _select(GroupMembers).where(
                GroupMembers.group_id == wl.group_id,
                GroupMembers.human_id == human.id,
            )
        ).first()
        if existing:
            continue

        # Cap check: skip if the group is already full
        group = session.exec(_select(Groups).where(Groups.id == wl.group_id)).first()
        if group is not None and group.max_members is not None:
            current_count = session.exec(
                _select(func.count(GroupMembers.human_id)).where(
                    GroupMembers.group_id == wl.group_id
                )
            ).one()
            if current_count >= group.max_members:
                continue

        member_row = GroupMembers(
            tenant_id=wl.tenant_id,
            group_id=wl.group_id,
            human_id=human.id,
        )
        session.add(member_row)
        added = True

    if added:
        session.commit()
