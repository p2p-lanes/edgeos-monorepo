"""Referral CRUD operations.

Referrals are portal-created Invites: rows in ``invites`` carrying a
``referrer_human_id``. This module keeps the referral vocabulary (code, owner,
quota) over that single table while the API and the frontends still speak it.

Design: Decision 1c (standard per-API module).
Spec: REQ-GR-008 (create/list), REQ-GR-009 (attribution), REQ-GR-010 (max_uses),
      REQ-GR-011 (RLS via tenant session).
"""

import uuid
from datetime import UTC, datetime

from fastapi import HTTPException, status
from sqlmodel import Session, col, desc, func, select

from app.api.invite.models import Invites
from app.api.referral.schemas import (
    ReferralAdminUpdate,
    ReferralCreate,
    ReferralUpdate,
    generate_referral_code,
)
from app.api.shared.crud import BaseCRUD


class _UnsetType:
    """Sentinel for distinguishing 'not passed' from None in max_uses_override."""


_UNSET = _UnsetType()


class ReferralsCRUD(BaseCRUD[Invites, ReferralCreate, ReferralUpdate]):
    """CRUD operations for portal-created Invites (referrals)."""

    def __init__(self) -> None:
        super().__init__(Invites)

    # ------------------------------------------------------------------
    # Lookups
    # ------------------------------------------------------------------

    def get_portal_created(
        self, session: Session, link_id: uuid.UUID
    ) -> Invites | None:
        """Fetch a portal-created link by id.

        The referral endpoints address only their own links; an admin invite id
        must read as "not found" here rather than becoming editable through the
        referral surface.
        """
        stmt = select(Invites).where(
            Invites.id == link_id,
            col(Invites.referrer_human_id).is_not(None),
        )
        return session.exec(stmt).first()

    def get_by_code(
        self, session: Session, popup_id: uuid.UUID, code: str
    ) -> Invites | None:
        """Fetch a link by (popup_id, token) — used for uniqueness checks.

        Deliberately NOT restricted to portal-created links: the uniqueness
        constraint spans the whole table, so an admin invite holding this token
        must be reported as a conflict rather than hitting an IntegrityError.
        """
        stmt = select(Invites).where(
            Invites.popup_id == popup_id,
            Invites.token == code,
        )
        return session.exec(stmt).first()

    def get_by_code_any_popup(self, session: Session, code: str) -> Invites | None:
        """Fetch a portal-created link by code across popups (public /r/{code}).

        Admin invites keep their own redeem URL, so they are excluded here.
        """
        stmt = select(Invites).where(
            Invites.token == code,
            col(Invites.referrer_human_id).is_not(None),
        )
        return session.exec(stmt).first()

    def find_by_popup(
        self,
        session: Session,
        popup_id: uuid.UUID,
        *,
        skip: int = 0,
        limit: int = 100,
    ) -> tuple[list[Invites], int]:
        """List portal-created links for a popup (admin moderation view)."""
        stmt = select(Invites).where(
            Invites.popup_id == popup_id,
            col(Invites.referrer_human_id).is_not(None),
        )

        count_stmt = select(func.count()).select_from(stmt.subquery())
        total = session.exec(count_stmt).one()

        stmt = stmt.order_by(desc(Invites.created_at)).offset(skip).limit(limit)
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
    ) -> tuple[list[Invites], int]:
        """List links owned by a specific human, scoped to a popup."""
        stmt = select(Invites).where(
            Invites.referrer_human_id == human_id,
            Invites.popup_id == popup_id,
        )

        count_stmt = select(func.count()).select_from(stmt.subquery())
        total = session.exec(count_stmt).one()

        stmt = stmt.order_by(desc(Invites.created_at)).offset(skip).limit(limit)
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
        max_uses_override: int | None | type[_UNSET] = _UNSET,
    ) -> Invites:
        """Create a portal link, auto-generating a code when not provided.

        Raises 409 if (popup_id, code) already exists.
        When max_uses_override is provided (from popup.max_referrals_per_attendee),
        it takes precedence over any value in obj_in.max_uses.
        Pass None explicitly to mean unlimited (popup config says unlimited).
        """
        code = obj_in.code or generate_referral_code()

        # Check uniqueness of (popup_id, token)
        existing = self.get_by_code(session, obj_in.popup_id, code)
        if existing:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="A referral with this code already exists for this popup",
            )

        # Popup config wins when explicitly passed (even if None = unlimited).
        # Falls back to obj_in.max_uses only when no override is given.
        effective_max_uses = (
            obj_in.max_uses if max_uses_override is _UNSET else max_uses_override
        )

        referral = Invites(
            tenant_id=tenant_id,
            popup_id=obj_in.popup_id,
            referrer_human_id=referrer_human_id,
            token=code,
            max_uses=effective_max_uses,
            expires_at=obj_in.expires_at,
            # Portal links open the reduced checkout form, and grant no
            # approval of their own unless an admin turns it on.
            express_checkout=True,
            auto_approve=False,
        )
        session.add(referral)
        session.commit()
        session.refresh(referral)
        return referral

    def update_referral(
        self,
        session: Session,
        db_obj: Invites,
        obj_in: ReferralUpdate | ReferralAdminUpdate,
    ) -> Invites:
        """Update mutable fields on a link."""
        update_data = obj_in.model_dump(exclude_unset=True)
        for field, value in update_data.items():
            setattr(db_obj, field, value)
        db_obj.updated_at = datetime.now(UTC)
        session.add(db_obj)
        session.commit()
        session.refresh(db_obj)
        return db_obj

    def delete_referral(self, session: Session, db_obj: Invites) -> None:
        """Delete a link. Raises 409 when current_uses > 0."""
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

    def validate_for_use(self, referral: Invites) -> None:
        """Enforce use-limit and expiry guards (spec: REQ-GR-010).

        1. Admin-disabled → 410 Gone
        2. Expiration → 410 Gone
        3. Use limit  → 410 Gone
        """
        now = datetime.now(UTC)

        # Step 1: admin force-disable
        if referral.is_disabled:
            raise HTTPException(
                status_code=status.HTTP_410_GONE,
                detail="This referral link is no longer active",
            )

        # Step 2: expiration
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

    def increment_uses(self, session: Session, referral: Invites) -> Invites:
        """Increment current_uses atomically on successful application attribution."""
        referral.current_uses += 1
        referral.updated_at = datetime.now(UTC)
        session.add(referral)
        session.commit()
        session.refresh(referral)
        return referral


referrals_crud = ReferralsCRUD()
