"""Migration tests for the local primary-sales-flow backfill."""

import importlib.util
import io
import uuid
from pathlib import Path
from unittest.mock import MagicMock, patch

from sqlmodel import Session, text

from app.api.tenant.models import Tenants


def _load_migration_module():
    path = (
        Path(__file__).resolve().parents[2]
        / "app"
        / "alembic"
        / "versions"
        / "4a983282b8aa_backfill_primary_sales_flows.py"
    )
    assert path.exists()
    spec = importlib.util.spec_from_file_location(path.stem, path)
    assert spec and spec.loader
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def _insert_popup(db: Session, tenant_id: uuid.UUID, sale_type: str) -> uuid.UUID:
    popup_id = uuid.uuid4()
    db.exec(
        text(
            "INSERT INTO popups (id, tenant_id, name, slug, sale_type, status, currency) "
            "VALUES (:id, :tenant_id, :name, :slug, :sale_type, 'active', 'ARS')"
        ).bindparams(
            id=popup_id,
            tenant_id=tenant_id,
            name=f"Primary flow migration {popup_id.hex[:8]}",
            slug=f"primary-flow-{popup_id.hex[:8]}",
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


def test_alembic_single_head_after_primary_flow_backfill() -> None:
    from alembic import command
    from alembic.config import Config

    output = io.StringIO()
    config = Config("alembic.ini")
    config.stdout = output
    command.heads(config)
    assert (
        len([line for line in output.getvalue().splitlines() if "(head)" in line]) == 1
    )


def test_primary_flow_identity_uses_canonical_names_and_slugs() -> None:
    migration = _load_migration_module()

    assert migration.primary_flow_identity("application") == ("attendee", "Attendee")
    assert migration.primary_flow_identity("direct") == ("checkout", "Checkout")


def test_primary_flow_rows_have_canonical_names_and_slugs(
    db: Session, tenant_a: Tenants
) -> None:
    migration = _load_migration_module()
    popup_ids = [
        _insert_popup(db, tenant_a.id, "application"),
        _insert_popup(db, tenant_a.id, "direct"),
    ]
    try:
        for popup_id, sale_type in zip(
            popup_ids, ("application", "direct"), strict=True
        ):
            slug, name = migration.primary_flow_identity(sale_type)
            db.exec(
                text(
                    "INSERT INTO sales_flows "
                    "(id, tenant_id, popup_id, type, slug, name, visibility, "
                    'is_default, "order", reviewers_mode, identity_mode) '
                    "VALUES (gen_random_uuid(), :tenant_id, :popup_id, :sale_type, "
                    ":slug, :name, 'portal_listed', true, 0, 'inherit', 'portal_auth')"
                ).bindparams(
                    tenant_id=tenant_a.id,
                    popup_id=popup_id,
                    sale_type=sale_type,
                    slug=slug,
                    name=name,
                )
            )
        db.commit()

        rows = db.exec(
            text(
                "SELECT type, slug, name FROM sales_flows "
                "WHERE popup_id = :application_popup_id "
                "OR popup_id = :direct_popup_id ORDER BY type"
            ).bindparams(
                application_popup_id=popup_ids[0], direct_popup_id=popup_ids[1]
            )
        ).all()
        assert rows == [
            ("application", "attendee", "Attendee"),
            ("direct", "checkout", "Checkout"),
        ]
    finally:
        for popup_id in popup_ids:
            _cleanup_popup(db, popup_id)


def test_upgrade_binds_primary_flow_identity_for_each_popup() -> None:
    migration = _load_migration_module()
    popup_id = uuid.uuid4()
    tenant_id = uuid.uuid4()
    bind = MagicMock()
    needing_primary = MagicMock()
    needing_primary.all.return_value = [(popup_id, tenant_id, "application")]
    invariant = MagicMock()
    invariant.scalar.return_value = 0
    bind.execute.side_effect = [needing_primary, MagicMock(), invariant]

    with patch.object(migration, "op") as op:
        op.get_bind.return_value = bind
        migration.upgrade()

    assert bind.execute.call_count == 3
    insert = str(bind.execute.call_args_list[1].args[0])
    assert "INSERT INTO sales_flows" in insert


def test_downgrade_removes_only_canonical_primary_rows() -> None:
    migration = _load_migration_module()
    with patch.object(migration, "op") as op:
        migration.downgrade()
    assert "slug IN ('attendee', 'checkout')" in str(op.execute.call_args.args[0])
