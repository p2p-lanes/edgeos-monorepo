"""Add tenant scope support to email templates

Revision ID: 4f2b3c1d9e8a
Revises: 499dd4b24f32
Create Date: 2026-04-23

"""

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = "4f2b3c1d9e8a"
down_revision = "499dd4b24f32"
branch_labels = None
depends_on = None


TENANT_SCOPED_TEMPLATE_TYPES = ("login_code_human",)


def upgrade():
    op.drop_constraint(
        "uq_email_template_popup_type", "email_templates", type_="unique"
    )
    op.alter_column("email_templates", "popup_id", existing_type=sa.UUID(), nullable=True)
    op.create_check_constraint(
        "ck_email_templates_scope",
        "email_templates",
        "(template_type IN ('login_code_human') AND popup_id IS NULL) "
        "OR (template_type NOT IN ('login_code_human') AND popup_id IS NOT NULL)",
    )
    op.create_index(
        "uq_email_template_popup_scope_type",
        "email_templates",
        ["popup_id", "template_type"],
        unique=True,
        postgresql_where=sa.text("popup_id IS NOT NULL"),
    )
    op.create_index(
        "uq_email_template_tenant_scope_type",
        "email_templates",
        ["tenant_id", "template_type"],
        unique=True,
        postgresql_where=sa.text("popup_id IS NULL"),
    )


def downgrade():
    op.execute(
        "DELETE FROM email_templates WHERE popup_id IS NULL AND template_type IN ('login_code_human')"
    )
    op.drop_index("uq_email_template_tenant_scope_type", table_name="email_templates")
    op.drop_index("uq_email_template_popup_scope_type", table_name="email_templates")
    op.drop_constraint("ck_email_templates_scope", "email_templates", type_="check")
    op.alter_column(
        "email_templates", "popup_id", existing_type=sa.UUID(), nullable=False
    )
    op.create_unique_constraint(
        "uq_email_template_popup_type",
        "email_templates",
        ["popup_id", "template_type"],
    )
