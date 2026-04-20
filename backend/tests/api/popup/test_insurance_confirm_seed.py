"""Tests for confirm step seed: template_config.insurance defaults present (Batch 4).

Verifies that when a new popup is created, its confirm step:
  - has template_config that includes the 'insurance' sub-key
  - insurance sub-config has all 4 required defaults: card_title, card_subtitle,
    toggle_label, benefits
"""
import uuid

from fastapi.testclient import TestClient
from sqlmodel import Session, select

from app.api.ticketing_step.models import TicketingSteps


def _admin_headers(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


class TestConfirmStepInsuranceSeed:
    def test_new_popup_confirm_step_has_insurance_template_config(
        self,
        client: TestClient,
        admin_token_tenant_a: str,
        db: Session,
    ) -> None:
        """Batch4: new popup → confirm step has template_config.insurance sub-key."""
        resp = client.post(
            "/api/v1/popups",
            headers=_admin_headers(admin_token_tenant_a),
            json={"name": f"ConfirmSeed {uuid.uuid4().hex[:8]}"},
        )
        assert resp.status_code == 201
        popup_id = uuid.UUID(resp.json()["id"])

        db.expire_all()
        step = db.exec(
            select(TicketingSteps).where(
                TicketingSteps.popup_id == popup_id,
                TicketingSteps.step_type == "confirm",
            )
        ).first()

        assert step is not None, "confirm step must be seeded"
        config = step.template_config
        assert config is not None, "confirm step must have template_config"
        assert isinstance(config, dict), "template_config must be a dict"
        assert "insurance" in config, "template_config must include 'insurance' sub-key"

    def test_new_popup_confirm_step_insurance_has_all_required_fields(
        self,
        client: TestClient,
        admin_token_tenant_a: str,
        db: Session,
    ) -> None:
        """Batch4: confirm step template_config.insurance has all 4 required defaults."""
        resp = client.post(
            "/api/v1/popups",
            headers=_admin_headers(admin_token_tenant_a),
            json={"name": f"ConfirmIns {uuid.uuid4().hex[:8]}"},
        )
        assert resp.status_code == 201
        popup_id = uuid.UUID(resp.json()["id"])

        db.expire_all()
        step = db.exec(
            select(TicketingSteps).where(
                TicketingSteps.popup_id == popup_id,
                TicketingSteps.step_type == "confirm",
            )
        ).first()

        assert step is not None
        ins = step.template_config["insurance"]  # type: ignore[index]
        assert isinstance(ins, dict), "insurance sub-config must be a dict"
        assert "card_title" in ins
        assert "card_subtitle" in ins
        assert "toggle_label" in ins
        assert "benefits" in ins
        assert isinstance(ins["benefits"], list)
        assert len(ins["benefits"]) > 0

    def test_new_popup_does_not_seed_insurance_checkout_step(
        self,
        client: TestClient,
        admin_token_tenant_a: str,
        db: Session,
    ) -> None:
        """Batch4: new popup → NO insurance_checkout step row is seeded."""
        resp = client.post(
            "/api/v1/popups",
            headers=_admin_headers(admin_token_tenant_a),
            json={"name": f"NoInsStep {uuid.uuid4().hex[:8]}"},
        )
        assert resp.status_code == 201
        popup_id = uuid.UUID(resp.json()["id"])

        db.expire_all()
        step = db.exec(
            select(TicketingSteps).where(
                TicketingSteps.popup_id == popup_id,
                TicketingSteps.step_type == "insurance_checkout",
            )
        ).first()

        assert step is None, "insurance_checkout step must NOT be seeded (removed in batch 4)"
