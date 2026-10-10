"""Refresh storage is hashed/backend-private; migrations preserve app data."""

from alembic import command
from alembic.config import Config
from alembic.script import ScriptDirectory
from sqlalchemy import inspect, text

REVISION = "a1d3f5b7c9e2"
PREVIOUS = "f0fbedba955c"
TABLES = ("third_party_grants", "third_party_refresh_tokens")


def config_for(connection):
    config = Config("alembic.ini")
    config.attributes["connection"] = connection
    return config


def test_refresh_schema_and_private_permissions(migration_test_engine):
    script = ScriptDirectory.from_config(Config("alembic.ini"))
    assert script.get_heads() == [REVISION]
    assert script.get_revision(REVISION).down_revision == PREVIOUS
    with migration_test_engine.begin() as connection:
        command.upgrade(config_for(connection), REVISION)
        inspector = inspect(connection)
        for table in TABLES:
            assert connection.execute(
                text(
                    "SELECT relrowsecurity, relforcerowsecurity FROM pg_class WHERE oid = to_regclass(:table)"
                ),
                {"table": table},
            ).one() == (True, True)
            policy = connection.execute(
                text(
                    "SELECT qual, with_check FROM pg_policies WHERE schemaname = 'public' AND tablename = :table"
                ),
                {"table": table},
            ).one()
            assert all("app.tenant_id" in expression for expression in policy)
            for role in ("tenant_role", "tenant_viewer_role"):
                for privilege in ("SELECT", "INSERT", "UPDATE", "DELETE"):
                    assert not connection.scalar(
                        text("SELECT has_table_privilege(:role, :table, :privilege)"),
                        {"role": role, "table": table, "privilege": privilege},
                    )
        assert inspector.get_pk_constraint(TABLES[1])["constrained_columns"] == [
            "token_hash"
        ]
        assert "refresh_token" not in {
            c["name"] for c in inspector.get_columns(TABLES[1])
        }
        assert all(
            fk["options"]["ondelete"] == "CASCADE"
            for table in TABLES
            for fk in inspector.get_foreign_keys(table)
        )
        assert (
            inspector.get_check_constraints(TABLES[0])[0]["name"]
            == "third_party_grant_origin_check"
        )


def test_refresh_downgrade_and_upgrade_preserve_existing_auth(migration_test_engine):
    with migration_test_engine.begin() as connection:
        config = config_for(connection)
        command.upgrade(config, REVISION)
        app_columns_before = {
            c["name"] for c in inspect(connection).get_columns("third_party_apps")
        }
        try:
            command.downgrade(config, PREVIOUS)
            assert not set(TABLES) & set(inspect(connection).get_table_names())
            assert (
                "third_party_authorization_codes"
                in inspect(connection).get_table_names()
            )
            assert {
                c["name"] for c in inspect(connection).get_columns("third_party_apps")
            } == app_columns_before
        finally:
            command.upgrade(config, REVISION)
        assert set(TABLES) <= set(inspect(connection).get_table_names())
