"""Add ticketing_steps table and seed default steps for existing popups.

Revision ID: 0021_add_ticketing_steps
Revises: 0020_scholarship_section
Create Date: 2026-03-19

"""

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import UUID

revision = "0021_add_ticketing_steps"
down_revision = "0020_scholarship_section"
branch_labels = None
depends_on = None

DEFAULT_TICKETING_STEPS = [
    {"step_type": "tickets",            "title": "Tickets",          "order": 0, "is_enabled": True,  "protected": False},
    {"step_type": "housing",            "title": "Housing",          "order": 1, "is_enabled": True,  "protected": False},
    {"step_type": "merch",              "title": "Merchandise",      "order": 2, "is_enabled": True,  "protected": False},
    {"step_type": "patron",             "title": "Patron",           "order": 3, "is_enabled": True,  "protected": False},
    {"step_type": "insurance_checkout", "title": "Insurance",        "order": 4, "is_enabled": False, "protected": False},
    {"step_type": "confirm",            "title": "Review & Confirm", "order": 5, "is_enabled": True,  "protected": True},
]


def upgrade() -> None:
    op.create_table(
        "ticketingsteps",
        sa.Column("id", UUID(as_uuid=True), primary_key=True, server_default=sa.text("gen_random_uuid()")),
        sa.Column("tenant_id", UUID(as_uuid=True), sa.ForeignKey("tenants.id"), nullable=False, index=True),
        sa.Column("popup_id", UUID(as_uuid=True), sa.ForeignKey("popups.id"), nullable=False, index=True),
        sa.Column("step_type", sa.String(), nullable=False),
        sa.Column("title", sa.String(), nullable=False),
        sa.Column("description", sa.String(), nullable=True),
        sa.Column("order", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("is_enabled", sa.Boolean(), nullable=False, server_default="true"),
        sa.Column("protected", sa.Boolean(), nullable=False, server_default="false"),
    )

    # Grants
    op.execute(
        "GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE ticketingsteps TO tenant_role"
    )
    op.execute("GRANT SELECT ON TABLE ticketingsteps TO tenant_viewer_role")

    # RLS policy
    op.execute("ALTER TABLE ticketingsteps ENABLE ROW LEVEL SECURITY")
    op.execute(
        """
        CREATE POLICY tenant_isolation_policy_ticketingsteps ON ticketingsteps
        USING (tenant_id = (SELECT current_setting('app.tenant_id', true)::uuid))
        WITH CHECK (tenant_id = (SELECT current_setting('app.tenant_id', true)::uuid));
        """
    )

    conn = op.get_bind()

    # Seed default ticketing steps for all existing popups
    popups = conn.execute(
        sa.text("SELECT id, tenant_id FROM popups")
    ).fetchall()

    for popup_id, tenant_id in popups:
        for step_def in DEFAULT_TICKETING_STEPS:
            conn.execute(
                sa.text(
                    "INSERT INTO ticketingsteps "
                    "(id, tenant_id, popup_id, step_type, title, \"order\", is_enabled, protected) "
                    "VALUES (gen_random_uuid(), :tenant_id, :popup_id, :step_type, :title, :order, :is_enabled, :protected)"
                ),
                {
                    "tenant_id": tenant_id,
                    "popup_id": popup_id,
                    "step_type": step_def["step_type"],
                    "title": step_def["title"],
                    "order": step_def["order"],
                    "is_enabled": step_def["is_enabled"],
                    "protected": step_def["protected"],
                },
            )


def downgrade() -> None:
    op.drop_table("ticketingsteps")
