"""SQLModel tables for the accommodation module.

The no-overbooking guarantee lives in the database: ``AccommodationBookings``
carries a GiST exclusion constraint on ``(unit_id, daterange(check_in,
check_out))`` restricted to the blocking statuses. It is declared here for
``__table_args__`` parity with the migration, but it is the migration that
creates it (SQLModel never emits DDL in production).
"""

import uuid
from typing import TYPE_CHECKING

from sqlalchemy import CheckConstraint, Index, UniqueConstraint, text
from sqlalchemy.dialects.postgresql import UUID
from sqlmodel import Column, Field, Relationship

from app.api.accommodation.schemas import (
    AccommodationBase,
    AccommodationBookingBase,
    AccommodationImageBase,
    AccommodationImageLinkBase,
    AccommodationPriceRuleBase,
    AccommodationPropertyBase,
    AccommodationUnitBase,
)

if TYPE_CHECKING:
    from app.api.product.models import Products


def _pk_column() -> Column:
    return Column(UUID(as_uuid=True), primary_key=True)


class AccommodationProperties(AccommodationPropertyBase, table=True):
    """A building / site that holds accommodations."""

    __tablename__ = "accommodation_properties"
    __table_args__ = (
        UniqueConstraint(
            "popup_id", "name", name="uq_accommodation_properties_popup_name"
        ),
    )

    id: uuid.UUID = Field(default_factory=uuid.uuid4, sa_column=_pk_column())

    accommodations: list["Accommodations"] = Relationship(
        back_populates="property", cascade_delete=True
    )


class Accommodations(AccommodationBase, table=True):
    """A bookable room *type*, backed by N interchangeable units."""

    __tablename__ = "accommodations"
    __table_args__ = (
        Index("ix_accommodations_popup_active", "popup_id", "is_active"),
        CheckConstraint(
            "bookable_to > bookable_from", name="ck_accommodations_bookable_range"
        ),
    )

    id: uuid.UUID = Field(default_factory=uuid.uuid4, sa_column=_pk_column())

    property: AccommodationProperties = Relationship(back_populates="accommodations")
    product: "Products" = Relationship()
    units: list["AccommodationUnits"] = Relationship(
        back_populates="accommodation", cascade_delete=True
    )
    price_rules: list["AccommodationPriceRules"] = Relationship(
        back_populates="accommodation", cascade_delete=True
    )
    image_links: list["AccommodationImageLinks"] = Relationship(
        back_populates="accommodation", cascade_delete=True
    )


class AccommodationUnits(AccommodationUnitBase, table=True):
    """A physical room. Bookings occupy units."""

    __tablename__ = "accommodation_units"
    __table_args__ = (
        UniqueConstraint(
            "accommodation_id", "label", name="uq_accommodation_units_label"
        ),
    )

    id: uuid.UUID = Field(default_factory=uuid.uuid4, sa_column=_pk_column())

    accommodation: Accommodations = Relationship(back_populates="units")
    bookings: list["AccommodationBookings"] = Relationship(back_populates="unit")


class AccommodationPriceRules(AccommodationPriceRuleBase, table=True):
    """Nightly price override for a closed date range."""

    __tablename__ = "accommodation_price_rules"
    __table_args__ = (
        Index("ix_accommodation_price_rules_lookup", "accommodation_id", "start_date"),
        CheckConstraint(
            "end_date >= start_date", name="ck_accommodation_price_rules_range"
        ),
    )

    id: uuid.UUID = Field(default_factory=uuid.uuid4, sa_column=_pk_column())

    accommodation: Accommodations = Relationship(back_populates="price_rules")


class AccommodationBookings(AccommodationBookingBase, table=True):
    """A unit occupied for ``[check_in, check_out)``.

    ``uq_accommodation_bookings_no_overlap`` (created by the migration) is the
    single source of truth for availability: two ``hold``/``confirmed`` rows
    can never overlap on the same unit, whatever the application does.
    """

    __tablename__ = "accommodation_bookings"
    __table_args__ = (
        CheckConstraint("check_out > check_in", name="ck_accommodation_bookings_range"),
        Index("ix_accommodation_bookings_window", "popup_id", "check_in", "check_out"),
        Index(
            "ix_accommodation_bookings_unit_active",
            "unit_id",
            "check_in",
            postgresql_where=text("status IN ('hold', 'confirmed')"),
        ),
    )

    id: uuid.UUID = Field(default_factory=uuid.uuid4, sa_column=_pk_column())

    unit: AccommodationUnits = Relationship(back_populates="bookings")


class AccommodationImages(AccommodationImageBase, table=True):
    """Popup-wide photo bank."""

    __tablename__ = "accommodation_images"

    id: uuid.UUID = Field(default_factory=uuid.uuid4, sa_column=_pk_column())

    links: list["AccommodationImageLinks"] = Relationship(
        back_populates="image", cascade_delete=True
    )


class AccommodationImageLinks(AccommodationImageLinkBase, table=True):
    """Ordered link between an accommodation and a library image."""

    __tablename__ = "accommodation_image_links"

    accommodation: Accommodations = Relationship(back_populates="image_links")
    image: AccommodationImages = Relationship(back_populates="links")
