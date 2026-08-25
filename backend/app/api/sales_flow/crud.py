import uuid
from dataclasses import dataclass
from typing import Any

from sqlmodel import Session, col, select

from app.api.sales_flow.models import SalesFlows
from app.api.sales_flow.schemas import (
    SalesFlowCreate,
    SalesFlowIdentityMode,
    SalesFlowReviewersMode,
    SalesFlowType,
    SalesFlowUpdate,
    SalesFlowVisibility,
    recommended_visibility_for_type,
)
from app.api.shared.crud import BaseCRUD

PRIMARY_FLOW_SLUGS = {
    "application": "attendee",
    "direct": "checkout",
}
PRIMARY_FLOW_SLUG_FALLBACK = "checkout"

# The starting point that is not an existing flow: take nothing from anywhere.
#
# There used to be two, `fresh` and `empty`, on the theory that a kind of flow
# could carry sensible preset values. It could not carry many: a default
# nobody asked for must not charge a buyer or mail an applicant, and once
# those are excluded almost nothing legitimate is left. What a kind of flow
# actually decides is which settings it OFFERS — see `fields_for` — so the two
# were the same thing under different names.
START_FRESH = "fresh"


@dataclass(frozen=True)
class StartingPoint:
    """Where a new way in gets its configuration, resolved.

    `values` is a plain dict rather than the source row, so a template, a
    sibling flow and a popup are all the same thing to the caller — and so
    nothing downstream can accidentally hold a reference to another flow.
    """

    kind: str
    name: str | None
    values: dict[str, Any]


def _attrs(source: Any) -> dict[str, Any]:
    """Every effective-config column a source has, plus the theme blob."""
    from app.api.sales_flow.schemas import EFFECTIVE_CONFIG_FIELDS  # noqa: PLC0415

    names = (*EFFECTIVE_CONFIG_FIELDS, "theme_config")
    return {name: getattr(source, name, None) for name in names}


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


def primary_flow_slug(flow_type: str) -> str:
    """The canonical URL slug for a popup's first sales flow."""
    return PRIMARY_FLOW_SLUGS.get(str(flow_type), PRIMARY_FLOW_SLUG_FALLBACK)


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


# What a flow leaves behind when it is deleted, and what it may not.
#
# The line is not "does anything reference this row" — that was the old
# question, and it refused to delete a flow because of the checkout steps the
# product had seeded into it seconds earlier. The line is who made the rows.
#
# The flow's own configuration is ours: its steps, its form, its wording, its
# review rules. None of it means anything without the flow, and none of it is
# a record of anything happening. It goes with the flow.
#
# A record of what somebody did is not ours to discard. An application was
# filled in, a payment was taken, an invitation was sent, a coupon was shared.
# Those refuse the delete and say so.
BELONGINGS: "tuple[tuple[str, str], ...]" = (
    ("app.api.ticketing_step.models", "TicketingSteps"),
    ("app.api.form_field.models", "FormFields"),
    ("app.api.form_section.models", "FormSections"),
    ("app.api.base_field_config.models", "BaseFieldConfigs"),
    ("app.api.email_template.models", "EmailTemplates"),
    ("app.api.approval_strategy.models", "ApprovalStrategies"),
    ("app.api.popup_reviewer.models", "PopupReviewers"),
)

HISTORY: "tuple[tuple[str, str, str], ...]" = (
    ("app.api.application.models", "Applications", "application"),
    ("app.api.payment.models", "Payments", "payment"),
    ("app.api.invite.models", "Invites", "invitation"),
    ("app.api.group.models", "Groups", "group"),
    ("app.api.coupon.models", "Coupons", "coupon"),
)


def _model(module: str, name: str):
    from importlib import import_module  # noqa: PLC0415

    return getattr(import_module(module), name)


def history_blocking_delete(
    session: Session, flow_id: uuid.UUID
) -> "list[tuple[str, int]]":
    """What people did through this flow, which deleting it would discard.

    Returns `[(noun, count)]`, empty when nothing is in the way.
    """
    from sqlmodel import func  # noqa: PLC0415

    found: list[tuple[str, int]] = []
    for module, name, noun in HISTORY:
        model = _model(module, name)
        count = session.exec(
            select(func.count()).where(model.sales_flow_id == flow_id)
        ).one()
        if count:
            found.append((noun, count))
    return found


def delete_flow_and_its_configuration(session: Session, flow: SalesFlows) -> None:
    """Delete a flow together with the configuration that only it uses.

    Callers must have checked `history_blocking_delete` first; this does not
    ask, and the foreign keys are the last line of defence rather than the
    first.
    """
    from sqlmodel import delete as sql_delete  # noqa: PLC0415

    for module, name in BELONGINGS:
        model = _model(module, name)
        session.exec(sql_delete(model).where(model.sales_flow_id == flow.id))
    session.delete(flow)
    session.commit()


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
        """Get the optional compatibility fallback for a popup."""
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
                # A closed flow answers 403 at the door (`resolve_flow`).
                # Listing it anyway would show a buyer a way in, let them
                # click it, and refuse them there — so it stops being listed
                # at the same moment it stops being enterable.
                col(SalesFlows.status).is_(None),
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

        A public creation starts fresh unless the caller explicitly names a
        source flow. The checkout baseline is seeded by the route after this
        transaction; configuration stays independent by default.
        """
        data = obj_in.model_dump()
        start_from = data.pop("start_from", None) or START_FRESH
        data["tenant_id"] = tenant_id
        flow = SalesFlows(**data)
        self.seed_config(session, flow, flow.popup_id, start_from=start_from)
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
        the popup's own copies of them — see `seed_config`.
        """
        existing = self.get_default_flow(session, popup_id)
        if existing:
            return existing

        flow = SalesFlows(
            tenant_id=tenant_id,
            popup_id=popup_id,
            type=sale_type,
            slug=primary_flow_slug(sale_type),
            name=default_flow_name(sale_type),
            visibility=recommended_visibility_for_type(sale_type),
            is_default=True,
            order=0,
            reviewers_mode=SalesFlowReviewersMode.inherit,
            identity_mode=SalesFlowIdentityMode.portal_auth,
        )
        self.seed_config(session, flow, popup_id, bootstrap_from_popup=True)
        session.add(flow)
        return flow

    def resolve_start(
        self,
        session: Session,
        popup_id: uuid.UUID,
        flow_type: str | None,
        start_from: str | None,
        *,
        exclude_flow_id: uuid.UUID | None = None,
        bootstrap_from_popup: bool = False,
    ) -> "StartingPoint":
        """Where a new way in takes its configuration from.

        `start_from` is what the organiser chose:

        - ``None`` or ``fresh`` nothing carried over: no sibling's contribution, no
                      sibling's installment plan, no sibling's landing page.
        - a flow id  that door, so this one inherits the decisions somebody
                     already made about this gathering.

        A flow id is looked up scoped to this popup. Without that scoping the
        parameter would copy any flow whose id you could name, including
        another gathering's `open_checkout_signing_secret` — the key an
        external thank-you page verifies orders against.
        """
        from app.api.popup.models import Popups  # noqa: PLC0415

        if start_from == START_FRESH:
            return StartingPoint(kind=START_FRESH, name=None, values={})

        if start_from is None and not bootstrap_from_popup:
            return StartingPoint(kind=START_FRESH, name=None, values={})

        if start_from:
            try:
                source_id = uuid.UUID(str(start_from))
            except ValueError:
                raise ValueError("start_from is not a way in") from None
            source = session.exec(
                select(SalesFlows).where(
                    SalesFlows.id == source_id,
                    SalesFlows.popup_id == popup_id,
                )
            ).first()
            if source is None:
                raise ValueError("start_from is not a way into this gathering")
            if source.type != flow_type:
                raise ValueError(
                    "Source sales flow must have the same type as the new sales flow"
                )
            return StartingPoint(kind="flow", name=source.name, values=_attrs(source))

        if not bootstrap_from_popup:
            return StartingPoint(kind=START_FRESH, name=None, values={})

        # Default-flow provisioning is intentionally different from public
        # creation: it happens alongside a popup, before that popup has a
        # sibling flow, and preserves the popup-derived bootstrap settings.
        source = self.get_default_flow(session, popup_id)
        if source is not None and exclude_flow_id and source.id == exclude_flow_id:
            source = None
        if source is None:
            popup = session.get(Popups, popup_id)
            if popup is None:
                return StartingPoint(kind="none", name=None, values={})
            return StartingPoint(kind="popup", name=None, values=_attrs(popup))
        return StartingPoint(kind="primary", name=source.name, values=_attrs(source))

    def seed_config(
        self,
        session: Session,
        flow: SalesFlows,
        popup_id: uuid.UUID,
        *,
        start_from: str | None = None,
        bootstrap_from_popup: bool = False,
    ) -> SalesFlows:
        """Fill the flow's unset channel configuration from its starting point.

        Only columns the caller left unset are filled, so an explicit value
        always wins. This is a one-time copy, not a read-through: editing the
        source afterwards never reaches this flow (slice 7).

        What it copies depends on the NEW flow's type, not the source's. The
        source can be a different kind of door entirely: an event that sells
        directly gaining a way in people apply to. Copying blind handed that
        flow the source's success URL, cancel URL and signing secret —
        settings it can never read — while leaving every application setting
        empty, because the source had none to give. The wrong half arrived and
        the right half did not.

        Anything a flow of this type cannot use is left NULL, which is the
        honest state: nobody has decided it yet.
        """
        from app.api.sales_flow.schemas import fields_for  # noqa: PLC0415

        start = self.resolve_start(
            session,
            popup_id,
            flow.type,
            start_from,
            exclude_flow_id=flow.id,
            bootstrap_from_popup=bootstrap_from_popup,
        )

        for name in fields_for(flow.type):
            if getattr(flow, name, None) is None:
                setattr(flow, name, start.values.get(name))

        # Copied the same way but deliberately not in EFFECTIVE_CONFIG_FIELDS:
        # that tuple is what the flow settings form renders, and a raw JSONB
        # blob is not a setting anyone edits in a row of switches.
        if flow.theme_config is None:
            flow.theme_config = start.values.get("theme_config")
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
