from datetime import datetime
from typing import Any

from sqlalchemy import case
from sqlalchemy.orm import selectinload
from sqlmodel import Session, select

from app.api.popup.models import Popups
from app.api.popup.schemas import PopupCreate, PopupStatus, PopupUpdate
from app.api.shared.crud import BaseCRUD


class PopupsCRUD(BaseCRUD[Popups, PopupCreate, PopupUpdate]):
    def __init__(self) -> None:
        super().__init__(Popups)

    def get_by_slug(self, session: Session, slug: str) -> Popups | None:
        return self.get_by_field(session, "slug", slug)

    def create(self, session: Session, obj_in: PopupCreate) -> Popups:
        """Create a popup and seed the main attendee category in the same transaction."""
        from app.api.attendee_category.crud import attendee_categories_crud

        popup = self.model(**obj_in.model_dump())
        session.add(popup)
        session.flush()  # Get the popup id without committing

        # Seed main category in same transaction
        attendee_categories_crud.seed_main_for_popup(session, popup.id, popup.tenant_id)

        session.commit()
        session.refresh(popup)
        return popup

    def _apply_sorting(
        self,
        statement: Any,
        sort_by: str | None = None,
        sort_order: str = "desc",
    ) -> Any:
        if sort_by:
            return super()._apply_sorting(statement, sort_by, sort_order)
        active_first = case(
            (Popups.status == PopupStatus.active, 0),  # ty: ignore[invalid-argument-type]
            else_=1,
        )
        return statement.order_by(
            active_first,
            Popups.start_date.desc().nulls_last(),  # type: ignore[attr-defined]
        )

    def list_with_checkin_pass_enabled(self, session: Session) -> list[Popups]:
        """Return popups that have the scheduled check-in pass email enabled.

        Filters by ``checkin_pass_lead_days IS NOT NULL`` and ``start_date IS
        NOT NULL`` — both are required for the dispatcher's window check.
        Eager-loads ``tenant`` so callers can read sender_email / sender_name
        per popup without a follow-up query.

        Window logic (current vs. due) lives in the calling service so this
        method stays a pure DB read.
        """
        statement = (
            select(Popups)
            .where(
                Popups.checkin_pass_lead_days.is_not(None),  # type: ignore[union-attr]
                Popups.start_date.is_not(None),  # type: ignore[union-attr]
            )
            .options(selectinload(Popups.tenant))  # type: ignore[arg-type]
        )
        return list(session.exec(statement).all())

    def list_active_past_end_date(
        self, session: Session, now: datetime
    ) -> list[Popups]:
        """Active popups whose end_date is in the past — due to transition to ended.

        ``end_date`` is stored timezone-naive (treated as UTC); the aware ``now``
        is stripped to naive for the comparison.
        """
        naive_now = now.replace(tzinfo=None) if now.tzinfo else now
        statement = select(Popups).where(
            Popups.status == PopupStatus.active,
            Popups.end_date.is_not(None),  # type: ignore[union-attr]
            Popups.end_date < naive_now,  # type: ignore[operator]
        )
        return list(session.exec(statement).all())

    def get_recap_stats(self, session: Session, popup: Popups) -> tuple[int, int, int]:
        """Return (published_events, directory_attendees, inclusive_days) for a popup.

        Attendees are counted only when the popup's attendee directory is
        enabled. ``days`` is the inclusive calendar span between start_date and
        end_date, or 0 when either is missing.
        """
        from sqlalchemy import func  # noqa: PLC0415

        from app.api.attendee.models import Attendees  # noqa: PLC0415
        from app.api.event.models import Events  # noqa: PLC0415
        from app.api.event.schemas import EventStatus  # noqa: PLC0415

        events_count = session.exec(
            select(func.count())
            .select_from(Events)
            .where(
                Events.popup_id == popup.id,
                Events.status == EventStatus.PUBLISHED.value,
            )
        ).one()

        attendees_count = 0
        if popup.show_attendee_directory:
            attendees_count = session.exec(
                select(func.count())
                .select_from(Attendees)
                .where(Attendees.popup_id == popup.id)
            ).one()

        days = 0
        if popup.start_date and popup.end_date:
            days = (popup.end_date.date() - popup.start_date.date()).days + 1

        return int(events_count), int(attendees_count), int(days)


popups_crud = PopupsCRUD()
