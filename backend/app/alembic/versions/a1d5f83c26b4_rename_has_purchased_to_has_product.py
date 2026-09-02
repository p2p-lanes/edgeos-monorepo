"""rename the has_purchased restriction predicate to has_product

Design: sdd/sales-flows-rediseno slice 5. The predicate stopped meaning
"purchased" the moment an admin-granted product started counting as holding
one, so it is named for what it answers. An organizer reading a rule called
`has_purchased` would reasonably assume money changed hands.

`restriction_rule` is JSONB, and a stored rule carries the predicate name in
its `kind` field. Renaming the enum without rewriting stored rules would
leave every existing rule unparseable, and an unparseable rule fails closed
— it would silently shut its flow to every buyer. So the data moves with
the code.

The rewrite walks the whole tree: predicates can sit at the root or nested
under any depth of `all_of` / `any_of`, so a flat `jsonb_set` would miss
them. Idempotent — a rule with no `has_purchased` anywhere is left byte for
byte alone.

Downgrade reverses the rename, which restores rules the pre-slice code can
parse. It does not restore the old SEMANTICS: rows written while
`has_product` counted admin grants stay as they are, because a migration
cannot know which of them an operator meant as "paid for".

Revision ID: a1d5f83c26b4
Revises: d3f6b2a81c95
Create Date: 2026-08-06 00:00:00.000000

"""

import json

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision = "a1d5f83c26b4"
down_revision = "d3f6b2a81c95"
branch_labels = None
depends_on = None

OLD_KIND = "has_purchased"
NEW_KIND = "has_product"


def _rewrite(node, old: str, new: str) -> bool:
    """Rename `kind` in place throughout the tree. Returns True if anything
    changed, so untouched rules are not rewritten for nothing."""
    changed = False
    if isinstance(node, dict):
        if node.get("kind") == old:
            node["kind"] = new
            changed = True
        for key in ("all_of", "any_of"):
            children = node.get(key)
            if isinstance(children, list):
                for child in children:
                    changed = _rewrite(child, old, new) or changed
    elif isinstance(node, list):
        for child in node:
            changed = _rewrite(child, old, new) or changed
    return changed


def _migrate_kind(old: str, new: str) -> None:
    conn = op.get_bind()
    rows = conn.execute(
        sa.text(
            "SELECT id, restriction_rule FROM sales_flows "
            "WHERE restriction_rule IS NOT NULL"
        )
    ).all()

    for flow_id, rule in rows:
        parsed = json.loads(rule) if isinstance(rule, str) else rule
        if not isinstance(parsed, dict):
            continue
        if not _rewrite(parsed, old, new):
            continue
        conn.execute(
            sa.text(
                "UPDATE sales_flows SET restriction_rule = CAST(:rule AS jsonb) "
                "WHERE id = :id"
            ).bindparams(rule=json.dumps(parsed), id=flow_id)
        )


def upgrade() -> None:
    _migrate_kind(OLD_KIND, NEW_KIND)


def downgrade() -> None:
    _migrate_kind(NEW_KIND, OLD_KIND)
