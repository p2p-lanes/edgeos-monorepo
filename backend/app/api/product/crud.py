import uuid
from datetime import UTC, datetime

from fastapi import HTTPException, status
from sqlalchemy import text
from sqlmodel import Session, col, select

from app.api.product.models import Products
from app.api.product.sale_window import date_to_utc_instant
from app.api.product.schemas import (
    ProductCreate,
    ProductUpdate,
)
from app.api.shared.crud import BaseCRUD

SORT_FIELDS = {"name", "price", "category", "is_active"}


def sale_dates_to_persistence(data: dict[str, object]) -> dict[str, object]:
    """Normalize sale-window inputs for ORM persistence.

    The sale window is now a precise ``datetime`` instant, so values pass
    through unchanged. A bare ``date`` (e.g. from a CSV import) is anchored to
    UTC midnight rather than bumped by a day.
    """
    if "sale_starts_at" in data:
        data["sale_starts_at"] = date_to_utc_instant(data["sale_starts_at"])
    if "sale_ends_at" in data:
        data["sale_ends_at"] = date_to_utc_instant(data["sale_ends_at"])
    return data


class ProductsCRUD(BaseCRUD[Products, ProductCreate, ProductUpdate]):
    """CRUD operations for Products."""

    def __init__(self) -> None:
        super().__init__(Products)

    def _assert_no_active_patreon(
        self, session: Session, popup_id: uuid.UUID, exclude_id: uuid.UUID | None = None
    ) -> None:
        """Raise 422 if an active (non-deleted) patreon product already exists for this popup."""
        stmt = select(Products).where(
            Products.popup_id == popup_id,
            Products.category == "patreon",
            col(Products.deleted_at).is_(None),
        )
        if exclude_id is not None:
            stmt = stmt.where(Products.id != exclude_id)
        existing = session.exec(stmt).first()
        if existing is not None:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail=(
                    "This popup already has a Patron product. "
                    "Only one Patron product is allowed per popup."
                ),
            )

    def create(self, session: Session, obj_in: ProductCreate) -> Products:
        """Create a product, converting sale window dates to UTC datetimes."""
        if obj_in.category == "patreon":
            self._assert_no_active_patreon(session, obj_in.popup_id)
        data = sale_dates_to_persistence(obj_in.model_dump())
        db_obj = Products(**data)
        session.add(db_obj)
        session.commit()
        session.refresh(db_obj)
        return db_obj

    def get(self, session: Session, id: uuid.UUID) -> Products | None:
        statement = select(Products).where(
            Products.id == id, col(Products.deleted_at).is_(None)
        )
        return session.exec(statement).first()

    def find(
        self,
        session: Session,
        skip: int = 0,
        limit: int = 100,
        search: str | None = None,
        search_fields: list[str] | None = None,
        sort_by: str | None = None,
        sort_order: str = "desc",
        **filters: object,
    ) -> tuple[list[Products], int]:
        """Override base find to always exclude soft-deleted rows."""
        from sqlalchemy import or_
        from sqlmodel import func

        statement = select(Products).where(col(Products.deleted_at).is_(None))
        for field, value in filters.items():
            if value is not None:
                statement = statement.where(getattr(Products, field) == value)

        if search and search_fields:
            search_term = f"%{search}%"
            search_conditions = [
                getattr(Products, field).ilike(search_term)
                for field in search_fields
                if hasattr(Products, field)
            ]
            if search_conditions:
                statement = statement.where(or_(*search_conditions))

        count_statement = select(func.count()).select_from(statement.subquery())
        total = session.exec(count_statement).one()

        statement = self._apply_sorting(statement, sort_by, sort_order)
        statement = statement.offset(skip).limit(limit)
        results = list(session.exec(statement).all())
        return results, total

    def get_by_slug(
        self, session: Session, slug: str, popup_id: uuid.UUID
    ) -> Products | None:
        """Get a live (non-deleted) product by slug and popup_id."""
        statement = select(Products).where(
            Products.slug == slug,
            Products.popup_id == popup_id,
            col(Products.deleted_at).is_(None),
        )
        return session.exec(statement).first()

    def generate_unique_slug(
        self, session: Session, base_slug: str, popup_id: uuid.UUID
    ) -> str:
        """Generate a unique slug within a popup by appending a numeric suffix if needed."""
        if not self.get_by_slug(session, base_slug, popup_id):
            return base_slug

        counter = 1
        while True:
            candidate = f"{base_slug}-{counter}"
            if not self.get_by_slug(session, candidate, popup_id):
                return candidate
            counter += 1

    def find_by_popup(
        self,
        session: Session,
        popup_id: uuid.UUID,
        skip: int = 0,
        limit: int = 100,
        is_active: bool | None = None,
        category: str | None = None,
        search: str | None = None,
        sort_by: str | None = None,
        sort_order: str = "desc",
    ) -> tuple[list[Products], int]:
        """Find live (non-deleted) products by popup_id with optional filters."""
        statement = select(Products).where(
            Products.popup_id == popup_id,
            col(Products.deleted_at).is_(None),
        )

        if is_active is not None:
            statement = statement.where(Products.is_active == is_active)

        if category is not None:
            statement = statement.where(Products.category == category)

        if search:
            search_term = f"%{search}%"
            statement = statement.where(col(Products.name).ilike(search_term))

        from sqlmodel import func

        count_statement = select(func.count()).select_from(statement.subquery())
        total = session.exec(count_statement).one()

        validated_sort = sort_by if sort_by in SORT_FIELDS else None
        statement = self._apply_sorting(statement, validated_sort, sort_order)

        statement = statement.offset(skip).limit(limit)
        results = list(session.exec(statement).all())

        return results, total

    def get_by_ids(
        self, session: Session, ids: list[uuid.UUID]
    ) -> dict[uuid.UUID, Products]:
        """Get multiple live (non-deleted) products by their IDs and return as a dict."""
        if not ids:
            return {}
        statement = select(Products).where(
            Products.id.in_(ids),  # type: ignore[attr-defined]
            col(Products.deleted_at).is_(None),
        )
        products = session.exec(statement).all()
        return {p.id: p for p in products}

    def soft_delete(self, session: Session, db_obj: Products) -> Products:
        """Mark a product as logically deleted. Preserves FK history."""
        db_obj.deleted_at = datetime.now(UTC)
        session.add(db_obj)
        session.commit()
        session.refresh(db_obj)
        return db_obj

    def _count_active_sales(
        self, session: Session, product_id: uuid.UUID
    ) -> int:
        """Sum quantities of units currently holding stock for this product.

        Counts payment_products rows whose payment is in a stock-holding
        status — mirrors the same set of statuses that gate decrement /
        restore (pending = reserved, approved = paid). Rejected / expired /
        cancelled payments are excluded because they release stock.
        """
        result = session.execute(
            text(
                "SELECT COALESCE(SUM(pp.quantity), 0) "
                "FROM payment_products pp "
                "JOIN payments p ON p.id = pp.payment_id "
                "WHERE pp.product_id = :pid "
                "AND p.status IN ('pending', 'approved')"
            ).bindparams(pid=product_id)
        ).scalar()
        return int(result or 0)

    def update(
        self,
        session: Session,
        db_obj: Products,
        obj_in: ProductUpdate,
    ) -> Products:
        """Update product fields.

        When `total_stock_cap` changes without an explicit `total_stock_remaining`,
        recompute remaining so that the existing sold count is preserved. Two
        cases:

        1. `old_cap` and `old_remaining` are both tracked → derive sold from the
           counter (`old_cap - old_remaining`).
        2. Either was NULL (product was unlimited, or never seeded) → count real
           sales from `payment_products` to avoid losing prior sales when a cap
           is added after the fact.

        Without this, the CHECK constraint `total_stock_remaining <= total_stock_cap`
        rejects cap reductions, and (worse) sales made while the product was
        unlimited get silently dropped when the cap is added later.
        """
        update_data = sale_dates_to_persistence(obj_in.model_dump(exclude_unset=True))

        # Singleton guard: reject if category is being changed TO patreon and
        # another non-deleted patreon product already exists for this popup.
        new_category = update_data.get("category")
        if new_category == "patreon" and db_obj.category != "patreon":
            self._assert_no_active_patreon(
                session, db_obj.popup_id, exclude_id=db_obj.id
            )

        if (
            "total_stock_cap" in update_data
            and "total_stock_remaining" not in update_data
        ):
            new_cap = update_data["total_stock_cap"]
            old_cap = db_obj.total_stock_cap
            old_remaining = db_obj.total_stock_remaining
            if new_cap is None:
                update_data["total_stock_remaining"] = None
            elif old_cap is None or old_remaining is None:
                # Product was unlimited (or never seeded) — any prior sales
                # weren't tracked in the counter. Pull sold from payment_products
                # so we don't silently grant extra inventory.
                sold = self._count_active_sales(session, db_obj.id)
                update_data["total_stock_remaining"] = max(0, new_cap - sold)
            else:
                sold = old_cap - old_remaining
                update_data["total_stock_remaining"] = max(0, new_cap - sold)

        for field, value in update_data.items():
            setattr(db_obj, field, value)

        session.add(db_obj)
        session.commit()
        session.refresh(db_obj)
        return db_obj

    def decrement_total_stock(
        self,
        session: Session,
        product_id: uuid.UUID,
        quantity: int = 1,
    ) -> Products:
        """Atomically decrement total_stock_remaining by quantity.

        Single UPDATE ... WHERE remaining >= :n RETURNING — race-free under
        PostgreSQL MVCC. Caller owns the transaction; this method does
        NOT commit, so it can participate in a larger purchase transaction
        that rolls back on failure.

        Behavior matrix:
          - Product not found              → HTTP 404
          - total_stock_remaining IS NULL  → no-op, returns product unchanged (unlimited)
          - remaining < quantity           → HTTP 409 "Sold out"
          - success                        → returns refreshed product

        Why SELECT-then-UPDATE?
        A single UPDATE ... WHERE remaining >= :qty cannot distinguish
        "NULL means unlimited, do nothing" from "cap is 0, sold out" because
        PostgreSQL evaluates NULL >= :qty as UNKNOWN → row excluded.
        The explicit NULL fast-path check is therefore required.
        """
        # Fast path: no decrement needed for unlimited products.
        product = session.get(Products, product_id)
        if product is None:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Product not found",
            )
        if product.total_stock_remaining is None:
            return product  # unlimited — no counter to move

        result = session.exec(  # type: ignore[call-overload]
            text(
                "UPDATE products "
                "SET total_stock_remaining = total_stock_remaining - :qty "
                "WHERE id = :id AND total_stock_remaining >= :qty "
                "RETURNING total_stock_remaining"
            ).bindparams(qty=quantity, id=product_id)
        ).first()

        if result is None:
            # Re-read to discriminate: deleted? unlocked to NULL? sold out?
            session.expire(product)
            product = session.get(Products, product_id)
            if product is None:
                raise HTTPException(
                    status_code=status.HTTP_404_NOT_FOUND,
                    detail="Product not found",
                )
            if product.total_stock_remaining is None:
                # Race: someone cleared the cap between our SELECT and UPDATE.
                # Treat as unlimited.
                return product
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail=f"Sold out — '{product.name}' has insufficient stock",
            )

        session.flush()
        session.refresh(product)
        return product

    def restore_total_stock(
        self,
        session: Session,
        product_id: uuid.UUID,
        quantity: int,
    ) -> None:
        """Restore total_stock_remaining after expiry/cancel.

        Clamped to total_stock_cap via LEAST to prevent drift past the original
        cap when webhooks fire more than once. Silent no-op for unlimited products
        (cap IS NULL or remaining IS NULL).

        Caller owns the transaction; this method does NOT commit.
        Idempotency contract: must only be called after the payment status guard
        confirms the transition is valid (see design §4). Does NOT check payment
        status itself.
        """
        session.exec(  # type: ignore[call-overload]
            text(
                "UPDATE products "
                "SET total_stock_remaining = LEAST(total_stock_cap, total_stock_remaining + :qty) "
                "WHERE id = :id "
                "  AND total_stock_remaining IS NOT NULL "
                "  AND total_stock_cap IS NOT NULL"
            ).bindparams(qty=quantity, id=product_id)
        )
        session.flush()


products_crud = ProductsCRUD()
