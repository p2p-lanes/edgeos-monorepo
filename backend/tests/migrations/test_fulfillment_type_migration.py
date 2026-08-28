"""Migration coverage for persisted fulfillment classification."""

import importlib.util
import json
import uuid
from pathlib import Path

import pytest
from alembic import command
from alembic.config import Config
from sqlalchemy import inspect
from sqlalchemy.exc import IntegrityError
from sqlmodel import Session, text

from app.api.attendee.models import AttendeeProducts
from app.api.payment.models import PaymentProducts
from app.api.product.models import Products

REVISION = "e4a7c2d9b1f6"
PREVIOUS_REVISION = "d9c7b4e2a1f8"
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


def _exec_script(db: Session, script: str, params: dict) -> None:
    for statement in script.split(";"):
        if statement.strip():
            db.exec(text(statement), params=params)


def _typed_rows(db: Session, table: str, label: str, keys: tuple[str, ...], params):
    placeholders = ",".join(f":{key}" for key in keys)
    return db.exec(
        text(
            f"SELECT {label},fulfillment_type FROM {table} WHERE id IN ({placeholders}) ORDER BY {label}"
        ),  # noqa: S608 - test-only fixed identifiers
        params=params,
    ).all()


def test_models_map_nullable_checked_and_indexed_fulfillment_type() -> None:
    tables = (Products.__table__, PaymentProducts.__table__, AttendeeProducts.__table__)
    for table in tables:
        assert table.c.fulfillment_type.nullable
        assert f"ck_{table.name}_fulfillment_type" in {
            constraint.name for constraint in table.constraints
        }
    indexes = {index.name for table in tables for index in table.indexes}
    assert indexes.issuperset(
        {
            "ix_products_fulfillment_type",
            "ix_payment_products_payment_fulfillment_type",
            "ix_attendee_products_attendee_fulfillment_type",
        }
    )


def test_upgrade_downgrade_cycle_creates_checks_and_indexes(test_engine) -> None:
    cfg = Config("alembic.ini")
    with test_engine.begin() as connection:
        cfg.attributes["connection"] = connection
        command.downgrade(cfg, PREVIOUS_REVISION)
        downgraded_checks = {
            check["name"]
            for check in inspect(connection).get_check_constraints("payment_products")
        }
        assert LEGACY_CONSTRAINT in downgraded_checks
        assert COMPATIBILITY_CONSTRAINT not in downgraded_checks
        assert all(
            "fulfillment_type"
            not in {column["name"] for column in inspect(connection).get_columns(table)}
            for table in ("products", "payment_products", "attendee_products")
        )
        command.upgrade(cfg, "head")
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
    db: Session,
    tenant_a,
    popup_tenant_a,
    fulfillment_type,
    has_recipient,
    has_attendee,
    accepted,
) -> None:
    ids = {
        key: uuid.uuid4()
        for key in ("product", "payment", "attendee", "recipient", "line")
    }
    params = {
        **ids,
        "tenant": tenant_a.id,
        "popup": popup_tenant_a.id,
        "type": fulfillment_type,
        "recipient_identity": ids["recipient"] if has_recipient else None,
        "attendee_identity": ids["attendee"] if has_attendee else None,
    }
    try:
        _exec_script(
            db,
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
            db.exec(statement, params=params)
            assert (
                db.exec(
                    text(
                        "SELECT fulfillment_type FROM payment_products WHERE id=:line"
                    ),
                    params=params,
                ).scalar_one()
                == fulfillment_type
            )
        else:
            with pytest.raises(IntegrityError):
                with db.begin_nested():
                    db.exec(statement, params=params)
    finally:
        db.rollback()


def test_downgrade_rejects_identity_free_order_rows(
    db: Session, test_engine, tenant_a, popup_tenant_a
) -> None:
    ids = {key: uuid.uuid4() for key in ("product", "payment", "line")}
    params = {**ids, "tenant": tenant_a.id, "popup": popup_tenant_a.id}
    _exec_script(
        db,
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
    db.commit()

    cfg = Config("alembic.ini")
    with pytest.raises(IntegrityError):
        with test_engine.begin() as connection:
            cfg.attributes["connection"] = connection
            command.downgrade(cfg, PREVIOUS_REVISION)

    with test_engine.begin() as connection:
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
        db,
        """
        DELETE FROM payment_products WHERE id=:line;
        DELETE FROM payments WHERE id=:payment;
        DELETE FROM products WHERE id=:product;
        """,
        params,
    )
    db.commit()


def test_backfill_classifies_evidence_propagates_snapshots_and_reports_stably(
    db: Session, tenant_a, popup_tenant_a, default_flow_tenant_a, capsys
) -> None:
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
        "tenant": tenant_a.id,
        "popup": popup_tenant_a.id,
        "flow": default_flow_tenant_a.id,
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
        baseline = module._backfill(db.connection())
        capsys.readouterr()
        _exec_script(
            db,
            """
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
        first = module._backfill(db.connection())
        second = module._backfill(db.connection())
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
        products = _typed_rows(db, "products", "name", product_keys, params)
        snapshots = _typed_rows(db, "payment_products", "product_name", pp_keys, params)
        holdings = _typed_rows(
            db, "attendee_products", "check_in_code", ap_keys, params
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
            db.exec(
                text(
                    "UPDATE products SET fulfillment_type='invalid' WHERE id=:product_access"
                ),
                params=params,
            )
    finally:
        db.rollback()
