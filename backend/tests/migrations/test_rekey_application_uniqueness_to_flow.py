"""Migration test for rekey_application_uniqueness_to_flow (e31496bde92c).

Design: sdd/sales-flows slice 5 — human checkpoint G2 (confirmed 2026-08-04):
one application per person PER FLOW, not per popup. Drops
`uq_application_human_popup` and replaces it with `uq_application_human_flow`
on (human_id, sales_flow_id). NULL `sales_flow_id` values are exempt from
the constraint by Postgres's own NULL semantics (every NULL is distinct in
a unique index) — a deliberate choice, not an oversight.

Scenarios:
- Two applications for the same human in the same popup, but different
  sales_flow_id, both persist (the behavioral proof of G2).
- Two applications for the same human and the SAME sales_flow_id are
  rejected with IntegrityError.
- Two applications for the same human/popup both with NULL sales_flow_id
  are NOT rejected (documents the NULL-exemption decision).
- The shipped module's `upgrade()` raises RuntimeError on a
  (human_id, sales_flow_id) precondition violation, without touching data.
- The shipped module's `downgrade()` raises RuntimeError when cross-flow
  duplicates exist (never deletes data), and succeeds (drops the new
  constraint, restores the old one) when none exist.
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
        migration_path.glob("e31496bde92c_rekey_application_uniqueness_to_flow.py")
    )
    assert matches, (
        "e31496bde92c_rekey_application_uniqueness_to_flow migration file not found"
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
            name=f"Rekey Test Popup {popup_id.hex[:8]}",
            slug=f"rekey-test-{popup_id.hex[:8]}",
        )
    )
    db.commit()
    return popup_id


def _insert_flow(
    db: Session,
    tenant_id: uuid.UUID,
    popup_id: uuid.UUID,
    *,
    slug: str,
    is_default: bool,
) -> uuid.UUID:
    flow_id = uuid.uuid4()
    db.exec(
        text(
            "INSERT INTO sales_flows "
            "(id, tenant_id, popup_id, type, slug, name, visibility, "
            'is_default, "order", reviewers_mode, identity_mode) '
            "VALUES (:id, :tid, :pid, 'application', :slug, :name, "
            "'portal_listed', :is_default, 0, 'inherit', 'portal_auth')"
        ).bindparams(
            id=flow_id,
            tid=tenant_id,
            pid=popup_id,
            slug=slug,
            name=slug,
            is_default=is_default,
        )
    )
    db.commit()
    return flow_id


def _insert_human(db: Session, tenant_id: uuid.UUID) -> uuid.UUID:
    human_id = uuid.uuid4()
    db.exec(
        text(
            "INSERT INTO humans (id, tenant_id, email) VALUES (:id, :tid, :email)"
        ).bindparams(
            id=human_id,
            tid=tenant_id,
            email=f"rekey-test-{human_id.hex[:8]}@example.com",
        )
    )
    db.commit()
    return human_id


def _insert_application(
    db: Session,
    tenant_id: uuid.UUID,
    popup_id: uuid.UUID,
    human_id: uuid.UUID,
    sales_flow_id: uuid.UUID | None,
) -> uuid.UUID:
    application_id = uuid.uuid4()
    db.exec(
        text(
            "INSERT INTO applications (id, tenant_id, popup_id, human_id, sales_flow_id) "
            "VALUES (:id, :tid, :pid, :hid, :fid)"
        ).bindparams(
            id=application_id,
            tid=tenant_id,
            pid=popup_id,
            hid=human_id,
            fid=sales_flow_id,
        )
    )
    db.commit()
    return application_id


def _cleanup(db: Session, popup_id: uuid.UUID, human_id: uuid.UUID) -> None:
    db.rollback()
    db.exec(
        text("DELETE FROM applications WHERE popup_id = :id").bindparams(id=popup_id)
    )
    db.exec(
        text("DELETE FROM sales_flows WHERE popup_id = :id").bindparams(id=popup_id)
    )
    db.exec(text("DELETE FROM humans WHERE id = :id").bindparams(id=human_id))
    db.exec(text("DELETE FROM popups WHERE id = :id").bindparams(id=popup_id))
    db.commit()


# ---------------------------------------------------------------------------
# Scenario: migration-single-head
# ---------------------------------------------------------------------------


def test_alembic_single_head_after_rekey() -> None:
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
# Scenario: behavioral proof of G2 — flow-scoped uniqueness against the real
# final schema (conftest applies every migration, including this one, to
# `head` before tests run).
# ---------------------------------------------------------------------------


class TestFlowScopedUniqueness:
    def test_same_human_same_popup_different_flow_both_persist(
        self, db: Session, tenant_a: Tenants
    ) -> None:
        """The behavioral proof of G2: a human can have two applications in
        the SAME popup as long as they belong to different sales flows."""
        popup_id = _insert_popup(db, tenant_a.id)
        human_id = _insert_human(db, tenant_a.id)
        try:
            flow_a = _insert_flow(
                db, tenant_a.id, popup_id, slug="flow-a", is_default=True
            )
            flow_b = _insert_flow(
                db, tenant_a.id, popup_id, slug="flow-b", is_default=False
            )

            app_a = _insert_application(db, tenant_a.id, popup_id, human_id, flow_a)
            app_b = _insert_application(db, tenant_a.id, popup_id, human_id, flow_b)

            count = db.exec(
                text(
                    "SELECT COUNT(*) FROM applications WHERE id IN (:a, :b)"
                ).bindparams(a=app_a, b=app_b)
            ).scalar()
            assert count == 2
        finally:
            _cleanup(db, popup_id, human_id)

    def test_same_human_same_flow_rejected(
        self, db: Session, tenant_a: Tenants
    ) -> None:
        """Same (human_id, sales_flow_id) pair is still rejected — G2 is
        per-flow, not unlimited."""
        popup_id = _insert_popup(db, tenant_a.id)
        human_id = _insert_human(db, tenant_a.id)
        try:
            flow_id = _insert_flow(
                db, tenant_a.id, popup_id, slug="only-flow", is_default=True
            )
            _insert_application(db, tenant_a.id, popup_id, human_id, flow_id)
            with pytest.raises(IntegrityError):
                _insert_application(db, tenant_a.id, popup_id, human_id, flow_id)
            db.rollback()
        finally:
            _cleanup(db, popup_id, human_id)

    def test_null_sales_flow_id_never_conflicts(
        self, db: Session, tenant_a: Tenants
    ) -> None:
        """Documents the deliberate NULL-exemption: two applications for the
        same human/popup, both with NULL sales_flow_id, are NOT rejected —
        Postgres treats every NULL as distinct in a unique index."""
        popup_id = _insert_popup(db, tenant_a.id)
        human_id = _insert_human(db, tenant_a.id)
        try:
            app_1 = _insert_application(db, tenant_a.id, popup_id, human_id, None)
            app_2 = _insert_application(db, tenant_a.id, popup_id, human_id, None)

            count = db.exec(
                text(
                    "SELECT COUNT(*) FROM applications WHERE id IN (:a, :b)"
                ).bindparams(a=app_1, b=app_2)
            ).scalar()
            assert count == 2
        finally:
            _cleanup(db, popup_id, human_id)


# ---------------------------------------------------------------------------
# Scenario: real module upgrade()/downgrade() via mocked op.get_bind()
# ---------------------------------------------------------------------------


class TestRekeyMigrationModule:
    def test_upgrade_raises_on_precondition_violation(self) -> None:
        module = _load_migration_module()

        mock_bind = MagicMock()
        precondition_check = MagicMock()
        precondition_check.scalar.return_value = 2
        mock_bind.execute.side_effect = [precondition_check]

        with patch.object(module, "op") as mock_op:
            mock_op.get_bind.return_value = mock_bind

            with pytest.raises(RuntimeError, match="precondition"):
                module.upgrade()

            mock_op.drop_constraint.assert_not_called()
            mock_op.create_unique_constraint.assert_not_called()

    def test_upgrade_swaps_constraints_when_precondition_holds(self) -> None:
        module = _load_migration_module()

        mock_bind = MagicMock()
        precondition_check = MagicMock()
        precondition_check.scalar.return_value = 0
        mock_bind.execute.side_effect = [precondition_check]

        with patch.object(module, "op") as mock_op:
            mock_op.get_bind.return_value = mock_bind

            module.upgrade()

            mock_op.drop_constraint.assert_called_once_with(
                "uq_application_human_popup", "applications", type_="unique"
            )
            mock_op.create_unique_constraint.assert_called_once_with(
                "uq_application_human_flow",
                "applications",
                ["human_id", "sales_flow_id"],
            )

    def test_downgrade_raises_on_cross_flow_duplicates_without_deleting_data(
        self,
    ) -> None:
        module = _load_migration_module()

        mock_bind = MagicMock()
        cross_flow_check = MagicMock()
        cross_flow_check.scalar.return_value = 3
        mock_bind.execute.side_effect = [cross_flow_check]

        with patch.object(module, "op") as mock_op:
            mock_op.get_bind.return_value = mock_bind

            with pytest.raises(RuntimeError, match="cross-flow|corrupt"):
                module.downgrade()

            mock_op.drop_constraint.assert_not_called()
            mock_op.create_unique_constraint.assert_not_called()

    def test_downgrade_restores_old_constraint_when_no_duplicates(self) -> None:
        module = _load_migration_module()

        mock_bind = MagicMock()
        cross_flow_check = MagicMock()
        cross_flow_check.scalar.return_value = 0
        mock_bind.execute.side_effect = [cross_flow_check]

        with patch.object(module, "op") as mock_op:
            mock_op.get_bind.return_value = mock_bind

            module.downgrade()

            mock_op.drop_constraint.assert_called_once_with(
                "uq_application_human_flow", "applications", type_="unique"
            )
            mock_op.create_unique_constraint.assert_called_once_with(
                "uq_application_human_popup", "applications", ["human_id", "popup_id"]
            )
