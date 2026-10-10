"""SSO migration preserves app registrations and enforces tenant RLS."""

from alembic import command
from alembic.config import Config
from alembic.script import ScriptDirectory
from sqlalchemy import inspect, text

HEAD_REVISION = "a1d3f5b7c9e2"
SSO_REVISION = "b5e7a9c1d3f2"
PREVIOUS_REVISION = "a4f6b8d2c9e1"
TABLES = ("popup_third_party_apps", "third_party_authorization_codes")
URL_COLUMNS = {"sso_start_url", "sso_redirect_uri"}


def test_sso_schema_and_tenant_permissions(migration_test_engine):
    script = ScriptDirectory.from_config(Config("alembic.ini"))
    assert script.get_heads() == [HEAD_REVISION]
    assert script.get_revision(SSO_REVISION).down_revision == PREVIOUS_REVISION
    with migration_test_engine.begin() as connection:
        config = Config("alembic.ini")
        config.attributes["connection"] = connection
        command.upgrade(config, HEAD_REVISION)
        columns = {
            column["name"]: column
            for column in inspect(connection).get_columns("third_party_apps")
        }
        assert URL_COLUMNS <= columns.keys()
        assert all(columns[name]["nullable"] for name in URL_COLUMNS)
        for table in TABLES:
            rls = connection.execute(
                text("""SELECT relrowsecurity, relforcerowsecurity FROM pg_class
                     WHERE oid = to_regclass(:table)"""),
                {"table": table},
            ).one()
            assert rls == (True, True)
            policy = connection.execute(
                text("""SELECT qual, with_check FROM pg_policies
                     WHERE schemaname = 'public' AND tablename = :table"""),
                {"table": table},
            ).one()
            assert all("app.tenant_id" in expression for expression in policy)
            for privilege in ("SELECT", "INSERT", "UPDATE", "DELETE"):
                assert connection.scalar(
                    text(
                        "SELECT has_table_privilege('tenant_role', :table, :privilege)"
                    ),
                    {"table": table, "privilege": privilege},
                )
            assert connection.scalar(
                text(
                    "SELECT has_table_privilege('tenant_viewer_role', :table, 'SELECT')"
                ),
                {"table": table},
            )
        assert inspect(connection).get_pk_constraint(TABLES[1])[
            "constrained_columns"
        ] == ["code_hash"]
        assert "code" not in {
            column["name"] for column in inspect(connection).get_columns(TABLES[1])
        }


def test_sso_downgrade_and_upgrade_preserve_app_table(migration_test_engine):
    with migration_test_engine.begin() as connection:
        config = Config("alembic.ini")
        config.attributes["connection"] = connection
        command.upgrade(config, HEAD_REVISION)
        try:
            command.downgrade(config, PREVIOUS_REVISION)
            names = inspect(connection).get_table_names()
            assert "third_party_apps" in names
            assert not set(TABLES) & set(names)
            columns = {
                column["name"]
                for column in inspect(connection).get_columns("third_party_apps")
            }
            assert not URL_COLUMNS & columns
        finally:
            command.upgrade(config, HEAD_REVISION)
        assert set(TABLES) <= set(inspect(connection).get_table_names())
        assert URL_COLUMNS <= {
            column["name"]
            for column in inspect(connection).get_columns("third_party_apps")
        }
