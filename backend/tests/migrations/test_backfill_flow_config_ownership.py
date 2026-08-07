"""Migration test for backfill_flow_config_ownership (b8e4c1d90a2f).

Design: sdd/sales-flows-rediseno slice 1 — popup-shared configuration rows
become owned by the popup's default flow, so slice 2 can delete the
read-time fallback without any flow losing its configuration.

Scenarios:
- alembic heads -> single head after this migration.
- Shared config rows (`sales_flow_id IS NULL`) are re-pointed at the popup's
  default flow.
- Rows already owned by a NON-default flow are left untouched: the backfill
  claims only unowned rows, it never steals.
- Tenant-scoped email_templates (`popup_id IS NULL`) are skipped — they
  belong to no popup and therefore to no flow.
- Provenance tables (payments, email_logs) are outside the migration's
  scope, asserted against the module's own CONFIG_TABLES declaration.
- The invariant raises when a config row is left unowned, and downgrade is
  a verified no-op — both exercised against the shipped module via a mocked
  `op.get_bind()`.

Rows are seeded and cleaned up per test: the session-scoped container ran
migrations to head before any fixture row existed, so table-wide assertions
would be meaningless here (same reasoning as
test_backfill_default_sales_flows.py).
"""

import importlib.util
import io
import uuid
from pathlib import Path
from unittest.mock import MagicMock, patch

from sqlmodel import Session, text

from app.api.tenant.models import Tenants

MIGRATION_FILENAME = "b8e4c1d90a2f_backfill_flow_config_ownership.py"


def _load_migration_module():
    migration_path = (
        Path(__file__).resolve().parents[2] / "app" / "alembic" / "versions"
    )
    matches = list(migration_path.glob(MIGRATION_FILENAME))
    assert matches, f"{MIGRATION_FILENAME} migration file not found"

    module_path = matches[0]
    spec = importlib.util.spec_from_file_location(module_path.stem, module_path)
    assert spec and spec.loader
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def _seed_popup_with_default_flow(
    db: Session, tenant_id: uuid.UUID
) -> tuple[uuid.UUID, uuid.UUID]:
    """Create a popup plus its default flow. Returns (popup_id, flow_id)."""
    popup_id = uuid.uuid4()
    flow_id = uuid.uuid4()
    suffix = popup_id.hex[:8]

    db.exec(
        text(
            "INSERT INTO popups (id, tenant_id, name, slug, sale_type, status, currency) "
            "VALUES (:id, :tid, :name, :slug, 'application', 'active', 'ARS')"
        ).bindparams(
            id=popup_id,
            tid=tenant_id,
            name=f"Ownership Test Popup {suffix}",
            slug=f"ownership-backfill-{suffix}",
        )
    )
    db.exec(
        text(
            "INSERT INTO sales_flows "
            "(id, tenant_id, popup_id, type, slug, name, visibility, is_default, "
            '"order", reviewers_mode, identity_mode) '
            "VALUES (:id, :tid, :pid, 'application', 'default', 'Default', "
            "'portal_listed', true, 0, 'inherit', 'portal_auth')"
        ).bindparams(id=flow_id, tid=tenant_id, pid=popup_id)
    )
    db.commit()
    return popup_id, flow_id


def _seed_secondary_flow(db: Session, popup_id: uuid.UUID) -> uuid.UUID:
    flow_id = uuid.uuid4()
    db.exec(
        text(
            "INSERT INTO sales_flows "
            "(id, tenant_id, popup_id, type, slug, name, visibility, is_default, "
            '"order", reviewers_mode, identity_mode) '
            "SELECT :id, p.tenant_id, :pid, 'upsale', 'extras', 'Extras', "
            "'direct_url_only', false, 1, 'inherit', 'portal_auth' "
            "FROM popups p WHERE p.id = :pid"
        ).bindparams(id=flow_id, pid=popup_id)
    )
    db.commit()
    return flow_id


def _seed_popup_template(
    db: Session,
    popup_id: uuid.UUID,
    flow_id: uuid.UUID | None = None,
) -> uuid.UUID:
    """Seed a popup-scoped email template — the representative config row.

    It has to be a table whose `sales_flow_id` is still nullable, since the
    point is to seed an UNOWNED row and watch the backfill claim it. Steps
    went NOT NULL in slice 2, the form tables in slice 3 and approval
    strategies in slice 6. `popupreviewers` is not a candidate either: the
    backfill deliberately leaves it alone, because its inheritance is
    driven by `reviewers_mode` rather than by an absent row.
    """
    template_id = uuid.uuid4()
    db.exec(
        text(
            "INSERT INTO email_templates "
            "(id, tenant_id, popup_id, sales_flow_id, template_type, subject, "
            " html_content) "
            "SELECT :id, p.tenant_id, :pid, :fid, :ttype, 'S', '<p>x</p>' "
            "FROM popups p WHERE p.id = :pid"
        ).bindparams(
            id=template_id,
            pid=popup_id,
            fid=flow_id,
            ttype=f"application_received_{template_id.hex[:6]}",
        )
    )
    db.commit()
    return template_id


def _flow_of_template(db: Session, template_id: uuid.UUID):
    return db.exec(
        text("SELECT sales_flow_id FROM email_templates WHERE id = :id").bindparams(
            id=template_id
        )
    ).one()[0]


def _cleanup(db: Session, popup_id: uuid.UUID) -> None:
    for stmt in (
        "DELETE FROM ticketingsteps WHERE popup_id = :id",
        "DELETE FROM email_templates WHERE popup_id = :id",
        "DELETE FROM sales_flows WHERE popup_id = :id",
        "DELETE FROM popups WHERE id = :id",
    ):
        db.exec(text(stmt).bindparams(id=popup_id))
    db.commit()


# ---------------------------------------------------------------------------
# Scenario: migration-single-head
# ---------------------------------------------------------------------------


def test_alembic_single_head_after_backfill() -> None:
    """alembic heads returns exactly one head after this migration."""
    from alembic import command
    from alembic.config import Config

    cfg = Config("alembic.ini")
    output = io.StringIO()
    cfg.stdout = output
    command.heads(cfg)
    lines = [ln for ln in output.getvalue().strip().splitlines() if "(head)" in ln]
    assert len(lines) == 1, f"Expected single head, got: {output.getvalue()}"


# ---------------------------------------------------------------------------
# Scenario: backfill DML semantics against real Postgres
# ---------------------------------------------------------------------------


def test_shared_config_row_is_claimed_by_the_default_flow(
    db: Session, tenant_a: Tenants
) -> None:
    module = _load_migration_module()
    popup_id, default_flow_id = _seed_popup_with_default_flow(db, tenant_a.id)
    try:
        shared_template = _seed_popup_template(db, popup_id, flow_id=None)
        assert _flow_of_template(db, shared_template) is None

        with patch.object(module.op, "get_bind", return_value=db.connection()):
            module.upgrade()
        db.commit()

        assert _flow_of_template(db, shared_template) == default_flow_id
    finally:
        _cleanup(db, popup_id)


def test_row_owned_by_a_non_default_flow_is_not_stolen(
    db: Session, tenant_a: Tenants
) -> None:
    """The backfill claims unowned rows only — it never re-points owned ones."""
    module = _load_migration_module()
    popup_id, default_flow_id = _seed_popup_with_default_flow(db, tenant_a.id)
    try:
        other_flow_id = _seed_secondary_flow(db, popup_id)
        owned_template = _seed_popup_template(db, popup_id, flow_id=other_flow_id)

        with patch.object(module.op, "get_bind", return_value=db.connection()):
            module.upgrade()
        db.commit()

        assert _flow_of_template(db, owned_template) == other_flow_id
        assert _flow_of_template(db, owned_template) != default_flow_id
    finally:
        _cleanup(db, popup_id)


def test_backfill_is_idempotent(db: Session, tenant_a: Tenants) -> None:
    module = _load_migration_module()
    popup_id, default_flow_id = _seed_popup_with_default_flow(db, tenant_a.id)
    try:
        shared_template = _seed_popup_template(db, popup_id, flow_id=None)

        for _ in range(2):
            with patch.object(module.op, "get_bind", return_value=db.connection()):
                module.upgrade()
            db.commit()

        assert _flow_of_template(db, shared_template) == default_flow_id
    finally:
        _cleanup(db, popup_id)


def test_popup_scoped_email_template_is_claimed(db: Session, tenant_a: Tenants) -> None:
    """A popup-scoped template is configuration, so the default flow owns it."""
    module = _load_migration_module()
    popup_id, default_flow_id = _seed_popup_with_default_flow(db, tenant_a.id)
    template_id = uuid.uuid4()
    try:
        db.exec(
            text(
                "INSERT INTO email_templates "
                "(id, tenant_id, popup_id, template_type, subject, html_content) "
                "SELECT :id, p.tenant_id, :pid, 'application_accepted', 'S', '<p>x</p>' "
                "FROM popups p WHERE p.id = :pid"
            ).bindparams(id=template_id, pid=popup_id)
        )
        db.commit()

        with patch.object(module.op, "get_bind", return_value=db.connection()):
            module.upgrade()
        db.commit()

        owner = db.exec(
            text("SELECT sales_flow_id FROM email_templates WHERE id = :id").bindparams(
                id=template_id
            )
        ).one()[0]
        assert owner == default_flow_id
    finally:
        _cleanup(db, popup_id)


def test_tenant_scoped_email_template_is_left_alone(
    db: Session, tenant_a: Tenants
) -> None:
    """`popup_id IS NULL` templates belong to no popup, so to no flow.

    `ck_email_templates_scope` only admits 'login_code_human' at tenant
    scope, and `uq_email_template_tenant_scope_type` allows one per tenant,
    so reuse an existing row when the fixtures already created one.
    """
    module = _load_migration_module()
    popup_id, _ = _seed_popup_with_default_flow(db, tenant_a.id)
    existing = db.exec(
        text(
            "SELECT id FROM email_templates "
            "WHERE tenant_id = :tid AND popup_id IS NULL "
            "AND template_type = 'login_code_human'"
        ).bindparams(tid=tenant_a.id)
    ).first()

    template_id = existing[0] if existing else uuid.uuid4()
    try:
        if not existing:
            db.exec(
                text(
                    "INSERT INTO email_templates "
                    "(id, tenant_id, popup_id, template_type, subject, html_content) "
                    "VALUES (:id, :tid, NULL, 'login_code_human', 'S', '<p>x</p>')"
                ).bindparams(id=template_id, tid=tenant_a.id)
            )
            db.commit()

        with patch.object(module.op, "get_bind", return_value=db.connection()):
            module.upgrade()
        db.commit()

        still_null = db.exec(
            text("SELECT sales_flow_id FROM email_templates WHERE id = :id").bindparams(
                id=template_id
            )
        ).one()[0]
        assert still_null is None
    finally:
        if not existing:
            db.exec(
                text("DELETE FROM email_templates WHERE id = :id").bindparams(
                    id=template_id
                )
            )
            db.commit()
        _cleanup(db, popup_id)


# ---------------------------------------------------------------------------
# Scenario: scope declaration and invariant
# ---------------------------------------------------------------------------


def test_provenance_tables_are_out_of_scope() -> None:
    """payments/email_logs record which flow produced a row — never rewritten."""
    module = _load_migration_module()
    tables = {table for table, _ in module.CONFIG_TABLES}
    assert "payments" not in tables
    assert "email_logs" not in tables
    assert "flow_products" not in tables
    assert "ticketingsteps" in tables
    assert "formfields" in tables


def test_invariant_raises_when_a_row_is_left_unowned() -> None:
    """A leftover unowned row must abort the migration transaction."""
    module = _load_migration_module()
    conn = MagicMock()
    # Every UPDATE returns a mock; every COUNT(*) check reports one leftover.
    conn.execute.return_value.scalar.return_value = 1

    with patch.object(module.op, "get_bind", return_value=conn):
        try:
            module.upgrade()
        except RuntimeError as exc:
            assert "invariant violated" in str(exc)
        else:
            raise AssertionError("expected RuntimeError for unowned leftover rows")


def test_downgrade_is_a_noop() -> None:
    module = _load_migration_module()
    conn = MagicMock()
    with patch.object(module.op, "get_bind", return_value=conn):
        module.downgrade()
    conn.execute.assert_not_called()
