"""Per-flow reminder cadence and dedupe key (sdd/sales-flows slice 10, task
10.3/10.4).

The dispatcher's dispatch unit moved from popup to sales flow: cadence is
resolved per flow via `EffectiveFlowConfig` (`sales_flow/resolver.py::
build_effective_config` — its first production consumer), and the
`email_logs` dedupe key gains the flow dimension `(template_type, popup_id,
sales_flow_id, recipient_key)`.

Coverage:
- A flow-level cadence applies only to that flow; the default flow's copied
  popup cadence remains unaffected.
- Two flows of the same popup, same buyer email: abandoned-cart reminder
  history is independent per flow (the dedupe key's flow dimension).
- Dedupe across the backfill boundary: a legacy `email_logs` row with
  `sales_flow_id IS NULL` counts against the popup's DEFAULT flow (the
  migration-hazard mitigation's one-release OR-NULL match) but never against
  a non-default sibling flow.
- Dry-run baseline: `tests/test_reminder_dispatch.py`'s three pre-existing
  scenarios (single default-flow popups) pass UNCHANGED against this
  slice's code — see that file. That is this slice's dry-run count
  comparison for the common (single-flow) case: identical candidate counts
  and identical `email_logs` writes to the pre-slice-10 dispatcher.
"""

import asyncio
import uuid
from datetime import UTC, datetime, timedelta
from unittest.mock import AsyncMock, patch

from sqlmodel import Session, select

from app.api.application.models import Applications
from app.api.application.schemas import ApplicationStatus
from app.api.email_log.crud import email_logs_crud
from app.api.email_log.models import EmailLogs
from app.api.email_log.schemas import EmailLogStatus
from app.api.human.models import Humans
from app.api.payment.models import Payments
from app.api.payment.schemas import PaymentStatus
from app.api.popup.models import Popups
from app.api.sales_flow.crud import sales_flows_crud
from app.api.sales_flow.models import SalesFlows
from app.api.sales_flow.schemas import SalesFlowCreate
from app.api.tenant.models import Tenants
from app.services.reminder_dispatch import dispatch_reminders

DELIVER_TARGET = "app.services.email.service.EmailService._deliver_smtp"
ENGINE_TARGET = "app.core.db.engine"


def _make_popup(db: Session, tenant: Tenants, **reminder_config) -> Popups:
    popup = Popups(
        id=uuid.uuid4(),
        tenant_id=tenant.id,
        name=f"Flow Cadence Popup {uuid.uuid4().hex[:6]}",
        slug=f"flow-cadence-{uuid.uuid4().hex[:8]}",
        **reminder_config,
    )
    db.add(popup)
    db.flush()
    default_flow = sales_flows_crud.provision_default_flow(
        db,
        popup_id=popup.id,
        tenant_id=tenant.id,
        sale_type=popup.sale_type.value
        if hasattr(popup.sale_type, "value")
        else popup.sale_type,
    )
    db.commit()
    db.refresh(popup)
    db.refresh(default_flow)
    return popup, default_flow


def _make_flow(
    db: Session, tenant: Tenants, popup: Popups, *, slug: str, **overrides
) -> SalesFlows:
    flow = sales_flows_crud.create(
        db,
        SalesFlowCreate(popup_id=popup.id, slug=slug, name=slug, **overrides),
        tenant_id=tenant.id,
    )
    return flow


def _make_human(db: Session, tenant: Tenants, *, email: str | None = None) -> Humans:
    human = Humans(
        id=uuid.uuid4(),
        tenant_id=tenant.id,
        email=email or f"flow-cadence-{uuid.uuid4().hex[:8]}@test.com",
        first_name="Flow",
        last_name="Cadence",
    )
    db.add(human)
    db.commit()
    db.refresh(human)
    return human


def _make_application(
    db: Session,
    tenant: Tenants,
    popup: Popups,
    human: Humans,
    *,
    sales_flow_id: uuid.UUID | None,
    status: ApplicationStatus = ApplicationStatus.DRAFT,
    updated_days_ago: float = 0,
    now: datetime,
) -> Applications:
    application = Applications(
        id=uuid.uuid4(),
        tenant_id=tenant.id,
        popup_id=popup.id,
        sales_flow_id=sales_flow_id,
        human_id=human.id,
        status=status.value,
        updated_at=now - timedelta(days=updated_days_ago),
    )
    db.add(application)
    db.commit()
    db.refresh(application)
    return application


def _make_payment(
    db: Session,
    tenant: Tenants,
    popup: Popups,
    human: Humans,
    *,
    sales_flow_id: uuid.UUID | None,
    status: PaymentStatus,
    created_days_ago: float,
    now: datetime,
) -> Payments:
    """A payment resolved through its application's human (`_payment_buyer`'s
    primary path). The caller passes an existing `human` — `email` is unique
    per tenant, so the SAME buyer applying in two different flows of one
    popup must be the same `Humans` row, exactly as a real portal user would
    be."""
    application = Applications(
        id=uuid.uuid4(),
        tenant_id=tenant.id,
        popup_id=popup.id,
        sales_flow_id=sales_flow_id,
        human_id=human.id,
        status=ApplicationStatus.ACCEPTED.value,
    )
    db.add(application)
    db.commit()
    db.refresh(application)

    payment = Payments(
        id=uuid.uuid4(),
        tenant_id=tenant.id,
        popup_id=popup.id,
        sales_flow_id=sales_flow_id,
        application_id=application.id,
        buyer_email=human.email,
        status=status.value,
        amount=50,
        currency="USD",
        created_at=now - timedelta(days=created_days_ago),
    )
    db.add(payment)
    db.commit()
    db.refresh(payment)
    return payment


def _run(db: Session, test_engine, *, now: datetime) -> tuple[dict, AsyncMock]:
    deliver = AsyncMock(return_value=(True, None))
    with (
        patch(DELIVER_TARGET, deliver),
        patch(ENGINE_TARGET, test_engine),
    ):
        summary = asyncio.run(dispatch_reminders(db, now=now))
    return summary, deliver


def _sent_to(deliver: AsyncMock, email: str) -> int:
    return sum(1 for c in deliver.await_args_list if c.kwargs["to"] == email)


# ---------------------------------------------------------------------------
# Flow-level cadence override
# ---------------------------------------------------------------------------


def test_flow_cadence_override_applies_only_to_that_flow(
    db: Session, test_engine, tenant_a: Tenants
) -> None:
    now = datetime.now(UTC)
    popup, default_flow = _make_popup(db, tenant_a, abandoned_application_delay_days=10)
    # Flow B overrides to a much shorter delay than the popup default.
    flow_b = _make_flow(
        db, tenant_a, popup, slug="flow-b", abandoned_application_delay_days=1
    )

    default_human = _make_human(db, tenant_a)
    default_app = _make_application(
        db,
        tenant_a,
        popup,
        default_human,
        sales_flow_id=default_flow.id,
        updated_days_ago=3,
        now=now,
    )
    flow_b_human = _make_human(db, tenant_a)
    flow_b_app = _make_application(
        db,
        tenant_a,
        popup,
        flow_b_human,
        sales_flow_id=flow_b.id,
        updated_days_ago=3,
        now=now,
    )

    _, deliver = _run(db, test_engine, now=now)

    # 3 days old: past flow B's 1-day override, still short of the popup's
    # inherited 10-day default.
    assert _sent_to(deliver, flow_b_human.email) == 1
    assert _sent_to(deliver, default_human.email) == 0

    logs = list(db.exec(select(EmailLogs).where(EmailLogs.popup_id == popup.id)).all())
    assert {log.application_id for log in logs} == {flow_b_app.id}
    assert default_app.id not in {log.application_id for log in logs}


# ---------------------------------------------------------------------------
# Dedupe key includes the flow dimension
# ---------------------------------------------------------------------------


def test_dedupe_history_is_independent_per_flow_for_same_buyer_email(
    db: Session, test_engine, tenant_a: Tenants
) -> None:
    now = datetime.now(UTC)
    popup, default_flow = _make_popup(db, tenant_a, abandoned_cart_delay_days=1)
    flow_b = _make_flow(db, tenant_a, popup, slug="flow-b", abandoned_cart_delay_days=1)

    shared_human = _make_human(db, tenant_a)
    _make_payment(
        db,
        tenant_a,
        popup,
        shared_human,
        sales_flow_id=default_flow.id,
        status=PaymentStatus.EXPIRED,
        created_days_ago=2,
        now=now,
    )
    _make_payment(
        db,
        tenant_a,
        popup,
        shared_human,
        sales_flow_id=flow_b.id,
        status=PaymentStatus.EXPIRED,
        created_days_ago=2,
        now=now,
    )

    _, deliver = _run(db, test_engine, now=now)

    # Same buyer email, two DIFFERENT flows of the same popup: both must be
    # reminded independently — the dedupe key partitions by flow.
    assert _sent_to(deliver, shared_human.email) == 2

    default_stats = email_logs_crud.get_reminder_stats(
        db,
        template_type="abandoned_cart",
        popup_id=popup.id,
        sales_flow_id=default_flow.id,
        flow_is_default=True,
        to_email=shared_human.email,
    )
    flow_b_stats = email_logs_crud.get_reminder_stats(
        db,
        template_type="abandoned_cart",
        popup_id=popup.id,
        sales_flow_id=flow_b.id,
        flow_is_default=False,
        to_email=shared_human.email,
    )
    assert default_stats[0] == 1
    assert flow_b_stats[0] == 1


# ---------------------------------------------------------------------------
# Dedupe across the backfill boundary
# ---------------------------------------------------------------------------


def test_legacy_null_flow_log_counts_for_default_flow_only(
    db: Session, tenant_a: Tenants
) -> None:
    popup, default_flow = _make_popup(db, tenant_a, abandoned_cart_delay_days=1)
    flow_b = _make_flow(db, tenant_a, popup, slug="flow-b")

    email = f"legacy-{uuid.uuid4().hex[:8]}@test.com"
    # Simulate a pre-migration row the backfill could not (or a boundary run
    # could not yet) resolve to a concrete sales_flow_id.
    email_logs_crud.create(
        db,
        tenant_id=tenant_a.id,
        template_type="abandoned_cart",
        to_email=email,
        status=EmailLogStatus.SENT,
        popup_id=popup.id,
        sales_flow_id=None,
    )
    db.commit()

    default_stats = email_logs_crud.get_reminder_stats(
        db,
        template_type="abandoned_cart",
        popup_id=popup.id,
        sales_flow_id=default_flow.id,
        flow_is_default=True,
        to_email=email,
    )
    flow_b_stats = email_logs_crud.get_reminder_stats(
        db,
        template_type="abandoned_cart",
        popup_id=popup.id,
        sales_flow_id=flow_b.id,
        flow_is_default=False,
        to_email=email,
    )

    assert default_stats[0] == 1
    assert flow_b_stats[0] == 0
