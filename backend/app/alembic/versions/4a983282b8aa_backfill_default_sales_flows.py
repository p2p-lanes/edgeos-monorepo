"""backfill default sales flows

Design: sdd/sales-flows D1 — creates exactly one default sales_flow per
existing popup, with all Class B (inheritable override) columns left NULL
so the popup row stays the single source of truth until each area's
cutover slice re-points its read through the resolver (D1). No
`flow_products` rows are backfilled: an empty product set for a flow means
"all active popup products" (D3), so backfilling explicit rows would make
every product created after this migration invisible to the default flow —
a silent behavior change the design explicitly rejects.

`type` is copied from `popups.sale_type` (both enums share the
'application'/'direct' values; sales_flows.type additionally allows
'upsale', unused here). `slug` is the fixed literal 'default', de-collided
against the reserved-slug set (thank-you, success) the same way the
runtime API validator (`validate_flow_slug`) rejects them — defensive,
since 'default' never collides with either reserved value today, but kept
in sync with the validator so a future change to the default slug (or the
reserved set) can't silently produce an unreachable flow.

Idempotent: only inserts a default flow for popups that don't already have
one (`is_default = true`), so re-running this migration (or running it
after manual flows were created via the slice-1 API) is a no-op for
already-covered popups. Asserts the D1 invariant (every popup has exactly
one default flow) before returning; a violation aborts the migration
transaction.

Downgrade is deliberately a no-op: deleting backfilled flows could orphan
`flow_products`/application/payment rows a later slice may have already
written against them. Mirrors the `open_checkout_signing_secret` backfill's
downgrade contract (tests/migrations/test_backfill_open_checkout_signing_secret.py).

Revision ID: 4a983282b8aa
Revises: fa6808697ac1
Create Date: 2026-08-03 18:08:09.244073

"""

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision = "4a983282b8aa"
down_revision = "fa6808697ac1"
branch_labels = None
depends_on = None

# Mirrors app.api.sales_flow.schemas.RESERVED_FLOW_SLUGS. Duplicated here
# (rather than imported) because migrations must not depend on application
# code that can change shape after the migration ships.
RESERVED_FLOW_SLUGS = frozenset({"thank-you", "success"})
DEFAULT_FLOW_SLUG = "default"
DEFAULT_FLOW_NAME = "Default"


def resolve_default_flow_slug(
    candidate: str, reserved: frozenset[str] = RESERVED_FLOW_SLUGS
) -> str:
    """Deterministically de-collide a candidate slug against reserved slugs.

    Pure function (no I/O) so the de-collision rule is unit-testable without
    a database. Never triggers for the literal "default" today, but keeps
    the migration correct if the default slug literal or the reserved set
    ever changes.
    """
    return f"{candidate}-flow" if candidate in reserved else candidate


def upgrade() -> None:
    conn = op.get_bind()

    slug = resolve_default_flow_slug(DEFAULT_FLOW_SLUG)

    popups_needing_default = conn.execute(
        sa.text(
            "SELECT id, tenant_id, sale_type FROM popups p "
            "WHERE NOT EXISTS ("
            "  SELECT 1 FROM sales_flows f "
            "  WHERE f.popup_id = p.id AND f.is_default = true"
            ")"
        )
    ).all()

    for popup_id, tenant_id, sale_type in popups_needing_default:
        conn.execute(
            sa.text(
                "INSERT INTO sales_flows "
                "(id, tenant_id, popup_id, type, slug, name, visibility, "
                'is_default, "order", reviewers_mode, identity_mode) '
                "VALUES (gen_random_uuid(), :tenant_id, :popup_id, :sale_type, "
                ":slug, :name, 'portal_listed', true, 0, 'inherit', 'portal_auth')"
            ).bindparams(
                tenant_id=tenant_id,
                popup_id=popup_id,
                sale_type=sale_type,
                slug=slug,
                name=DEFAULT_FLOW_NAME,
            )
        )

    # D1/G1 invariant: every popup now has exactly one default flow. A
    # violation raises and rolls back the whole migration transaction.
    orphan_count = conn.execute(
        sa.text(
            "SELECT COUNT(*) FROM popups p "
            "LEFT JOIN sales_flows f "
            "  ON f.popup_id = p.id AND f.is_default = true "
            "WHERE f.id IS NULL"
        )
    ).scalar()
    if orphan_count:
        raise RuntimeError(
            "backfill_default_sales_flows invariant violated: "
            f"{orphan_count} popup(s) have no default sales_flow"
        )


def downgrade() -> None:
    # Deliberate no-op — see module docstring. Deleting backfilled default
    # flows here could orphan flow_products/application/payment rows a
    # later slice has already written against them.
    pass
