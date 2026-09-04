"""Migration coverage for payment product identity constraint convergence."""

import uuid

import pytest
from alembic import command
from alembic.config import Config
from alembic.migration import MigrationContext
from alembic.script import ScriptDirectory
from sqlalchemy import inspect, text
from sqlalchemy.exc import IntegrityError

REVISION = "a6f4c8d2e9b1"
PREVIOUS_REVISION = "e4a7c2d9b1f6"
HEAD_REVISION = "b6d4e9f2a1c7"
TABLE = "payment_products"
LEGACY_CONSTRAINT = "ck_payment_product_has_recipient_or_attendee"
COMPATIBILITY_CONSTRAINT = "ck_payment_product_fulfillment_identity_compatibility"
COMPATIBILITY_EXPRESSION = (
    "fulfillment_type IS NULL OR fulfillment_type = 'order' OR "
    "(fulfillment_type IN ('access', 'participant') AND "
    "(payment_recipient_id IS NOT NULL OR attendee_id IS NOT NULL))"
)


def _config(connection) -> Config:
    config = Config("alembic.ini")
    config.attributes["connection"] = connection
    return config


def _constraint_names(connection) -> set[str | None]:
    return {
        constraint["name"]
        for constraint in inspect(connection).get_check_constraints(TABLE)
    }


def _drop_identity_constraints(connection) -> None:
    for constraint in (COMPATIBILITY_CONSTRAINT, LEGACY_CONSTRAINT):
        connection.exec_driver_sql(
            f"ALTER TABLE {TABLE} DROP CONSTRAINT IF EXISTS {constraint}"
        )


def _set_legacy_shape(connection) -> None:
    _drop_identity_constraints(connection)
    connection.exec_driver_sql(
        f"ALTER TABLE {TABLE} ADD CONSTRAINT {LEGACY_CONSTRAINT} "
        "CHECK (payment_recipient_id IS NOT NULL OR attendee_id IS NOT NULL)"
    )


def _ensure_correct_shape(connection) -> None:
    names = _constraint_names(connection)
    if LEGACY_CONSTRAINT in names:
        connection.exec_driver_sql(
            f"ALTER TABLE {TABLE} DROP CONSTRAINT {LEGACY_CONSTRAINT}"
        )
    if COMPATIBILITY_CONSTRAINT not in names:
        connection.exec_driver_sql(
            f"ALTER TABLE {TABLE} ADD CONSTRAINT {COMPATIBILITY_CONSTRAINT} "
            f"CHECK ({COMPATIBILITY_EXPRESSION})"
        )


def _constraint_oid(connection) -> int:
    return connection.execute(
        text(
            "SELECT oid FROM pg_constraint "
            "WHERE conrelid = 'payment_products'::regclass AND conname = :name"
        ),
        {"name": COMPATIBILITY_CONSTRAINT},
    ).scalar_one()


def test_historical_e4_shape_converges_and_downgrade_preserves_e4_contract(
    migration_test_engine, migration_tenant_popup_ids
) -> None:
    tenant_id, popup_id = migration_tenant_popup_ids
    ids = {
        key: uuid.uuid4()
        for key in (
            "product",
            "payment",
            "attendee",
            "recipient",
            "order",
            "accepted_access",
            "accepted_participant",
            "rejected_access",
            "rejected_participant",
        )
    }
    params = {**ids, "tenant": tenant_id, "popup": popup_id}

    with migration_test_engine.begin() as connection:
        config = _config(connection)
        command.downgrade(config, PREVIOUS_REVISION)
        try:
            assert (
                PREVIOUS_REVISION
                in MigrationContext.configure(connection).get_current_heads()
            )
            _set_legacy_shape(connection)
            assert LEGACY_CONSTRAINT in _constraint_names(connection)
            assert COMPATIBILITY_CONSTRAINT not in _constraint_names(connection)

            command.upgrade(config, REVISION)
            names = _constraint_names(connection)
            assert LEGACY_CONSTRAINT not in names
            assert COMPATIBILITY_CONSTRAINT in names

            connection.execute(
                text("""
                    INSERT INTO products
                      (id,tenant_id,popup_id,name,slug,price,category)
                    VALUES
                      (:product,:tenant,:popup,'Constraint repair product',
                       CAST(:product AS text),1,'custom')
                    """),
                params,
            )
            connection.execute(
                text("""
                    INSERT INTO payments (id,tenant_id,popup_id,amount)
                    VALUES (:payment,:tenant,:popup,1)
                    """),
                params,
            )
            connection.execute(
                text("""
                    INSERT INTO attendees (id,tenant_id,popup_id,name)
                    VALUES (:attendee,:tenant,:popup,'Constraint repair attendee')
                    """),
                params,
            )
            connection.execute(
                text("""
                    INSERT INTO payment_recipients
                      (id,tenant_id,payment_id,recipient_key,name)
                    VALUES
                      (:recipient,:tenant,:payment,'constraint-repair-recipient',
                       'Constraint repair recipient')
                    """),
                params,
            )
            connection.execute(
                text("""
                    INSERT INTO payment_products
                      (id,tenant_id,payment_id,product_id,payment_recipient_id,
                       attendee_id,quantity,product_name,product_price,
                       product_category,product_currency,fulfillment_type)
                    VALUES
                      (:order,:tenant,:payment,:product,NULL,NULL,1,
                       'Constraint repair product',1,'custom','USD','order'),
                      (:accepted_access,:tenant,:payment,:product,:recipient,NULL,1,
                       'Constraint repair product',1,'custom','USD','access'),
                      (:accepted_participant,:tenant,:payment,:product,NULL,:attendee,1,
                       'Constraint repair product',1,'custom','USD','participant')
                    """),
                params,
            )
            assert (
                connection.execute(
                    text(
                        "SELECT count(*) FROM payment_products "
                        "WHERE id IN (:order,:accepted_access,:accepted_participant)"
                    ),
                    params,
                ).scalar_one()
                == 3
            )

            for fulfillment_type in ("access", "participant"):
                with pytest.raises(IntegrityError) as exc_info:
                    with connection.begin_nested():
                        connection.execute(
                            text("""
                                INSERT INTO payment_products
                                  (id,tenant_id,payment_id,product_id,quantity,
                                   product_name,product_price,product_category,
                                   product_currency,fulfillment_type)
                                VALUES
                                  (:line,:tenant,:payment,:product,1,
                                   'Constraint repair product',1,'custom','USD',:type)
                                """),
                            {
                                **params,
                                "line": ids[f"rejected_{fulfillment_type}"],
                                "type": fulfillment_type,
                            },
                        )
                assert (
                    exc_info.value.orig.diag.constraint_name == COMPATIBILITY_CONSTRAINT
                )

            command.downgrade(config, PREVIOUS_REVISION)
            names = _constraint_names(connection)
            assert LEGACY_CONSTRAINT not in names
            assert COMPATIBILITY_CONSTRAINT in names
            assert (
                connection.execute(
                    text("SELECT count(*) FROM payment_products WHERE id = :order"),
                    params,
                ).scalar_one()
                == 1
            )
        finally:
            connection.execute(
                text("DELETE FROM payment_products WHERE payment_id = :payment"), params
            )
            connection.execute(
                text("DELETE FROM payment_recipients WHERE payment_id = :payment"),
                params,
            )
            connection.execute(
                text("DELETE FROM attendees WHERE id = :attendee"), params
            )
            connection.execute(text("DELETE FROM payments WHERE id = :payment"), params)
            connection.execute(text("DELETE FROM products WHERE id = :product"), params)
            _ensure_correct_shape(connection)
            command.upgrade(config, "head")


def test_already_correct_e4_shape_upgrades_without_replacing_constraint(
    migration_test_engine,
) -> None:
    with migration_test_engine.begin() as connection:
        config = _config(connection)
        command.downgrade(config, PREVIOUS_REVISION)
        try:
            names = _constraint_names(connection)
            assert LEGACY_CONSTRAINT not in names
            assert COMPATIBILITY_CONSTRAINT in names
            oid_before = _constraint_oid(connection)

            command.upgrade(config, REVISION)

            assert _constraint_oid(connection) == oid_before
            assert LEGACY_CONSTRAINT not in _constraint_names(connection)
        finally:
            _ensure_correct_shape(connection)
            command.upgrade(config, "head")


def test_neither_present_shape_creates_compatibility_constraint(
    migration_test_engine,
) -> None:
    with migration_test_engine.begin() as connection:
        config = _config(connection)
        command.downgrade(config, PREVIOUS_REVISION)
        try:
            _drop_identity_constraints(connection)
            names = _constraint_names(connection)
            assert LEGACY_CONSTRAINT not in names
            assert COMPATIBILITY_CONSTRAINT not in names

            command.upgrade(config, REVISION)

            names = _constraint_names(connection)
            assert LEGACY_CONSTRAINT not in names
            assert COMPATIBILITY_CONSTRAINT in names
        finally:
            _ensure_correct_shape(connection)
            command.upgrade(config, "head")


def test_both_present_shape_drops_only_legacy_constraint(
    migration_test_engine,
) -> None:
    with migration_test_engine.begin() as connection:
        config = _config(connection)
        command.downgrade(config, PREVIOUS_REVISION)
        try:
            compatibility_oid = _constraint_oid(connection)
            connection.exec_driver_sql(
                f"ALTER TABLE {TABLE} ADD CONSTRAINT {LEGACY_CONSTRAINT} "
                "CHECK (payment_recipient_id IS NOT NULL OR attendee_id IS NOT NULL) "
                "NOT VALID"
            )
            assert {
                LEGACY_CONSTRAINT,
                COMPATIBILITY_CONSTRAINT,
            }.issubset(_constraint_names(connection))

            command.upgrade(config, REVISION)

            names = _constraint_names(connection)
            assert LEGACY_CONSTRAINT not in names
            assert COMPATIBILITY_CONSTRAINT in names
            assert _constraint_oid(connection) == compatibility_oid
        finally:
            _ensure_correct_shape(connection)
            command.upgrade(config, "head")


def test_repair_revision_precedes_the_sole_alembic_head() -> None:
    config = Config("alembic.ini")
    script = ScriptDirectory.from_config(config)
    assert script.get_heads() == [HEAD_REVISION]
    assert script.get_revision("c9a4e7b2d1f8").down_revision == "b7d3e1f8c2a4"
    assert script.get_revision("b7d3e1f8c2a4").down_revision == REVISION
    assert script.get_revision(REVISION).down_revision == PREVIOUS_REVISION
