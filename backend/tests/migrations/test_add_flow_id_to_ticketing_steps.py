"""Migration test for add_flow_id_to_ticketing_steps (96ca481168da).

Design: sdd/sales-flows slice 8 — adds a nullable `sales_flow_id` FK+index
to `ticketingsteps` so a flow can own its own step list independently of
its popup, and re-keys the pre-existing
`uq_ticketing_step_patron_per_popup` partial unique index (added by
`fb7da98c8d72_patron_product_rules.py`) to the same two-tier shape used
throughout this series:

- Flow tier `uq_ticketing_step_patron_flow` on `(sales_flow_id)` WHERE
  `template = 'patron-preset' AND is_enabled = TRUE AND sales_flow_id IS
  NOT NULL`.
- Popup-shared tier `uq_ticketing_step_patron_popup_shared` on
  `(popup_id)` WHERE `template = 'patron-preset' AND is_enabled = TRUE AND
  sales_flow_id IS NULL` (re-scopes the dropped index).

Scenarios:
- Migration adds the column/FK/index.
- `uq_ticketing_step_patron_per_popup` is dropped and replaced by the
  two-tier partial unique indexes.
- Two enabled patron-preset rows scoped to DIFFERENT flows (same popup)
  both persist.
- Two enabled patron-preset rows scoped to the SAME flow collide.
- Two popup-shared (`sales_flow_id IS NULL`) enabled patron-preset rows in
  the same popup still collide (legacy behavior unchanged).
- A popup-shared row and a flow-scoped row never collide with each other.
- A DISABLED patron-preset row never collides with anything (the partial
  index only covers `is_enabled = TRUE`, unchanged from before this slice).
- Downgrade aborts loudly (no column/constraint touched) if any cross-tier
  duplicate exists — it NEVER deletes data.
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
    matches = list(
        migration_path.glob("96ca481168da_add_flow_id_to_ticketing_steps.py")
    )
    assert matches, (
        "96ca481168da_add_flow_id_to_ticketing_steps migration file not found"
    )

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
            name=f"Ticketing Step Flow Test Popup {popup_id.hex[:8]}",
            slug=f"ticketing-step-flow-test-{popup_id.hex[:8]}",
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


def _insert_patron_step(
    db: Session,
    tenant_id: uuid.UUID,
    popup_id: uuid.UUID,
    sales_flow_id: uuid.UUID | None,
    *,
    is_enabled: bool = True,
) -> None:
    db.exec(
        text(
            "INSERT INTO ticketingsteps "
            "(id, tenant_id, popup_id, sales_flow_id, step_type, title, "
            "template, is_enabled) "
            "VALUES (:id, :tid, :pid, :fid, 'patron', 'Patron', "
            "'patron-preset', :enabled)"
        ).bindparams(
            id=uuid.uuid4(),
            tid=tenant_id,
            pid=popup_id,
            fid=sales_flow_id,
            enabled=is_enabled,
        )
    )
    db.commit()


def _cleanup(db: Session, popup_id: uuid.UUID) -> None:
    db.exec(
        text("DELETE FROM ticketingsteps WHERE popup_id = :id").bindparams(id=popup_id)
    )
    db.exec(
        text("DELETE FROM sales_flows WHERE popup_id = :id").bindparams(id=popup_id)
    )
    db.exec(text("DELETE FROM popups WHERE id = :id").bindparams(id=popup_id))
    db.commit()


# ---------------------------------------------------------------------------
# Scenario: migration-single-head
# ---------------------------------------------------------------------------


def test_alembic_single_head_after_add_flow_id_to_ticketing_steps() -> None:
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
# Scenario: patron-preset two-tier uniqueness against real Postgres
# ---------------------------------------------------------------------------


class TestPatronPresetTwoTierUniqueness:
    def test_different_flows_both_persist(self, db: Session, tenant_a: Tenants) -> None:
        popup_id = _insert_popup(db, tenant_a.id)
        try:
            flow_a = _insert_flow(db, tenant_a.id, popup_id, slug="flow-a")
            flow_b = _insert_flow(db, tenant_a.id, popup_id, slug="flow-b")

            _insert_patron_step(db, tenant_a.id, popup_id, flow_a)
            # Must not raise — different flow, same popup.
            _insert_patron_step(db, tenant_a.id, popup_id, flow_b)

            count = db.exec(
                text(
                    "SELECT COUNT(*) FROM ticketingsteps "
                    "WHERE popup_id = :pid AND template = 'patron-preset'"
                ).bindparams(pid=popup_id)
            ).scalar()
            assert count == 2
        finally:
            _cleanup(db, popup_id)

    def test_same_flow_rejected(self, db: Session, tenant_a: Tenants) -> None:
        popup_id = _insert_popup(db, tenant_a.id)
        try:
            flow_a = _insert_flow(db, tenant_a.id, popup_id, slug="flow-a")
            _insert_patron_step(db, tenant_a.id, popup_id, flow_a)

            with pytest.raises(IntegrityError):
                _insert_patron_step(db, tenant_a.id, popup_id, flow_a)
            db.rollback()
        finally:
            _cleanup(db, popup_id)

    def test_both_popup_shared_rejected(self, db: Session, tenant_a: Tenants) -> None:
        """Legacy behavior: at most one enabled patron-preset step per popup, unchanged."""
        popup_id = _insert_popup(db, tenant_a.id)
        try:
            _insert_patron_step(db, tenant_a.id, popup_id, None)

            with pytest.raises(IntegrityError):
                _insert_patron_step(db, tenant_a.id, popup_id, None)
            db.rollback()
        finally:
            _cleanup(db, popup_id)

    def test_popup_shared_and_flow_scoped_do_not_collide(
        self, db: Session, tenant_a: Tenants
    ) -> None:
        popup_id = _insert_popup(db, tenant_a.id)
        try:
            flow_a = _insert_flow(db, tenant_a.id, popup_id, slug="flow-a")
            _insert_patron_step(db, tenant_a.id, popup_id, None)
            # Must not raise — different tier (flow-scoped vs popup-shared).
            _insert_patron_step(db, tenant_a.id, popup_id, flow_a)

            count = db.exec(
                text(
                    "SELECT COUNT(*) FROM ticketingsteps "
                    "WHERE popup_id = :pid AND template = 'patron-preset'"
                ).bindparams(pid=popup_id)
            ).scalar()
            assert count == 2
        finally:
            _cleanup(db, popup_id)

    def test_disabled_rows_never_collide(self, db: Session, tenant_a: Tenants) -> None:
        """A disabled patron-preset row is outside the partial index entirely,
        same as before this slice — it never collides with anything."""
        popup_id = _insert_popup(db, tenant_a.id)
        try:
            _insert_patron_step(db, tenant_a.id, popup_id, None, is_enabled=False)
            # Must not raise — the first row is disabled, outside the index.
            _insert_patron_step(db, tenant_a.id, popup_id, None, is_enabled=False)

            count = db.exec(
                text(
                    "SELECT COUNT(*) FROM ticketingsteps "
                    "WHERE popup_id = :pid AND template = 'patron-preset'"
                ).bindparams(pid=popup_id)
            ).scalar()
            assert count == 2
        finally:
            _cleanup(db, popup_id)


# ---------------------------------------------------------------------------
# Scenario: real module upgrade()/downgrade() via mocked op.get_bind()
# ---------------------------------------------------------------------------


class TestAddFlowIdToTicketingStepsMigrationModule:
    def test_upgrade_adds_column_fk_index_and_rekeys_patron_index(self) -> None:
        module = _load_migration_module()

        with patch.object(module, "op") as mock_op:
            module.upgrade()

        added_columns = {call.args[0] for call in mock_op.add_column.call_args_list}
        assert added_columns == {"ticketingsteps"}

        fk_tables = {call.args[1] for call in mock_op.create_foreign_key.call_args_list}
        assert fk_tables == {"ticketingsteps"}

        dropped_indexes = {
            call.kwargs.get("table_name") for call in mock_op.drop_index.call_args_list
        }
        assert "ticketingsteps" in dropped_indexes

        created_index_names = {
            call.args[0] for call in mock_op.create_index.call_args_list
        }
        assert created_index_names == {
            "ix_ticketingsteps_sales_flow_id",
            "uq_ticketing_step_patron_flow",
            "uq_ticketing_step_patron_popup_shared",
        }

    def test_downgrade_raises_on_cross_tier_duplicates_without_touching_schema(
        self,
    ) -> None:
        module = _load_migration_module()

        mock_bind = MagicMock()
        duplicate_count = MagicMock()
        duplicate_count.scalar.return_value = 1
        mock_bind.execute.return_value = duplicate_count

        with patch.object(module, "op") as mock_op:
            mock_op.get_bind.return_value = mock_bind

            with pytest.raises(RuntimeError, match="duplicate|more than one"):
                module.downgrade()

        mock_op.drop_index.assert_not_called()
        mock_op.drop_column.assert_not_called()
        mock_op.create_unique_constraint.assert_not_called()

    def test_downgrade_drops_column_when_no_duplicates(self) -> None:
        module = _load_migration_module()

        mock_bind = MagicMock()
        zero_count = MagicMock()
        zero_count.scalar.return_value = 0
        mock_bind.execute.return_value = zero_count

        with patch.object(module, "op") as mock_op:
            mock_op.get_bind.return_value = mock_bind

            module.downgrade()

        dropped_columns = {call.args for call in mock_op.drop_column.call_args_list}
        assert dropped_columns == {("ticketingsteps", "sales_flow_id")}
