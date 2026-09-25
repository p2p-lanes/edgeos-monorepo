import uuid
from datetime import datetime

from sqlmodel import Session, col, func, select

from app.api.event_participant.models import EventParticipants
from app.api.event_participant.schemas import (
    EventParticipantCreate,
    EventParticipantUpdate,
    ParticipantStatus,
    RsvpEligibility,
)
from app.api.shared.crud import BaseCRUD


class EventParticipantsCRUD(
    BaseCRUD[EventParticipants, EventParticipantCreate, EventParticipantUpdate]
):
    """CRUD operations for EventParticipants."""

    def __init__(self) -> None:
        super().__init__(EventParticipants)

    def eligibility_by_human(
        self, session: Session, popup_id: uuid.UUID, human_ids: set[uuid.UUID]
    ) -> dict[uuid.UUID, RsvpEligibility]:
        """Live RSVP access: an allocated ticket and no rejected main application.

        Auxiliary application flows (volunteers, artists, etc.) do not decide
        participation in the gathering. Two batched queries serve both a single
        RSVP and an entire notification audience.
        """
        from app.api.application.models import Applications
        from app.api.application.schemas import ApplicationStatus
        from app.api.attendee.models import AttendeeProducts, Attendees
        from app.api.sales_flow.models import SalesFlows

        if not human_ids:
            return {}
        ticket_holders = set(
            session.exec(
                select(Attendees.human_id)
                .join(AttendeeProducts, AttendeeProducts.attendee_id == Attendees.id)
                .where(
                    Attendees.popup_id == popup_id,
                    col(Attendees.human_id).in_(human_ids),
                    col(AttendeeProducts.revoked_at).is_(None),
                    AttendeeProducts.product_category_snapshot == "ticket",
                )
                .distinct()
            ).all()
        )
        rejected = set(
            session.exec(
                select(Applications.human_id)
                .join(SalesFlows, Applications.sales_flow_id == SalesFlows.id)
                .where(
                    Applications.popup_id == popup_id,
                    col(Applications.human_id).in_(human_ids),
                    Applications.status == ApplicationStatus.REJECTED.value,
                    SalesFlows.is_default == True,  # noqa: E712
                )
            ).all()
        )
        return {
            human_id: RsvpEligibility(
                allowed=human_id in ticket_holders and human_id not in rejected,
                reason="rejected"
                if human_id in rejected
                else ("no_tickets" if human_id not in ticket_holders else None),
            )
            for human_id in human_ids
        }

    def active_profile_ids(
        self, session: Session, event_id: uuid.UUID
    ) -> set[uuid.UUID]:
        return set(
            session.exec(
                select(EventParticipants.profile_id).where(
                    EventParticipants.event_id == event_id,
                    EventParticipants.status != ParticipantStatus.CANCELLED,
                )
            ).all()
        )

    def eligible_recipients(
        self, session: Session, event, occurrence_start: datetime | None = None
    ):
        from app.api.human.models import Humans

        query = (
            select(Humans)
            .join(EventParticipants, EventParticipants.profile_id == Humans.id)
            .where(
                EventParticipants.event_id == event.id,
                EventParticipants.status != ParticipantStatus.CANCELLED,
            )
        )
        if occurrence_start is not None:
            query = query.where(EventParticipants.occurrence_start == occurrence_start)
        humans = list(session.exec(query.distinct()).all())
        eligibility = self.eligibility_by_human(
            session, event.popup_id, {h.id for h in humans}
        )
        by_email = {h.email: h for h in humans if h.email and eligibility[h.id].allowed}
        return list(by_email.values())

    def get_by_event_and_profile(
        self,
        session: Session,
        event_id: uuid.UUID,
        profile_id: uuid.UUID,
        occurrence_start: datetime | None = None,
    ) -> EventParticipants | None:
        """Match a participant row.

        ``occurrence_start`` is part of the identity for recurring instances:
        ``NULL`` rows are reserved for one-off events and never collide with
        per-occurrence rows.
        """
        statement = select(EventParticipants).where(
            EventParticipants.event_id == event_id,
            EventParticipants.profile_id == profile_id,
        )
        if occurrence_start is None:
            statement = statement.where(
                EventParticipants.occurrence_start.is_(None)  # type: ignore[union-attr]
            )
        else:
            statement = statement.where(
                EventParticipants.occurrence_start == occurrence_start
            )
        return session.exec(statement).first()

    def find_by_event(
        self,
        session: Session,
        event_id: uuid.UUID,
        skip: int = 0,
        limit: int = 100,
        occurrence_start: datetime | None = None,
        scope_to_occurrence: bool = False,
    ) -> tuple[list[EventParticipants], int]:
        """List participants for an event.

        When ``scope_to_occurrence`` is True we filter to a single instance:
        ``occurrence_start`` matches exactly (or IS NULL for one-offs).
        Otherwise all rows for the event are returned (legacy behavior).
        """
        if not scope_to_occurrence:
            return self.find(session, skip=skip, limit=limit, event_id=event_id)
        statement = select(EventParticipants).where(
            EventParticipants.event_id == event_id,
        )
        if occurrence_start is None:
            statement = statement.where(
                EventParticipants.occurrence_start.is_(None)  # type: ignore[union-attr]
            )
        else:
            statement = statement.where(
                EventParticipants.occurrence_start == occurrence_start
            )
        rows = list(session.exec(statement.offset(skip).limit(limit)).all())
        total = session.exec(
            select(func.count()).select_from(statement.subquery())
        ).one()
        return rows, int(total)

    def count_active_for_event(
        self,
        session: Session,
        event_id: uuid.UUID,
        occurrence_start: datetime | None = None,
    ) -> int:
        statement = (
            select(func.count())
            .select_from(EventParticipants)
            .where(
                EventParticipants.event_id == event_id,
                EventParticipants.status != ParticipantStatus.CANCELLED,
            )
        )
        if occurrence_start is not None:
            statement = statement.where(
                EventParticipants.occurrence_start == occurrence_start
            )
        return session.exec(statement).one()

    def count_active_for_events(
        self,
        session: Session,
        event_ids: list[uuid.UUID],
    ) -> dict[uuid.UUID, int]:
        """Active (non-cancelled) RSVP counts for many events in one query.

        Returns a ``{event_id: count}`` map; event_ids with no active
        participants are omitted (callers should default missing keys to 0).
        Used by the backoffice event list so operators can see RSVP counts
        without opening each event, avoiding an N+1 of ``count_active_for_event``.
        """
        if not event_ids:
            return {}
        statement = (
            select(
                EventParticipants.event_id,
                func.count().label("count"),
            )
            .where(
                EventParticipants.event_id.in_(event_ids),  # type: ignore[attr-defined]
                EventParticipants.status != ParticipantStatus.CANCELLED,
            )
            .group_by(EventParticipants.event_id)
        )
        return {row[0]: int(row[1]) for row in session.exec(statement).all()}

    def cancel_all_for_event(
        self,
        session: Session,
        event_id: uuid.UUID,
        occurrence_start: datetime | None = None,
        scope_to_occurrence: bool = False,
    ) -> int:
        """Cancel every active registration for an event.

        Flips REGISTERED / CHECKED_IN rows to CANCELLED, mirroring the set of
        attendees that receive the iTIP CANCEL. Called when an event (or a
        single occurrence) is cancelled so a later re-publish does not
        resurface stale RSVPs. ``registered_at`` is preserved so a later
        re-registration keeps its original history.

        Returns the number of rows cancelled. Must run AFTER the iTIP CANCEL
        is dispatched, since recipient collection skips CANCELLED rows.
        """
        statement = select(EventParticipants).where(
            EventParticipants.event_id == event_id,
            EventParticipants.status != ParticipantStatus.CANCELLED,
        )
        if scope_to_occurrence:
            if occurrence_start is None:
                statement = statement.where(
                    EventParticipants.occurrence_start.is_(None)  # type: ignore[union-attr]
                )
            else:
                statement = statement.where(
                    EventParticipants.occurrence_start == occurrence_start
                )
        rows = list(session.exec(statement).all())
        for row in rows:
            row.status = ParticipantStatus.CANCELLED
            session.add(row)
        if rows:
            session.commit()
        return len(rows)

    def repoint_occurrence_to_event(
        self,
        session: Session,
        src_event_id: uuid.UUID,
        occurrence_start: datetime,
        dst_event_id: uuid.UUID,
    ) -> int:
        """Move RSVPs of one occurrence onto a standalone event.

        Re-points every participant row matching ``(src_event_id,
        occurrence_start)`` to ``(dst_event_id, occurrence_start=NULL)``. Used
        when a recurring occurrence is detached into its own row so the RSVPs
        that targeted that occurrence follow the new event instead of being
        orphaned on the master. All statuses are moved (cancelled rows
        included) to preserve history.

        Safe against the partial unique indexes: ``dst_event_id`` is a freshly
        created child, so ``(dst_event_id, profile_id)`` with a NULL
        ``occurrence_start`` cannot collide with an existing one-off row.
        Returns the number of rows moved. Does not commit.
        """
        statement = select(EventParticipants).where(
            EventParticipants.event_id == src_event_id,
            EventParticipants.occurrence_start == occurrence_start,
        )
        rows = list(session.exec(statement).all())
        for row in rows:
            row.event_id = dst_event_id
            row.occurrence_start = None
            session.add(row)
        return len(rows)

    def find_by_profile(
        self,
        session: Session,
        profile_id: uuid.UUID,
        popup_id: uuid.UUID | None = None,
        status: ParticipantStatus | None = None,
    ) -> list[EventParticipants]:
        from app.api.event.models import Events

        statement = select(EventParticipants).where(
            EventParticipants.profile_id == profile_id,
        )
        if popup_id:
            statement = statement.join(Events).where(Events.popup_id == popup_id)
        if status:
            statement = statement.where(EventParticipants.status == status)

        return list(session.exec(statement).all())


event_participants_crud = EventParticipantsCRUD()
