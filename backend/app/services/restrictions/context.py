"""Restriction evaluation context (sdd/sales-flows design D5).

`PurchaseContext` owns ALL I/O for restriction evaluation — the evaluator
itself stays pure. Mirrors `services/approval/calculator.py`'s split between
a DB-free calculator and its DB-bound `recalculate_status` caller.

Built once per request via `build_context` and reused across every leaf
predicate resolved during that request (the `has_product` lookup is
memoized on `self` — same pattern as design D8's "memoized on
PurchaseContext only").
"""

import uuid
from dataclasses import dataclass, field
from typing import TYPE_CHECKING, Any

from loguru import logger
from sqlmodel import Session

from app.services.restrictions.schemas import UNRESOLVED, HasProductScope

if TYPE_CHECKING:
    from app.api.application.models import Applications
    from app.api.human.schemas import HumanPublic
    from app.api.popup.models import Popups
    from app.api.sales_flow.models import SalesFlows


@dataclass
class PurchaseContext:
    """Everything a restriction rule may reference for one purchase/catalog
    request. Anonymous-path guard (design): `human_profile_field` is
    UNRESOLVED whenever `human` is None — `type=direct` flows never carry
    one to begin with (rejected at save time, see
    `schemas.assert_restriction_rule_allowed_for_type`), so this only bites
    an `upsale`/`application` flow's genuinely anonymous request, where
    fail-closed is exactly the intended behavior.
    """

    session: Session
    popup: "Popups"
    flow: "SalesFlows"
    human: "HumanPublic | None" = None
    application: "Applications | None" = None
    buyer_form_data: dict | None = None
    buyer_email: str | None = None
    _has_product_cache: dict[tuple[str, str], bool] = field(default_factory=dict)

    def form_answer(self, field_name: str) -> Any:
        """`application.custom_fields` on the authenticated path,
        `buyer_form_data` (the anonymous checkout's `buyer.form_data`) on the
        direct/upsale path. Whichever is present wins; an application always
        implies the authenticated shape."""
        source = (
            self.application.custom_fields
            if self.application is not None
            else self.buyer_form_data
        )
        if not source or field_name not in source:
            return UNRESOLVED
        return source[field_name]

    def human_profile_field(self, field_name: str) -> Any:
        if self.human is None:
            return UNRESOLVED
        return getattr(self.human, field_name, UNRESOLVED)

    def has_product(self, scope: str, value: str) -> Any:
        cache_key = (scope, value)
        if cache_key in self._has_product_cache:
            return self._has_product_cache[cache_key]

        # risk-001: buyer_email is unverified — only an authenticated human
        # may resolve purchase history. Fails closed otherwise.
        if self.human is None:
            self._has_product_cache[cache_key] = UNRESOLVED
            return UNRESOLVED

        human_id = self.human.id
        if scope == HasProductScope.category.value:
            result = _holds_category(self.session, self.popup.id, human_id, value)
        else:
            try:
                product_id = uuid.UUID(value)
            except ValueError:
                logger.warning("has_product: non-UUID value {!r} — denying", value)
                self._has_product_cache[cache_key] = UNRESOLVED
                return UNRESOLVED
            result = _holds_product(self.session, self.popup.id, human_id, product_id)

        self._has_product_cache[cache_key] = result
        return result


def _holds_product(
    session: Session, popup_id: uuid.UUID, human_id: uuid.UUID, product_id: uuid.UUID
) -> bool:
    """Whether the human owns an active allocated ticket for this product."""
    from sqlalchemy import exists as sa_exists
    from sqlmodel import select

    from app.api.attendee.models import AttendeeProducts, Attendees

    stmt = select(
        sa_exists().where(
            AttendeeProducts.product_id == product_id,
            AttendeeProducts.attendee_id.is_not(None),
            AttendeeProducts.revoked_at.is_(None),
            AttendeeProducts.product_category_snapshot == "ticket",
            AttendeeProducts.attendee_id.in_(  # type: ignore[union-attr]
                select(Attendees.id).where(
                    Attendees.human_id == human_id,
                    Attendees.popup_id == popup_id,
                )
            ),
        )
    )
    return session.exec(stmt).one()


def _holds_category(
    session: Session, popup_id: uuid.UUID, human_id: uuid.UUID, category: str
) -> bool:
    """Whether the human owns an active ticket snapshot in this category."""
    from sqlalchemy import exists as sa_exists
    from sqlmodel import select

    from app.api.attendee.models import AttendeeProducts, Attendees

    stmt = select(
        sa_exists().where(
            category == "ticket",
            AttendeeProducts.attendee_id.is_not(None),
            AttendeeProducts.revoked_at.is_(None),
            AttendeeProducts.product_category_snapshot == category,
            AttendeeProducts.attendee_id.in_(  # type: ignore[union-attr]
                select(Attendees.id).where(
                    Attendees.human_id == human_id,
                    Attendees.popup_id == popup_id,
                )
            ),
        )
    )
    return session.exec(stmt).one()


def build_context(
    session: Session,
    popup: "Popups",
    flow: "SalesFlows",
    *,
    human: "HumanPublic | None" = None,
    application: "Applications | None" = None,
    buyer_form_data: dict | None = None,
    buyer_email: str | None = None,
) -> PurchaseContext:
    """Construct a `PurchaseContext` for one request. Thin factory kept
    separate from the dataclass itself so call sites read as intent
    (`build_context(...)`) rather than a bare constructor call."""
    return PurchaseContext(
        session=session,
        popup=popup,
        flow=flow,
        human=human,
        application=application,
        buyer_form_data=buyer_form_data,
        buyer_email=buyer_email,
    )
