"""Tests for the audit log: the record/find CRUD and the ticket-event wiring.

The audit row must be written in the same transaction as the action it
describes, must survive deletion of the entity it references, and must be
filterable by entity (per-attendee history) and action (global feed).
"""

import uuid
from decimal import Decimal

from sqlmodel import Session

from app.api.attendee import crud as attendee_crud
from app.api.attendee.models import AttendeeProducts, Attendees
from app.api.audit_log.actor import AuditActor, AuditActorType, AuditSource
from app.api.audit_log.constants import AuditAction, AuditEntityType
from app.api.audit_log.crud import audit_logs_crud
from app.api.human.models import Humans
from app.api.popup.models import Popups
from app.api.product.models import Products
from app.api.tenant.models import Tenants


def _actor(actor_id: uuid.UUID | None = None) -> AuditActor:
    return AuditActor(
        type=AuditActorType.USER,
        source=AuditSource.BACKOFFICE,
        id=actor_id or uuid.uuid4(),
        email="admin@test.com",
        name="Admin Tester",
    )

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _make_product(db: Session, tenant: Tenants, popup: Popups) -> Products:
    product = Products(
        id=uuid.uuid4(),
        tenant_id=tenant.id,
        popup_id=popup.id,
        name=f"Audit Product {uuid.uuid4().hex[:6]}",
        slug=f"audit-prod-{uuid.uuid4().hex[:6]}",
        price=Decimal("10"),
        category="ticket",
    )
    db.add(product)
    db.commit()
    db.refresh(product)
    return product


def _make_attendee(db: Session, tenant: Tenants, popup: Popups) -> Attendees:
    human = Humans(
        id=uuid.uuid4(),
        tenant_id=tenant.id,
        email=f"audit-{uuid.uuid4().hex[:8]}@test.com",
        first_name="Audit",
        last_name="Test",
    )
    db.add(human)
    db.commit()
    db.refresh(human)

    attendee = Attendees(
        id=uuid.uuid4(),
        tenant_id=tenant.id,
        popup_id=popup.id,
        human_id=human.id,
        name="Audit Attendee",
        category="main",
    )
    db.add(attendee)
    db.commit()
    db.refresh(attendee)
    return attendee


def _make_ticket(
    db: Session, tenant: Tenants, attendee: Attendees, product: Products
) -> AttendeeProducts:
    ticket = AttendeeProducts(
        id=uuid.uuid4(),
        tenant_id=tenant.id,
        attendee_id=attendee.id,
        product_id=product.id,
        check_in_code=f"AU{uuid.uuid4().hex[:6].upper()}",
    )
    db.add(ticket)
    db.commit()
    db.refresh(ticket)
    return ticket


# ---------------------------------------------------------------------------
# record / find
# ---------------------------------------------------------------------------


class TestRecordAndFind:
    def test_record_and_filter_by_entity_and_action(
        self, db: Session, tenant_a: Tenants, popup_tenant_a: Popups
    ) -> None:
        entity_a = uuid.uuid4()
        entity_b = uuid.uuid4()
        actor = _actor()

        audit_logs_crud.record(
            db,
            tenant_id=tenant_a.id,
            actor=actor,
            action=AuditAction.TICKET_SWAP,
            entity_type=AuditEntityType.ATTENDEE,
            entity_id=entity_a,
            entity_label="Attendee A",
            popup_id=popup_tenant_a.id,
            details={"old_product_name": "Week 1", "new_product_name": "Week 2"},
        )
        audit_logs_crud.record(
            db,
            tenant_id=tenant_a.id,
            actor=actor,
            action=AuditAction.TICKET_REMOVE,
            entity_type=AuditEntityType.ATTENDEE,
            entity_id=entity_b,
            entity_label="Attendee B",
            popup_id=popup_tenant_a.id,
        )
        db.commit()

        by_entity, total = audit_logs_crud.find(db, entity_id=entity_a)
        assert total == 1
        assert by_entity[0].action == AuditAction.TICKET_SWAP
        assert by_entity[0].details == {
            "old_product_name": "Week 1",
            "new_product_name": "Week 2",
        }

        by_action, total_action = audit_logs_crud.find(
            db, action=AuditAction.TICKET_REMOVE, popup_id=popup_tenant_a.id
        )
        assert total_action == 1
        assert by_action[0].entity_id == entity_b


# ---------------------------------------------------------------------------
# ticket-event wiring (atomic with the mutation)
# ---------------------------------------------------------------------------


class TestTicketEventWiring:
    def test_swap_emits_audit_log(
        self, db: Session, tenant_a: Tenants, popup_tenant_a: Popups
    ) -> None:
        old_product = _make_product(db, tenant_a, popup_tenant_a)
        new_product = _make_product(db, tenant_a, popup_tenant_a)
        attendee = _make_attendee(db, tenant_a, popup_tenant_a)
        ticket = _make_ticket(db, tenant_a, attendee, old_product)
        actor = _actor()

        attendee_crud.attendees_crud.swap_ticket_product(
            db,
            attendee_id=attendee.id,
            ticket_id=ticket.id,
            new_product_id=new_product.id,
            actor=actor,
        )

        logs, total = audit_logs_crud.find(db, entity_id=attendee.id)
        assert total == 1
        log = logs[0]
        assert log.action == AuditAction.TICKET_SWAP
        assert log.actor_id == actor.id
        assert log.actor_type == "user"
        assert log.source == "backoffice"
        assert log.entity_label == attendee.name
        assert log.popup_id == attendee.popup_id
        assert log.details is not None
        assert log.details["old_product_id"] == str(old_product.id)
        assert log.details["new_product_id"] == str(new_product.id)

    def test_add_emits_audit_log(
        self, db: Session, tenant_a: Tenants, popup_tenant_a: Popups
    ) -> None:
        product = _make_product(db, tenant_a, popup_tenant_a)
        attendee = _make_attendee(db, tenant_a, popup_tenant_a)

        attendee_crud.attendees_crud.add_product(
            db,
            attendee_id=attendee.id,
            product_id=product.id,
            tenant_id=tenant_a.id,
            actor=_actor(),
        )

        logs, total = audit_logs_crud.find(db, entity_id=attendee.id)
        assert total == 1
        assert logs[0].action == AuditAction.TICKET_ADD
        assert logs[0].details is not None
        assert logs[0].details["product_id"] == str(product.id)

    def test_remove_emits_log_that_survives_ticket_deletion(
        self, db: Session, tenant_a: Tenants, popup_tenant_a: Popups
    ) -> None:
        product = _make_product(db, tenant_a, popup_tenant_a)
        attendee = _make_attendee(db, tenant_a, popup_tenant_a)
        ticket = _make_ticket(db, tenant_a, attendee, product)

        attendee_crud.attendees_crud.remove_product(
            db,
            attendee_id=attendee.id,
            ticket_id=ticket.id,
            actor=_actor(),
        )

        assert db.get(AttendeeProducts, ticket.id) is None
        logs, total = audit_logs_crud.find(db, entity_id=attendee.id)
        assert total == 1
        assert logs[0].action == AuditAction.TICKET_REMOVE
        assert logs[0].details is not None
        assert logs[0].details["product_id"] == str(product.id)

    def test_swap_without_actor_emits_no_log(
        self, db: Session, tenant_a: Tenants, popup_tenant_a: Popups
    ) -> None:
        old_product = _make_product(db, tenant_a, popup_tenant_a)
        new_product = _make_product(db, tenant_a, popup_tenant_a)
        attendee = _make_attendee(db, tenant_a, popup_tenant_a)
        ticket = _make_ticket(db, tenant_a, attendee, old_product)

        attendee_crud.attendees_crud.swap_ticket_product(
            db,
            attendee_id=attendee.id,
            ticket_id=ticket.id,
            new_product_id=new_product.id,
        )

        _, total = audit_logs_crud.find(db, entity_id=attendee.id)
        assert total == 0
