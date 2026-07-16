"""Rich Profiles — curated enriched profile + provenance facts log.

Product change (task "Rich Profiles"): an automated agent enriches each human's
profile from several sources (the social Telegram group, applications custom
fields, event/speaker signals, a web deep-dive of their organization). The agent
keeps TWO things in sync:

1. ``humans.enriched_profile`` (JSONB, nullable) — the *curated* profile: a
   single, human-readable summary the backoffice renders as rich HTML and can
   filter on (headline, bio, tags, interests, topics, organization, links…).
   It is NOT the raw dump of chat lines — the agent processes new evidence
   against the current curated profile and decides how to update it. NULL means
   "never enriched", which is meaningful for filtering. Humans may also edit it
   by hand from the backoffice (no review queue; the agent auto-applies).

2. ``human_enrichment_facts`` (append-only) — the provenance bitácora: one row
   per atomic fact the agent extracted, with its source and evidence link, so
   any value in the curated profile can be traced back (and re-derived if a
   source is corrected). This is independent of comments/rating.

Like ``human_comments`` / the task tables, ``human_enrichment_facts`` is reached
only through the privileged main engine (authorization at the API layer), so it
carries NO tenant RLS policy and NO grants to the tenant DB roles. The
``enriched_profile`` column lives on the already tenant-scoped ``humans`` table,
so it inherits that table's RLS automatically.

Schema:
  humans.enriched_profile jsonb NULL
  human_enrichment_facts (
    id uuid PK,
    human_id uuid NOT NULL FK -> humans(id) ON DELETE CASCADE,
    field varchar(100) NOT NULL,        -- profile attribute the fact informs
    value text NOT NULL,                -- extracted value / statement
    source varchar(20) NOT NULL,        -- telegram|event|custom_fields|org|manual
    evidence text NULL,                 -- permalink / event id / org URL
    confidence numeric NULL,            -- agent's 0..1 score, optional
    raw jsonb NULL,                     -- structured payload (msg/chat/event ids)
    created_at timestamptz NOT NULL DEFAULT now()
  )
"""

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic
revision = "b8d2f3a47c19"
# Rechained onto the current dev alembic head (open-checkout signing secret) so
# Rich Profiles stays on a single linear head. The human-rating migration
# (3c5f1a8e7d24) already has a child on dev (b3f7c1a9e2d4 → c8d2a6f4e1b9); chaining
# off it again would fork into two heads.
down_revision = "c8d2a6f4e1b9"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # 1) curated enriched profile on humans (inherits humans' tenant RLS)
    op.add_column(
        "humans",
        sa.Column("enriched_profile", postgresql.JSONB(), nullable=True),
    )

    # 2) human_enrichment_facts (global table, privileged engine only —
    #    no RLS, no grants, mirroring human_comments)
    op.create_table(
        "human_enrichment_facts",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("human_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("field", sa.String(100), nullable=False),
        sa.Column("value", sa.Text(), nullable=False),
        sa.Column("source", sa.String(20), nullable=False),
        sa.Column("evidence", sa.Text(), nullable=True),
        sa.Column("confidence", sa.Numeric(), nullable=True),
        sa.Column("raw", postgresql.JSONB(), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        sa.ForeignKeyConstraint(
            ["human_id"],
            ["humans.id"],
            name="fk_human_enrichment_facts_human_id",
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("id", name="pk_human_enrichment_facts"),
    )
    op.create_index(
        "ix_human_enrichment_facts_human_created",
        "human_enrichment_facts",
        ["human_id", "created_at"],
    )
    op.create_index(
        "ix_human_enrichment_facts_source",
        "human_enrichment_facts",
        ["source"],
    )


def downgrade() -> None:
    op.drop_index(
        "ix_human_enrichment_facts_source", table_name="human_enrichment_facts"
    )
    op.drop_index(
        "ix_human_enrichment_facts_human_created",
        table_name="human_enrichment_facts",
    )
    op.drop_table("human_enrichment_facts")
    op.drop_column("humans", "enriched_profile")
