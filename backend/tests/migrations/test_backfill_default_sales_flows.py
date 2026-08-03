"""Migration test for backfill_default_sales_flows (4a983282b8aa).

Design: sdd/sales-flows D1 — one default sales_flow per popup, all Class B
(inheritable override) columns NULL. Tasks 2.1-2.3.

Scenarios:
- resolve_default_flow_slug is a pure de-collision function (unit, no DB).
- Backfill inserts exactly one default flow per popup lacking one, with
  type=popup.sale_type, slug='default', is_default=true, and every Class B
  column NULL.
- type is copied per-popup (triangulated: application, direct).
- Backfill is idempotent: a popup that already has a default flow is
  skipped (no duplicate, no unique-constraint violation).
- G1 verification query (`... WHERE f.id IS NULL`) detects an orphan popup
  before the backfill and reports zero after, scoped to seeded rows (the
  session-scoped container already ran migrations to head before any
  fixture-created popups existed, so a table-wide zero-NULL assertion is
  invalid in this shared container — same reasoning as
  test_backfill_open_checkout_signing_secret.py's B4 test).
- The shipped module's upgrade()/downgrade() are exercised directly via a
  mocked `op.get_bind()`, proving the real production code (not just a
  hand-mirrored copy) inserts, checks the invariant, and raises on
  violation; downgrade is a verified no-op.
- alembic heads → single head after this migration.
"""

import importlib.util
import io
import uuid
from pathlib import Path
from unittest.mock import MagicMock, patch

import pytest
from sqlmodel import Session, text

from app.api.tenant.models import Tenants

CLASS_B_COLUMNS = [
    "application_layout",
    "requires_application_fee",
    "application_fee_amount",
    "allows_scholarship",
    "allows_incentive",
    "allows_coupons",
    "open_checkout_success_url",
    "open_checkout_cancel_url",
    "open_checkout_signing_secret",
    "abandoned_cart_delay_days",
    "abandoned_cart_repeat_days",
    "abandoned_cart_max_count",
    "purchase_reminder_delay_days",
    "purchase_reminder_repeat_days",
    "purchase_reminder_max_count",
    "abandoned_application_delay_days",
    "abandoned_application_repeat_days",
    "abandoned_application_max_count",
]


def _load_migration_module():
    migration_path = (
        Path(__file__).resolve().parents[2] / "app" / "alembic" / "versions"
    )
    matches = list(migration_path.glob("4a983282b8aa_backfill_default_sales_flows.py"))
    assert matches, "4a983282b8aa_backfill_default_sales_flows migration file not found"

    module_path = matches[0]
    spec = importlib.util.spec_from_file_location(module_path.stem, module_path)
    assert spec and spec.loader
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def _insert_popup(
    db: Session, tenant_id: uuid.UUID, sale_type: str = "application"
) -> uuid.UUID:
    popup_id = uuid.uuid4()
    db.exec(
        text(
            "INSERT INTO popups (id, tenant_id, name, slug, sale_type, status, currency) "
            "VALUES (:id, :tid, :name, :slug, :sale_type, 'active', 'ARS')"
        ).bindparams(
            id=popup_id,
            tid=tenant_id,
            name=f"Backfill Test Popup {popup_id.hex[:8]}",
            slug=f"backfill-flow-test-{popup_id.hex[:8]}",
            sale_type=sale_type,
        )
    )
    db.commit()
    return popup_id


def _cleanup_popup(db: Session, popup_id: uuid.UUID) -> None:
    db.exec(
        text("DELETE FROM sales_flows WHERE popup_id = :id").bindparams(id=popup_id)
    )
    db.exec(text("DELETE FROM popups WHERE id = :id").bindparams(id=popup_id))
    db.commit()


# ---------------------------------------------------------------------------
# Scenario: migration-single-head
# ---------------------------------------------------------------------------


def test_alembic_single_head_after_backfill() -> None:
    """alembic heads returns exactly one head after the backfill migration."""
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
# Scenario: resolve_default_flow_slug — pure de-collision function
# ---------------------------------------------------------------------------


def test_resolve_default_flow_slug_no_collision_returns_candidate_unchanged() -> None:
    module = _load_migration_module()
    assert module.resolve_default_flow_slug("default") == "default"


def test_resolve_default_flow_slug_reserved_collision_is_deconflicted() -> None:
    module = _load_migration_module()
    assert module.resolve_default_flow_slug("thank-you") == "thank-you-flow"
    assert module.resolve_default_flow_slug("success") == "success-flow"


# ---------------------------------------------------------------------------
# Scenario: backfill DML semantics against real Postgres (scoped, seeded rows)
# ---------------------------------------------------------------------------


class TestBackfillDefaultSalesFlowsDML:
    """Mirrors the migration's INSERT/invariant SQL against seeded rows.

    The session-scoped test container already ran `alembic upgrade head`
    once, before any fixture-created popup existed, so we cannot assert
    against pre-existing popups. We seed our own popups without a default
    flow and replay the migration's exact SQL against them.
    """

    def test_backfill_creates_default_flow_with_null_class_b_columns(
        self, db: Session, tenant_a: Tenants
    ) -> None:
        popup_id = _insert_popup(db, tenant_a.id, sale_type="application")
        try:
            db.exec(
                text(
                    "INSERT INTO sales_flows "
                    "(id, tenant_id, popup_id, type, slug, name, visibility, "
                    'is_default, "order", reviewers_mode, identity_mode) '
                    "SELECT gen_random_uuid(), p.tenant_id, p.id, p.sale_type, "
                    "'default', 'Default', 'portal_listed', true, 0, 'inherit', 'portal_auth' "
                    "FROM popups p WHERE p.id = :popup_id "
                    "AND NOT EXISTS (SELECT 1 FROM sales_flows f "
                    "WHERE f.popup_id = p.id AND f.is_default = true)"
                ).bindparams(popup_id=popup_id)
            )
            db.commit()

            row = db.exec(
                text(
                    'SELECT type, slug, name, visibility, is_default, "order", '
                    "reviewers_mode, identity_mode FROM sales_flows "
                    "WHERE popup_id = :popup_id"
                ).bindparams(popup_id=popup_id)
            ).first()
            assert row is not None, "Backfill did not create a default flow"
            assert row[0] == "application"
            assert row[1] == "default"
            assert row[2] == "Default"
            assert row[3] == "portal_listed"
            assert row[4] is True
            assert row[5] == 0
            assert row[6] == "inherit"
            assert row[7] == "portal_auth"

            columns_sql = ", ".join(CLASS_B_COLUMNS)
            class_b_row = db.exec(
                text(
                    f"SELECT {columns_sql} FROM sales_flows WHERE popup_id = :popup_id"
                ).bindparams(popup_id=popup_id)
            ).first()
            assert class_b_row is not None
            assert list(class_b_row) == [None] * len(CLASS_B_COLUMNS), (
                f"Expected all Class B columns NULL, got {dict(zip(CLASS_B_COLUMNS, class_b_row, strict=True))}"
            )
        finally:
            _cleanup_popup(db, popup_id)

    def test_backfill_copies_sale_type_direct(
        self, db: Session, tenant_a: Tenants
    ) -> None:
        """Triangulation: a different sale_type produces a different flow.type."""
        popup_id = _insert_popup(db, tenant_a.id, sale_type="direct")
        try:
            db.exec(
                text(
                    "INSERT INTO sales_flows "
                    "(id, tenant_id, popup_id, type, slug, name, visibility, "
                    'is_default, "order", reviewers_mode, identity_mode) '
                    "SELECT gen_random_uuid(), p.tenant_id, p.id, p.sale_type, "
                    "'default', 'Default', 'portal_listed', true, 0, 'inherit', 'portal_auth' "
                    "FROM popups p WHERE p.id = :popup_id "
                    "AND NOT EXISTS (SELECT 1 FROM sales_flows f "
                    "WHERE f.popup_id = p.id AND f.is_default = true)"
                ).bindparams(popup_id=popup_id)
            )
            db.commit()

            flow_type = db.exec(
                text(
                    "SELECT type FROM sales_flows WHERE popup_id = :popup_id"
                ).bindparams(popup_id=popup_id)
            ).scalar()
            assert flow_type == "direct"
        finally:
            _cleanup_popup(db, popup_id)

    def test_backfill_is_idempotent_skips_popup_with_existing_default(
        self, db: Session, tenant_a: Tenants
    ) -> None:
        """A popup that already has a default flow (e.g. created via the
        slice-1 API before this migration ran) is skipped — no duplicate
        insert, no uq_sales_flows_default_per_popup violation."""
        popup_id = _insert_popup(db, tenant_a.id, sale_type="application")
        try:
            existing_flow_id = uuid.uuid4()
            db.exec(
                text(
                    "INSERT INTO sales_flows "
                    "(id, tenant_id, popup_id, type, slug, name, visibility, "
                    'is_default, "order", reviewers_mode, identity_mode) '
                    "VALUES (:id, :tid, :popup_id, 'application', 'manual-default', "
                    "'Manually Created', 'portal_listed', true, 0, 'inherit', 'portal_auth')"
                ).bindparams(id=existing_flow_id, tid=tenant_a.id, popup_id=popup_id)
            )
            db.commit()

            # Replay the migration's WHERE NOT EXISTS guard.
            db.exec(
                text(
                    "INSERT INTO sales_flows "
                    "(id, tenant_id, popup_id, type, slug, name, visibility, "
                    'is_default, "order", reviewers_mode, identity_mode) '
                    "SELECT gen_random_uuid(), p.tenant_id, p.id, p.sale_type, "
                    "'default', 'Default', 'portal_listed', true, 0, 'inherit', 'portal_auth' "
                    "FROM popups p WHERE p.id = :popup_id "
                    "AND NOT EXISTS (SELECT 1 FROM sales_flows f "
                    "WHERE f.popup_id = p.id AND f.is_default = true)"
                ).bindparams(popup_id=popup_id)
            )
            db.commit()

            flows = db.exec(
                text(
                    "SELECT id, slug FROM sales_flows WHERE popup_id = :popup_id"
                ).bindparams(popup_id=popup_id)
            ).all()
            assert len(flows) == 1, (
                f"Expected exactly 1 flow (no duplicate insert), got {len(flows)}"
            )
            assert flows[0][0] == existing_flow_id
            assert flows[0][1] == "manual-default"
        finally:
            _cleanup_popup(db, popup_id)

    def test_g1_verification_query_detects_orphan_then_zero(
        self, db: Session, tenant_a: Tenants
    ) -> None:
        """G1 query (task 2.3): `SELECT COUNT(*) ... WHERE f.id IS NULL`
        scoped to seeded rows — non-zero before backfill, zero after."""
        popup_id = _insert_popup(db, tenant_a.id, sale_type="application")
        try:
            orphan_count_before = db.exec(
                text(
                    "SELECT COUNT(*) FROM popups p "
                    "LEFT JOIN sales_flows f "
                    "  ON f.popup_id = p.id AND f.is_default = true "
                    "WHERE f.id IS NULL AND p.id = :popup_id"
                ).bindparams(popup_id=popup_id)
            ).scalar()
            assert orphan_count_before == 1, (
                "Seeded popup without a flow should be counted as an orphan"
            )

            db.exec(
                text(
                    "INSERT INTO sales_flows "
                    "(id, tenant_id, popup_id, type, slug, name, visibility, "
                    'is_default, "order", reviewers_mode, identity_mode) '
                    "SELECT gen_random_uuid(), p.tenant_id, p.id, p.sale_type, "
                    "'default', 'Default', 'portal_listed', true, 0, 'inherit', 'portal_auth' "
                    "FROM popups p WHERE p.id = :popup_id "
                    "AND NOT EXISTS (SELECT 1 FROM sales_flows f "
                    "WHERE f.popup_id = p.id AND f.is_default = true)"
                ).bindparams(popup_id=popup_id)
            )
            db.commit()

            orphan_count_after = db.exec(
                text(
                    "SELECT COUNT(*) FROM popups p "
                    "LEFT JOIN sales_flows f "
                    "  ON f.popup_id = p.id AND f.is_default = true "
                    "WHERE f.id IS NULL AND p.id = :popup_id"
                ).bindparams(popup_id=popup_id)
            ).scalar()
            assert orphan_count_after == 0, (
                "Popup must no longer be an orphan after the backfill insert"
            )
        finally:
            _cleanup_popup(db, popup_id)


# ---------------------------------------------------------------------------
# Scenario: real module upgrade()/downgrade() via mocked op.get_bind()
# ---------------------------------------------------------------------------


class TestBackfillMigrationModule:
    """Exercises the shipped migration's upgrade()/downgrade() functions
    directly (not a hand-copied mirror), with a mocked bind so no table-wide
    side effects touch the shared session-scoped container."""

    def test_upgrade_raises_when_invariant_violated(self) -> None:
        module = _load_migration_module()

        mock_bind = MagicMock()
        select_needing_default = MagicMock()
        select_needing_default.all.return_value = []
        orphan_check = MagicMock()
        orphan_check.scalar.return_value = 3
        mock_bind.execute.side_effect = [select_needing_default, orphan_check]

        with patch.object(module, "op") as mock_op:
            mock_op.get_bind.return_value = mock_bind

            with pytest.raises(RuntimeError, match="invariant violated"):
                module.upgrade()

    def test_upgrade_inserts_one_flow_per_popup_needing_default(self) -> None:
        module = _load_migration_module()

        popup_id = uuid.uuid4()
        tenant_id = uuid.uuid4()

        mock_bind = MagicMock()
        select_needing_default = MagicMock()
        select_needing_default.all.return_value = [(popup_id, tenant_id, "direct")]
        insert_result = MagicMock()
        orphan_check = MagicMock()
        orphan_check.scalar.return_value = 0
        mock_bind.execute.side_effect = [
            select_needing_default,
            insert_result,
            orphan_check,
        ]

        with patch.object(module, "op") as mock_op:
            mock_op.get_bind.return_value = mock_bind

            module.upgrade()

        assert mock_bind.execute.call_count == 3, (
            "Expected SELECT-needing-default, INSERT, and invariant SELECT"
        )
        insert_call_sql = str(mock_bind.execute.call_args_list[1].args[0])
        assert "INSERT INTO sales_flows" in insert_call_sql

    def test_downgrade_is_a_verified_noop(self) -> None:
        module = _load_migration_module()

        with patch.object(module, "op") as mock_op:
            module.downgrade()

            mock_op.get_bind.assert_not_called()
            mock_op.execute.assert_not_called()
