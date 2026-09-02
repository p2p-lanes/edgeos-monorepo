"""Migration test for add_flow_id_reviewers (9bf2a7a71d10).

Design: sdd/sales-flows slice 7 (D4: reviewer tri-state) — adds a nullable
`sales_flow_id` FK+index to `popupreviewers`, and a nullable `sales_flow_id`
FK+index to `approvalstrategies` (the orchestrator's binding re-key of the
one-per-popup approval strategy constraint to the flow dimension, following
the same established two-tier partial-unique pattern as slice 6's form
definitions).

Uniqueness re-keys to a two-tier partial-index shape, mirroring the
`email_templates` scope pattern and slice 6's `form_fields`/
`base_field_configs` re-key:

- `popupreviewers`: flow tier `(sales_flow_id, user_id)` WHERE
  `sales_flow_id IS NOT NULL`; popup-shared tier `(popup_id, user_id)`
  WHERE `sales_flow_id IS NULL` (re-scopes the dropped `uq_popup_reviewer`).
- `approvalstrategies`: flow tier `(sales_flow_id)` WHERE `sales_flow_id IS
  NOT NULL`; popup-shared tier `(popup_id)` WHERE `sales_flow_id IS NULL`
  (re-scopes the dropped `uq_approval_strategy_popup`).

Scenarios:
- Migration adds the column/FK/index to both tables.
- `uq_popup_reviewer` / `uq_approval_strategy_popup` are dropped and
  replaced by the two-tier partial unique indexes.
- Two rows scoped to DIFFERENT flows (same popup) both persist.
- Two rows scoped to the SAME flow collide.
- Two popup-shared (`sales_flow_id IS NULL`) rows in the same popup still
  collide (legacy behavior unchanged).
- A popup-shared row and a flow-scoped row never collide with each other.
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
    matches = list(migration_path.glob("9bf2a7a71d10_add_flow_id_to_reviewers.py"))
    assert matches, "9bf2a7a71d10_add_flow_id_to_reviewers migration file not found"

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
            name=f"Reviewer Flow Test Popup {popup_id.hex[:8]}",
            slug=f"reviewer-flow-test-{popup_id.hex[:8]}",
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


def _insert_user(db: Session, tenant_id: uuid.UUID, *, email: str) -> uuid.UUID:
    user_id = uuid.uuid4()
    db.exec(
        text(
            "INSERT INTO users (id, tenant_id, email, role) "
            "VALUES (:id, :tid, :email, 'admin')"
        ).bindparams(id=user_id, tid=tenant_id, email=email)
    )
    db.commit()
    return user_id


def _insert_reviewer(
    db: Session,
    tenant_id: uuid.UUID,
    popup_id: uuid.UUID,
    user_id: uuid.UUID,
    flow_id: uuid.UUID | None,
) -> None:
    db.exec(
        text(
            "INSERT INTO popupreviewers "
            "(id, tenant_id, popup_id, user_id, sales_flow_id) "
            "VALUES (:id, :tid, :pid, :uid, :fid)"
        ).bindparams(
            id=uuid.uuid4(), tid=tenant_id, pid=popup_id, uid=user_id, fid=flow_id
        )
    )
    db.commit()


def _insert_strategy(
    db: Session,
    tenant_id: uuid.UUID,
    popup_id: uuid.UUID,
    flow_id: uuid.UUID | None,
) -> None:
    db.exec(
        text(
            "INSERT INTO approvalstrategies "
            "(id, tenant_id, popup_id, sales_flow_id) "
            "VALUES (:id, :tid, :pid, :fid)"
        ).bindparams(id=uuid.uuid4(), tid=tenant_id, pid=popup_id, fid=flow_id)
    )
    db.commit()


def _cleanup(db: Session, popup_id: uuid.UUID) -> None:
    db.exec(
        text("DELETE FROM popupreviewers WHERE popup_id = :id").bindparams(id=popup_id)
    )
    db.exec(
        text("DELETE FROM approvalstrategies WHERE popup_id = :id").bindparams(
            id=popup_id
        )
    )
    db.exec(
        text("DELETE FROM sales_flows WHERE popup_id = :id").bindparams(id=popup_id)
    )
    db.exec(text("DELETE FROM popups WHERE id = :id").bindparams(id=popup_id))
    db.commit()


# ---------------------------------------------------------------------------
# Scenario: migration-single-head
# ---------------------------------------------------------------------------


def test_alembic_single_head_after_add_flow_id_reviewers() -> None:
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
# Scenario: popupreviewers two-tier uniqueness against real Postgres
# ---------------------------------------------------------------------------


class TestPopupReviewersTwoTierUniqueness:
    def test_same_user_different_flows_both_persist(
        self, db: Session, tenant_a: Tenants
    ) -> None:
        popup_id = _insert_popup(db, tenant_a.id)
        try:
            flow_a = _insert_flow(db, tenant_a.id, popup_id, slug="flow-a")
            flow_b = _insert_flow(db, tenant_a.id, popup_id, slug="flow-b")
            user_id = _insert_user(
                db, tenant_a.id, email=f"rev-{popup_id.hex[:8]}@x.io"
            )

            _insert_reviewer(db, tenant_a.id, popup_id, user_id, flow_a)
            # Must not raise — different flow, same user, same popup.
            _insert_reviewer(db, tenant_a.id, popup_id, user_id, flow_b)

            count = db.exec(
                text(
                    "SELECT COUNT(*) FROM popupreviewers "
                    "WHERE popup_id = :pid AND user_id = :uid"
                ).bindparams(pid=popup_id, uid=user_id)
            ).scalar()
            assert count == 2
        finally:
            _cleanup(db, popup_id)

    def test_same_user_same_flow_rejected(self, db: Session, tenant_a: Tenants) -> None:
        popup_id = _insert_popup(db, tenant_a.id)
        try:
            flow_a = _insert_flow(db, tenant_a.id, popup_id, slug="flow-a")
            user_id = _insert_user(
                db, tenant_a.id, email=f"rev-{popup_id.hex[:8]}@x.io"
            )
            _insert_reviewer(db, tenant_a.id, popup_id, user_id, flow_a)

            with pytest.raises(IntegrityError):
                _insert_reviewer(db, tenant_a.id, popup_id, user_id, flow_a)
            db.rollback()
        finally:
            _cleanup(db, popup_id)

    def test_same_user_both_popup_shared_rejected(
        self, db: Session, tenant_a: Tenants
    ) -> None:
        """Legacy behavior: two NULL-flow rows for the same (popup, user) still collide."""
        popup_id = _insert_popup(db, tenant_a.id)
        try:
            user_id = _insert_user(
                db, tenant_a.id, email=f"rev-{popup_id.hex[:8]}@x.io"
            )
            _insert_reviewer(db, tenant_a.id, popup_id, user_id, None)

            with pytest.raises(IntegrityError):
                _insert_reviewer(db, tenant_a.id, popup_id, user_id, None)
            db.rollback()
        finally:
            _cleanup(db, popup_id)

    def test_popup_shared_and_flow_scoped_same_user_do_not_collide(
        self, db: Session, tenant_a: Tenants
    ) -> None:
        popup_id = _insert_popup(db, tenant_a.id)
        try:
            flow_a = _insert_flow(db, tenant_a.id, popup_id, slug="flow-a")
            user_id = _insert_user(
                db, tenant_a.id, email=f"rev-{popup_id.hex[:8]}@x.io"
            )
            _insert_reviewer(db, tenant_a.id, popup_id, user_id, None)
            # Must not raise — different tier (flow-scoped vs popup-shared).
            _insert_reviewer(db, tenant_a.id, popup_id, user_id, flow_a)

            count = db.exec(
                text(
                    "SELECT COUNT(*) FROM popupreviewers "
                    "WHERE popup_id = :pid AND user_id = :uid"
                ).bindparams(pid=popup_id, uid=user_id)
            ).scalar()
            assert count == 2
        finally:
            _cleanup(db, popup_id)


# ---------------------------------------------------------------------------
# Scenario: approvalstrategies two-tier uniqueness against real Postgres
# ---------------------------------------------------------------------------


class TestApprovalStrategiesUniquenessPerFlow:
    """One approval strategy per FLOW.

    This started as a two-tier invariant. sdd/sales-flows-rediseno slice 6
    (`c9e2f4b71d38`) made `sales_flow_id` NOT NULL, which removed the shared
    tier and collapsed the two partial indexes into one.
    """

    def test_different_flows_both_persist(self, db: Session, tenant_a: Tenants) -> None:
        popup_id = _insert_popup(db, tenant_a.id)
        try:
            flow_a = _insert_flow(db, tenant_a.id, popup_id, slug="flow-a")
            flow_b = _insert_flow(db, tenant_a.id, popup_id, slug="flow-b")

            _insert_strategy(db, tenant_a.id, popup_id, flow_a)
            # Must not raise — different flow, same popup.
            _insert_strategy(db, tenant_a.id, popup_id, flow_b)

            count = db.exec(
                text(
                    "SELECT COUNT(*) FROM approvalstrategies WHERE popup_id = :pid"
                ).bindparams(pid=popup_id)
            ).scalar()
            assert count == 2
        finally:
            _cleanup(db, popup_id)

    def test_same_flow_rejected(self, db: Session, tenant_a: Tenants) -> None:
        popup_id = _insert_popup(db, tenant_a.id)
        try:
            flow_a = _insert_flow(db, tenant_a.id, popup_id, slug="flow-a")
            _insert_strategy(db, tenant_a.id, popup_id, flow_a)

            with pytest.raises(IntegrityError):
                _insert_strategy(db, tenant_a.id, popup_id, flow_a)
            db.rollback()
        finally:
            _cleanup(db, popup_id)


class TestAddFlowIdReviewersMigrationModule:
    def test_upgrade_adds_columns_fks_and_indexes(self) -> None:
        module = _load_migration_module()

        with patch.object(module, "op") as mock_op:
            module.upgrade()

        added_columns = {call.args[0] for call in mock_op.add_column.call_args_list}
        assert added_columns == {"popupreviewers", "approvalstrategies"}

        fk_tables = {call.args[1] for call in mock_op.create_foreign_key.call_args_list}
        assert fk_tables == {"popupreviewers", "approvalstrategies"}

        index_tables = {call.args[1] for call in mock_op.create_index.call_args_list}
        assert index_tables >= {"popupreviewers", "approvalstrategies"}

        dropped_constraints = {
            call.args[0] for call in mock_op.drop_constraint.call_args_list
        }
        assert dropped_constraints == {
            "uq_popup_reviewer",
            "uq_approval_strategy_popup",
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
            ("popupreviewers", "sales_flow_id"),
            ("approvalstrategies", "sales_flow_id"),
        }
