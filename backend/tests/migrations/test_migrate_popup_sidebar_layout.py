"""Existing reordered sidebar sections migrate to the current layout format."""

import json

from alembic import command
from alembic.config import Config
from sqlalchemy import text

REVISION = "c1d7a4e9b2f6"
PREVIOUS_REVISION = "6f702315ea94"


def test_reordered_sections_and_menu_options_survive_layout_migration(
    migration_test_engine, migration_tenant_popup_ids
):
    _, popup_id = migration_tenant_popup_ids
    old_config = {
        "sections": [
            {"id": "community", "kind": "community"},
            {"id": "home-top", "kind": "standalone", "resource": "home"},
            {
                "id": "summit-links",
                "kind": "external",
                "title": "Summit links",
                "links": [
                    {
                        "id": "official-site",
                        "label": "Official website",
                        "url": "https://example.com/tech-summit",
                    }
                ],
            },
            {"id": "checkouts", "kind": "checkouts"},
        ],
        "hidden_items": ["tracks"],
    }

    with migration_test_engine.begin() as connection:
        config = Config("alembic.ini")
        config.attributes["connection"] = connection
        command.downgrade(config, PREVIOUS_REVISION)
        connection.execute(
            text(
                "UPDATE popups SET sidebar_config = CAST(:config AS JSONB) WHERE id=:id"
            ),
            {"config": json.dumps(old_config), "id": popup_id},
        )

        command.upgrade(config, REVISION)
        current = connection.execute(
            text("SELECT sidebar_config FROM popups WHERE id=:id"),
            {"id": popup_id},
        ).scalar_one()
        if isinstance(current, str):
            current = json.loads(current)

        assert current["hidden_items"] == ["tracks"]
        assert current["layout"] == [
            {
                "id": "community",
                "type": "section",
                "group": "community",
                "items": ["directory", "events", "referrals", "groups"],
                "links": [],
            },
            {"id": "home-top", "type": "item", "resource": "home"},
            {
                "id": "summit-links",
                "type": "section",
                "title": "Summit links",
                "items": [],
                "links": old_config["sections"][2]["links"],
            },
            {
                "id": "checkouts",
                "type": "section",
                "group": "checkouts",
                "items": ["checkouts"],
                "links": [],
            },
            {
                "id": "commerce",
                "type": "section",
                "group": "commerce",
                "items": ["application", "passes", "orders"],
                "links": [],
            },
        ]

        command.downgrade(config, PREVIOUS_REVISION)
        restored = connection.execute(
            text("SELECT sidebar_config FROM popups WHERE id=:id"),
            {"id": popup_id},
        ).scalar_one()
        if isinstance(restored, str):
            restored = json.loads(restored)
        assert [section["id"] for section in restored["sections"]] == [
            "community",
            "home-top",
            "summit-links",
            "checkouts",
            "commerce",
        ]

        command.upgrade(config, REVISION)
