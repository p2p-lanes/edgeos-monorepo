"""Replace hardcoded main|spouse|kid enum with declarative attendee_categories table.

PR 1: Creates the attendee_categories table, seeds rows from existing attendees,
adds FK columns to attendees and products, backfills them, rewrites
ticketingsteps.template_config attendee_categories arrays from string values to
UUID arrays.

Legacy text columns (attendees.category, products.attendee_category,
popups.allows_spouse/children, applications.brings_*) are NOT dropped here.
They are dropped in PR 2 migration.

Revision ID: 96426891f501
Revises: 0d62c955bfdf
Create Date: 2026-05-13
"""

import json
from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import JSONB, UUID

from app.alembic.utils import (
    add_tenant_table_permissions,
    remove_tenant_table_permissions,
)

revision: str = "96426891f501"
down_revision: str = "0d62c955bfdf"
branch_labels: Sequence[str] | None = None
depends_on: Sequence[str] | None = None


def upgrade() -> None:
    conn = op.get_bind()

    # -------------------------------------------------------------------------
    # a. Create attendee_categories table
    # -------------------------------------------------------------------------
    op.create_table(
        "attendee_categories",
        sa.Column("id", UUID(as_uuid=True), primary_key=True, nullable=False),
        sa.Column(
            "tenant_id", UUID(as_uuid=True), sa.ForeignKey("tenants.id"), nullable=False
        ),
        sa.Column(
            "popup_id",
            UUID(as_uuid=True),
            sa.ForeignKey("popups.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("key", sa.String(64), nullable=False),
        sa.Column("is_primary", sa.Boolean(), nullable=False, server_default="false"),
        sa.Column("sort_order", sa.Integer(), nullable=False, server_default="0"),
        sa.Column(
            "enabled_in_passes_flow",
            sa.Boolean(),
            nullable=False,
            server_default="true",
        ),
        sa.Column("max_per_application", sa.Integer(), nullable=True),
        sa.Column("required_fields", JSONB(), nullable=False, server_default="[]"),
        sa.Column("display_meta", JSONB(), nullable=False, server_default="{}"),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.func.now(),
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.func.now(),
        ),
        sa.UniqueConstraint("popup_id", "key", name="uq_attendee_categories_popup_key"),
    )

    # Partial unique index: at most one primary per popup
    op.execute(
        "CREATE UNIQUE INDEX uq_attendee_categories_popup_primary "
        "ON attendee_categories (popup_id) WHERE is_primary = true"
    )
    op.create_index(
        "ix_attendee_categories_tenant_id", "attendee_categories", ["tenant_id"]
    )
    op.create_index(
        "ix_attendee_categories_popup_id", "attendee_categories", ["popup_id"]
    )

    # RLS + grants
    add_tenant_table_permissions("attendee_categories")

    # -------------------------------------------------------------------------
    # b. Pre-check: abort if any attendees have NULL category
    # -------------------------------------------------------------------------
    null_count_row = conn.execute(
        sa.text("SELECT COUNT(*) FROM attendees WHERE category IS NULL")
    ).fetchone()
    null_count = null_count_row[0] if null_count_row else 0
    if null_count > 0:
        raise Exception(
            f"Migration aborted: {null_count} attendee(s) have NULL category. "
            "Run the pre-flight query to identify and fix them before migrating."
        )

    # -------------------------------------------------------------------------
    # c. Populate categories per popup from distinct attendees.category values
    #    The INSERT uses ON CONFLICT DO NOTHING for idempotency.
    #    We use conn.exec_driver_sql() to bypass SQLAlchemy text parameter parsing
    #    because the JSONB literals contain colons (e.g. "required":true) which
    #    SQLAlchemy misinterprets as named bind params in sa.text().
    # -------------------------------------------------------------------------
    conn.exec_driver_sql(
        "INSERT INTO attendee_categories "
        "    (id, tenant_id, popup_id, key, is_primary, sort_order, "
        "     enabled_in_passes_flow, max_per_application, required_fields, display_meta) "
        "SELECT "
        "    gen_random_uuid(), "
        "    a.tenant_id, "
        "    a.popup_id, "
        "    a.category, "
        "    (a.category = 'main'), "
        "    CASE a.category "
        "        WHEN 'main'   THEN 0 "
        "        WHEN 'spouse' THEN 1 "
        "        WHEN 'kid'    THEN 2 "
        "        ELSE 99 "
        "    END, "
        "    TRUE, "
        "    CASE a.category WHEN 'spouse' THEN 1 ELSE NULL END, "
        "    CASE a.category "
        "        WHEN 'spouse' THEN "
        """            '[{"name":"email","type":"email","required":true}]'::jsonb """
        "        WHEN 'kid' THEN "
        """            '[{"name":"age_group","type":"select","required":true,"""
        """"options":["baby","kid","teen"],"display_as_subtitle":true}]'::jsonb """
        "        ELSE '[]'::jsonb "
        "    END, "
        "    '{}'::jsonb "
        "FROM (SELECT DISTINCT tenant_id, popup_id, category FROM attendees "
        "      WHERE category IS NOT NULL) a "
        "ON CONFLICT (popup_id, key) DO NOTHING"
    )

    # -------------------------------------------------------------------------
    # d. Ensure main exists for every popup (popups with zero attendees)
    # -------------------------------------------------------------------------
    conn.exec_driver_sql(
        "INSERT INTO attendee_categories "
        "    (id, tenant_id, popup_id, key, is_primary, sort_order, "
        "     enabled_in_passes_flow, required_fields, display_meta) "
        "SELECT "
        "    gen_random_uuid(), p.tenant_id, p.id, 'main', TRUE, 0, TRUE, "
        "    '[]'::jsonb, '{}'::jsonb "
        "FROM popups p "
        "WHERE NOT EXISTS ( "
        "    SELECT 1 FROM attendee_categories ac "
        "    WHERE ac.popup_id = p.id AND ac.is_primary = TRUE "
        ") "
        "ON CONFLICT (popup_id, key) DO NOTHING"
    )

    # -------------------------------------------------------------------------
    # e. Add nullable FK columns to attendees and products
    # -------------------------------------------------------------------------
    op.add_column(
        "attendees",
        sa.Column(
            "category_id",
            UUID(as_uuid=True),
            sa.ForeignKey("attendee_categories.id"),
            nullable=True,
        ),
    )
    op.create_index("ix_attendees_category_id", "attendees", ["category_id"])

    op.add_column(
        "products",
        sa.Column(
            "attendee_category_id",
            UUID(as_uuid=True),
            sa.ForeignKey("attendee_categories.id"),
            nullable=True,
        ),
    )
    op.create_index(
        "ix_products_attendee_category_id", "products", ["attendee_category_id"]
    )

    # -------------------------------------------------------------------------
    # f. Backfill FK ids on attendees and products
    # -------------------------------------------------------------------------
    conn.execute(
        sa.text("""
        UPDATE attendees a
        SET category_id = ac.id
        FROM attendee_categories ac
        WHERE ac.popup_id = a.popup_id
          AND ac.key = a.category
    """)
    )

    conn.execute(
        sa.text("""
        UPDATE products p
        SET attendee_category_id = ac.id
        FROM attendee_categories ac
        WHERE ac.popup_id = p.popup_id
          AND ac.key = p.attendee_category::text
          AND p.attendee_category IS NOT NULL
    """)
    )

    # Audit guard: log any attendees that could not be backfilled (informational only).
    # category_id remains nullable in PR 1 — NOT NULL enforcement is PR 2's job
    # when the legacy category string column is dropped.
    audit_row = conn.execute(
        sa.text(
            "SELECT COUNT(*) FROM attendees WHERE category_id IS NULL AND category IS NOT NULL"
        )
    ).fetchone()
    audit_count = audit_row[0] if audit_row else 0
    if audit_count > 0:
        import warnings

        warnings.warn(
            f"Migration warning: {audit_count} attendee(s) could not be backfilled to category_id. "
            "They retain a legacy category string value. This will be an error in PR 2.",
            stacklevel=2,
        )

    # g. category_id stays nullable in PR 1 — NOT NULL constraint is added in PR 2
    #    when the legacy `attendees.category` string column is dropped.

    # -------------------------------------------------------------------------
    # h. Rewrite ticketingsteps.template_config JSONB sections
    #    attendee_categories string arrays → UUID arrays
    # -------------------------------------------------------------------------
    steps = conn.execute(
        sa.text(
            "SELECT id, popup_id, template_config FROM ticketingsteps "
            "WHERE template = 'ticket_select' AND template_config IS NOT NULL"
        )
    ).fetchall()

    for step_id, popup_id, template_config in steps:
        if not template_config or not template_config.get("sections"):
            continue

        # Build key→uuid lookup for this popup
        cat_rows = conn.execute(
            sa.text(
                "SELECT key, id::text FROM attendee_categories WHERE popup_id = :popup_id"
            ),
            {"popup_id": popup_id},
        ).fetchall()
        key_to_uuid = {row[0]: row[1] for row in cat_rows}

        changed = False
        new_sections = []
        for section in template_config.get("sections", []):
            raw_cats = section.get("attendee_categories")
            if raw_cats is None:
                new_sections.append(section)
                continue

            new_cats = []
            for cat in raw_cats:
                if isinstance(cat, str) and cat in key_to_uuid:
                    new_cats.append(key_to_uuid[cat])
                    changed = True
                else:
                    # Already a UUID string or unknown value — keep as-is
                    new_cats.append(cat)

            section = {**section, "attendee_categories": new_cats}
            new_sections.append(section)

        if changed:
            new_config = {**template_config, "sections": new_sections}
            conn.execute(
                sa.text(
                    "UPDATE ticketingsteps SET template_config = :config WHERE id = :id"
                ),
                {"config": json.dumps(new_config), "id": step_id},
            )

    # -------------------------------------------------------------------------
    # i. Legacy columns are intentionally kept for PR 2 to drop.
    #    (attendees.category, products.attendee_category, popups.allows_*,
    #     applications.brings_*)
    # -------------------------------------------------------------------------


def downgrade() -> None:
    # Best-effort reverse (documented as lossy if categories were added post-upgrade).
    # attendees.category was NOT dropped in this migration, so no restore is needed —
    # the original string column is still in place.

    # Drop FK columns
    op.drop_index("ix_attendees_category_id", table_name="attendees")
    op.drop_column("attendees", "category_id")

    op.drop_index("ix_products_attendee_category_id", table_name="products")
    op.drop_column("products", "attendee_category_id")

    # Drop attendee_categories table (RLS first)
    op.drop_index("ix_attendee_categories_popup_id", table_name="attendee_categories")
    op.drop_index("ix_attendee_categories_tenant_id", table_name="attendee_categories")
    op.drop_index(
        "uq_attendee_categories_popup_primary", table_name="attendee_categories"
    )
    remove_tenant_table_permissions("attendee_categories")
    op.drop_table("attendee_categories")

    # NOTE: ticketingsteps.template_config JSONB rewrite is NOT reversed on downgrade.
    # UUID arrays remain in place. This is documented as one-way.
    # NOTE: popups/applications legacy columns were NOT dropped in this migration,
    # so no restore needed here.
