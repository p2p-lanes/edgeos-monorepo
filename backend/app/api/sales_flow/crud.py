import uuid

from sqlmodel import Session, select

from app.api.sales_flow.models import SalesFlows
from app.api.sales_flow.schemas import (
    RESERVED_FLOW_SLUGS,
    SalesFlowCreate,
    SalesFlowIdentityMode,
    SalesFlowReviewersMode,
    SalesFlowUpdate,
    SalesFlowVisibility,
)
from app.api.shared.crud import BaseCRUD

DEFAULT_FLOW_SLUG = "default"
DEFAULT_FLOW_NAME = "Default"


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
        breach handled by callers (see resolver.py, added in a later slice).
        """
        statement = select(SalesFlows).where(
            SalesFlows.popup_id == popup_id,
            SalesFlows.is_default == True,  # noqa: E712
        )
        return session.exec(statement).first()

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
        """Create a sales flow. tenant_id is always derived server-side."""
        data = obj_in.model_dump()
        data["tenant_id"] = tenant_id
        flow = SalesFlows(**data)
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

        All Class B (inheritable override) columns stay NULL (design D1) —
        the popup row remains the single source of truth until a later
        cutover slice re-points its read through the resolver.
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
            name=DEFAULT_FLOW_NAME,
            visibility=SalesFlowVisibility.portal_listed,
            is_default=True,
            order=0,
            reviewers_mode=SalesFlowReviewersMode.inherit,
            identity_mode=SalesFlowIdentityMode.portal_auth,
        )
        session.add(flow)
        return flow

    def ensure_reviewers_override(
        self, session: Session, flow_id: uuid.UUID
    ) -> SalesFlows | None:
        """Set `reviewers_mode='override'` if not already (sdd/sales-flows
        D4 CRUD invariant, enforced here — not in SQL). Called when a
        flow-tier reviewer is added. Idempotent no-op if already 'override'
        or the flow doesn't exist."""
        flow = self.get(session, flow_id)
        if flow and flow.reviewers_mode != SalesFlowReviewersMode.override:
            flow.reviewers_mode = SalesFlowReviewersMode.override
            session.add(flow)
            session.commit()
            session.refresh(flow)
        return flow

    def reset_reviewers_inherit(
        self, session: Session, flow_id: uuid.UUID
    ) -> SalesFlows | None:
        """Set `reviewers_mode='inherit'` if not already (sdd/sales-flows D4
        CRUD invariant). Called once a flow's last flow-tier reviewer is
        removed — clearing the override falls back to the popup-shared
        tier. Idempotent no-op if already 'inherit' or the flow doesn't
        exist."""
        flow = self.get(session, flow_id)
        if flow and flow.reviewers_mode != SalesFlowReviewersMode.inherit:
            flow.reviewers_mode = SalesFlowReviewersMode.inherit
            session.add(flow)
            session.commit()
            session.refresh(flow)
        return flow


sales_flows_crud = SalesFlowsCRUD()
