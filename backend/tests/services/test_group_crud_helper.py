"""Integration tests for group_crud.get_human_group_ids — T-gr-009.

These tests use the real DB (testcontainers session-scoped fixture) to
verify the helper returns the correct set of group UUIDs for a human in
a given popup.
"""

from __future__ import annotations

import uuid

from sqlmodel import Session

from app.api.group.crud import groups_crud
from app.api.group.models import GroupMembers, Groups
from app.api.human.models import Humans
from app.api.popup.models import Popups
from app.api.tenant.models import Tenants


def _make_group(
    db: Session,
    tenant: Tenants,
    popup: Popups,
    *,
    slug: str | None = None,
) -> Groups:
    g = Groups(
        tenant_id=tenant.id,
        popup_id=popup.id,
        name=f"Group {uuid.uuid4().hex[:6]}",
        slug=slug or f"grp-{uuid.uuid4().hex[:8]}",
    )
    db.add(g)
    db.flush()
    return g


def _add_member(db: Session, group: Groups, human: Humans) -> None:
    db.add(
        GroupMembers(
            tenant_id=group.tenant_id,
            group_id=group.id,
            human_id=human.id,
        )
    )
    db.flush()


class TestGetHumanGroupIds:
    """group_crud.get_human_group_ids returns correct IDs."""

    def test_human_in_two_groups_returns_both(
        self, db: Session, tenant_a: Tenants
    ) -> None:
        popup = Popups(
            name=f"grpids-{uuid.uuid4().hex[:6]}",
            slug=f"grpids-{uuid.uuid4().hex[:8]}",
            tenant_id=tenant_a.id,
        )
        db.add(popup)
        db.flush()

        human = Humans(
            tenant_id=tenant_a.id,
            email=f"grpids-{uuid.uuid4().hex[:8]}@test.com",
        )
        db.add(human)
        db.flush()

        g1 = _make_group(db, tenant_a, popup)
        g2 = _make_group(db, tenant_a, popup)
        _add_member(db, g1, human)
        _add_member(db, g2, human)
        db.commit()

        result = groups_crud.get_human_group_ids(db, human.id, popup.id)

        assert g1.id in result
        assert g2.id in result
        assert len(result) == 2

    def test_human_not_in_any_group_returns_empty_set(
        self, db: Session, tenant_a: Tenants
    ) -> None:
        popup = Popups(
            name=f"grpids2-{uuid.uuid4().hex[:6]}",
            slug=f"grpids2-{uuid.uuid4().hex[:8]}",
            tenant_id=tenant_a.id,
        )
        db.add(popup)
        db.flush()

        human = Humans(
            tenant_id=tenant_a.id,
            email=f"grpids2-{uuid.uuid4().hex[:8]}@test.com",
        )
        db.add(human)
        db.commit()

        result = groups_crud.get_human_group_ids(db, human.id, popup.id)

        assert result == set()

    def test_scoped_to_popup(self, db: Session, tenant_a: Tenants) -> None:
        """Groups from a different popup must NOT be included."""
        popup_a = Popups(
            name=f"scope-pa-{uuid.uuid4().hex[:6]}",
            slug=f"scope-pa-{uuid.uuid4().hex[:8]}",
            tenant_id=tenant_a.id,
        )
        popup_b = Popups(
            name=f"scope-pb-{uuid.uuid4().hex[:6]}",
            slug=f"scope-pb-{uuid.uuid4().hex[:8]}",
            tenant_id=tenant_a.id,
        )
        db.add(popup_a)
        db.add(popup_b)
        db.flush()

        human = Humans(
            tenant_id=tenant_a.id,
            email=f"scope-{uuid.uuid4().hex[:8]}@test.com",
        )
        db.add(human)
        db.flush()

        g_in_a = _make_group(db, tenant_a, popup_a)
        g_in_b = _make_group(db, tenant_a, popup_b)
        _add_member(db, g_in_a, human)
        _add_member(db, g_in_b, human)
        db.commit()

        result = groups_crud.get_human_group_ids(db, human.id, popup_a.id)

        assert g_in_a.id in result
        assert g_in_b.id not in result
