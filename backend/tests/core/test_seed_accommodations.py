"""The demo lodging inventory in ``seed_data.json``.

Seeding is the only path in the codebase that creates accommodations without
going through the API, and it is the path every new developer hits first. Two
things can quietly go wrong there and both look like "the checkout has no
rooms": a room type created without its shadow ``Products`` row, and inventory
seeded for a popup whose checkout has no enabled ``accommodation-booking``
step. The tests below pin down each one.

``init_db`` runs on every boot, so re-running must be a no-op as well.
"""

import uuid
from datetime import date
from decimal import Decimal

import pytest
from sqlmodel import Session, col, func, select

from app.api.accommodation.availability import occupied_unit_ids
from app.api.accommodation.constants import (
    ACCOMMODATION_STEP_TEMPLATE,
    HOUSING_STEP_TYPE,
    PRODUCT_MANAGED_BY_ACCOMMODATION,
)
from app.api.accommodation.models import (
    AccommodationBookings,
    AccommodationImages,
    AccommodationPriceRules,
    AccommodationProperties,
    Accommodations,
    AccommodationUnits,
)
from app.api.application.models import Applications
from app.api.attendee.models import AttendeeProducts, Attendees
from app.api.human.models import Humans
from app.api.payment.models import Payments
from app.api.popup.models import Popups
from app.api.product.models import Products
from app.api.tenant.models import Tenants
from app.api.ticketing_step.constants import seed_ticketing_steps_for_popup
from app.api.ticketing_step.models import TicketingSteps
from app.core.db import (
    _load_seed_data,
    _seed_accommodation_bookings,
    _seed_accommodations,
)

SEED_POPUP_KEY = "tech-summit"


@pytest.fixture
def seed_popup(db: Session, tenant_a: Tenants) -> Popups:
    """A popup with the default ticketing steps and nothing else.

    Fresh per test rather than shared: these tests count rows, and the seed is
    idempotent by (popup, name), so a leftover popup would hide a duplicate.
    """
    popup = Popups(
        name="Seed Target",
        slug=f"seed-target-{uuid.uuid4().hex[:8]}",
        tenant_id=tenant_a.id,
    )
    db.add(popup)
    db.commit()
    db.refresh(popup)
    seed_ticketing_steps_for_popup(db, popup_id=popup.id, tenant_id=tenant_a.id)
    return popup


def _seed(db: Session, popup: Popups) -> None:
    _seed_accommodations(
        db, _load_seed_data(), {SEED_POPUP_KEY: popup}, popup.tenant_id
    )


def _count(db: Session, model, popup: Popups) -> int:
    return db.exec(
        select(func.count(col(model.id))).where(model.popup_id == popup.id)
    ).one()


def test_seeds_properties_rooms_and_units(db: Session, seed_popup: Popups) -> None:
    _seed(db, seed_popup)

    data = _load_seed_data()
    assert _count(db, AccommodationProperties, seed_popup) == len(
        data["accommodation_properties"]
    )
    assert _count(db, Accommodations, seed_popup) == len(data["accommodations"])
    assert _count(db, AccommodationUnits, seed_popup) == sum(
        len(room["unit_labels"]) for room in data["accommodations"]
    )
    assert _count(db, AccommodationImages, seed_popup) == len(
        data["accommodation_images"]
    )


def test_every_room_type_gets_a_shadow_product_with_a_cover(
    db: Session, seed_popup: Popups
) -> None:
    """No shadow product means the room cannot be paid for at all.

    The cover matters nearly as much: it is what the checkout card shows, and
    it only lands if the seed linked the photos *before* the product was
    synced.
    """
    _seed(db, seed_popup)

    rooms = db.exec(
        select(Accommodations).where(Accommodations.popup_id == seed_popup.id)
    ).all()
    assert rooms

    for room in rooms:
        assert room.product_id is not None, f"{room.name} has no shadow product"
        product = db.get(Products, room.product_id)
        assert product is not None
        assert product.managed_by == PRODUCT_MANAGED_BY_ACCOMMODATION
        assert product.image_url, f"{room.name} has no cover photo"


def test_price_rules_and_long_stay_rates_survive_the_seed(
    db: Session, seed_popup: Popups
) -> None:
    # The demo leans on these to show a price that is not nightly x nights.
    _seed(db, seed_popup)

    rules = db.exec(
        select(AccommodationPriceRules).where(
            AccommodationPriceRules.popup_id == seed_popup.id
        )
    ).all()
    assert rules, "the demo has no date-range pricing to show"
    for rule in rules:
        assert rule.start_date <= rule.end_date
        assert rule.nightly_price > 0

    assert db.exec(
        select(Accommodations).where(
            Accommodations.popup_id == seed_popup.id,
            col(Accommodations.long_stay_price).is_not(None),
        )
    ).first()


def test_bookable_windows_are_well_formed(db: Session, seed_popup: Popups) -> None:
    _seed(db, seed_popup)

    for room in db.exec(
        select(Accommodations).where(Accommodations.popup_id == seed_popup.id)
    ).all():
        assert room.bookable_to > room.bookable_from
        assert isinstance(room.bookable_from, date)


def test_retargets_the_housing_step_so_the_rooms_can_be_sold(
    db: Session, seed_popup: Popups
) -> None:
    """Inventory without an enabled step is refused server-side, not just hidden."""
    _seed(db, seed_popup)

    step = db.exec(
        select(TicketingSteps).where(
            TicketingSteps.popup_id == seed_popup.id,
            TicketingSteps.template == ACCOMMODATION_STEP_TEMPLATE,
        )
    ).first()
    assert step is not None
    assert step.is_enabled
    assert step.step_type == HOUSING_STEP_TYPE
    # Empty means "every property", which is what a demo wants to show.
    assert step.template_config["property_ids"] == []


def test_leaves_a_hand_configured_step_alone(db: Session, seed_popup: Popups) -> None:
    """An operator who already picked properties keeps their choice.

    Overwriting it would silently widen what the checkout sells, which is the
    one thing the step's config exists to narrow.
    """
    chosen = [str(uuid.uuid4())]
    step = db.exec(
        select(TicketingSteps).where(
            TicketingSteps.popup_id == seed_popup.id,
            TicketingSteps.step_type == HOUSING_STEP_TYPE,
        )
    ).first()
    assert step is not None
    step.template = ACCOMMODATION_STEP_TEMPLATE
    step.template_config = {"property_ids": chosen, "require_guest_names": False}
    db.add(step)
    db.commit()

    _seed(db, seed_popup)
    db.refresh(step)

    assert step.template_config["property_ids"] == chosen
    assert step.template_config["require_guest_names"] is False


def test_running_twice_creates_nothing_new(db: Session, seed_popup: Popups) -> None:
    # init_db runs on every boot; a second pass must be inert.
    _seed(db, seed_popup)
    before = {
        model.__name__: _count(db, model, seed_popup)
        for model in (
            AccommodationImages,
            AccommodationProperties,
            Accommodations,
            AccommodationUnits,
            AccommodationPriceRules,
        )
    }

    _seed(db, seed_popup)

    after = {
        model.__name__: _count(db, model, seed_popup)
        for model in (
            AccommodationImages,
            AccommodationProperties,
            Accommodations,
            AccommodationUnits,
            AccommodationPriceRules,
        )
    }
    assert after == before


# ---------------------------------------------------------------------------
# Bookings
# ---------------------------------------------------------------------------
#
# The seeded calendar is what a new developer looks at first, and it is only
# useful if every kind of row on it is real: a sold stay has to carry its
# quote and its pass, a hold has to expire, a cancelled stay has to give the
# room back. Each of those comes from a different branch of
# ``_seed_accommodation_bookings``.

APPLICATION_KEYS = (
    "alice-techsummit",
    "bob-techsummit",
    "david-techsummit",
    "grace-techsummit",
)


@pytest.fixture
def seed_applicants(db: Session, seed_popup: Popups) -> tuple[dict, dict]:
    """One accepted applicant per application key the bookings reference.

    Two attendees each: ``bob-dome-hold`` books for ``attendee_index=1``, and
    an off-by-one there would attach the stay to the wrong person without
    failing anything.
    """
    application_map: dict[str, Applications] = {}
    attendee_lists: dict[str, list[Attendees]] = {}

    for key in APPLICATION_KEYS:
        human = Humans(
            tenant_id=seed_popup.tenant_id,
            email=f"{key}-{uuid.uuid4().hex[:6]}@example.com",
            first_name=key.split("-")[0].title(),
            last_name="Seed",
        )
        db.add(human)
        db.commit()
        db.refresh(human)

        application = Applications(
            tenant_id=seed_popup.tenant_id,
            popup_id=seed_popup.id,
            human_id=human.id,
            status="accepted",
        )
        db.add(application)
        db.commit()
        db.refresh(application)

        attendees = []
        for index in range(2):
            attendee = Attendees(
                tenant_id=seed_popup.tenant_id,
                application_id=application.id,
                popup_id=seed_popup.id,
                human_id=human.id,
                name=f"{human.first_name} {index}",
                email=human.email,
            )
            db.add(attendee)
            attendees.append(attendee)
        db.commit()
        for attendee in attendees:
            db.refresh(attendee)

        application_map[key] = application
        attendee_lists[key] = attendees

    return application_map, attendee_lists


def _seed_bookings(db: Session, popup: Popups, applicants: tuple[dict, dict]) -> None:
    data = _load_seed_data()
    accommodation_map = _seed_accommodations(
        db, data, {SEED_POPUP_KEY: popup}, popup.tenant_id
    )
    application_map, attendee_lists = applicants
    _seed_accommodation_bookings(
        db,
        data,
        {SEED_POPUP_KEY: popup},
        accommodation_map,
        application_map,
        attendee_lists,
        popup.tenant_id,
    )


def _bookings(db: Session, popup: Popups) -> list[AccommodationBookings]:
    return list(
        db.exec(
            select(AccommodationBookings).where(
                AccommodationBookings.popup_id == popup.id
            )
        ).all()
    )


def _appearance(booking: AccommodationBookings) -> str:
    """Mirrors ``bookingAppearanceKey`` in the backoffice calendar."""
    if booking.status in ("cancelled", "expired"):
        return "released"
    if booking.kind in ("block", "maintenance"):
        return "block"
    if booking.status == "hold":
        return "hold"
    return "confirmed" if booking.payment_id else "manual"


def test_seeds_every_kind_of_row_the_calendar_can_draw(
    db: Session, seed_popup: Popups, seed_applicants
) -> None:
    # The legend has five entries; a demo showing one of them demonstrates
    # nothing about the other four.
    _seed_bookings(db, seed_popup, seed_applicants)

    drawn = {_appearance(booking) for booking in _bookings(db, seed_popup)}
    assert drawn == {"confirmed", "hold", "manual", "block", "released"}


def test_a_sold_stay_carries_its_quote_and_its_pass(
    db: Session, seed_popup: Popups, seed_applicants
) -> None:
    """Inserting the booking alone looks right on the calendar and leaves the
    guest with nothing on the portal."""
    _seed_bookings(db, seed_popup, seed_applicants)

    sold = [
        booking
        for booking in _bookings(db, seed_popup)
        if _appearance(booking) == "confirmed"
    ]
    assert sold

    for booking in sold:
        assert booking.price_snapshot, "no price snapshot to explain the charge"
        assert Decimal(booking.price_snapshot["total"]) > 0
        assert booking.human_id is not None
        assert booking.attendee_id is not None
        assert booking.payment_product_id is not None, "not linked to its payment line"

        payment = db.get(Payments, booking.payment_id)
        assert payment is not None
        assert payment.status == "approved"
        assert payment.amount == Decimal(booking.price_snapshot["total"])

    passes = db.exec(
        select(AttendeeProducts).where(
            col(AttendeeProducts.payment_id).in_([b.payment_id for b in sold])
        )
    ).all()
    assert len(passes) == len(sold)
    for row in passes:
        metadata = row.purchase_metadata or {}
        assert metadata.get("kind") == "accommodation_booking"
        # Frozen at purchase: the receipt has to survive a rename.
        assert metadata.get("accommodation_name")
        assert metadata.get("property_name")
        assert metadata.get("unit_label")


def test_a_stay_in_flight_is_a_hold_that_expires(
    db: Session, seed_popup: Popups, seed_applicants
) -> None:
    _seed_bookings(db, seed_popup, seed_applicants)

    holds = [b for b in _bookings(db, seed_popup) if b.status == "hold"]
    assert holds

    for hold in holds:
        assert hold.hold_expires_at is not None
        assert db.get(Payments, hold.payment_id).status == "pending"
        # Nothing has been paid, so no pass is issued.
        assert not db.exec(
            select(AttendeeProducts).where(
                AttendeeProducts.payment_id == hold.payment_id
            )
        ).all()


def test_a_cancelled_stay_gives_the_room_back(
    db: Session, seed_popup: Popups, seed_applicants
) -> None:
    """Only hold/confirmed occupy a unit, which is what the exclusion
    constraint covers, so a cancelled row must not read as taken."""
    _seed_bookings(db, seed_popup, seed_applicants)

    cancelled = [b for b in _bookings(db, seed_popup) if b.status == "cancelled"]
    assert cancelled

    for booking in cancelled:
        # Asked of the unit rather than of the room type: a cancelled stay in
        # a room that is busy for other reasons still has to free *its* unit.
        taken = occupied_unit_ids(
            db, [booking.accommodation_id], booking.check_in, booking.check_out
        )
        assert booking.unit_id not in taken


def test_two_rooms_out_for_the_same_repair_are_two_blocks(
    db: Session, seed_popup: Popups, seed_applicants
) -> None:
    """They share a note and a date range and differ only by unit; keying the
    seed on the note alone dropped the second one."""
    _seed_bookings(db, seed_popup, seed_applicants)

    repaint = [
        b
        for b in _bookings(db, seed_popup)
        if b.kind == "block" and b.notes == "Repainting"
    ]
    assert len(repaint) == 2
    assert len({block.unit_id for block in repaint}) == 2


def test_running_the_bookings_twice_creates_nothing_new(
    db: Session, seed_popup: Popups, seed_applicants
) -> None:
    _seed_bookings(db, seed_popup, seed_applicants)
    before = len(_bookings(db, seed_popup))
    assert before == len(_load_seed_data()["accommodation_bookings"])

    _seed_bookings(db, seed_popup, seed_applicants)

    assert len(_bookings(db, seed_popup)) == before


def _one_off(db: Session, popup: Popups, applicants, entries: list[dict]) -> None:
    """Run the booking seeder over a hand-made list, on top of the real one."""
    data = dict(_load_seed_data())
    accommodation_map = _seed_accommodations(
        db, data, {SEED_POPUP_KEY: popup}, popup.tenant_id
    )
    application_map, attendee_lists = applicants
    data["accommodation_bookings"] = entries
    _seed_accommodation_bookings(
        db,
        data,
        {SEED_POPUP_KEY: popup},
        accommodation_map,
        application_map,
        attendee_lists,
        popup.tenant_id,
    )


def _fill_entry(index: int, mode: str, **extra) -> dict:
    entry = {
        "key": f"overbook-{index}",
        "popup_key": SEED_POPUP_KEY,
        # Two units, so the third identical entry has nowhere to go.
        "accommodation_key": "residences-penthouse",
        "check_in": "2026-06-14",
        "check_out": "2026-06-16",
        "mode": mode,
    }
    entry.update(extra)
    return entry


def test_a_room_that_cannot_be_placed_does_not_take_the_boot_down(
    db: Session, seed_popup: Popups, seed_applicants
) -> None:
    """``init_db`` runs on every start, so one greedy demo entry must not stop
    the stack from coming up. It is skipped, and the rest still land."""
    entries = [
        _fill_entry(1, "staff", primary_guest_name="First", guest_count=1),
        _fill_entry(2, "staff", primary_guest_name="Second", guest_count=1),
        _fill_entry(3, "staff", primary_guest_name="Third", guest_count=1),
        _fill_entry(
            4,
            "purchase",
            application_key="alice-techsummit",
            attendee_index=0,
            guests=["Alice Johnson"],
        ),
    ]

    _one_off(db, seed_popup, seed_applicants, entries)

    placed = {
        booking.primary_guest_name
        for booking in _bookings(db, seed_popup)
        if booking.check_in == date(2026, 6, 14)
        and booking.check_out == date(2026, 6, 16)
    }
    # The Penthouse Loft has two units: the first two fit, the rest do not.
    assert {"First", "Second"} <= placed
    assert "Third" not in placed
    assert "Alice Johnson" not in placed


def test_a_block_left_to_the_assigner_is_seeded_once(
    db: Session, seed_popup: Popups, seed_applicants
) -> None:
    """Without ``unit_label`` there is no unit to compare against, and keying
    on one meant comparing to None and re-seeding on every boot."""
    entry = {
        "key": "unpinned-block",
        "popup_key": SEED_POPUP_KEY,
        "accommodation_key": "arcadia-twin",
        "check_in": "2026-06-14",
        "check_out": "2026-06-16",
        "mode": "block",
        "notes": "Deep clean",
    }

    _one_off(db, seed_popup, seed_applicants, [entry])
    _one_off(db, seed_popup, seed_applicants, [entry])

    assert len([b for b in _bookings(db, seed_popup) if b.notes == "Deep clean"]) == 1
