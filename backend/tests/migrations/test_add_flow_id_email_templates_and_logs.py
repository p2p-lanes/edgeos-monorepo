"""Migration test for add_flow_id_email_templates_and_logs (66d0a714e001).

Design: sdd/sales-flows slice 10 — adds a nullable `sales_flow_id` FK+index
to `email_templates` and a nullable `sales_flow_id` plain column (no FK) to
`email_logs`.

Scenarios:
- Migration adds the column/FK/index to both tables.
- `uq_email_template_popup_scope_type` is re-scoped to
  `WHERE popup_id IS NOT NULL AND sales_flow_id IS NULL`; a new
  `uq_email_template_flow_scope_type` partial unique covers the flow tier.
- Two rows scoped to DIFFERENT flows of the same popup, same template type,
  both persist.
- Two rows scoped to the SAME flow collide.
- A popup-shared row and a flow-scoped row of the same type never collide.
- Two popup-shared rows of the same type still collide (legacy behavior).
- `ck_email_templates_scope` requires `login_code_human` to have both
  `popup_id` and `sales_flow_id` NULL; a flow-scoped `login_code_human` row
  is rejected.
- Downgrade aborts loudly (no column/constraint touched) if any
  `(popup_id, template_type)` pair has more than one row across tiers — it
  NEVER deletes data.
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
        migration_path.glob("66d0a714e001_add_flow_id_email_templates_and_logs.py")
    )
    assert matches, (
        "66d0a714e001_add_flow_id_email_templates_and_logs migration file not found"
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
            name=f"Email Flow Test Popup {popup_id.hex[:8]}",
            slug=f"email-flow-test-{popup_id.hex[:8]}",
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


def _insert_template(
    db: Session,
    tenant_id: uuid.UUID,
    *,
    popup_id: uuid.UUID | None,
    sales_flow_id: uuid.UUID | None,
    template_type: str = "application_received",
) -> None:
    db.exec(
        text(
            "INSERT INTO email_templates "
            "(id, tenant_id, popup_id, sales_flow_id, template_type, html_content, is_active) "
            "VALUES (:id, :tid, :pid, :fid, :ttype, '<p>hi</p>', true)"
        ).bindparams(
            id=uuid.uuid4(),
            tid=tenant_id,
            pid=popup_id,
            fid=sales_flow_id,
            ttype=template_type,
        )
    )
    db.commit()


def _cleanup(db: Session, popup_id: uuid.UUID) -> None:
    db.exec(
        text("DELETE FROM email_templates WHERE popup_id = :id").bindparams(id=popup_id)
    )
    db.exec(text("DELETE FROM email_logs WHERE popup_id = :id").bindparams(id=popup_id))
    db.exec(
        text("DELETE FROM sales_flows WHERE popup_id = :id").bindparams(id=popup_id)
    )
    db.exec(text("DELETE FROM popups WHERE id = :id").bindparams(id=popup_id))
    db.commit()


# ---------------------------------------------------------------------------
# Scenario: migration-single-head
# ---------------------------------------------------------------------------


def test_alembic_single_head_after_add_flow_id_email_templates_and_logs() -> None:
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
# Scenario: email_templates two-tier uniqueness against real Postgres
# ---------------------------------------------------------------------------


class TestEmailTemplateTwoTierUniqueness:
    def test_different_flows_same_type_both_persist(
        self, db: Session, tenant_a: Tenants
    ) -> None:
        popup_id = _insert_popup(db, tenant_a.id)
        try:
            flow_a = _insert_flow(db, tenant_a.id, popup_id, slug="flow-a")
            flow_b = _insert_flow(db, tenant_a.id, popup_id, slug="flow-b")

            _insert_template(db, tenant_a.id, popup_id=popup_id, sales_flow_id=flow_a)
            # Must not raise — different flow, same popup, same type.
            _insert_template(db, tenant_a.id, popup_id=popup_id, sales_flow_id=flow_b)

            count = db.exec(
                text(
                    "SELECT COUNT(*) FROM email_templates "
                    "WHERE popup_id = :pid AND template_type = 'application_received'"
                ).bindparams(pid=popup_id)
            ).scalar()
            assert count == 2
        finally:
            _cleanup(db, popup_id)

    def test_same_flow_same_type_rejected(self, db: Session, tenant_a: Tenants) -> None:
        popup_id = _insert_popup(db, tenant_a.id)
        try:
            flow_a = _insert_flow(db, tenant_a.id, popup_id, slug="flow-a")
            _insert_template(db, tenant_a.id, popup_id=popup_id, sales_flow_id=flow_a)

            with pytest.raises(IntegrityError):
                _insert_template(
                    db, tenant_a.id, popup_id=popup_id, sales_flow_id=flow_a
                )
            db.rollback()
        finally:
            _cleanup(db, popup_id)

    def test_both_popup_shared_same_type_rejected(
        self, db: Session, tenant_a: Tenants
    ) -> None:
        """Legacy behavior: two NULL-flow rows for the same (popup, type) still collide."""
        popup_id = _insert_popup(db, tenant_a.id)
        try:
            _insert_template(db, tenant_a.id, popup_id=popup_id, sales_flow_id=None)

            with pytest.raises(IntegrityError):
                _insert_template(db, tenant_a.id, popup_id=popup_id, sales_flow_id=None)
            db.rollback()
        finally:
            _cleanup(db, popup_id)

    def test_popup_shared_and_flow_scoped_same_type_do_not_collide(
        self, db: Session, tenant_a: Tenants
    ) -> None:
        popup_id = _insert_popup(db, tenant_a.id)
        try:
            flow_a = _insert_flow(db, tenant_a.id, popup_id, slug="flow-a")
            _insert_template(db, tenant_a.id, popup_id=popup_id, sales_flow_id=None)
            # Must not raise — different tier (flow-scoped vs popup-shared).
            _insert_template(db, tenant_a.id, popup_id=popup_id, sales_flow_id=flow_a)

            count = db.exec(
                text(
                    "SELECT COUNT(*) FROM email_templates "
                    "WHERE popup_id = :pid AND template_type = 'application_received'"
                ).bindparams(pid=popup_id)
            ).scalar()
            assert count == 2
        finally:
            _cleanup(db, popup_id)


# ---------------------------------------------------------------------------
# Scenario: ck_email_templates_scope requires both NULLs for login_code_human
# ---------------------------------------------------------------------------


class TestEmailTemplateScopeCheckConstraint:
    def test_flow_scoped_login_code_human_rejected(
        self, db: Session, tenant_a: Tenants
    ) -> None:
        popup_id = _insert_popup(db, tenant_a.id)
        try:
            flow_a = _insert_flow(db, tenant_a.id, popup_id, slug="flow-a")

            with pytest.raises(IntegrityError):
                _insert_template(
                    db,
                    tenant_a.id,
                    popup_id=None,
                    sales_flow_id=flow_a,
                    template_type="login_code_human",
                )
            db.rollback()
        finally:
            _cleanup(db, popup_id)

    def test_tenant_scoped_login_code_human_still_allowed(
        self, db: Session, tenant_a: Tenants
    ) -> None:
        popup_id = _insert_popup(db, tenant_a.id)
        try:
            # Both NULL — unchanged legacy tenant scope, must not raise.
            _insert_template(
                db,
                tenant_a.id,
                popup_id=None,
                sales_flow_id=None,
                template_type="login_code_human",
            )
            count = db.exec(
                text(
                    "SELECT COUNT(*) FROM email_templates "
                    "WHERE tenant_id = :tid AND template_type = 'login_code_human'"
                ).bindparams(tid=tenant_a.id)
            ).scalar()
            assert count >= 1
        finally:
            db.exec(
                text(
                    "DELETE FROM email_templates "
                    "WHERE tenant_id = :tid AND template_type = 'login_code_human'"
                ).bindparams(tid=tenant_a.id)
            )
            db.commit()
            _cleanup(db, popup_id)


# ---------------------------------------------------------------------------
# Scenario: real module upgrade()/downgrade() via mocked op.get_bind()
# ---------------------------------------------------------------------------


class TestAddFlowIdEmailTemplatesAndLogsMigrationModule:
    def test_upgrade_raises_when_backfill_coverage_violated(self) -> None:
        module = _load_migration_module()

        mock_bind = MagicMock()
        missing_count = MagicMock()
        missing_count.scalar.return_value = 4
        mock_bind.execute.side_effect = [None, missing_count]

        with patch.object(module, "op") as mock_op:
            mock_op.get_bind.return_value = mock_bind

            with pytest.raises(RuntimeError, match="email_logs row"):
                module.upgrade()

    def test_upgrade_adds_columns_fks_and_indexes(self) -> None:
        module = _load_migration_module()

        mock_bind = MagicMock()
        zero_count = MagicMock()
        zero_count.scalar.return_value = 0
        mock_bind.execute.side_effect = [None, zero_count]

        with patch.object(module, "op") as mock_op:
            mock_op.get_bind.return_value = mock_bind

            module.upgrade()

        added_columns = {call.args[0] for call in mock_op.add_column.call_args_list}
        assert added_columns == {"email_templates", "email_logs"}

        fk_tables = {call.args[1] for call in mock_op.create_foreign_key.call_args_list}
        assert fk_tables == {"email_templates"}

        index_tables = {call.args[1] for call in mock_op.create_index.call_args_list}
        assert index_tables >= {"email_templates", "email_logs"}

        dropped_constraints = {
            call.args[0] for call in mock_op.drop_constraint.call_args_list
        }
        assert "ck_email_templates_scope" in dropped_constraints

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

            with pytest.raises(RuntimeError, match="duplicate|pair"):
                module.downgrade()

        mock_op.drop_index.assert_not_called()
        mock_op.drop_column.assert_not_called()
        mock_op.create_check_constraint.assert_not_called()

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
            ("email_logs", "sales_flow_id"),
            ("email_templates", "sales_flow_id"),
        }
