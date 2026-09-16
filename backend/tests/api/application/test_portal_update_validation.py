"""Server-side validation on the portal application PATCH path.

The portal's real submit flow is create-draft then PATCH with
status="in review", so the PATCH route must enforce the same required,
type, and option checks as the create path. Draft saves only type-check
the values provided.
"""

import uuid

from fastapi.testclient import TestClient
from sqlmodel import Session

from app.api.application.models import Applications
from app.api.application.schemas import ApplicationStatus
from app.api.form_field.models import FormFields
from app.api.form_section.models import FormSections
from app.api.group.models import Groups
from app.api.human.models import Humans
from app.api.popup.models import Popups
from app.api.tenant.models import Tenants
from app.core.security import create_access_token
from tests._flow_helpers import (
    default_flow_id,
    group_flow_id,
    provision_default_flow,
)

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _make_popup(db: Session, tenant: Tenants) -> Popups:
    slug = f"upd-val-{uuid.uuid4().hex[:8]}"
    popup = Popups(name=f"Update Validation {slug}", slug=slug, tenant_id=tenant.id)
    db.add(popup)
    db.commit()
    db.refresh(popup)
    provision_default_flow(db, popup)
    return popup


def _make_field(
    db: Session,
    popup: Popups,
    *,
    name: str,
    label: str,
    field_type: str = "text",
    required: bool = True,
    options: list[str] | None = None,
    position: int = 0,
) -> FormFields:
    field = FormFields(
        tenant_id=popup.tenant_id,
        popup_id=popup.id,
        sales_flow_id=default_flow_id(db, popup.id),
        name=name,
        label=label,
        field_type=field_type,
        required=required,
        options=options,
        position=position,
    )
    db.add(field)
    db.commit()
    db.refresh(field)
    return field


def _make_human_token(db: Session, tenant: Tenants) -> tuple[Humans, str]:
    human = Humans(
        tenant_id=tenant.id,
        email=f"upd-val-{uuid.uuid4().hex[:8]}@test.com",
        first_name="Pat",
        last_name="Doe",
    )
    db.add(human)
    db.commit()
    db.refresh(human)
    return human, create_access_token(subject=human.id, token_type="human")


def _headers(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


def _create_draft(
    client: TestClient,
    token: str,
    popup: Popups,
    custom_fields: dict | None = None,
) -> dict:
    payload: dict = {
        "popup_id": str(popup.id),
        "first_name": "Pat",
        "last_name": "Doe",
        "status": "draft",
    }
    if custom_fields is not None:
        payload["custom_fields"] = custom_fields
    resp = client.post("/api/v1/applications/my", headers=_headers(token), json=payload)
    assert resp.status_code == 201, resp.text
    return resp.json()


def _patch(client: TestClient, db: Session, token: str, popup: Popups, payload: dict):
    return client.patch(
        f"/api/v1/applications/my/{popup.id}",
        headers=_headers(token),
        params={"sales_flow_id": str(default_flow_id(db, popup.id))},
        json=payload,
    )


def _errors(resp) -> list[str]:
    return resp.json()["detail"]["errors"]


# ---------------------------------------------------------------------------
# PATCH submit validation (Fix 1)
# ---------------------------------------------------------------------------


class TestPatchSubmitValidation:
    def test_submit_missing_required_custom_field_returns_400(
        self, client: TestClient, db: Session, tenant_a: Tenants
    ) -> None:
        popup = _make_popup(db, tenant_a)
        _make_field(db, popup, name="motivation", label="Motivation")
        _, token = _make_human_token(db, tenant_a)
        _create_draft(client, token, popup)

        resp = _patch(client, db, token, popup, {"status": "in review"})

        assert resp.status_code == 400, resp.text
        assert any("Motivation" in e for e in _errors(resp))

    def test_submit_with_invalid_select_option_returns_400(
        self, client: TestClient, db: Session, tenant_a: Tenants
    ) -> None:
        popup = _make_popup(db, tenant_a)
        _make_field(
            db,
            popup,
            name="shirt_size",
            label="Shirt size",
            field_type="select",
            options=["S", "M", "L"],
        )
        _, token = _make_human_token(db, tenant_a)
        _create_draft(client, token, popup)

        resp = _patch(
            client,
            db,
            token,
            popup,
            {"status": "in review", "custom_fields": {"shirt_size": "XXL"}},
        )

        assert resp.status_code == 400, resp.text
        assert any("must be one of" in e for e in _errors(resp))

    def test_unknown_custom_fields_do_not_bypass_required_checks(
        self, client: TestClient, db: Session, tenant_a: Tenants
    ) -> None:
        popup = _make_popup(db, tenant_a)
        _make_field(db, popup, name="motivation", label="Motivation")
        _, token = _make_human_token(db, tenant_a)
        _create_draft(client, token, popup)

        resp = _patch(
            client,
            db,
            token,
            popup,
            {"status": "in review", "custom_fields": {"mystery_key": "x"}},
        )

        assert resp.status_code == 400, resp.text
        assert any("Motivation" in e for e in _errors(resp))

    def test_unknown_custom_fields_are_stored_alongside_valid_ones(
        self, client: TestClient, db: Session, tenant_a: Tenants
    ) -> None:
        """Unknown keys are skipped in validation (create-path semantics) and
        stored with the rest of the payload."""
        popup = _make_popup(db, tenant_a)
        _make_field(db, popup, name="motivation", label="Motivation")
        _, token = _make_human_token(db, tenant_a)
        _create_draft(client, token, popup)

        resp = _patch(
            client,
            db,
            token,
            popup,
            {
                "status": "in review",
                "custom_fields": {"motivation": "I want in", "mystery_key": "x"},
            },
        )

        assert resp.status_code == 200, resp.text
        stored = resp.json()["custom_fields"]
        assert stored["motivation"] == "I want in"
        assert stored["mystery_key"] == "x"

    def test_draft_partial_update_skips_required_checks(
        self, client: TestClient, db: Session, tenant_a: Tenants
    ) -> None:
        popup = _make_popup(db, tenant_a)
        _make_field(db, popup, name="motivation", label="Motivation")
        _make_field(
            db,
            popup,
            name="shirt_size",
            label="Shirt size",
            field_type="select",
            options=["S", "M", "L"],
            position=1,
        )
        _, token = _make_human_token(db, tenant_a)
        _create_draft(client, token, popup)

        resp = _patch(client, db, token, popup, {"custom_fields": {"shirt_size": "M"}})

        assert resp.status_code == 200, resp.text
        assert resp.json()["status"] == ApplicationStatus.DRAFT.value

    def test_draft_update_still_type_checks_provided_values(
        self, client: TestClient, db: Session, tenant_a: Tenants
    ) -> None:
        popup = _make_popup(db, tenant_a)
        _make_field(
            db,
            popup,
            name="shirt_size",
            label="Shirt size",
            field_type="select",
            options=["S", "M", "L"],
        )
        _, token = _make_human_token(db, tenant_a)
        _create_draft(client, token, popup)

        resp = _patch(
            client, db, token, popup, {"custom_fields": {"shirt_size": "XXL"}}
        )

        assert resp.status_code == 400, resp.text
        assert any("must be one of" in e for e in _errors(resp))

    def test_edit_after_submit_with_full_state_passes(
        self, client: TestClient, db: Session, tenant_a: Tenants
    ) -> None:
        """Editing a submitted application with the full form state (what the
        portal always sends) passes and stores exactly that state."""
        popup = _make_popup(db, tenant_a)
        _make_field(db, popup, name="motivation", label="Motivation")
        _make_field(
            db,
            popup,
            name="shirt_size",
            label="Shirt size",
            field_type="select",
            options=["S", "M", "L"],
            position=1,
        )
        _, token = _make_human_token(db, tenant_a)
        _create_draft(
            client, token, popup, {"motivation": "I want in", "shirt_size": "S"}
        )
        submit = _patch(client, db, token, popup, {"status": "in review"})
        assert submit.status_code == 200, submit.text

        resp = _patch(
            client,
            db,
            token,
            popup,
            {"custom_fields": {"motivation": "I want in", "shirt_size": "M"}},
        )

        assert resp.status_code == 200, resp.text
        stored = resp.json()["custom_fields"]
        assert stored["shirt_size"] == "M"
        assert stored["motivation"] == "I want in"

    def test_edit_after_submit_rejects_invalid_option(
        self, client: TestClient, db: Session, tenant_a: Tenants
    ) -> None:
        popup = _make_popup(db, tenant_a)
        _make_field(
            db,
            popup,
            name="shirt_size",
            label="Shirt size",
            field_type="select",
            options=["S", "M", "L"],
        )
        _, token = _make_human_token(db, tenant_a)
        _create_draft(client, token, popup, {"shirt_size": "S"})
        submit = _patch(client, db, token, popup, {"status": "in review"})
        assert submit.status_code == 200, submit.text

        resp = _patch(
            client, db, token, popup, {"custom_fields": {"shirt_size": "XXL"}}
        )

        assert resp.status_code == 400, resp.text
        assert any("must be one of" in e for e in _errors(resp))


# ---------------------------------------------------------------------------
# Non-draft create with empty/absent custom_fields (Fix 2)
# ---------------------------------------------------------------------------


class TestNonDraftCreateRequiresCustomFields:
    def test_create_in_review_without_custom_fields_returns_400(
        self, client: TestClient, db: Session, tenant_a: Tenants
    ) -> None:
        popup = _make_popup(db, tenant_a)
        _make_field(db, popup, name="motivation", label="Motivation")
        _, token = _make_human_token(db, tenant_a)

        resp = client.post(
            "/api/v1/applications/my",
            headers=_headers(token),
            json={
                "popup_id": str(popup.id),
                "first_name": "Pat",
                "last_name": "Doe",
                "status": "in review",
            },
        )

        assert resp.status_code == 400, resp.text
        assert any("Motivation" in e for e in _errors(resp))

    def test_create_in_review_with_empty_custom_fields_returns_400(
        self, client: TestClient, db: Session, tenant_a: Tenants
    ) -> None:
        popup = _make_popup(db, tenant_a)
        _make_field(db, popup, name="motivation", label="Motivation")
        _, token = _make_human_token(db, tenant_a)

        resp = client.post(
            "/api/v1/applications/my",
            headers=_headers(token),
            json={
                "popup_id": str(popup.id),
                "first_name": "Pat",
                "last_name": "Doe",
                "status": "in review",
                "custom_fields": {},
            },
        )

        assert resp.status_code == 400, resp.text
        assert any("Motivation" in e for e in _errors(resp))

    def test_create_draft_without_custom_fields_succeeds(
        self, client: TestClient, db: Session, tenant_a: Tenants
    ) -> None:
        popup = _make_popup(db, tenant_a)
        _make_field(db, popup, name="motivation", label="Motivation")
        _, token = _make_human_token(db, tenant_a)

        data = _create_draft(client, token, popup)
        assert data["status"] == ApplicationStatus.DRAFT.value


# ---------------------------------------------------------------------------
# Replace semantics for custom_fields (Fix 3)
#
# The portal sends the full form state on every save and omits cleared/empty
# answers, so a schema-known key absent from the payload means "cleared".
# Keys the current form doesn't render (deleted/renamed/hidden fields, or
# fields outside the Express Checkout mini-form) are preserved.
# ---------------------------------------------------------------------------


class TestPatchReplaceSemantics:
    def test_omitting_optional_field_clears_it(
        self, client: TestClient, db: Session, tenant_a: Tenants
    ) -> None:
        popup = _make_popup(db, tenant_a)
        _make_field(db, popup, name="motivation", label="Motivation")
        _make_field(
            db, popup, name="nickname", label="Nickname", required=False, position=1
        )
        _, token = _make_human_token(db, tenant_a)
        _create_draft(
            client, token, popup, {"motivation": "I want in", "nickname": "Paddy"}
        )

        resp = _patch(
            client,
            db,
            token,
            popup,
            {"status": "in review", "custom_fields": {"motivation": "I want in"}},
        )

        assert resp.status_code == 200, resp.text
        stored = resp.json()["custom_fields"]
        assert "nickname" not in stored
        assert stored["motivation"] == "I want in"

    def test_orphan_keys_survive_updates_that_omit_them(
        self, client: TestClient, db: Session, tenant_a: Tenants
    ) -> None:
        """A stored key with no matching form field (deleted/renamed field)
        is preserved even though the payload doesn't mention it."""
        popup = _make_popup(db, tenant_a)
        _make_field(db, popup, name="motivation", label="Motivation")
        _, token = _make_human_token(db, tenant_a)
        _create_draft(
            client, token, popup, {"motivation": "I want in", "legacy_key": "keep me"}
        )

        resp = _patch(
            client,
            db,
            token,
            popup,
            {"status": "in review", "custom_fields": {"motivation": "still in"}},
        )

        assert resp.status_code == 200, resp.text
        stored = resp.json()["custom_fields"]
        assert stored["legacy_key"] == "keep me"
        assert stored["motivation"] == "still in"

    def test_required_field_absent_from_incoming_returns_400(
        self, client: TestClient, db: Session, tenant_a: Tenants
    ) -> None:
        """A stored answer must not satisfy a required check when the payload
        omits the field — the portal sends the full state, so absence means
        the user cleared it."""
        popup = _make_popup(db, tenant_a)
        _make_field(db, popup, name="motivation", label="Motivation")
        _make_field(
            db, popup, name="nickname", label="Nickname", required=False, position=1
        )
        _, token = _make_human_token(db, tenant_a)
        _create_draft(client, token, popup, {"motivation": "I want in"})

        resp = _patch(
            client,
            db,
            token,
            popup,
            {"status": "in review", "custom_fields": {"nickname": "Paddy"}},
        )

        assert resp.status_code == 400, resp.text
        assert any("Motivation" in e for e in _errors(resp))

    def test_hidden_section_answers_survive_updates(
        self, client: TestClient, db: Session, tenant_a: Tenants
    ) -> None:
        """Fields in hidden sections aren't rendered by the portal, so their
        stored answers are preserved instead of treated as cleared."""
        popup = _make_popup(db, tenant_a)
        _make_field(db, popup, name="motivation", label="Motivation")
        section = FormSections(
            tenant_id=popup.tenant_id,
            popup_id=popup.id,
            sales_flow_id=default_flow_id(db, popup.id),
            label="Hidden extras",
            hidden=True,
        )
        db.add(section)
        db.commit()
        db.refresh(section)
        hidden_field = _make_field(
            db, popup, name="extra_info", label="Extra info", required=False, position=1
        )
        hidden_field.section_id = section.id
        db.add(hidden_field)
        db.commit()
        _, token = _make_human_token(db, tenant_a)
        _create_draft(
            client, token, popup, {"motivation": "I want in", "extra_info": "kept"}
        )

        resp = _patch(
            client,
            db,
            token,
            popup,
            {"status": "in review", "custom_fields": {"motivation": "still in"}},
        )

        assert resp.status_code == 200, resp.text
        stored = resp.json()["custom_fields"]
        assert stored["extra_info"] == "kept"

    def test_express_checkout_update_preserves_unrendered_answers(
        self, client: TestClient, db: Session, tenant_a: Tenants
    ) -> None:
        """Group applications use the Express Checkout mini-form, which only
        renders a subset of the schema. Fields it doesn't render must survive
        the update and stay exempt from required checks."""
        popup = _make_popup(db, tenant_a)
        _make_field(db, popup, name="motivation", label="Motivation")
        _, token = _make_human_token(db, tenant_a)
        data = _create_draft(client, token, popup, {"motivation": "I want in"})

        group = Groups(
            sales_flow_id=group_flow_id(db, popup.id),
            tenant_id=popup.tenant_id,
            popup_id=popup.id,
            name="Test Group",
            slug=f"grp-{uuid.uuid4().hex[:8]}",
        )
        db.add(group)
        db.commit()
        db.refresh(group)
        app_row = db.get(Applications, uuid.UUID(data["id"]))
        assert app_row is not None
        app_row.group_id = group.id
        db.add(app_row)
        db.commit()

        resp = _patch(
            client, db, token, popup, {"status": "in review", "custom_fields": {}}
        )

        assert resp.status_code == 200, resp.text
        stored = resp.json()["custom_fields"]
        assert stored["motivation"] == "I want in"
