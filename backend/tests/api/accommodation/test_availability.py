"""Availability, stay restrictions and unit assignment.

These run against a real Postgres (testcontainers) because the guarantee
under test (no two blocking bookings on the same unit and date range) is a
database constraint, not application logic.
"""

import uuid
from datetime import date

import pytest
from sqlmodel import Session

from app.api.accommodation.availability import (
    REASON_INACTIVE,
    REASON_MIN_STAY,
    REASON_OUTSIDE_WINDOW,
    REASON_OVER_CAPACITY,
    AccommodationUnavailableError,
    availability_by_accommodation,
    check_stay_allowed,
    confirm_bookings,
    count_available,
    create_booking,
    effective_min_stay,
    release_bookings,
)
from app.api.accommodation.constants import BookingKind, BookingStatus
from app.api.accommodation.crud import accommodations_crud
from app.api.accommodation.models import AccommodationBookings
from app.api.product.models import Products

JUN_1 = date(2026, 6, 1)
JUN_5 = date(2026, 6, 5)
JUN_8 = date(2026, 6, 8)
JUN_10 = date(2026, 6, 10)
JUN_12 = date(2026, 6, 12)


def _book(
    db: Session,
    accommodation,
    check_in: date,
    check_out: date,
    **kwargs,
) -> AccommodationBookings:
    booking = create_booking(
        db,
        accommodation=accommodation,
        check_in=check_in,
        check_out=check_out,
        **kwargs,
    )
    db.commit()
    db.refresh(booking)
    return booking


class TestShadowProduct:
    def test_creating_an_accommodation_creates_its_shadow_product(
        self, db: Session, accommodation_property, make_accommodation
    ) -> None:
        accommodation = make_accommodation(accommodation_property, units=1)

        assert accommodation.product_id is not None
        product = db.get(Products, accommodation.product_id)
        assert product is not None
        assert product.category == "housing"
        assert product.managed_by == "accommodation"
        # Availability comes from units and dates, never from a stock counter.
        assert product.total_stock_remaining is None
        assert product.discountable is True

    def test_soft_delete_deactivates_the_shadow_product(
        self, db: Session, accommodation_property, make_accommodation
    ) -> None:
        accommodation = make_accommodation(accommodation_property, units=1)
        accommodations_crud.soft_delete(db, accommodation)

        product = db.get(Products, accommodation.product_id)
        assert product.is_active is False
        assert accommodations_crud.get_live(db, accommodation.id) is None


class TestStayRestrictions:
    def test_stay_inside_the_window_is_allowed(
        self, accommodation_property, make_accommodation
    ) -> None:
        accommodation = make_accommodation(accommodation_property, units=1)
        assert check_stay_allowed(accommodation, JUN_1, JUN_8) is None

    def test_check_in_before_bookable_from_is_rejected(
        self, accommodation_property, make_accommodation
    ) -> None:
        accommodation = make_accommodation(accommodation_property, units=1)
        assert (
            check_stay_allowed(accommodation, date(2026, 5, 30), JUN_5)
            == REASON_OUTSIDE_WINDOW
        )

    def test_check_out_after_bookable_to_is_rejected(
        self, accommodation_property, make_accommodation
    ) -> None:
        accommodation = make_accommodation(accommodation_property, units=1)
        assert (
            check_stay_allowed(accommodation, date(2026, 7, 30), date(2026, 8, 2))
            == REASON_OUTSIDE_WINDOW
        )

    def test_min_stay_override_beats_the_popup_default(
        self, accommodation_property, make_accommodation
    ) -> None:
        accommodation = make_accommodation(
            accommodation_property, units=1, min_stay_override=5
        )
        assert effective_min_stay(accommodation, 2) == 5
        assert (
            check_stay_allowed(accommodation, JUN_1, JUN_5, popup_min_stay=2)
            == REASON_MIN_STAY
        )
        assert check_stay_allowed(accommodation, JUN_1, date(2026, 6, 6)) is None

    def test_popup_min_stay_applies_without_an_override(
        self, accommodation_property, make_accommodation
    ) -> None:
        accommodation = make_accommodation(accommodation_property, units=1)
        assert effective_min_stay(accommodation, 3) == 3
        assert (
            check_stay_allowed(accommodation, JUN_1, date(2026, 6, 3), popup_min_stay=3)
            == REASON_MIN_STAY
        )

    def test_guest_count_over_capacity_is_rejected(
        self, accommodation_property, make_accommodation
    ) -> None:
        accommodation = make_accommodation(
            accommodation_property, units=1, guest_capacity=2
        )
        assert (
            check_stay_allowed(accommodation, JUN_1, JUN_5, guest_count=3)
            == REASON_OVER_CAPACITY
        )
        assert check_stay_allowed(accommodation, JUN_1, JUN_5, guest_count=2) is None

    def test_inactive_accommodation_is_rejected(
        self, db: Session, accommodation_property, make_accommodation
    ) -> None:
        accommodation = make_accommodation(accommodation_property, units=1)
        accommodations_crud.soft_delete(db, accommodation)
        assert check_stay_allowed(accommodation, JUN_1, JUN_5) == REASON_INACTIVE


class TestAvailability:
    def test_all_units_available_when_nothing_is_booked(
        self, db: Session, accommodation_property, make_accommodation
    ) -> None:
        accommodation = make_accommodation(accommodation_property, units=3)
        assert count_available(db, accommodation.id, JUN_1, JUN_8) == 3

    def test_a_booking_removes_its_unit_from_the_count(
        self, db: Session, accommodation_property, make_accommodation
    ) -> None:
        accommodation = make_accommodation(accommodation_property, units=2)
        _book(db, accommodation, JUN_1, JUN_8)
        assert count_available(db, accommodation.id, JUN_1, JUN_8) == 1

    def test_same_day_turnover_does_not_collide(
        self, db: Session, accommodation_property, make_accommodation
    ) -> None:
        """The point of half-open ranges: check-out day is free again."""
        accommodation = make_accommodation(accommodation_property, units=1)
        first = _book(db, accommodation, JUN_1, JUN_8)
        second = _book(db, accommodation, JUN_8, JUN_12)
        assert first.unit_id == second.unit_id

    def test_partial_overlap_blocks_the_unit(
        self, db: Session, accommodation_property, make_accommodation
    ) -> None:
        accommodation = make_accommodation(accommodation_property, units=1)
        _book(db, accommodation, JUN_5, JUN_10)
        assert count_available(db, accommodation.id, JUN_8, JUN_12) == 0

    def test_a_stay_before_the_booking_is_still_available(
        self, db: Session, accommodation_property, make_accommodation
    ) -> None:
        accommodation = make_accommodation(accommodation_property, units=1)
        _book(db, accommodation, JUN_10, JUN_12)
        assert count_available(db, accommodation.id, JUN_1, JUN_8) == 1

    def test_cancelled_bookings_free_the_dates(
        self, db: Session, accommodation_property, make_accommodation
    ) -> None:
        accommodation = make_accommodation(accommodation_property, units=1)
        booking = _book(db, accommodation, JUN_1, JUN_8)
        booking.status = BookingStatus.CANCELLED
        db.add(booking)
        db.commit()
        assert count_available(db, accommodation.id, JUN_1, JUN_8) == 1

    def test_maintenance_blocks_are_indistinguishable_from_guests(
        self, db: Session, accommodation_property, make_accommodation
    ) -> None:
        accommodation = make_accommodation(accommodation_property, units=1)
        _book(db, accommodation, JUN_1, JUN_8, kind=BookingKind.MAINTENANCE)
        assert count_available(db, accommodation.id, JUN_1, JUN_8) == 0

    def test_inactive_units_do_not_count(
        self, db: Session, accommodation_property, make_accommodation
    ) -> None:
        accommodation = make_accommodation(accommodation_property, units=2)
        unit = accommodation.units[0]
        unit.is_active = False
        db.add(unit)
        db.commit()
        assert count_available(db, accommodation.id, JUN_1, JUN_8) == 1

    def test_bulk_availability_matches_the_single_lookup(
        self, db: Session, accommodation_property, make_accommodation
    ) -> None:
        first = make_accommodation(accommodation_property, units=3)
        second = make_accommodation(accommodation_property, units=1)
        _book(db, first, JUN_1, JUN_8)

        counts = availability_by_accommodation(db, [first.id, second.id], JUN_1, JUN_8)
        assert counts == {first.id: 2, second.id: 1}

    def test_bulk_availability_of_nothing_is_empty(self, db: Session) -> None:
        assert availability_by_accommodation(db, [], JUN_1, JUN_8) == {}


class TestUnitAssignment:
    def test_units_are_assigned_one_by_one(
        self, db: Session, accommodation_property, make_accommodation
    ) -> None:
        accommodation = make_accommodation(accommodation_property, units=2)
        first = _book(db, accommodation, JUN_1, JUN_8)
        second = _book(db, accommodation, JUN_1, JUN_8)
        assert first.unit_id != second.unit_id

    def test_no_free_unit_raises(
        self, db: Session, accommodation_property, make_accommodation
    ) -> None:
        accommodation = make_accommodation(accommodation_property, units=1)
        _book(db, accommodation, JUN_1, JUN_8)
        with pytest.raises(AccommodationUnavailableError):
            create_booking(
                db, accommodation=accommodation, check_in=JUN_1, check_out=JUN_8
            )
        db.rollback()

    def test_best_fit_packs_against_an_existing_booking(
        self, db: Session, accommodation_property, make_accommodation
    ) -> None:
        """Given a free room and a room that frees up exactly on check-in day,
        the tight one wins so the empty room stays open for a long stay."""
        accommodation = make_accommodation(accommodation_property, units=2)
        unit_a, unit_b = sorted(accommodation.units, key=lambda u: u.sort_order)

        # unit_a is occupied right up to JUN_8; unit_b is untouched.
        _book(db, accommodation, JUN_1, JUN_8, unit_id=unit_a.id)

        packed = _book(db, accommodation, JUN_8, JUN_10)
        assert packed.unit_id == unit_a.id
        assert unit_b.id != packed.unit_id

    def test_pinning_a_taken_unit_raises(
        self, db: Session, accommodation_property, make_accommodation
    ) -> None:
        accommodation = make_accommodation(accommodation_property, units=2)
        booking = _book(db, accommodation, JUN_1, JUN_8)
        with pytest.raises(AccommodationUnavailableError):
            create_booking(
                db,
                accommodation=accommodation,
                check_in=JUN_5,
                check_out=JUN_10,
                unit_id=booking.unit_id,
            )
        db.rollback()

    def test_pinning_a_unit_of_another_accommodation_raises(
        self, db: Session, accommodation_property, make_accommodation
    ) -> None:
        accommodation = make_accommodation(accommodation_property, units=1)
        other = make_accommodation(accommodation_property, units=1)
        with pytest.raises(AccommodationUnavailableError):
            create_booking(
                db,
                accommodation=accommodation,
                check_in=JUN_1,
                check_out=JUN_8,
                unit_id=other.units[0].id,
            )
        db.rollback()

    def test_accommodation_without_units_raises(
        self, db: Session, accommodation_property, make_accommodation
    ) -> None:
        accommodation = make_accommodation(accommodation_property, units=0)
        with pytest.raises(AccommodationUnavailableError):
            create_booking(
                db, accommodation=accommodation, check_in=JUN_1, check_out=JUN_8
            )
        db.rollback()


class TestHoldLifecycle:
    def test_confirm_promotes_every_hold_of_the_payment(
        self, db: Session, accommodation_property, make_accommodation
    ) -> None:
        accommodation = make_accommodation(accommodation_property, units=2)
        payment_id = uuid.uuid4()
        _book(db, accommodation, JUN_1, JUN_8, payment_id=payment_id)
        _book(db, accommodation, JUN_1, JUN_8, payment_id=payment_id)

        confirmed = confirm_bookings(db, payment_id)
        db.commit()

        assert len(confirmed) == 2
        assert all(b.status == BookingStatus.CONFIRMED for b in confirmed)
        assert all(b.hold_expires_at is None for b in confirmed)

    def test_release_expires_holds_and_frees_the_dates(
        self, db: Session, accommodation_property, make_accommodation
    ) -> None:
        accommodation = make_accommodation(accommodation_property, units=1)
        payment_id = uuid.uuid4()
        _book(db, accommodation, JUN_1, JUN_8, payment_id=payment_id)
        assert count_available(db, accommodation.id, JUN_1, JUN_8) == 0

        released = release_bookings(db, payment_id)
        db.commit()

        assert released == 1
        assert count_available(db, accommodation.id, JUN_1, JUN_8) == 1

    def test_release_leaves_confirmed_bookings_alone(
        self, db: Session, accommodation_property, make_accommodation
    ) -> None:
        """A refund is not an expiry: only holds are reclaimed."""
        accommodation = make_accommodation(accommodation_property, units=1)
        payment_id = uuid.uuid4()
        booking = _book(
            db,
            accommodation,
            JUN_1,
            JUN_8,
            payment_id=payment_id,
            status=BookingStatus.CONFIRMED,
        )

        assert release_bookings(db, payment_id) == 0
        db.refresh(booking)
        assert booking.status == BookingStatus.CONFIRMED
