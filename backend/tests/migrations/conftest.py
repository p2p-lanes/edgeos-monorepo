"""Fixtures that isolate schema migration tests from application test data."""

import uuid
from collections.abc import Generator

import pytest
from alembic import command
from alembic.config import Config
from sqlalchemy import Engine, create_engine, text
from sqlalchemy.engine import make_url

MIGRATION_TEST_DATABASE = "test_migrations"


@pytest.fixture(scope="session")
def migration_test_engine(test_connection_url: str) -> Generator[Engine, None, None]:
    """Run migrations against a dedicated database in the shared container."""
    base_url = make_url(test_connection_url)
    admin_engine = create_engine(
        base_url.set(database="postgres"), isolation_level="AUTOCOMMIT"
    )
    engine = create_engine(base_url.set(database=MIGRATION_TEST_DATABASE))

    try:
        with admin_engine.connect() as connection:
            connection.exec_driver_sql("CREATE DATABASE test_migrations")

        with engine.begin() as connection:
            config = Config("alembic.ini")
            config.attributes["connection"] = connection
            command.upgrade(config, "head")

        yield engine
    finally:
        engine.dispose()
        with admin_engine.connect() as connection:
            connection.exec_driver_sql("DROP DATABASE test_migrations WITH (FORCE)")
        admin_engine.dispose()


@pytest.fixture(scope="session")
def migration_tenant_popup_ids(
    migration_test_engine: Engine,
) -> tuple[uuid.UUID, uuid.UUID]:
    """Seed the minimal tenant boundary required by migration data fixtures."""
    tenant_id = uuid.uuid4()
    popup_id = uuid.uuid4()
    params = {
        "tenant": tenant_id,
        "tenant_slug": f"migration-tenant-{tenant_id}",
        "popup": popup_id,
        "popup_slug": f"migration-popup-{popup_id}",
    }
    with migration_test_engine.begin() as connection:
        connection.execute(
            text("""
            INSERT INTO tenants (id,name,slug)
            VALUES (:tenant,'Migration test tenant',:tenant_slug)
            """),
            params,
        )
        connection.execute(
            text("""
            INSERT INTO popups (id,tenant_id,name,slug,status)
            VALUES (:popup,:tenant,'Migration test popup',:popup_slug,'draft')
            """),
            params,
        )
    return tenant_id, popup_id
