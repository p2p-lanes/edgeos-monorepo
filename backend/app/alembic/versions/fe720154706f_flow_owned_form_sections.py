"""Enforce form definition ownership and section-flow consistency.

Revision ID: fe720154706f
Revises: a91d4b7e2306
Create Date: 2026-10-16
"""

import sqlalchemy as sa
from alembic import op

revision = "fe720154706f"
down_revision = "a91d4b7e2306"
branch_labels = None
depends_on = None


def _assert_flow_scope_is_consistent() -> None:
    connection = op.get_bind()
    checks = (
        (
            "formsections",
            """
            SELECT fs.id
            FROM formsections fs
            LEFT JOIN sales_flows sf ON sf.id = fs.sales_flow_id
            WHERE sf.id IS NULL
               OR sf.popup_id IS DISTINCT FROM fs.popup_id
               OR sf.tenant_id IS DISTINCT FROM fs.tenant_id
            LIMIT 10
            """,
        ),
        (
            "formfields",
            """
            SELECT ff.id
            FROM formfields ff
            LEFT JOIN sales_flows sf ON sf.id = ff.sales_flow_id
            WHERE sf.id IS NULL
               OR sf.popup_id IS DISTINCT FROM ff.popup_id
               OR sf.tenant_id IS DISTINCT FROM ff.tenant_id
            LIMIT 10
            """,
        ),
        (
            "basefieldconfigs",
            """
            SELECT bfc.id
            FROM basefieldconfigs bfc
            LEFT JOIN sales_flows sf ON sf.id = bfc.sales_flow_id
            WHERE sf.id IS NULL
               OR sf.popup_id IS DISTINCT FROM bfc.popup_id
               OR sf.tenant_id IS DISTINCT FROM bfc.tenant_id
            LIMIT 10
            """,
        ),
        (
            "formfields.section_id",
            """
            SELECT ff.id
            FROM formfields ff
            LEFT JOIN formsections fs
              ON fs.id = ff.section_id
             AND fs.sales_flow_id = ff.sales_flow_id
             AND fs.popup_id = ff.popup_id
             AND fs.tenant_id = ff.tenant_id
            WHERE ff.section_id IS NOT NULL AND fs.id IS NULL
            LIMIT 10
            """,
        ),
        (
            "basefieldconfigs.section_id",
            """
            SELECT bfc.id
            FROM basefieldconfigs bfc
            LEFT JOIN formsections fs
              ON fs.id = bfc.section_id
             AND fs.sales_flow_id = bfc.sales_flow_id
             AND fs.popup_id = bfc.popup_id
             AND fs.tenant_id = bfc.tenant_id
            WHERE bfc.section_id IS NOT NULL AND fs.id IS NULL
            LIMIT 10
            """,
        ),
    )
    for scope, statement in checks:
        invalid_ids = connection.execute(sa.text(statement)).scalars().all()
        if invalid_ids:
            raise RuntimeError(
                f"Cannot enforce flow-owned form integrity for {scope}; "
                f"repair these rows first: {', '.join(map(str, invalid_ids))}"
            )


def upgrade() -> None:
    _assert_flow_scope_is_consistent()

    for table in ("formsections", "formfields", "basefieldconfigs"):
        for column in ("popup_id", "tenant_id"):
            constraint = f"{table}_{column}_fkey"
            op.drop_constraint(constraint, table, type_="foreignkey")
            op.create_foreign_key(
                constraint,
                table,
                "popups" if column == "popup_id" else "tenants",
                [column],
                ["id"],
                ondelete="CASCADE",
            )

    for table, prefix in (
        ("formsections", "formsections"),
        ("formfields", "formfields"),
        ("basefieldconfigs", "basefieldconfigs"),
    ):
        op.drop_constraint(f"fk_{prefix}_sales_flow_id", table, type_="foreignkey")

    op.execute(
        """
        CREATE OR REPLACE FUNCTION public.prevent_protected_formsection_delete()
        RETURNS trigger
        LANGUAGE plpgsql
        SET search_path = pg_catalog, public
        AS $$
        BEGIN
            IF OLD.protected AND pg_catalog.pg_trigger_depth() = 1 THEN
                RAISE EXCEPTION 'Cannot delete a protected form section'
                    USING ERRCODE = '23514',
                          CONSTRAINT = 'formsections_protected_delete_guard';
            END IF;
            RETURN OLD;
        END;
        $$;
        """
    )
    op.execute(
        "DROP TRIGGER IF EXISTS formsections_protected_delete_guard "
        "ON public.formsections"
    )
    op.execute(
        """
        CREATE TRIGGER formsections_protected_delete_guard
        BEFORE DELETE ON public.formsections
        FOR EACH ROW
        EXECUTE FUNCTION public.prevent_protected_formsection_delete()
        """
    )

    op.create_unique_constraint(
        "uq_sales_flows_id_popup_tenant",
        "sales_flows",
        ["id", "popup_id", "tenant_id"],
    )
    op.create_unique_constraint(
        "uq_form_sections_flow_scope",
        "formsections",
        ["id", "sales_flow_id", "popup_id", "tenant_id"],
    )
    op.create_foreign_key(
        "fk_form_sections_flow_scope",
        "formsections",
        "sales_flows",
        ["sales_flow_id", "popup_id", "tenant_id"],
        ["id", "popup_id", "tenant_id"],
        ondelete="CASCADE",
    )
    for table, prefix in (
        ("formfields", "formfields"),
        ("basefieldconfigs", "basefieldconfigs"),
    ):
        op.create_foreign_key(
            f"fk_{prefix}_flow_scope",
            table,
            "sales_flows",
            ["sales_flow_id", "popup_id", "tenant_id"],
            ["id", "popup_id", "tenant_id"],
            ondelete="CASCADE",
        )
        op.create_foreign_key(
            f"fk_{prefix}_section_flow_scope",
            table,
            "formsections",
            ["section_id", "sales_flow_id", "popup_id", "tenant_id"],
            ["id", "sales_flow_id", "popup_id", "tenant_id"],
        )


def downgrade() -> None:
    for table, prefix in (
        ("formfields", "formfields"),
        ("basefieldconfigs", "basefieldconfigs"),
    ):
        op.drop_constraint(f"fk_{prefix}_section_flow_scope", table, type_="foreignkey")
        op.drop_constraint(f"fk_{prefix}_flow_scope", table, type_="foreignkey")
    op.drop_constraint(
        "fk_form_sections_flow_scope", "formsections", type_="foreignkey"
    )
    op.drop_constraint("uq_form_sections_flow_scope", "formsections", type_="unique")
    op.drop_constraint("uq_sales_flows_id_popup_tenant", "sales_flows", type_="unique")
    for table, prefix in (
        ("formsections", "formsections"),
        ("formfields", "formfields"),
        ("basefieldconfigs", "basefieldconfigs"),
    ):
        op.create_foreign_key(
            f"fk_{prefix}_sales_flow_id",
            table,
            "sales_flows",
            ["sales_flow_id"],
            ["id"],
        )
        for column, referred_table in (
            ("popup_id", "popups"),
            ("tenant_id", "tenants"),
        ):
            op.drop_constraint(f"{table}_{column}_fkey", table, type_="foreignkey")
            op.create_foreign_key(
                f"{table}_{column}_fkey",
                table,
                referred_table,
                [column],
                ["id"],
            )
    op.execute(
        "DROP TRIGGER IF EXISTS formsections_protected_delete_guard "
        "ON public.formsections"
    )
    op.execute("DROP FUNCTION IF EXISTS public.prevent_protected_formsection_delete()")
