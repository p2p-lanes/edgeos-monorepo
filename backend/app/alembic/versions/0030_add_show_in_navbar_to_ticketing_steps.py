"""Add show_in_navbar to ticketing_steps.

Revision ID: 0030_show_in_navbar
Revises: e2c8b146a7d3

⚠️  MERGE NOTE — re-chain before merging to dev.
This migration was authored against the head `e2c8b146a7d3` at the time
the worktree was forked. While we worked, `dev` accepted another `0030_*`
revision (`0030_events_module`, Revises: 0029_show_title_watermark).
When you merge dev into this branch, Alembic will see two heads. To
resolve:

  1. After `git merge origin/dev`, locate the new head with
     `docker compose exec backend alembic heads`.
  2. Rename this file to e.g. `0031_add_show_in_navbar.py`.
  3. Update `revision = "0031_show_in_navbar"` and
     `down_revision = "<new-head-revision-id>"` (likely
     `"0030_events_module"`).
  4. `docker compose exec backend alembic upgrade head` to verify.

The migration body itself is order-independent — it adds a single
boolean column with a server-default, so re-chaining is purely about
the revision graph.
"""

import sqlalchemy as sa
from alembic import op

revision = "0030_show_in_navbar"
down_revision = "e2c8b146a7d3"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "ticketingsteps",
        sa.Column(
            "show_in_navbar",
            sa.Boolean(),
            nullable=False,
            server_default=sa.text("true"),
        ),
    )


def downgrade() -> None:
    op.drop_column("ticketingsteps", "show_in_navbar")
