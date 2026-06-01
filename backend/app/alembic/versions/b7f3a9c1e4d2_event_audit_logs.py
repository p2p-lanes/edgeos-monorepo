"""Add event_audit_logs audit table.

Revision ID: b7f3a9c1e4d2
Revises: 7a3f9c1d8e2b
Create Date: 2026-06-01

Persistent, append-only history of every event mutation (create/update/delete/
cancel/approve/reject/recurrence/invitations/hide), recording who acted, from
which app (Portal vs Backoffice), when, on which event, a snapshot of the
relevant request data, and a field-level diff for updates.

Unlike check_ins, the actor may be a backoffice User or a portal Human, so the
actor is stored as flat columns rather than a single FK. ``event_id`` carries
NO foreign key so the audit row survives a hard delete of its event.

Forward-only migration (no downgrade). Raises RuntimeError if downgrade
attempted — dropping this table would destroy the audit trail.

Schema:
  event_audit_logs (
    id uuid PRIMARY KEY,
    tenant_id uuid NOT NULL FK → tenants(id),
    popup_id uuid NULL,
    event_id uuid NOT NULL,                -- no FK: survives event delete
    event_title text NULL,
    action varchar(24) NOT NULL,
    source varchar(16) NOT NULL,           -- portal | backoffice
    actor_type varchar(8) NOT NULL,        -- user | human | api_key | system
    actor_id uuid NULL,
    actor_email text NULL,
    actor_name text NULL,
    request_id varchar(64) NULL,
    snapshot jsonb NULL,
    changes jsonb NULL,
    occurred_at timestamptz NOT NULL DEFAULT now(),
    created_at timestamptz NOT NULL DEFAULT now()
  )

Indexes:
  ix_event_audit_logs_event_occurred ON (event_id, occurred_at DESC)
  ix_event_audit_logs_tenant_occurred ON (tenant_id, occurred_at DESC)
  ix_event_audit_logs_popup ON (popup_id)
  ix_event_audit_logs_action ON (action)
"""

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic
revision = "b7f3a9c1e4d2"
down_revision = "7a3f9c1d8e2b"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "event_audit_logs",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("tenant_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("popup_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("event_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("event_title", sa.Text(), nullable=True),
        sa.Column("action", sa.String(24), nullable=False),
        sa.Column("source", sa.String(16), nullable=False),
        sa.Column("actor_type", sa.String(8), nullable=False),
        sa.Column("actor_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("actor_email", sa.Text(), nullable=True),
        sa.Column("actor_name", sa.Text(), nullable=True),
        sa.Column("request_id", sa.String(64), nullable=True),
        sa.Column(
            "snapshot",
            postgresql.JSONB(astext_type=sa.Text()),
            nullable=True,
        ),
        sa.Column(
            "changes",
            postgresql.JSONB(astext_type=sa.Text()),
            nullable=True,
        ),
        sa.Column(
            "occurred_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        sa.ForeignKeyConstraint(
            ["tenant_id"],
            ["tenants.id"],
            name="fk_event_audit_logs_tenant_id",
        ),
        sa.PrimaryKeyConstraint("id", name="pk_event_audit_logs"),
    )

    op.create_index(
        "ix_event_audit_logs_event_occurred",
        "event_audit_logs",
        ["event_id", sa.text("occurred_at DESC")],
    )
    op.create_index(
        "ix_event_audit_logs_tenant_occurred",
        "event_audit_logs",
        ["tenant_id", sa.text("occurred_at DESC")],
    )
    op.create_index(
        "ix_event_audit_logs_popup",
        "event_audit_logs",
        ["popup_id"],
    )
    op.create_index(
        "ix_event_audit_logs_action",
        "event_audit_logs",
        ["action"],
    )

    # Grant permissions to tenant roles (mirrors every other tenant table).
    op.execute(
        "GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE event_audit_logs TO tenant_role"
    )
    op.execute("GRANT SELECT ON TABLE event_audit_logs TO tenant_viewer_role")

    # Row Level Security — same tenant_isolation pattern as all tenant tables.
    op.execute("ALTER TABLE event_audit_logs ENABLE ROW LEVEL SECURITY")
    op.execute("ALTER TABLE event_audit_logs FORCE ROW LEVEL SECURITY")
    op.execute(
        """
        CREATE POLICY tenant_isolation_policy_event_audit_logs ON event_audit_logs
        USING (tenant_id = (SELECT current_setting('app.tenant_id', true)::uuid))
        WITH CHECK (tenant_id = (SELECT current_setting('app.tenant_id', true)::uuid));
        """
    )


def downgrade() -> None:
    raise RuntimeError(
        "b7f3a9c1e4d2 (event_audit_logs) is a forward-only migration. "
        "Downgrade is not implemented — dropping event_audit_logs would destroy "
        "the audit trail for event CRUD operations."
    )
