"""Migration coverage for persisted fulfillment classification."""

import importlib.util
import json
import uuid
from pathlib import Path

import pytest
from alembic import command
from alembic.config import Config
from sqlalchemy import inspect, text
from sqlalchemy.engine import Connection
from sqlalchemy.exc import IntegrityError

from app.api.attendee.models import AttendeeProducts
from app.api.payment.models import PaymentProducts
from app.api.product.models import Products

REVISION = "e4a7c2d9b1f6"
PREVIOUS_REVISION = "d9c7b4e2a1f8"
HEAD_REVISION = "b6d4e9f2a1c7"
COMPATIBILITY_CONSTRAINT = "ck_payment_product_fulfillment_identity_compatibility"
LEGACY_CONSTRAINT = "ck_payment_product_has_recipient_or_attendee"


def _load_migration_module():
    path = (
        Path(__file__).resolve().parents[2]
        / "app/alembic/versions"
        / f"{REVISION}_add_fulfillment_type.py"
    )
    spec = importlib.util.spec_from_file_location(path.stem, path)
    assert spec and spec.loader, f"{path.name} migration file not found"
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def _config(connection: Connection) -> Config:
    config = Config("alembic.ini")
    config.attributes["connection"] = connection
    return config


def _exec_script(connection: Connection, script: str, params: dict) -> None:
    for statement in script.split(";"):
        if statement.strip():
            connection.execute(text(statement), params)


def _typed_rows(
    connection: Connection,
    table: str,
    label: str,
    keys: tuple[str, ...],
    params: dict,
):
    placeholders = ",".join(f":{key}" for key in keys)
    return connection.execute(
        text(
            f"SELECT {label},fulfillment_type FROM {table} WHERE id IN ({placeholders}) ORDER BY {label}"
        ),  # noqa: S608 - test-only fixed identifiers
        params,
    ).all()


@pytest.fixture
def fulfillment_connection(migration_test_engine):
    with migration_test_engine.begin() as connection:
        config = _config(connection)
        command.downgrade(config, REVISION)
        try:
            yield connection
        finally:
            command.upgrade(config, HEAD_REVISION)


def test_current_models_do_not_map_removed_fulfillment_type() -> None:
    tables = (Products.__table__, PaymentProducts.__table__, AttendeeProducts.__table__)
    assert all("fulfillment_type" not in table.c for table in tables)


def test_upgrade_downgrade_cycle_creates_then_removes_contract(
    migration_test_engine,
) -> None:
    with migration_test_engine.begin() as connection:
        config = _config(connection)
        command.downgrade(config, PREVIOUS_REVISION)
        try:
            downgraded_checks = {
                check["name"]
                for check in inspect(connection).get_check_constraints(
                    "payment_products"
                )
            }
            assert LEGACY_CONSTRAINT in downgraded_checks
            assert COMPATIBILITY_CONSTRAINT not in downgraded_checks
            assert all(
                "fulfillment_type"
                not in {
                    column["name"] for column in inspect(connection).get_columns(table)
                }
                for table in ("products", "payment_products", "attendee_products")
            )

            command.upgrade(config, REVISION)
            inspector = inspect(connection)
            upgraded_checks = {
                check["name"]
                for check in inspector.get_check_constraints("payment_products")
            }
            assert COMPATIBILITY_CONSTRAINT in upgraded_checks
            assert LEGACY_CONSTRAINT not in upgraded_checks
            assert all(
                "fulfillment_type"
                in {column["name"] for column in inspector.get_columns(table)}
                for table in ("products", "payment_products", "attendee_products")
            )
            assert "ix_payment_products_payment_fulfillment_type" in {
                index["name"] for index in inspector.get_indexes("payment_products")
            }
        finally:
            command.upgrade(config, HEAD_REVISION)


@pytest.mark.parametrize(
    ("fulfillment_type", "has_recipient", "has_attendee", "accepted"),
    (
        (None, False, False, True),
        ("access", False, False, False),
        ("access", True, False, True),
        ("access", True, True, True),
        ("participant", False, False, False),
        ("participant", False, True, True),
        ("participant", True, True, True),
        ("order", False, False, True),
        ("order", False, True, True),
        ("invalid", False, True, False),
    ),
)
def test_payment_product_identity_compatibility_matrix(
    migration_test_engine,
    migration_tenant_popup_ids,
    fulfillment_type,
    has_recipient,
    has_attendee,
    accepted,
) -> None:
    tenant_id, popup_id = migration_tenant_popup_ids
    ids = {
        key: uuid.uuid4()
        for key in ("product", "payment", "attendee", "recipient", "line")
    }
    params = {
        **ids,
        "tenant": tenant_id,
        "popup": popup_id,
        "type": fulfillment_type,
        "recipient_identity": ids["recipient"] if has_recipient else None,
        "attendee_identity": ids["attendee"] if has_attendee else None,
    }
    with migration_test_engine.begin() as connection:
        config = _config(connection)
        command.downgrade(config, REVISION)
        try:
            _exec_script(
                connection,
                """
                INSERT INTO products (id,tenant_id,popup_id,name,slug,price,category)
                  VALUES (:product,:tenant,:popup,'Compatibility product',CAST(:product AS text),1,'custom');
                INSERT INTO payments (id,tenant_id,popup_id,amount)
                  VALUES (:payment,:tenant,:popup,1);
                INSERT INTO attendees (id,tenant_id,popup_id,name)
                  VALUES (:attendee,:tenant,:popup,'Compatibility attendee');
                INSERT INTO payment_recipients
                  (id,tenant_id,payment_id,recipient_key,name)
                  VALUES (:recipient,:tenant,:payment,'compatibility-recipient','Compatibility recipient');
                """,
                params,
            )
            statement = text("""
                INSERT INTO payment_products
                  (id,tenant_id,payment_id,product_id,payment_recipient_id,attendee_id,
                   quantity,product_name,product_price,product_category,product_currency,
                   fulfillment_type)
                VALUES
                  (:line,:tenant,:payment,:product,:recipient_identity,:attendee_identity,
                   1,'Compatibility product',1,'custom','USD',:type)
            """)
            if accepted:
                connection.execute(statement, params)
                assert (
                    connection.execute(
                        text(
                            "SELECT fulfillment_type FROM payment_products WHERE id=:line"
                        ),
                        params,
                    ).scalar_one()
                    == fulfillment_type
                )
            else:
                with pytest.raises(IntegrityError):
                    with connection.begin_nested():
                        connection.execute(statement, params)
        finally:
            _exec_script(
                connection,
                """
                DELETE FROM payment_products WHERE id=:line;
                DELETE FROM payment_recipients WHERE id=:recipient;
                DELETE FROM payments WHERE id=:payment;
                DELETE FROM attendees WHERE id=:attendee;
                DELETE FROM products WHERE id=:product
                """,
                params,
            )
            command.upgrade(config, HEAD_REVISION)


def test_downgrade_rejects_identity_free_order_rows(
    migration_test_engine, migration_tenant_popup_ids
) -> None:
    tenant_id, popup_id = migration_tenant_popup_ids
    ids = {key: uuid.uuid4() for key in ("product", "payment", "line")}
    params = {**ids, "tenant": tenant_id, "popup": popup_id}
    with migration_test_engine.begin() as connection:
        command.downgrade(_config(connection), REVISION)
        _exec_script(
            connection,
            """
            INSERT INTO products (id,tenant_id,popup_id,name,slug,price,category)
              VALUES (:product,:tenant,:popup,'Order rollback boundary',CAST(:product AS text),1,'custom');
            INSERT INTO payments (id,tenant_id,popup_id,amount)
              VALUES (:payment,:tenant,:popup,1);
            INSERT INTO payment_products
              (id,tenant_id,payment_id,product_id,quantity,product_name,product_price,
               product_category,product_currency,fulfillment_type)
              VALUES (:line,:tenant,:payment,:product,1,'Order rollback boundary',1,'custom','USD','order');
            """,
            params,
        )

    with pytest.raises(IntegrityError):
        with migration_test_engine.begin() as connection:
            command.downgrade(_config(connection), PREVIOUS_REVISION)

    with migration_test_engine.begin() as connection:
        checks = {
            check["name"]
            for check in inspect(connection).get_check_constraints("payment_products")
        }
        assert COMPATIBILITY_CONSTRAINT in checks
        assert "fulfillment_type" in {
            column["name"]
            for column in inspect(connection).get_columns("payment_products")
        }
        _exec_script(
            connection,
            """
            DELETE FROM payment_products WHERE id=:line;
            DELETE FROM payments WHERE id=:payment;
            DELETE FROM products WHERE id=:product;
            """,
            params,
        )
        command.upgrade(_config(connection), HEAD_REVISION)


def test_backfill_classifies_evidence_propagates_snapshots_and_reports_stably(
    fulfillment_connection,
    migration_tenant_popup_ids,
    capsys,
) -> None:
    connection = fulfillment_connection
    tenant_id, popup_id = migration_tenant_popup_ids
    module = _load_migration_module()
    product_keys = tuple(
        f"product_{name}"
        for name in (
            "access",
            "meal",
            "order",
            "global",
            "unknown",
            "conflict",
            "ticket_visual",
        )
    )
    pp_keys = tuple(
        f"pp_{name}" for name in ("access", "meal", "order", "unknown", "conflict")
    )
    ap_keys = tuple(
        f"ap_{name}"
        for name in ("access", "meal", "fallback", "order", "conflict", "unknown")
    )
    ids = {key: uuid.uuid4() for key in product_keys + pp_keys + ap_keys}
    params = {
        **ids,
        "tenant": tenant_id,
        "popup": popup_id,
        "flow": uuid.uuid4(),
        "attendee": uuid.uuid4(),
        "payment": uuid.uuid4(),
        "meal_config": json.dumps(
            {"sections": [{"products": [{"product_id": str(ids["product_meal"])}]}]}
        ),
        "conflict_config": json.dumps(
            {"sections": [{"products": [{"product_id": str(ids["product_conflict"])}]}]}
        ),
    }
    try:
        baseline = module._backfill(connection)
        capsys.readouterr()
        _exec_script(
            connection,
            """
            INSERT INTO sales_flows
              (id,tenant_id,popup_id,slug,name,type,is_default)
              VALUES (:flow,:tenant,:popup,'fulfillment-test','Fulfillment test','direct',true);
            INSERT INTO products (id, tenant_id, popup_id, name, slug, price, category) VALUES
              (:product_access,:tenant,:popup,'1 access','ft-access',1,'ticket'), (:product_meal,:tenant,:popup,'2 meal','ft-meal',1,'food'),
              (:product_order,:tenant,:popup,'3 order','ft-order',1,'housing'), (:product_global,:tenant,:popup,'4 global','ft-global',1,'addons'),
              (:product_unknown,:tenant,:popup,'5 unknown','ft-unknown',1,'custom'),
              (:product_conflict,:tenant,:popup,'6 conflict','ft-conflict',1,'ticket'),
              (:product_ticket_visual,:tenant,:popup,'7 ticket visual','ft-ticket-visual',1,'parking');
            INSERT INTO ticketingsteps
              (id,tenant_id,popup_id,sales_flow_id,step_type,title,"order",is_enabled,protected,product_category,template,template_config) VALUES
              (gen_random_uuid(),:tenant,:popup,:flow,'meals','Meals',1,true,false,'food','meal-plan-select',CAST(:meal_config AS jsonb)),
              (gen_random_uuid(),:tenant,:popup,:flow,'extras','Extras',2,true,false,'addons','merch-image',NULL),
              (gen_random_uuid(),:tenant,:popup,:flow,'conflict','Conflict',3,true,false,'ticket','meal-plan-select',CAST(:conflict_config AS jsonb)),
              (gen_random_uuid(),:tenant,:popup,:flow,'parking','Parking',4,true,false,'parking','ticket-card',NULL);
            INSERT INTO attendees (id,tenant_id,popup_id,name) VALUES (:attendee,:tenant,:popup,'Fulfillment holder');
            INSERT INTO payments (id,tenant_id,popup_id,amount) VALUES (:payment,:tenant,:popup,5);
            INSERT INTO payment_products
              (id,tenant_id,payment_id,product_id,attendee_id,quantity,product_name,product_price,product_category,product_currency,fulfillment_type) VALUES
              (:pp_access,:tenant,:payment,:product_access,:attendee,1,'1 access',1,'ticket','USD',NULL), (:pp_meal,:tenant,:payment,:product_meal,:attendee,1,'2 meal',1,'food','USD',NULL),
              (:pp_order,:tenant,:payment,:product_order,:attendee,1,'3 order',1,'housing','USD',NULL),
              (:pp_unknown,:tenant,:payment,:product_unknown,:attendee,1,'5 unknown',1,'custom','USD',NULL),
              (:pp_conflict,:tenant,:payment,:product_meal,:attendee,1,'2 meal',1,'food','USD','access');
            INSERT INTO attendee_products
              (id,tenant_id,attendee_id,product_id,check_in_code,payment_product_id,unit_index) VALUES
              (:ap_access,:tenant,:attendee,:product_access,'ft-access',:pp_access,0), (:ap_meal,:tenant,:attendee,:product_meal,'ft-meal',:pp_meal,0),
              (:ap_fallback,:tenant,:attendee,:product_access,'ft-fallback',NULL,NULL), (:ap_order,:tenant,:attendee,:product_order,'ft-order',:pp_order,0),
              (:ap_conflict,:tenant,:attendee,:product_meal,'ft-conflict',:pp_conflict,0),
              (:ap_unknown,:tenant,:attendee,:product_unknown,'ft-unknown',NULL,NULL);
            """,
            params,
        )
        first = module._backfill(connection)
        second = module._backfill(connection)
        assert first == second
        assert {key: first[key] - baseline[key] for key in first} == {
            "products_unclassified": 4,
            "product_conflicts": 1,
            "payment_products_unclassified": 1,
            "attendee_products_unclassified": 2,
            "attendee_product_conflicts": 1,
        }
        reports = capsys.readouterr().out.splitlines()[-2:]
        assert reports[0] == reports[1]
        assert reports[0].startswith(f"[{REVISION}] fulfillment backfill report:")
        products = _typed_rows(connection, "products", "name", product_keys, params)
        snapshots = _typed_rows(
            connection, "payment_products", "product_name", pp_keys, params
        )
        holdings = _typed_rows(
            connection, "attendee_products", "check_in_code", ap_keys, params
        )
        assert ",".join(value or "NULL" for _, value in products) == (
            "access,participant,order,NULL,NULL,NULL,NULL"
        )
        assert ",".join(sorted(value for _, value in snapshots if value)) == (
            "access,access,order,participant"
        )
        assert ",".join(f"{code}:{value or 'NULL'}" for code, value in holdings) == (
            "ft-access:access,ft-conflict:NULL,ft-fallback:access,"
            "ft-meal:participant,ft-order:order,ft-unknown:NULL"
        )
        with pytest.raises(IntegrityError):
            with connection.begin_nested():
                connection.execute(
                    text(
                        "UPDATE products SET fulfillment_type='invalid' WHERE id=:product_access"
                    ),
                    params,
                )
    finally:
        _exec_script(
            connection,
            """
            DELETE FROM attendee_products WHERE id IN
              (:ap_access,:ap_meal,:ap_fallback,:ap_order,:ap_conflict,:ap_unknown);
            DELETE FROM payment_products WHERE id IN
              (:pp_access,:pp_meal,:pp_order,:pp_unknown,:pp_conflict);
            DELETE FROM payments WHERE id=:payment;
            DELETE FROM attendees WHERE id=:attendee;
            DELETE FROM ticketingsteps WHERE sales_flow_id=:flow;
            DELETE FROM products WHERE id IN
              (:product_access,:product_meal,:product_order,:product_global,
               :product_unknown,:product_conflict,:product_ticket_visual);
            DELETE FROM sales_flows WHERE id=:flow
            """,
            params,
        )
