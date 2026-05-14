"""Companion types cleanup — drop legacy columns and companion form rows.

PR 2 migration. Drops columns that are superseded by the declarative
attendee_categories table introduced in PR 1 (96426891f501).

This migration is intentionally LOSSY on downgrade:
- Deleted FormSections / BaseFieldConfigs rows are NOT restored.
- Column data added after upgrade is NOT restored on downgrade.
Downgrade is provided for emergency rollback only; treat as best-effort.

Revision ID: b03773f94f26
Revises: 96426891f501
Create Date: 2026-05-13
"""

from alembic import op
import sqlalchemy as sa

# revision identifiers
revision = "b03773f94f26"
down_revision = "96426891f501"
branch_labels = None
depends_on = None


def upgrade() -> None:
    conn = op.get_bind()

    # -----------------------------------------------------------------
    # 1. Drop companion form sections and base field configs data first
    # -----------------------------------------------------------------
    conn.execute(
        sa.text("DELETE FROM formsections WHERE kind = 'companions'")
    )
    conn.execute(
        sa.text(
            "DELETE FROM basefieldconfigs"
            " WHERE field_name IN ('partner', 'partner_email', 'kids')"
        )
    )

    # -----------------------------------------------------------------
    # 2. Drop legacy string column on attendees (category_id is NOT NULL
    #    since PR 1 migration enforced it for all existing rows).
    # -----------------------------------------------------------------
    op.drop_column("attendees", "category")

    # -----------------------------------------------------------------
    # 3. Drop legacy enum column on products.
    #    Cast to text first to avoid enum-type removal issues.
    # -----------------------------------------------------------------
    op.drop_column("products", "attendee_category")

    # -----------------------------------------------------------------
    # 4. Drop popup companion flags (IF EXISTS — column was in 0001
    #    initial_schema; some databases may have already removed it).
    # -----------------------------------------------------------------
    conn.execute(
        sa.text("ALTER TABLE popups DROP COLUMN IF EXISTS allows_spouse")
    )
    conn.execute(
        sa.text("ALTER TABLE popups DROP COLUMN IF EXISTS allows_children")
    )

    # -----------------------------------------------------------------
    # 5. Drop application companion fields (IF EXISTS — these columns
    #    were added outside the tracked migration chain in some envs).
    # -----------------------------------------------------------------
    conn.execute(
        sa.text("ALTER TABLE applications DROP COLUMN IF EXISTS brings_spouse")
    )
    conn.execute(
        sa.text("ALTER TABLE applications DROP COLUMN IF EXISTS brings_kids")
    )
    conn.execute(
        sa.text("ALTER TABLE applications DROP COLUMN IF EXISTS kid_count")
    )


def downgrade() -> None:
    """Best-effort restore of dropped columns. Data is NOT restored.

    FormSections/BaseFieldConfigs rows deleted during upgrade are NOT
    restored — downgrade is for emergency schema rollback only.
    """
    # Restore applications companion fields (nullable, no data)
    op.add_column(
        "applications",
        sa.Column("kid_count", sa.Integer(), nullable=True, server_default="0"),
    )
    op.add_column(
        "applications",
        sa.Column(
            "brings_kids",
            sa.Boolean(),
            nullable=True,
            server_default="false",
        ),
    )
    op.add_column(
        "applications",
        sa.Column(
            "brings_spouse",
            sa.Boolean(),
            nullable=True,
            server_default="false",
        ),
    )

    # Restore popup companion flags
    op.add_column(
        "popups",
        sa.Column(
            "allows_children",
            sa.Boolean(),
            nullable=True,
            server_default="false",
        ),
    )
    op.add_column(
        "popups",
        sa.Column(
            "allows_spouse",
            sa.Boolean(),
            nullable=True,
            server_default="false",
        ),
    )

    # Restore products.attendee_category as text (original was an enum,
    # restoring as text to avoid recreating the PG enum type)
    op.add_column(
        "products",
        sa.Column("attendee_category", sa.Text(), nullable=True),
    )

    # Restore attendees.category as text (nullable on downgrade)
    op.add_column(
        "attendees",
        sa.Column("category", sa.Text(), nullable=True),
    )

    # Best-effort backfill attendees.category from FK
    conn = op.get_bind()
    conn.execute(
        sa.text(
            "UPDATE attendees a SET category = ac.key"
            " FROM attendee_categories ac"
            " WHERE ac.id = a.category_id"
        )
    )
