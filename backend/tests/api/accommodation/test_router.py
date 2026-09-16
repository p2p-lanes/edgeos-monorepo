"""Backoffice API for lodging inventory.

Covers the surface PR 2 adds: properties, room types (with the shadow product
staying hidden), units, price rules, bulk operations, duplicate, manual
bookings, block-range, the calendar tree and the CSV export.
"""

import uuid
from datetime import date

from fastapi.testclient import TestClient
from sqlmodel import Session, select

from app.api.accommodation.models import Accommodations
from app.api.popup.models import Popups
from app.api.product.models import Products

BASE = "/api/v1/accommodations"

JUN_1 = "2026-06-01"
JUN_8 = "2026-06-08"
JUN_10 = "2026-06-10"
JUL_1 = "2026-07-01"


def _headers(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


def _create_property(
    client: TestClient, token: str, popup_id: uuid.UUID, **overrides
) -> dict:
    payload = {
        "popup_id": str(popup_id),
        "name": f"Property {uuid.uuid4().hex[:8]}",
        "tax_percentage": "12.00",
    }
    payload.update(overrides)
    response = client.post(f"{BASE}/properties", headers=_headers(token), json=payload)
    assert response.status_code == 201, response.text
    return response.json()


def _create_accommodation(
    client: TestClient,
    token: str,
    popup_id: uuid.UUID,
    property_id: str,
    **overrides,
) -> dict:
    payload = {
        "popup_id": str(popup_id),
        "property_id": property_id,
        "name": f"Room {uuid.uuid4().hex[:8]}",
        "guest_capacity": 2,
        "default_nightly_price": "120.00",
        "bookable_from": JUN_1,
        "bookable_to": JUL_1,
        "units_count": 2,
    }
    payload.update(overrides)
    # units_count=0 means "create it without units"; the field is optional.
    if not payload.get("units_count"):
        payload.pop("units_count", None)
    response = client.post(BASE, headers=_headers(token), json=payload)
    assert response.status_code == 201, response.text
    return response.json()


# ---------------------------------------------------------------------------
# Properties
# ---------------------------------------------------------------------------


class TestProperties:
    def test_create_list_and_patch(
        self, client: TestClient, admin_token_tenant_a: str, popup_tenant_a: Popups
    ) -> None:
        created = _create_property(client, admin_token_tenant_a, popup_tenant_a.id)
        assert created["tax_percentage"] == "12.00"

        listed = client.get(
            f"{BASE}/properties",
            headers=_headers(admin_token_tenant_a),
            params={"popup_id": str(popup_tenant_a.id)},
        )
        assert listed.status_code == 200
        assert created["id"] in [row["id"] for row in listed.json()["results"]]

        patched = client.patch(
            f"{BASE}/properties/{created['id']}",
            headers=_headers(admin_token_tenant_a),
            json={"contact_email": "owner@example.com", "tax_percentage": "21.00"},
        )
        assert patched.status_code == 200, patched.text
        assert patched.json()["contact_email"] == "owner@example.com"
        assert patched.json()["tax_percentage"] == "21.00"

    def test_duplicate_name_in_the_same_popup_is_rejected(
        self, client: TestClient, admin_token_tenant_a: str, popup_tenant_a: Popups
    ) -> None:
        name = f"Unique {uuid.uuid4().hex[:8]}"
        _create_property(client, admin_token_tenant_a, popup_tenant_a.id, name=name)
        again = client.post(
            f"{BASE}/properties",
            headers=_headers(admin_token_tenant_a),
            json={"popup_id": str(popup_tenant_a.id), "name": name},
        )
        assert again.status_code >= 400

    def test_delete_refuses_while_rooms_remain(
        self, client: TestClient, admin_token_tenant_a: str, popup_tenant_a: Popups
    ) -> None:
        prop = _create_property(client, admin_token_tenant_a, popup_tenant_a.id)
        _create_accommodation(
            client, admin_token_tenant_a, popup_tenant_a.id, prop["id"]
        )

        response = client.delete(
            f"{BASE}/properties/{prop['id']}", headers=_headers(admin_token_tenant_a)
        )
        assert response.status_code == 409

    def test_delete_refuses_while_soft_deleted_rooms_remain(
        self, client: TestClient, admin_token_tenant_a: str, popup_tenant_a: Popups
    ) -> None:
        """A retired room type still holds the FK, so the property is not free."""
        prop = _create_property(client, admin_token_tenant_a, popup_tenant_a.id)
        accommodation = _create_accommodation(
            client, admin_token_tenant_a, popup_tenant_a.id, prop["id"]
        )
        client.delete(
            f"{BASE}/{accommodation['id']}", headers=_headers(admin_token_tenant_a)
        )

        response = client.delete(
            f"{BASE}/properties/{prop['id']}", headers=_headers(admin_token_tenant_a)
        )
        assert response.status_code == 409

    def test_get_unknown_property_is_404(
        self, client: TestClient, admin_token_tenant_a: str
    ) -> None:
        response = client.get(
            f"{BASE}/properties/{uuid.uuid4()}", headers=_headers(admin_token_tenant_a)
        )
        assert response.status_code == 404


# ---------------------------------------------------------------------------
# Accommodations
# ---------------------------------------------------------------------------


class TestAccommodations:
    def test_create_returns_units_and_hides_the_shadow_product(
        self,
        client: TestClient,
        db: Session,
        admin_token_tenant_a: str,
        popup_tenant_a: Popups,
    ) -> None:
        prop = _create_property(client, admin_token_tenant_a, popup_tenant_a.id)
        created = _create_accommodation(
            client, admin_token_tenant_a, popup_tenant_a.id, prop["id"], units_count=3
        )

        assert len(created["units"]) == 3
        assert created["product_id"] is not None

        # The shadow product exists but must never surface in the product list.
        products = client.get(
            "/api/v1/products",
            headers=_headers(admin_token_tenant_a),
            params={"popup_id": str(popup_tenant_a.id)},
        )
        assert products.status_code == 200
        listed_ids = {row["id"] for row in products.json()["results"]}
        assert created["product_id"] not in listed_ids

        shadow = db.get(Products, uuid.UUID(created["product_id"]))
        assert shadow is not None
        assert shadow.managed_by == "accommodation"

    def test_property_from_another_popup_is_rejected(
        self,
        client: TestClient,
        admin_token_tenant_a: str,
        popup_tenant_a: Popups,
        popup_tenant_a_summer_fest: Popups,
    ) -> None:
        prop = _create_property(
            client, admin_token_tenant_a, popup_tenant_a_summer_fest.id
        )
        response = client.post(
            BASE,
            headers=_headers(admin_token_tenant_a),
            json={
                "popup_id": str(popup_tenant_a.id),
                "property_id": prop["id"],
                "name": "Cross-popup room",
                "default_nightly_price": "100.00",
                "bookable_from": JUN_1,
                "bookable_to": JUL_1,
            },
        )
        assert response.status_code == 422

    def test_inverted_bookable_window_is_rejected(
        self, client: TestClient, admin_token_tenant_a: str, popup_tenant_a: Popups
    ) -> None:
        prop = _create_property(client, admin_token_tenant_a, popup_tenant_a.id)
        response = client.post(
            BASE,
            headers=_headers(admin_token_tenant_a),
            json={
                "popup_id": str(popup_tenant_a.id),
                "property_id": prop["id"],
                "name": "Backwards room",
                "default_nightly_price": "100.00",
                "bookable_from": JUL_1,
                "bookable_to": JUN_1,
            },
        )
        assert response.status_code == 422

    def test_patch_syncs_the_shadow_product(
        self,
        client: TestClient,
        db: Session,
        admin_token_tenant_a: str,
        popup_tenant_a: Popups,
    ) -> None:
        prop = _create_property(client, admin_token_tenant_a, popup_tenant_a.id)
        created = _create_accommodation(
            client, admin_token_tenant_a, popup_tenant_a.id, prop["id"]
        )

        response = client.patch(
            f"{BASE}/{created['id']}",
            headers=_headers(admin_token_tenant_a),
            json={"name": "Renamed Suite", "default_nightly_price": "199.00"},
        )
        assert response.status_code == 200, response.text

        db.expire_all()
        shadow = db.get(Products, uuid.UUID(created["product_id"]))
        assert shadow.name == "Renamed Suite"
        assert str(shadow.price) == "199.00"

    def test_delete_is_a_soft_delete(
        self,
        client: TestClient,
        db: Session,
        admin_token_tenant_a: str,
        popup_tenant_a: Popups,
    ) -> None:
        prop = _create_property(client, admin_token_tenant_a, popup_tenant_a.id)
        created = _create_accommodation(
            client, admin_token_tenant_a, popup_tenant_a.id, prop["id"]
        )

        response = client.delete(
            f"{BASE}/{created['id']}", headers=_headers(admin_token_tenant_a)
        )
        assert response.status_code == 204

        assert (
            client.get(
                f"{BASE}/{created['id']}", headers=_headers(admin_token_tenant_a)
            ).status_code
            == 404
        )
        # The row survives, so its bookings keep resolving.
        db.expire_all()
        row = db.get(Accommodations, uuid.UUID(created["id"]))
        assert row is not None and row.deleted_at is not None

    def test_duplicate_copies_units_and_rules_but_no_bookings(
        self, client: TestClient, admin_token_tenant_a: str, popup_tenant_a: Popups
    ) -> None:
        prop = _create_property(client, admin_token_tenant_a, popup_tenant_a.id)
        source = _create_accommodation(
            client, admin_token_tenant_a, popup_tenant_a.id, prop["id"], units_count=4
        )
        client.post(
            f"{BASE}/{source['id']}/price-rules",
            headers=_headers(admin_token_tenant_a),
            json={
                "start_date": JUN_8,
                "end_date": JUN_10,
                "nightly_price": "150.00",
                "label": "High season",
            },
        )

        response = client.post(
            f"{BASE}/{source['id']}/duplicate",
            headers=_headers(admin_token_tenant_a),
            json={"name": "Copy of the suite", "copy_units": True},
        )
        assert response.status_code == 201, response.text
        copy = response.json()

        assert copy["id"] != source["id"]
        assert copy["name"] == "Copy of the suite"
        assert len(copy["units"]) == 4
        assert copy["product_id"] != source["product_id"]

        rules = client.get(
            f"{BASE}/{copy['id']}/price-rules", headers=_headers(admin_token_tenant_a)
        )
        assert len(rules.json()) == 1


# ---------------------------------------------------------------------------
# Units and price rules
# ---------------------------------------------------------------------------


class TestUnitsAndPriceRules:
    def test_bulk_units_skip_existing_labels(
        self, client: TestClient, admin_token_tenant_a: str, popup_tenant_a: Popups
    ) -> None:
        prop = _create_property(client, admin_token_tenant_a, popup_tenant_a.id)
        accommodation = _create_accommodation(
            client, admin_token_tenant_a, popup_tenant_a.id, prop["id"], units_count=0
        )

        first = client.post(
            f"{BASE}/{accommodation['id']}/units/bulk",
            headers=_headers(admin_token_tenant_a),
            json={"labels": ["201", "202", "203"]},
        )
        assert first.status_code == 201
        assert len(first.json()) == 3

        # Re-running the same call adds only what is missing.
        again = client.post(
            f"{BASE}/{accommodation['id']}/units/bulk",
            headers=_headers(admin_token_tenant_a),
            json={"labels": ["203", "204"]},
        )
        assert [unit["label"] for unit in again.json()] == ["204"]

    def test_prefix_and_count_generates_labels(
        self, client: TestClient, admin_token_tenant_a: str, popup_tenant_a: Popups
    ) -> None:
        prop = _create_property(client, admin_token_tenant_a, popup_tenant_a.id)
        accommodation = _create_accommodation(
            client, admin_token_tenant_a, popup_tenant_a.id, prop["id"], units_count=0
        )
        response = client.post(
            f"{BASE}/{accommodation['id']}/units/bulk",
            headers=_headers(admin_token_tenant_a),
            json={"prefix": "Cabin ", "count": 3},
        )
        assert [unit["label"] for unit in response.json()] == [
            "Cabin 1",
            "Cabin 2",
            "Cabin 3",
        ]

    def test_deleting_a_booked_unit_is_refused(
        self, client: TestClient, admin_token_tenant_a: str, popup_tenant_a: Popups
    ) -> None:
        prop = _create_property(client, admin_token_tenant_a, popup_tenant_a.id)
        accommodation = _create_accommodation(
            client, admin_token_tenant_a, popup_tenant_a.id, prop["id"], units_count=1
        )
        unit_id = accommodation["units"][0]["id"]

        booked = client.post(
            f"{BASE}/bookings",
            headers=_headers(admin_token_tenant_a),
            json={
                "popup_id": str(popup_tenant_a.id),
                "accommodation_id": accommodation["id"],
                "unit_id": unit_id,
                "check_in": JUN_1,
                "check_out": JUN_8,
                "primary_guest_name": "Ada",
            },
        )
        assert booked.status_code == 201, booked.text

        response = client.delete(
            f"{BASE}/units/{unit_id}", headers=_headers(admin_token_tenant_a)
        )
        assert response.status_code == 409

    def test_price_rule_crud(
        self, client: TestClient, admin_token_tenant_a: str, popup_tenant_a: Popups
    ) -> None:
        prop = _create_property(client, admin_token_tenant_a, popup_tenant_a.id)
        accommodation = _create_accommodation(
            client, admin_token_tenant_a, popup_tenant_a.id, prop["id"]
        )

        created = client.post(
            f"{BASE}/{accommodation['id']}/price-rules",
            headers=_headers(admin_token_tenant_a),
            json={
                "start_date": JUN_8,
                "end_date": JUN_10,
                "nightly_price": "150.00",
                "priority": 5,
            },
        )
        assert created.status_code == 201, created.text
        rule_id = created.json()["id"]

        patched = client.patch(
            f"{BASE}/price-rules/{rule_id}",
            headers=_headers(admin_token_tenant_a),
            json={"nightly_price": "170.00"},
        )
        assert patched.json()["nightly_price"] == "170.00"

        inverted = client.patch(
            f"{BASE}/price-rules/{rule_id}",
            headers=_headers(admin_token_tenant_a),
            json={"end_date": "2026-06-01"},
        )
        assert inverted.status_code == 422

        assert (
            client.delete(
                f"{BASE}/price-rules/{rule_id}", headers=_headers(admin_token_tenant_a)
            ).status_code
            == 204
        )


# ---------------------------------------------------------------------------
# Bulk
# ---------------------------------------------------------------------------


class TestBulk:
    def test_bulk_update_by_filter_touches_the_whole_property(
        self, client: TestClient, admin_token_tenant_a: str, popup_tenant_a: Popups
    ) -> None:
        prop = _create_property(client, admin_token_tenant_a, popup_tenant_a.id)
        first = _create_accommodation(
            client, admin_token_tenant_a, popup_tenant_a.id, prop["id"]
        )
        second = _create_accommodation(
            client, admin_token_tenant_a, popup_tenant_a.id, prop["id"]
        )

        response = client.post(
            f"{BASE}/bulk-update",
            headers=_headers(admin_token_tenant_a),
            json={
                "filter": {
                    "popup_id": str(popup_tenant_a.id),
                    "property_id": prop["id"],
                },
                "patch": {"min_stay_override": 4, "visible_in_checkout": False},
            },
        )
        assert response.status_code == 200, response.text
        assert response.json()["updated"] == 2

        for accommodation_id in (first["id"], second["id"]):
            row = client.get(
                f"{BASE}/{accommodation_id}", headers=_headers(admin_token_tenant_a)
            ).json()
            assert row["min_stay_override"] == 4
            assert row["visible_in_checkout"] is False

    def test_bulk_price_percent_moves_the_base_price(
        self, client: TestClient, admin_token_tenant_a: str, popup_tenant_a: Popups
    ) -> None:
        prop = _create_property(client, admin_token_tenant_a, popup_tenant_a.id)
        accommodation = _create_accommodation(
            client,
            admin_token_tenant_a,
            popup_tenant_a.id,
            prop["id"],
            default_nightly_price="100.00",
        )

        response = client.post(
            f"{BASE}/bulk-price",
            headers=_headers(admin_token_tenant_a),
            json={
                "ids": [accommodation["id"]],
                "mode": "percent",
                "value": "20",
            },
        )
        assert response.status_code == 200, response.text

        row = client.get(
            f"{BASE}/{accommodation['id']}", headers=_headers(admin_token_tenant_a)
        ).json()
        assert row["default_nightly_price"] == "120.00"

    def test_bulk_price_with_a_range_writes_a_rule_and_is_idempotent(
        self, client: TestClient, admin_token_tenant_a: str, popup_tenant_a: Popups
    ) -> None:
        prop = _create_property(client, admin_token_tenant_a, popup_tenant_a.id)
        accommodation = _create_accommodation(
            client,
            admin_token_tenant_a,
            popup_tenant_a.id,
            prop["id"],
            default_nightly_price="100.00",
        )
        payload = {
            "ids": [accommodation["id"]],
            "mode": "set",
            "value": "180",
            "start_date": JUN_8,
            "end_date": JUN_10,
            "label": "High season",
        }

        client.post(
            f"{BASE}/bulk-price", headers=_headers(admin_token_tenant_a), json=payload
        )
        client.post(
            f"{BASE}/bulk-price", headers=_headers(admin_token_tenant_a), json=payload
        )

        rules = client.get(
            f"{BASE}/{accommodation['id']}/price-rules",
            headers=_headers(admin_token_tenant_a),
        ).json()
        assert len(rules) == 1, "the same window must be replaced, not stacked"
        assert rules[0]["nightly_price"] == "180.00"

        # The base price is untouched: a season is an override, not a re-price.
        row = client.get(
            f"{BASE}/{accommodation['id']}", headers=_headers(admin_token_tenant_a)
        ).json()
        assert row["default_nightly_price"] == "100.00"

    def test_bulk_without_ids_or_filter_is_rejected(
        self, client: TestClient, admin_token_tenant_a: str
    ) -> None:
        response = client.post(
            f"{BASE}/bulk-update",
            headers=_headers(admin_token_tenant_a),
            json={"patch": {"is_active": False}},
        )
        assert response.status_code == 422


# ---------------------------------------------------------------------------
# Bookings, calendar, export
# ---------------------------------------------------------------------------


class TestBookingsAndCalendar:
    def test_manual_booking_is_confirmed_immediately(
        self, client: TestClient, admin_token_tenant_a: str, popup_tenant_a: Popups
    ) -> None:
        prop = _create_property(client, admin_token_tenant_a, popup_tenant_a.id)
        accommodation = _create_accommodation(
            client, admin_token_tenant_a, popup_tenant_a.id, prop["id"], units_count=1
        )

        response = client.post(
            f"{BASE}/bookings",
            headers=_headers(admin_token_tenant_a),
            json={
                "popup_id": str(popup_tenant_a.id),
                "accommodation_id": accommodation["id"],
                "check_in": JUN_1,
                "check_out": JUN_8,
                "guest_count": 2,
                "guests": [{"name": "Ada"}, {"name": "Grace"}],
                "primary_guest_name": "Ada",
            },
        )
        assert response.status_code == 201, response.text
        booking = response.json()
        assert booking["status"] == "confirmed"
        assert booking["nights"] == 7
        assert booking["unit_id"] == accommodation["units"][0]["id"]

    def test_second_booking_on_the_last_unit_is_409(
        self, client: TestClient, admin_token_tenant_a: str, popup_tenant_a: Popups
    ) -> None:
        prop = _create_property(client, admin_token_tenant_a, popup_tenant_a.id)
        accommodation = _create_accommodation(
            client, admin_token_tenant_a, popup_tenant_a.id, prop["id"], units_count=1
        )
        payload = {
            "popup_id": str(popup_tenant_a.id),
            "accommodation_id": accommodation["id"],
            "check_in": JUN_1,
            "check_out": JUN_8,
        }
        client.post(
            f"{BASE}/bookings", headers=_headers(admin_token_tenant_a), json=payload
        )
        second = client.post(
            f"{BASE}/bookings", headers=_headers(admin_token_tenant_a), json=payload
        )
        assert second.status_code == 409

    def test_restrictions_apply_unless_explicitly_ignored(
        self, client: TestClient, admin_token_tenant_a: str, popup_tenant_a: Popups
    ) -> None:
        prop = _create_property(client, admin_token_tenant_a, popup_tenant_a.id)
        accommodation = _create_accommodation(
            client,
            admin_token_tenant_a,
            popup_tenant_a.id,
            prop["id"],
            min_stay_override=5,
        )
        payload = {
            "popup_id": str(popup_tenant_a.id),
            "accommodation_id": accommodation["id"],
            "check_in": JUN_1,
            "check_out": "2026-06-03",
        }

        blocked = client.post(
            f"{BASE}/bookings", headers=_headers(admin_token_tenant_a), json=payload
        )
        assert blocked.status_code == 422
        assert blocked.json()["detail"] == "min_stay_not_met"

        allowed = client.post(
            f"{BASE}/bookings",
            headers=_headers(admin_token_tenant_a),
            json={**payload, "ignore_restrictions": True},
        )
        assert allowed.status_code == 201, allowed.text

    def test_block_range_blocks_every_free_unit_and_skips_the_taken_one(
        self, client: TestClient, admin_token_tenant_a: str, popup_tenant_a: Popups
    ) -> None:
        prop = _create_property(client, admin_token_tenant_a, popup_tenant_a.id)
        accommodation = _create_accommodation(
            client, admin_token_tenant_a, popup_tenant_a.id, prop["id"], units_count=3
        )
        client.post(
            f"{BASE}/bookings",
            headers=_headers(admin_token_tenant_a),
            json={
                "popup_id": str(popup_tenant_a.id),
                "accommodation_id": accommodation["id"],
                "check_in": JUN_1,
                "check_out": JUN_8,
            },
        )

        response = client.post(
            f"{BASE}/bookings/block-range",
            headers=_headers(admin_token_tenant_a),
            json={
                "popup_id": str(popup_tenant_a.id),
                "accommodation_id": accommodation["id"],
                "check_in": JUN_1,
                "check_out": JUN_8,
                "kind": "maintenance",
                "notes": "Repainting",
            },
        )
        assert response.status_code == 200, response.text
        assert response.json() == {
            "created": 2,
            "skipped": 1,
            "booking_ids": response.json()["booking_ids"],
        }

    def test_block_range_refuses_guest_kind(
        self, client: TestClient, admin_token_tenant_a: str, popup_tenant_a: Popups
    ) -> None:
        prop = _create_property(client, admin_token_tenant_a, popup_tenant_a.id)
        accommodation = _create_accommodation(
            client, admin_token_tenant_a, popup_tenant_a.id, prop["id"]
        )
        response = client.post(
            f"{BASE}/bookings/block-range",
            headers=_headers(admin_token_tenant_a),
            json={
                "popup_id": str(popup_tenant_a.id),
                "accommodation_id": accommodation["id"],
                "check_in": JUN_1,
                "check_out": JUN_8,
                "kind": "guest",
            },
        )
        assert response.status_code == 422

    def test_reassigning_to_a_taken_unit_is_409(
        self, client: TestClient, admin_token_tenant_a: str, popup_tenant_a: Popups
    ) -> None:
        prop = _create_property(client, admin_token_tenant_a, popup_tenant_a.id)
        accommodation = _create_accommodation(
            client, admin_token_tenant_a, popup_tenant_a.id, prop["id"], units_count=2
        )
        payload = {
            "popup_id": str(popup_tenant_a.id),
            "accommodation_id": accommodation["id"],
            "check_in": JUN_1,
            "check_out": JUN_8,
        }
        first = client.post(
            f"{BASE}/bookings", headers=_headers(admin_token_tenant_a), json=payload
        ).json()
        second = client.post(
            f"{BASE}/bookings", headers=_headers(admin_token_tenant_a), json=payload
        ).json()

        response = client.patch(
            f"{BASE}/bookings/{second['id']}",
            headers=_headers(admin_token_tenant_a),
            json={"unit_id": first["unit_id"]},
        )
        assert response.status_code == 409

    def test_cancelling_a_booking_frees_the_dates(
        self, client: TestClient, admin_token_tenant_a: str, popup_tenant_a: Popups
    ) -> None:
        prop = _create_property(client, admin_token_tenant_a, popup_tenant_a.id)
        accommodation = _create_accommodation(
            client, admin_token_tenant_a, popup_tenant_a.id, prop["id"], units_count=1
        )
        payload = {
            "popup_id": str(popup_tenant_a.id),
            "accommodation_id": accommodation["id"],
            "check_in": JUN_1,
            "check_out": JUN_8,
        }
        booking = client.post(
            f"{BASE}/bookings", headers=_headers(admin_token_tenant_a), json=payload
        ).json()

        cancelled = client.patch(
            f"{BASE}/bookings/{booking['id']}",
            headers=_headers(admin_token_tenant_a),
            json={"status": "cancelled"},
        )
        assert cancelled.status_code == 200

        rebooked = client.post(
            f"{BASE}/bookings", headers=_headers(admin_token_tenant_a), json=payload
        )
        assert rebooked.status_code == 201

    def test_calendar_returns_the_tree_with_availability_per_day(
        self, client: TestClient, admin_token_tenant_a: str, popup_tenant_a: Popups
    ) -> None:
        prop = _create_property(client, admin_token_tenant_a, popup_tenant_a.id)
        accommodation = _create_accommodation(
            client, admin_token_tenant_a, popup_tenant_a.id, prop["id"], units_count=2
        )
        client.post(
            f"{BASE}/bookings",
            headers=_headers(admin_token_tenant_a),
            json={
                "popup_id": str(popup_tenant_a.id),
                "accommodation_id": accommodation["id"],
                "check_in": JUN_1,
                "check_out": JUN_8,
                "primary_guest_name": "Ada",
            },
        )

        response = client.get(
            f"{BASE}/calendar",
            headers=_headers(admin_token_tenant_a),
            params={
                "popup_id": str(popup_tenant_a.id),
                "date_from": JUN_1,
                "date_to": JUN_10,
                "property_id": prop["id"],
            },
        )
        assert response.status_code == 200, response.text
        payload = response.json()

        room = payload["properties"][0]["accommodations"][0]
        assert len(room["units"]) == 2
        bars = [b for unit in room["units"] for b in unit["bookings"]]
        assert len(bars) == 1
        assert bars[0]["nights"] == 7

        # 2 units, one booked Jun 1-7 inclusive of nights, free again on the 8th.
        assert room["availability_by_day"]["2026-06-01"] == 1
        assert room["availability_by_day"]["2026-06-07"] == 1
        assert room["availability_by_day"]["2026-06-08"] == 2

    def test_calendar_rejects_an_inverted_window(
        self, client: TestClient, admin_token_tenant_a: str, popup_tenant_a: Popups
    ) -> None:
        response = client.get(
            f"{BASE}/calendar",
            headers=_headers(admin_token_tenant_a),
            params={
                "popup_id": str(popup_tenant_a.id),
                "date_from": JUN_10,
                "date_to": JUN_1,
            },
        )
        assert response.status_code == 422

    def test_availability_endpoint_explains_a_zero(
        self, client: TestClient, admin_token_tenant_a: str, popup_tenant_a: Popups
    ) -> None:
        prop = _create_property(client, admin_token_tenant_a, popup_tenant_a.id)
        _create_accommodation(
            client,
            admin_token_tenant_a,
            popup_tenant_a.id,
            prop["id"],
            min_stay_override=7,
        )

        response = client.get(
            f"{BASE}/availability",
            headers=_headers(admin_token_tenant_a),
            params={
                "popup_id": str(popup_tenant_a.id),
                "check_in": JUN_1,
                "check_out": "2026-06-03",
                "property_id": prop["id"],
            },
        )
        assert response.status_code == 200, response.text
        row = response.json()[0]
        assert row["available"] == 0
        assert row["unavailable_reason"] == "min_stay_not_met"

    def test_export_csv_carries_guests_and_amounts(
        self, client: TestClient, admin_token_tenant_a: str, popup_tenant_a: Popups
    ) -> None:
        prop = _create_property(client, admin_token_tenant_a, popup_tenant_a.id)
        accommodation = _create_accommodation(
            client, admin_token_tenant_a, popup_tenant_a.id, prop["id"], units_count=1
        )
        client.post(
            f"{BASE}/bookings",
            headers=_headers(admin_token_tenant_a),
            json={
                "popup_id": str(popup_tenant_a.id),
                "accommodation_id": accommodation["id"],
                "check_in": JUN_1,
                "check_out": JUN_8,
                "guest_count": 2,
                "guests": [{"name": "Ada"}, {"name": "Grace"}],
                "primary_guest_name": "Ada",
                "primary_guest_email": "ada@example.com",
            },
        )

        response = client.get(
            f"{BASE}/export.csv",
            headers=_headers(admin_token_tenant_a),
            params={
                "popup_id": str(popup_tenant_a.id),
                "date_from": JUN_1,
                "date_to": JUN_10,
            },
        )
        assert response.status_code == 200
        assert response.headers["content-type"].startswith("text/csv")

        body = response.text
        assert "booking_id,status,kind,property" in body
        assert "Ada; Grace" in body
        assert "ada@example.com" in body


# ---------------------------------------------------------------------------
# Photo bank
# ---------------------------------------------------------------------------


class TestImages:
    def test_images_are_linked_ordered_and_mirrored_to_the_shadow_product(
        self,
        client: TestClient,
        db: Session,
        admin_token_tenant_a: str,
        popup_tenant_a: Popups,
    ) -> None:
        prop = _create_property(client, admin_token_tenant_a, popup_tenant_a.id)
        accommodation = _create_accommodation(
            client, admin_token_tenant_a, popup_tenant_a.id, prop["id"]
        )

        images = []
        for index in range(2):
            response = client.post(
                f"{BASE}/images",
                headers=_headers(admin_token_tenant_a),
                json={
                    "popup_id": str(popup_tenant_a.id),
                    "url": f"https://cdn.example.com/room-{index}.jpg",
                },
            )
            assert response.status_code == 201, response.text
            images.append(response.json())

        # Deliberately reversed: position 0 becomes the cover.
        ordered = [images[1]["id"], images[0]["id"]]
        response = client.put(
            f"{BASE}/{accommodation['id']}/images",
            headers=_headers(admin_token_tenant_a),
            json=ordered,
        )
        assert response.status_code == 200, response.text
        assert [row["id"] for row in response.json()] == ordered

        db.expire_all()
        shadow = db.get(Products, uuid.UUID(accommodation["product_id"]))
        assert shadow.image_url == images[1]["url"]
        assert shadow.images == [images[1]["url"], images[0]["url"]]

    def test_listing_images_is_scoped_to_the_popup(
        self, client: TestClient, admin_token_tenant_a: str, popup_tenant_a: Popups
    ) -> None:
        response = client.get(
            f"{BASE}/images",
            headers=_headers(admin_token_tenant_a),
            params={"popup_id": str(popup_tenant_a.id)},
        )
        assert response.status_code == 200
        assert all(
            row["url"].startswith("https://") for row in response.json()["results"]
        )


# ---------------------------------------------------------------------------
# Auth
# ---------------------------------------------------------------------------


class TestAuth:
    def test_anonymous_access_is_rejected(self, client: TestClient) -> None:
        response = client.get(
            f"{BASE}/properties", params={"popup_id": str(uuid.uuid4())}
        )
        assert response.status_code in (401, 403)

    def test_viewer_cannot_write(
        self,
        client: TestClient,
        viewer_token_tenant_a: str,
        popup_tenant_a: Popups,
    ) -> None:
        response = client.post(
            f"{BASE}/properties",
            headers=_headers(viewer_token_tenant_a),
            json={"popup_id": str(popup_tenant_a.id), "name": "Viewer property"},
        )
        assert response.status_code in (401, 403)

    def test_another_tenant_cannot_read_the_inventory(
        self,
        client: TestClient,
        admin_token_tenant_a: str,
        admin_token_tenant_b: str,
        popup_tenant_a: Popups,
    ) -> None:
        prop = _create_property(client, admin_token_tenant_a, popup_tenant_a.id)

        response = client.get(
            f"{BASE}/properties/{prop['id']}", headers=_headers(admin_token_tenant_b)
        )
        assert response.status_code == 404


def test_soft_deleted_rooms_disappear_from_the_list(
    client: TestClient, db: Session, admin_token_tenant_a: str, popup_tenant_a: Popups
) -> None:
    prop = _create_property(client, admin_token_tenant_a, popup_tenant_a.id)
    accommodation = _create_accommodation(
        client, admin_token_tenant_a, popup_tenant_a.id, prop["id"]
    )
    client.delete(
        f"{BASE}/{accommodation['id']}", headers=_headers(admin_token_tenant_a)
    )

    listed = client.get(
        BASE,
        headers=_headers(admin_token_tenant_a),
        params={"popup_id": str(popup_tenant_a.id), "property_id": prop["id"]},
    )
    assert accommodation["id"] not in [row["id"] for row in listed.json()["results"]]

    surviving = db.exec(
        select(Accommodations).where(
            Accommodations.id == uuid.UUID(accommodation["id"])
        )
    ).first()
    assert surviving is not None
    assert isinstance(surviving.bookable_from, date)
