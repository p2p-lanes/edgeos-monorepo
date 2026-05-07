"""Enable Row Level Security on ticket_events table.

Revision ID: a3f9e1b2c4d7
Revises: 8bab37683539
Create Date: 2026-05-06

The ticket_events table was created without RLS in 8bab37683539. This
migration adds the same tenant_isolation_policy pattern used by all other
tenant-scoped tables so that tenant-specific DB users cannot read rows
belonging to other tenants.

Forward-only migration (no downgrade).
"""

import sqlalchemy as sa
from alembic import op


# revision identifiers, used by Alembic
revision = "a3f9e1b2c4d7"
down_revision = "8bab37683539"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Enable RLS — mirrors the pattern in 0001_initial_schema.py
    op.execute("ALTER TABLE ticket_events ENABLE ROW LEVEL SECURITY")

    # Superadmin / migration user bypasses RLS
    op.execute("ALTER TABLE ticket_events FORCE ROW LEVEL SECURITY")

    policy_name = "tenant_isolation_policy_ticket_events"
    op.execute(
        f"""
        CREATE POLICY {policy_name} ON ticket_events
        USING (tenant_id = (SELECT current_setting('app.tenant_id', true)::uuid))
        WITH CHECK (tenant_id = (SELECT current_setting('app.tenant_id', true)::uuid));
        """
    )


def downgrade() -> None:
    raise RuntimeError(
        "a3f9e1b2c4d7 (ticket_events RLS) is a forward-only migration. "
        "Downgrade is not implemented — disabling RLS on ticket_events would "
        "expose tenant data across tenants."
    )
