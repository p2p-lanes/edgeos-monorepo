"""Create default event settings for gatherings that have never configured them."""

import sqlalchemy as sa
from alembic import op

revision = "a9d3e7f2b6c4"
down_revision = "f8a2c6d9e1b4"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Freeze defaults here rather than importing models that may change later.
    # SQLAlchemy stores PublishPermission's member name (EVERYONE), not its value.
    # The unique popup key also preserves settings created during a rolling deploy.
    op.execute(
        sa.text(
            """
            INSERT INTO event_settings (
                id, tenant_id, popup_id, can_publish_event, event_enabled,
                humans_can_create_venues, venues_require_approval,
                events_require_approval, timezone, allowed_tags, allowed_kinds,
                approval_notification_emails
            )
            SELECT
                gen_random_uuid(), tenant_id, id, 'EVERYONE', true,
                false, true, true, 'UTC', '[]'::jsonb, '[]'::jsonb, '[]'::jsonb
            FROM popups
            ON CONFLICT (popup_id) DO NOTHING
            """
        )
    )


def downgrade() -> None:
    # Keep the rows: there is no safe way to distinguish backfilled settings
    # from settings an administrator has subsequently edited.
    pass
