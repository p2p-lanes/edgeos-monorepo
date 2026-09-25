import uuid

from fastapi import APIRouter, HTTPException
from loguru import logger

from app.api.event.crud import events_crud
from app.api.event.schemas import EventStatus
from app.api.event_message.crud import event_messages_crud
from app.api.event_message.models import EventMessages
from app.api.event_message.schemas import EventMessageCreate, EventMessagePublic
from app.api.event_participant.crud import event_participants_crud
from app.api.event_participant.router import _resolve_occurrence_start
from app.api.popup.crud import popups_crud
from app.api.popup.guards import (
    CallerToken,
    ensure_api_key_popup,
    ensure_popup_writable,
)
from app.api.shared.response import ListModel, PaginationLimit, PaginationSkip, Paging
from app.api.tenant.utils import get_portal_url
from app.core.dependencies.users import CurrentHuman, HumanTenantSession
from app.services.email import get_email_service
from app.services.email.templates import EventHostMessageContext
from app.services.event_datetime import format_event_when_range
from app.services.event_visibility import human_manages_event

router = APIRouter(prefix="/event-messages", tags=["event-messages"])


def _managed_event(db, event_id, human, token):
    event = events_crud.get(db, event_id)
    if not event:
        raise HTTPException(status_code=404, detail="Event not found")
    ensure_api_key_popup(token, event.popup_id)
    if not human_manages_event(event, human.id):
        raise HTTPException(
            status_code=403,
            detail="Only event managers can contact attendees or view messages.",
        )
    return event


@router.get("/portal/events/{event_id}", response_model=ListModel[EventMessagePublic])
def list_event_messages(
    event_id: uuid.UUID,
    db: HumanTenantSession,
    current_human: CurrentHuman,
    token_payload: CallerToken,
    skip: PaginationSkip = 0,
    limit: PaginationLimit = 20,
) -> ListModel[EventMessagePublic]:
    _managed_event(db, event_id, current_human, token_payload)
    rows, total = event_messages_crud.list_for_event(db, event_id, skip, limit)
    return ListModel[EventMessagePublic](
        results=[EventMessagePublic.model_validate(row) for row in rows],
        paging=Paging(offset=skip, limit=limit, total=total),
    )


@router.post("/portal/events/{event_id}", response_model=EventMessagePublic)
async def send_event_message(
    event_id: uuid.UUID,
    body: EventMessageCreate,
    db: HumanTenantSession,
    current_human: CurrentHuman,
    token_payload: CallerToken,
) -> EventMessagePublic:
    event = _managed_event(db, event_id, current_human, token_payload)
    popup = popups_crud.get(db, event.popup_id)
    ensure_popup_writable(popup)
    if event.status != EventStatus.PUBLISHED:
        raise HTTPException(
            status_code=400, detail="Messages can only be sent for published events."
        )
    # Omitted occurrence means every active RSVPer, deduplicated across the series.
    if body.occurrence_start is not None:
        _resolve_occurrence_start(event, body.occurrence_start, require_scheduled=True)

    existing = event_messages_crud.get(db, body.id)
    if existing:
        return _replayed_message(existing, event_id, current_human.id, body)

    recipients = event_participants_crud.eligible_recipients(
        db, event, body.occurrence_start
    )
    if not recipients:
        raise HTTPException(
            status_code=400, detail="There are no eligible attendees to contact."
        )
    message = EventMessages(
        id=body.id,
        tenant_id=event.tenant_id,
        event_id=event.id,
        author_id=current_human.id,
        author_name=" ".join(
            filter(None, [current_human.first_name, current_human.last_name])
        ),
        body=body.body,
        occurrence_start=body.occurrence_start,
        recipient_count=len(recipients),
    )
    if not event_messages_crud.reserve(db, message):
        existing = event_messages_crud.get(db, body.id)
        if not existing:
            raise HTTPException(status_code=409, detail="Choose a new message ID.")
        return _replayed_message(existing, event_id, current_human.id, body)
    message = event_messages_crud.get(db, body.id)
    assert message is not None
    start = body.occurrence_start or event.start_time
    end = start + (event.end_time - event.start_time)
    tenant = popup.tenant
    event_url = (
        f"{get_portal_url(tenant).rstrip('/')}/portal/{popup.slug}/events/{event.id}"
    )
    if body.occurrence_start:
        from urllib.parse import urlencode

        event_url += "?" + urlencode({"occ": body.occurrence_start.isoformat()})
    service = get_email_service()
    for recipient in recipients:
        try:
            sent = await service.send_event_host_message(
                to=recipient.email,
                subject=f"Message from your host: {event.title}",
                context=EventHostMessageContext(
                    first_name=recipient.first_name or "",
                    event_title=event.title,
                    popup_name=popup.name,
                    event_when=format_event_when_range(start, end, event.timezone),
                    venue_title=event.venue.title
                    if event.venue
                    else event.custom_location_name or "",
                    event_url=event_url,
                    host_name=message.author_name,
                    host_message=body.body,
                ),
                from_address=tenant.sender_email,
                from_name=tenant.sender_name,
                popup_id=popup.id,
                db_session=db,
            )
        except Exception:
            logger.exception("Event message {} delivery failed", message.id)
            sent = False
        event_messages_crud.record_delivery(db, message, sent=sent)
    event_messages_crud.complete(db, message)
    return EventMessagePublic.model_validate(message)


def _replayed_message(message, event_id, author_id, body) -> EventMessagePublic:
    if (
        message.event_id,
        message.author_id,
        message.body,
        message.occurrence_start,
    ) != (event_id, author_id, body.body, body.occurrence_start):
        raise HTTPException(
            status_code=409,
            detail="This message ID has already been used. Choose a new ID.",
        )
    return EventMessagePublic.model_validate(message)
