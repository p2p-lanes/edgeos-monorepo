"""Add ticket_events event log table.

Revision ID: 8bab37683539
Revises: a51d7b0ab836
Create Date: 2026-05-06

Addendum #12 — event log table for check-in and future transfer/refund events.
New revision (not appended to 0044) for idempotent, independent deployability.

Forward-only migration (no downgrade). Raises RuntimeError if downgrade attempted.

Schema:
  ticket_events (
    id uuid PRIMARY KEY,
    tenant_id uuid NOT NULL FK → tenants(id),
    attendee_product_id uuid NOT NULL FK → attendee_products(id) ON DELETE CASCADE,
    event_type varchar(32) NOT NULL,
    occurred_at timestamptz NOT NULL DEFAULT now(),
    actor_user_id uuid NULL FK → users(id),
    payload jsonb NULL,
    created_at timestamptz NOT NULL DEFAULT now()
  )

Indexes:
  ix_ticket_events_attendee_product ON ticket_events(attendee_product_id)
  ix_ticket_events_type_occurred ON ticket_events(event_type, occurred_at)
"""

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic
revision = "8bab37683539"
down_revision = "a51d7b0ab836"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "ticket_events",
        sa.Column(
            "id",
            postgresql.UUID(as_uuid=True),
            nullable=False,
            primary_key=True,
        ),
        sa.Column(
            "tenant_id",
            postgresql.UUID(as_uuid=True),
            nullable=False,
        ),
        sa.Column(
            "attendee_product_id",
            postgresql.UUID(as_uuid=True),
            nullable=False,
        ),
        sa.Column(
            "event_type",
            sa.String(32),
            nullable=False,
        ),
        sa.Column(
            "occurred_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        sa.Column(
            "actor_user_id",
            postgresql.UUID(as_uuid=True),
            nullable=True,
        ),
        sa.Column(
            "payload",
            postgresql.JSONB(astext_type=sa.Text()),
            nullable=True,
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
            name="fk_ticket_events_tenant_id",
        ),
        sa.ForeignKeyConstraint(
            ["attendee_product_id"],
            ["attendee_products.id"],
            name="fk_ticket_events_attendee_product_id",
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["actor_user_id"],
            ["users.id"],
            name="fk_ticket_events_actor_user_id",
            ondelete="SET NULL",
        ),
        sa.PrimaryKeyConstraint("id", name="pk_ticket_events"),
    )

    op.create_index(
        "ix_ticket_events_attendee_product",
        "ticket_events",
        ["attendee_product_id"],
    )

    op.create_index(
        "ix_ticket_events_type_occurred",
        "ticket_events",
        ["event_type", "occurred_at"],
    )

    # Grant permissions to tenant roles (mirrors pattern from all other tables)
    op.execute(
        "GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE ticket_events TO tenant_role"
    )
    op.execute("GRANT SELECT ON TABLE ticket_events TO tenant_viewer_role")


def downgrade() -> None:
    raise RuntimeError(
        "0045_ticket_events_log is a forward-only migration. "
        "Downgrade is not implemented — dropping ticket_events would destroy "
        "the audit trail for check-in and future transfer/refund events."
    )
