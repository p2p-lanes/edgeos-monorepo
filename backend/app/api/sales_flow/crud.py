import uuid

from sqlmodel import Session, select

from app.api.sales_flow.models import SalesFlows
from app.api.sales_flow.schemas import (
    RESERVED_FLOW_SLUGS,
    SalesFlowCreate,
    SalesFlowIdentityMode,
    SalesFlowReviewersMode,
    SalesFlowType,
    SalesFlowUpdate,
    SalesFlowVisibility,
)
from app.api.shared.crud import BaseCRUD

DEFAULT_FLOW_SLUG = "default"

# What a popup's first flow is called, by what it does. A buyer sees this name
# on the door card, and "Default" told them nothing — it named the row's place
# in the schema, not the way in.
#
# Keyed on the FLOW's type rather than the popup's sale_type on purpose. The
# popup-level application/festival split is on its way out precisely because a
# flow already carries that distinction, so the name has to come from the thing
# that survives.
DEFAULT_FLOW_NAMES = {
    "application": "Attendee",
    "direct": "Checkout",
}
DEFAULT_FLOW_NAME_FALLBACK = "Checkout"


def default_flow_name(flow_type: str) -> str:
    """The name a popup's first flow is created with."""
    return DEFAULT_FLOW_NAMES.get(str(flow_type), DEFAULT_FLOW_NAME_FALLBACK)


def flow_kinds_for_popups(
    session: Session, popup_ids: "list[uuid.UUID]"
) -> "dict[uuid.UUID, tuple[bool, bool]]":
    """Per popup, whether any door takes applications and whether any sells.

    One grouped query for a whole page of popups rather than a lazy property
    per row: this is read on every portal list, and a hidden N+1 in a
    serializer is exactly the kind of thing nobody notices until it is slow.

    Returns `{popup_id: (takes_applications, sells_directly)}`.
    """
    if not popup_ids:
        return {}

    rows = session.exec(
        select(SalesFlows.popup_id, SalesFlows.type).where(
            SalesFlows.popup_id.in_(popup_ids)  # type: ignore[attr-defined]
        )
    ).all()

    kinds: dict[uuid.UUID, tuple[bool, bool]] = {}
    for popup_id, flow_type in rows:
        takes, sells = kinds.get(popup_id, (False, False))
        if flow_type == SalesFlowType.application.value:
            takes = True
        else:
            sells = True
        kinds[popup_id] = (takes, sells)
    return kinds


def popup_takes_applications(session: Session, popup_id: uuid.UUID) -> bool:
    """Whether any way into this gathering asks people to apply first."""
    return _has_flow_of_type(session, popup_id, (SalesFlowType.application.value,))


def popup_sells_directly(session: Session, popup_id: uuid.UUID) -> bool:
    """Whether any way into this gathering sells without an application.

    Upsale counts: it sells, it just refuses strangers. Callers that need a
    door a stranger can walk through want the default flow's type instead.
    """
    return _has_flow_of_type(
        session,
        popup_id,
        (SalesFlowType.direct.value, SalesFlowType.upsale.value),
    )


def _has_flow_of_type(
    session: Session, popup_id: uuid.UUID, types: "tuple[str, ...]"
) -> bool:
    return (
        session.exec(
            select(SalesFlows.id)
            .where(
                SalesFlows.popup_id == popup_id,
                SalesFlows.type.in_(types),  # type: ignore[union-attr]
            )
            .limit(1)
        ).first()
        is not None
    )


def resolve_default_flow_slug(
    candidate: str,
    taken: frozenset[str] = frozenset(),
    reserved: frozenset[str] = RESERVED_FLOW_SLUGS,
) -> str:
    """Deterministically de-collide a candidate slug against reserved and
    already-taken slugs (`taken` must be scoped to a single popup).

    Pure function (no I/O). Mirrors the slice-2 backfill migration's own
    `resolve_default_flow_slug` (4a983282b8aa) — kept as a separate copy
    here (not imported) for the same reason that migration doesn't import
    this module: the two call sites evolve independently.
    """
    blocked = reserved | taken
    if candidate not in blocked:
        return candidate
    suffixed = f"{candidate}-flow"
    n = 2
    while suffixed in blocked:
        suffixed = f"{candidate}-flow-{n}"
        n += 1
    return suffixed


class SalesFlowsCRUD(BaseCRUD[SalesFlows, SalesFlowCreate, SalesFlowUpdate]):
    """CRUD operations for SalesFlows."""

    def __init__(self) -> None:
        super().__init__(SalesFlows)

    def get_by_slug(
        self, session: Session, popup_id: uuid.UUID, slug: str
    ) -> SalesFlows | None:
        """Get a sales flow by (popup_id, slug) — matches uq_sales_flows_popup_slug."""
        statement = select(SalesFlows).where(
            SalesFlows.popup_id == popup_id, SalesFlows.slug == slug
        )
        return session.exec(statement).first()

    def get_default_flow(
        self, session: Session, popup_id: uuid.UUID
    ) -> SalesFlows | None:
        """Get the default flow for a popup (is_default = true).

        A missing default flow after the backfill migration is an invariant
        breach handled by callers (see resolver.py's `resolve_flow` /
        `get_default_flow`, which raise a 500 for this case).
        """
        statement = select(SalesFlows).where(
            SalesFlows.popup_id == popup_id,
            SalesFlows.is_default == True,  # noqa: E712
        )
        return session.exec(statement).first()

    def find_portal_listed(
        self,
        session: Session,
        popup_id: uuid.UUID,
        *,
        type: str = SalesFlowType.application,  # noqa: A002
    ) -> list[SalesFlows]:
        """Portal-facing flow listing (sdd/sales-flows G0, task 9.4).

        Only `visibility=portal_listed` flows of the given `type` — a
        `direct_url_only` flow is reachable by URL (design: visibility is
        listing-only) but never appears here. Ordered by `order` then
        `created_at`, matching `find_by_popup`.
        """
        statement = (
            select(SalesFlows)
            .where(
                SalesFlows.popup_id == popup_id,
                SalesFlows.visibility == SalesFlowVisibility.portal_listed,
                SalesFlows.type == type,
            )
            .order_by(SalesFlows.order, SalesFlows.created_at)  # type: ignore[union-attr]
        )
        return list(session.exec(statement).all())

    def find_by_popup(
        self,
        session: Session,
        popup_id: uuid.UUID,
        skip: int = 0,
        limit: int = 100,
    ) -> tuple[list[SalesFlows], int]:
        """List sales flows for a popup, ordered by `order` then creation."""
        from sqlmodel import func

        statement = select(SalesFlows).where(SalesFlows.popup_id == popup_id)

        count_statement = select(func.count()).select_from(statement.subquery())
        total = session.exec(count_statement).one()

        statement = (
            statement.order_by(SalesFlows.order, SalesFlows.created_at)  # type: ignore[union-attr]
            .offset(skip)
            .limit(limit)
        )
        results = list(session.exec(statement).all())

        return results, total

    def create(
        self,
        session: Session,
        obj_in: SalesFlowCreate,
        tenant_id: uuid.UUID,
    ) -> SalesFlows:
        """Create a sales flow. tenant_id is always derived server-side.

        Channel configuration the caller left unset is copied from the
        popup's default flow here, so every creation path produces a usable
        flow — a flow with no reminder cadence and no coupon setting is not a
        smaller flow, it is a broken one.
        """
        data = obj_in.model_dump()
        data["tenant_id"] = tenant_id
        flow = SalesFlows(**data)
        self.seed_config_from_popup(session, flow, flow.popup_id)
        session.add(flow)
        session.commit()
        session.refresh(flow)
        return flow

    def provision_default_flow(
        self,
        session: Session,
        *,
        popup_id: uuid.UUID,
        tenant_id: uuid.UUID,
        sale_type: str,
    ) -> SalesFlows:
        """Seed the default sales_flow for a newly created popup (task 5.0).

        Called inside the same transaction as popup creation — mirrors
        `AttendeeCategoriesCRUD.seed_main_for_popup`. No commit here, the
        caller controls the transaction. Idempotent: returns the existing
        default flow instead of creating a second one (defensive, mirrors
        the slice-2 backfill's own `WHERE NOT EXISTS` idempotency).

        The channel-configuration columns are copied from the popup
        (sdd/sales-flows-rediseno slice 7). This is the one flow with no
        sibling to copy from, so it is also the last caller that still reads
        the popup's own copies of them — see `seed_config_from_popup`.
        """
        existing = self.get_default_flow(session, popup_id)
        if existing:
            return existing

        taken_slugs = frozenset(
            session.exec(
                select(SalesFlows.slug).where(SalesFlows.popup_id == popup_id)
            ).all()
        )
        slug = resolve_default_flow_slug(DEFAULT_FLOW_SLUG, taken=taken_slugs)

        flow = SalesFlows(
            tenant_id=tenant_id,
            popup_id=popup_id,
            type=sale_type,
            slug=slug,
            name=default_flow_name(sale_type),
            visibility=SalesFlowVisibility.portal_listed,
            is_default=True,
            order=0,
            reviewers_mode=SalesFlowReviewersMode.inherit,
            identity_mode=SalesFlowIdentityMode.portal_auth,
        )
        self.seed_config_from_popup(session, flow, popup_id)
        session.add(flow)
        return flow

    def seed_config_from_popup(
        self, session: Session, flow: SalesFlows, popup_id: uuid.UUID
    ) -> SalesFlows:
        """Fill the flow's unset channel configuration from a sibling flow.

        A new flow has to start somewhere. It starts from the popup's default
        flow — the one an operator has actually been configuring — and only
        falls back to the popup's own columns for the default flow itself,
        which has no sibling to copy from and is created alongside the popup.

        That fallback is the last thing reading those popup columns. They are
        no longer editable (the backoffice offers them per flow), so for a
        popup created from now on they are empty and the default flow starts
        blank, which is the intended end state: configure the default flow,
        and every flow made afterwards begins as a copy of it.

        Only columns the caller left unset are filled, so an explicit value
        always wins. This is a one-time copy, not a read-through: editing the
        source afterwards never reaches this flow (slice 7).
        """
        from app.api.popup.models import Popups
        from app.api.sales_flow.schemas import EFFECTIVE_CONFIG_FIELDS

        source = self.get_default_flow(session, popup_id)
        if source is not None and source.id == flow.id:
            source = None
        if source is None:
            source = session.get(Popups, popup_id)
        if source is None:
            return flow

        for name in EFFECTIVE_CONFIG_FIELDS:
            if getattr(flow, name, None) is None:
                setattr(flow, name, getattr(source, name, None))

        # Copied the same way but deliberately not in EFFECTIVE_CONFIG_FIELDS:
        # that tuple is what the flow settings form renders, and a raw JSONB
        # blob is not a setting anyone edits in a row of switches.
        if flow.theme_config is None:
            flow.theme_config = getattr(source, "theme_config", None)
        return flow

    def ensure_reviewers_override(
        self, session: Session, flow_id: uuid.UUID, *, commit: bool = True
    ) -> SalesFlows | None:
        """Set `reviewers_mode='override'` if not already (sdd/sales-flows
        D4 CRUD invariant, enforced here — not in SQL). Called when a
        flow-tier reviewer is added. Idempotent no-op if already 'override'
        or the flow doesn't exist.

        `commit=False` flushes only, letting the caller fold this into a
        single transaction with the reviewer row write (rel-001)."""
        flow = self.get(session, flow_id)
        if flow and flow.reviewers_mode != SalesFlowReviewersMode.override:
            flow.reviewers_mode = SalesFlowReviewersMode.override
            session.add(flow)
            if commit:
                session.commit()
                session.refresh(flow)
            else:
                session.flush()
        return flow

    def reset_reviewers_inherit(
        self, session: Session, flow_id: uuid.UUID, *, commit: bool = True
    ) -> SalesFlows | None:
        """Set `reviewers_mode='inherit'` if not already (sdd/sales-flows D4
        CRUD invariant). Called once a flow's last flow-tier reviewer is
        removed — clearing the override falls back to the popup-shared
        tier. Idempotent no-op if already 'inherit' or the flow doesn't
        exist.

        `commit=False` flushes only, letting the caller fold this into a
        single transaction with the reviewer row delete (rel-001)."""
        flow = self.get(session, flow_id)
        if flow and flow.reviewers_mode != SalesFlowReviewersMode.inherit:
            flow.reviewers_mode = SalesFlowReviewersMode.inherit
            session.add(flow)
            if commit:
                session.commit()
                session.refresh(flow)
            else:
                session.flush()
        return flow


sales_flows_crud = SalesFlowsCRUD()
