"""Stored sidebar layouts gain Agentic access as its own item after Events."""

import json

from alembic import command
from alembic.config import Config
from sqlalchemy import text

REVISION = "cd7cc70ae32b"
PREVIOUS_REVISION = "8c24d7e0f13a"


def _section(block_id: str, group: str, items: list[str]) -> dict:
    return {
        "id": block_id,
        "type": "section",
        "group": group,
        "items": items,
        "links": [],
    }


# edge-india's stored layout: Home at the top level, sections reordered.
REORDERED_LAYOUT = [
    {"id": "item-home", "type": "item", "resource": "home"},
    _section("community", "community", ["directory", "events", "referrals", "groups"]),
    _section("checkouts", "checkouts", ["checkouts"]),
    _section("commerce", "commerce", ["application", "passes", "orders"]),
]


def _set_config(connection, popup_id, config) -> None:
    connection.execute(
        text("UPDATE popups SET sidebar_config = CAST(:config AS JSONB) WHERE id=:id"),
        {"config": json.dumps(config), "id": popup_id},
    )


def _get_config(connection, popup_id) -> dict:
    current = connection.execute(
        text("SELECT sidebar_config FROM popups WHERE id=:id"),
        {"id": popup_id},
    ).scalar_one()
    return json.loads(current) if isinstance(current, str) else current


def test_agentic_access_lands_after_events_and_round_trips(
    migration_test_engine, migration_tenant_popup_ids
):
    _, popup_id = migration_tenant_popup_ids
    old_config = {"layout": REORDERED_LAYOUT, "hidden_items": []}

    with migration_test_engine.begin() as connection:
        config = Config("alembic.ini")
        config.attributes["connection"] = connection
        # Other migration tests leave the schema at older revisions.
        command.upgrade(config, "head")
        command.downgrade(config, PREVIOUS_REVISION)
        _set_config(connection, popup_id, old_config)

        command.upgrade(config, REVISION)
        current = _get_config(connection, popup_id)
        assert current["hidden_items"] == []
        assert current["layout"][0] == REORDERED_LAYOUT[0]
        assert current["layout"][1]["items"] == [
            "directory",
            "events",
            "agentic_access",
            "referrals",
            "groups",
        ]
        assert current["layout"][2:] == REORDERED_LAYOUT[2:]

        command.downgrade(config, PREVIOUS_REVISION)
        assert _get_config(connection, popup_id) == old_config

        command.upgrade(config, "head")


def test_hidden_agentic_access_stays_hidden(
    migration_test_engine, migration_tenant_popup_ids
):
    _, popup_id = migration_tenant_popup_ids
    old_config = {
        "layout": REORDERED_LAYOUT,
        "hidden_items": ["tracks", "agentic_access"],
    }

    with migration_test_engine.begin() as connection:
        config = Config("alembic.ini")
        config.attributes["connection"] = connection
        # Other migration tests leave the schema at older revisions.
        command.upgrade(config, "head")
        command.downgrade(config, PREVIOUS_REVISION)
        _set_config(connection, popup_id, old_config)

        command.upgrade(config, REVISION)
        current = _get_config(connection, popup_id)
        assert current["layout"] == REORDERED_LAYOUT
        assert current["hidden_items"] == ["tracks"]

        command.downgrade(config, PREVIOUS_REVISION)
        assert _get_config(connection, popup_id) == old_config

        command.upgrade(config, "head")
