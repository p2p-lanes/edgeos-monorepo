"""Database operations for the accommodation module.

The one non-obvious piece here is the **shadow product**: every accommodation
owns an internal ``Products`` row (``category="housing"``,
``managed_by="accommodation"``). Bookings are then sold through the existing
payment machinery (``payment_products`` + ``purchase_metadata``) without
touching it. The shadow is written only from this file; admins never see or
edit it (the product list filters ``managed_by IS NULL``), and its ``price``
is informative: what is charged always comes from the quote.
"""

import uuid
from datetime import UTC, date, datetime
from decimal import ROUND_HALF_UP, Decimal
from typing import Any

from sqlalchemy.orm import selectinload
from sqlmodel import Session, col, func, or_, select

from app.api.accommodation.constants import (
    BLOCKING_BOOKING_STATUSES,
    PRODUCT_MANAGED_BY_ACCOMMODATION,
    BookingStatus,
)
from app.api.accommodation.models import (
    AccommodationBookings,
    AccommodationImageLinks,
    AccommodationImages,
    AccommodationPriceRules,
    AccommodationProperties,
    Accommodations,
    AccommodationUnits,
)
from app.api.accommodation.schemas import (
    AccommodationBulkFilter,
    AccommodationBulkPrice,
    AccommodationCreate,
    AccommodationDuplicate,
    AccommodationImageCreate,
    AccommodationImageUpdate,
    AccommodationPriceRuleCreate,
    AccommodationPriceRuleUpdate,
    AccommodationPropertyCreate,
    AccommodationPropertyUpdate,
    AccommodationUnitBulkCreate,
    AccommodationUnitCreate,
    AccommodationUnitUpdate,
    AccommodationUpdate,
    BulkPriceMode,
)
from app.api.product.models import Products
from app.api.product.schemas import CATEGORY_HOUSING
from app.api.shared.crud import BaseCRUD
from app.utils.utils import slugify


def _utcnow() -> datetime:
    return datetime.now(UTC)


# ---------------------------------------------------------------------------
# Properties
# ---------------------------------------------------------------------------


class AccommodationPropertiesCRUD(
    BaseCRUD[
        AccommodationProperties,
        AccommodationPropertyCreate,
        AccommodationPropertyUpdate,
    ]
):
    def __init__(self) -> None:
        super().__init__(AccommodationProperties)

    def create_for_tenant(
        self,
        session: Session,
        obj_in: AccommodationPropertyCreate,
        tenant_id: uuid.UUID,
    ) -> AccommodationProperties:
        db_obj = AccommodationProperties(**obj_in.model_dump(), tenant_id=tenant_id)
        session.add(db_obj)
        session.commit()
        session.refresh(db_obj)
        return db_obj

    def update(
        self,
        session: Session,
        db_obj: AccommodationProperties,
        obj_in: AccommodationPropertyUpdate,
    ) -> AccommodationProperties:
        for field, value in obj_in.model_dump(exclude_unset=True).items():
            setattr(db_obj, field, value)
        db_obj.updated_at = _utcnow()
        session.add(db_obj)
        session.commit()
        session.refresh(db_obj)
        return db_obj

    def find_by_popup(
        self,
        session: Session,
        popup_id: uuid.UUID,
        *,
        active_only: bool = False,
        search: str | None = None,
    ) -> list[AccommodationProperties]:
        statement = select(AccommodationProperties).where(
            AccommodationProperties.popup_id == popup_id
        )
        if active_only:
            statement = statement.where(
                col(AccommodationProperties.is_active).is_(True)
            )
        if search:
            statement = statement.where(
                col(AccommodationProperties.name).ilike(f"%{search}%")
            )
        statement = statement.order_by(
            col(AccommodationProperties.sort_order), col(AccommodationProperties.name)
        )
        return list(session.exec(statement).all())


# ---------------------------------------------------------------------------
# Accommodations (+ shadow product)
# ---------------------------------------------------------------------------


class AccommodationsCRUD(
    BaseCRUD[Accommodations, AccommodationCreate, AccommodationUpdate]
):
    def __init__(self) -> None:
        super().__init__(Accommodations)

    # -- shadow product ----------------------------------------------------

    def _shadow_slug(self, session: Session, name: str, popup_id: uuid.UUID) -> str:
        """A slug that cannot collide with a hand-made product's."""
        base = f"accommodation-{slugify(name)}"[:200]
        candidate = base
        counter = 1
        while session.exec(
            select(Products).where(
                Products.popup_id == popup_id,
                Products.slug == candidate,
                col(Products.deleted_at).is_(None),
            )
        ).first():
            counter += 1
            candidate = f"{base}-{counter}"
        return candidate

    def _image_urls(self, session: Session, accommodation_id: uuid.UUID) -> list[str]:
        rows = session.exec(
            select(AccommodationImages)
            .join(
                AccommodationImageLinks,
                col(AccommodationImageLinks.image_id) == col(AccommodationImages.id),
            )
            .where(AccommodationImageLinks.accommodation_id == accommodation_id)
            .order_by(col(AccommodationImageLinks.sort_order))
        ).all()
        return [row.url for row in rows]

    def sync_shadow_product(
        self, session: Session, accommodation: Accommodations
    ) -> Products:
        """Create or refresh the internal product mirroring this room type.

        Only the fields the checkout and the payment engine read are mirrored;
        stock is deliberately unlimited (``total_stock_remaining=None``)
        because availability is decided by units and dates, not by a counter.
        """
        images = self._image_urls(session, accommodation.id)
        product: Products | None = None
        if accommodation.product_id is not None:
            product = session.get(Products, accommodation.product_id)

        if product is None:
            product = Products(
                tenant_id=accommodation.tenant_id,
                popup_id=accommodation.popup_id,
                name=accommodation.name,
                slug=self._shadow_slug(
                    session, accommodation.name, accommodation.popup_id
                ),
                price=accommodation.default_nightly_price,
                category=CATEGORY_HOUSING,
                managed_by=PRODUCT_MANAGED_BY_ACCOMMODATION,
                total_stock_cap=None,
                total_stock_remaining=None,
                discountable=True,
            )

        product.name = accommodation.name
        product.description = accommodation.description
        product.price = accommodation.default_nightly_price
        product.images = images
        product.image_url = images[0] if images else None
        product.is_active = accommodation.is_active and accommodation.deleted_at is None
        product.managed_by = PRODUCT_MANAGED_BY_ACCOMMODATION
        session.add(product)
        session.flush()

        accommodation.product_id = product.id
        session.add(accommodation)
        return product

    # -- CRUD --------------------------------------------------------------

    def create_for_tenant(
        self,
        session: Session,
        obj_in: AccommodationCreate,
        tenant_id: uuid.UUID,
    ) -> Accommodations:
        """Create the room type, its shadow product and (optionally) its units."""
        data = obj_in.model_dump(
            exclude={"units_count", "unit_label_prefix", "image_ids"}
        )
        data["beds"] = [bed.model_dump(mode="json") for bed in obj_in.beds]

        accommodation = Accommodations(**data, tenant_id=tenant_id)
        session.add(accommodation)
        session.flush()

        if obj_in.image_ids:
            self._replace_image_links(session, accommodation, obj_in.image_ids)

        if obj_in.units_count:
            accommodation_units_crud.bulk_create(
                session,
                accommodation,
                AccommodationUnitBulkCreate(
                    prefix=obj_in.unit_label_prefix or f"{obj_in.name} ",
                    count=obj_in.units_count,
                ),
                commit=False,
            )

        self.sync_shadow_product(session, accommodation)
        session.commit()
        session.refresh(accommodation)
        return accommodation

    def update(
        self,
        session: Session,
        db_obj: Accommodations,
        obj_in: AccommodationUpdate,
    ) -> Accommodations:
        update_data = obj_in.model_dump(exclude_unset=True, exclude={"image_ids"})
        if "beds" in update_data and obj_in.beds is not None:
            update_data["beds"] = [bed.model_dump(mode="json") for bed in obj_in.beds]

        for field, value in update_data.items():
            setattr(db_obj, field, value)
        db_obj.updated_at = _utcnow()
        session.add(db_obj)

        if obj_in.image_ids is not None:
            self._replace_image_links(session, db_obj, obj_in.image_ids)

        self.sync_shadow_product(session, db_obj)
        session.commit()
        session.refresh(db_obj)
        return db_obj

    def soft_delete(self, session: Session, db_obj: Accommodations) -> Accommodations:
        """Retire a room type without touching its bookings (C15).

        Existing bookings stay valid and keep showing on the calendar; the
        accommodation simply stops being sellable.
        """
        db_obj.deleted_at = _utcnow()
        db_obj.is_active = False
        db_obj.visible_in_checkout = False
        db_obj.updated_at = _utcnow()
        session.add(db_obj)
        self.sync_shadow_product(session, db_obj)
        session.commit()
        session.refresh(db_obj)
        return db_obj

    def _replace_image_links(
        self,
        session: Session,
        accommodation: Accommodations,
        image_ids: list[uuid.UUID],
    ) -> None:
        existing = session.exec(
            select(AccommodationImageLinks).where(
                AccommodationImageLinks.accommodation_id == accommodation.id
            )
        ).all()
        for link in existing:
            session.delete(link)
        session.flush()

        for position, image_id in enumerate(image_ids):
            session.add(
                AccommodationImageLinks(
                    accommodation_id=accommodation.id,
                    image_id=image_id,
                    tenant_id=accommodation.tenant_id,
                    sort_order=position,
                )
            )
        session.flush()

    def get_live(self, session: Session, id: uuid.UUID) -> Accommodations | None:
        return session.exec(
            select(Accommodations).where(
                Accommodations.id == id, col(Accommodations.deleted_at).is_(None)
            )
        ).first()

    def find_by_popup(
        self,
        session: Session,
        popup_id: uuid.UUID,
        *,
        property_ids: list[uuid.UUID] | None = None,
        checkout_only: bool = False,
        search: str | None = None,
    ) -> list[Accommodations]:
        """List room types of a popup.

        ``checkout_only`` applies the portal's filter: active, not deleted,
        visible, and restricted to the properties the ticketing step offers.
        """
        statement = select(Accommodations).where(
            Accommodations.popup_id == popup_id,
            col(Accommodations.deleted_at).is_(None),
        )
        if property_ids:
            statement = statement.where(
                col(Accommodations.property_id).in_(property_ids)
            )
        if checkout_only:
            statement = statement.where(
                col(Accommodations.is_active).is_(True),
                col(Accommodations.visible_in_checkout).is_(True),
            )
        if search:
            statement = statement.where(col(Accommodations.name).ilike(f"%{search}%"))

        statement = statement.options(
            selectinload(Accommodations.units),  # type: ignore[arg-type]
        ).order_by(col(Accommodations.sort_order), col(Accommodations.name))
        return list(session.exec(statement).all())

    def get_by_product_ids(
        self, session: Session, product_ids: list[uuid.UUID]
    ) -> dict[uuid.UUID, Accommodations]:
        """Reverse lookup used by the payment path: shadow product -> room type."""
        if not product_ids:
            return {}
        rows = session.exec(
            select(Accommodations).where(
                col(Accommodations.product_id).in_(product_ids)
            )
        ).all()
        return {row.product_id: row for row in rows if row.product_id is not None}

    def images_for(
        self, session: Session, accommodation_id: uuid.UUID
    ) -> list[AccommodationImages]:
        """Photos linked to a room type, in display order."""
        return list(
            session.exec(
                select(AccommodationImages)
                .join(
                    AccommodationImageLinks,
                    col(AccommodationImageLinks.image_id)
                    == col(AccommodationImages.id),
                )
                .where(AccommodationImageLinks.accommodation_id == accommodation_id)
                .order_by(col(AccommodationImageLinks.sort_order))
            ).all()
        )

    def images_for_many(
        self, session: Session, accommodation_ids: list[uuid.UUID]
    ) -> dict[uuid.UUID, list[AccommodationImages]]:
        """Photos grouped by room type: one query for a whole checkout page.

        The per-room version is fine for an editor showing one room; the
        portal renders every room type at once and would otherwise issue a
        query per card on the hot path.
        """
        if not accommodation_ids:
            return {}
        rows = session.exec(
            select(AccommodationImages, AccommodationImageLinks.accommodation_id)
            .join(
                AccommodationImageLinks,
                col(AccommodationImageLinks.image_id) == col(AccommodationImages.id),
            )
            .where(col(AccommodationImageLinks.accommodation_id).in_(accommodation_ids))
            .order_by(col(AccommodationImageLinks.sort_order))
        ).all()

        grouped: dict[uuid.UUID, list[AccommodationImages]] = {
            acc_id: [] for acc_id in accommodation_ids
        }
        for image, accommodation_id in rows:
            grouped.setdefault(accommodation_id, []).append(image)
        return grouped

    def popup_min_stay(self, session: Session, popup_id: uuid.UUID) -> int | None:
        """The popup-wide minimum stay a room type falls back to."""
        from app.api.popup.models import Popups

        popup = session.get(Popups, popup_id)
        return popup.accommodation_min_stay if popup else None

    # -- bulk ---------------------------------------------------------------

    def resolve_targets(
        self,
        session: Session,
        *,
        ids: list[uuid.UUID] | None,
        bulk_filter: AccommodationBulkFilter | None,
    ) -> list[Accommodations]:
        """Turn an ``ids`` list or a ``filter`` block into actual rows.

        Both bulk endpoints accept either form; a filter is what makes
        "re-price this whole property" a single call.
        """
        statement = select(Accommodations).where(
            col(Accommodations.deleted_at).is_(None)
        )
        if ids:
            statement = statement.where(col(Accommodations.id).in_(ids))
        elif bulk_filter is not None:
            statement = statement.where(Accommodations.popup_id == bulk_filter.popup_id)
            if bulk_filter.property_id:
                statement = statement.where(
                    Accommodations.property_id == bulk_filter.property_id
                )
            if bulk_filter.kind:
                statement = statement.where(Accommodations.kind == bulk_filter.kind)
            if bulk_filter.is_active is not None:
                statement = statement.where(
                    col(Accommodations.is_active).is_(bulk_filter.is_active)
                )
        else:
            return []

        return list(session.exec(statement).all())

    def bulk_update(
        self,
        session: Session,
        targets: list[Accommodations],
        patch: AccommodationUpdate,
    ) -> int:
        """Apply one patch to many room types, syncing every shadow product."""
        update_data = patch.model_dump(exclude_unset=True, exclude={"image_ids"})
        if "beds" in update_data and patch.beds is not None:
            update_data["beds"] = [bed.model_dump(mode="json") for bed in patch.beds]

        for accommodation in targets:
            for field, value in update_data.items():
                setattr(accommodation, field, value)
            accommodation.updated_at = _utcnow()
            session.add(accommodation)
            self.sync_shadow_product(session, accommodation)

        session.commit()
        return len(targets)

    def bulk_price(
        self,
        session: Session,
        targets: list[Accommodations],
        payload: AccommodationBulkPrice,
    ) -> int:
        """Move prices for many room types.

        Without a date range this rewrites ``default_nightly_price``. With
        one it writes a date-range rule per room type, the only way to
        express "+20% in high season" without touching the base price.
        """
        for accommodation in targets:
            base = Decimal(accommodation.default_nightly_price)
            if payload.mode is BulkPriceMode.SET:
                new_price = Decimal(payload.value)
            else:
                new_price = (
                    base * (Decimal("100") + Decimal(payload.value)) / Decimal("100")
                )
            new_price = max(
                Decimal("0"),
                new_price.quantize(Decimal("0.01"), rounding=ROUND_HALF_UP),
            )

            if payload.start_date is None or payload.end_date is None:
                accommodation.default_nightly_price = new_price
                accommodation.updated_at = _utcnow()
                session.add(accommodation)
                self.sync_shadow_product(session, accommodation)
                continue

            # Replace an identical window rather than stacking duplicates:
            # running the same bulk twice should be idempotent.
            existing = session.exec(
                select(AccommodationPriceRules).where(
                    AccommodationPriceRules.accommodation_id == accommodation.id,
                    AccommodationPriceRules.start_date == payload.start_date,
                    AccommodationPriceRules.end_date == payload.end_date,
                    AccommodationPriceRules.priority == payload.priority,
                )
            ).first()
            if existing is not None:
                existing.nightly_price = new_price
                existing.label = payload.label or existing.label
                existing.updated_at = _utcnow()
                session.add(existing)
            else:
                session.add(
                    AccommodationPriceRules(
                        tenant_id=accommodation.tenant_id,
                        popup_id=accommodation.popup_id,
                        accommodation_id=accommodation.id,
                        label=payload.label,
                        start_date=payload.start_date,
                        end_date=payload.end_date,
                        nightly_price=new_price,
                        priority=payload.priority,
                    )
                )

        session.commit()
        return len(targets)

    def duplicate(
        self,
        session: Session,
        source: Accommodations,
        payload: AccommodationDuplicate,
    ) -> Accommodations:
        """Clone a room type. Bookings are never copied, only the definition."""
        copy = Accommodations(
            tenant_id=source.tenant_id,
            popup_id=source.popup_id,
            property_id=source.property_id,
            name=payload.name or f"{source.name} (copy)",
            kind=source.kind,
            description=source.description,
            guest_capacity=source.guest_capacity,
            beds=list(source.beds or []),
            default_nightly_price=source.default_nightly_price,
            long_stay_price=source.long_stay_price,
            min_stay_override=source.min_stay_override,
            bookable_from=source.bookable_from,
            bookable_to=source.bookable_to,
            visible_in_checkout=source.visible_in_checkout,
            is_active=source.is_active,
            sort_order=source.sort_order,
        )
        session.add(copy)
        session.flush()

        if payload.copy_units:
            source_units = session.exec(
                select(AccommodationUnits)
                .where(AccommodationUnits.accommodation_id == source.id)
                .order_by(col(AccommodationUnits.sort_order))
            ).all()
            labels = [unit.label for unit in source_units]
            if payload.units_count is not None:
                labels = [
                    f"{copy.name} {index}"
                    for index in range(1, payload.units_count + 1)
                ]
            for position, label in enumerate(labels):
                session.add(
                    AccommodationUnits(
                        tenant_id=copy.tenant_id,
                        popup_id=copy.popup_id,
                        accommodation_id=copy.id,
                        label=label,
                        sort_order=position,
                    )
                )
        elif payload.units_count:
            for index in range(1, payload.units_count + 1):
                session.add(
                    AccommodationUnits(
                        tenant_id=copy.tenant_id,
                        popup_id=copy.popup_id,
                        accommodation_id=copy.id,
                        label=f"{copy.name} {index}",
                        sort_order=index - 1,
                    )
                )

        if payload.copy_price_rules:
            for rule in session.exec(
                select(AccommodationPriceRules).where(
                    AccommodationPriceRules.accommodation_id == source.id
                )
            ).all():
                session.add(
                    AccommodationPriceRules(
                        tenant_id=copy.tenant_id,
                        popup_id=copy.popup_id,
                        accommodation_id=copy.id,
                        label=rule.label,
                        start_date=rule.start_date,
                        end_date=rule.end_date,
                        nightly_price=rule.nightly_price,
                        priority=rule.priority,
                    )
                )

        if payload.copy_images:
            for link in session.exec(
                select(AccommodationImageLinks).where(
                    AccommodationImageLinks.accommodation_id == source.id
                )
            ).all():
                session.add(
                    AccommodationImageLinks(
                        accommodation_id=copy.id,
                        image_id=link.image_id,
                        tenant_id=copy.tenant_id,
                        sort_order=link.sort_order,
                    )
                )
            session.flush()

        self.sync_shadow_product(session, copy)
        session.commit()
        session.refresh(copy)
        return copy


# ---------------------------------------------------------------------------
# Units
# ---------------------------------------------------------------------------


class AccommodationUnitsCRUD(
    BaseCRUD[AccommodationUnits, AccommodationUnitCreate, AccommodationUnitUpdate]
):
    def __init__(self) -> None:
        super().__init__(AccommodationUnits)

    def _next_sort_order(self, session: Session, accommodation_id: uuid.UUID) -> int:
        current = session.exec(
            select(func.max(AccommodationUnits.sort_order)).where(
                AccommodationUnits.accommodation_id == accommodation_id
            )
        ).one()
        return (current or 0) + 1

    def bulk_create(
        self,
        session: Session,
        accommodation: Accommodations,
        obj_in: AccommodationUnitBulkCreate,
        *,
        commit: bool = True,
    ) -> list[AccommodationUnits]:
        """Create units from explicit labels or ``prefix`` + ``count``.

        Labels that already exist for the accommodation are skipped rather
        than raising: adding "5 more rooms" twice should not fail the request
        on the ones that landed the first time.
        """
        if obj_in.labels:
            labels = [label.strip() for label in obj_in.labels if label.strip()]
        else:
            prefix = obj_in.prefix or ""
            labels = [
                f"{prefix}{index}"
                for index in range(
                    obj_in.start_at, obj_in.start_at + (obj_in.count or 0)
                )
            ]

        taken = {
            unit.label
            for unit in session.exec(
                select(AccommodationUnits).where(
                    AccommodationUnits.accommodation_id == accommodation.id
                )
            ).all()
        }

        sort_order = self._next_sort_order(session, accommodation.id)
        created: list[AccommodationUnits] = []
        for label in labels:
            if label in taken:
                continue
            unit = AccommodationUnits(
                tenant_id=accommodation.tenant_id,
                popup_id=accommodation.popup_id,
                accommodation_id=accommodation.id,
                label=label,
                sort_order=sort_order,
            )
            sort_order += 1
            taken.add(label)
            session.add(unit)
            created.append(unit)

        session.flush()
        if commit:
            session.commit()
            for unit in created:
                session.refresh(unit)
        return created

    def update(
        self,
        session: Session,
        db_obj: AccommodationUnits,
        obj_in: AccommodationUnitUpdate,
    ) -> AccommodationUnits:
        for field, value in obj_in.model_dump(exclude_unset=True).items():
            setattr(db_obj, field, value)
        db_obj.updated_at = _utcnow()
        session.add(db_obj)
        session.commit()
        session.refresh(db_obj)
        return db_obj

    def has_blocking_bookings(self, session: Session, unit_id: uuid.UUID) -> bool:
        """Whether a unit still holds a hold/confirmed booking.

        Deleting such a unit would orphan a paid stay, so callers refuse.
        """
        return (
            session.exec(
                select(AccommodationBookings.id).where(
                    AccommodationBookings.unit_id == unit_id,
                    col(AccommodationBookings.status).in_(BLOCKING_BOOKING_STATUSES),
                )
            ).first()
            is not None
        )


# ---------------------------------------------------------------------------
# Price rules
# ---------------------------------------------------------------------------


class AccommodationPriceRulesCRUD(
    BaseCRUD[
        AccommodationPriceRules,
        AccommodationPriceRuleCreate,
        AccommodationPriceRuleUpdate,
    ]
):
    def __init__(self) -> None:
        super().__init__(AccommodationPriceRules)

    def create_for_accommodation(
        self,
        session: Session,
        accommodation: Accommodations,
        obj_in: AccommodationPriceRuleCreate,
    ) -> AccommodationPriceRules:
        rule = AccommodationPriceRules(
            **obj_in.model_dump(),
            tenant_id=accommodation.tenant_id,
            popup_id=accommodation.popup_id,
            accommodation_id=accommodation.id,
        )
        session.add(rule)
        session.commit()
        session.refresh(rule)
        return rule

    def update(
        self,
        session: Session,
        db_obj: AccommodationPriceRules,
        obj_in: AccommodationPriceRuleUpdate,
    ) -> AccommodationPriceRules:
        for field, value in obj_in.model_dump(exclude_unset=True).items():
            setattr(db_obj, field, value)
        db_obj.updated_at = _utcnow()
        session.add(db_obj)
        session.commit()
        session.refresh(db_obj)
        return db_obj

    def find_for_accommodations(
        self, session: Session, accommodation_ids: list[uuid.UUID]
    ) -> dict[uuid.UUID, list[AccommodationPriceRules]]:
        """Rules grouped by accommodation: one query for a whole quote pass."""
        if not accommodation_ids:
            return {}
        rows = session.exec(
            select(AccommodationPriceRules)
            .where(col(AccommodationPriceRules.accommodation_id).in_(accommodation_ids))
            .order_by(col(AccommodationPriceRules.start_date))
        ).all()

        grouped: dict[uuid.UUID, list[AccommodationPriceRules]] = {
            acc_id: [] for acc_id in accommodation_ids
        }
        for rule in rows:
            grouped.setdefault(rule.accommodation_id, []).append(rule)
        return grouped


# ---------------------------------------------------------------------------
# Bookings
# ---------------------------------------------------------------------------


class AccommodationBookingsCRUD(BaseCRUD[AccommodationBookings, Any, Any]):
    def __init__(self) -> None:
        super().__init__(AccommodationBookings)

    def find_in_window(
        self,
        session: Session,
        popup_id: uuid.UUID,
        date_from: date,
        date_to: date,
        *,
        property_id: uuid.UUID | None = None,
        accommodation_id: uuid.UUID | None = None,
        statuses: list[str] | None = None,
        search: str | None = None,
    ) -> list[AccommodationBookings]:
        """Bookings overlapping ``[date_from, date_to)``: the calendar query."""
        statement = select(AccommodationBookings).where(
            AccommodationBookings.popup_id == popup_id,
            col(AccommodationBookings.check_in) < date_to,
            col(AccommodationBookings.check_out) > date_from,
        )
        if statuses:
            statement = statement.where(col(AccommodationBookings.status).in_(statuses))
        else:
            statement = statement.where(
                col(AccommodationBookings.status).in_(BLOCKING_BOOKING_STATUSES)
            )
        if accommodation_id:
            statement = statement.where(
                AccommodationBookings.accommodation_id == accommodation_id
            )
        if property_id:
            statement = statement.where(
                col(AccommodationBookings.accommodation_id).in_(
                    select(Accommodations.id).where(
                        Accommodations.property_id == property_id
                    )
                )
            )
        if search:
            term = f"%{search}%"
            statement = statement.where(
                or_(
                    col(AccommodationBookings.primary_guest_name).ilike(term),
                    col(AccommodationBookings.primary_guest_email).ilike(term),
                )
            )

        statement = statement.order_by(
            col(AccommodationBookings.check_in), col(AccommodationBookings.created_at)
        )
        return list(session.exec(statement).all())

    def find_by_payment(
        self, session: Session, payment_id: uuid.UUID
    ) -> list[AccommodationBookings]:
        return list(
            session.exec(
                select(AccommodationBookings).where(
                    AccommodationBookings.payment_id == payment_id
                )
            ).all()
        )

    def expire_stale_holds(
        self, session: Session, *, now: datetime | None = None
    ) -> int:
        """Release holds whose expiry has passed.

        A safety net for holds whose payment never reached a terminal webhook;
        the normal path releases them when the payment expires.
        """
        cutoff = now or _utcnow()
        stale = session.exec(
            select(AccommodationBookings).where(
                AccommodationBookings.status == BookingStatus.HOLD,
                col(AccommodationBookings.hold_expires_at).is_not(None),
                col(AccommodationBookings.hold_expires_at) < cutoff,
            )
        ).all()

        for booking in stale:
            booking.status = BookingStatus.EXPIRED
            booking.updated_at = cutoff
            session.add(booking)

        if stale:
            session.commit()
        return len(stale)


# ---------------------------------------------------------------------------
# Image library
# ---------------------------------------------------------------------------


class AccommodationImagesCRUD(
    BaseCRUD[AccommodationImages, AccommodationImageCreate, AccommodationImageUpdate]
):
    def __init__(self) -> None:
        super().__init__(AccommodationImages)

    def create_for_tenant(
        self,
        session: Session,
        obj_in: AccommodationImageCreate,
        tenant_id: uuid.UUID,
        *,
        uploaded_by_user_id: uuid.UUID | None = None,
    ) -> AccommodationImages:
        image = AccommodationImages(
            **obj_in.model_dump(),
            tenant_id=tenant_id,
            uploaded_by_user_id=uploaded_by_user_id,
        )
        session.add(image)
        session.commit()
        session.refresh(image)
        return image

    def find_by_popup(
        self, session: Session, popup_id: uuid.UUID
    ) -> list[AccommodationImages]:
        return list(
            session.exec(
                select(AccommodationImages)
                .where(AccommodationImages.popup_id == popup_id)
                .order_by(col(AccommodationImages.created_at).desc())
            ).all()
        )

    def usage_counts(
        self, session: Session, popup_id: uuid.UUID
    ) -> dict[uuid.UUID, int]:
        """How many room types use each photo ("used in 3 rooms")."""
        rows = session.exec(
            select(
                AccommodationImageLinks.image_id,
                func.count(col(AccommodationImageLinks.accommodation_id)),
            )
            .join(
                AccommodationImages,
                col(AccommodationImages.id) == col(AccommodationImageLinks.image_id),
            )
            .where(AccommodationImages.popup_id == popup_id)
            .group_by(col(AccommodationImageLinks.image_id))
        ).all()
        return dict(rows)  # type: ignore[arg-type]


accommodation_properties_crud = AccommodationPropertiesCRUD()
accommodations_crud = AccommodationsCRUD()
accommodation_units_crud = AccommodationUnitsCRUD()
accommodation_price_rules_crud = AccommodationPriceRulesCRUD()
accommodation_bookings_crud = AccommodationBookingsCRUD()
accommodation_images_crud = AccommodationImagesCRUD()
