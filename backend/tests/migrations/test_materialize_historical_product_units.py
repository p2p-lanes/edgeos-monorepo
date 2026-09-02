"""Migration coverage for historical ProductUnit cardinality convergence."""

import importlib.util
import re
import uuid
from pathlib import Path

from alembic import command
from alembic.config import Config
from alembic.migration import MigrationContext
from alembic.script import ScriptDirectory
from sqlalchemy import text

REVISION = "f4b8c2d7e1a9"
PREVIOUS_REVISION = "c9a4e7b2d1f8"
HEAD_REVISION = "a5c8e2f7b1d4"
MIGRATION_FILENAME = f"{REVISION}_materialize_historical_product_units.py"


def _config(connection) -> Config:
    config = Config("alembic.ini")
    config.attributes["connection"] = connection
    return config


def _execute(connection, script: str, params: dict) -> None:
    for statement in script.split(";"):
        if statement.strip():
            connection.execute(text(statement), params)


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


def _unit_rows(connection, payment_id: uuid.UUID):
    return (
        connection.execute(
            text("""
        SELECT id,attendee_id,product_id,payment_id,payment_product_id,unit_index,
               check_in_code,product_category_snapshot,
               requires_check_in_snapshot,revoked_at,purchase_metadata
        FROM attendee_products
        WHERE payment_id=:payment
        ORDER BY payment_product_id,unit_index
        """),
            {"payment": payment_id},
        )
        .mappings()
        .all()
    )


def test_upgrade_converges_operational_slots_without_replacing_history(
    migration_test_engine, migration_tenant_popup_ids
) -> None:
    tenant_id, popup_id = migration_tenant_popup_ids
    keys = (
        "parking_product",
        "attendee_product",
        "recipient_product",
        "preserved_product",
        "attendee_a",
        "attendee_b",
        "payment",
        "parking_line",
        "attendee_line",
        "recipient_line",
        "preserved_line",
        "recipient",
        "active_unit",
        "revoked_unit",
        "check_in",
    )
    ids = dict(zip(keys, (uuid.uuid4() for _ in keys), strict=True))
    params = {**ids, "tenant": tenant_id, "popup": popup_id}

    with migration_test_engine.begin() as connection:
        config = _config(connection)
        command.downgrade(config, PREVIOUS_REVISION)
        try:
            _execute(
                connection,
                """
                INSERT INTO products
                  (id,tenant_id,popup_id,name,slug,price,category,requires_check_in)
                VALUES
                  (:parking_product,:tenant,:popup,'Historical parking',CAST(:parking_product AS text),10,'parking',true),
                  (:attendee_product,:tenant,:popup,'Historical attendee item',CAST(:attendee_product AS text),10,'merch',false),
                  (:recipient_product,:tenant,:popup,'Historical recipient item',CAST(:recipient_product AS text),10,'housing',false),
                  (:preserved_product,:tenant,:popup,'Historical ticket',CAST(:preserved_product AS text),10,'ticket',true);
                INSERT INTO attendees (id,tenant_id,popup_id,name) VALUES
                  (:attendee_a,:tenant,:popup,'Historical attendee A'),
                  (:attendee_b,:tenant,:popup,'Historical attendee B');
                INSERT INTO payments
                  (id,tenant_id,popup_id,status,amount,payment_type)
                VALUES (:payment,:tenant,:popup,'approved',80,'pass_purchase');
                INSERT INTO payment_recipients
                  (id,tenant_id,payment_id,recipient_key,attendee_id,name)
                VALUES
                  (:recipient,:tenant,:payment,'historical-recipient',:attendee_b,'Historical recipient');
                INSERT INTO payment_products
                  (id,tenant_id,payment_id,product_id,attendee_id,payment_recipient_id,
                   quantity,product_name,product_price,product_category,product_currency,
                   requires_check_in_snapshot,purchase_metadata)
                VALUES
                  (:parking_line,:tenant,:payment,:parking_product,NULL,NULL,1,
                   'Historical parking',10,'parking','USD',true,'{"zone":"P1"}'::jsonb),
                  (:attendee_line,:tenant,:payment,:attendee_product,:attendee_a,NULL,3,
                   'Historical attendee item',10,'merch','USD',false,'{"size":"M"}'::jsonb),
                  (:recipient_line,:tenant,:payment,:recipient_product,NULL,:recipient,2,
                   'Historical recipient item',10,'housing','USD',false,NULL),
                  (:preserved_line,:tenant,:payment,:preserved_product,:attendee_b,NULL,3,
                   'Historical ticket',10,'ticket','USD',true,NULL);
                INSERT INTO attendee_products
                  (id,tenant_id,attendee_id,product_id,check_in_code,payment_id,
                   payment_product_id,unit_index,product_category_snapshot,
                   requires_check_in_snapshot,revoked_at)
                VALUES
                  (:active_unit,:tenant,:attendee_b,:preserved_product,'KEEPUNIT',:payment,
                   :preserved_line,1,'legacy-active',false,NULL),
                  (:revoked_unit,:tenant,:attendee_b,:preserved_product,'REVOKED1',:payment,
                   :preserved_line,2,'legacy-revoked',false,now());
                INSERT INTO check_ins
                  (id,tenant_id,popup_id,attendee_product_id,payload)
                VALUES
                  (:check_in,:tenant,:popup,:active_unit,'{"source":"historical"}'::jsonb)
                """,
                params,
            )

            command.upgrade(config, REVISION)
            rows = _unit_rows(connection, ids["payment"])
            by_line = {
                line_id: [row for row in rows if row["payment_product_id"] == line_id]
                for line_id in (
                    ids["parking_line"],
                    ids["attendee_line"],
                    ids["recipient_line"],
                    ids["preserved_line"],
                )
            }

            parking = by_line[ids["parking_line"]]
            assert len(parking) == 1
            assert parking[0]["attendee_id"] is None
            assert parking[0]["unit_index"] == 0
            assert parking[0]["product_category_snapshot"] == "parking"
            assert parking[0]["requires_check_in_snapshot"] is True
            assert parking[0]["purchase_metadata"] == {"zone": "P1"}

            attendee_units = by_line[ids["attendee_line"]]
            assert [row["unit_index"] for row in attendee_units] == [0, 1, 2]
            assert {row["attendee_id"] for row in attendee_units} == {ids["attendee_a"]}
            assert {row["product_category_snapshot"] for row in attendee_units} == {
                "merch"
            }
            assert {row["requires_check_in_snapshot"] for row in attendee_units} == {
                False
            }
            assert {row["purchase_metadata"]["size"] for row in attendee_units} == {"M"}

            recipient_units = by_line[ids["recipient_line"]]
            assert [row["unit_index"] for row in recipient_units] == [0, 1]
            assert {row["attendee_id"] for row in recipient_units} == {
                ids["attendee_b"]
            }

            preserved = by_line[ids["preserved_line"]]
            assert [row["unit_index"] for row in preserved] == [0, 1, 2]
            active = next(row for row in preserved if row["unit_index"] == 1)
            revoked = next(row for row in preserved if row["unit_index"] == 2)
            assert (active["id"], active["check_in_code"]) == (
                ids["active_unit"],
                "KEEPUNIT",
            )
            assert active["product_category_snapshot"] == "legacy-active"
            assert active["requires_check_in_snapshot"] is False
            assert (revoked["id"], revoked["check_in_code"]) == (
                ids["revoked_unit"],
                "REVOKED1",
            )
            assert revoked["revoked_at"] is not None
            assert revoked["product_category_snapshot"] == "legacy-revoked"
            assert connection.execute(
                text("""
                SELECT attendee_product_id,payload FROM check_ins WHERE id=:check_in
                """),
                params,
            ).one() == (ids["active_unit"], {"source": "historical"})

            generated = [
                row
                for row in rows
                if row["id"] not in {ids["active_unit"], ids["revoked_unit"]}
            ]
            assert len(generated) == 7
            assert all(
                re.fullmatch(r"[A-Z]{8}", row["check_in_code"]) for row in generated
            )
            assert len({row["id"] for row in rows}) == len(rows)
            assert len({row["check_in_code"] for row in rows}) == len(rows)

            module = _load_migration_module()
            assert module._backfill(connection)["inserted"] == 0
            identity = [
                (row["id"], row["check_in_code"], row["revoked_at"])
                for row in _unit_rows(connection, ids["payment"])
            ]
            assert module._backfill(connection)["inserted"] == 0
            assert [
                (row["id"], row["check_in_code"], row["revoked_at"])
                for row in _unit_rows(connection, ids["payment"])
            ] == identity

            command.downgrade(config, PREVIOUS_REVISION)
            assert len(_unit_rows(connection, ids["payment"])) == 9
            assert (
                connection.execute(
                    text("SELECT count(*) FROM check_ins WHERE id=:check_in"), params
                ).scalar_one()
                == 1
            )
            command.upgrade(config, REVISION)
            assert len(_unit_rows(connection, ids["payment"])) == 9
        finally:
            command.upgrade(config, REVISION)
            connection.execute(text("DELETE FROM check_ins WHERE id=:check_in"), params)
            connection.execute(
                text("DELETE FROM attendee_products WHERE payment_id=:payment"), params
            )
            connection.execute(
                text("DELETE FROM payment_products WHERE payment_id=:payment"), params
            )
            connection.execute(
                text("DELETE FROM payment_recipients WHERE payment_id=:payment"), params
            )
            connection.execute(text("DELETE FROM payments WHERE id=:payment"), params)
            connection.execute(
                text("DELETE FROM attendees WHERE id IN (:attendee_a,:attendee_b)"),
                params,
            )
            connection.execute(
                text("""
                DELETE FROM products WHERE id IN
                  (:parking_product,:attendee_product,:recipient_product,:preserved_product)
                """),
                params,
            )
            command.upgrade(config, HEAD_REVISION)


def test_backfill_excludes_nonapproved_nonoperational_and_ambiguous_lines(
    migration_test_engine, migration_tenant_popup_ids
) -> None:
    tenant_id, popup_id = migration_tenant_popup_ids
    keys = (
        "parking_product",
        "merch_product",
        "ticket_product",
        "attendee",
        "pending_payment",
        "fee_payment",
        "approved_payment",
        "ambiguous_payment",
        "pending_line",
        "fee_line",
        "nonoperational_line",
        "unresolved_line",
        "ambiguous_line",
        "ambiguous_line_b",
        "legacy_unit",
    )
    ids = dict(zip(keys, (uuid.uuid4() for _ in keys), strict=True))
    params = {**ids, "tenant": tenant_id, "popup": popup_id}

    with migration_test_engine.begin() as connection:
        config = _config(connection)
        command.downgrade(config, PREVIOUS_REVISION)
        try:
            _execute(
                connection,
                """
                INSERT INTO products
                  (id,tenant_id,popup_id,name,slug,price,category,requires_check_in)
                VALUES
                  (:parking_product,:tenant,:popup,'Excluded parking',CAST(:parking_product AS text),10,'parking',true),
                  (:merch_product,:tenant,:popup,'Excluded merch',CAST(:merch_product AS text),10,'merch',false),
                  (:ticket_product,:tenant,:popup,'Ambiguous ticket',CAST(:ticket_product AS text),10,'ticket',true);
                INSERT INTO attendees (id,tenant_id,popup_id,name)
                VALUES (:attendee,:tenant,:popup,'Ambiguous attendee');
                INSERT INTO payments
                  (id,tenant_id,popup_id,status,amount,payment_type)
                VALUES
                  (:pending_payment,:tenant,:popup,'pending',10,'pass_purchase'),
                  (:fee_payment,:tenant,:popup,'approved',10,'application_fee'),
                  (:approved_payment,:tenant,:popup,'approved',20,'pass_purchase'),
                  (:ambiguous_payment,:tenant,:popup,'approved',20,'pass_purchase');
                INSERT INTO payment_products
                  (id,tenant_id,payment_id,product_id,attendee_id,quantity,
                   product_name,product_price,product_category,product_currency,
                   requires_check_in_snapshot)
                VALUES
                  (:pending_line,:tenant,:pending_payment,:parking_product,NULL,1,
                   'Excluded parking',10,'parking','USD',true),
                  (:fee_line,:tenant,:fee_payment,:parking_product,NULL,1,
                   'Excluded parking',10,'parking','USD',true),
                  (:nonoperational_line,:tenant,:approved_payment,:merch_product,NULL,2,
                   'Excluded merch',10,'merch','USD',false),
                  (:unresolved_line,:tenant,:approved_payment,:ticket_product,NULL,2,
                   'Unresolved ticket',10,'ticket','USD',true),
                  (:ambiguous_line,:tenant,:ambiguous_payment,:ticket_product,:attendee,2,
                   'Ambiguous ticket',10,'ticket','USD',true),
                  (:ambiguous_line_b,:tenant,:ambiguous_payment,:ticket_product,:attendee,1,
                   'Ambiguous ticket',10,'ticket','USD',true);
                INSERT INTO attendee_products
                  (id,tenant_id,attendee_id,product_id,check_in_code,payment_id,
                   payment_product_id,unit_index,product_category_snapshot,
                   requires_check_in_snapshot)
                VALUES
                  (:legacy_unit,:tenant,:attendee,:ticket_product,'LEGACY01',
                   :ambiguous_payment,NULL,NULL,'ticket',true)
                """,
                params,
            )

            command.upgrade(config, REVISION)
            assert (
                connection.execute(
                    text("""
                SELECT count(*) FROM attendee_products
                WHERE payment_product_id IN
                  (:pending_line,:fee_line,:nonoperational_line,:unresolved_line,
                   :ambiguous_line,:ambiguous_line_b)
                """),
                    params,
                ).scalar_one()
                == 0
            )
            legacy = connection.execute(
                text("""
                SELECT id,check_in_code,payment_product_id,unit_index
                FROM attendee_products WHERE id=:legacy_unit
                """),
                params,
            ).one()
            assert legacy == (ids["legacy_unit"], "LEGACY01", None, None)

            module = _load_migration_module()
            report = module._backfill(connection)
            assert report["inserted"] == 0
            assert report["ambiguous_unlinked"] >= 1
            assert report["unresolved_attendee"] >= 1
        finally:
            command.upgrade(config, REVISION)
            connection.execute(
                text("""
                DELETE FROM attendee_products WHERE id=:legacy_unit OR payment_id IN
                  (:pending_payment,:fee_payment,:approved_payment,:ambiguous_payment)
                """),
                params,
            )
            connection.execute(
                text("""
                DELETE FROM payment_products WHERE payment_id IN
                  (:pending_payment,:fee_payment,:approved_payment,:ambiguous_payment)
                """),
                params,
            )
            connection.execute(
                text("""
                DELETE FROM payments WHERE id IN
                  (:pending_payment,:fee_payment,:approved_payment,:ambiguous_payment)
                """),
                params,
            )
            connection.execute(text("DELETE FROM attendees WHERE id=:attendee"), params)
            connection.execute(
                text("""
                DELETE FROM products WHERE id IN
                  (:parking_product,:merch_product,:ticket_product)
                """),
                params,
            )
            command.upgrade(config, HEAD_REVISION)


def test_materialization_revision_precedes_the_single_head() -> None:
    script = ScriptDirectory.from_config(Config("alembic.ini"))
    assert script.get_heads() == [HEAD_REVISION]
    assert script.get_revision(REVISION).down_revision == PREVIOUS_REVISION


def test_testcontainer_schema_is_at_repository_head(
    migration_test_engine,
) -> None:
    with migration_test_engine.connect() as connection:
        assert (
            MigrationContext.configure(connection).get_current_revision()
            == HEAD_REVISION
        )
