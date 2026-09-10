"""The `accommodation-booking` ticketing step.

Accommodation is a normal configurable step: it reuses the seeded ``housing``
step_type and only its template is new. The config it holds is small on
purpose (which properties are offered, how they look, whether guest names
are collected) because the inventory itself lives in the Accommodations section
and is shared across steps.

Validation follows the same split as ticket-select: Pydantic checks the shape,
the router checks that the ids actually belong to the gathering.
"""

import uuid

from fastapi.testclient import TestClient
from sqlmodel import Session

from app.api.accommodation.crud import accommodation_properties_crud
from app.api.accommodation.schemas import AccommodationPropertyCreate
from app.api.popup.models import Popups
from app.api.sales_flow.crud import sales_flows_crud
from app.api.sales_flow.models import SalesFlows
from app.api.tenant.models import Tenants

BASE = "/api/v1/ticketing-steps"


def _auth(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


def _make_property(db: Session, popup: Popups, tenant: Tenants):
    row = accommodation_properties_crud.create_for_tenant(
        db,
        AccommodationPropertyCreate(
            popup_id=popup.id, name=f"Property {uuid.uuid4().hex[:8]}"
        ),
        tenant.id,
    )
    db.commit()
    return row


def _flow_id(db: Session, popup: Popups) -> uuid.UUID:
    flow = sales_flows_crud.get_default_flow(db, popup.id)
    if flow is None:
        flow = SalesFlows(
            tenant_id=popup.tenant_id,
            popup_id=popup.id,
            slug="checkout",
            name="Checkout",
            type=popup.sale_type,
            is_default=True,
        )
        db.add(flow)
        db.flush()
    return flow.id


def _step_payload(db: Session, popup: Popups, config: dict | None = None) -> dict:
    return {
        "popup_id": str(popup.id),
        "sales_flow_id": str(_flow_id(db, popup)),
        "step_type": "housing",
        "title": f"Accommodation {uuid.uuid4().hex[:6]}",
        "template": "accommodation-booking",
        "template_config": config,
    }


class TestDefaults:
    def test_an_empty_config_is_filled_with_defaults(
        self,
        client: TestClient,
        db: Session,
        admin_token_tenant_a: str,
        popup_tenant_a: Popups,
    ) -> None:
        """A step must work the moment it is enabled, without an admin having
        to tick anything."""
        response = client.post(
            BASE,
            headers=_auth(admin_token_tenant_a),
            json=_step_payload(db, popup_tenant_a, {}),
        )
        assert response.status_code == 201, response.text
        config = response.json()["template_config"]
        assert config == {
            "property_ids": [],
            "layout": "rows",
            "show_property_headers": True,
            "require_guest_names": True,
            "notice_text": None,
            # No questions until an operator writes some: the step asks for a
            # name per guest and nothing else out of the box.
            "guest_form": None,
        }

    def test_a_null_config_is_left_alone(
        self,
        client: TestClient,
        db: Session,
        admin_token_tenant_a: str,
        popup_tenant_a: Popups,
    ) -> None:
        response = client.post(
            BASE,
            headers=_auth(admin_token_tenant_a),
            json=_step_payload(db, popup_tenant_a, None),
        )
        assert response.status_code == 201, response.text
        assert response.json()["template_config"] is None

    def test_values_round_trip(
        self,
        client: TestClient,
        db: Session,
        admin_token_tenant_a: str,
        popup_tenant_a: Popups,
        tenant_a: Tenants,
    ) -> None:
        property_row = _make_property(db, popup_tenant_a, tenant_a)

        response = client.post(
            BASE,
            headers=_auth(admin_token_tenant_a),
            json=_step_payload(
                db,
                popup_tenant_a,
                {
                    "property_ids": [str(property_row.id)],
                    "layout": "sheet",
                    "show_property_headers": False,
                    "require_guest_names": False,
                    "notice_text": "Paid in full, non-refundable.",
                },
            ),
        )
        assert response.status_code == 201, response.text
        config = response.json()["template_config"]
        assert config["property_ids"] == [str(property_row.id)]
        assert config["layout"] == "sheet"
        assert config["show_property_headers"] is False
        assert config["require_guest_names"] is False
        assert config["notice_text"] == "Paid in full, non-refundable."


class TestLayoutNames:
    """The step shipped with two layouts and now offers three.

    "grid" and "list" are stored on every step configured before that, so
    they are still accepted and are renamed on the way in. A step nobody has
    edited since must not start answering 422 to its own stored config.
    """

    def test_the_old_names_are_renamed(
        self,
        client: TestClient,
        db: Session,
        admin_token_tenant_a: str,
        popup_tenant_a: Popups,
    ) -> None:
        for stored, expected in (("grid", "cards"), ("list", "rows")):
            response = client.post(
                BASE,
                headers=_auth(admin_token_tenant_a),
                json=_step_payload(db, popup_tenant_a, {"layout": stored}),
            )
            assert response.status_code == 201, response.text
            assert response.json()["template_config"]["layout"] == expected

    def test_every_current_layout_is_accepted(
        self,
        client: TestClient,
        db: Session,
        admin_token_tenant_a: str,
        popup_tenant_a: Popups,
    ) -> None:
        for layout in ("rows", "cards", "sheet"):
            response = client.post(
                BASE,
                headers=_auth(admin_token_tenant_a),
                json=_step_payload(db, popup_tenant_a, {"layout": layout}),
            )
            assert response.status_code == 201, response.text
            assert response.json()["template_config"]["layout"] == layout


class TestShapeValidation:
    def test_an_unknown_layout_is_rejected(
        self,
        client: TestClient,
        db: Session,
        admin_token_tenant_a: str,
        popup_tenant_a: Popups,
    ) -> None:
        response = client.post(
            BASE,
            headers=_auth(admin_token_tenant_a),
            json=_step_payload(db, popup_tenant_a, {"layout": "carousel"}),
        )
        assert response.status_code == 422

    def test_a_malformed_property_id_is_rejected(
        self,
        client: TestClient,
        db: Session,
        admin_token_tenant_a: str,
        popup_tenant_a: Popups,
    ) -> None:
        response = client.post(
            BASE,
            headers=_auth(admin_token_tenant_a),
            json=_step_payload(db, popup_tenant_a, {"property_ids": ["not-a-uuid"]}),
        )
        assert response.status_code == 422

    def test_duplicate_property_ids_are_rejected(
        self,
        client: TestClient,
        db: Session,
        admin_token_tenant_a: str,
        popup_tenant_a: Popups,
        tenant_a: Tenants,
    ) -> None:
        property_row = _make_property(db, popup_tenant_a, tenant_a)
        response = client.post(
            BASE,
            headers=_auth(admin_token_tenant_a),
            json=_step_payload(
                db,
                popup_tenant_a,
                {"property_ids": [str(property_row.id), str(property_row.id)]},
            ),
        )
        assert response.status_code == 422


class TestForeignKeyValidation:
    def test_a_property_from_another_gathering_is_rejected(
        self,
        client: TestClient,
        db: Session,
        admin_token_tenant_a: str,
        popup_tenant_a: Popups,
        popup_tenant_a_summer_fest: Popups,
        tenant_a: Tenants,
    ) -> None:
        """A stale id would silently narrow the checkout to nothing, so it is
        refused rather than ignored."""
        foreign = _make_property(db, popup_tenant_a_summer_fest, tenant_a)

        response = client.post(
            BASE,
            headers=_auth(admin_token_tenant_a),
            json=_step_payload(db, popup_tenant_a, {"property_ids": [str(foreign.id)]}),
        )
        assert response.status_code == 422
        assert "invalid_accommodation_property" in response.text

    def test_an_unknown_property_is_rejected(
        self,
        client: TestClient,
        db: Session,
        admin_token_tenant_a: str,
        popup_tenant_a: Popups,
    ) -> None:
        response = client.post(
            BASE,
            headers=_auth(admin_token_tenant_a),
            json=_step_payload(
                db, popup_tenant_a, {"property_ids": [str(uuid.uuid4())]}
            ),
        )
        assert response.status_code == 422

    def test_patching_in_a_foreign_property_is_rejected(
        self,
        client: TestClient,
        db: Session,
        admin_token_tenant_a: str,
        popup_tenant_a: Popups,
        popup_tenant_a_summer_fest: Popups,
        tenant_a: Tenants,
    ) -> None:
        created = client.post(
            BASE,
            headers=_auth(admin_token_tenant_a),
            json=_step_payload(db, popup_tenant_a, {}),
        )
        step_id = created.json()["id"]
        foreign = _make_property(db, popup_tenant_a_summer_fest, tenant_a)

        response = client.patch(
            f"{BASE}/{step_id}",
            headers=_auth(admin_token_tenant_a),
            json={
                "template": "accommodation-booking",
                "template_config": {"property_ids": [str(foreign.id)]},
            },
        )
        assert response.status_code == 422


class TestOtherTemplatesAreUnaffected:
    def test_the_legacy_housing_template_still_accepts_its_own_config(
        self,
        client: TestClient,
        db: Session,
        admin_token_tenant_a: str,
        popup_tenant_a: Popups,
    ) -> None:
        """`housing-date` keeps working untouched: popups already selling
        housing as plain products must not break."""
        response = client.post(
            BASE,
            headers=_auth(admin_token_tenant_a),
            json={
                "popup_id": str(popup_tenant_a.id),
                "sales_flow_id": str(_flow_id(db, popup_tenant_a)),
                "step_type": "housing",
                "title": f"Housing {uuid.uuid4().hex[:6]}",
                "template": "housing-date",
                "template_config": {
                    "variant": "grid",
                    "show_dates": True,
                    "property_ids": ["not-a-uuid-and-that-is-fine"],
                },
            },
        )
        assert response.status_code == 201, response.text
        assert response.json()["template_config"]["variant"] == "grid"

    def test_reordering_the_step_does_not_wipe_its_config(
        self,
        client: TestClient,
        db: Session,
        admin_token_tenant_a: str,
        popup_tenant_a: Popups,
    ) -> None:
        """Regression guard shared with every other template: a drag sends
        exactly {"order": n} and must not blank template_config."""
        created = client.post(
            BASE,
            headers=_auth(admin_token_tenant_a),
            json=_step_payload(db, popup_tenant_a, {"layout": "sheet"}),
        )
        step_id = created.json()["id"]

        patched = client.patch(
            f"{BASE}/{step_id}",
            headers=_auth(admin_token_tenant_a),
            json={"order": 3},
        )
        assert patched.status_code == 200, patched.text
        assert patched.json()["template_config"]["layout"] == "sheet"


class TestGuestForm:
    """The questions asked about the people staying.

    Stored on the step, so an operator writes them once and every room this
    checkout offers asks the same thing.
    """

    FORM = {
        "booker": {
            "fields": [
                {
                    "key": "full_name",
                    "type": "text",
                    "label": "Full name",
                    "required": True,
                }
            ]
        }
    }

    def _create(self, client, db, token, popup, config):
        return client.post(
            BASE, headers=_auth(token), json=_step_payload(db, popup, config)
        )

    def test_a_form_is_stored_in_its_canonical_shape(
        self,
        client: TestClient,
        db: Session,
        admin_token_tenant_a: str,
        popup_tenant_a: Popups,
    ) -> None:
        """Saved filled in, not as sent: the portal and the export both read
        this back, and neither should have to cope with an absent section."""
        response = self._create(
            client, db, admin_token_tenant_a, popup_tenant_a, {"guest_form": self.FORM}
        )

        assert response.status_code == 201, response.text
        form = response.json()["template_config"]["guest_form"]
        assert form["version"] == 1
        assert form["guests"] == {
            "title": None,
            "description": None,
            "fields": [],
            "mode": "same_as_booker",
        }
        assert form["booker"]["fields"][0]["options"] == []

    def test_a_field_type_the_checkout_cannot_render_is_rejected(
        self,
        client: TestClient,
        db: Session,
        admin_token_tenant_a: str,
        popup_tenant_a: Popups,
    ) -> None:
        response = self._create(
            client,
            db,
            admin_token_tenant_a,
            popup_tenant_a,
            {
                "guest_form": {
                    "booker": {
                        "fields": [
                            {"key": "sig", "type": "signature", "label": "Sign here"}
                        ]
                    }
                }
            },
        )

        assert response.status_code == 422, response.text

    def test_two_questions_cannot_share_a_key(
        self,
        client: TestClient,
        db: Session,
        admin_token_tenant_a: str,
        popup_tenant_a: Popups,
    ) -> None:
        """The key is where the answer is stored, so a duplicate is one
        question quietly overwriting the other's answer."""
        field = {"key": "age", "type": "number", "label": "Age"}
        response = self._create(
            client,
            db,
            admin_token_tenant_a,
            popup_tenant_a,
            {"guest_form": {"booker": {"fields": [field, {**field, "label": "Age?"}]}}},
        )

        assert response.status_code == 422, response.text

    def test_renaming_the_step_does_not_wipe_the_form(
        self,
        client: TestClient,
        db: Session,
        admin_token_tenant_a: str,
        popup_tenant_a: Popups,
    ) -> None:
        """The form is the most expensive thing in this config to lose: an
        operator built it by hand, and an inline rename sends no
        template_config at all."""
        created = self._create(
            client, db, admin_token_tenant_a, popup_tenant_a, {"guest_form": self.FORM}
        )
        step_id = created.json()["id"]

        patched = client.patch(
            f"{BASE}/{step_id}",
            headers=_auth(admin_token_tenant_a),
            json={"title": "Where you sleep"},
        )

        assert patched.status_code == 200, patched.text
        form = patched.json()["template_config"]["guest_form"]
        assert [field["key"] for field in form["booker"]["fields"]] == ["full_name"]
