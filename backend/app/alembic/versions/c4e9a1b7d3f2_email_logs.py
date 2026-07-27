"""Append-only email dispatch log (email_logs).

Creates ``email_logs`` — one row per dispatched email (template, recipient,
popup/entity scope, delivery status). Tenant-scoped with RLS: ``tenant_id``
keeps its FK and drives the isolation policy; all other entity references are
denormalized UUIDs (no FK) so the log outlives the rows it points at. This
table is also the source of truth for the reminder dispatcher's cadence/cap.

Revision ID: c4e9a1b7d3f2
Revises: 3d1b2dce2b7b
Create Date: 2026-07-23
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

from app.alembic.utils import (
    add_tenant_table_permissions,
    remove_tenant_table_permissions,
)

revision: str = "c4e9a1b7d3f2"
down_revision: str | Sequence[str] | None = "3d1b2dce2b7b"
branch_labels: Sequence[str] | None = None
depends_on: Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "email_logs",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("tenant_id", sa.Uuid(), nullable=False),
        sa.Column("popup_id", sa.Uuid(), nullable=True),
        sa.Column("template_type", sa.String(), nullable=False),
        sa.Column("to_email", sa.String(), nullable=False),
        sa.Column("application_id", sa.Uuid(), nullable=True),
        sa.Column("payment_id", sa.Uuid(), nullable=True),
        sa.Column("human_id", sa.Uuid(), nullable=True),
        sa.Column("subject", sa.String(), nullable=True),
        sa.Column("status", sa.String(), nullable=False),
        sa.Column("error", sa.Text(), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.ForeignKeyConstraint(["tenant_id"], ["tenants.id"]),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_email_logs_tenant_id", "email_logs", ["tenant_id"])
    op.create_index("ix_email_logs_popup_id", "email_logs", ["popup_id"])
    op.create_index("ix_email_logs_template_type", "email_logs", ["template_type"])
    op.create_index("ix_email_logs_to_email", "email_logs", ["to_email"])
    op.create_index("ix_email_logs_application_id", "email_logs", ["application_id"])
    op.create_index("ix_email_logs_payment_id", "email_logs", ["payment_id"])
    op.create_index("ix_email_logs_human_id", "email_logs", ["human_id"])
    op.create_index("ix_email_logs_status", "email_logs", ["status"])
    op.create_index("ix_email_logs_created_at", "email_logs", ["created_at"])

    add_tenant_table_permissions("email_logs")


def downgrade() -> None:
    remove_tenant_table_permissions("email_logs")

    op.drop_index("ix_email_logs_created_at", table_name="email_logs")
    op.drop_index("ix_email_logs_status", table_name="email_logs")
    op.drop_index("ix_email_logs_human_id", table_name="email_logs")
    op.drop_index("ix_email_logs_payment_id", table_name="email_logs")
    op.drop_index("ix_email_logs_application_id", table_name="email_logs")
    op.drop_index("ix_email_logs_to_email", table_name="email_logs")
    op.drop_index("ix_email_logs_template_type", table_name="email_logs")
    op.drop_index("ix_email_logs_popup_id", table_name="email_logs")
    op.drop_index("ix_email_logs_tenant_id", table_name="email_logs")

    op.drop_table("email_logs")
