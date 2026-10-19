"""Optional post-purchase form editing and append-only answer history."""

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

from app.alembic.utils import (
    add_tenant_table_permissions,
    remove_tenant_table_permissions,
)

revision = "f6b2a9d1c804"
down_revision = "e8a4f1c7d2b6"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "ticketingsteps",
        sa.Column(
            "allow_response_editing",
            sa.Boolean(),
            nullable=False,
            server_default=sa.false(),
        ),
    )
    op.add_column(
        "ticketingsteps",
        sa.Column("response_edit_deadline", sa.DateTime(timezone=True), nullable=True),
    )
    op.create_check_constraint(
        "ck_step_editing_deadline",
        "ticketingsteps",
        "NOT allow_response_editing OR (step_type = 'buyer' AND response_edit_deadline IS NOT NULL)",
    )
    op.add_column(
        "payments",
        sa.Column(
            "form_response_version", sa.Integer(), nullable=False, server_default="0"
        ),
    )
    op.create_table(
        "payment_form_response_changes",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column(
            "tenant_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("tenants.id"),
            nullable=False,
        ),
        sa.Column(
            "payment_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("payments.id"),
            nullable=False,
        ),
        sa.Column("field_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("field_label", sa.String(), nullable=False),
        sa.Column("old_value", postgresql.JSONB(), nullable=True),
        sa.Column("new_value", postgresql.JSONB(), nullable=True),
        sa.Column(
            "changed_by_human_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("humans.id"),
            nullable=False,
        ),
        sa.Column("changed_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("version", sa.Integer(), nullable=False),
    )
    op.create_index(
        "ix_payment_form_response_changes_tenant_id",
        "payment_form_response_changes",
        ["tenant_id"],
    )
    op.create_index(
        "ix_payment_form_response_changes_payment_id",
        "payment_form_response_changes",
        ["payment_id"],
    )
    add_tenant_table_permissions("payment_form_response_changes")
    op.execute(
        "REVOKE UPDATE, DELETE ON payment_form_response_changes FROM tenant_role"
    )


def downgrade() -> None:
    remove_tenant_table_permissions("payment_form_response_changes")
    op.drop_table("payment_form_response_changes")
    op.drop_column("payments", "form_response_version")
    op.drop_constraint("ck_step_editing_deadline", "ticketingsteps")
    for column in (
        "allow_response_editing",
        "response_edit_deadline",
    ):
        op.drop_column("ticketingsteps", column)
