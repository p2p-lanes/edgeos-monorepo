import uuid
from datetime import UTC, datetime
from typing import TYPE_CHECKING

from fastapi import HTTPException, status
from sqlalchemy import or_, update
from sqlmodel import Session, col, select

from app.api.coupon.models import Coupons
from app.api.coupon.schemas import CouponCreate, CouponUpdate
from app.api.shared.crud import BaseCRUD

if TYPE_CHECKING:
    from app.api.coupon.schemas import CouponValidatePublicResponse

# Uniform error message for all invalid/expired/unknown coupon states on the
# public endpoint — NEVER differentiate between states (prevents enumeration).
_PUBLIC_COUPON_ERROR = "Invalid or expired coupon"


class CouponsCRUD(BaseCRUD[Coupons, CouponCreate, CouponUpdate]):
    """CRUD operations for Coupons."""

    def __init__(self) -> None:
        super().__init__(Coupons)

    def validate_public(
        self,
        session: Session,
        popup_slug: str,
        code: str,
        tenant_id: uuid.UUID,
        flow_slug: str | None = None,
    ) -> "CouponValidatePublicResponse":
        """Validate a coupon code for an anonymous (public) checkout request.

        Rules:
        - Resolves popup by (slug, tenant_id); unknown popup -> uniform 400
          (never reveals popup existence).
        - Resolves the sales flow (default flow when `flow_slug` is omitted)
          through the same `resolve_flow` contract every other checkout
          surface uses (sdd/sales-flows slice 9/11 — coherent gate order):
          unknown `flow_slug`, inactive popup/flow, a flow whose type is
          neither `direct` nor `upsale`, or a popup missing its default flow
          all raise internally (404/403/500) but are caught here and
          collapsed to the uniform 400 below. This replaces the old raw
          `popup.sale_type != "direct"` check with a flow-level gate (a
          popup can now have flows of mixed type), without leaking flow
          state to an anonymous caller.
        - `allows_coupons` is read from the resolved flow, which owns it
          since sdd/sales-flows-rediseno slice 7.
        - The code is looked up within that flow: a coupon belongs to one
          flow, so the same word can mean a different discount in another.
        - ANY failure state (not found, inactive, expired, maxed-out) raises 400
          with the UNIFORM message "Invalid or expired coupon" — never differentiates.
        - On success, returns CouponValidatePublicResponse.
        """
        from app.api.coupon.schemas import CouponValidatePublicResponse
        from app.api.popup.models import Popups
        from app.api.sales_flow.resolver import build_effective_config, resolve_flow
        from app.api.sales_flow.schemas import SalesFlowType

        popup = session.exec(
            select(Popups).where(
                Popups.slug == popup_slug,
                Popups.tenant_id == tenant_id,
            )
        ).first()

        if popup is None:
            # Unknown popup — return uniform coupon error (don't reveal popup existence)
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=_PUBLIC_COUPON_ERROR,
            )

        # sdd/sales-flows slice 12 note (disclosed asymmetry, no design
        # instruction to change it): unlike the checkout runtime and
        # purchase endpoints, this resolver call is deliberately NOT
        # followed by `assert_upsale_eligible`. Coupon validation is a
        # metadata lookup (does this code exist and what discount does it
        # give) — it never creates a payment, reveals attendee/purchase
        # data, or grants access to the flow itself. An anonymous caller
        # validating a coupon against an upsale-type flow learns nothing
        # they couldn't learn by inspecting the discount on any other flow;
        # the actual eligibility gate still applies at purchase time
        # (`create_open_ticketing_payment` / `create_payment`), which is the
        # only place a coupon's discount can turn into money moving.
        try:
            flow = resolve_flow(
                session,
                popup,
                flow_slug,
                require_types={SalesFlowType.direct, SalesFlowType.upsale},
            )
        except HTTPException as exc:
            # Every resolver failure (unknown slug, inactive, wrong type,
            # missing default flow) collapses to the same uniform error —
            # an anonymous caller must not be able to distinguish flow
            # states from the coupon states below.
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=_PUBLIC_COUPON_ERROR,
            ) from exc

        effective = build_effective_config(flow, popup)
        if not effective.allows_coupons:
            # Uniform error — don't reveal that coupons exist but are disabled
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=_PUBLIC_COUPON_ERROR,
            )

        # Attempt coupon lookup — any failure → uniform 400. Scoped to the
        # resolved flow: a code written for one flow was never meant to be
        # spent in another (sdd/sales-flows-rediseno).
        coupon = self.get_by_code(session, code, flow.id)
        if coupon is None:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=_PUBLIC_COUPON_ERROR,
            )

        if not coupon.is_active:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=_PUBLIC_COUPON_ERROR,
            )

        now = datetime.now(UTC)

        if coupon.start_date and now < coupon.start_date:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=_PUBLIC_COUPON_ERROR,
            )

        if coupon.end_date and now > coupon.end_date:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=_PUBLIC_COUPON_ERROR,
            )

        if coupon.max_uses is not None and coupon.current_uses >= coupon.max_uses:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=_PUBLIC_COUPON_ERROR,
            )

        return CouponValidatePublicResponse(
            code=coupon.code,
            discount_type="percent",
            discount_value=str(coupon.discount_value),
            valid=True,
        )

    def get_by_code(
        self, session: Session, code: str, flow_id: uuid.UUID
    ) -> Coupons | None:
        """Get a coupon by code within one flow.

        Keyed on the flow rather than the popup: the same word can mean a
        different discount in two flows, and a coupon written for one of
        them was never meant to be spent in the other.
        """
        statement = select(Coupons).where(
            Coupons.code == code.upper(), Coupons.sales_flow_id == flow_id
        )
        return session.exec(statement).first()

    def validate_coupon(
        self,
        session: Session,
        code: str,
        popup_id: uuid.UUID,
        flow_id: uuid.UUID,
    ) -> Coupons:
        """Validate a coupon code within one flow and return it if valid.

        `flow_id` is required (sdd/sales-flows-rediseno). It used to be
        optional and every caller omitted it, so `allows_coupons` was
        answered against the popup's default flow however the buyer had
        actually arrived — a flow with coupons switched off still took them.
        A flow that does not belong to `popup_id` is refused rather than
        degraded to the popup's own value.

        Raises:
            HTTPException: If coupons are disabled for the flow, or the
            coupon is invalid, expired, or maxed out.
        """
        from app.api.sales_flow.crud import sales_flows_crud
        from app.api.sales_flow.resolver import build_effective_config

        flow = sales_flows_crud.get(session, flow_id)
        if flow is None or flow.popup_id != popup_id:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Sales flow not found for this popup",
            )

        if not build_effective_config(flow).allows_coupons:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Coupons are not enabled for this event",
            )

        coupon = self.get_by_code(session, code, flow_id)

        if not coupon:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Coupon code not found",
            )

        if not coupon.is_active:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Coupon code is not active",
            )

        now = datetime.now(UTC)

        if coupon.start_date and now < coupon.start_date:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Coupon code is not yet valid",
            )

        if coupon.end_date and now > coupon.end_date:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Coupon code has expired",
            )

        if coupon.max_uses is not None and coupon.current_uses >= coupon.max_uses:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Coupon code has reached maximum uses",
            )

        return coupon

    def use_coupon(self, session: Session, coupon_id: uuid.UUID) -> Coupons:
        """Atomically redeem a coupon, enforcing ``max_uses`` under concurrency.

        Increments ``current_uses`` in a single conditional ``UPDATE`` guarded
        by ``current_uses < max_uses``. The previous read-modify-write let two
        concurrent checkouts both pass the earlier ``validate_coupon`` check and
        both redeem a single-use coupon (and lost-update the counter). With the
        conditional update, the row lock serialises the two writers and the
        second one matches zero rows once the cap is reached.

        Commits on success, mirroring the original behaviour: this releases the
        coupon row lock immediately rather than holding it across the SimpleFI
        network call that follows in some checkout flows (e.g. open-ticketing),
        which would otherwise serialise every concurrent redemption of the same
        code behind a multi-second provider request. On the exhausted/missing
        path it raises WITHOUT committing, so any half-built payment flushed by
        the caller is discarded on transaction teardown rather than persisted.

        Raises 400 when the coupon is already exhausted, 404 when it is gone.
        """
        result = session.exec(
            update(Coupons)
            .where(
                Coupons.id == coupon_id,
                or_(
                    col(Coupons.max_uses).is_(None),
                    col(Coupons.current_uses) < col(Coupons.max_uses),
                ),
            )
            .values(current_uses=col(Coupons.current_uses) + 1)
        )

        if result.rowcount == 0:
            # No commit: leave the caller's transaction untouched so it can roll
            # back cleanly when the redemption is rejected.
            coupon = self.get(session, coupon_id)
            if not coupon:
                raise HTTPException(
                    status_code=status.HTTP_404_NOT_FOUND,
                    detail="Coupon not found",
                )
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Coupon code has reached maximum uses",
            )

        session.commit()
        coupon = self.get(session, coupon_id)
        if coupon is not None:
            # The increment was a Core UPDATE; sync the ORM instance so callers
            # see the new current_uses.
            session.refresh(coupon)
        return coupon

    def release_use(self, session: Session, coupon_id: uuid.UUID) -> None:
        """Release a previously-claimed coupon use, clamped at zero.

        Mirrors stock restoration: a coupon use is held at payment creation and
        returned when the payment moves to a terminal non-approved state
        (expired/cancelled/rejected). Does NOT commit — the caller's transaction
        commits alongside the payment status change. The zero clamp is a
        structural backstop against double-release drift below zero; the caller
        guards semantic double-release via the PENDING-only status check.
        """
        coupon = self.get(session, coupon_id)
        if not coupon:
            return

        coupon.current_uses = max(coupon.current_uses - 1, 0)
        session.add(coupon)

    def find_by_popup(
        self,
        session: Session,
        popup_id: uuid.UUID,
        skip: int = 0,
        limit: int = 100,
        is_active: bool | None = None,
        search: str | None = None,
    ) -> tuple[list[Coupons], int]:
        """Find coupons by popup_id with optional filters."""
        statement = select(Coupons).where(Coupons.popup_id == popup_id)

        if is_active is not None:
            statement = statement.where(Coupons.is_active == is_active)

        # Apply text search if provided
        if search:
            search_term = f"%{search}%"
            statement = statement.where(col(Coupons.code).ilike(search_term))

        # Get total count
        from sqlmodel import func

        count_statement = select(func.count()).select_from(statement.subquery())
        total = session.exec(count_statement).one()

        # Apply pagination
        statement = statement.offset(skip).limit(limit)
        results = list(session.exec(statement).all())

        return results, total


coupons_crud = CouponsCRUD()
