"""Migration coverage for deferred Attendee materialization."""

import importlib.util
import uuid
from pathlib import Path

from alembic import command
from alembic.config import Config
from sqlalchemy import inspect
from sqlmodel import Session, text

from app.api.attendee.models import AttendeeProducts, Attendees
from app.api.payment.models import PaymentProducts, PaymentRecipients, Payments

REVISION = "d9c7b4e2a1f8"
MIGRATION_FILENAME = f"{REVISION}_defer_attendee_materialization.py"


def _load_migration_module():
    path = (
        Path(__file__).resolve().parents[2]
        / "app/alembic/versions"
        / MIGRATION_FILENAME
    )
    spec = importlib.util.spec_from_file_location(path.stem, path)
    assert spec and spec.loader, f"{MIGRATION_FILENAME} migration file not found"
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def _exec_script(db: Session, script: str, params: dict) -> None:
    for statement in script.split(";"):
        if statement.strip():
            db.exec(text(statement), params=params)


def test_sqlmodel_metadata_registers_nullable_lineage_and_constraints() -> None:
    assert Payments.__table__.c.buyer_human_id.nullable
    assert Attendees.__table__.c.managed_by_human_id.nullable
    assert PaymentProducts.__table__.c.attendee_id.nullable
    assert PaymentProducts.__table__.c.payment_recipient_id.nullable
    assert AttendeeProducts.__table__.c.payment_product_id.nullable
    assert AttendeeProducts.__table__.c.unit_index.nullable

    recipient_unique = {
        tuple(constraint.columns.keys())
        for constraint in PaymentRecipients.__table__.constraints
        if constraint.__class__.__name__ == "UniqueConstraint"
    }
    ticket_unique = {
        tuple(index.columns.keys())
        for index in AttendeeProducts.__table__.indexes
        if index.unique
    }
    payment_product_checks = {
        constraint.name
        for constraint in PaymentProducts.__table__.constraints
        if constraint.__class__.__name__ == "CheckConstraint"
    }
    recipient_foreign_keys = {
        (
            tuple(constraint.columns.keys()),
            tuple(element.column.name for element in constraint.elements),
        )
        for constraint in PaymentProducts.__table__.foreign_key_constraints
    }
    assert ("payment_id", "recipient_key") in recipient_unique
    assert ("payment_product_id", "unit_index") in ticket_unique
    assert (
        "ck_payment_product_fulfillment_identity_compatibility"
        in payment_product_checks
    )
    assert "ck_payment_product_has_recipient_or_attendee" not in payment_product_checks
    assert (
        ("payment_recipient_id", "payment_id"),
        ("id", "payment_id"),
    ) in recipient_foreign_keys


def test_migration_downgrade_upgrade_cycle_and_rls(test_engine) -> None:
    cfg = Config("alembic.ini")
    with test_engine.begin() as connection:
        cfg.attributes["connection"] = connection
        command.downgrade(cfg, "7a4e2f8c9d01")
        assert "payment_recipients" not in inspect(connection).get_table_names()
        assert "buyer_human_id" not in {
            column["name"] for column in inspect(connection).get_columns("payments")
        }

        command.upgrade(cfg, "head")
        policy = connection.execute(
            text(
                "SELECT policyname FROM pg_policies "
                "WHERE tablename = 'payment_recipients'"
            )
        ).scalar_one()
        rls_enabled = connection.execute(
            text(
                "SELECT relrowsecurity FROM pg_class "
                "WHERE oid = 'payment_recipients'::regclass"
            )
        ).scalar_one()
        recipient_foreign_keys = inspect(connection).get_foreign_keys(
            "payment_products"
        )

    assert policy == "tenant_isolation_policy_payment_recipients"
    assert rls_enabled is True
    assert any(
        foreign_key["constrained_columns"] == ["payment_recipient_id", "payment_id"]
        and foreign_key["referred_columns"] == ["id", "payment_id"]
        for foreign_key in recipient_foreign_keys
    )


def test_backfill_is_idempotent_and_preserves_ambiguous_manager(
    db: Session, tenant_a, popup_tenant_a, default_flow_tenant_a
) -> None:
    module = _load_migration_module()
    keys = (
        "app_human",
        "direct_human",
        "application",
        "app_attendee",
        "direct_attendee",
        "ambiguous_attendee",
        "app_payment",
        "direct_payment",
        "ambiguous_payment_a",
        "ambiguous_payment_b",
        "product",
        "pp1",
        "pp2",
        "pp3",
    )
    ids = dict(zip(keys, (uuid.uuid4() for _ in keys), strict=True))
    params = {
        **ids,
        "tenant": tenant_a.id,
        "popup": popup_tenant_a.id,
        "flow": default_flow_tenant_a.id,
        "slug": f"backfill-pass-{ids['product'].hex[:8]}",
    }
    try:
        _exec_script(
            db,
            """
            INSERT INTO humans (id, tenant_id, email) VALUES
              (:app_human, :tenant, 'app-backfill@example.com'),
              (:direct_human, :tenant, 'direct-backfill@example.com');
            INSERT INTO applications (id, tenant_id, popup_id, human_id, sales_flow_id)
              VALUES (:application, :tenant, :popup, :app_human, :flow);
            INSERT INTO attendees
              (id, tenant_id, popup_id, application_id, human_id, name) VALUES
              (:app_attendee, :tenant, :popup, :application, NULL, 'application'),
              (:direct_attendee, :tenant, :popup, NULL, :direct_human, 'direct'),
              (:ambiguous_attendee, :tenant, :popup, NULL, NULL, 'ambiguous');
            INSERT INTO products (id, tenant_id, popup_id, name, slug, price, category)
              VALUES (:product, :tenant, :popup, 'Backfill pass', :slug, 1, 'ticket');
            INSERT INTO payments
              (id, tenant_id, popup_id, application_id, buyer_human_id, amount) VALUES
              (:app_payment, :tenant, :popup, :application, NULL, 1),
              (:direct_payment, :tenant, :popup, NULL, NULL, 1),
              (:ambiguous_payment_a, :tenant, :popup, NULL, :app_human, 1),
              (:ambiguous_payment_b, :tenant, :popup, NULL, :direct_human, 1);
            INSERT INTO payment_products
              (id, tenant_id, payment_id, product_id, attendee_id, quantity,
               product_name, product_price, product_category, product_currency) VALUES
              (:pp1, :tenant, :direct_payment, :product, :direct_attendee, 1, 'Pass', 1, 'ticket', 'USD'),
              (:pp2, :tenant, :ambiguous_payment_a, :product, :ambiguous_attendee, 1, 'Pass', 1, 'ticket', 'USD'),
              (:pp3, :tenant, :ambiguous_payment_b, :product, :ambiguous_attendee, 1, 'Pass', 1, 'ticket', 'USD');
        """,
            params,
        )
        db.commit()

        module._backfill(db.connection())
        module._backfill(db.connection())
        db.commit()
        result = db.exec(
            text("""
            SELECT
              (SELECT buyer_human_id FROM payments WHERE id=:app_payment),
              (SELECT buyer_human_id FROM payments WHERE id=:direct_payment),
              (SELECT managed_by_human_id FROM attendees WHERE id=:app_attendee),
              (SELECT managed_by_human_id FROM attendees WHERE id=:direct_attendee),
              (SELECT managed_by_human_id FROM attendees WHERE id=:ambiguous_attendee)
        """),
            params=params,
        ).one()
        assert result == (
            ids["app_human"],
            ids["direct_human"],
            ids["app_human"],
            ids["direct_human"],
            None,
        )
    finally:
        db.rollback()
        _exec_script(
            db,
            """
            DELETE FROM payment_products WHERE id IN (:pp1, :pp2, :pp3);
            DELETE FROM payments WHERE id IN
              (:app_payment, :direct_payment, :ambiguous_payment_a, :ambiguous_payment_b);
            DELETE FROM attendees WHERE id IN
              (:app_attendee, :direct_attendee, :ambiguous_attendee);
            DELETE FROM applications WHERE id=:application;
            DELETE FROM products WHERE id=:product;
            DELETE FROM humans WHERE id IN (:app_human, :direct_human);
        """,
            params,
        )
        db.commit()
