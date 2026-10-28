"""Make Agentic access its own sidebar item instead of an Events child.

API keys now reach the attendee directory as well as the events module, so
Agentic access moves out from under Events. Stored layouts that showed it
(under a visible Events entry, not listed in hidden_items) get it right after
Events; those that hid it keep it hidden by leaving it out of the layout.

Revision ID: cd7cc70ae32b
Revises: 8c24d7e0f13a
"""

import json
from typing import Any

import sqlalchemy as sa
from alembic import op

revision = "cd7cc70ae32b"
down_revision = "8c24d7e0f13a"
branch_labels = None
depends_on = None

AGENTIC_ACCESS = "agentic_access"
EVENTS = "events"


def _layout_mentions(layout: list[Any], resource: str) -> bool:
    for block in layout:
        if not isinstance(block, dict):
            continue
        if block.get("type") == "item" and block.get("resource") == resource:
            return True
        items = block.get("items")
        if block.get("type") == "section" and isinstance(items, list):
            if resource in items:
                return True
    return False


def _upgrade_config(config: Any) -> dict[str, Any] | None:
    if not isinstance(config, dict) or not isinstance(config.get("layout"), list):
        return None
    layout: list[Any] = config["layout"]
    if _layout_mentions(layout, AGENTIC_ACCESS):
        return None

    hidden_items = config.get("hidden_items")
    hidden_items = hidden_items if isinstance(hidden_items, list) else []
    if AGENTIC_ACCESS in hidden_items:
        # Hidden as an Events child; a top-level item is hidden by being absent.
        return {
            **config,
            "hidden_items": [item for item in hidden_items if item != AGENTIC_ACCESS],
        }

    new_layout: list[Any] = []
    placed = False
    for block in layout:
        if not placed and isinstance(block, dict):
            items = block.get("items")
            if (
                block.get("type") == "section"
                and isinstance(items, list)
                and EVENTS in items
            ):
                index = items.index(EVENTS) + 1
                block = {
                    **block,
                    "items": [*items[:index], AGENTIC_ACCESS, *items[index:]],
                }
                placed = True
            elif block.get("type") == "item" and block.get("resource") == EVENTS:
                new_layout.append(block)
                block = {
                    "id": "item-agentic_access",
                    "type": "item",
                    "resource": AGENTIC_ACCESS,
                }
                placed = True
        new_layout.append(block)

    # Without Events in the layout, Agentic access was never shown.
    if not placed:
        return None
    return {**config, "layout": new_layout}


def _downgrade_config(config: Any) -> dict[str, Any] | None:
    if not isinstance(config, dict) or not isinstance(config.get("layout"), list):
        return None
    layout: list[Any] = config["layout"]
    hidden_items = config.get("hidden_items")
    hidden_items = hidden_items if isinstance(hidden_items, list) else []

    if _layout_mentions(layout, AGENTIC_ACCESS):
        new_layout: list[Any] = []
        for block in layout:
            if isinstance(block, dict):
                if (
                    block.get("type") == "item"
                    and block.get("resource") == AGENTIC_ACCESS
                ):
                    continue
                items = block.get("items")
                if block.get("type") == "section" and isinstance(items, list):
                    block = {
                        **block,
                        "items": [item for item in items if item != AGENTIC_ACCESS],
                    }
            new_layout.append(block)
        return {**config, "layout": new_layout}

    # Left out of the layout means hidden; as an Events child that needs hidden_items.
    if _layout_mentions(layout, EVENTS) and AGENTIC_ACCESS not in hidden_items:
        return {**config, "hidden_items": [*hidden_items, AGENTIC_ACCESS]}
    return None


def _transform_sidebar_configs(transformer) -> None:
    connection = op.get_bind()
    rows = connection.execute(
        sa.text(
            "SELECT id, sidebar_config FROM popups WHERE sidebar_config IS NOT NULL"
        )
    )
    update = sa.text(
        "UPDATE popups SET sidebar_config = CAST(:config AS JSONB) WHERE id = :id"
    )
    for popup_id, config in rows:
        new_config = transformer(config)
        if new_config is not None:
            connection.execute(
                update,
                {"id": popup_id, "config": json.dumps(new_config)},
            )


def upgrade() -> None:
    _transform_sidebar_configs(_upgrade_config)


def downgrade() -> None:
    _transform_sidebar_configs(_downgrade_config)
