"""Tests for the attendee-centric Portal directory.

Covers the fix that flips the directory from application-centric (one row per
accepted application, main applicant only) to attendee-centric (one row per
ticket-holding attendee, sourced from that attendee's own human):

- Companions (spouse/kid/...) holding a ticket appear as their OWN row.
- A companion is searchable by their OWN name, not the main applicant's.
- A main applicant with 0 tickets whose spouse holds the ticket → the spouse
  appears, the 0-ticket main does not.
- Only main + spouse are listed; kids (and any other categories) are excluded.
- info_not_shared masking + role/organization apply ONLY to the main applicant;
  companions show their own profile with blank role/org and no masking.
"""

import uuid
from decimal import Decimal

import pytest
from sqlmodel import Session

from app.api.application.crud import applications_crud
from app.api.application.models import Applications
from app.api.application.router import _build_directory_entry
from app.api.application.schemas import ApplicationStatus
from app.api.attendee.models import AttendeeProducts, Attendees
from app.api.attendee_category.models import AttendeeCategories
from app.api.human.models import Humans
from app.api.popup.models import Popups
from app.api.product.models import Products
from app.api.tenant.models import Tenants

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _popup(db: Session, tenant: Tenants) -> Popups:
    """A fresh popup per test — the session-scoped db has no rollback, so each
    test isolates itself by filtering the directory on its own popup_id."""
    popup = Popups(
        name="Directory Popup",
        slug=f"dir-popup-{uuid.uuid4().hex[:8]}",
        tenant_id=tenant.id,
    )
    db.add(popup)
    db.commit()
    db.refresh(popup)
    return popup


def _category(
    db: Session, popup: Popups, key: str, *, is_primary: bool
) -> AttendeeCategories:
    cat = AttendeeCategories(
        tenant_id=popup.tenant_id,
        popup_id=popup.id,
        key=key,
        label=key.capitalize(),
        is_primary=is_primary,
        enabled_in_passes_flow=True,
    )
    db.add(cat)
    db.commit()
    db.refresh(cat)
    return cat


def _human(db: Session, tenant: Tenants, first: str, last: str, **extra) -> Humans:
    human = Humans(
        id=uuid.uuid4(),
        tenant_id=tenant.id,
        email=f"{first.lower()}-{uuid.uuid4().hex[:6]}@test.com",
        first_name=first,
        last_name=last,
        **extra,
    )
    db.add(human)
    db.commit()
    db.refresh(human)
    return human


def _product(db: Session, popup: Popups, name: str = "Ticket") -> Products:
    product = Products(
        id=uuid.uuid4(),
        tenant_id=popup.tenant_id,
        popup_id=popup.id,
        name=name,
        slug=f"prod-{uuid.uuid4().hex[:6]}",
        price=Decimal("100.00"),
        category="ticket",
        is_active=True,
    )
    db.add(product)
    db.commit()
    db.refresh(product)
    return product


def _application(
    db: Session,
    popup: Popups,
    human: Humans,
    *,
    status: str = ApplicationStatus.ACCEPTED.value,
    custom_fields: dict | None = None,
    info_not_shared: list[str] | None = None,
) -> Applications:
    app = Applications(
        id=uuid.uuid4(),
        tenant_id=popup.tenant_id,
        popup_id=popup.id,
        human_id=human.id,
        status=status,
        custom_fields=custom_fields or {},
        info_not_shared=info_not_shared or [],
    )
    db.add(app)
    db.commit()
    db.refresh(app)
    return app


def _attendee(
    db: Session,
    popup: Popups,
    app: Applications,
    human: Humans,
    category: AttendeeCategories,
    *,
    tickets: int = 0,
    product: Products | None = None,
) -> Attendees:
    attendee = Attendees(
        id=uuid.uuid4(),
        tenant_id=popup.tenant_id,
        application_id=app.id,
        popup_id=popup.id,
        human_id=human.id,
        name=f"{human.first_name} {human.last_name}",
        category_id=category.id,
        email=human.email,
    )
    db.add(attendee)
    db.commit()
    db.refresh(attendee)
    if tickets:
        prod = product or _product(db, popup)
        for _ in range(tickets):
            db.add(
                AttendeeProducts(
                    id=uuid.uuid4(),
                    tenant_id=popup.tenant_id,
                    attendee_id=attendee.id,
                    product_id=prod.id,
                    check_in_code=uuid.uuid4().hex[:10].upper(),
                )
            )
        db.commit()
        db.refresh(attendee)
    return attendee


@pytest.fixture()
def directory_world(db: Session, tenant_a: Tenants):
    """A popup with a realistic mix of attendees for directory assertions.

    - Andrea (main) + Scott (spouse, ticket) + Kiddo (kid, ticket) on one app.
    - Bob (main, 0 tickets) + Carol (spouse, ticket) on another app.
    """
    popup = _popup(db, tenant_a)
    main = _category(db, popup, "main", is_primary=True)
    spouse = _category(db, popup, "spouse", is_primary=False)
    kid = _category(db, popup, "kid", is_primary=False)
    product = _product(db, popup, name="GA")

    andrea = _human(db, tenant_a, "Andrea", "Gallagher")
    scott = _human(db, tenant_a, "Scott", "Brylow")
    kiddo = _human(db, tenant_a, "Kiddo", "Gallagher")
    andrea_app = _application(
        db,
        popup,
        andrea,
        custom_fields={"role": "Founder", "organization": "Staple & Spindle"},
        info_not_shared=["email"],
    )
    andrea_att = _attendee(
        db, popup, andrea_app, andrea, main, tickets=1, product=product
    )
    scott_att = _attendee(
        db, popup, andrea_app, scott, spouse, tickets=1, product=product
    )
    kiddo_att = _attendee(db, popup, andrea_app, kiddo, kid, tickets=1, product=product)

    bob = _human(db, tenant_a, "Bob", "Roberts")
    carol = _human(db, tenant_a, "Carol", "Roberts")
    bob_app = _application(db, popup, bob)
    bob_att = _attendee(db, popup, bob_app, bob, main, tickets=0)  # no ticket
    carol_att = _attendee(db, popup, bob_app, carol, spouse, tickets=1, product=product)

    return {
        "popup": popup,
        "andrea": andrea_att,
        "scott": scott_att,
        "kiddo": kiddo_att,
        "bob": bob_att,
        "carol": carol_att,
    }


# ---------------------------------------------------------------------------
# Tests
# ---------------------------------------------------------------------------


def test_directory_lists_main_and_spouse_excludes_kids_and_zero_ticket_main(
    db: Session, directory_world
) -> None:
    """One row per ticket-holding main/spouse; kids and 0-ticket main excluded."""
    results, total = applications_crud.find_directory(
        db, popup_id=directory_world["popup"].id, limit=100
    )
    got = {a.id for a in results}
    assert total == 3
    assert directory_world["andrea"].id in got  # main with ticket
    assert directory_world["scott"].id in got  # spouse with ticket
    assert directory_world["carol"].id in got  # spouse with ticket
    assert directory_world["kiddo"].id not in got  # kid — excluded
    assert directory_world["bob"].id not in got  # main, 0 tickets


def test_companion_searchable_by_own_name(db: Session, directory_world) -> None:
    """Searching the spouse's own surname returns the spouse, not the applicant."""
    results, total = applications_crud.find_directory(
        db, popup_id=directory_world["popup"].id, q="Brylow"
    )
    assert total == 1
    assert results[0].id == directory_world["scott"].id


def test_directory_searchable_by_full_name(db: Session, directory_world) -> None:
    """A 'first last' query matches even though it spans both name columns."""
    for query in ("Scott Brylow", "scott brylow"):
        results, _ = applications_crud.find_directory(
            db, popup_id=directory_world["popup"].id, q=query
        )
        assert {a.id for a in results} == {directory_world["scott"].id}, query


def test_companion_entry_uses_own_profile_no_masking(
    db: Session, directory_world
) -> None:
    """Spouse row: own name, own email (unmasked), blank role/org, spouse category."""
    scott = next(
        a
        for a in applications_crud.find_directory(
            db, popup_id=directory_world["popup"].id
        )[0]
        if a.id == directory_world["scott"].id
    )
    entry = _build_directory_entry(scott)
    assert entry.first_name == "Scott"
    assert entry.last_name == "Brylow"
    assert entry.category == "spouse"
    # Andrea's application hides "email" — that masking must NOT leak onto Scott.
    assert entry.email and entry.email != "*"
    # Companions never filled a form → no role/organization.
    assert entry.role is None
    assert entry.organization is None
    assert len(entry.participation) == 1


def test_main_entry_keeps_role_org_and_masking(db: Session, directory_world) -> None:
    """Main applicant row: role/org from custom_fields, info_not_shared masking."""
    andrea = next(
        a
        for a in applications_crud.find_directory(
            db, popup_id=directory_world["popup"].id
        )[0]
        if a.id == directory_world["andrea"].id
    )
    entry = _build_directory_entry(andrea)
    assert entry.category == "main"
    assert entry.role == "Founder"
    assert entry.organization == "Staple & Spindle"
    assert entry.email == "*"  # masked via info_not_shared=["email"]


def test_directory_excludes_non_accepted_application(
    db: Session, tenant_a: Tenants
) -> None:
    """A ticket-holding attendee under a non-accepted application is hidden."""
    popup = _popup(db, tenant_a)
    main = _category(db, popup, "main", is_primary=True)
    human = _human(db, tenant_a, "Pending", "Person")
    app = _application(db, popup, human, status=ApplicationStatus.IN_REVIEW.value)
    _attendee(db, popup, app, human, main, tickets=1)
    results, total = applications_crud.find_directory(db, popup_id=popup.id)
    assert total == 0
    assert results == []
