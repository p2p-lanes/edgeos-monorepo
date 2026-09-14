"""Make attendee category definitions sales-flow owned.

Revision ID: a7c9e2f4b6d8
Revises: d4e8b1c7a2f9
"""

import json
from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import UUID

revision: str = "a7c9e2f4b6d8"
down_revision: str = "d4e8b1c7a2f9"
branch_labels: Sequence[str] | None = None
depends_on: Sequence[str] | None = None


def _rewrite_ticketing_category_ids(connection) -> None:
    """Point each flow's ticket-select config at its cloned category rows."""
    mapping = {
        (str(old_category_id), sales_flow_id): str(new_category_id)
        for old_category_id, sales_flow_id, new_category_id in connection.execute(
            sa.text(
                "SELECT old_category_id, sales_flow_id, new_category_id "
                "FROM attendee_category_flow_migration_map"
            )
        ).fetchall()
    }
    owners = {
        str(category_id): (sales_flow_id, deleted_at is None)
        for category_id, sales_flow_id, deleted_at in connection.execute(
            sa.text("SELECT id, sales_flow_id, deleted_at FROM attendee_categories")
        ).fetchall()
    }
    steps = connection.execute(
        sa.text(
            "SELECT id, sales_flow_id, template_config FROM ticketingsteps "
            "WHERE template = 'ticket-select' AND template_config IS NOT NULL"
        )
    ).fetchall()

    for step_id, sales_flow_id, template_config in steps:
        if not isinstance(template_config, dict):
            continue
        changed = False
        new_sections = []
        for section in template_config.get("sections") or []:
            if not isinstance(section, dict):
                new_sections.append(section)
                continue
            category_ids = section.get("attendee_categories")
            if not isinstance(category_ids, list):
                new_sections.append(section)
                continue

            rewritten = []
            for category_id in category_ids:
                raw_id = str(category_id)
                replacement = mapping.get((raw_id, sales_flow_id))
                if replacement is not None:
                    rewritten.append(replacement)
                    changed = changed or replacement != raw_id
                    continue
                owner = owners.get(raw_id)
                if owner == (sales_flow_id, True):
                    rewritten.append(raw_id)
                else:
                    changed = True

            if rewritten != category_ids:
                changed = True
            new_sections.append({**section, "attendee_categories": rewritten})

        if changed:
            new_config = {**template_config, "sections": new_sections}
            connection.execute(
                sa.text(
                    "UPDATE ticketingsteps SET template_config = :config WHERE id = :id"
                ),
                {"config": json.dumps(new_config), "id": step_id},
            )


def upgrade() -> None:
    connection = op.get_bind()

    op.add_column(
        "attendee_categories",
        sa.Column("sales_flow_id", UUID(as_uuid=True), nullable=True),
    )
    op.add_column(
        "attendee_categories",
        sa.Column("deleted_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.drop_constraint(
        "uq_attendee_categories_popup_key",
        "attendee_categories",
        type_="unique",
    )
    op.drop_index(
        "uq_attendee_categories_popup_primary",
        table_name="attendee_categories",
    )

    op.execute(
        "CREATE TEMP TABLE attendee_category_flow_migration_map ("
        "old_category_id uuid NOT NULL, "
        "sales_flow_id uuid NOT NULL, "
        "new_category_id uuid NOT NULL, "
        "PRIMARY KEY (old_category_id, sales_flow_id)"
        ") ON COMMIT DROP"
    )
    op.execute(
        "WITH ranked AS ("
        "SELECT category.id AS attendee_category_id, "
        "flow.id AS sales_flow_id, "
        "row_number() OVER ("
        "PARTITION BY category.id ORDER BY flow.id"
        ") AS position "
        "FROM attendee_categories AS category "
        "JOIN sales_flows AS flow "
        "ON flow.popup_id = category.popup_id "
        "AND flow.tenant_id = category.tenant_id "
        "WHERE category.is_primary IS TRUE "
        "OR category.enabled_in_passes_flow IS TRUE"
        ") "
        "INSERT INTO attendee_category_flow_migration_map "
        "(old_category_id, sales_flow_id, new_category_id) "
        "SELECT attendee_category_id, sales_flow_id, "
        "CASE WHEN position = 1 THEN attendee_category_id ELSE gen_random_uuid() END "
        "FROM ranked"
    )
    op.execute(
        "INSERT INTO attendee_categories ("
        "id, tenant_id, popup_id, sales_flow_id, key, is_primary, sort_order, "
        "max_per_application, required_fields, display_meta, created_at, updated_at"
        ") "
        "SELECT migration.new_category_id, category.tenant_id, category.popup_id, "
        "migration.sales_flow_id, category.key, category.is_primary, "
        "category.sort_order, category.max_per_application, "
        "category.required_fields, category.display_meta, "
        "category.created_at, category.updated_at "
        "FROM attendee_category_flow_migration_map AS migration "
        "JOIN attendee_categories AS category "
        "ON category.id = migration.old_category_id "
        "WHERE migration.new_category_id <> migration.old_category_id"
    )
    op.execute(
        "UPDATE attendee_categories AS category "
        "SET sales_flow_id = migration.sales_flow_id "
        "FROM attendee_category_flow_migration_map AS migration "
        "WHERE migration.old_category_id = category.id "
        "AND migration.new_category_id = category.id"
    )

    # Preserve disabled legacy definitions for historical foreign keys. They
    # receive a deterministic owner but stay hidden from live flow configuration.
    op.execute(
        "WITH owners AS ("
        "SELECT category.id AS category_id, ("
        "SELECT flow.id FROM sales_flows AS flow "
        "WHERE flow.popup_id = category.popup_id "
        "AND flow.tenant_id = category.tenant_id "
        'ORDER BY flow.is_default DESC, flow."order", flow.created_at, flow.id '
        "LIMIT 1"
        ") AS sales_flow_id "
        "FROM attendee_categories AS category "
        "WHERE category.sales_flow_id IS NULL"
        ") "
        "UPDATE attendee_categories AS category "
        "SET sales_flow_id = owners.sales_flow_id, "
        "deleted_at = CASE WHEN category.is_primary THEN NULL ELSE now() END "
        "FROM owners WHERE owners.category_id = category.id"
    )

    # A missing legacy main must not leave a flow unusable.
    op.execute(
        "UPDATE attendee_categories SET deleted_at = NULL WHERE is_primary IS TRUE"
    )
    op.execute(
        "INSERT INTO attendee_categories ("
        "id, tenant_id, popup_id, sales_flow_id, key, is_primary, sort_order, "
        "max_per_application, required_fields, display_meta"
        ") "
        "SELECT gen_random_uuid(), flow.tenant_id, flow.popup_id, flow.id, "
        "'main', TRUE, 0, NULL, '[]'::jsonb, '{}'::jsonb "
        "FROM sales_flows AS flow "
        "WHERE NOT EXISTS ("
        "SELECT 1 FROM attendee_categories AS category "
        "WHERE category.sales_flow_id = flow.id "
        "AND category.is_primary IS TRUE"
        ")"
    )

    op.execute(
        "DO $$ BEGIN "
        "IF EXISTS (SELECT 1 FROM attendee_categories WHERE sales_flow_id IS NULL) "
        "THEN RAISE EXCEPTION "
        "'attendee category migration left rows without a sales flow owner'; "
        "END IF; "
        "IF EXISTS ("
        "SELECT 1 FROM sales_flows AS flow "
        "WHERE (SELECT count(*) FROM attendee_categories AS category "
        "WHERE category.sales_flow_id = flow.id "
        "AND category.is_primary IS TRUE AND category.deleted_at IS NULL) <> 1"
        ") THEN RAISE EXCEPTION "
        "'attendee category migration did not create exactly one main per flow'; "
        "END IF; END $$"
    )

    _rewrite_ticketing_category_ids(connection)

    op.drop_column("attendee_categories", "enabled_in_passes_flow")
    op.alter_column("attendee_categories", "sales_flow_id", nullable=False)
    op.create_foreign_key(
        "fk_attendee_categories_sales_flow_id_sales_flows",
        "attendee_categories",
        "sales_flows",
        ["sales_flow_id"],
        ["id"],
        ondelete="CASCADE",
    )
    op.create_index(
        "ix_attendee_categories_sales_flow_id",
        "attendee_categories",
        ["sales_flow_id"],
    )
    op.create_unique_constraint(
        "uq_attendee_categories_sales_flow_key",
        "attendee_categories",
        ["sales_flow_id", "key"],
    )
    op.create_index(
        "uq_attendee_categories_sales_flow_primary",
        "attendee_categories",
        ["sales_flow_id"],
        unique=True,
        postgresql_where=sa.text("is_primary = true"),
    )


def downgrade() -> None:
    connection = op.get_bind()
    divergent = connection.execute(
        sa.text(
            "SELECT popup_id, key FROM attendee_categories "
            "GROUP BY popup_id, key HAVING count(DISTINCT ("
            "is_primary, sort_order, max_per_application, "
            "required_fields::text, display_meta::text"
            ")) > 1 LIMIT 1"
        )
    ).first()
    if divergent is not None:
        raise RuntimeError(
            "Downgrade aborted before DDL: independently edited flow categories "
            "cannot be losslessly merged into a popup-shared catalog"
        )

    partial = connection.execute(
        sa.text(
            "SELECT category.popup_id, category.key "
            "FROM attendee_categories AS category "
            "GROUP BY category.popup_id, category.key "
            "HAVING count(*) FILTER (WHERE category.deleted_at IS NULL) "
            "NOT IN (0, (SELECT count(*) FROM sales_flows AS flow "
            "WHERE flow.popup_id = category.popup_id)) LIMIT 1"
        )
    ).first()
    if partial is not None:
        raise RuntimeError(
            "Downgrade aborted before DDL: flow-specific category availability "
            "cannot be represented by the popup-level legacy flag"
        )

    op.add_column(
        "attendee_categories",
        sa.Column(
            "enabled_in_passes_flow",
            sa.Boolean(),
            nullable=False,
            server_default=sa.false(),
        ),
    )
    op.execute(
        "CREATE TEMP TABLE attendee_category_popup_merge_map ON COMMIT DROP AS "
        "SELECT id AS old_category_id, "
        "first_value(id) OVER (PARTITION BY popup_id, key ORDER BY id) "
        "AS survivor_id, "
        "tenant_id, sales_flow_id, deleted_at "
        "FROM attendee_categories"
    )
    # Preserve all relational history while converging duplicate definitions.
    for table_name, column_name in (
        ("attendees", "category_id"),
        ("products", "attendee_category_id"),
        ("payment_recipients", "category_id"),
    ):
        op.execute(
            f"UPDATE {table_name} AS child SET {column_name} = merge.survivor_id "
            "FROM attendee_category_popup_merge_map AS merge "
            f"WHERE child.{column_name} = merge.old_category_id "
            "AND merge.old_category_id <> merge.survivor_id"
        )

    replacement = {
        str(old_id): str(survivor_id)
        for old_id, survivor_id in connection.execute(
            sa.text(
                "SELECT old_category_id, survivor_id "
                "FROM attendee_category_popup_merge_map"
            )
        ).fetchall()
    }
    steps = connection.execute(
        sa.text(
            "SELECT id, template_config FROM ticketingsteps "
            "WHERE template = 'ticket-select' AND template_config IS NOT NULL"
        )
    ).fetchall()
    for step_id, template_config in steps:
        if not isinstance(template_config, dict):
            continue
        changed = False
        sections = []
        for section in template_config.get("sections") or []:
            if not isinstance(section, dict):
                sections.append(section)
                continue
            category_ids = section.get("attendee_categories")
            if not isinstance(category_ids, list):
                sections.append(section)
                continue
            rewritten = [
                replacement.get(str(value), str(value)) for value in category_ids
            ]
            changed = changed or rewritten != category_ids
            sections.append({**section, "attendee_categories": rewritten})
        if changed:
            connection.execute(
                sa.text(
                    "UPDATE ticketingsteps SET template_config = :config WHERE id = :id"
                ),
                {
                    "config": json.dumps({**template_config, "sections": sections}),
                    "id": step_id,
                },
            )

    op.execute(
        "UPDATE attendee_categories AS category "
        "SET enabled_in_passes_flow = state.enabled "
        "FROM (SELECT survivor_id, bool_or(deleted_at IS NULL) AS enabled "
        "FROM attendee_category_popup_merge_map GROUP BY survivor_id) AS state "
        "WHERE category.id = state.survivor_id"
    )
    op.execute(
        "DELETE FROM attendee_categories AS category USING "
        "attendee_category_popup_merge_map AS merge "
        "WHERE category.id = merge.old_category_id "
        "AND merge.old_category_id <> merge.survivor_id"
    )

    op.drop_index(
        "uq_attendee_categories_sales_flow_primary",
        table_name="attendee_categories",
    )
    op.drop_constraint(
        "uq_attendee_categories_sales_flow_key",
        "attendee_categories",
        type_="unique",
    )
    op.drop_index(
        "ix_attendee_categories_sales_flow_id",
        table_name="attendee_categories",
    )
    op.drop_constraint(
        "fk_attendee_categories_sales_flow_id_sales_flows",
        "attendee_categories",
        type_="foreignkey",
    )
    op.drop_column("attendee_categories", "deleted_at")
    op.drop_column("attendee_categories", "sales_flow_id")
    op.create_unique_constraint(
        "uq_attendee_categories_popup_key",
        "attendee_categories",
        ["popup_id", "key"],
    )
    op.create_index(
        "uq_attendee_categories_popup_primary",
        "attendee_categories",
        ["popup_id"],
        unique=True,
        postgresql_where=sa.text("is_primary = true"),
    )
