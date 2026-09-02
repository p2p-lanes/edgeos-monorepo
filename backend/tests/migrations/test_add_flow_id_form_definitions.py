"""Migration test for add_flow_id_form_definitions (597d9a2019ba).

Design: sdd/sales-flows slice 6 (Q1: flow-owned forms) — adds a nullable
`sales_flow_id` FK+index to `form_fields`, `form_sections`, and
`base_field_configs`. Uniqueness re-keys to a two-tier partial-index shape
(mirrors the `email_templates` scope pattern, `4f2b3c1d9e8a`):

- Flow tier: `(name, sales_flow_id)` / `(sales_flow_id, field_name)`,
  unique WHERE `sales_flow_id IS NOT NULL`.
- Popup-shared tier: `(name, popup_id)` / `(popup_id, field_name)`,
  unique WHERE `sales_flow_id IS NULL` — preserves today's enforcement for
  every pre-existing (and any future non-flow-owned) row.

`form_sections` has no pre-existing unique constraint, so it only gains the
nullable column + FK + index.

Scenarios:
- Migration adds the column/FK/index to all three tables.
- `uq_form_field_name_popup` / `uq_base_field_config_popup_field` are
  dropped and replaced by the two-tier partial unique indexes.
- Two rows with the same name/field_name in the same popup, scoped to
  DIFFERENT flows, both persist (this is the entire point of Q1).
- Two rows scoped to the SAME flow with the same name/field_name collide.
- Two popup-shared (`sales_flow_id IS NULL`) rows with the same
  name/field_name in the same popup still collide (legacy behavior
  unchanged).
- A popup-shared row and a flow-scoped row with the same name never
  collide with each other (different tiers).
- Downgrade aborts loudly (no column/constraint touched) if any
  cross-tier duplicate `(name, popup_id)` / `(popup_id, field_name)"
  pair exists — it NEVER deletes data.
- `alembic heads` -> single head after this migration.
"""

import importlib.util
import io
import uuid
from pathlib import Path
from unittest.mock import MagicMock, patch

import pytest
from sqlalchemy.exc import IntegrityError
from sqlmodel import Session, text

from app.api.tenant.models import Tenants


def _load_migration_module():
    migration_path = (
        Path(__file__).resolve().parents[2] / "app" / "alembic" / "versions"
    )
    matches = list(migration_path.glob("597d9a2019ba_add_flow_id_form_definitions.py"))
    assert matches, "597d9a2019ba_add_flow_id_form_definitions migration file not found"

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
            name=f"Form Flow Test Popup {popup_id.hex[:8]}",
            slug=f"form-flow-test-{popup_id.hex[:8]}",
        )
    )
    db.commit()
    return popup_id


def _insert_flow(
    db: Session, tenant_id: uuid.UUID, popup_id: uuid.UUID, *, slug: str
) -> uuid.UUID:
    flow_id = uuid.uuid4()
    db.exec(
        text(
            "INSERT INTO sales_flows "
            "(id, tenant_id, popup_id, type, slug, name, visibility, "
            'is_default, "order", reviewers_mode, identity_mode) '
            "VALUES (:id, :tid, :pid, 'application', :slug, :slug, "
            "'portal_listed', false, 0, 'inherit', 'portal_auth')"
        ).bindparams(id=flow_id, tid=tenant_id, pid=popup_id, slug=slug)
    )
    db.commit()
    return flow_id


def _insert_form_field(
    db: Session,
    tenant_id: uuid.UUID,
    popup_id: uuid.UUID,
    name: str,
    flow_id: uuid.UUID | None,
) -> None:
    db.exec(
        text(
            "INSERT INTO formfields "
            "(id, tenant_id, popup_id, name, label, field_type, sales_flow_id) "
            "VALUES (:id, :tid, :pid, :name, :name, 'text', :fid)"
        ).bindparams(
            id=uuid.uuid4(), tid=tenant_id, pid=popup_id, name=name, fid=flow_id
        )
    )
    db.commit()


def _insert_base_field_config(
    db: Session,
    tenant_id: uuid.UUID,
    popup_id: uuid.UUID,
    field_name: str,
    flow_id: uuid.UUID | None,
) -> None:
    db.exec(
        text(
            "INSERT INTO basefieldconfigs "
            "(id, tenant_id, popup_id, field_name, sales_flow_id) "
            "VALUES (:id, :tid, :pid, :fname, :fid)"
        ).bindparams(
            id=uuid.uuid4(), tid=tenant_id, pid=popup_id, fname=field_name, fid=flow_id
        )
    )
    db.commit()


def _cleanup(db: Session, popup_id: uuid.UUID) -> None:
    db.exec(text("DELETE FROM formfields WHERE popup_id = :id").bindparams(id=popup_id))
    db.exec(
        text("DELETE FROM basefieldconfigs WHERE popup_id = :id").bindparams(
            id=popup_id
        )
    )
    db.exec(
        text("DELETE FROM formsections WHERE popup_id = :id").bindparams(id=popup_id)
    )
    db.exec(
        text("DELETE FROM sales_flows WHERE popup_id = :id").bindparams(id=popup_id)
    )
    db.exec(text("DELETE FROM popups WHERE id = :id").bindparams(id=popup_id))
    db.commit()


# ---------------------------------------------------------------------------
# Scenario: migration-single-head
# ---------------------------------------------------------------------------


def test_alembic_single_head_after_add_flow_id_form_definitions() -> None:
    """alembic heads returns exactly one head after this migration."""
    from alembic import command
    from alembic.config import Config

    cfg = Config("alembic.ini")
    output = io.StringIO()
    cfg.stdout = output
    command.heads(cfg)
    heads_output = output.getvalue().strip()
    lines = [ln for ln in heads_output.splitlines() if "(head)" in ln]
    assert len(lines) == 1, f"Expected single head, got: {heads_output}"


# ---------------------------------------------------------------------------
# Scenario: form_fields two-tier uniqueness against real Postgres
# ---------------------------------------------------------------------------


class TestFormFieldsUniquenessPerFlow:
    """One field name per FLOW.

    This started as a two-tier invariant (flow tier + popup-shared tier).
    sdd/sales-flows-rediseno slice 3 (`d3f6b2a81c95`) made `sales_flow_id`
    NOT NULL, which removed the shared tier and collapsed the two partial
    indexes into one.
    """

    def test_same_name_different_flows_both_persist(
        self, db: Session, tenant_a: Tenants
    ) -> None:
        popup_id = _insert_popup(db, tenant_a.id)
        try:
            flow_a = _insert_flow(db, tenant_a.id, popup_id, slug="flow-a")
            flow_b = _insert_flow(db, tenant_a.id, popup_id, slug="flow-b")

            _insert_form_field(db, tenant_a.id, popup_id, "shared_name", flow_a)
            # Must not raise — different flow, same name, same popup.
            _insert_form_field(db, tenant_a.id, popup_id, "shared_name", flow_b)

            count = db.exec(
                text(
                    "SELECT COUNT(*) FROM formfields "
                    "WHERE popup_id = :pid AND name = 'shared_name'"
                ).bindparams(pid=popup_id)
            ).scalar()
            assert count == 2
        finally:
            _cleanup(db, popup_id)

    def test_same_name_same_flow_rejected(self, db: Session, tenant_a: Tenants) -> None:
        popup_id = _insert_popup(db, tenant_a.id)
        try:
            flow_a = _insert_flow(db, tenant_a.id, popup_id, slug="flow-a")
            _insert_form_field(db, tenant_a.id, popup_id, "dup_name", flow_a)

            with pytest.raises(IntegrityError):
                _insert_form_field(db, tenant_a.id, popup_id, "dup_name", flow_a)
            db.rollback()
        finally:
            _cleanup(db, popup_id)


class TestBaseFieldConfigsUniquenessPerFlow:
    """One config per (flow, field_name) — see the note above."""

    def test_same_field_name_different_flows_both_persist(
        self, db: Session, tenant_a: Tenants
    ) -> None:
        popup_id = _insert_popup(db, tenant_a.id)
        try:
            flow_a = _insert_flow(db, tenant_a.id, popup_id, slug="flow-a")
            flow_b = _insert_flow(db, tenant_a.id, popup_id, slug="flow-b")

            _insert_base_field_config(db, tenant_a.id, popup_id, "email", flow_a)
            _insert_base_field_config(db, tenant_a.id, popup_id, "email", flow_b)

            count = db.exec(
                text(
                    "SELECT COUNT(*) FROM basefieldconfigs "
                    "WHERE popup_id = :pid AND field_name = 'email'"
                ).bindparams(pid=popup_id)
            ).scalar()
            assert count == 2
        finally:
            _cleanup(db, popup_id)


class TestAddFlowIdFormDefinitionsMigrationModule:
    def test_upgrade_adds_columns_fks_and_indexes(self) -> None:
        module = _load_migration_module()

        with patch.object(module, "op") as mock_op:
            module.upgrade()

        added_columns = {call.args[0] for call in mock_op.add_column.call_args_list}
        assert added_columns == {"formfields", "formsections", "basefieldconfigs"}

        fk_tables = {call.args[1] for call in mock_op.create_foreign_key.call_args_list}
        assert fk_tables == {"formfields", "formsections", "basefieldconfigs"}

        index_tables = {call.args[1] for call in mock_op.create_index.call_args_list}
        assert index_tables >= {
            "formfields",
            "formsections",
            "basefieldconfigs",
        }

        dropped_constraints = {
            call.args[0] for call in mock_op.drop_constraint.call_args_list
        }
        assert dropped_constraints == {
            "uq_form_field_name_popup",
            "uq_base_field_config_popup_field",
        }

    def test_downgrade_raises_on_cross_tier_duplicate_names_without_touching_schema(
        self,
    ) -> None:
        module = _load_migration_module()

        mock_bind = MagicMock()
        duplicate_count = MagicMock()
        duplicate_count.scalar.return_value = 1
        mock_bind.execute.return_value = duplicate_count

        with patch.object(module, "op") as mock_op:
            mock_op.get_bind.return_value = mock_bind

            with pytest.raises(RuntimeError, match="duplicate"):
                module.downgrade()

        mock_op.drop_index.assert_not_called()
        mock_op.drop_column.assert_not_called()
        mock_op.create_unique_constraint.assert_not_called()

    def test_downgrade_drops_columns_when_no_duplicates(self) -> None:
        module = _load_migration_module()

        mock_bind = MagicMock()
        zero_count = MagicMock()
        zero_count.scalar.return_value = 0
        mock_bind.execute.return_value = zero_count

        with patch.object(module, "op") as mock_op:
            mock_op.get_bind.return_value = mock_bind

            module.downgrade()

        dropped_columns = {call.args for call in mock_op.drop_column.call_args_list}
        assert dropped_columns == {
            ("formfields", "sales_flow_id"),
            ("formsections", "sales_flow_id"),
            ("basefieldconfigs", "sales_flow_id"),
        }
