"""Popup home HTML migrates into a lightweight, tenant-scoped resource."""

from alembic import command
from alembic.config import Config
from sqlalchemy import inspect, text

REVISION = "e2c6a91b7d4f"
PREVIOUS_REVISION = "a7c9e2f4b6d8"


def test_popup_home_resource_migrates_source_and_round_trips(
    migration_test_engine, migration_tenant_popup_ids
):
    tenant_id, popup_id = migration_tenant_popup_ids
    html = "<h1>Preserved draft</h1>"

    with migration_test_engine.begin() as connection:
        config = Config("alembic.ini")
        config.attributes["connection"] = connection
        try:
            command.downgrade(config, PREVIOUS_REVISION)
            assert "popup_home_pages" not in inspect(connection).get_table_names()
            assert "custom_home_html" in {
                column["name"] for column in inspect(connection).get_columns("popups")
            }
            connection.execute(
                text(
                    """
                    UPDATE popups
                    SET custom_home_enabled=true, custom_home_html=:html
                    WHERE id=:popup
                    """
                ),
                {"html": html, "popup": popup_id},
            )

            command.upgrade(config, REVISION)
            assert "custom_home_html" not in {
                column["name"] for column in inspect(connection).get_columns("popups")
            }
            columns = {
                column["name"]: column
                for column in inspect(connection).get_columns("popup_home_pages")
            }
            assert columns["popup_id"]["nullable"] is False
            assert columns["tenant_id"]["nullable"] is False
            assert columns["html"]["nullable"] is True
            assert columns["version"]["default"] == "1"

            row = connection.execute(
                text(
                    """
                    SELECT tenant_id, html, version
                    FROM popup_home_pages
                    WHERE popup_id=:popup
                    """
                ),
                {"popup": popup_id},
            ).one()
            assert tuple(row) == (tenant_id, html, 1)

            policy = connection.execute(
                text(
                    """
                    SELECT policyname
                    FROM pg_policies
                    WHERE tablename='popup_home_pages'
                    """
                )
            ).scalar_one()
            assert policy == "tenant_isolation_policy_popup_home_pages"

            foreign_keys = inspect(connection).get_foreign_keys("popup_home_pages")
            popup_fk = next(
                fk for fk in foreign_keys if fk["referred_table"] == "popups"
            )
            assert popup_fk["options"]["ondelete"] == "CASCADE"

            command.downgrade(config, PREVIOUS_REVISION)
            restored = connection.execute(
                text("SELECT custom_home_html FROM popups WHERE id=:popup"),
                {"popup": popup_id},
            ).scalar_one()
            assert restored == html
        finally:
            command.upgrade(config, REVISION)
