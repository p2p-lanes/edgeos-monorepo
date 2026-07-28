"""Tests for regenerating FormFields.name on label edit while the key is unused.

The internal key follows the label until any application answer or ticketing
step visibility condition references it; from then on it is frozen.
"""

import uuid

from fastapi.testclient import TestClient
from sqlmodel import Session

from app.api.application.models import Applications
from app.api.human.models import Humans
from app.api.popup.models import Popups
from app.api.tenant.models import Tenants
from app.api.ticketing_step.models import TicketingSteps

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _admin_headers(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


def _create_field(
    client: TestClient,
    token: str,
    popup_id: str,
    label: str,
) -> dict:
    resp = client.post(
        "/api/v1/form-fields",
        headers=_admin_headers(token),
        json={"popup_id": popup_id, "label": label, "field_type": "text"},
    )
    assert resp.status_code == 201, resp.text
    return resp.json()


def _patch_field(
    client: TestClient,
    token: str,
    field_id: str,
    payload: dict,
) -> dict:
    resp = client.patch(
        f"/api/v1/form-fields/{field_id}",
        headers=_admin_headers(token),
        json=payload,
    )
    assert resp.status_code == 200, resp.text
    return resp.json()


def _create_application_with_answer(
    db: Session, tenant: Tenants, popup: Popups, field_name: str
) -> Applications:
    human = Humans(
        tenant_id=tenant.id,
        email=f"rename-test-{uuid.uuid4().hex[:8]}@example.com",
    )
    db.add(human)
    db.flush()
    application = Applications(
        tenant_id=tenant.id,
        popup_id=popup.id,
        human_id=human.id,
        custom_fields={field_name: "some answer"},
    )
    db.add(application)
    db.commit()
    db.refresh(application)
    return application


# ---------------------------------------------------------------------------
# Rename while unused
# ---------------------------------------------------------------------------


class TestRenameWhileUnused:
    def test_label_edit_regenerates_name(
        self,
        client: TestClient,
        admin_token_tenant_a: str,
        popup_tenant_a: Popups,
    ) -> None:
        suffix = uuid.uuid4().hex[:6]
        data = _create_field(
            client,
            admin_token_tenant_a,
            str(popup_tenant_a.id),
            label=f"New text field {suffix}",
        )
        assert data["name"] == f"new_text_field_{suffix}"

        updated = _patch_field(
            client,
            admin_token_tenant_a,
            data["id"],
            {"label": f"Dietary Restrictions {suffix}"},
        )
        assert updated["label"] == f"Dietary Restrictions {suffix}"
        assert updated["name"] == f"dietary_restrictions_{suffix}"

    def test_second_label_edit_follows_again(
        self,
        client: TestClient,
        admin_token_tenant_a: str,
        popup_tenant_a: Popups,
    ) -> None:
        suffix = uuid.uuid4().hex[:6]
        data = _create_field(
            client,
            admin_token_tenant_a,
            str(popup_tenant_a.id),
            label=f"New text field {suffix}",
        )
        _patch_field(
            client,
            admin_token_tenant_a,
            data["id"],
            {"label": f"First Rename {suffix}"},
        )
        updated = _patch_field(
            client,
            admin_token_tenant_a,
            data["id"],
            {"label": f"Second Rename {suffix}"},
        )
        assert updated["name"] == f"second_rename_{suffix}"

    def test_slug_collision_gets_suffixed(
        self,
        client: TestClient,
        admin_token_tenant_a: str,
        popup_tenant_a: Popups,
    ) -> None:
        suffix = uuid.uuid4().hex[:6]
        _create_field(
            client,
            admin_token_tenant_a,
            str(popup_tenant_a.id),
            label=f"Company Name {suffix}",
        )
        other = _create_field(
            client,
            admin_token_tenant_a,
            str(popup_tenant_a.id),
            label=f"Placeholder {suffix}",
        )
        updated = _patch_field(
            client,
            admin_token_tenant_a,
            other["id"],
            {"label": f"Company Name {suffix}"},
        )
        assert updated["name"] == f"company_name_{suffix}_1"

    def test_patch_without_label_keeps_name(
        self,
        client: TestClient,
        admin_token_tenant_a: str,
        popup_tenant_a: Popups,
    ) -> None:
        suffix = uuid.uuid4().hex[:6]
        data = _create_field(
            client,
            admin_token_tenant_a,
            str(popup_tenant_a.id),
            label=f"Untouched Label {suffix}",
        )
        updated = _patch_field(
            client,
            admin_token_tenant_a,
            data["id"],
            {"required": True},
        )
        assert updated["name"] == data["name"]
        assert updated["required"] is True

    def test_label_edit_with_same_slug_keeps_name(
        self,
        client: TestClient,
        admin_token_tenant_a: str,
        popup_tenant_a: Popups,
    ) -> None:
        suffix = uuid.uuid4().hex[:6]
        data = _create_field(
            client,
            admin_token_tenant_a,
            str(popup_tenant_a.id),
            label=f"Same Slug {suffix}",
        )
        # Different label text, identical slug — no pointless suffix churn.
        updated = _patch_field(
            client,
            admin_token_tenant_a,
            data["id"],
            {"label": f"Same  Slug   {suffix}!"},
        )
        assert updated["name"] == data["name"]


# ---------------------------------------------------------------------------
# Frozen after first use
# ---------------------------------------------------------------------------


class TestNameFrozenWhenUsed:
    def test_application_answer_freezes_name(
        self,
        client: TestClient,
        db: Session,
        admin_token_tenant_a: str,
        tenant_a: Tenants,
        popup_tenant_a: Popups,
    ) -> None:
        suffix = uuid.uuid4().hex[:6]
        data = _create_field(
            client,
            admin_token_tenant_a,
            str(popup_tenant_a.id),
            label=f"Answered Field {suffix}",
        )
        _create_application_with_answer(db, tenant_a, popup_tenant_a, data["name"])

        updated = _patch_field(
            client,
            admin_token_tenant_a,
            data["id"],
            {"label": f"Renamed After Answer {suffix}"},
        )
        assert updated["label"] == f"Renamed After Answer {suffix}"
        assert updated["name"] == data["name"]

    def test_ticketing_step_reference_freezes_name(
        self,
        client: TestClient,
        db: Session,
        admin_token_tenant_a: str,
        tenant_a: Tenants,
        popup_tenant_a: Popups,
    ) -> None:
        suffix = uuid.uuid4().hex[:6]
        data = _create_field(
            client,
            admin_token_tenant_a,
            str(popup_tenant_a.id),
            label=f"Step Gated Field {suffix}",
        )
        step = TicketingSteps(
            tenant_id=tenant_a.id,
            popup_id=popup_tenant_a.id,
            step_type="custom",
            title=f"Tickets {suffix}",
            template="ticket-select",
            template_config={
                "sections": [
                    {
                        "title": "Conditional section",
                        "visible_if": {"field_id": data["name"], "value": True},
                    }
                ]
            },
        )
        db.add(step)
        db.commit()

        updated = _patch_field(
            client,
            admin_token_tenant_a,
            data["id"],
            {"label": f"Renamed After Step {suffix}"},
        )
        assert updated["label"] == f"Renamed After Step {suffix}"
        assert updated["name"] == data["name"]
