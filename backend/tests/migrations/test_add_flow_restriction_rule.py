"""Migration test for add_flow_restriction_rule (9cd317fadfa5).

Design: sdd/sales-flows slice 12 (D5/D6, G3 checkpoint 12.8 CONFIRMED
2026-08-04) — nullable JSONB `restriction_rule` on `sales_flows`. No
backfill, no data migration: every existing row gets NULL (feature off,
matching the pre-slice-12 status quo).

Scenarios:
- Migration adds a nullable `restriction_rule` JSONB column to `sales_flows`.
- A flow may be created/updated with `restriction_rule = NULL` (existing
  rows, unaffected by this change).
- A flow may store a valid AND/OR predicate tree as JSONB and read it back.
- `alembic heads` -> single head after this migration.
- The shipped module's `upgrade()`/`downgrade()` are exercised directly via
  a mocked `op`.
"""

import importlib.util
import io
import json
import uuid
from pathlib import Path
from unittest.mock import MagicMock, patch

from sqlmodel import Session, text

from app.api.tenant.models import Tenants


def _load_migration_module():
    migration_path = (
        Path(__file__).resolve().parents[2] / "app" / "alembic" / "versions"
    )
    matches = list(migration_path.glob("9cd317fadfa5_add_flow_restriction_rule.py"))
    assert matches, "9cd317fadfa5_add_flow_restriction_rule migration file not found"

    module_path = matches[0]
    spec = importlib.util.spec_from_file_location(module_path.stem, module_path)
    assert spec and spec.loader
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def _insert_popup(db: Session, tenant_id: uuid.UUID) -> uuid.UUID:
    popup_id = uuid.uuid4()
    db.exec(
        text(
            "INSERT INTO popups (id, tenant_id, name, slug, sale_type, status, currency) "
            "VALUES (:id, :tid, :name, :slug, 'application', 'active', 'ARS')"
        ).bindparams(
            id=popup_id,
            tid=tenant_id,
            name=f"Restriction Rule Test Popup {popup_id.hex[:8]}",
            slug=f"restriction-rule-test-{popup_id.hex[:8]}",
        )
    )
    db.commit()
    return popup_id


def _insert_flow(
    db: Session,
    tenant_id: uuid.UUID,
    popup_id: uuid.UUID,
    *,
    restriction_rule: dict | None = None,
) -> uuid.UUID:
    flow_id = uuid.uuid4()
    db.exec(
        text(
            "INSERT INTO sales_flows "
            "(id, tenant_id, popup_id, type, slug, name, visibility, "
            'is_default, "order", reviewers_mode, identity_mode, restriction_rule) '
            "VALUES (:id, :tid, :pid, 'direct', :slug, 'Flow', "
            "'portal_listed', false, 0, 'inherit', 'portal_auth', "
            "CAST(:rule AS jsonb))"
        ).bindparams(
            id=flow_id,
            tid=tenant_id,
            pid=popup_id,
            slug=f"flow-{flow_id.hex[:8]}",
            rule=json.dumps(restriction_rule) if restriction_rule is not None else None,
        )
    )
    db.commit()
    return flow_id


def _cleanup(db: Session, popup_id: uuid.UUID) -> None:
    db.exec(
        text("DELETE FROM sales_flows WHERE popup_id = :id").bindparams(id=popup_id)
    )
    db.exec(text("DELETE FROM popups WHERE id = :id").bindparams(id=popup_id))
    db.commit()


class TestAlembicSingleHead:
    def test_single_head_after_add_flow_restriction_rule(self) -> None:
        from alembic import command
        from alembic.config import Config

        cfg = Config("alembic.ini")
        output = io.StringIO()
        cfg.stdout = output
        command.heads(cfg)
        heads_output = output.getvalue().strip()
        lines = [ln for ln in heads_output.splitlines() if "(head)" in ln]
        assert len(lines) == 1, f"Expected single head, got: {heads_output}"


class TestRestrictionRuleColumn:
    def test_column_defaults_to_null(self, db: Session, tenant_a: Tenants) -> None:
        popup_id = _insert_popup(db, tenant_a.id)
        try:
            flow_id = _insert_flow(db, tenant_a.id, popup_id)
            resolved = db.exec(
                text(
                    "SELECT restriction_rule FROM sales_flows WHERE id = :id"
                ).bindparams(id=flow_id)
            ).scalar()
            assert resolved is None
        finally:
            _cleanup(db, popup_id)

    def test_column_stores_and_reads_back_predicate_tree(
        self, db: Session, tenant_a: Tenants
    ) -> None:
        popup_id = _insert_popup(db, tenant_a.id)
        try:
            rule = {
                "all_of": [
                    {
                        "kind": "has_product",
                        "scope": "product",
                        "value": str(uuid.uuid4()),
                    }
                ]
            }
            flow_id = _insert_flow(db, tenant_a.id, popup_id, restriction_rule=rule)
            resolved = db.exec(
                text(
                    "SELECT restriction_rule FROM sales_flows WHERE id = :id"
                ).bindparams(id=flow_id)
            ).scalar()
            assert resolved == rule
        finally:
            _cleanup(db, popup_id)


class TestMigrationModule:
    def test_upgrade_adds_nullable_jsonb_column(self) -> None:
        module = _load_migration_module()

        with patch.object(module, "op") as mock_op:
            module.upgrade()

        mock_op.add_column.assert_called_once()
        args, _kwargs = mock_op.add_column.call_args
        assert args[0] == "sales_flows"
        column = args[1]
        assert column.name == "restriction_rule"
        assert column.nullable is True

    def test_downgrade_drops_column(self) -> None:
        module = _load_migration_module()

        mock_op = MagicMock()
        with patch.object(module, "op", mock_op):
            module.downgrade()

        mock_op.drop_column.assert_called_once_with("sales_flows", "restriction_rule")
