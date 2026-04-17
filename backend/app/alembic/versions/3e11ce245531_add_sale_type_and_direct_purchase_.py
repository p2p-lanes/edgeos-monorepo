"""add sale_type and direct purchase support

Adds sale_type column to popups (default "application" — backward compatible).
Makes application_id nullable on attendees and payments.
Adds popup_id FK (NOT NULL after backfill) to attendees and payments.
Backfills popup_id from applications.popup_id via subquery.
Adds CHECK constraints to enforce that at least one of application_id/popup_id
is set, plus indexes on popup_id. Rewrites ix_payments_application_status as a
partial index (WHERE application_id IS NOT NULL) now that application_id is
nullable.

Revision ID: 3e11ce245531
Revises: 0014_add_translations_table
Create Date: 2026-04-16 15:31:52.016841

"""
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import UUID

from alembic import op

# revision identifiers, used by Alembic.
revision = "3e11ce245531"
down_revision = "0014_add_translations_table"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # ------------------------------------------------------------------
    # Phase 1: Schema additions (nullable first — backfill before NOT NULL)
    # ------------------------------------------------------------------

    # 1a. popups.sale_type — backward compatible default
    op.add_column(
        "popups",
        sa.Column(
            "sale_type",
            sa.String(),
            nullable=False,
            server_default="application",
        ),
    )

    # 1b. attendees.application_id becomes nullable
    op.alter_column("attendees", "application_id", nullable=True)

    # 1c. attendees.popup_id — nullable initially, populated by backfill
    op.add_column(
        "attendees",
        sa.Column(
            "popup_id",
            UUID(as_uuid=True),
            sa.ForeignKey("popups.id"),
            nullable=True,
        ),
    )

    # 1d. payments.application_id becomes nullable
    op.alter_column("payments", "application_id", nullable=True)

    # 1e. payments.popup_id — nullable initially, populated by backfill
    op.add_column(
        "payments",
        sa.Column(
            "popup_id",
            UUID(as_uuid=True),
            sa.ForeignKey("popups.id"),
            nullable=True,
        ),
    )

    # ------------------------------------------------------------------
    # Phase 2: Backfill popup_id from applications
    # ------------------------------------------------------------------

    op.execute(
        """
        UPDATE attendees
        SET popup_id = (
            SELECT popup_id
            FROM applications
            WHERE applications.id = attendees.application_id
        )
        WHERE popup_id IS NULL
          AND application_id IS NOT NULL
        """
    )

    op.execute(
        """
        UPDATE payments
        SET popup_id = (
            SELECT popup_id
            FROM applications
            WHERE applications.id = payments.application_id
        )
        WHERE popup_id IS NULL
          AND application_id IS NOT NULL
        """
    )

    # ------------------------------------------------------------------
    # Phase 3: Enforce NOT NULL on popup_id after backfill
    # ------------------------------------------------------------------

    op.alter_column("attendees", "popup_id", nullable=False)
    op.alter_column("payments", "popup_id", nullable=False)

    # ------------------------------------------------------------------
    # Phase 4: CHECK constraints — at least one of application_id/popup_id
    # ------------------------------------------------------------------

    op.execute(
        """
        ALTER TABLE attendees
        ADD CONSTRAINT chk_attendee_source
        CHECK (application_id IS NOT NULL OR popup_id IS NOT NULL)
        """
    )

    op.execute(
        """
        ALTER TABLE payments
        ADD CONSTRAINT chk_payment_source
        CHECK (application_id IS NOT NULL OR popup_id IS NOT NULL)
        """
    )

    # ------------------------------------------------------------------
    # Phase 5: Indexes on popup_id + partial index rewrite
    # ------------------------------------------------------------------

    op.create_index("ix_attendees_popup_id", "attendees", ["popup_id"])
    op.create_index("ix_payments_popup_id", "payments", ["popup_id"])

    # Rebuild ix_payments_application_status as partial — application_id is now nullable
    op.drop_index("ix_payments_application_status", table_name="payments")
    op.execute(
        """
        CREATE INDEX ix_payments_application_status
        ON payments (application_id, status)
        WHERE application_id IS NOT NULL
        """
    )


def downgrade() -> None:
    # ------------------------------------------------------------------
    # Reverse Phase 5: Indexes
    # ------------------------------------------------------------------

    op.drop_index("ix_payments_popup_id", table_name="payments")
    op.drop_index("ix_attendees_popup_id", table_name="attendees")

    # Restore the original non-partial index
    op.drop_index("ix_payments_application_status", table_name="payments")
    op.create_index(
        "ix_payments_application_status",
        "payments",
        ["application_id", "status"],
    )

    # ------------------------------------------------------------------
    # Reverse Phase 4: CHECK constraints
    # ------------------------------------------------------------------

    op.execute("ALTER TABLE attendees DROP CONSTRAINT IF EXISTS chk_attendee_source")
    op.execute("ALTER TABLE payments DROP CONSTRAINT IF EXISTS chk_payment_source")

    # ------------------------------------------------------------------
    # Reverse Phases 3+2+1: popup_id columns and application_id NOT NULL
    # GUARD: fail loudly if direct-sale data (application_id IS NULL) exists
    # ------------------------------------------------------------------

    op.drop_column("payments", "popup_id")

    op.execute(
        """
        DO $$
        BEGIN
            IF EXISTS (SELECT 1 FROM payments WHERE application_id IS NULL) THEN
                RAISE EXCEPTION 'Cannot downgrade: payments rows with application_id=NULL exist (direct-sale payments). Remove them first.';
            END IF;
        END $$;
        """
    )
    op.alter_column("payments", "application_id", nullable=False)

    op.drop_column("attendees", "popup_id")

    op.execute(
        """
        DO $$
        BEGIN
            IF EXISTS (SELECT 1 FROM attendees WHERE application_id IS NULL) THEN
                RAISE EXCEPTION 'Cannot downgrade: attendees rows with application_id=NULL exist (direct-sale attendees). Remove them first.';
            END IF;
        END $$;
        """
    )
    op.alter_column("attendees", "application_id", nullable=False)

    op.drop_column("popups", "sale_type")
