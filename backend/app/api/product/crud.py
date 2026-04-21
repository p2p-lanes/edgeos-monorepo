import uuid
from datetime import UTC, datetime

from fastapi import HTTPException, status
from sqlalchemy import text
from sqlmodel import Session, col, select

from app.api.product.models import Products, TicketTierGroup, TicketTierPhase
from app.api.product.schemas import (
    ProductCreate,
    ProductUpdate,
    TierGroupCreate,
    TierGroupUpdate,
    TierPhaseCreate,
    TierPhaseUpdate,
)
from app.api.shared.crud import BaseCRUD

SORT_FIELDS = {"name", "price", "attendee_category", "is_active"}


class ProductsCRUD(BaseCRUD[Products, ProductCreate, ProductUpdate]):
    """CRUD operations for Products."""

    def __init__(self) -> None:
        super().__init__(Products)

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


products_crud = ProductsCRUD()


# ---------------------------------------------------------------------------
# Tier Group CRUD
# ---------------------------------------------------------------------------


class TierGroupsCRUD(BaseCRUD[TicketTierGroup, TierGroupCreate, TierGroupUpdate]):
    """CRUD operations for TicketTierGroup."""

    def __init__(self) -> None:
        super().__init__(TicketTierGroup)

    def find_by_popup(
        self,
        session: Session,
        popup_id: uuid.UUID,
    ) -> list[TicketTierGroup]:
        """Return all tier groups whose phases include at least one product from this popup.

        Because TicketTierGroup is tenant-scoped (not popup-scoped), we expose a
        popup-filtered view by joining through TicketTierPhase → Products.popup_id.
        """
        from sqlmodel import func as _func  # noqa: F401

        stmt = (
            select(TicketTierGroup)
            .join(
                TicketTierPhase,
                TicketTierPhase.group_id == TicketTierGroup.id,
                isouter=True,
            )
            .join(
                Products,
                Products.id == TicketTierPhase.product_id,
                isouter=True,
            )
            .where(Products.popup_id == popup_id)
            .distinct()
        )
        return list(session.exec(stmt).all())

    def create_for_tenant(
        self,
        session: Session,
        obj_in: TierGroupCreate,
        tenant_id: uuid.UUID,
    ) -> TicketTierGroup:
        """Create a tier group scoped to the given tenant."""
        group = TicketTierGroup(
            tenant_id=tenant_id,
            name=obj_in.name,
            shared_stock_cap=obj_in.shared_stock_cap,
            shared_stock_remaining=obj_in.shared_stock_cap,  # initialise remaining = cap
        )
        session.add(group)
        session.commit()
        session.refresh(group)
        return group

    def decrement_shared_stock(
        self,
        session: Session,
        group_id: uuid.UUID,
        quantity: int = 1,
    ) -> TicketTierGroup:
        """Atomically decrement shared_stock_remaining by quantity.

        Uses a single UPDATE ... WHERE shared_stock_remaining >= :n RETURNING
        statement — race-free under PostgreSQL MVCC (SI-3). The caller owns
        the transaction; this method does NOT commit, so it can participate
        in a larger purchase transaction that rolls back on failure.

        Raises HTTP 404 if the group does not exist, or 409 if the group has
        no shared cap or the counter would go below zero.
        """
        result = session.exec(  # type: ignore[call-overload]
            text(
                "UPDATE ticket_tier_group "
                "SET shared_stock_remaining = shared_stock_remaining - :qty "
                "WHERE id = :id AND shared_stock_remaining >= :qty "
                "RETURNING shared_stock_remaining"
            ).bindparams(qty=quantity, id=group_id)
        ).first()

        if result is None:
            group = session.get(TicketTierGroup, group_id)
            if group is None:
                raise HTTPException(
                    status_code=status.HTTP_404_NOT_FOUND,
                    detail="Tier group not found",
                )
            if group.shared_stock_remaining is None:
                raise HTTPException(
                    status_code=status.HTTP_409_CONFLICT,
                    detail="This tier group does not use a shared stock cap",
                )
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="Sold out — shared stock cap reached",
            )

        session.flush()
        group = session.get(TicketTierGroup, group_id)
        if group is not None:
            session.refresh(group)
        return group  # type: ignore[return-value]


tier_groups_crud = TierGroupsCRUD()


# ---------------------------------------------------------------------------
# Tier Phase CRUD
# ---------------------------------------------------------------------------


class TierPhasesCRUD(BaseCRUD[TicketTierPhase, TierPhaseCreate, TierPhaseUpdate]):
    """CRUD operations for TicketTierPhase."""

    def __init__(self) -> None:
        super().__init__(TicketTierPhase)

    def _rebalance_order(self, session: Session, group_id: uuid.UUID) -> None:
        """Recompute `order` for every phase in the group based on
        `sale_starts_at ASC NULLS LAST` with `id ASC` as a deterministic tiebreak.

        Runs as a two-step update so the UNIQUE(group_id, order) constraint
        is never violated mid-statement: step 1 parks every row at a negative
        order (out of the positive range used by real data), step 2 assigns
        the final 1..N ordering.
        """
        session.exec(  # type: ignore[call-overload]
            text(
                """
                UPDATE ticket_tier_phase AS p
                SET "order" = -ranked.new_order
                FROM (
                    SELECT id,
                           ROW_NUMBER() OVER (
                               ORDER BY sale_starts_at ASC NULLS LAST, id ASC
                           ) AS new_order
                    FROM ticket_tier_phase
                    WHERE group_id = :group_id
                ) AS ranked
                WHERE p.id = ranked.id
                """
            ).bindparams(group_id=group_id)
        )
        session.exec(  # type: ignore[call-overload]
            text(
                """
                UPDATE ticket_tier_phase
                SET "order" = -"order"
                WHERE group_id = :group_id AND "order" < 0
                """
            ).bindparams(group_id=group_id)
        )
        session.flush()

    def _next_placeholder_order(
        self, session: Session, group_id: uuid.UUID
    ) -> int:
        """Return MAX(order)+1 for a group, used as a temporary value during
        insert. `_rebalance_order` overwrites it right after."""
        row = session.exec(  # type: ignore[call-overload]
            text(
                "SELECT COALESCE(MAX(\"order\"), 0) + 1 AS next_order "
                "FROM ticket_tier_phase WHERE group_id = :group_id"
            ).bindparams(group_id=group_id)
        ).first()
        if row is None:
            return 1
        return int(row[0])

    def create_for_group(
        self,
        session: Session,
        obj_in: TierPhaseCreate,
    ) -> TicketTierPhase:
        """Create a phase row with an automatic `order`.

        A placeholder order (max+1) is used during insert to respect the
        (group_id, order) UNIQUE constraint; `_rebalance_order` then
        assigns the final ordering based on `sale_starts_at` ASC NULLS LAST.
        """
        assert obj_in.group_id is not None, "group_id must be injected by the router"
        placeholder_order = self._next_placeholder_order(session, obj_in.group_id)
        phase = TicketTierPhase(
            group_id=obj_in.group_id,
            product_id=obj_in.product_id,
            order=placeholder_order,
            label=obj_in.label,
            sale_starts_at=obj_in.sale_starts_at,
            sale_ends_at=obj_in.sale_ends_at,
        )
        session.add(phase)
        session.flush()
        self._rebalance_order(session, obj_in.group_id)
        session.commit()
        session.refresh(phase)
        return phase

    def update(
        self,
        session: Session,
        db_obj: TicketTierPhase,
        obj_in: TierPhaseUpdate,
    ) -> TicketTierPhase:
        """Update phase fields and rebalance order if `sale_starts_at` changed."""
        data = obj_in.model_dump(exclude_unset=True)
        sale_starts_changed = (
            "sale_starts_at" in data and data["sale_starts_at"] != db_obj.sale_starts_at
        )
        for key, value in data.items():
            setattr(db_obj, key, value)
        session.add(db_obj)
        session.flush()
        if sale_starts_changed:
            self._rebalance_order(session, db_obj.group_id)
        session.commit()
        session.refresh(db_obj)
        return db_obj

    def get_by_product(
        self, session: Session, product_id: uuid.UUID
    ) -> TicketTierPhase | None:
        """Return the phase row for a given product, or None."""
        return session.exec(
            select(TicketTierPhase).where(TicketTierPhase.product_id == product_id)
        ).first()

    def get_sold_count(self, session: Session, phase_id: uuid.UUID) -> int:
        """Count approved+pending PaymentProducts for the product linked to this phase.

        Note: we join through the phase's product_id — so sold is per-product.
        """
        from app.api.payment.models import PaymentProducts, Payments
        from app.api.payment.schemas import PaymentStatus

        phase = session.get(TicketTierPhase, phase_id)
        if phase is None:
            return 0

        from sqlmodel import func

        stmt = (
            select(func.coalesce(func.sum(PaymentProducts.quantity), 0))
            .join(Payments, PaymentProducts.payment_id == Payments.id)
            .where(
                PaymentProducts.product_id == phase.product_id,
                Payments.status.in_(  # type: ignore[attr-defined]
                    [PaymentStatus.APPROVED.value, PaymentStatus.PENDING.value]
                ),
            )
        )
        result = session.exec(stmt).one()
        return int(result)


tier_phases_crud = TierPhasesCRUD()


# ---------------------------------------------------------------------------
# Enrichment helpers
# ---------------------------------------------------------------------------


def enrich_product_with_tier(
    session: Session,
    product: Products,
) -> dict:
    """Return a dict with tier_group and phase keys populated from progression service.

    Called from the router when tier_progression_enabled=True on the popup.
    Returns {"tier_group": None, "phase": None} for ungrouped products (BC-2).
    """
    from datetime import datetime

    from app.api.product.tier_progression import derive_phase_states

    phase_row = tier_phases_crud.get_by_product(session, product.id)
    if phase_row is None:
        return {"tier_group": None, "phase": None}

    group = session.get(TicketTierGroup, phase_row.group_id)
    if group is None:
        return {"tier_group": None, "phase": None}

    # Collect sold counts for all phases in the group
    all_phases = list(
        session.exec(
            select(TicketTierPhase).where(TicketTierPhase.group_id == group.id)
        ).all()
    )
    sold_counts: dict[uuid.UUID, int] = {
        p.id: tier_phases_crud.get_sold_count(session, p.id) for p in all_phases
    }

    # Resolve max_quantity per phase via the linked product (avoids relationship load)
    product_ids_for_phases = [p.product_id for p in all_phases]
    products_map = products_crud.get_by_ids(session, product_ids_for_phases)
    max_quantities: dict[uuid.UUID, int | None] = {
        p.id: products_map[p.product_id].max_quantity
        if p.product_id in products_map
        else None
        for p in all_phases
    }

    now = datetime.now(UTC)
    phase_results = derive_phase_states(
        group,
        all_phases,
        now=now,
        sold_counts=sold_counts,
        max_quantities=max_quantities,
    )

    # Find result for this product's phase
    this_result = next((r for r in phase_results if r.id == phase_row.id), None)
    if this_result is None:
        return {"tier_group": None, "phase": None}

    # Build tier_group dict (phases sorted by order, each with derived state)
    sorted_phases = sorted(all_phases, key=lambda p: p.order)
    result_by_id = {r.id: r for r in phase_results}

    phases_public = []
    for ph in sorted_phases:
        r = result_by_id.get(ph.id)
        if r is None:
            continue
        phases_public.append(
            {
                "id": str(ph.id),
                "group_id": str(ph.group_id),
                "product_id": str(ph.product_id),
                "order": ph.order,
                "label": ph.label,
                "sale_starts_at": ph.sale_starts_at.isoformat()
                if ph.sale_starts_at
                else None,
                "sale_ends_at": ph.sale_ends_at.isoformat()
                if ph.sale_ends_at
                else None,
                "sales_state": r.sales_state,
                "is_purchasable": r.is_purchasable,
                "remaining": r.remaining,
            }
        )

    tier_group_dict = {
        "id": str(group.id),
        "tenant_id": str(group.tenant_id),
        "name": group.name,
        "shared_stock_cap": group.shared_stock_cap,
        "shared_stock_remaining": group.shared_stock_remaining,
        "phases": phases_public,
    }

    this_phase_dict = next(
        (p for p in phases_public if p["id"] == str(phase_row.id)), None
    )

    return {"tier_group": tier_group_dict, "phase": this_phase_dict}
