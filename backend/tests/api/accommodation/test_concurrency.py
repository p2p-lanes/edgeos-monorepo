"""The last room, sold to N buyers at once.

Availability checks are inherently racy: two checkouts can both read "1 left"
before either inserts. What makes that safe is the exclusion constraint;
these tests assert the invariant holds under real concurrent sessions, and
that a loser gets a clean domain error rather than an ``IntegrityError``.
"""

import threading
from datetime import date

from sqlalchemy.exc import IntegrityError
from sqlmodel import Session, select

from app.api.accommodation.availability import (
    AccommodationUnavailableError,
    create_booking,
)
from app.api.accommodation.constants import BLOCKING_BOOKING_STATUSES, BookingStatus
from app.api.accommodation.models import AccommodationBookings

JUN_1 = date(2026, 6, 1)
JUN_8 = date(2026, 6, 8)


def _blocking_bookings(db: Session, accommodation_id) -> list[AccommodationBookings]:
    return list(
        db.exec(
            select(AccommodationBookings).where(
                AccommodationBookings.accommodation_id == accommodation_id,
                AccommodationBookings.status.in_(BLOCKING_BOOKING_STATUSES),  # type: ignore[attr-defined]
            )
        ).all()
    )


class TestConcurrentHolds:
    def test_last_unit_is_sold_exactly_once(
        self, db: Session, test_engine, accommodation_property, make_accommodation
    ) -> None:
        accommodation = make_accommodation(accommodation_property, units=1)
        accommodation_id = accommodation.id

        successes: list[bool] = []
        rejections: list[bool] = []
        unexpected: list[BaseException] = []
        lock = threading.Lock()
        start = threading.Barrier(4)

        def buy() -> None:
            with Session(test_engine) as session:
                row = session.get(type(accommodation), accommodation_id)
                start.wait(timeout=10)
                try:
                    create_booking(
                        session,
                        accommodation=row,
                        check_in=JUN_1,
                        check_out=JUN_8,
                    )
                    session.commit()
                    with lock:
                        successes.append(True)
                except AccommodationUnavailableError:
                    session.rollback()
                    with lock:
                        rejections.append(True)
                except IntegrityError as exc:
                    # A raw constraint error escaping to the caller is the bug
                    # this whole module exists to prevent.
                    session.rollback()
                    with lock:
                        unexpected.append(exc)

        threads = [threading.Thread(target=buy) for _ in range(4)]
        for thread in threads:
            thread.start()
        for thread in threads:
            thread.join(timeout=30)

        assert not unexpected, f"IntegrityError leaked to the caller: {unexpected}"
        assert len(successes) == 1, f"expected exactly 1 sale, got {len(successes)}"
        assert len(rejections) == 3

        db.expire_all()
        assert len(_blocking_bookings(db, accommodation_id)) == 1

    def test_two_units_serve_two_concurrent_buyers(
        self, db: Session, test_engine, accommodation_property, make_accommodation
    ) -> None:
        accommodation = make_accommodation(accommodation_property, units=2)
        accommodation_id = accommodation.id

        results: list[object] = []
        lock = threading.Lock()
        start = threading.Barrier(2)

        def buy() -> None:
            with Session(test_engine) as session:
                row = session.get(type(accommodation), accommodation_id)
                start.wait(timeout=10)
                try:
                    booking = create_booking(
                        session,
                        accommodation=row,
                        check_in=JUN_1,
                        check_out=JUN_8,
                    )
                    session.commit()
                    with lock:
                        results.append(booking.unit_id)
                except AccommodationUnavailableError:
                    session.rollback()

        threads = [threading.Thread(target=buy) for _ in range(2)]
        for thread in threads:
            thread.start()
        for thread in threads:
            thread.join(timeout=30)

        assert len(results) == 2, "both buyers should get a room"
        assert len(set(results)) == 2, "and they must not be the same room"

    def test_constraint_rejects_a_direct_overlapping_insert(
        self, db: Session, accommodation_property, make_accommodation
    ) -> None:
        """Bypass the application entirely: the database still refuses."""
        accommodation = make_accommodation(accommodation_property, units=1)
        first = create_booking(
            db, accommodation=accommodation, check_in=JUN_1, check_out=JUN_8
        )
        db.commit()

        overlapping = AccommodationBookings(
            tenant_id=accommodation.tenant_id,
            popup_id=accommodation.popup_id,
            accommodation_id=accommodation.id,
            unit_id=first.unit_id,
            status=BookingStatus.CONFIRMED,
            check_in=date(2026, 6, 5),
            check_out=date(2026, 6, 10),
        )
        db.add(overlapping)
        try:
            db.flush()
        except IntegrityError as exc:
            assert "uq_accommodation_bookings_no_overlap" in str(exc)
        else:
            raise AssertionError("the exclusion constraint did not fire")
        finally:
            db.rollback()

    def test_cancelled_rows_do_not_block_a_new_booking(
        self, db: Session, accommodation_property, make_accommodation
    ) -> None:
        """Cancelling is a status change, not a delete, so the constraint has to
        ignore the old row or the dates would stay poisoned forever."""
        accommodation = make_accommodation(accommodation_property, units=1)
        booking = create_booking(
            db, accommodation=accommodation, check_in=JUN_1, check_out=JUN_8
        )
        db.commit()

        booking.status = BookingStatus.CANCELLED
        db.add(booking)
        db.commit()

        replacement = create_booking(
            db, accommodation=accommodation, check_in=JUN_1, check_out=JUN_8
        )
        db.commit()
        assert replacement.unit_id == booking.unit_id
