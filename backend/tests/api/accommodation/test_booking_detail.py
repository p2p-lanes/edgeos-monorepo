"""One booking, and what it takes to show it on its own page.

Two things this covers that nothing else does: that the detail endpoint hands
back the room, the building and the sibling units in a single call, and that
the CSV export grows a column per question the bookings were actually asked.

Both read `form_snapshot`, not the step's current form. A stay exported six
months from now has to be labelled with the question that was put to the
guest, not with whatever the operator renamed it to since.
"""

import uuid

from fastapi.testclient import TestClient
from sqlmodel import Session, select

from app.api.accommodation.export import answer_columns
from app.api.accommodation.models import AccommodationBookings
from app.api.popup.models import Popups

BASE = "/api/v1/accommodations"

JUN_1 = "2026-06-01"
JUN_8 = "2026-06-08"
JUN_10 = "2026-06-10"
JUL_1 = "2026-07-01"

# Each export test books and exports inside its own window. They share a
# gathering, and an export is a date range: without this they read each
# other's bookings and each other's columns.
AUG_1 = "2026-08-01"
AUG_8 = "2026-08-08"
AUG_10 = "2026-08-10"
SEP_1 = "2026-09-01"
SEP_8 = "2026-09-08"
SEP_10 = "2026-09-10"

PASSPORT = {
    "key": "passport",
    "type": "text",
    "label": "Passport number",
    "required": True,
}
DIET = {
    "key": "diet",
    "type": "select",
    "label": "Diet",
    "required": False,
    "options": ["None", "Vegetarian"],
}


def _headers(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


def _inventory(client: TestClient, token: str, popup_id: uuid.UUID) -> dict:
    # Names are unique per gathering and the popup fixture is shared across
    # the module, so they are generated rather than written out.
    suffix = uuid.uuid4().hex[:8]
    prop = client.post(
        f"{BASE}/properties",
        headers=_headers(token),
        json={
            "popup_id": str(popup_id),
            "name": f"Hotel Arcadia {suffix}",
            "address": "12 Long Street",
        },
    )
    assert prop.status_code == 201, prop.text
    room = client.post(
        BASE,
        headers=_headers(token),
        json={
            "popup_id": str(popup_id),
            "property_id": prop.json()["id"],
            "name": f"Classic Double {suffix}",
            "guest_capacity": 2,
            "default_nightly_price": "120.00",
            "bookable_from": JUN_1,
            "bookable_to": "2026-10-01",
            "units_count": 3,
        },
    )
    assert room.status_code == 201, room.text
    return {"property": prop.json(), "room": room.json()}


def _book(
    client: TestClient, token: str, popup_id: uuid.UUID, room_id: str, **overrides
) -> dict:
    payload = {
        "popup_id": str(popup_id),
        "accommodation_id": room_id,
        "check_in": JUN_1,
        "check_out": JUN_8,
        "guest_count": 2,
        "guests": [{"name": "Ada"}, {"name": "Grace"}],
        "primary_guest_name": "Ada",
        "primary_guest_email": "ada@example.com",
    }
    payload.update(overrides)
    response = client.post(f"{BASE}/bookings", headers=_headers(token), json=payload)
    assert response.status_code == 201, response.text
    return response.json()


def _answer(
    db: Session,
    booking_id: str,
    *,
    snapshot: dict,
    booker_answers: dict,
    guests: list[dict],
) -> None:
    """Write the answers a checkout purchase would have written.

    Staff bookings do not collect them, so the fixture stands in for a stay
    that came through the portal.
    """
    booking = db.exec(
        select(AccommodationBookings).where(
            AccommodationBookings.id == uuid.UUID(booking_id)
        )
    ).one()
    booking.form_snapshot = snapshot
    booking.booker_answers = booker_answers
    booking.guests = guests
    db.add(booking)
    db.commit()


class TestBookingDetail:
    def test_one_call_returns_the_room_the_building_and_the_other_units(
        self, client: TestClient, admin_token_tenant_a: str, popup_tenant_a: Popups
    ) -> None:
        inventory = _inventory(client, admin_token_tenant_a, popup_tenant_a.id)
        booking = _book(
            client,
            admin_token_tenant_a,
            popup_tenant_a.id,
            inventory["room"]["id"],
        )

        response = client.get(
            f"{BASE}/bookings/{booking['id']}",
            headers=_headers(admin_token_tenant_a),
        )

        assert response.status_code == 200, response.text
        detail = response.json()
        assert detail["property_name"] == inventory["property"]["name"]
        assert detail["property_address"] == "12 Long Street"
        assert detail["accommodation_name"] == inventory["room"]["name"]
        # The unit it is in, named, plus its siblings: moving a guest to
        # another bed is the one edit this page offers.
        assert detail["unit_label"]
        assert len(detail["units"]) == 3
        assert detail["unit_id"] in [unit["id"] for unit in detail["units"]]

    def test_the_answers_and_the_form_travel_with_it(
        self,
        client: TestClient,
        db: Session,
        admin_token_tenant_a: str,
        popup_tenant_a: Popups,
    ) -> None:
        inventory = _inventory(client, admin_token_tenant_a, popup_tenant_a.id)
        booking = _book(
            client, admin_token_tenant_a, popup_tenant_a.id, inventory["room"]["id"]
        )
        _answer(
            db,
            booking["id"],
            snapshot={"booker": {"fields": [PASSPORT]}, "guests": {"mode": "off"}},
            booker_answers={"passport": "X1"},
            guests=[{"name": "Ada", "answers": {}}],
        )

        detail = client.get(
            f"{BASE}/bookings/{booking['id']}",
            headers=_headers(admin_token_tenant_a),
        ).json()

        assert detail["booker_answers"] == {"passport": "X1"}
        # The labels come with it, so the page can render an answer to a
        # question the step no longer asks.
        assert detail["form_snapshot"]["booker"]["fields"][0]["label"] == (
            "Passport number"
        )

    def test_an_unknown_booking_is_a_404(
        self, client: TestClient, admin_token_tenant_a: str
    ) -> None:
        response = client.get(
            f"{BASE}/bookings/{uuid.uuid4()}", headers=_headers(admin_token_tenant_a)
        )

        assert response.status_code == 404


class TestExportColumns:
    def test_a_column_per_question_with_the_label_it_was_asked_under(
        self,
        client: TestClient,
        db: Session,
        admin_token_tenant_a: str,
        popup_tenant_a: Popups,
    ) -> None:
        inventory = _inventory(client, admin_token_tenant_a, popup_tenant_a.id)
        booking = _book(
            client,
            admin_token_tenant_a,
            popup_tenant_a.id,
            inventory["room"]["id"],
            check_in=AUG_1,
            check_out=AUG_8,
        )
        _answer(
            db,
            booking["id"],
            snapshot={
                "booker": {"fields": [PASSPORT]},
                "guests": {"mode": "custom", "fields": [DIET]},
            },
            booker_answers={"passport": "X1"},
            guests=[
                {"name": "Ada", "answers": {"diet": "Vegetarian"}},
                {"name": "Grace", "answers": {"diet": "None"}},
            ],
        )

        response = client.get(
            f"{BASE}/export.csv",
            headers=_headers(admin_token_tenant_a),
            params={
                "popup_id": str(popup_tenant_a.id),
                "date_from": AUG_1,
                "date_to": AUG_10,
            },
        )

        assert response.status_code == 200, response.text
        header, row = response.text.splitlines()[:2]
        assert "Booking contact: Passport number" in header
        assert "Guest 1: Diet" in header
        assert "Guest 2: Diet" in header
        assert "X1" in row
        assert "Vegetarian" in row

    def test_an_export_with_no_forms_keeps_the_header_it_always_had(
        self, client: TestClient, admin_token_tenant_a: str, popup_tenant_a: Popups
    ) -> None:
        """The common case. Nobody asked anything, so nothing is added."""
        inventory = _inventory(client, admin_token_tenant_a, popup_tenant_a.id)
        _book(
            client,
            admin_token_tenant_a,
            popup_tenant_a.id,
            inventory["room"]["id"],
            check_in=SEP_1,
            check_out=SEP_8,
        )

        response = client.get(
            f"{BASE}/export.csv",
            headers=_headers(admin_token_tenant_a),
            params={
                "popup_id": str(popup_tenant_a.id),
                "date_from": SEP_1,
                "date_to": SEP_10,
            },
        )

        assert response.status_code == 200
        assert response.text.splitlines()[0].endswith("created_at")


class TestAnswerColumns:
    """`answer_columns` on its own, where the awkward shapes are cheap to set."""

    def _booking(self, snapshot: dict | None, guests: list[dict]):
        return AccommodationBookings.model_construct(
            form_snapshot=snapshot, guests=guests, booker_answers={}
        )

    def test_same_as_booker_exports_the_columns_it_collected(self) -> None:
        # The default mode stores no fields of its own. Reading the section
        # literally would export a booking's guest answers into no column.
        columns = answer_columns(
            [
                self._booking(
                    {
                        "booker": {"fields": [PASSPORT]},
                        "guests": {"mode": "same_as_booker", "fields": []},
                    },
                    [{"name": "Ada", "answers": {"passport": "X1"}}],
                )
            ]
        )

        assert [column.header for column in columns] == [
            "Booking contact: Passport number",
            "Guest 1: Passport number",
        ]

    def test_guest_columns_stop_at_the_largest_party_in_the_set(self) -> None:
        snapshot = {
            "booker": {"fields": []},
            "guests": {"mode": "custom", "fields": [DIET]},
        }
        columns = answer_columns(
            [
                self._booking(snapshot, [{"name": "Ada", "answers": {}}]),
                self._booking(
                    snapshot,
                    [
                        {"name": "Ada", "answers": {}},
                        {"name": "Grace", "answers": {}},
                        {"name": "Alan", "answers": {}},
                    ],
                ),
            ]
        )

        assert [column.header for column in columns] == [
            "Guest 1: Diet",
            "Guest 2: Diet",
            "Guest 3: Diet",
        ]

    def test_a_booking_from_before_the_form_adds_nothing(self) -> None:
        assert answer_columns([self._booking(None, [{"name": "Ada"}])]) == []

    def test_off_asks_the_guests_nothing_so_they_get_no_columns(self) -> None:
        columns = answer_columns(
            [
                self._booking(
                    {"booker": {"fields": [PASSPORT]}, "guests": {"mode": "off"}},
                    [{"name": "Ada", "answers": {}}],
                )
            ]
        )

        assert [column.header for column in columns] == [
            "Booking contact: Passport number"
        ]
