"""form definitions belong to exactly one sales flow

Design: sdd/sales-flows-rediseno slice 3 — the same cutover slice 2 did for
ticketing steps, applied to the form definition: `formfields`,
`formsections` and `basefieldconfigs`.

`b8e4c1d90a2f` gave every existing row an owning flow. Making the column
NOT NULL retires the popup-shared tier at the schema level, so
`find_for_flow`'s fallback has nothing left to fall back to and is deleted
in the same slice. A flow's form is what that flow owns.

Two partial unique index pairs collapse with it. Each was keyed by tier:

  uq_form_field_name_flow                  (name, sales_flow_id) WHERE ... NOT NULL
  uq_form_field_name_popup_shared          (name, popup_id)      WHERE ... IS NULL
  uq_base_field_config_flow_field          (sales_flow_id, field_name) WHERE ... NOT NULL
  uq_base_field_config_popup_field_shared  (popup_id, field_name)      WHERE ... IS NULL

The shared halves can no longer match any row and are dropped; the flow
halves are recreated as plain unique constraints, since their
`sales_flow_id IS NOT NULL` predicate is now implied by the column itself.
`formsections` carries no unique index, so it only gains the NOT NULL.

Guarded: an unowned row would be silently destroyed by `SET NOT NULL`, so
each table is counted first and a non-zero result aborts the transaction
naming the table and the offending ids.

Downgrade is real — this is schema, not data. It restores the nullable
columns and both original partial index pairs, yielding a database where
the shared tier is expressible again but unused.

Revision ID: d3f6b2a81c95
Revises: c5a71e3f8b24
Create Date: 2026-08-06 00:00:00.000000

"""

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision = "d3f6b2a81c95"
down_revision = "c5a71e3f8b24"
branch_labels = None
depends_on = None

FORM_TABLES = ("formfields", "formsections", "basefieldconfigs")

FIELD_NAME_FLOW = "uq_form_field_name_flow"
FIELD_NAME_SHARED = "uq_form_field_name_popup_shared"
BASE_CONFIG_FLOW = "uq_base_field_config_flow_field"
BASE_CONFIG_SHARED = "uq_base_field_config_popup_field_shared"


def upgrade() -> None:
    conn = op.get_bind()

    for table in FORM_TABLES:
        unowned = conn.execute(
            sa.text(
                f"SELECT id FROM {table} WHERE sales_flow_id IS NULL LIMIT 10"  # noqa: S608 — fixed literal tuple
            )
        ).all()
        if unowned:
            ids = ", ".join(str(row[0]) for row in unowned)
            raise RuntimeError(
                f"forms_flow_required cannot proceed: {table} rows without a "
                f"sales_flow_id would be lost (first ids: {ids}). Run "
                "b8e4c1d90a2f (backfill_flow_config_ownership) first."
            )

    for table in FORM_TABLES:
        op.alter_column(table, "sales_flow_id", nullable=False)

    op.drop_index(FIELD_NAME_SHARED, table_name="formfields")
    op.drop_index(FIELD_NAME_FLOW, table_name="formfields")
    op.create_index(
        FIELD_NAME_FLOW, "formfields", ["name", "sales_flow_id"], unique=True
    )

    op.drop_index(BASE_CONFIG_SHARED, table_name="basefieldconfigs")
    op.drop_index(BASE_CONFIG_FLOW, table_name="basefieldconfigs")
    op.create_index(
        BASE_CONFIG_FLOW,
        "basefieldconfigs",
        ["sales_flow_id", "field_name"],
        unique=True,
    )


def downgrade() -> None:
    op.drop_index(BASE_CONFIG_FLOW, table_name="basefieldconfigs")
    op.create_index(
        BASE_CONFIG_FLOW,
        "basefieldconfigs",
        ["sales_flow_id", "field_name"],
        unique=True,
        postgresql_where=sa.text("sales_flow_id IS NOT NULL"),
    )
    op.create_index(
        BASE_CONFIG_SHARED,
        "basefieldconfigs",
        ["popup_id", "field_name"],
        unique=True,
        postgresql_where=sa.text("sales_flow_id IS NULL"),
    )

    op.drop_index(FIELD_NAME_FLOW, table_name="formfields")
    op.create_index(
        FIELD_NAME_FLOW,
        "formfields",
        ["name", "sales_flow_id"],
        unique=True,
        postgresql_where=sa.text("sales_flow_id IS NOT NULL"),
    )
    op.create_index(
        FIELD_NAME_SHARED,
        "formfields",
        ["name", "popup_id"],
        unique=True,
        postgresql_where=sa.text("sales_flow_id IS NULL"),
    )

    for table in FORM_TABLES:
        op.alter_column(table, "sales_flow_id", nullable=True)
