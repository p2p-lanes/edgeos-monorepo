"""Delete a gathering's event settings together with the gathering."""

from alembic import op

revision = "c6f1a8e4d2b7"
down_revision = "a9d3e7f2b6c4"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.drop_constraint(
        "event_settings_popup_id_fkey", "event_settings", type_="foreignkey"
    )
    op.create_foreign_key(
        "event_settings_popup_id_fkey",
        "event_settings",
        "popups",
        ["popup_id"],
        ["id"],
        ondelete="CASCADE",
    )


def downgrade() -> None:
    op.drop_constraint(
        "event_settings_popup_id_fkey", "event_settings", type_="foreignkey"
    )
    op.create_foreign_key(
        "event_settings_popup_id_fkey", "event_settings", "popups", ["popup_id"], ["id"]
    )
