"""Invite CRUD operations.

Design: Decision 1c (standard per-API module).
Spec: REQ-GR-001 (create/list), REQ-GR-003 (redemption guard order),
      REQ-GR-004 (flags applied to application), REQ-GR-007 (RLS via tenant session).
"""

import uuid
from datetime import UTC, datetime

from fastapi import HTTPException, status
from sqlmodel import Session, col, desc, func, select

from app.api.invite.models import Invites
from app.api.invite.schemas import (
    InviteCreate,
    InvitePortalCreate,
    InvitePortalUpdate,
    InviteUpdate,
    generate_invite_token,
)
from app.api.shared.crud import BaseCRUD


class _UnsetType:
    """Sentinel distinguishing 'not passed' from None in max_uses_override."""


_UNSET = _UnsetType()


class InvitesCRUD(BaseCRUD[Invites, InviteCreate, InviteUpdate]):
    """CRUD operations for access links -- admin invites and portal links alike.

    Both kinds live in ``invites``, told apart by ``referrer_human_id``. The
    lookups default to admin links so a caller that does not choose keeps the
    pre-merge behaviour; pass ``issuer`` to widen, or use the portal-specific
    helpers.
    """

    def __init__(self) -> None:
        super().__init__(Invites)

    # ------------------------------------------------------------------
    # Lookups
    # ------------------------------------------------------------------

    def get_admin_created(
        self, session: Session, invite_id: uuid.UUID
    ) -> Invites | None:
        """Fetch an admin-created invite by id.

        A portal link's id must read as "not found" through the invite surface,
        the same way the referral surface hides admin invites.
        """
        stmt = select(Invites).where(
            Invites.id == invite_id,
            col(Invites.referrer_human_id).is_(None),
        )
        return session.exec(stmt).first()

    def get_by_token(
        self,
        session: Session,
        popup_id: uuid.UUID,
        token: str,
        *,
        issuer: str = "admin",
    ) -> Invites | None:
        """Fetch a link by (popup_id, token).

        Defaults to admin links, matching the pre-merge behaviour. Uniqueness
        checks must pass ``issuer="all"``: the constraint spans the table, so a
        token held by either kind is a conflict.
        """
        stmt = select(Invites).where(
            Invites.popup_id == popup_id,
            Invites.token == token,
        )
        if issuer == "admin":
            stmt = stmt.where(col(Invites.referrer_human_id).is_(None))
        elif issuer == "portal":
            stmt = stmt.where(col(Invites.referrer_human_id).is_not(None))
        return session.exec(stmt).first()

    def get_by_token_any_popup(self, session: Session, token: str) -> Invites | None:
        """Fetch invite by token across all popups (used for redeem endpoint which
        does NOT require caller to know popup_id upfront)."""
        stmt = select(Invites).where(
            Invites.token == token,
            col(Invites.referrer_human_id).is_(None),
        )
        return session.exec(stmt).first()

    def get_portal_created(
        self, session: Session, link_id: uuid.UUID
    ) -> Invites | None:
        """Fetch a portal-created link by id.

        The portal surface addresses only attendee links; an admin invite id
        must read as "not found" there rather than becoming editable.
        """
        stmt = select(Invites).where(
            Invites.id == link_id,
            col(Invites.referrer_human_id).is_not(None),
        )
        return session.exec(stmt).first()

    def get_portal_created_by_token(
        self, session: Session, token: str
    ) -> Invites | None:
        """Fetch a portal-created link by token across popups (public /r/{code})."""
        stmt = select(Invites).where(
            Invites.token == token,
            col(Invites.referrer_human_id).is_not(None),
        )
        return session.exec(stmt).first()

    def get_any_by_token(self, session: Session, token: str) -> Invites | None:
        """Fetch a link of either kind by token, across popups.

        Backs the unified public preview, which must resolve a shared URL
        without the caller knowing who issued it.
        """
        stmt = select(Invites).where(Invites.token == token)
        return session.exec(stmt).first()

    def find_by_popup(
        self,
        session: Session,
        popup_id: uuid.UUID,
        *,
        recipient_email: str | None = None,
        issuer: str = "admin",
        skip: int = 0,
        limit: int = 100,
    ) -> tuple[list[Invites], int]:
        """List links for a popup with optional recipient_email filter.

        ``issuer`` selects which kind: "admin" (backoffice links), "portal"
        (attendee links), or "all". It defaults to "admin" so a caller that
        forgets to choose keeps the pre-merge behaviour rather than silently
        widening what it shows.
        """
        stmt = select(Invites).where(Invites.popup_id == popup_id)
        if issuer == "admin":
            stmt = stmt.where(col(Invites.referrer_human_id).is_(None))
        elif issuer == "portal":
            stmt = stmt.where(col(Invites.referrer_human_id).is_not(None))

        if recipient_email:
            stmt = stmt.where(
                func.lower(Invites.recipient_email) == recipient_email.lower()
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
        """List links owned by a specific attendee, scoped to a popup."""
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

        # Check uniqueness of (popup_id, token) across BOTH kinds: the
        # constraint spans the table, so a portal link holding this token is a
        # conflict too, and would otherwise surface as an IntegrityError.
        existing = self.get_by_token(session, obj_in.popup_id, token, issuer="all")
        if existing:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="An invite with this token already exists for this popup",
            )

        if obj_in.sales_flow_id is None:
            # The router resolves and validates it before calling here, so
            # reaching this means a caller skipped that step rather than
            # that a default is wanted.
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail="This invite has no sales flow.",
            )

        invite = Invites(
            tenant_id=tenant_id,
            popup_id=obj_in.popup_id,
            sales_flow_id=obj_in.sales_flow_id,
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

    def create_portal_link(
        self,
        session: Session,
        obj_in: InvitePortalCreate,
        *,
        tenant_id: uuid.UUID,
        referrer_human_id: uuid.UUID,
        max_uses_override: int | None | type[_UNSET] = _UNSET,
    ) -> Invites:
        """Create an attendee's own link, auto-generating a token when omitted.

        Raises 409 if (popup_id, token) already exists -- checked against ALL
        links, since the uniqueness constraint spans the table and an admin
        invite holding the token must read as a conflict, not an IntegrityError.

        ``max_uses_override`` carries popup.max_referrals_per_attendee and wins
        over the body, including when it is None (the popup says unlimited).
        """
        token = obj_in.token or generate_invite_token()

        existing = self.get_by_token(session, obj_in.popup_id, token, issuer="all")
        if existing:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="A link with this code already exists for this popup",
            )

        effective_max_uses = (
            obj_in.max_uses if max_uses_override is _UNSET else max_uses_override
        )

        link = Invites(
            tenant_id=tenant_id,
            popup_id=obj_in.popup_id,
            sales_flow_id=self._flow_for_attendee_link(
                session, obj_in.popup_id, referrer_human_id
            ),
            referrer_human_id=referrer_human_id,
            token=token,
            max_uses=effective_max_uses,
            expires_at=obj_in.expires_at,
            # Referrals open the reduced checkout form and auto-approve by
            # default. Administrators can revoke auto-approval when they need
            # a referral to record attribution without granting purchase access.
            express_checkout=True,
            auto_approve=True,
        )
        session.add(link)
        session.commit()
        session.refresh(link)
        return link

    def _flow_for_attendee_link(
        self,
        session: Session,
        popup_id: uuid.UUID,
        referrer_human_id: uuid.UUID,
    ) -> uuid.UUID:
        """The door an attendee's own link lands people in.

        The one they came through themselves. Someone accepted as a volunteer
        shares the volunteer way in, which is the only reading that does not
        surprise either end of the link — and every invite names a flow since
        the re-key, so it has to name one.

        An attendee who bought without applying names no door; the popup's
        default answers for them, which is where they would have landed anyway.
        """
        from app.api.application.crud import applications_crud
        from app.api.sales_flow.crud import sales_flows_crud

        application = applications_crud.get_by_human_popup(
            session, referrer_human_id, popup_id
        )
        if application is not None and application.sales_flow_id:
            return application.sales_flow_id

        default_flow = sales_flows_crud.get_default_flow(session, popup_id)
        if default_flow is None:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Sales flow not found",
            )
        return default_flow.id

    def update_invite(
        self,
        session: Session,
        db_obj: Invites,
        obj_in: InviteUpdate | InvitePortalUpdate,
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

        # Cache-Control: no-store on the 410s so browsers never cache an
        # invite's exhausted/expired state — an admin can raise max_uses or
        # extend expiry and the link must work again immediately (a cached 410
        # Gone, which is cacheable by default, would otherwise stick).
        _no_store = {"Cache-Control": "no-store"}

        # Step 0: admin force-disable. Came in with portal links, and applies
        # to admin invites just as well -- one kill switch for both.
        if invite.is_disabled:
            raise HTTPException(
                status_code=status.HTTP_410_GONE,
                detail="This link is no longer active",
                headers=_no_store,
            )

        # Step 1: expiration
        if invite.expires_at is not None and invite.expires_at < now:
            raise HTTPException(
                status_code=status.HTTP_410_GONE,
                detail="This invite has expired",
                headers=_no_store,
            )

        # Step 2: use limit
        if invite.max_uses is not None and invite.current_uses >= invite.max_uses:
            raise HTTPException(
                status_code=status.HTTP_410_GONE,
                detail="This invite has reached its maximum number of uses",
                headers=_no_store,
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
