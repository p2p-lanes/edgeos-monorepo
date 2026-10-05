"""Participant serialization shared by read-only administrative views."""

from sqlmodel import Session, select

from app.api.event.models import Events
from app.api.event_participant.models import EventParticipants
from app.api.event_participant.schemas import EventParticipantPublic
from app.api.human.models import Humans


def participants_with_names(
    db: Session, participants: list[EventParticipants]
) -> list[EventParticipantPublic]:
    """Join names and gathering IDs in two batched, tenant-scoped queries."""
    if not participants:
        return []
    profile_ids = {p.profile_id for p in participants}
    event_ids = {p.event_id for p in participants}
    rows = db.exec(select(Humans).where(Humans.id.in_(profile_ids))).all()
    events = db.exec(select(Events).where(Events.id.in_(event_ids))).all()
    names = {h.id: (h.first_name, h.last_name) for h in rows}
    popup_ids = {event.id: event.popup_id for event in events}
    out: list[EventParticipantPublic] = []
    for p in participants:
        public = EventParticipantPublic.model_validate(p)
        public.popup_id = popup_ids.get(p.event_id)
        first, last = names.get(p.profile_id, (None, None))
        public.first_name = first
        public.last_name = last
        out.append(public)
    return out
