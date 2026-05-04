import uuid
from datetime import UTC, datetime, timedelta
from decimal import Decimal

from fastapi.testclient import TestClient
from sqlmodel import Session

from app.api.attendee.models import Attendees
from app.api.human.models import Humans
from app.api.payment.models import PaymentProducts, Payments
from app.api.payment.schemas import PaymentStatus
from app.api.popup.models import Popups
from app.api.product.models import Products
from app.api.tenant.models import Tenants


def _admin_headers(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


def _create_popup(db: Session, tenant: Tenants, *, suffix: str) -> Popups:
    popup = Popups(
        name=f"Payments Search {suffix}",
        slug=f"payments-search-{suffix}-{uuid.uuid4().hex[:6]}",
        tenant_id=tenant.id,
    )
    db.add(popup)
    db.commit()
    db.refresh(popup)
    return popup


def _create_human(db: Session, tenant: Tenants, *, email: str) -> Humans:
    human = Humans(
        tenant_id=tenant.id,
        email=email,
        first_name="Search",
        last_name="Human",
    )
    db.add(human)
    db.commit()
    db.refresh(human)
    return human


def _create_attendee(
    db: Session,
    tenant: Tenants,
    popup: Popups,
    *,
    name: str,
    email: str,
    human: Humans | None = None,
) -> Attendees:
    attendee = Attendees(
        tenant_id=tenant.id,
        popup_id=popup.id,
        human_id=human.id if human else None,
        name=name,
        category="main",
        email=email,
        check_in_code=f"CHK{uuid.uuid4().hex[:8].upper()}",
    )
    db.add(attendee)
    db.commit()
    db.refresh(attendee)
    return attendee


def _create_product(db: Session, tenant: Tenants, popup: Popups, *, suffix: str) -> Products:
    product = Products(
        tenant_id=tenant.id,
        popup_id=popup.id,
        name=f"Search Product {suffix}",
        slug=f"search-product-{suffix}-{uuid.uuid4().hex[:6]}",
        price=Decimal("100.00"),
        category="ticket",
        is_active=True,
    )
    db.add(product)
    db.commit()
    db.refresh(product)
    return product


def _create_payment(
    db: Session,
    tenant: Tenants,
    popup: Popups,
    *,
    external_id: str,
    created_at: datetime,
    attendee_specs: list[dict[str, str]],
    amount: Decimal = Decimal("100.00"),
    status: PaymentStatus = PaymentStatus.APPROVED,
) -> Payments:
    payment = Payments(
        tenant_id=tenant.id,
        popup_id=popup.id,
        external_id=external_id,
        status=status.value,
        amount=amount,
        currency="USD",
        source="SimpleFI",
        created_at=created_at,
        updated_at=created_at,
    )
    db.add(payment)
    db.commit()
    db.refresh(payment)

    for index, attendee_spec in enumerate(attendee_specs):
        product = _create_product(db, tenant, popup, suffix=f"{external_id}-{index}")
        human = None
        human_email = attendee_spec.get("human_email")
        if human_email:
            human = _create_human(db, tenant, email=human_email)

        attendee = _create_attendee(
            db,
            tenant,
            popup,
            name=attendee_spec["name"],
            email=attendee_spec["email"],
            human=human,
        )
        db.add(
            PaymentProducts(
                tenant_id=tenant.id,
                payment_id=payment.id,
                product_id=product.id,
                attendee_id=attendee.id,
                quantity=1,
                product_name=f"Product {index + 1}",
                product_description=None,
                product_price=Decimal("100.00"),
                product_category="ticket",
                product_currency="USD",
            )
        )

    db.commit()
    db.refresh(payment)
    return payment


class TestPaymentListSearch:
    def test_status_filter_limits_results_across_full_popup_dataset(
        self,
        client: TestClient,
        db: Session,
        tenant_a: Tenants,
        admin_token_tenant_a: str,
    ) -> None:
        popup = _create_popup(db, tenant_a, suffix="status-filter")
        approved_payment = _create_payment(
            db,
            tenant_a,
            popup,
            external_id="STATUS-APPROVED",
            created_at=datetime.now(UTC),
            attendee_specs=[{"name": "Approved", "email": "approved@test.com"}],
            status=PaymentStatus.APPROVED,
        )
        _create_payment(
            db,
            tenant_a,
            popup,
            external_id="STATUS-PENDING",
            created_at=datetime.now(UTC) + timedelta(minutes=1),
            attendee_specs=[{"name": "Pending", "email": "pending@test.com"}],
            status=PaymentStatus.PENDING,
        )

        response = client.get(
            "/api/v1/payments",
            params={"popup_id": str(popup.id), "payment_status": "approved"},
            headers=_admin_headers(admin_token_tenant_a),
        )

        assert response.status_code == 200
        payload = response.json()
        assert payload["paging"]["total"] == 1
        assert [item["id"] for item in payload["results"]] == [str(approved_payment.id)]

    def test_sorting_by_amount_uses_full_dataset_not_current_page_only(
        self,
        client: TestClient,
        db: Session,
        tenant_a: Tenants,
        admin_token_tenant_a: str,
    ) -> None:
        popup = _create_popup(db, tenant_a, suffix="sort-amount")
        base_time = datetime.now(UTC)

        low_payment = _create_payment(
            db,
            tenant_a,
            popup,
            external_id="SORT-AMOUNT-LOW",
            created_at=base_time,
            attendee_specs=[{"name": "Low", "email": "low@test.com"}],
            amount=Decimal("50.00"),
        )
        _create_payment(
            db,
            tenant_a,
            popup,
            external_id="SORT-AMOUNT-MID",
            created_at=base_time + timedelta(minutes=1),
            attendee_specs=[{"name": "Mid", "email": "mid@test.com"}],
            amount=Decimal("75.00"),
        )
        _create_payment(
            db,
            tenant_a,
            popup,
            external_id="SORT-AMOUNT-HIGH",
            created_at=base_time + timedelta(minutes=2),
            attendee_specs=[{"name": "High", "email": "high@test.com"}],
            amount=Decimal("150.00"),
        )

        response = client.get(
            "/api/v1/payments",
            params={
                "popup_id": str(popup.id),
                "skip": 0,
                "limit": 1,
                "sort_by": "amount",
                "sort_order": "asc",
            },
            headers=_admin_headers(admin_token_tenant_a),
        )

        assert response.status_code == 200
        payload = response.json()
        assert payload["paging"] == {"offset": 0, "limit": 1, "total": 3}
        assert [item["id"] for item in payload["results"]] == [str(low_payment.id)]

    def test_search_matches_external_id_across_full_popup_dataset(
        self,
        client: TestClient,
        db: Session,
        tenant_a: Tenants,
        admin_token_tenant_a: str,
    ) -> None:
        popup = _create_popup(db, tenant_a, suffix="external-id")
        base_time = datetime.now(UTC)

        expected_payment = _create_payment(
            db,
            tenant_a,
            popup,
            external_id="TARGET-EXT-9000",
            created_at=base_time - timedelta(minutes=30),
            attendee_specs=[
                {"name": "Ana Search", "email": "ana.search@test.com"},
            ],
        )

        for index in range(30):
            _create_payment(
                db,
                tenant_a,
                popup,
                external_id=f"OTHER-{index:02d}",
                created_at=base_time + timedelta(minutes=index),
                attendee_specs=[
                    {
                        "name": f"Other Person {index}",
                        "email": f"other-{index}@test.com",
                    },
                ],
            )

        response = client.get(
            "/api/v1/payments",
            params={
                "popup_id": str(popup.id),
                "skip": 0,
                "limit": 25,
                "search": "ext-9000",
            },
            headers=_admin_headers(admin_token_tenant_a),
        )

        assert response.status_code == 200
        payload = response.json()
        assert payload["paging"]["total"] == 1
        assert [item["id"] for item in payload["results"]] == [str(expected_payment.id)]

    def test_search_matches_attendee_name_and_email_once_per_payment(
        self,
        client: TestClient,
        db: Session,
        tenant_a: Tenants,
        admin_token_tenant_a: str,
    ) -> None:
        popup = _create_popup(db, tenant_a, suffix="attendee")
        payment = _create_payment(
            db,
            tenant_a,
            popup,
            external_id="ATTENDEE-MATCH",
            created_at=datetime.now(UTC),
            attendee_specs=[
                {
                    "name": "Lucia Multi Match",
                    "email": "lucia.match@test.com",
                },
                {
                    "name": "Lucia Backup",
                    "email": "lucia.other@test.com",
                },
            ],
        )
        _create_payment(
            db,
            tenant_a,
            popup,
            external_id="ATTENDEE-DISTRACTOR",
            created_at=datetime.now(UTC) + timedelta(minutes=1),
            attendee_specs=[
                {"name": "Other Person", "email": "other.person@test.com"},
            ],
        )

        name_response = client.get(
            "/api/v1/payments",
            params={"popup_id": str(popup.id), "search": "multi match"},
            headers=_admin_headers(admin_token_tenant_a),
        )
        email_response = client.get(
            "/api/v1/payments",
            params={"popup_id": str(popup.id), "search": "lucia.match@test.com"},
            headers=_admin_headers(admin_token_tenant_a),
        )

        assert name_response.status_code == 200
        assert email_response.status_code == 200
        assert name_response.json()["paging"]["total"] == 1
        assert email_response.json()["paging"]["total"] == 1
        assert name_response.json()["results"][0]["id"] == str(payment.id)
        assert email_response.json()["results"][0]["id"] == str(payment.id)

    def test_search_matches_linked_human_email_when_attendee_snapshot_differs(
        self,
        client: TestClient,
        db: Session,
        tenant_a: Tenants,
        admin_token_tenant_a: str,
    ) -> None:
        popup = _create_popup(db, tenant_a, suffix="human-email")
        payment = _create_payment(
            db,
            tenant_a,
            popup,
            external_id="HUMAN-EMAIL-MATCH",
            created_at=datetime.now(UTC),
            attendee_specs=[
                {
                    "name": "Human Linked",
                    "email": "snapshot-email@test.com",
                    "human_email": "real-human-email@test.com",
                },
            ],
        )
        _create_payment(
            db,
            tenant_a,
            popup,
            external_id="HUMAN-EMAIL-DISTRACTOR",
            created_at=datetime.now(UTC) + timedelta(minutes=1),
            attendee_specs=[
                {
                    "name": "Snapshot Only",
                    "email": "snapshot-only@test.com",
                    "human_email": "different-human@test.com",
                },
            ],
        )

        response = client.get(
            "/api/v1/payments",
            params={"popup_id": str(popup.id), "search": "real-human-email"},
            headers=_admin_headers(admin_token_tenant_a),
        )

        assert response.status_code == 200
        payload = response.json()
        assert payload["paging"]["total"] == 1
        assert payload["results"][0]["id"] == str(payment.id)

    def test_no_search_preserves_popup_listing_pagination_and_order(
        self,
        client: TestClient,
        db: Session,
        tenant_a: Tenants,
        admin_token_tenant_a: str,
    ) -> None:
        popup = _create_popup(db, tenant_a, suffix="baseline")
        base_time = datetime.now(UTC)

        newest_payment = _create_payment(
            db,
            tenant_a,
            popup,
            external_id="BASELINE-NEW",
            created_at=base_time + timedelta(minutes=5),
            attendee_specs=[{"name": "Newest", "email": "newest@test.com"}],
        )
        _create_payment(
            db,
            tenant_a,
            popup,
            external_id="BASELINE-OLD",
            created_at=base_time,
            attendee_specs=[{"name": "Older", "email": "older@test.com"}],
        )

        response = client.get(
            "/api/v1/payments",
            params={"popup_id": str(popup.id), "skip": 0, "limit": 1},
            headers=_admin_headers(admin_token_tenant_a),
        )

        assert response.status_code == 200
        payload = response.json()
        assert payload["paging"] == {"offset": 0, "limit": 1, "total": 2}
        assert [item["id"] for item in payload["results"]] == [str(newest_payment.id)]

    def test_search_paginates_server_side_with_correct_total_and_no_duplicates(
        self,
        client: TestClient,
        db: Session,
        tenant_a: Tenants,
        admin_token_tenant_a: str,
    ) -> None:
        popup = _create_popup(db, tenant_a, suffix="pagination")
        base_time = datetime.now(UTC)

        expected_page_ids: list[str] = []
        for index in range(60):
            payment = _create_payment(
                db,
                tenant_a,
                popup,
                external_id=f"BULK-MATCH-{index:02d}",
                created_at=base_time + timedelta(minutes=index),
                attendee_specs=[
                    {
                        "name": f"Bulk Search Person {index}",
                        "email": f"bulk-search-{index}@test.com",
                    },
                    {
                        "name": f"Bulk Search Companion {index}",
                        "email": f"bulk-search-companion-{index}@test.com",
                    },
                ],
            )
            if 10 <= index <= 34:
                expected_page_ids.append(str(payment.id))

        for index in range(10):
            _create_payment(
                db,
                tenant_a,
                popup,
                external_id=f"NO-MATCH-{index:02d}",
                created_at=base_time + timedelta(minutes=100 + index),
                attendee_specs=[
                    {
                        "name": f"Irrelevant Person {index}",
                        "email": f"irrelevant-{index}@test.com",
                    },
                ],
            )

        response = client.get(
            "/api/v1/payments",
            params={
                "popup_id": str(popup.id),
                "search": "bulk-search",
                "skip": 25,
                "limit": 25,
            },
            headers=_admin_headers(admin_token_tenant_a),
        )

        assert response.status_code == 200
        payload = response.json()
        result_ids = [item["id"] for item in payload["results"]]

        assert payload["paging"] == {"offset": 25, "limit": 25, "total": 60}
        assert len(result_ids) == 25
        assert len(result_ids) == len(set(result_ids))
        assert result_ids == list(reversed(expected_page_ids))
