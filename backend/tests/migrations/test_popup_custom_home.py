"""Custom homes stay opt-in across fresh installs and migration round trips."""

from alembic import command
from alembic.config import Config
from alembic.script import ScriptDirectory
from sqlalchemy import inspect, text

REVISION = "d9e4c2a7b6f1"
PREVIOUS_REVISION = "a4f1c8b2e7d3"


def test_custom_home_migration_follows_previous_head():
    script = ScriptDirectory.from_config(Config("alembic.ini"))
    assert script.get_heads() == [REVISION]
    assert script.get_revision(REVISION).down_revision == PREVIOUS_REVISION


def test_custom_home_migration_defaults_and_round_trip(
    migration_test_engine, migration_tenant_popup_ids
):
    _, popup_id = migration_tenant_popup_ids
    with migration_test_engine.begin() as connection:
        config = Config("alembic.ini")
        config.attributes["connection"] = connection
        columns = {
            column["name"]: column
            for column in inspect(connection).get_columns("popups")
        }
        assert columns["custom_home_enabled"]["nullable"] is False
        assert columns["custom_home_enabled"]["default"] == "false"
        assert columns["custom_home_html"]["nullable"] is True

        def assert_opted_out():
            row = connection.execute(
                text("""
                    SELECT custom_home_enabled, custom_home_html
                    FROM popups WHERE id=:popup
                """),
                {"popup": popup_id},
            ).one()
            assert tuple(row) == (False, None)

        # The fixture inserted this popup after a fresh upgrade, without
        # specifying either setting: the database defaults must apply.
        assert_opted_out()
        connection.execute(
            text("""
                UPDATE popups
                SET custom_home_enabled=true, custom_home_html='<h1>Home</h1>'
                WHERE id=:popup
            """),
            {"popup": popup_id},
        )
        command.downgrade(config, PREVIOUS_REVISION)
        names = {column["name"] for column in inspect(connection).get_columns("popups")}
        assert {"custom_home_enabled", "custom_home_html"}.isdisjoint(names)
        assert (
            connection.execute(
                text("SELECT id FROM popups WHERE id=:popup"), {"popup": popup_id}
            ).scalar_one()
            == popup_id
        )

        # A popup that already exists before upgrade must also remain opted out.
        command.upgrade(config, REVISION)
        assert_opted_out()
