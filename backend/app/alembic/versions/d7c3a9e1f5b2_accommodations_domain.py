"""Accommodations: lodging inventory, pricing rules and bookings.

Creates the accommodation domain (PR 1 of the feature):

    accommodation_properties   a building / hotel / camp
      accommodations           a bookable *type* of room (what the checkout sells)
        accommodation_units    a physical room (what a booking occupies)
        accommodation_price_rules   nightly overrides for a date range
      accommodation_bookings   a unit occupied for [check_in, check_out)
    accommodation_images / accommodation_image_links   popup-wide photo bank

The no-overbooking guarantee is a Postgres EXCLUDE constraint over
``(unit_id, daterange(check_in, check_out))`` restricted to the blocking
statuses, which needs the ``btree_gist`` extension for the equality operator
on ``uuid``. Ranges are half-open, so a guest leaving on the 8th and one
arriving on the 8th do not collide.

Also adds:
  - ``popups.accommodation_min_stay``  default minimum nights per popup.
  - ``products.managed_by``            marks the shadow product backing a room
    type, so the product list can hide products no admin should edit.

No backfill: EdgeOS had no lodging domain before this migration; existing
``category="housing"`` products keep working untouched under the legacy
``housing-date`` ticketing step.

Revision ID: d7c3a9e1f5b2
Revises: c4d8e6f1a2b3
Create Date: 2026-08-27
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import JSONB

from app.alembic.utils import (
    add_tenant_table_permissions,
    remove_tenant_table_permissions,
)

revision: str = "d7c3a9e1f5b2"
down_revision: str | Sequence[str] | None = "f3a1b7c9d2e4"
branch_labels: Sequence[str] | None = None
depends_on: Sequence[str] | None = None

ACCOMMODATION_TABLES = (
    "accommodation_image_links",
    "accommodation_images",
    "accommodation_bookings",
    "accommodation_price_rules",
    "accommodation_units",
    "accommodations",
    "accommodation_properties",
)


def _timestamps() -> list[sa.Column]:
    return [
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
    ]


def upgrade() -> None:
    # Required by the exclusion constraint below: gist needs btree_gist to
    # index the `unit_id WITH =` half of the constraint.
    op.execute("CREATE EXTENSION IF NOT EXISTS btree_gist")

    # ------------------------------------------------------------------
    # Properties
    # ------------------------------------------------------------------
    op.create_table(
        "accommodation_properties",
        sa.Column(
            "id", sa.Uuid(), server_default=sa.text("gen_random_uuid()"), nullable=False
        ),
        sa.Column("tenant_id", sa.Uuid(), nullable=False),
        sa.Column("popup_id", sa.Uuid(), nullable=False),
        sa.Column("name", sa.String(length=255), nullable=False),
        sa.Column("address", sa.Text(), nullable=True),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("contact_email", sa.String(length=255), nullable=True),
        sa.Column("contact_name", sa.String(length=255), nullable=True),
        sa.Column("tax_percentage", sa.Numeric(precision=5, scale=2), nullable=True),
        sa.Column(
            "is_active", sa.Boolean(), server_default=sa.text("true"), nullable=False
        ),
        sa.Column("sort_order", sa.Integer(), server_default="0", nullable=False),
        *_timestamps(),
        sa.ForeignKeyConstraint(["tenant_id"], ["tenants.id"]),
        sa.ForeignKeyConstraint(["popup_id"], ["popups.id"]),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint(
            "popup_id", "name", name="uq_accommodation_properties_popup_name"
        ),
    )
    op.create_index(
        "ix_accommodation_properties_tenant_id",
        "accommodation_properties",
        ["tenant_id"],
    )
    op.create_index(
        "ix_accommodation_properties_popup_id",
        "accommodation_properties",
        ["popup_id"],
    )

    # ------------------------------------------------------------------
    # Accommodations (room types) + their shadow product link
    # ------------------------------------------------------------------
    op.create_table(
        "accommodations",
        sa.Column(
            "id", sa.Uuid(), server_default=sa.text("gen_random_uuid()"), nullable=False
        ),
        sa.Column("tenant_id", sa.Uuid(), nullable=False),
        sa.Column("popup_id", sa.Uuid(), nullable=False),
        sa.Column("property_id", sa.Uuid(), nullable=False),
        sa.Column("product_id", sa.Uuid(), nullable=True),
        sa.Column("name", sa.String(length=255), nullable=False),
        sa.Column("kind", sa.String(length=30), server_default="room", nullable=False),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("guest_capacity", sa.Integer(), server_default="1", nullable=False),
        sa.Column(
            "beds", JSONB(), server_default=sa.text("'[]'::jsonb"), nullable=False
        ),
        sa.Column(
            "default_nightly_price",
            sa.Numeric(precision=10, scale=2),
            nullable=False,
        ),
        sa.Column("long_stay_price", sa.Numeric(precision=10, scale=2), nullable=True),
        sa.Column("min_stay_override", sa.Integer(), nullable=True),
        sa.Column("bookable_from", sa.Date(), nullable=False),
        sa.Column("bookable_to", sa.Date(), nullable=False),
        sa.Column(
            "visible_in_checkout",
            sa.Boolean(),
            server_default=sa.text("true"),
            nullable=False,
        ),
        sa.Column(
            "is_active", sa.Boolean(), server_default=sa.text("true"), nullable=False
        ),
        sa.Column("sort_order", sa.Integer(), server_default="0", nullable=False),
        sa.Column("deleted_at", sa.DateTime(timezone=True), nullable=True),
        *_timestamps(),
        sa.CheckConstraint(
            "bookable_to > bookable_from", name="ck_accommodations_bookable_range"
        ),
        sa.ForeignKeyConstraint(["tenant_id"], ["tenants.id"]),
        sa.ForeignKeyConstraint(["popup_id"], ["popups.id"]),
        sa.ForeignKeyConstraint(["property_id"], ["accommodation_properties.id"]),
        sa.ForeignKeyConstraint(["product_id"], ["products.id"]),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_accommodations_tenant_id", "accommodations", ["tenant_id"])
    op.create_index("ix_accommodations_popup_id", "accommodations", ["popup_id"])
    op.create_index("ix_accommodations_property_id", "accommodations", ["property_id"])
    op.create_index(
        "ix_accommodations_popup_active", "accommodations", ["popup_id", "is_active"]
    )
    # One accommodation per shadow product: the payment path resolves the room
    # type from the product id and must never find two.
    op.create_index(
        "uq_accommodations_product_id",
        "accommodations",
        ["product_id"],
        unique=True,
        postgresql_where=sa.text("product_id IS NOT NULL"),
    )

    # ------------------------------------------------------------------
    # Units
    # ------------------------------------------------------------------
    op.create_table(
        "accommodation_units",
        sa.Column(
            "id", sa.Uuid(), server_default=sa.text("gen_random_uuid()"), nullable=False
        ),
        sa.Column("tenant_id", sa.Uuid(), nullable=False),
        sa.Column("popup_id", sa.Uuid(), nullable=False),
        sa.Column("accommodation_id", sa.Uuid(), nullable=False),
        sa.Column("label", sa.String(length=100), nullable=False),
        sa.Column("notes", sa.Text(), nullable=True),
        sa.Column(
            "is_active", sa.Boolean(), server_default=sa.text("true"), nullable=False
        ),
        sa.Column("sort_order", sa.Integer(), server_default="0", nullable=False),
        *_timestamps(),
        sa.ForeignKeyConstraint(["tenant_id"], ["tenants.id"]),
        sa.ForeignKeyConstraint(["popup_id"], ["popups.id"]),
        sa.ForeignKeyConstraint(
            ["accommodation_id"], ["accommodations.id"], ondelete="CASCADE"
        ),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint(
            "accommodation_id", "label", name="uq_accommodation_units_label"
        ),
    )
    op.create_index(
        "ix_accommodation_units_tenant_id", "accommodation_units", ["tenant_id"]
    )
    op.create_index(
        "ix_accommodation_units_popup_id", "accommodation_units", ["popup_id"]
    )
    op.create_index(
        "ix_accommodation_units_accommodation_id",
        "accommodation_units",
        ["accommodation_id"],
    )

    # ------------------------------------------------------------------
    # Price rules
    # ------------------------------------------------------------------
    op.create_table(
        "accommodation_price_rules",
        sa.Column(
            "id", sa.Uuid(), server_default=sa.text("gen_random_uuid()"), nullable=False
        ),
        sa.Column("tenant_id", sa.Uuid(), nullable=False),
        sa.Column("popup_id", sa.Uuid(), nullable=False),
        sa.Column("accommodation_id", sa.Uuid(), nullable=False),
        sa.Column("label", sa.String(length=255), nullable=True),
        sa.Column("start_date", sa.Date(), nullable=False),
        sa.Column("end_date", sa.Date(), nullable=False),
        sa.Column("nightly_price", sa.Numeric(precision=10, scale=2), nullable=False),
        sa.Column("priority", sa.Integer(), server_default="0", nullable=False),
        *_timestamps(),
        sa.CheckConstraint(
            "end_date >= start_date", name="ck_accommodation_price_rules_range"
        ),
        sa.ForeignKeyConstraint(["tenant_id"], ["tenants.id"]),
        sa.ForeignKeyConstraint(["popup_id"], ["popups.id"]),
        sa.ForeignKeyConstraint(
            ["accommodation_id"], ["accommodations.id"], ondelete="CASCADE"
        ),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        "ix_accommodation_price_rules_tenant_id",
        "accommodation_price_rules",
        ["tenant_id"],
    )
    op.create_index(
        "ix_accommodation_price_rules_popup_id",
        "accommodation_price_rules",
        ["popup_id"],
    )
    op.create_index(
        "ix_accommodation_price_rules_lookup",
        "accommodation_price_rules",
        ["accommodation_id", "start_date"],
    )

    # ------------------------------------------------------------------
    # Bookings: the exclusion constraint lives here
    # ------------------------------------------------------------------
    op.create_table(
        "accommodation_bookings",
        sa.Column(
            "id", sa.Uuid(), server_default=sa.text("gen_random_uuid()"), nullable=False
        ),
        sa.Column("tenant_id", sa.Uuid(), nullable=False),
        sa.Column("popup_id", sa.Uuid(), nullable=False),
        sa.Column("accommodation_id", sa.Uuid(), nullable=False),
        sa.Column("unit_id", sa.Uuid(), nullable=False),
        sa.Column("kind", sa.String(length=20), server_default="guest", nullable=False),
        sa.Column(
            "status", sa.String(length=20), server_default="hold", nullable=False
        ),
        sa.Column("check_in", sa.Date(), nullable=False),
        sa.Column("check_out", sa.Date(), nullable=False),
        sa.Column("guest_count", sa.Integer(), nullable=True),
        sa.Column(
            "guests", JSONB(), server_default=sa.text("'[]'::jsonb"), nullable=False
        ),
        sa.Column("primary_guest_name", sa.String(length=255), nullable=True),
        sa.Column("primary_guest_email", sa.String(length=255), nullable=True),
        sa.Column("attendee_id", sa.Uuid(), nullable=True),
        sa.Column("human_id", sa.Uuid(), nullable=True),
        sa.Column("payment_id", sa.Uuid(), nullable=True),
        sa.Column("payment_product_id", sa.Uuid(), nullable=True),
        sa.Column("price_snapshot", JSONB(), nullable=True),
        sa.Column("hold_expires_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("notes", sa.Text(), nullable=True),
        sa.Column("created_by_user_id", sa.Uuid(), nullable=True),
        *_timestamps(),
        sa.CheckConstraint(
            "check_out > check_in", name="ck_accommodation_bookings_range"
        ),
        sa.ForeignKeyConstraint(["tenant_id"], ["tenants.id"]),
        sa.ForeignKeyConstraint(["popup_id"], ["popups.id"]),
        sa.ForeignKeyConstraint(["accommodation_id"], ["accommodations.id"]),
        sa.ForeignKeyConstraint(["unit_id"], ["accommodation_units.id"]),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        "ix_accommodation_bookings_tenant_id", "accommodation_bookings", ["tenant_id"]
    )
    op.create_index(
        "ix_accommodation_bookings_popup_id", "accommodation_bookings", ["popup_id"]
    )
    op.create_index(
        "ix_accommodation_bookings_accommodation_id",
        "accommodation_bookings",
        ["accommodation_id"],
    )
    op.create_index(
        "ix_accommodation_bookings_unit_id", "accommodation_bookings", ["unit_id"]
    )
    op.create_index(
        "ix_accommodation_bookings_status", "accommodation_bookings", ["status"]
    )
    op.create_index(
        "ix_accommodation_bookings_check_in", "accommodation_bookings", ["check_in"]
    )
    op.create_index(
        "ix_accommodation_bookings_payment_id",
        "accommodation_bookings",
        ["payment_id"],
    )
    op.create_index(
        "ix_accommodation_bookings_attendee_id",
        "accommodation_bookings",
        ["attendee_id"],
    )
    op.create_index(
        "ix_accommodation_bookings_human_id", "accommodation_bookings", ["human_id"]
    )
    op.create_index(
        "ix_accommodation_bookings_window",
        "accommodation_bookings",
        ["popup_id", "check_in", "check_out"],
    )
    op.create_index(
        "ix_accommodation_bookings_unit_active",
        "accommodation_bookings",
        ["unit_id", "check_in"],
        postgresql_where=sa.text("status IN ('hold', 'confirmed')"),
    )

    # THE no-overbooking guarantee. Half-open daterange: [check_in, check_out).
    # Only hold/confirmed rows participate, so cancelling frees the dates
    # without deleting history.
    op.execute(
        """
        ALTER TABLE accommodation_bookings
        ADD CONSTRAINT uq_accommodation_bookings_no_overlap
        EXCLUDE USING gist (
            unit_id WITH =,
            daterange(check_in, check_out) WITH &&
        ) WHERE (status IN ('hold', 'confirmed'))
        """
    )

    # ------------------------------------------------------------------
    # Photo bank
    # ------------------------------------------------------------------
    op.create_table(
        "accommodation_images",
        sa.Column(
            "id", sa.Uuid(), server_default=sa.text("gen_random_uuid()"), nullable=False
        ),
        sa.Column("tenant_id", sa.Uuid(), nullable=False),
        sa.Column("popup_id", sa.Uuid(), nullable=False),
        sa.Column("url", sa.Text(), nullable=False),
        sa.Column("filename", sa.String(length=255), nullable=True),
        sa.Column("width", sa.Integer(), nullable=True),
        sa.Column("height", sa.Integer(), nullable=True),
        sa.Column("uploaded_by_user_id", sa.Uuid(), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.ForeignKeyConstraint(["tenant_id"], ["tenants.id"]),
        sa.ForeignKeyConstraint(["popup_id"], ["popups.id"]),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        "ix_accommodation_images_tenant_id", "accommodation_images", ["tenant_id"]
    )
    op.create_index(
        "ix_accommodation_images_popup_id", "accommodation_images", ["popup_id"]
    )

    op.create_table(
        "accommodation_image_links",
        sa.Column("accommodation_id", sa.Uuid(), nullable=False),
        sa.Column("image_id", sa.Uuid(), nullable=False),
        sa.Column("tenant_id", sa.Uuid(), nullable=False),
        sa.Column("sort_order", sa.Integer(), server_default="0", nullable=False),
        sa.ForeignKeyConstraint(
            ["accommodation_id"], ["accommodations.id"], ondelete="CASCADE"
        ),
        sa.ForeignKeyConstraint(
            ["image_id"], ["accommodation_images.id"], ondelete="CASCADE"
        ),
        sa.ForeignKeyConstraint(["tenant_id"], ["tenants.id"]),
        sa.PrimaryKeyConstraint("accommodation_id", "image_id"),
    )
    op.create_index(
        "ix_accommodation_image_links_tenant_id",
        "accommodation_image_links",
        ["tenant_id"],
    )
    op.create_index(
        "ix_accommodation_image_links_image_id",
        "accommodation_image_links",
        ["image_id"],
    )

    # ------------------------------------------------------------------
    # Host columns on existing tables
    # ------------------------------------------------------------------
    op.add_column(
        "popups",
        sa.Column(
            "accommodation_min_stay",
            sa.Integer(),
            server_default="1",
            nullable=False,
        ),
    )
    op.add_column("products", sa.Column("managed_by", sa.String(), nullable=True))
    op.create_index("ix_products_managed_by", "products", ["managed_by"])

    # RLS + grants, in dependency order.
    for table in reversed(ACCOMMODATION_TABLES):
        add_tenant_table_permissions(table)


def downgrade() -> None:
    for table in ACCOMMODATION_TABLES:
        remove_tenant_table_permissions(table)

    op.drop_index("ix_products_managed_by", table_name="products")
    op.drop_column("products", "managed_by")
    op.drop_column("popups", "accommodation_min_stay")

    op.drop_table("accommodation_image_links")
    op.drop_table("accommodation_images")
    op.drop_table("accommodation_bookings")
    op.drop_table("accommodation_price_rules")
    op.drop_table("accommodation_units")
    op.drop_table("accommodations")
    op.drop_table("accommodation_properties")

    # btree_gist is left installed: dropping a shared extension on downgrade
    # would break any other object that started depending on it.
