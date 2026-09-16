"""Tests for the scholarship status backfill migration."""

import importlib.util
import uuid
from pathlib import Path

from sqlmodel import Session

from app.api.application.models import Applications
from app.api.human.models import Humans
from app.api.popup.models import Popups
from app.api.sales_flow.crud import sales_flows_crud
from app.api.tenant.models import Tenants


def _load_migration_module():
    migration_path = (
        Path(__file__).resolve().parents[2] / "app" / "alembic" / "versions"
    )
    matches = list(migration_path.glob("*_backfill_pending_scholarship_status.py"))
    assert matches, "scholarship status backfill migration file not found"
    module_path = matches[0]
    spec = importlib.util.spec_from_file_location(module_path.stem, module_path)
    assert spec and spec.loader
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def test_backfill_pending_scholarship_status_preserves_existing_decisions(
    db: Session, tenant_a: Tenants
) -> None:
    popup = Popups(
        tenant_id=tenant_a.id,
        name="Scholarship Backfill",
        slug=f"scholarship-backfill-{uuid.uuid4().hex[:8]}",
    )
    db.add(popup)
    db.flush()
    flow = sales_flows_crud.provision_default_flow(
        db, popup_id=popup.id, tenant_id=tenant_a.id, sale_type="application"
    )

    def make_human() -> Humans:
        human = Humans(
            tenant_id=tenant_a.id,
            email=f"scholarship-backfill-{uuid.uuid4().hex[:8]}@test.com",
        )
        db.add(human)
        db.flush()
        return human

    pending = Applications(
        tenant_id=tenant_a.id,
        popup_id=popup.id,
        human_id=make_human().id,
        sales_flow_id=flow.id,
        scholarship_request=True,
        scholarship_status=None,
    )
    approved = Applications(
        tenant_id=tenant_a.id,
        popup_id=popup.id,
        human_id=make_human().id,
        sales_flow_id=flow.id,
        scholarship_request=True,
        scholarship_status="approved",
    )
    no_request = Applications(
        tenant_id=tenant_a.id,
        popup_id=popup.id,
        human_id=make_human().id,
        sales_flow_id=flow.id,
        scholarship_request=False,
        scholarship_status=None,
    )
    db.add_all([pending, approved, no_request])
    db.commit()

    migration_module = _load_migration_module()
    migration_module.backfill_pending_scholarship_status(db.connection())
    db.commit()
    db.refresh(pending)
    db.refresh(approved)
    db.refresh(no_request)

    assert pending.scholarship_status == "pending"
    assert approved.scholarship_status == "approved"
    assert no_request.scholarship_status is None
