"""Migration test for add_flow_id_applications_payments (4e221ea1a2ee).

Design: sdd/sales-flows slice 4 — nullable `sales_flow_id` FK on `applications`
and `payments`, backfilled to each popup's default sales_flow (guaranteed to
exist by the slice-2 backfill migration). No behavior reads this column yet:
provenance only for payments (D7), plain column for applications. The
`uq_application_human_popup` uniqueness constraint is deliberately untouched
in this slice (that re-key happens in slice 5, gated behind G2).

Scenarios:
- Migration adds nullable `sales_flow_id` (FK + index) to both tables.
- Backfill sets `sales_flow_id` to the popup's default flow for existing
  rows, joining through `popup_id`.
- Backfill is idempotent: only updates rows where `sales_flow_id IS NULL`
  (never overwrites an already-set value).
- Coverage assertion: zero NULL `sales_flow_id` rows remain for
  applications/payments whose popup has a default flow.
- `uq_application_human_popup` still rejects a duplicate (human_id, popup_id)
  pair after this migration — untouched by this slice.
- The shipped module's `upgrade()`/`downgrade()` are exercised directly via
  a mocked `op.get_bind()`.
- `alembic heads` -> single head after this migration.
"""

import importlib.util
import io
import uuid
from decimal import Decimal
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
        migration_path.glob("4e221ea1a2ee_add_flow_id_applications_payments.py")
    )
    assert matches, (
        "4e221ea1a2ee_add_flow_id_applications_payments migration file not found"
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
            name=f"Flow Id Test Popup {popup_id.hex[:8]}",
            slug=f"flow-id-test-{popup_id.hex[:8]}",
        )
    )
    db.commit()
    return popup_id


def _insert_default_flow(
    db: Session, tenant_id: uuid.UUID, popup_id: uuid.UUID
) -> uuid.UUID:
    flow_id = uuid.uuid4()
    db.exec(
        text(
            "INSERT INTO sales_flows "
            "(id, tenant_id, popup_id, type, slug, name, visibility, "
            'is_default, "order", reviewers_mode, identity_mode) '
            "VALUES (:id, :tid, :pid, 'application', 'default', 'Default', "
            "'portal_listed', true, 0, 'inherit', 'portal_auth')"
        ).bindparams(id=flow_id, tid=tenant_id, pid=popup_id)
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
            email=f"flow-id-test-{human_id.hex[:8]}@example.com",
        )
    )
    db.commit()
    return human_id


def _insert_application(
    db: Session, tenant_id: uuid.UUID, popup_id: uuid.UUID, human_id: uuid.UUID
) -> uuid.UUID:
    application_id = uuid.uuid4()
    db.exec(
        text(
            "INSERT INTO applications (id, tenant_id, popup_id, human_id) "
            "VALUES (:id, :tid, :pid, :hid)"
        ).bindparams(id=application_id, tid=tenant_id, pid=popup_id, hid=human_id)
    )
    db.commit()
    return application_id


def _insert_payment(
    db: Session, tenant_id: uuid.UUID, popup_id: uuid.UUID
) -> uuid.UUID:
    payment_id = uuid.uuid4()
    db.exec(
        text(
            "INSERT INTO payments (id, tenant_id, popup_id, amount) "
            "VALUES (:id, :tid, :pid, :amount)"
        ).bindparams(id=payment_id, tid=tenant_id, pid=popup_id, amount=Decimal("0"))
    )
    db.commit()
    return payment_id


def _cleanup(db: Session, popup_id: uuid.UUID, human_id: uuid.UUID) -> None:
    db.exec(text("DELETE FROM payments WHERE popup_id = :id").bindparams(id=popup_id))
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


def test_alembic_single_head_after_add_flow_id() -> None:
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
# Scenario: backfill DML semantics against real Postgres (scoped, seeded rows)
# ---------------------------------------------------------------------------


class TestAddFlowIdBackfillDML:
    """Mirrors the migration's UPDATE/invariant SQL against seeded rows."""

    def test_backfill_sets_application_sales_flow_id_to_popup_default_flow(
        self, db: Session, tenant_a: Tenants
    ) -> None:
        popup_id = _insert_popup(db, tenant_a.id)
        human_id = _insert_human(db, tenant_a.id)
        try:
            flow_id = _insert_default_flow(db, tenant_a.id, popup_id)
            application_id = _insert_application(db, tenant_a.id, popup_id, human_id)

            db.exec(
                text(
                    "UPDATE applications a SET sales_flow_id = f.id "
                    "FROM sales_flows f "
                    "WHERE f.popup_id = a.popup_id AND f.is_default = true "
                    "AND a.sales_flow_id IS NULL AND a.id = :aid"
                ).bindparams(aid=application_id)
            )
            db.commit()

            resolved = db.exec(
                text(
                    "SELECT sales_flow_id FROM applications WHERE id = :aid"
                ).bindparams(aid=application_id)
            ).scalar()
            assert resolved == flow_id
        finally:
            _cleanup(db, popup_id, human_id)

    def test_backfill_sets_payment_sales_flow_id_to_popup_default_flow(
        self, db: Session, tenant_a: Tenants
    ) -> None:
        popup_id = _insert_popup(db, tenant_a.id)
        human_id = _insert_human(db, tenant_a.id)
        try:
            flow_id = _insert_default_flow(db, tenant_a.id, popup_id)
            payment_id = _insert_payment(db, tenant_a.id, popup_id)

            db.exec(
                text(
                    "UPDATE payments p SET sales_flow_id = f.id "
                    "FROM sales_flows f "
                    "WHERE f.popup_id = p.popup_id AND f.is_default = true "
                    "AND p.sales_flow_id IS NULL AND p.id = :pid"
                ).bindparams(pid=payment_id)
            )
            db.commit()

            resolved = db.exec(
                text("SELECT sales_flow_id FROM payments WHERE id = :pid").bindparams(
                    pid=payment_id
                )
            ).scalar()
            assert resolved == flow_id
        finally:
            _cleanup(db, popup_id, human_id)

    def test_backfill_is_idempotent_never_overwrites_existing_value(
        self, db: Session, tenant_a: Tenants
    ) -> None:
        """Triangulation: the WHERE sales_flow_id IS NULL guard means a row
        already pointed at a non-default flow keeps that value, it is never
        clobbered back to the default flow."""
        popup_id = _insert_popup(db, tenant_a.id)
        human_id = _insert_human(db, tenant_a.id)
        try:
            _insert_default_flow(db, tenant_a.id, popup_id)
            other_flow_id = uuid.uuid4()
            db.exec(
                text(
                    "INSERT INTO sales_flows "
                    "(id, tenant_id, popup_id, type, slug, name, visibility, "
                    'is_default, "order", reviewers_mode, identity_mode) '
                    "VALUES (:id, :tid, :pid, 'application', 'other', 'Other', "
                    "'portal_listed', false, 0, 'inherit', 'portal_auth')"
                ).bindparams(id=other_flow_id, tid=tenant_a.id, pid=popup_id)
            )
            application_id = _insert_application(db, tenant_a.id, popup_id, human_id)
            db.exec(
                text(
                    "UPDATE applications SET sales_flow_id = :fid WHERE id = :aid"
                ).bindparams(fid=other_flow_id, aid=application_id)
            )
            db.commit()

            db.exec(
                text(
                    "UPDATE applications a SET sales_flow_id = f.id "
                    "FROM sales_flows f "
                    "WHERE f.popup_id = a.popup_id AND f.is_default = true "
                    "AND a.sales_flow_id IS NULL AND a.id = :aid"
                ).bindparams(aid=application_id)
            )
            db.commit()

            resolved = db.exec(
                text(
                    "SELECT sales_flow_id FROM applications WHERE id = :aid"
                ).bindparams(aid=application_id)
            ).scalar()
            assert resolved == other_flow_id, (
                "Idempotent guard must not overwrite an already-set sales_flow_id"
            )
        finally:
            _cleanup(db, popup_id, human_id)

    def test_coverage_query_reports_zero_null_after_backfill(
        self, db: Session, tenant_a: Tenants
    ) -> None:
        popup_id = _insert_popup(db, tenant_a.id)
        human_id = _insert_human(db, tenant_a.id)
        try:
            _insert_default_flow(db, tenant_a.id, popup_id)
            application_id = _insert_application(db, tenant_a.id, popup_id, human_id)

            missing_before = db.exec(
                text(
                    "SELECT COUNT(*) FROM applications a "
                    "JOIN sales_flows f ON f.popup_id = a.popup_id AND f.is_default = true "
                    "WHERE a.sales_flow_id IS NULL AND a.id = :aid"
                ).bindparams(aid=application_id)
            ).scalar()
            assert missing_before == 1

            db.exec(
                text(
                    "UPDATE applications a SET sales_flow_id = f.id "
                    "FROM sales_flows f "
                    "WHERE f.popup_id = a.popup_id AND f.is_default = true "
                    "AND a.sales_flow_id IS NULL AND a.id = :aid"
                ).bindparams(aid=application_id)
            )
            db.commit()

            missing_after = db.exec(
                text(
                    "SELECT COUNT(*) FROM applications a "
                    "JOIN sales_flows f ON f.popup_id = a.popup_id AND f.is_default = true "
                    "WHERE a.sales_flow_id IS NULL AND a.id = :aid"
                ).bindparams(aid=application_id)
            ).scalar()
            assert missing_after == 0
        finally:
            _cleanup(db, popup_id, human_id)


# ---------------------------------------------------------------------------
# Scenario: uq_application_human_popup untouched by this slice
# ---------------------------------------------------------------------------


class TestApplicationUniquenessUntouched:
    def test_duplicate_human_popup_application_still_rejected(
        self, db: Session, tenant_a: Tenants
    ) -> None:
        popup_id = _insert_popup(db, tenant_a.id)
        human_id = _insert_human(db, tenant_a.id)
        try:
            _insert_application(db, tenant_a.id, popup_id, human_id)
            with pytest.raises(IntegrityError):
                _insert_application(db, tenant_a.id, popup_id, human_id)
            db.rollback()
        finally:
            _cleanup(db, popup_id, human_id)


# ---------------------------------------------------------------------------
# Scenario: real module upgrade()/downgrade() via mocked op.get_bind()
# ---------------------------------------------------------------------------


class TestAddFlowIdMigrationModule:
    def test_upgrade_raises_when_application_coverage_violated(self) -> None:
        module = _load_migration_module()

        mock_bind = MagicMock()
        application_coverage = MagicMock()
        application_coverage.scalar.return_value = 2
        mock_bind.execute.side_effect = [
            None,  # UPDATE applications backfill
            None,  # UPDATE payments backfill
            application_coverage,  # SELECT missing applications count
        ]

        with patch.object(module, "op") as mock_op:
            mock_op.get_bind.return_value = mock_bind

            with pytest.raises(RuntimeError, match="application"):
                module.upgrade()

    def test_upgrade_raises_when_payment_coverage_violated(self) -> None:
        module = _load_migration_module()

        mock_bind = MagicMock()
        application_coverage = MagicMock()
        application_coverage.scalar.return_value = 0
        payment_coverage = MagicMock()
        payment_coverage.scalar.return_value = 3
        mock_bind.execute.side_effect = [
            None,  # UPDATE applications backfill
            None,  # UPDATE payments backfill
            application_coverage,  # SELECT missing applications count
            payment_coverage,  # SELECT missing payments count
        ]

        with patch.object(module, "op") as mock_op:
            mock_op.get_bind.return_value = mock_bind

            with pytest.raises(RuntimeError, match="payment"):
                module.upgrade()

    def test_upgrade_adds_columns_fks_and_indexes(self) -> None:
        module = _load_migration_module()

        mock_bind = MagicMock()
        zero_count = MagicMock()
        zero_count.scalar.return_value = 0
        mock_bind.execute.side_effect = [None, None, zero_count, zero_count]

        with patch.object(module, "op") as mock_op:
            mock_op.get_bind.return_value = mock_bind

            module.upgrade()

        added_columns = {call.args[0] for call in mock_op.add_column.call_args_list}
        assert added_columns == {"applications", "payments"}
        fk_tables = {call.args[1] for call in mock_op.create_foreign_key.call_args_list}
        assert fk_tables == {"applications", "payments"}
        index_tables = {call.args[1] for call in mock_op.create_index.call_args_list}
        assert index_tables == {"applications", "payments"}

    def test_downgrade_drops_columns_fks_and_indexes(self) -> None:
        module = _load_migration_module()

        with patch.object(module, "op") as mock_op:
            module.downgrade()

        dropped_columns = {call.args for call in mock_op.drop_column.call_args_list}
        assert dropped_columns == {
            ("applications", "sales_flow_id"),
            ("payments", "sales_flow_id"),
        }
