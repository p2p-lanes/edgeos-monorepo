"""Referral CRUD operations.

Design: Decision 1c (standard per-API module).
Spec: REQ-GR-008 (create/list), REQ-GR-009 (attribution), REQ-GR-010 (max_uses),
      REQ-GR-011 (RLS via tenant session).
"""

import uuid
from datetime import UTC, datetime

from fastapi import HTTPException, status
from sqlmodel import Session, desc, func, select

from app.api.referral.models import Referrals
from app.api.referral.schemas import (
    ReferralAdminUpdate,
    ReferralCreate,
    ReferralUpdate,
    generate_referral_code,
)
from app.api.shared.crud import BaseCRUD


class ReferralsCRUD(BaseCRUD[Referrals, ReferralCreate, ReferralUpdate]):
    """CRUD operations for Referrals."""

    def __init__(self) -> None:
        super().__init__(Referrals)

    # ------------------------------------------------------------------
    # Lookups
    # ------------------------------------------------------------------

    def get_by_code(
        self, session: Session, popup_id: uuid.UUID, code: str
    ) -> Referrals | None:
        """Fetch referral by (popup_id, code) — used for public lookup and attribution."""
        stmt = select(Referrals).where(
            Referrals.popup_id == popup_id,
            Referrals.code == code,
        )
        return session.exec(stmt).first()

    def get_by_code_any_popup(self, session: Session, code: str) -> Referrals | None:
        """Fetch referral by code across all popups (public /r/{code} lookup)."""
        stmt = select(Referrals).where(Referrals.code == code)
        return session.exec(stmt).first()

    def find_by_popup(
        self,
        session: Session,
        popup_id: uuid.UUID,
        *,
        skip: int = 0,
        limit: int = 100,
    ) -> tuple[list[Referrals], int]:
        """List referrals for a popup (admin moderation view)."""
        stmt = select(Referrals).where(Referrals.popup_id == popup_id)

        count_stmt = select(func.count()).select_from(stmt.subquery())
        total = session.exec(count_stmt).one()

        stmt = stmt.order_by(desc(Referrals.created_at)).offset(skip).limit(limit)
        results = list(session.exec(stmt).all())
        return results, total

    def find_by_human(
        self,
        session: Session,
        human_id: uuid.UUID,
        popup_id: uuid.UUID,
        *,
        skip: int = 0,
        limit: int = 100,
    ) -> tuple[list[Referrals], int]:
        """List referrals owned by a specific human, scoped to a popup."""
        stmt = select(Referrals).where(
            Referrals.referrer_human_id == human_id,
            Referrals.popup_id == popup_id,
        )

        count_stmt = select(func.count()).select_from(stmt.subquery())
        total = session.exec(count_stmt).one()

        stmt = stmt.order_by(desc(Referrals.created_at)).offset(skip).limit(limit)
        results = list(session.exec(stmt).all())
        return results, total

    # ------------------------------------------------------------------
    # Write operations
    # ------------------------------------------------------------------

    def create_referral(
        self,
        session: Session,
        obj_in: ReferralCreate,
        *,
        tenant_id: uuid.UUID,
        referrer_human_id: uuid.UUID,
    ) -> Referrals:
        """Create a referral, auto-generating code when not provided.

        Raises 409 if (popup_id, code) already exists.
        """
        code = obj_in.code or generate_referral_code()

        # Check uniqueness of (popup_id, code)
        existing = self.get_by_code(session, obj_in.popup_id, code)
        if existing:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="A referral with this code already exists for this popup",
            )

        referral = Referrals(
            tenant_id=tenant_id,
            popup_id=obj_in.popup_id,
            referrer_human_id=referrer_human_id,
            code=code,
            max_uses=obj_in.max_uses,
            expires_at=obj_in.expires_at,
        )
        session.add(referral)
        session.commit()
        session.refresh(referral)
        return referral

    def update_referral(
        self,
        session: Session,
        db_obj: Referrals,
        obj_in: ReferralUpdate | ReferralAdminUpdate,
    ) -> Referrals:
        """Update mutable fields on a referral."""
        update_data = obj_in.model_dump(exclude_unset=True)
        for field, value in update_data.items():
            setattr(db_obj, field, value)
        db_obj.updated_at = datetime.now(UTC)
        session.add(db_obj)
        session.commit()
        session.refresh(db_obj)
        return db_obj

    def delete_referral(self, session: Session, db_obj: Referrals) -> None:
        """Delete a referral. Raises 409 when current_uses > 0."""
        if db_obj.current_uses > 0:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="Cannot delete a referral that has been used",
            )
        session.delete(db_obj)
        session.commit()

    # ------------------------------------------------------------------
    # Attribution
    # ------------------------------------------------------------------

    def validate_for_use(self, referral: Referrals) -> None:
        """Enforce use-limit and expiry guards (spec: REQ-GR-010).

        1. Expiration → 410 Gone
        2. Use limit  → 410 Gone
        """
        now = datetime.now(UTC)

        # Step 1: expiration
        if referral.expires_at is not None and referral.expires_at < now:
            raise HTTPException(
                status_code=status.HTTP_410_GONE,
                detail="This referral has expired",
            )

        # Step 2: use limit
        if referral.max_uses is not None and referral.current_uses >= referral.max_uses:
            raise HTTPException(
                status_code=status.HTTP_410_GONE,
                detail="This referral has reached its maximum number of uses",
            )

    def increment_uses(self, session: Session, referral: Referrals) -> Referrals:
        """Increment current_uses atomically on successful application attribution."""
        referral.current_uses += 1
        referral.updated_at = datetime.now(UTC)
        session.add(referral)
        session.commit()
        session.refresh(referral)
        return referral


referrals_crud = ReferralsCRUD()
