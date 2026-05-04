import uuid
from datetime import UTC, datetime
from typing import TYPE_CHECKING

from fastapi import HTTPException, status
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
    ) -> "CouponValidatePublicResponse":
        """Validate a coupon code for an anonymous (public) checkout request.

        Rules:
        - Resolves popup by slug; popup must have sale_type="direct" (else 403).
        - ANY failure state (not found, inactive, expired, maxed-out) raises 400
          with the UNIFORM message "Invalid or expired coupon" — never differentiates.
        - On success, returns CouponValidatePublicResponse.
        """
        from app.api.coupon.schemas import CouponValidatePublicResponse
        from app.api.popup.models import Popups
        from app.api.shared.enums import SaleType

        popup = session.exec(select(Popups).where(Popups.slug == popup_slug)).first()

        if popup is None:
            # Unknown popup — return uniform coupon error (don't reveal popup existence)
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=_PUBLIC_COUPON_ERROR,
            )

        if popup.sale_type != SaleType.direct.value:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="This endpoint is only available for direct-sale popups",
            )

        # Attempt coupon lookup — any failure → uniform 400
        coupon = self.get_by_code(session, code, popup.id)
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
        self, session: Session, code: str, popup_id: uuid.UUID
    ) -> Coupons | None:
        """Get a coupon by code and popup_id."""
        statement = select(Coupons).where(
            Coupons.code == code.upper(), Coupons.popup_id == popup_id
        )
        return session.exec(statement).first()

    def validate_coupon(
        self, session: Session, code: str, popup_id: uuid.UUID
    ) -> Coupons:
        """
        Validate a coupon code and return it if valid.

        Raises:
            HTTPException: If coupon is invalid, expired, or maxed out.
        """
        coupon = self.get_by_code(session, code, popup_id)

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
        """Increment the usage count of a coupon."""
        coupon = self.get(session, coupon_id)
        if not coupon:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Coupon not found",
            )

        coupon.current_uses += 1
        session.add(coupon)
        session.commit()
        session.refresh(coupon)
        return coupon

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
