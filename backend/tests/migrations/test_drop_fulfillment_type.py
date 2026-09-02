"""Migration coverage for removing persisted fulfillment classification."""

import uuid

from alembic import command
from alembic.config import Config
from alembic.migration import MigrationContext
from alembic.script import ScriptDirectory
from sqlalchemy import inspect, text

REVISION = "c9a4e7b2d1f8"
PREVIOUS_REVISION = "b7d3e1f8c2a4"
HEAD_REVISION = "a5c8e2f7b1d4"
TABLES = ("products", "payment_products", "attendee_products")
INDEXES = {
    "ix_products_fulfillment_type",
    "ix_payment_products_payment_fulfillment_type",
    "ix_attendee_products_attendee_fulfillment_type",
}
CONSTRAINTS = {
    "ck_products_fulfillment_type",
    "ck_payment_products_fulfillment_type",
    "ck_attendee_products_fulfillment_type",
    "ck_payment_product_fulfillment_identity_compatibility",
}


def _config(connection) -> Config:
    config = Config("alembic.ini")
    config.attributes["connection"] = connection
    return config


def _execute(connection, script: str, params: dict) -> None:
    for statement in script.split(";"):
        if statement.strip():
            connection.execute(text(statement), params)


def _assert_contract_absent(connection) -> None:
    inspector = inspect(connection)
    for table in TABLES:
        assert "fulfillment_type" not in {
            column["name"] for column in inspector.get_columns(table)
        }
        assert INDEXES.isdisjoint(
            index["name"] for index in inspector.get_indexes(table)
        )
        assert CONSTRAINTS.isdisjoint(
            constraint["name"] for constraint in inspector.get_check_constraints(table)
        )


def _insert_contract_rows(connection, ids: dict[str, uuid.UUID]) -> None:
    _execute(
        connection,
        """
        INSERT INTO products
          (id,tenant_id,popup_id,name,slug,price,category,fulfillment_type)
        VALUES
          (:product,:tenant,:popup,'Migration product',CAST(:product AS text),
           1,'ticket','access');
        INSERT INTO attendees (id,tenant_id,popup_id,name)
        VALUES (:attendee,:tenant,:popup,'Migration attendee');
        INSERT INTO payments (id,tenant_id,popup_id,amount)
        VALUES (:payment,:tenant,:popup,1);
        INSERT INTO payment_products
          (id,tenant_id,payment_id,product_id,attendee_id,quantity,product_name,
           product_price,product_category,product_currency,fulfillment_type)
        VALUES
          (:line,:tenant,:payment,:product,:attendee,1,'Migration product',
           1,'ticket','USD','access');
        INSERT INTO attendee_products
          (id,tenant_id,attendee_id,product_id,check_in_code,payment_product_id,
           unit_index,fulfillment_type)
        VALUES
          (:unit,:tenant,:attendee,:product,'drop-fulfillment',:line,0,'access')
        """,
        ids,
    )


def _delete_contract_rows(connection, ids: dict[str, uuid.UUID]) -> None:
    _execute(
        connection,
        """
        DELETE FROM attendee_products WHERE id=:unit;
        DELETE FROM payment_products WHERE id=:line;
        DELETE FROM payments WHERE id=:payment;
        DELETE FROM attendees WHERE id=:attendee;
        DELETE FROM products WHERE id=:product
        """,
        ids,
    )


def test_fresh_full_chain_upgrade_removes_fulfillment_contract(
    migration_test_engine,
) -> None:
    with migration_test_engine.connect() as connection:
        assert (
            MigrationContext.configure(connection).get_current_revision()
            == HEAD_REVISION
        )
        _assert_contract_absent(connection)


def test_legacy_pre_drop_upgrade_preserves_rows(
    migration_test_engine, migration_tenant_popup_ids
) -> None:
    tenant_id, popup_id = migration_tenant_popup_ids
    keys = ("product", "attendee", "payment", "line", "unit")
    ids = dict(zip(keys, (uuid.uuid4() for _ in keys), strict=True))
    ids.update(tenant=tenant_id, popup=popup_id)

    with migration_test_engine.begin() as connection:
        config = _config(connection)
        command.downgrade(config, PREVIOUS_REVISION)
        _insert_contract_rows(connection, ids)

        command.upgrade(config, REVISION)

        assert all(
            connection.execute(
                text(f"SELECT count(*) FROM {table} WHERE id=:id"),  # noqa: S608
                {"id": ids[key]},
            ).scalar_one()
            == 1
            for table, key in (
                ("products", "product"),
                ("payment_products", "line"),
                ("attendee_products", "unit"),
            )
        )
        _assert_contract_absent(connection)
        _delete_contract_rows(connection, ids)
        command.upgrade(config, HEAD_REVISION)


def test_contract_migration_is_the_single_coherent_head() -> None:
    script = ScriptDirectory.from_config(Config("alembic.ini"))
    assert script.get_heads() == [HEAD_REVISION]
    assert script.get_revision(REVISION).down_revision == PREVIOUS_REVISION
    assert script.get_revision(PREVIOUS_REVISION).down_revision == "a6f4c8d2e9b1"


def test_downgrade_restores_nullable_contract_without_invented_values(
    migration_test_engine, migration_tenant_popup_ids
) -> None:
    tenant_id, popup_id = migration_tenant_popup_ids
    keys = ("product", "attendee", "payment", "line", "unit")
    ids = dict(zip(keys, (uuid.uuid4() for _ in keys), strict=True))
    ids.update(tenant=tenant_id, popup=popup_id)

    with migration_test_engine.begin() as connection:
        config = _config(connection)
        _execute(
            connection,
            """
            INSERT INTO products (id,tenant_id,popup_id,name,slug,price,category)
            VALUES
              (:product,:tenant,:popup,'Downgrade product',CAST(:product AS text),
               1,'ticket');
            INSERT INTO attendees (id,tenant_id,popup_id,name)
            VALUES (:attendee,:tenant,:popup,'Downgrade attendee');
            INSERT INTO payments (id,tenant_id,popup_id,amount)
            VALUES (:payment,:tenant,:popup,1);
            INSERT INTO payment_products
              (id,tenant_id,payment_id,product_id,attendee_id,quantity,
               product_name,product_price,product_category,product_currency)
            VALUES
              (:line,:tenant,:payment,:product,:attendee,1,'Downgrade product',
               1,'ticket','USD');
            INSERT INTO attendee_products
              (id,tenant_id,attendee_id,product_id,check_in_code,
               payment_product_id,unit_index)
            VALUES
              (:unit,:tenant,:attendee,:product,'restore-fulfillment',:line,0)
            """,
            ids,
        )

        command.downgrade(config, PREVIOUS_REVISION)

        inspector = inspect(connection)
        for table in TABLES:
            columns = {
                column["name"]: column for column in inspector.get_columns(table)
            }
            assert columns["fulfillment_type"]["nullable"] is True
        assert INDEXES.issubset(
            {
                index["name"]
                for table in TABLES
                for index in inspector.get_indexes(table)
            }
        )
        assert CONSTRAINTS.issubset(
            {
                constraint["name"]
                for table in TABLES
                for constraint in inspector.get_check_constraints(table)
            }
        )
        assert all(
            connection.execute(
                text(
                    f"SELECT fulfillment_type FROM {table} WHERE id=:id"  # noqa: S608
                ),
                {"id": ids[key]},
            ).scalar_one()
            is None
            for table, key in (
                ("products", "product"),
                ("payment_products", "line"),
                ("attendee_products", "unit"),
            )
        )
        _delete_contract_rows(connection, ids)
        command.upgrade(config, HEAD_REVISION)
