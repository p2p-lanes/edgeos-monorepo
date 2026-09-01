"""
Give an account a room, the way the checkout would have.

For demoing and for reproducing a support case: it builds a real purchase
(server-side quote, approved payment, confirmed booking, pass on the attendee)
rather than inserting a row into ``accommodation_bookings``. A hand-inserted
booking shows up on the calendar but has no price snapshot, no payment line
and no pass, so the portal shows the guest nothing and the CSV export has a
blank where the money should be.

The repeatable demo inventory and its bookings live in ``seed_data.json``
(see ``_seed_accommodations`` / ``_seed_accommodation_bookings`` in
``app/core/db.py``). This script is for the accounts that are not in the seed
the ones created by logging into the portal locally.

The account needs an accepted application on the popup: that is what the
portal checkout requires, and a stay attached to an account that cannot get
in is not a case worth reproducing.

Usage:
    cd backend && uv run python scripts/assign_accommodation.py \\
        --popup tech-summit-2025 \\
        --email someone@example.com \\
        --room "Arcadia Suite" \\
        --check-in 2026-06-14 --check-out 2026-06-21 \\
        --guest "Ada Lovelace" --guest "Grace Hopper"

    # ...and to see what it would do, without writing anything:
    ... --dry-run
"""

import argparse
import sys
from datetime import date
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from loguru import logger  # noqa: E402
from sqlmodel import Session, col, select  # noqa: E402

import app.models  # noqa: F401,E402  registers every mapper before we query
from app.api.accommodation import payments as accommodation_payments  # noqa: E402
from app.api.accommodation.constants import PURCHASE_METADATA_KIND  # noqa: E402
from app.api.accommodation.models import (  # noqa: E402
    AccommodationProperties,
    Accommodations,
    AccommodationUnits,
)
from app.api.attendee.crud import generate_check_in_code  # noqa: E402
from app.api.payment.schemas import PaymentStatus  # noqa: E402
from app.api.popup.models import Popups  # noqa: E402
from app.api.product.schemas import CATEGORY_HOUSING  # noqa: E402
from app.core.db import engine  # noqa: E402
from app.models import (  # noqa: E402
    Applications,
    AttendeeProducts,
    Attendees,
    Humans,
    PaymentProducts,
    Payments,
)


class PurchaseLine:
    """The four attributes ``accommodation_payments`` reads off a line."""

    def __init__(self, product_id, purchase_metadata) -> None:
        self.product_id = product_id
        self.quantity = 1
        self.purchase_metadata = purchase_metadata


def fail(message: str) -> None:
    logger.error(message)
    raise SystemExit(1)


def resolve_room(session: Session, popup: Popups, name: str) -> Accommodations:
    rooms = session.exec(
        select(Accommodations).where(
            Accommodations.popup_id == popup.id,
            col(Accommodations.deleted_at).is_(None),
        )
    ).all()
    matches = [room for room in rooms if room.name.lower() == name.lower()]
    if not matches:
        # Naming the alternatives beats "not found" when the room is called
        # something slightly different from what the operator remembers.
        available = ", ".join(sorted(room.name for room in rooms))
        fail(f"no room type called {name!r} on {popup.slug}. Available: {available}")
    if len(matches) > 1:
        fail(f"{name!r} is ambiguous: {len(matches)} room types share that name")
    return matches[0]


def resolve_attendee(session: Session, popup: Popups, email: str) -> tuple:
    human = session.exec(select(Humans).where(col(Humans.email).ilike(email))).first()
    if human is None:
        fail(f"no account with the email {email!r}")

    application = session.exec(
        select(Applications).where(
            Applications.human_id == human.id,
            Applications.popup_id == popup.id,
        )
    ).first()
    if application is None:
        fail(f"{email} has no application on {popup.slug}")
    if application.status != "accepted":
        fail(
            f"{email}'s application on {popup.slug} is {application.status!r}, "
            "so the portal would not let them check out"
        )

    attendee = session.exec(
        select(Attendees).where(Attendees.application_id == application.id)
    ).first()
    if attendee is None:
        fail(f"{email} has no attendee on {popup.slug}")
    return human, application, attendee


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--popup", required=True, help="popup slug")
    parser.add_argument("--email", required=True, help="the account's email")
    parser.add_argument("--room", required=True, help="room type name")
    parser.add_argument("--check-in", required=True, type=date.fromisoformat)
    parser.add_argument("--check-out", required=True, type=date.fromisoformat)
    parser.add_argument(
        "--guest",
        action="append",
        default=[],
        dest="guests",
        help="guest name; repeat for each guest (default: the account holder)",
    )
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()

    with Session(engine) as session:
        popup = session.exec(select(Popups).where(Popups.slug == args.popup)).first()
        if popup is None:
            fail(f"no popup with the slug {args.popup!r}")

        room = resolve_room(session, popup, args.room)
        human, application, attendee = resolve_attendee(session, popup, args.email)

        guests = args.guests or [attendee.name or human.email]
        line = PurchaseLine(
            product_id=room.product_id,
            purchase_metadata={
                "kind": PURCHASE_METADATA_KIND,
                "accommodation_id": str(room.id),
                "check_in": args.check_in.isoformat(),
                "check_out": args.check_out.isoformat(),
                "guest_count": len(guests),
                "guests": [{"name": name} for name in guests],
            },
        )

        # Prices the stay and rejects anything the checkout would reject:
        # min stay, capacity, the bookable window, a property the step does
        # not offer.
        resolved = accommodation_payments.resolve_lines(session, popup, [line])
        quote = resolved[0].quote
        prop = session.get(AccommodationProperties, room.property_id)

        logger.info(f"{prop.name} / {room.name}")
        logger.info(
            f"  {args.check_in} -> {args.check_out}  ({quote.night_count} nights)"
        )
        logger.info(f"  guests: {', '.join(guests)}")
        logger.info(
            f"  subtotal {quote.subtotal}  tax {quote.tax}  "
            f"total {quote.total} {quote.currency}  [{quote.applied_rule}]"
        )
        if args.dry_run:
            logger.info("  (dry run - nothing written)")
            return

        payment = Payments(
            tenant_id=popup.tenant_id,
            application_id=application.id,
            popup_id=popup.id,
            status=PaymentStatus.APPROVED.value,
            amount=quote.total,
            currency=popup.currency,
            group_id=application.group_id,
        )
        session.add(payment)
        session.flush()

        # Raises 409 if the room was taken while we were quoting it; the
        # exclusion constraint is what decides, not this script.
        bookings = accommodation_payments.create_holds(
            session,
            payment_id=payment.id,
            resolved=resolved,
            lines=[line],
            human_id=human.id,
            buyer_email=attendee.email or human.email,
            confirmed=True,
        )

        session.add(
            PaymentProducts(
                tenant_id=popup.tenant_id,
                payment_id=payment.id,
                product_id=room.product_id,
                attendee_id=attendee.id,
                quantity=1,
                product_name=room.name,
                product_description=room.description,
                product_price=room.default_nightly_price,
                product_category=CATEGORY_HOUSING,
                product_currency=popup.currency,
                effective_unit_price=quote.total,
                purchase_metadata=line.purchase_metadata,
            )
        )
        session.flush()
        accommodation_payments.attach_payment_products(
            session, payment_id=payment.id, bookings=bookings
        )

        # The pass is what the portal reads. Without it the guest has paid for
        # a stay they cannot see.
        session.add(
            AttendeeProducts(
                tenant_id=popup.tenant_id,
                attendee_id=attendee.id,
                product_id=room.product_id,
                check_in_code=generate_check_in_code(""),
                payment_id=payment.id,
                purchase_metadata=line.purchase_metadata,
            )
        )
        for booking in bookings:
            booking.attendee_id = attendee.id
            session.add(booking)

        session.commit()

        unit = session.get(AccommodationUnits, bookings[0].unit_id)
        logger.info(
            f"  booked unit {unit.label} for {args.email}  (payment {payment.id})"
        )


if __name__ == "__main__":
    main()
