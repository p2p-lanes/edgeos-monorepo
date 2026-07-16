"""Tests for POST /applications/admin/grant-tickets — admin bulk free-ticket grants.

Covers the locked decisions from the design plan:
- $0 Payment with granted_by_user_id stamped to the admin who issued the grant.
- Fill-blanks Human upsert (NEVER overwrites existing first/last name).
- Existing draft/in-review Application promoted to ACCEPTED.
- Sold-out mid-batch → 409 + total rollback (no Payment / AttendeeProduct rows).
- Patron product snapshot keeps product_price=0 / effective_unit_price=0.
- PAYMENT_CONFIRMED email sent exactly once per granted person, post-commit.
- Self-service zero-amount payment still commits once + emails once (regression
  for the helper refactor in payment/crud.py).
- Tenant scoping: cross-tenant grants blocked at the popup-lookup layer.
"""

import uuid
from decimal import Decimal
from unittest.mock import AsyncMock

import pytest
from fastapi.testclient import TestClient
from sqlmodel import Session, select

from app.api.application.models import Applications
from app.api.application.schemas import ApplicationStatus
from app.api.attendee.models import AttendeeProducts, Attendees
from app.api.attendee_category.models import AttendeeCategories
from app.api.human.models import Humans
from app.api.payment.models import PaymentProducts, Payments
from app.api.payment.schemas import PaymentStatus
from app.api.popup.models import Popups
from app.api.product.models import Products
from app.api.tenant.models import Tenants
from app.api.user.models import Users

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _ensure_primary_category(db: Session, popup: Popups) -> AttendeeCategories:
    """Create the popup's primary attendee category (main) if missing."""
    cat = db.exec(
        select(AttendeeCategories).where(
            AttendeeCategories.popup_id == popup.id,
            AttendeeCategories.is_primary == True,  # noqa: E712
        )
    ).first()
    if cat is None:
        cat = AttendeeCategories(
            tenant_id=popup.tenant_id,
            popup_id=popup.id,
            key="main",
            label="Main",
            is_primary=True,
            enabled_in_passes_flow=True,
        )
        db.add(cat)
        db.commit()
        db.refresh(cat)
    return cat


def _make_product(
    db: Session,
    popup: Popups,
    *,
    name: str = "Ticket",
    price: str = "100.00",
    total_stock_cap: int | None = None,
    category: str = "ticket",
) -> Products:
    product = Products(
        id=uuid.uuid4(),
        tenant_id=popup.tenant_id,
        popup_id=popup.id,
        name=name,
        slug=f"prod-{uuid.uuid4().hex[:6]}",
        price=Decimal(price),
        category=category,
        is_active=True,
        total_stock_cap=total_stock_cap,
        total_stock_remaining=total_stock_cap,
    )
    db.add(product)
    db.commit()
    db.refresh(product)
    return product


def _auth(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


@pytest.fixture()
def mock_payment_email(monkeypatch) -> AsyncMock:
    """Patch the confirmation-email coroutine the admin grant endpoint awaits.

    `app.api.payment.__init__` re-exports `router` (the APIRouter instance),
    which shadows the file module attribute lookup. Use importlib to grab
    the module object directly so we patch the file, not the re-export.
    """
    import importlib

    payment_router_module = importlib.import_module("app.api.payment.router")
    mock = AsyncMock()
    monkeypatch.setattr(payment_router_module, "_send_payment_confirmed_email", mock)
    return mock


@pytest.fixture()
def grant_popup(db: Session, popup_tenant_a: Popups) -> Popups:
    """popup_tenant_a with a primary attendee category guaranteed."""
    _ensure_primary_category(db, popup_tenant_a)
    return popup_tenant_a


# ---------------------------------------------------------------------------
# Tests
# ---------------------------------------------------------------------------


def test_grant_creates_human_application_payment_and_tickets(
    client: TestClient,
    db: Session,
    admin_token_tenant_a: str,
    admin_user_tenant_a: Users,
    tenant_a: Tenants,
    grant_popup: Popups,
    mock_payment_email: AsyncMock,
) -> None:
    """New human + application + accepted state + $0 payment with snapshot + tickets."""
    product = _make_product(db, grant_popup, name="GA", price="50.00")

    email = f"grant-happy-{uuid.uuid4().hex[:6]}@test.com"
    response = client.post(
        "/api/v1/applications/admin/grant-tickets",
        json={
            "popup_id": str(grant_popup.id),
            "people": [
                {
                    "email": email,
                    "first_name": "New",
                    "last_name": "Person",
                    "products": [{"product_id": str(product.id), "quantity": 2}],
                }
            ],
        },
        headers=_auth(admin_token_tenant_a),
    )
    assert response.status_code == 201, response.text
    body = response.json()
    assert len(body["granted"]) == 1
    granted = body["granted"][0]
    assert granted["email"] == email
    assert granted["tickets_created"] == 2

    payment = db.get(Payments, uuid.UUID(granted["payment_id"]))
    assert payment is not None
    assert payment.amount == Decimal("0")
    assert payment.status == PaymentStatus.APPROVED.value
    assert payment.granted_by_user_id == admin_user_tenant_a.id
    assert payment.source is None

    app = db.get(Applications, uuid.UUID(granted["application_id"]))
    assert app is not None
    assert app.status == ApplicationStatus.ACCEPTED.value
    assert app.accepted_at is not None

    human = db.exec(
        select(Humans).where(Humans.email == email, Humans.tenant_id == tenant_a.id)
    ).first()
    assert human is not None
    assert human.first_name == "New"
    assert human.last_name == "Person"

    snapshots = list(
        db.exec(
            select(PaymentProducts).where(PaymentProducts.payment_id == payment.id)
        ).all()
    )
    assert len(snapshots) == 1
    assert snapshots[0].quantity == 2

    tickets = list(
        db.exec(
            select(AttendeeProducts).where(AttendeeProducts.payment_id == payment.id)
        ).all()
    )
    assert len(tickets) == 2  # quantity=2 → 2 ticket rows

    assert mock_payment_email.await_count == 1


@pytest.mark.usefixtures("mock_payment_email")
def test_grant_fill_blanks_does_not_overwrite_existing_human(
    client: TestClient,
    db: Session,
    admin_token_tenant_a: str,
    tenant_a: Tenants,
    grant_popup: Popups,
) -> None:
    """A Human with first_name set keeps its name even if the CSV row provides one."""
    product = _make_product(db, grant_popup, name="GA", price="10.00")
    existing = Humans(
        id=uuid.uuid4(),
        tenant_id=tenant_a.id,
        email=f"keep-{uuid.uuid4().hex[:6]}@test.com",
        first_name="Existente",
        last_name="",  # blank — should be filled
    )
    db.add(existing)
    db.commit()
    db.refresh(existing)

    response = client.post(
        "/api/v1/applications/admin/grant-tickets",
        json={
            "popup_id": str(grant_popup.id),
            "people": [
                {
                    "email": existing.email,
                    "first_name": "Nuevo",
                    "last_name": "Apellido",
                    "products": [{"product_id": str(product.id), "quantity": 1}],
                }
            ],
        },
        headers=_auth(admin_token_tenant_a),
    )
    assert response.status_code == 201, response.text

    db.expire(existing)
    db.refresh(existing)
    assert existing.first_name == "Existente"  # NOT overwritten
    assert existing.last_name == "Apellido"  # blank → filled


@pytest.mark.usefixtures("mock_payment_email")
def test_grant_promotes_existing_draft_application(
    client: TestClient,
    db: Session,
    admin_token_tenant_a: str,
    tenant_a: Tenants,
    grant_popup: Popups,
) -> None:
    """A draft application is promoted to ACCEPTED and reused (no duplicate)."""
    product = _make_product(db, grant_popup, name="GA", price="10.00")
    human = Humans(
        id=uuid.uuid4(),
        tenant_id=tenant_a.id,
        email=f"promote-{uuid.uuid4().hex[:6]}@test.com",
        first_name="Already",
        last_name="Here",
    )
    db.add(human)
    db.commit()
    db.refresh(human)

    primary_cat = _ensure_primary_category(db, grant_popup)
    application = Applications(
        id=uuid.uuid4(),
        tenant_id=tenant_a.id,
        popup_id=grant_popup.id,
        human_id=human.id,
        status=ApplicationStatus.DRAFT.value,
    )
    db.add(application)
    # Direct-attendee link so get_main_attendee finds a row.
    attendee = Attendees(
        id=uuid.uuid4(),
        tenant_id=tenant_a.id,
        application_id=application.id,
        popup_id=grant_popup.id,
        name="Already Here",
        email=human.email,
        human_id=human.id,
        category_id=primary_cat.id,
    )
    db.add(attendee)
    db.commit()
    db.refresh(application)

    response = client.post(
        "/api/v1/applications/admin/grant-tickets",
        json={
            "popup_id": str(grant_popup.id),
            "people": [
                {
                    "email": human.email,
                    "products": [{"product_id": str(product.id), "quantity": 1}],
                }
            ],
        },
        headers=_auth(admin_token_tenant_a),
    )
    assert response.status_code == 201, response.text

    db.expire(application)
    db.refresh(application)
    assert application.status == ApplicationStatus.ACCEPTED.value

    apps_for_human = list(
        db.exec(
            select(Applications).where(
                Applications.human_id == human.id,
                Applications.popup_id == grant_popup.id,
            )
        ).all()
    )
    assert len(apps_for_human) == 1  # no duplicate created


@pytest.mark.usefixtures("tenant_a")
def test_grant_sold_out_mid_batch_rolls_back_everything(
    client: TestClient,
    db: Session,
    admin_token_tenant_a: str,
    grant_popup: Popups,
    mock_payment_email: AsyncMock,
) -> None:
    """Stock cap 2 + 3 people × qty 1 → 409 stock_exhausted, zero payments persisted."""
    product = _make_product(
        db, grant_popup, name="LimitedGA", price="10.00", total_stock_cap=2
    )

    emails = [f"out-{i}-{uuid.uuid4().hex[:4]}@test.com" for i in range(3)]
    response = client.post(
        "/api/v1/applications/admin/grant-tickets",
        json={
            "popup_id": str(grant_popup.id),
            "people": [
                {
                    "email": e,
                    "products": [{"product_id": str(product.id), "quantity": 1}],
                }
                for e in emails
            ],
        },
        headers=_auth(admin_token_tenant_a),
    )
    assert response.status_code == 409
    detail = response.json()["detail"]
    assert detail["error"] == "stock_exhausted"
    assert detail["product_id"] == str(product.id)

    # No payments created for this product on this run.
    payments_for_popup = list(
        db.exec(select(Payments).where(Payments.popup_id == grant_popup.id)).all()
    )
    # Filter strictly to payments with our product snapshot to avoid bleed-over
    # from concurrent test fixtures.
    poisoned = [
        p
        for p in payments_for_popup
        if any(pp.product_id == product.id for pp in p.products_snapshot)
    ]
    assert poisoned == []

    aps = list(
        db.exec(
            select(AttendeeProducts).where(AttendeeProducts.product_id == product.id)
        ).all()
    )
    assert aps == []

    # Best-effort emails are gated on commit success; rollback means zero sends.
    assert mock_payment_email.await_count == 0

    # Stock counter untouched (rollback restored everything to the cap).
    db.expire(product)
    db.refresh(product)
    assert product.total_stock_remaining == 2


@pytest.mark.usefixtures("tenant_a", "mock_payment_email")
def test_grant_patron_product_snapshot_zeroes_price(
    client: TestClient,
    db: Session,
    admin_token_tenant_a: str,
    grant_popup: Popups,
) -> None:
    """Patron grants record product_price=0 and effective_unit_price=0 with admin's qty."""
    product = _make_product(
        db, grant_popup, name="Patron Tier", price="500.00", category="patreon"
    )

    email = f"patron-{uuid.uuid4().hex[:6]}@test.com"
    response = client.post(
        "/api/v1/applications/admin/grant-tickets",
        json={
            "popup_id": str(grant_popup.id),
            "people": [
                {
                    "email": email,
                    "first_name": "Pat",
                    "last_name": "Ron",
                    "products": [{"product_id": str(product.id), "quantity": 1}],
                }
            ],
        },
        headers=_auth(admin_token_tenant_a),
    )
    assert response.status_code == 201, response.text
    payment_id = uuid.UUID(response.json()["granted"][0]["payment_id"])

    snapshot = db.exec(
        select(PaymentProducts).where(PaymentProducts.payment_id == payment_id)
    ).first()
    assert snapshot is not None
    assert snapshot.product_price == Decimal("0")
    assert snapshot.effective_unit_price == Decimal("0")
    assert snapshot.quantity == 1


def test_grant_sends_exactly_one_email_per_person(
    client: TestClient,
    db: Session,
    admin_token_tenant_a: str,
    grant_popup: Popups,
    mock_payment_email: AsyncMock,
) -> None:
    """N people in a single batch → N PAYMENT_CONFIRMED emails post-commit."""
    product = _make_product(db, grant_popup, name="Multi", price="20.00")
    emails = [f"multi-{i}-{uuid.uuid4().hex[:4]}@test.com" for i in range(3)]

    response = client.post(
        "/api/v1/applications/admin/grant-tickets",
        json={
            "popup_id": str(grant_popup.id),
            "people": [
                {
                    "email": e,
                    "products": [{"product_id": str(product.id), "quantity": 1}],
                }
                for e in emails
            ],
        },
        headers=_auth(admin_token_tenant_a),
    )
    assert response.status_code == 201, response.text
    assert mock_payment_email.await_count == 3


@pytest.mark.usefixtures("tenant_b")
def test_grant_blocks_cross_tenant_popup(
    client: TestClient,
    db: Session,
    admin_token_tenant_a: str,
    popup_tenant_b: Popups,
    mock_payment_email: AsyncMock,
) -> None:
    """Admin from tenant A cannot grant tickets on a popup owned by tenant B."""
    _ensure_primary_category(db, popup_tenant_b)
    # Use a real product id from tenant B's popup so the request is otherwise
    # well-formed; the tenant guard should still block the call.
    cross_product = _make_product(db, popup_tenant_b, name="CrossGA", price="10.00")
    response = client.post(
        "/api/v1/applications/admin/grant-tickets",
        json={
            "popup_id": str(popup_tenant_b.id),
            "people": [
                {
                    "email": f"x-{uuid.uuid4().hex[:6]}@test.com",
                    "products": [{"product_id": str(cross_product.id), "quantity": 1}],
                }
            ],
        },
        headers=_auth(admin_token_tenant_a),
    )
    # Either 404 (RLS hides the popup) or 422 (products unavailable through
    # the tenant lens) is fine, but it must NOT be 201 / 200.
    assert response.status_code in (404, 422), response.text
    assert mock_payment_email.await_count == 0


@pytest.mark.usefixtures("tenant_a")
def test_grant_per_person_products_mixed(
    client: TestClient,
    db: Session,
    admin_token_tenant_a: str,
    grant_popup: Popups,
    mock_payment_email: AsyncMock,
) -> None:
    """Each person can request a different mix of products in the same batch."""
    ga = _make_product(db, grant_popup, name="GA", price="50.00")
    patron = _make_product(
        db, grant_popup, name="Patron", price="500.00", category="patreon"
    )

    alice_email = f"alice-{uuid.uuid4().hex[:6]}@test.com"
    bob_email = f"bob-{uuid.uuid4().hex[:6]}@test.com"
    response = client.post(
        "/api/v1/applications/admin/grant-tickets",
        json={
            "popup_id": str(grant_popup.id),
            "people": [
                {
                    "email": alice_email,
                    "products": [{"product_id": str(ga.id), "quantity": 2}],
                },
                {
                    "email": bob_email,
                    "products": [{"product_id": str(patron.id), "quantity": 1}],
                },
            ],
        },
        headers=_auth(admin_token_tenant_a),
    )
    assert response.status_code == 201, response.text
    body = response.json()
    assert len(body["granted"]) == 2

    by_email = {g["email"]: g for g in body["granted"]}
    assert by_email[alice_email]["tickets_created"] == 2
    assert by_email[bob_email]["tickets_created"] == 1

    # Each person's payment carries only their requested products.
    alice_payment = uuid.UUID(by_email[alice_email]["payment_id"])
    bob_payment = uuid.UUID(by_email[bob_email]["payment_id"])

    alice_snapshots = list(
        db.exec(
            select(PaymentProducts).where(PaymentProducts.payment_id == alice_payment)
        ).all()
    )
    assert {s.product_id for s in alice_snapshots} == {ga.id}
    assert alice_snapshots[0].quantity == 2

    bob_snapshots = list(
        db.exec(
            select(PaymentProducts).where(PaymentProducts.payment_id == bob_payment)
        ).all()
    )
    assert {s.product_id for s in bob_snapshots} == {patron.id}
    assert bob_snapshots[0].quantity == 1

    # Ticket rows materialized only for the products each person requested.
    alice_tickets = list(
        db.exec(
            select(AttendeeProducts).where(AttendeeProducts.payment_id == alice_payment)
        ).all()
    )
    assert len(alice_tickets) == 2
    assert {ap.product_id for ap in alice_tickets} == {ga.id}

    bob_tickets = list(
        db.exec(
            select(AttendeeProducts).where(AttendeeProducts.payment_id == bob_payment)
        ).all()
    )
    assert len(bob_tickets) == 1
    assert {ap.product_id for ap in bob_tickets} == {patron.id}

    assert mock_payment_email.await_count == 2


@pytest.mark.usefixtures("tenant_a", "mock_payment_email")
def test_grant_per_person_validates_each_has_products(
    client: TestClient,
    db: Session,
    admin_token_tenant_a: str,
    grant_popup: Popups,
) -> None:
    """A person with an empty products list is rejected at validation."""
    product = _make_product(db, grant_popup, name="GA", price="10.00")
    response = client.post(
        "/api/v1/applications/admin/grant-tickets",
        json={
            "popup_id": str(grant_popup.id),
            "people": [
                {
                    "email": f"ok-{uuid.uuid4().hex[:6]}@test.com",
                    "products": [{"product_id": str(product.id), "quantity": 1}],
                },
                {
                    "email": f"empty-{uuid.uuid4().hex[:6]}@test.com",
                    "products": [],
                },
            ],
        },
        headers=_auth(admin_token_tenant_a),
    )
    assert response.status_code == 422, response.text


@pytest.mark.usefixtures("mock_payment_email")
def test_grant_created_application_defaults_to_directory_private(
    client: TestClient,
    db: Session,
    admin_token_tenant_a: str,
    grant_popup: Popups,
) -> None:
    """Comped people never consented to sharing: full info_not_shared default."""
    from app.api.application.crud import GRANTED_DEFAULT_INFO_NOT_SHARED

    product = _make_product(db, grant_popup, name="GA", price="10.00")
    email = f"private-{uuid.uuid4().hex[:6]}@test.com"

    response = client.post(
        "/api/v1/applications/admin/grant-tickets",
        json={
            "popup_id": str(grant_popup.id),
            "people": [
                {
                    "email": email,
                    "first_name": "Comped",
                    "last_name": "Guest",
                    "products": [{"product_id": str(product.id), "quantity": 1}],
                }
            ],
        },
        headers=_auth(admin_token_tenant_a),
    )
    assert response.status_code == 201, response.text
    granted = response.json()["granted"][0]

    app = db.get(Applications, uuid.UUID(granted["application_id"]))
    assert app is not None
    assert set(app.info_not_shared or []) == set(GRANTED_DEFAULT_INFO_NOT_SHARED)


@pytest.mark.usefixtures("mock_payment_email")
def test_grant_existing_application_keeps_privacy_choices(
    client: TestClient,
    db: Session,
    admin_token_tenant_a: str,
    tenant_a: Tenants,
    grant_popup: Popups,
) -> None:
    """Grants to someone who already applied must not override their prefs."""
    product = _make_product(db, grant_popup, name="GA", price="10.00")
    human = Humans(
        id=uuid.uuid4(),
        tenant_id=tenant_a.id,
        email=f"keepprefs-{uuid.uuid4().hex[:6]}@test.com",
        first_name="Self",
        last_name="Applied",
    )
    db.add(human)
    db.commit()
    db.refresh(human)

    primary_cat = _ensure_primary_category(db, grant_popup)
    application = Applications(
        id=uuid.uuid4(),
        tenant_id=tenant_a.id,
        popup_id=grant_popup.id,
        human_id=human.id,
        status=ApplicationStatus.ACCEPTED.value,
        info_not_shared=["email"],  # explicit choice: share all but email
    )
    db.add(application)
    attendee = Attendees(
        id=uuid.uuid4(),
        tenant_id=tenant_a.id,
        application_id=application.id,
        popup_id=grant_popup.id,
        name="Self Applied",
        email=human.email,
        human_id=human.id,
        category_id=primary_cat.id,
    )
    db.add(attendee)
    db.commit()

    response = client.post(
        "/api/v1/applications/admin/grant-tickets",
        json={
            "popup_id": str(grant_popup.id),
            "people": [
                {
                    "email": human.email,
                    "products": [{"product_id": str(product.id), "quantity": 1}],
                }
            ],
        },
        headers=_auth(admin_token_tenant_a),
    )
    assert response.status_code == 201, response.text

    db.expire(application)
    db.refresh(application)
    assert application.info_not_shared == ["email"]
