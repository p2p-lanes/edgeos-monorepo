"""Data migration coverage for flow-owned attendee category definitions."""

import uuid
from collections.abc import Generator

import pytest
from alembic import command
from alembic.config import Config
from sqlalchemy import Engine, create_engine, inspect, text
from sqlalchemy.engine import make_url

PREVIOUS_REVISION = "d4e8b1c7a2f9"
REVISION = "a7c9e2f4b6d8"


def _config(connection) -> Config:
    config = Config("alembic.ini")
    config.attributes["connection"] = connection
    return config


@pytest.fixture()
def flow_category_migration_engine(
    test_connection_url: str,
) -> Generator[Engine, None, None]:
    database = f"test_flow_categories_{uuid.uuid4().hex[:10]}"
    base_url = make_url(test_connection_url)
    admin_engine = create_engine(
        base_url.set(database="postgres"), isolation_level="AUTOCOMMIT"
    )
    engine = create_engine(base_url.set(database=database))
    try:
        with admin_engine.connect() as connection:
            connection.exec_driver_sql(f'CREATE DATABASE "{database}"')
        with engine.begin() as connection:
            command.upgrade(_config(connection), PREVIOUS_REVISION)
        yield engine
    finally:
        engine.dispose()
        with admin_engine.connect() as connection:
            connection.exec_driver_sql(f'DROP DATABASE "{database}" WITH (FORCE)')
        admin_engine.dispose()


def test_migration_clones_memberships_and_rewrites_flow_config(
    flow_category_migration_engine: Engine,
) -> None:
    tenant_id = uuid.uuid4()
    popup_id = uuid.uuid4()
    flow_ids = [uuid.uuid4(), uuid.uuid4(), uuid.uuid4()]
    main_id = uuid.uuid4()
    companion_id = uuid.uuid4()
    orphan_id = uuid.uuid4()
    step_id = uuid.uuid4()
    params = {
        "tenant": tenant_id,
        "tenant_slug": f"flow-category-tenant-{tenant_id}",
        "popup": popup_id,
        "popup_slug": f"flow-category-popup-{popup_id}",
        "flow_1": flow_ids[0],
        "flow_2": flow_ids[1],
        "flow_3": flow_ids[2],
        "main": main_id,
        "companion": companion_id,
        "orphan": orphan_id,
        "step": step_id,
    }

    with flow_category_migration_engine.begin() as connection:
        connection.execute(
            text(
                "INSERT INTO tenants (id,name,slug) "
                "VALUES (:tenant,'Flow category tenant',:tenant_slug)"
            ),
            params,
        )
        connection.execute(
            text(
                "INSERT INTO popups (id,tenant_id,name,slug,status) "
                "VALUES (:popup,:tenant,'Flow category popup',:popup_slug,'draft')"
            ),
            params,
        )
        connection.execute(
            text(
                "INSERT INTO sales_flows "
                '(id,tenant_id,popup_id,type,slug,name,is_default,"order") VALUES '
                "(:flow_1,:tenant,:popup,'application','first','First',TRUE,0),"
                "(:flow_2,:tenant,:popup,'application','second','Second',FALSE,1),"
                "(:flow_3,:tenant,:popup,'application','third','Third',FALSE,2)"
            ),
            params,
        )
        connection.execute(
            text(
                "INSERT INTO attendee_categories "
                "(id,tenant_id,popup_id,key,is_primary,sort_order,"
                "enabled_in_passes_flow,required_fields,display_meta) VALUES "
                "(:main,:tenant,:popup,'main',TRUE,0,TRUE,'[]'::jsonb,'{}'::jsonb),"
                "(:companion,:tenant,:popup,'guest',FALSE,1,TRUE,'[]'::jsonb,"
                '\'{"label": "Guest"}\'::jsonb),'
                "(:orphan,:tenant,:popup,'legacy',FALSE,2,FALSE,'[]'::jsonb,'{}'::jsonb)"
            ),
            params,
        )
        connection.execute(
            text(
                "INSERT INTO ticketingsteps "
                "(id,tenant_id,popup_id,sales_flow_id,step_type,title,template,template_config) "
                "VALUES (:step,:tenant,:popup,:flow_2,'tickets','Tickets','ticket-select',"
                "jsonb_build_object('sections',jsonb_build_array(jsonb_build_object("
                "'attendee_categories',jsonb_build_array("
                "CAST(:main AS text),CAST(:companion AS text))))))"
            ),
            params,
        )
        command.upgrade(_config(connection), REVISION)

        columns = {
            column["name"]: column
            for column in inspect(connection).get_columns("attendee_categories")
        }
        assert columns["sales_flow_id"]["nullable"] is False
        assert "deleted_at" in columns

        rows = connection.execute(
            text(
                "SELECT id,sales_flow_id,key,is_primary,display_meta,deleted_at "
                "FROM attendee_categories WHERE popup_id=:popup"
            ),
            {"popup": popup_id},
        ).mappings()
        categories = list(rows)

        for flow_id in flow_ids:
            mains = [
                row
                for row in categories
                if row["sales_flow_id"] == flow_id
                and row["is_primary"]
                and row["deleted_at"] is None
            ]
            assert len(mains) == 1
            assert mains[0]["key"] == "main"

        companions = [row for row in categories if row["key"] == "guest"]
        assert {row["sales_flow_id"] for row in companions} == set(flow_ids)
        assert len({row["id"] for row in companions}) == 3
        assert all(row["display_meta"] == {"label": "Guest"} for row in companions)
        assert (
            next(row for row in companions if row["sales_flow_id"] == min(flow_ids))[
                "id"
            ]
            == companion_id
        )

        orphan = next(row for row in categories if row["id"] == orphan_id)
        assert orphan["sales_flow_id"] == flow_ids[0]
        assert orphan["deleted_at"] is not None

        flow_2_ids = {
            str(row["id"])
            for row in categories
            if row["sales_flow_id"] == flow_ids[1] and row["deleted_at"] is None
        }
        config = connection.execute(
            text("SELECT template_config FROM ticketingsteps WHERE id=:step"),
            {"step": step_id},
        ).scalar_one()
        assert set(config["sections"][0]["attendee_categories"]) == flow_2_ids
