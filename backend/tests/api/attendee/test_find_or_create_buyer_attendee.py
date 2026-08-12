"""Tests for AttendeesCRUD.find_or_create_buyer_attendee.

A direct purchase must land on the person the buyer already is at that popup,
never on a second attendee row. Ownership is the predicate of
_human_popup_attendee_ids: the buyer's own application, or a direct-sale row
carrying their human_id. A companion row belongs to the application holder, so
it is not the buyer's row.
"""

import uuid

from sqlmodel import Session, func, select

from app.api.attendee.crud import attendees_crud
from app.api.attendee.models import Attendees
from app.api.human.models import Humans
from app.api.popup.models import Popups
from app.api.tenant.models import Tenants
from tests._flow_helpers import application_flow_id


def _make_popup(db: Session, tenant: Tenants, *, suffix: str) -> Popups:
    popup = Popups(
        id=uuid.uuid4(),
        tenant_id=tenant.id,
        name=f"Buyer Attendee {suffix}",
        slug=f"buyer-attendee-{suffix}-{uuid.uuid4().hex[:6]}",
    )
    db.add(popup)
    db.flush()
    return popup


def _make_human(db: Session, tenant: Tenants) -> Humans:
    human = Humans(
        id=uuid.uuid4(),
        tenant_id=tenant.id,
        email=f"buyer-{uuid.uuid4().hex[:8]}@test.com",
    )
    db.add(human)
    db.flush()
    return human


def _make_app_attendee(
    db: Session,
    tenant: Tenants,
    popup: Popups,
    holder: Humans,
    *,
    attendee_human: Humans | None = None,
    name: str = "App Attendee",
) -> Attendees:
    """Create an application-linked attendee.

    ``holder`` owns the application. ``attendee_human`` defaults to the holder;
    pass a different human to build a companion row.
    """
    from app.api.application.models import Applications
    from app.api.application.schemas import ApplicationStatus

    application = Applications(
        sales_flow_id=application_flow_id(db, popup.id),
        id=uuid.uuid4(),
        tenant_id=tenant.id,
        popup_id=popup.id,
        human_id=holder.id,
        status=ApplicationStatus.ACCEPTED.value,
    )
    db.add(application)
    db.flush()

    person = attendee_human or holder
    attendee = Attendees(
        id=uuid.uuid4(),
        tenant_id=tenant.id,
        application_id=application.id,
        popup_id=popup.id,
        human_id=person.id,
        name=name,
        email=person.email,
        category="main",
    )
    db.add(attendee)
    db.flush()
    return attendee


def _make_direct_attendee(
    db: Session,
    tenant: Tenants,
    popup: Popups,
    human: Humans,
    *,
    name: str = "Direct Attendee",
) -> Attendees:
    attendee = Attendees(
        id=uuid.uuid4(),
        tenant_id=tenant.id,
        application_id=None,
        popup_id=popup.id,
        human_id=human.id,
        name=name,
        email=human.email,
        category="main",
    )
    db.add(attendee)
    db.flush()
    return attendee


def _count_attendees(db: Session, popup: Popups) -> int:
    return db.exec(
        select(func.count())
        .select_from(Attendees)
        .where(Attendees.popup_id == popup.id)
    ).one()


def _buy(db: Session, tenant: Tenants, popup: Popups, human: Humans) -> Attendees:
    return attendees_crud.find_or_create_buyer_attendee(
        db,
        human_id=human.id,
        popup_id=popup.id,
        tenant_id=tenant.id,
        name="Buyer Name",
        email=human.email,
    )


class TestFindOrCreateBuyerAttendee:
    def test_creates_one_when_buyer_is_new_to_the_popup(
        self, db: Session, tenant_a: Tenants
    ) -> None:
        popup = _make_popup(db, tenant_a, suffix="new")
        human = _make_human(db, tenant_a)
        db.commit()

        attendee = _buy(db, tenant_a, popup, human)

        assert attendee.application_id is None
        assert attendee.human_id == human.id
        assert attendee.popup_id == popup.id
        assert _count_attendees(db, popup) == 1

    def test_reuses_the_row_of_a_buyer_who_already_bought(
        self, db: Session, tenant_a: Tenants
    ) -> None:
        popup = _make_popup(db, tenant_a, suffix="repeat")
        human = _make_human(db, tenant_a)
        existing = _make_direct_attendee(db, tenant_a, popup, human)
        db.commit()

        attendee = _buy(db, tenant_a, popup, human)

        assert attendee.id == existing.id
        assert _count_attendees(db, popup) == 1

    def test_reuses_the_row_of_a_buyer_who_applied(
        self, db: Session, tenant_a: Tenants
    ) -> None:
        """The case that used to make one person two attendees."""
        popup = _make_popup(db, tenant_a, suffix="applied")
        human = _make_human(db, tenant_a)
        existing = _make_app_attendee(db, tenant_a, popup, human)
        db.commit()

        attendee = _buy(db, tenant_a, popup, human)

        assert attendee.id == existing.id
        assert attendee.application_id == existing.application_id
        assert _count_attendees(db, popup) == 1

    def test_direct_row_wins_when_the_buyer_holds_both(
        self, db: Session, tenant_a: Tenants
    ) -> None:
        popup = _make_popup(db, tenant_a, suffix="both")
        human = _make_human(db, tenant_a)
        _make_app_attendee(db, tenant_a, popup, human)
        direct = _make_direct_attendee(db, tenant_a, popup, human)
        db.commit()

        attendee = _buy(db, tenant_a, popup, human)

        assert attendee.id == direct.id
        assert _count_attendees(db, popup) == 2

    def test_a_companion_row_is_not_the_buyer_row(
        self, db: Session, tenant_a: Tenants
    ) -> None:
        """A companion belongs to the application holder, and every ownership
        query says so, so the buyer still needs a row of their own."""
        popup = _make_popup(db, tenant_a, suffix="companion")
        holder = _make_human(db, tenant_a)
        companion = _make_human(db, tenant_a)
        companion_row = _make_app_attendee(
            db, tenant_a, popup, holder, attendee_human=companion
        )
        db.commit()

        attendee = _buy(db, tenant_a, popup, companion)

        assert attendee.id != companion_row.id
        assert attendee.application_id is None
        assert _count_attendees(db, popup) == 2

    def test_a_row_in_another_popup_is_not_reused(
        self, db: Session, tenant_a: Tenants
    ) -> None:
        popup = _make_popup(db, tenant_a, suffix="here")
        other_popup = _make_popup(db, tenant_a, suffix="elsewhere")
        human = _make_human(db, tenant_a)
        _make_direct_attendee(db, tenant_a, other_popup, human)
        db.commit()

        attendee = _buy(db, tenant_a, popup, human)

        assert attendee.popup_id == popup.id
        assert _count_attendees(db, popup) == 1
        assert _count_attendees(db, other_popup) == 1
