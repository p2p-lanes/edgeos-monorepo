"""Migrate popup sidebar sections to ordered menu layouts."""

import json
from collections.abc import Sequence
from typing import Any

import sqlalchemy as sa
from alembic import op

revision: str = "c1d7a4e9b2f6"
down_revision: str | None = "b73c9e20a451"
branch_labels: Sequence[str] | None = None
depends_on: Sequence[str] | None = None

DEFAULT_GROUP_ITEMS: dict[str, list[str]] = {
    "commerce": ["home", "application", "passes", "orders"],
    "checkouts": ["checkouts"],
    "community": ["directory", "events", "referrals", "groups"],
}


def _upgrade_config(config: Any) -> dict[str, Any] | None:
    if not isinstance(config, dict) or "layout" in config:
        return None
    old_sections = config.get("sections")
    if not isinstance(old_sections, list):
        return None

    layout: list[dict[str, Any]] = []
    present_groups: set[str] = set()
    assigned_items: set[str] = set()
    standalone_items: set[str] = set()

    for index, old_section in enumerate(old_sections):
        if not isinstance(old_section, dict):
            continue
        block_id = old_section.get("id")
        if not isinstance(block_id, str) or not block_id:
            block_id = f"migrated-section-{index}"

        kind = old_section.get("kind")
        if kind == "standalone":
            resource = old_section.get("resource")
            if isinstance(resource, str) and resource:
                layout.append({"id": block_id, "type": "item", "resource": resource})
                standalone_items.add(resource)
                assigned_items.add(resource)
            continue

        group = kind if kind in DEFAULT_GROUP_ITEMS else None
        old_items = old_section.get("items")
        items = (
            [item for item in old_items if isinstance(item, str)]
            if isinstance(old_items, list)
            else DEFAULT_GROUP_ITEMS[group].copy()
            if group
            else []
        )
        old_links = old_section.get("links")
        links = old_links if isinstance(old_links, list) else []
        block: dict[str, Any] = {
            "id": block_id,
            "type": "section",
            "items": items,
            "links": links,
        }
        title = old_section.get("title")
        if isinstance(title, str):
            block["title"] = title
        if group:
            block["group"] = group
            present_groups.add(group)
        layout.append(block)
        assigned_items.update(items)

    # The previous portal appended missing built-in groups after configured
    # sections. Keep those resources visible and in the same relative order.
    for group, group_items in DEFAULT_GROUP_ITEMS.items():
        remaining = [
            item
            for item in group_items
            if item not in assigned_items and item not in standalone_items
        ]
        if group in present_groups:
            section = next(block for block in layout if block.get("group") == group)
            section["items"].extend(remaining)
        else:
            layout.append(
                {
                    "id": group,
                    "type": "section",
                    "group": group,
                    "items": remaining,
                    "links": [],
                }
            )
        assigned_items.update(remaining)

    # A resource moved to the top level should not also remain in its old group.
    for block in layout:
        if block.get("type") == "section":
            block["items"] = [
                item for item in block.get("items", []) if item not in standalone_items
            ]

    hidden_items = config.get("hidden_items")
    return {
        "layout": layout,
        "hidden_items": hidden_items if isinstance(hidden_items, list) else [],
    }


def _downgrade_config(config: Any) -> dict[str, Any] | None:
    if not isinstance(config, dict) or not isinstance(config.get("layout"), list):
        return None

    sections: list[dict[str, Any]] = []
    for block in config["layout"]:
        if not isinstance(block, dict):
            continue
        if block.get("type") == "item":
            sections.append(
                {
                    "id": block.get("id"),
                    "kind": "standalone",
                    "resource": block.get("resource"),
                }
            )
            continue
        if block.get("type") != "section":
            continue
        section: dict[str, Any] = {
            "id": block.get("id"),
            "kind": block.get("group", "external"),
            "items": block.get("items", []),
            "links": block.get("links", []),
        }
        if isinstance(block.get("title"), str):
            section["title"] = block["title"]
        sections.append(section)

    return {
        "sections": sections,
        "hidden_items": config.get("hidden_items", []),
    }


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
