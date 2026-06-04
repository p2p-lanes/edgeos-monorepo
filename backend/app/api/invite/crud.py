"""Invite CRUD operations.

Design: Decision 1c (standard per-API module).
Spec: REQ-GR-001 (create/list), REQ-GR-003 (redemption guard order),
      REQ-GR-004 (flags applied to application), REQ-GR-007 (RLS via tenant session).
"""

import uuid
from datetime import UTC, datetime

from fastapi import HTTPException, status
from sqlmodel import Session, desc, func, select

from app.api.invite.models import Invites
from app.api.invite.schemas import InviteCreate, InviteUpdate, generate_invite_token
from app.api.shared.crud import BaseCRUD


class InvitesCRUD(BaseCRUD[Invites, InviteCreate, InviteUpdate]):
    """CRUD operations for Invites."""

    def __init__(self) -> None:
        super().__init__(Invites)

    # ------------------------------------------------------------------
    # Lookups
    # ------------------------------------------------------------------

    def get_by_token(
        self, session: Session, popup_id: uuid.UUID, token: str
    ) -> Invites | None:
        """Fetch invite by (popup_id, token) — used for redemption and compat layer."""
        stmt = select(Invites).where(
            Invites.popup_id == popup_id,
            Invites.token == token,
        )
        return session.exec(stmt).first()

    def get_by_token_any_popup(self, session: Session, token: str) -> Invites | None:
        """Fetch invite by token across all popups (used for redeem endpoint which
        does NOT require caller to know popup_id upfront)."""
        stmt = select(Invites).where(Invites.token == token)
        return session.exec(stmt).first()

    def find_by_popup(
        self,
        session: Session,
        popup_id: uuid.UUID,
        *,
        recipient_email: str | None = None,
        skip: int = 0,
        limit: int = 100,
    ) -> tuple[list[Invites], int]:
        """List invites for a popup with optional recipient_email filter."""
        stmt = select(Invites).where(Invites.popup_id == popup_id)
        if recipient_email:
            stmt = stmt.where(
                func.lower(Invites.recipient_email) == recipient_email.lower()
            )

        count_stmt = select(func.count()).select_from(stmt.subquery())
        total = session.exec(count_stmt).one()

        stmt = stmt.order_by(desc(Invites.created_at)).offset(skip).limit(limit)
        results = list(session.exec(stmt).all())
        return results, total

    # ------------------------------------------------------------------
    # Write operations
    # ------------------------------------------------------------------

    def create_invite(
        self,
        session: Session,
        obj_in: InviteCreate,
        *,
        tenant_id: uuid.UUID,
        created_by: uuid.UUID,
    ) -> Invites:
        """Create an invite, auto-generating token when not provided.

        Raises 409 if (popup_id, token) already exists.
        """
        token = obj_in.token or generate_invite_token()

        # Check uniqueness of (popup_id, token)
        existing = self.get_by_token(session, obj_in.popup_id, token)
        if existing:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="An invite with this token already exists for this popup",
            )

        invite = Invites(
            tenant_id=tenant_id,
            popup_id=obj_in.popup_id,
            token=token,
            recipient_email=(
                obj_in.recipient_email.lower() if obj_in.recipient_email else None
            ),
            discount_percentage=obj_in.discount_percentage,
            auto_approve=obj_in.auto_approve,
            express_checkout=obj_in.express_checkout,
            max_uses=obj_in.max_uses,
            created_by=created_by,
        )
        session.add(invite)
        session.commit()
        session.refresh(invite)
        return invite

    def update_invite(
        self,
        session: Session,
        db_obj: Invites,
        obj_in: InviteUpdate,
    ) -> Invites:
        """Update mutable fields on an invite.

        token and recipient_email are immutable — callers must not pass them here.
        """
        update_data = obj_in.model_dump(exclude_unset=True)
        for field, value in update_data.items():
            setattr(db_obj, field, value)
        session.add(db_obj)
        session.commit()
        session.refresh(db_obj)
        return db_obj

    def delete_invite(self, session: Session, db_obj: Invites) -> None:
        """Delete an invite. Raises 409 when current_uses > 0."""
        if db_obj.current_uses > 0:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="Cannot delete an invite that has been used",
            )
        session.delete(db_obj)
        session.commit()

    # ------------------------------------------------------------------
    # Redemption
    # ------------------------------------------------------------------

    def validate_for_redemption(self, invite: Invites) -> None:
        """Enforce guard chain in spec order (REQ-GR-003):

        1. Expiration → 410 Gone
        2. Use limit  → 410 Gone
        (recipient_email match validated by the router against the authenticated human)
        """
        now = datetime.now(UTC)

        # Step 1: expiration
        if invite.expires_at is not None and invite.expires_at < now:
            raise HTTPException(
                status_code=status.HTTP_410_GONE,
                detail="This invite has expired",
            )

        # Step 2: use limit
        if invite.max_uses is not None and invite.current_uses >= invite.max_uses:
            raise HTTPException(
                status_code=status.HTTP_410_GONE,
                detail="This invite has reached its maximum number of uses",
            )

    def increment_uses(
        self,
        session: Session,
        invite: Invites,
        *,
        redeemed_by_human_id: uuid.UUID,
    ) -> Invites:
        """Atomically increment current_uses and set used_at / redeemed_by_human_id.

        Sets used_at only on the FIRST redemption (used_at IS NULL).
        Sets redeemed_by_human_id only for single-use invites (max_uses == 1).
        """
        invite.current_uses += 1
        if invite.used_at is None:
            invite.used_at = datetime.now(UTC)
        if invite.max_uses == 1:
            invite.redeemed_by_human_id = redeemed_by_human_id
        session.add(invite)
        session.commit()
        session.refresh(invite)
        return invite

    def has_redeemed(
        self,
        session: Session,
        invite_id: uuid.UUID,
        human_id: uuid.UUID,
    ) -> bool:
        """True when this human has already redeemed this invite.

        Checked via applications.invite_id to avoid a separate redemption log.
        """
        from app.api.application.models import Applications

        stmt = select(Applications).where(
            Applications.invite_id == invite_id,
            Applications.human_id == human_id,
        )
        return session.exec(stmt).first() is not None


invites_crud = InvitesCRUD()
