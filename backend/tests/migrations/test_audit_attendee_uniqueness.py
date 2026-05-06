"""Tests for audit_attendee_uniqueness.py script.

TDD phase: RED — these tests are written BEFORE the script exists.
They will FAIL until the script is created.

Spec: C7/Audit-Audit
Design: §Pre-migration audit script
"""

import uuid
from unittest.mock import patch

import pytest
from sqlmodel import Session

from app.api.attendee.models import Attendees


def _make_attendee(
    db: Session,
    tenant_id: uuid.UUID,
    popup_id: uuid.UUID,
    human_id: uuid.UUID,
    application_id: uuid.UUID | None = None,
    name: str = "Test",
) -> Attendees:
    """Create a minimal attendee row for testing."""
    attendee = Attendees(
        tenant_id=tenant_id,
        popup_id=popup_id,
        human_id=human_id,
        application_id=application_id,
        name=name,
        category="main",
        check_in_code=f"AUD{uuid.uuid4().hex[:5].upper()}",
        email=f"test-{uuid.uuid4().hex[:6]}@example.com",
    )
    db.add(attendee)
    db.commit()
    db.refresh(attendee)
    return attendee


class TestAuditAttendeeUniquenesScript:
    """Tests for the pre-migration audit script."""

    def test_audit_exits_zero_when_no_duplicates(
        self, db: Session, tenant_a, popup_tenant_a
    ) -> None:
        """Audit script returns 0 when no duplicate (human_id, popup_id) direct-sale attendees exist."""
        from scripts.audit_attendee_uniqueness import main as audit_main

        unique_human_id = uuid.uuid4()
        _make_attendee(
            db,
            tenant_id=tenant_a.id,
            popup_id=popup_tenant_a.id,
            human_id=unique_human_id,
            application_id=None,
            name="Unique Human",
        )

        with patch("scripts.audit_attendee_uniqueness.engine") as mock_engine:
            mock_engine.connect = db.connection

            # We patch get_session to use the test db
            with patch(
                "scripts.audit_attendee_uniqueness.Session",
            ) as mock_session_cls:
                mock_session_cls.return_value.__enter__ = lambda s: db
                mock_session_cls.return_value.__exit__ = lambda s, *a: None
                result = audit_main()

        assert result == 0, "Audit should exit 0 when no duplicates exist"

    def test_audit_exits_one_when_duplicates_exist(
        self, db: Session, tenant_a, popup_tenant_a
    ) -> None:
        """Audit script returns 1 when duplicate (human_id, popup_id) pairs exist."""
        from scripts.audit_attendee_uniqueness import main as audit_main

        dup_human_id = uuid.uuid4()
        dup_popup_id = popup_tenant_a.id

        # Create two attendees with the same (human_id, popup_id), application_id=NULL
        _make_attendee(
            db,
            tenant_id=tenant_a.id,
            popup_id=dup_popup_id,
            human_id=dup_human_id,
            application_id=None,
            name="Dup Human 1",
        )
        _make_attendee(
            db,
            tenant_id=tenant_a.id,
            popup_id=dup_popup_id,
            human_id=dup_human_id,
            application_id=None,
            name="Dup Human 2",
        )

        with patch(
            "scripts.audit_attendee_uniqueness.Session",
        ) as mock_session_cls:
            mock_session_cls.return_value.__enter__ = lambda s: db
            mock_session_cls.return_value.__exit__ = lambda s, *a: None
            result = audit_main()

        assert result == 1, "Audit should exit 1 when duplicates exist"

    def test_audit_ignores_application_attendees_as_duplicates(
        self, db: Session, tenant_a, popup_tenant_a
    ) -> None:
        """Attendees with application_id set are NOT flagged as direct-sale duplicates."""
        from scripts.audit_attendee_uniqueness import main as audit_main

        human_id = uuid.uuid4()
        # application_id attendee — should NOT trigger duplicate detection
        _make_attendee(
            db,
            tenant_id=tenant_a.id,
            popup_id=popup_tenant_a.id,
            human_id=human_id,
            application_id=uuid.uuid4(),  # has application_id
            name="App Attendee 1",
        )
        _make_attendee(
            db,
            tenant_id=tenant_a.id,
            popup_id=popup_tenant_a.id,
            human_id=human_id,
            application_id=uuid.uuid4(),  # different application
            name="App Attendee 2",
        )

        with patch(
            "scripts.audit_attendee_uniqueness.Session",
        ) as mock_session_cls:
            mock_session_cls.return_value.__enter__ = lambda s: db
            mock_session_cls.return_value.__exit__ = lambda s, *a: None
            result = audit_main()

        assert result == 0, (
            "Application-linked attendees with same (human_id, popup_id) "
            "should NOT be flagged as duplicates"
        )
