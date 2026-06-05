"""Tests for T-gr-019: Whitelist resolution hook on human signup.

After a human is created in create_internal, the system must check
group_whitelisted_emails for their email and add them to matching groups.
This is best-effort (never blocks signup on failure).

Spec: REQ-GR-013 "Whitelist signup resolution — non-blocking".
Design: Decision 1g.
"""

from __future__ import annotations

import uuid
from unittest.mock import patch

import pytest
from sqlmodel import Session, select

from app.api.group.models import GroupMembers, GroupWhitelistedEmails, Groups
from app.api.human.crud import HumansCRUD, humans_crud
from app.api.human.models import Humans
from app.api.human.schemas import HumanCreate
from app.api.popup.models import Popups
from app.api.tenant.models import Tenants

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _make_popup(db: Session, tenant: Tenants) -> Popups:
    popup = Popups(
        name=f"WhitelistHook {uuid.uuid4().hex[:6]}",
        slug=f"wlhook-{uuid.uuid4().hex[:8]}",
        tenant_id=tenant.id,
    )
    db.add(popup)
    db.commit()
    db.refresh(popup)
    return popup


def _make_group(db: Session, tenant: Tenants, popup: Popups) -> Groups:
    g = Groups(
        tenant_id=tenant.id,
        popup_id=popup.id,
        name=f"Whitelist Group {uuid.uuid4().hex[:6]}",
        slug=f"wl-grp-{uuid.uuid4().hex[:8]}",
    )
    db.add(g)
    db.commit()
    db.refresh(g)
    return g


def _whitelist(db: Session, group: Groups, email: str) -> None:
    wl = GroupWhitelistedEmails(
        tenant_id=group.tenant_id,
        group_id=group.id,
        email=email.lower(),
    )
    db.add(wl)
    db.commit()


def _is_member(db: Session, group_id: uuid.UUID, human_id: uuid.UUID) -> bool:
    row = db.exec(
        select(GroupMembers).where(
            GroupMembers.group_id == group_id,
            GroupMembers.human_id == human_id,
        )
    ).first()
    return row is not None


def _create_human(db: Session, tenant: Tenants, email: str) -> Humans:
    """Create a human via create_internal (canonical signup path)."""
    human_data = HumanCreate(email=email)
    return humans_crud.create_internal(db, human_data, tenant.id)


# ---------------------------------------------------------------------------
# T-gr-019: Whitelist hook
# ---------------------------------------------------------------------------


class TestWhitelistResolutionHook:
    """create_internal adds humans to whitelisted groups on signup (T-gr-019)."""

    def test_human_added_to_whitelisted_group_on_signup(
        self, db: Session, tenant_a: Tenants
    ) -> None:
        """Human is added to group_members when their email is whitelisted.

        RED: hook doesn't exist in create_internal yet.
        """
        popup = _make_popup(db, tenant_a)
        group = _make_group(db, tenant_a, popup)
        email = f"wlhook-{uuid.uuid4().hex[:8]}@test.com"
        _whitelist(db, group, email)

        human = _create_human(db, tenant_a, email)

        assert _is_member(db, group.id, human.id), (
            "Human whose email is whitelisted for a group must be added to "
            "group_members upon signup via create_internal."
        )

    def test_human_not_added_to_group_without_whitelist_entry(
        self, db: Session, tenant_a: Tenants
    ) -> None:
        """Human NOT in any whitelist is NOT added to any group.

        Triangulation: whitelist resolution only fires for matching emails.
        """
        popup = _make_popup(db, tenant_a)
        group = _make_group(db, tenant_a, popup)
        # Whitelist a different email
        _whitelist(db, group, "other-user@example.com")

        email = f"nowl-{uuid.uuid4().hex[:8]}@test.com"
        human = _create_human(db, tenant_a, email)

        assert not _is_member(db, group.id, human.id), (
            "Human not in any whitelist must NOT be added to groups."
        )

    def test_whitelist_case_insensitive(
        self, db: Session, tenant_a: Tenants
    ) -> None:
        """Whitelist matching is case-insensitive (spec REQ-GR-031)."""
        popup = _make_popup(db, tenant_a)
        group = _make_group(db, tenant_a, popup)
        email = f"CaseTest-{uuid.uuid4().hex[:6]}@EXAMPLE.COM"
        # Store whitelist in mixed case
        wl = GroupWhitelistedEmails(
            tenant_id=group.tenant_id,
            group_id=group.id,
            email=email,  # NOT lowercased — test the comparison
        )
        db.add(wl)
        db.commit()

        # Human signs up with lowercase version
        human = _create_human(db, tenant_a, email.lower())

        assert _is_member(db, group.id, human.id), (
            "Whitelist resolution must be case-insensitive."
        )

    def test_idempotent_already_member(
        self, db: Session, tenant_a: Tenants
    ) -> None:
        """Re-running create_internal for a human already in groups is a no-op.

        Idempotency: no duplicate group_members rows.
        """
        popup = _make_popup(db, tenant_a)
        group = _make_group(db, tenant_a, popup)
        email = f"idempotent-{uuid.uuid4().hex[:8]}@test.com"
        _whitelist(db, group, email)

        human = _create_human(db, tenant_a, email)
        # Should be member now
        assert _is_member(db, group.id, human.id)

        # Simulate "running the hook again" directly
        from app.api.human.crud import resolve_whitelist_memberships
        resolve_whitelist_memberships(db, human)

        # No duplicate rows
        rows = list(db.exec(
            select(GroupMembers).where(
                GroupMembers.group_id == group.id,
                GroupMembers.human_id == human.id,
            )
        ).all())
        assert len(rows) == 1, "Re-running hook must not create duplicate rows"

    def test_hook_failure_does_not_block_signup(
        self, db: Session, tenant_a: Tenants
    ) -> None:
        """DB error in whitelist resolution must NOT prevent human creation.

        Design Decision 1g: best-effort, failure logged and swallowed.
        """
        popup = _make_popup(db, tenant_a)
        group = _make_group(db, tenant_a, popup)
        email = f"hookfail-{uuid.uuid4().hex[:8]}@test.com"
        _whitelist(db, group, email)

        # Patch the whitelist resolution to raise an exception
        with patch(
            "app.api.human.crud.resolve_whitelist_memberships",
            side_effect=Exception("Simulated DB error in whitelist resolution"),
        ):
            # Signup MUST still succeed even though hook fails
            human = _create_human(db, tenant_a, email)

        assert human.id is not None, "Human must be created even if hook raises"
        # Human is NOT a member (hook failed) but they exist
        assert not _is_member(db, group.id, human.id), (
            "Human must NOT be in group if hook failed, but they must exist"
        )

    def test_multiple_whitelist_groups_all_resolved(
        self, db: Session, tenant_a: Tenants
    ) -> None:
        """Human whitelisted in multiple groups is added to all of them.

        Triangulation: resolves multiple matching groups.
        """
        popup = _make_popup(db, tenant_a)
        group1 = _make_group(db, tenant_a, popup)
        group2 = _make_group(db, tenant_a, popup)
        email = f"multiwl-{uuid.uuid4().hex[:8]}@test.com"
        _whitelist(db, group1, email)
        _whitelist(db, group2, email)

        human = _create_human(db, tenant_a, email)

        assert _is_member(db, group1.id, human.id), "Must be in group1"
        assert _is_member(db, group2.id, human.id), "Must be in group2"
