"""Migration coverage for additive product-unit expansion."""

import uuid

import pytest
from alembic import command
from alembic.config import Config
from alembic.script import ScriptDirectory
from sqlalchemy import inspect, text

from app.api.attendee.models import AttendeeProducts
from app.api.attendee.schemas import AttendeeProductPublic
from app.api.payment.models import PaymentProducts
from app.api.payment.schemas import PaymentProductResponse

REVISION = "b7d3e1f8c2a4"
PREVIOUS_REVISION = "a6f4c8d2e9b1"
HEAD_REVISION = "a5c8e2f7b1d4"


def _config(connection) -> Config:
    config = Config("alembic.ini")
    config.attributes["connection"] = connection
    return config


def _execute(connection, script: str, params: dict) -> None:
    for statement in script.split(";"):
        if statement.strip():
            connection.execute(text(statement), params)


def _column_names(connection) -> set[str]:
    return {
        column["name"]
        for column in inspect(connection).get_columns("attendee_products")
    }


def _insert_history(connection, ids: dict[str, uuid.UUID]) -> None:
    _execute(
        connection,
        """
        INSERT INTO products (id,tenant_id,popup_id,name,slug,price,category,requires_check_in) VALUES
          (:ticket,:tenant,:popup,'Historical ticket',CAST(:ticket AS text),1,'ticket',true),
          (:other,:tenant,:popup,'Historical other',CAST(:other AS text),1,'custom',false);
        INSERT INTO attendees (id,tenant_id,popup_id,name) VALUES (:attendee,:tenant,:popup,'Historical attendee');
        INSERT INTO payments (id,tenant_id,popup_id,amount) VALUES (:payment,:tenant,:popup,1);
        INSERT INTO payment_products
          (id,tenant_id,payment_id,product_id,attendee_id,quantity,product_name,
           product_price,product_category,product_currency)
        VALUES (:line,:tenant,:payment,:ticket,:attendee,2,'Historical ticket',1,'ticket','USD');
        INSERT INTO attendee_products
          (id,tenant_id,attendee_id,product_id,check_in_code,payment_product_id,
           unit_index,fulfillment_type) VALUES
          (:paid,:tenant,:attendee,:ticket,'expand-paid',:line,0,NULL),
          (:manual,:tenant,:attendee,:ticket,'expand-manual',NULL,NULL,'access'),
          (:unresolved,:tenant,:attendee,:other,'expand-unresolved',NULL,NULL,'order'),
          (:conflict,:tenant,:attendee,:other,'expand-conflict',:line,1,NULL)
        """,
        ids,
    )


def test_models_and_schemas_map_nullable_additive_fields() -> None:
    unit = AttendeeProducts.__table__
    line = PaymentProducts.__table__
    fields = {
        "attendee_id",
        "product_category_snapshot",
        "requires_check_in_snapshot",
        "revoked_at",
    }
    assert all(unit.c[name].nullable for name in fields)
    assert line.c.requires_check_in_snapshot.nullable
    assert fields.issubset(AttendeeProductPublic.model_fields)
    assert "requires_check_in_snapshot" in PaymentProductResponse.model_fields


def test_fresh_upgrade_preserves_metadata_rls_and_chain(migration_test_engine) -> None:
    script = ScriptDirectory.from_config(Config("alembic.ini"))
    assert script.get_heads() == [HEAD_REVISION]
    assert script.get_revision(REVISION).down_revision == PREVIOUS_REVISION

    with migration_test_engine.begin() as connection:
        config = _config(connection)
        command.downgrade(config, PREVIOUS_REVISION)
        assert "product_category_snapshot" not in _column_names(connection)
        command.upgrade(config, REVISION)
        inspector = inspect(connection)
        columns = {
            column["name"]: column
            for column in inspector.get_columns("attendee_products")
        }
        assert columns["attendee_id"]["nullable"] is True
        assert {
            "product_category_snapshot",
            "requires_check_in_snapshot",
            "revoked_at",
        }.issubset(columns)
        checks = {
            item["name"]
            for item in inspector.get_check_constraints("attendee_products")
        }
        indexes = {item["name"] for item in inspector.get_indexes("attendee_products")}
        assert {
            "ck_attendee_product_owner_or_lineage",
            "ck_attendee_product_lineage_pair",
        }.issubset(checks)
        assert {
            "ix_attendee_products_active_attendee_category",
            "ix_attendee_products_active_scannable",
            "ux_attendee_product_payment_product_unit",
        }.issubset(indexes)
        rls = connection.execute(
            text("""
            SELECT relrowsecurity,
              (SELECT count(*) FROM pg_policies WHERE tablename='attendee_products')
            FROM pg_class WHERE oid='attendee_products'::regclass
        """)
        ).one()
        assert rls == (True, 1)
        command.upgrade(config, HEAD_REVISION)


def test_historical_backfill_uses_only_trustworthy_evidence_and_reports(
    migration_test_engine, migration_tenant_popup_ids, capsys
) -> None:
    tenant_id, popup_id = migration_tenant_popup_ids
    keys = "ticket other attendee payment line paid manual unresolved conflict".split()
    ids = dict(zip(keys, (uuid.uuid4() for _ in keys), strict=True))
    ids.update(tenant=tenant_id, popup=popup_id)
    with migration_test_engine.begin() as connection:
        config = _config(connection)
        command.downgrade(config, PREVIOUS_REVISION)
        _insert_history(connection, ids)
        command.upgrade(config, REVISION)
        rows = connection.execute(
            text("""
            SELECT check_in_code,product_category_snapshot,requires_check_in_snapshot
            FROM attendee_products
            WHERE id IN (:paid,:manual,:unresolved,:conflict)
            ORDER BY check_in_code
            """),
            ids,
        ).all()
        assert rows == [
            ("expand-conflict", None, False),
            ("expand-manual", "ticket", True),
            ("expand-paid", "ticket", True),
            ("expand-unresolved", None, False),
        ]
        assert (
            connection.execute(
                text(
                    "SELECT requires_check_in_snapshot FROM payment_products WHERE id=:line"
                ),
                ids,
            ).scalar_one()
            is True
        )
        report = next(
            line
            for line in capsys.readouterr().out.splitlines()
            if "product unit backfill report" in line
        )
        assert "paid=1, manual=1, unresolved=2, conflicts=1" in report
        assert all(str(value) not in report for value in ids.values())
        _execute(
            connection,
            """
            DELETE FROM attendee_products WHERE id IN (:paid,:manual,:unresolved,:conflict);
            DELETE FROM payment_products WHERE id=:line; DELETE FROM payments WHERE id=:payment;
            DELETE FROM attendees WHERE id=:attendee; DELETE FROM products WHERE id IN (:ticket,:other)
            """,
            ids,
        )
        command.upgrade(config, HEAD_REVISION)


def test_downgrade_refuses_attendee_less_or_revoked_history(
    migration_test_engine, migration_tenant_popup_ids
) -> None:
    tenant_id, popup_id = migration_tenant_popup_ids
    keys = ("product", "attendee", "payment", "line", "ownerless", "revoked")
    ids = dict(zip(keys, (uuid.uuid4() for _ in keys), strict=True))
    ids.update(tenant=tenant_id, popup=popup_id)
    with migration_test_engine.begin() as connection:
        _execute(
            connection,
            """
            INSERT INTO products (id,tenant_id,popup_id,name,slug,price,category)
            VALUES (:product,:tenant,:popup,'Guard product',CAST(:product AS text),1,'custom');
            INSERT INTO attendees (id,tenant_id,popup_id,name) VALUES (:attendee,:tenant,:popup,'Guard attendee');
            INSERT INTO payments (id,tenant_id,popup_id,amount) VALUES (:payment,:tenant,:popup,1);
            INSERT INTO payment_products
              (id,tenant_id,payment_id,product_id,attendee_id,quantity,product_name,
               product_price,product_category,product_currency)
            VALUES (:line,:tenant,:payment,:product,:attendee,1,'Guard product',1,'custom','USD');
            INSERT INTO attendee_products
              (id,tenant_id,attendee_id,product_id,check_in_code,payment_product_id,
               unit_index,revoked_at) VALUES
              (:ownerless,:tenant,NULL,:product,'expand-ownerless',:line,0,NULL),
              (:revoked,:tenant,:attendee,:product,'expand-revoked',NULL,NULL,now())
            """,
            ids,
        )
        with pytest.raises(RuntimeError, match="attendee_less=1, revoked=1"):
            command.downgrade(_config(connection), PREVIOUS_REVISION)
        assert "revoked_at" in _column_names(connection)
        _execute(
            connection,
            """
            DELETE FROM attendee_products WHERE id IN (:ownerless,:revoked);
            DELETE FROM payment_products WHERE id=:line;
            DELETE FROM payments WHERE id=:payment;
            DELETE FROM attendees WHERE id=:attendee;
            DELETE FROM products WHERE id=:product
            """,
            ids,
        )
        command.downgrade(_config(connection), PREVIOUS_REVISION)
        assert "revoked_at" not in _column_names(connection)
        command.upgrade(_config(connection), HEAD_REVISION)
