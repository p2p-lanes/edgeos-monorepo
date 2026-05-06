"""Tests for audit_attendee_uniqueness.py script.

TDD: RED until script implemented; GREEN after.

Tests use real DB rows via the shared testcontainer postgres engine.
Human rows are created to satisfy the FK on attendees.human_id.

Spec: C7/Audit-Audit
Design: §Pre-migration audit script
"""

import uuid

import pytest
from sqlalchemy.engine import Engine
from sqlmodel import Session

from app.api.attendee.models import Attendees
from app.api.human.models import Humans


def _make_human(db: Session, tenant_id: uuid.UUID) -> Humans:
    h = Humans(
        tenant_id=tenant_id,
        email=f"h-audit-{uuid.uuid4().hex[:8]}@example.com",
        first_name="Test",
        last_name="Human",
    )
    db.add(h)
    db.commit()
    db.refresh(h)
    return h


def _make_direct_attendee(
    db: Session,
    tenant_id: uuid.UUID,
    popup_id: uuid.UUID,
    human_id: uuid.UUID,
    name: str = "Test",
) -> Attendees:
    """Create a direct-sale (application_id=NULL) attendee row."""
    attendee = Attendees(
        tenant_id=tenant_id,
        popup_id=popup_id,
        human_id=human_id,
        application_id=None,
        name=name,
        category="main",
        check_in_code=f"AUD{uuid.uuid4().hex[:5].upper()}",
        email=f"da-{uuid.uuid4().hex[:6]}@example.com",
    )
    db.add(attendee)
    db.commit()
    db.refresh(attendee)
    return attendee


class TestAuditAttendeeUniquenessScript:
    """Tests for audit_attendee_uniqueness.main(engine)."""

    def test_audit_exits_zero_when_no_duplicates(
        self, db: Session, test_engine: Engine, tenant_a, popup_tenant_a
    ) -> None:
        """Audit returns 0 when no duplicate (human_id, popup_id) direct-sale rows exist."""
        from scripts.audit_attendee_uniqueness import main as audit_main

        human = _make_human(db, tenant_a.id)
        _make_direct_attendee(
            db,
            tenant_id=tenant_a.id,
            popup_id=popup_tenant_a.id,
            human_id=human.id,
            name="Unique Human",
        )

        result = audit_main(engine=test_engine)
        assert result == 0, "Audit should exit 0 when no duplicates exist"

    @pytest.mark.skip(
        reason=(
            "Post-migration: ux_attendees_human_popup_direct prevents INSERT of duplicates. "
            "This test validates pre-migration audit behavior that is no longer reachable "
            "once migration 0044_ticket_entity has been applied to the test DB."
        )
    )
    def test_audit_exits_one_when_duplicates_exist(
        self, db: Session, test_engine: Engine, tenant_a, popup_tenant_a
    ) -> None:
        """Audit returns 1 when duplicate (human_id, popup_id, app_id=NULL) rows exist.

        NOTE: This test requires a pre-migration DB state. After migration 0044
        applies ux_attendees_human_popup_direct, the ORM-level INSERT will raise
        IntegrityError before the second duplicate row can be created.
        The audit script (run BEFORE migration in production) remains valid;
        the test scenario is preserved here for documentation purposes only.
        """
        from scripts.audit_attendee_uniqueness import main as audit_main

        dup_human = _make_human(db, tenant_a.id)

        _make_direct_attendee(
            db,
            tenant_id=tenant_a.id,
            popup_id=popup_tenant_a.id,
            human_id=dup_human.id,
            name="Dup 1",
        )
        _make_direct_attendee(
            db,
            tenant_id=tenant_a.id,
            popup_id=popup_tenant_a.id,
            human_id=dup_human.id,
            name="Dup 2",
        )

        result = audit_main(engine=test_engine)
        assert result == 1, "Audit should exit 1 when duplicates exist"
