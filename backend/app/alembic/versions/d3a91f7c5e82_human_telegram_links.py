"""human_telegram_links — derived Telegram-id ↔ human binding (separate from humans.telegram).

Rich Profiles follow-up. Telegram chat exports (and the live Bot API) identify a
message author only by a stable numeric id (the export's ``from_id`` minus the
"user" prefix; the Bot API's ``message.from.id``) — the *export never carries the
@handle*. To attribute a downloaded conversation (or a new bot message) to an
EdgeOS human deterministically by id instead of fuzzy-matching display names on
every re-run, we persist the id↔human binding once.

This is an INTERNAL identity index, deliberately NOT ``humans.telegram``: that
field is user-owned and user-visible, so a handle we *derived* (e.g. resolved via
a one-time Telethon participants dump) must never be written back into it. Weak
(display-name-only) links stay ``verified = false`` until confirmed by hand.

Like ``human_enrichment_facts`` / ``human_comments`` this is a global table reached
only through the privileged main engine (authorization at the API layer): NO
tenant RLS policy and NO grants to the tenant DB roles. A single ``tg_user_id`` may
bind to more than one human (same person, several tenants), so uniqueness is on
the (human_id, tg_user_id) pair — not on ``tg_user_id`` alone.

Schema:
  human_telegram_links (
    id uuid PK,
    human_id uuid NOT NULL FK -> humans(id) ON DELETE CASCADE,
    tg_user_id varchar(32) NOT NULL,     -- numeric Telegram id as text
    tg_username varchar(255) NULL,       -- observed @handle (evidence only)
    tg_display_name varchar(255) NULL,   -- observed display name (evidence only)
    match_method varchar(20) NOT NULL,   -- handle_resolved|handle_exact|name_fuzzy|manual
    confidence numeric NULL,             -- 0..1
    verified boolean NOT NULL DEFAULT false,
    source_groups jsonb NULL,            -- which export group(s) the evidence came from
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (human_id, tg_user_id)
  )
"""

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic
revision = "d3a91f7c5e82"
# Chained onto the Rich Profiles migration (same feature family) to keep this
# work on a single linear head.
down_revision = "b8d2f3a47c19"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Idempotent: the table is created out-of-band in prod ahead of the dev→prod
    # pipeline (the Rich Profiles mapping landed via direct SQL while prod's
    # alembic head was still the sibling SMTP migration). Skip if it already
    # exists so a later pipeline run no-ops and simply advances the version.
    bind = op.get_bind()
    if sa.inspect(bind).has_table("human_telegram_links"):
        return

    op.create_table(
        "human_telegram_links",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("human_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("tg_user_id", sa.String(32), nullable=False),
        sa.Column("tg_username", sa.String(255), nullable=True),
        sa.Column("tg_display_name", sa.String(255), nullable=True),
        sa.Column("match_method", sa.String(20), nullable=False),
        sa.Column("confidence", sa.Numeric(), nullable=True),
        sa.Column(
            "verified",
            sa.Boolean(),
            nullable=False,
            server_default=sa.text("false"),
        ),
        sa.Column("source_groups", postgresql.JSONB(), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        sa.ForeignKeyConstraint(
            ["human_id"],
            ["humans.id"],
            name="fk_human_telegram_links_human_id",
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("id", name="pk_human_telegram_links"),
        sa.UniqueConstraint(
            "human_id", "tg_user_id", name="uq_human_telegram_link_human_tg"
        ),
    )
    op.create_index(
        "ix_human_telegram_links_human_id",
        "human_telegram_links",
        ["human_id"],
    )
    # The bot's hot path: given a Telegram id from a new message, find the human.
    op.create_index(
        "ix_human_telegram_links_tg_user_id",
        "human_telegram_links",
        ["tg_user_id"],
    )


def downgrade() -> None:
    op.drop_index(
        "ix_human_telegram_links_tg_user_id", table_name="human_telegram_links"
    )
    op.drop_index(
        "ix_human_telegram_links_human_id", table_name="human_telegram_links"
    )
    op.drop_table("human_telegram_links")
