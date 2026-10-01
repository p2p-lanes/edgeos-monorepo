"""Attendance history rows (SIM-106). See ``EventCheckIns``."""

from __future__ import annotations

import uuid
from datetime import datetime

from sqlmodel import Session, col, select

from app.api.event_participant.models import EventCheckIns, EventParticipants
from app.api.event_participant.schemas import ParticipantStatus


class EventCheckInsCRUD:
    def active_for_participant(
        self, session: Session, participant_id: uuid.UUID
    ) -> EventCheckIns | None:
        return session.exec(
            select(EventCheckIns).where(
                EventCheckIns.participant_id == participant_id,
                col(EventCheckIns.voided_at).is_(None),
            )
        ).first()

    def list_for_participants(
        self, session: Session, participant_ids: set[uuid.UUID]
    ) -> dict[uuid.UUID, list[EventCheckIns]]:
        """History per participation, newest first."""
        if not participant_ids:
            return {}
        rows = session.exec(
            select(EventCheckIns)
            .where(col(EventCheckIns.participant_id).in_(participant_ids))
            .order_by(col(EventCheckIns.checked_in_at).desc())
        ).all()
        out: dict[uuid.UUID, list[EventCheckIns]] = {}
        for row in rows:
            out.setdefault(row.participant_id, []).append(row)
        return out

    def event_has_any_check_in(self, session: Session, event_id: uuid.UUID) -> bool:
        """Whether attendance was ever recorded for any occurrence of the event.

        Voided marks count: the event has attendance history either way, and
        that history is what "no way back to none" protects. Also looks at
        participant status so a check-in made outside this table (a
        backoffice status edit) still counts.
        """
        logged = session.exec(
            select(EventCheckIns.id).where(EventCheckIns.event_id == event_id).limit(1)
        ).first()
        if logged is not None:
            return True
        return (
            session.exec(
                select(EventParticipants.id)
                .where(
                    EventParticipants.event_id == event_id,
                    EventParticipants.status == ParticipantStatus.CHECKED_IN,
                )
                .limit(1)
            ).first()
            is not None
        )

    def repoint_occurrence_to_event(
        self,
        session: Session,
        src_event_id: uuid.UUID,
        occurrence_start: datetime,
        dst_event_id: uuid.UUID,
    ) -> int:
        """Mirror of the participants repoint for a detached occurrence.

        Does not commit.
        """
        rows = list(
            session.exec(
                select(EventCheckIns).where(
                    EventCheckIns.event_id == src_event_id,
                    EventCheckIns.occurrence_start == occurrence_start,
                )
            ).all()
        )
        for row in rows:
            row.event_id = dst_event_id
            row.occurrence_start = None
            session.add(row)
        return len(rows)


event_check_ins_crud = EventCheckInsCRUD()
