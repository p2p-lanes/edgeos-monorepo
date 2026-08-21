"""Flow-scoped cart routes protect aliases, restore links, and legacy carts."""

import importlib.util
import uuid
from datetime import UTC, datetime, timedelta
from decimal import Decimal
from pathlib import Path
from unittest.mock import patch

import pytest
from fastapi.testclient import TestClient
from sqlmodel import Session, select

from app.api.cart.crud import carts_crud
from app.api.cart.models import Carts
from app.api.human.crud import humans_crud
from app.api.payment.crud import payments_crud
from app.api.payment.models import Payments
from app.api.payment.schemas import PaymentStatus
from app.api.popup.models import Popups
from app.api.sales_flow.crud import sales_flows_crud
from app.api.sales_flow.models import SalesFlowAliases
from app.api.shared.enums import SaleType
from app.api.tenant.models import Tenants
from app.core.security import create_access_token
from app.utils.checkout_signing import build_cart_restore_token
from tests.api.checkout.test_flow_scoped_runtime import _make_direct_popup, _make_flow


def _items(marker: str) -> dict:
    return {
        "passes": [
            {
                "attendee_id": f"attendee-{marker}",
                "product_id": str(uuid.uuid4()),
                "quantity": 1,
            }
        ],
        "current_step": marker,
    }


def _headers(tenant: Tenants) -> dict[str, str]:
    return {"X-Tenant-Id": str(tenant.id)}


def _auth_headers(human_id: uuid.UUID) -> dict[str, str]:
    return {
        "Authorization": f"Bearer {create_access_token(subject=human_id, token_type='human')}"
    }


def _alias(
    db: Session, flow, alias: str, *, expires_at: datetime | None = None
) -> None:
    db.add(
        SalesFlowAliases(
            tenant_id=flow.tenant_id,
            popup_id=flow.popup_id,
            sales_flow_id=flow.id,
            alias=alias,
            expires_at=expires_at,
        )
    )
    db.commit()


def test_alias_resolves_once_to_its_canonical_flow(
    client: TestClient, db: Session, tenant_a: Tenants
) -> None:
    popup = _make_direct_popup(db, tenant_a)
    flow = _make_flow(db, popup, slug="experiences")
    _alias(db, flow, "old-experiences")

    response = client.get(
        f"/api/v1/checkout/{popup.slug}/old-experiences/runtime",
        headers=_headers(tenant_a),
    )

    assert response.status_code == 200, response.text
    assert response.headers.get("location") is None
    assert response.json()["selected_flow"]["slug"] == flow.slug


@pytest.mark.parametrize("candidate", ["%2F", "%252F", "not-a-flow"])
def test_malformed_encoded_and_unknown_flow_input_is_opaque_and_never_defaults(
    client: TestClient, db: Session, tenant_a: Tenants, candidate: str
) -> None:
    popup = _make_direct_popup(db, tenant_a)
    default = _make_flow(db, popup, slug="default-visible")
    db.commit()

    response = client.get(
        f"/api/v1/checkout/{popup.slug}/{candidate}/runtime",
        headers=_headers(tenant_a),
    )

    assert response.status_code == 404
    assert response.json()["detail"] in {"Not found", "Not Found"}
    assert default.slug not in response.text


def test_expired_or_unlisted_alias_is_opaque_and_does_not_fall_back(
    client: TestClient, db: Session, tenant_a: Tenants
) -> None:
    popup = _make_direct_popup(db, tenant_a)
    expired = _make_flow(db, popup, slug="expired-flow")
    hidden = _make_flow(db, popup, slug="hidden-flow", visibility="direct_url_only")
    _alias(
        db, expired, "old-expired", expires_at=datetime.now(UTC) - timedelta(seconds=1)
    )
    _alias(db, hidden, "old-hidden")

    for candidate in ("old-expired", "old-hidden"):
        response = client.get(
            f"/api/v1/checkout/{popup.slug}/{candidate}/runtime",
            headers=_headers(tenant_a),
        )
        assert response.status_code == 404
        assert response.json() == {"detail": "Not found"}
        assert candidate not in response.text


def test_cross_popup_alias_is_opaque(
    client: TestClient, db: Session, tenant_a: Tenants
) -> None:
    popup_a = _make_direct_popup(db, tenant_a)
    popup_b = _make_direct_popup(db, tenant_a)
    foreign = _make_flow(db, popup_b, slug="foreign-flow")
    _alias(db, foreign, "foreign-alias")

    response = client.get(
        f"/api/v1/checkout/{popup_a.slug}/foreign-alias/runtime",
        headers=_headers(tenant_a),
    )

    assert response.status_code == 404
    assert response.json() == {"detail": "Not found"}
    assert foreign.slug not in response.text


def test_named_flow_carts_are_isolated_and_restore_tokens_bind_the_flow(
    client: TestClient, db: Session, tenant_a: Tenants
) -> None:
    popup = _make_direct_popup(db, tenant_a)
    popup.open_checkout_signing_secret = "flow-cart-secret"
    first = _make_flow(db, popup, slug="first")
    second = _make_flow(db, popup, slug="second")
    db.commit()

    first_saved = client.put(
        f"/api/v1/checkout/{popup.slug}/{first.slug}/cart",
        headers=_headers(tenant_a),
        json={"email": "cart-flow@test.com", "items": _items("first")},
    )
    second_saved = client.put(
        f"/api/v1/checkout/{popup.slug}/{second.slug}/cart",
        headers=_headers(tenant_a),
        json={"email": "cart-flow@test.com", "items": _items("second")},
    )

    assert first_saved.status_code == 200, first_saved.text
    assert second_saved.status_code == 200, second_saved.text
    assert first_saved.json()["id"] != second_saved.json()["id"]
    assert first_saved.json()["items"]["current_step"] == "first"
    assert second_saved.json()["items"]["current_step"] == "second"

    replay = client.get(
        f"/api/v1/checkout/{popup.slug}/{first.slug}/cart",
        headers=_headers(tenant_a),
        params={
            "cid": first_saved.json()["id"],
            "sig": first_saved.json()["restore_token"],
        },
    )
    foreign = client.get(
        f"/api/v1/checkout/{popup.slug}/{second.slug}/cart",
        headers=_headers(tenant_a),
        params={
            "cid": first_saved.json()["id"],
            "sig": first_saved.json()["restore_token"],
        },
    )

    assert replay.status_code == 200
    assert replay.json()["items"]["current_step"] == "first"
    assert foreign.status_code == 404
    assert foreign.json() == {"detail": "Not found"}


def test_legacy_cart_migrates_once_or_is_quarantined_and_destination_wins(
    db: Session, tenant_a: Tenants
) -> None:
    popup = _make_direct_popup(db, tenant_a)
    default = sales_flows_crud.get_default_flow(db, popup.id)
    assert default is not None
    human_id = humans_crud.find_or_create(
        db, email="legacy-cart@test.com", tenant_id=tenant_a.id
    ).id
    legacy = Carts(
        tenant_id=tenant_a.id,
        popup_id=popup.id,
        human_id=human_id,
        items=_items("legacy"),
    )
    db.add(legacy)
    db.commit()

    migrated = carts_crud.get_or_create(
        db,
        human_id=human_id,
        popup_id=popup.id,
        tenant_id=tenant_a.id,
        sales_flow_id=default.id,
    )
    replay = carts_crud.get_or_create(
        db,
        human_id=human_id,
        popup_id=popup.id,
        tenant_id=tenant_a.id,
        sales_flow_id=default.id,
    )

    assert migrated.id == legacy.id
    assert replay.id == legacy.id
    assert migrated.sales_flow_id == default.id
    assert migrated.items["current_step"] == "legacy"

    destination_human = humans_crud.find_or_create(
        db, email="destination-cart@test.com", tenant_id=tenant_a.id
    )
    destination = Carts(
        tenant_id=tenant_a.id,
        popup_id=popup.id,
        human_id=destination_human.id,
        sales_flow_id=default.id,
        items=_items("destination"),
    )
    competing_legacy = Carts(
        tenant_id=tenant_a.id,
        popup_id=popup.id,
        human_id=destination_human.id,
        items=_items("quarantined"),
    )
    db.add_all([destination, competing_legacy])
    db.commit()

    winner = carts_crud.get_or_create(
        db,
        human_id=destination_human.id,
        popup_id=popup.id,
        tenant_id=tenant_a.id,
        sales_flow_id=default.id,
    )
    remaining = list(
        db.exec(
            select(Carts).where(
                Carts.human_id == destination_human.id,
                Carts.popup_id == popup.id,
            )
        ).all()
    )

    assert winner.id == destination.id
    assert winner.items["current_step"] == "destination"
    assert [cart.id for cart in remaining] == [destination.id]


def test_cart_continuity_proof_cannot_release_another_flow(
    db: Session, tenant_a: Tenants
) -> None:
    popup = _make_direct_popup(db, tenant_a)
    popup.open_checkout_signing_secret = "flow-release-secret"
    first = _make_flow(db, popup, slug="release-first")
    second = _make_flow(db, popup, slug="release-second")
    human = humans_crud.find_or_create(
        db, email="release-flow@test.com", tenant_id=tenant_a.id
    )
    cart = Carts(
        tenant_id=tenant_a.id,
        popup_id=popup.id,
        human_id=human.id,
        sales_flow_id=first.id,
        email=human.email,
        items=_items("release"),
    )
    db.add(cart)
    db.commit()

    token = build_cart_restore_token(
        str(cart.id),
        popup.open_checkout_signing_secret,
        popup_id=str(popup.id),
        flow_id=str(first.id),
    )

    assert payments_crud._validate_cart_continuity_proof(
        db, popup, human.email, cart.id, token, sales_flow_id=first.id
    )
    assert not payments_crud._validate_cart_continuity_proof(
        db, popup, human.email, cart.id, token, sales_flow_id=second.id
    )


def test_authenticated_cart_access_and_approval_cleanup_are_flow_scoped(
    client: TestClient, db: Session, tenant_a: Tenants
) -> None:
    popup = _make_direct_popup(db, tenant_a)
    first = _make_flow(db, popup, slug="portal-first")
    second = _make_flow(db, popup, slug="portal-second")
    human = humans_crud.find_or_create(
        db, email="portal-flow@test.com", tenant_id=tenant_a.id
    )
    first_cart = carts_crud.get_or_create(
        db,
        human_id=human.id,
        popup_id=popup.id,
        tenant_id=tenant_a.id,
        sales_flow_id=first.id,
    )
    second_cart = carts_crud.get_or_create(
        db,
        human_id=human.id,
        popup_id=popup.id,
        tenant_id=tenant_a.id,
        sales_flow_id=second.id,
    )
    first_cart.items = _items("portal-first")
    second_cart.items = _items("portal-second")
    db.add_all([first_cart, second_cart])
    db.commit()
    auth = _auth_headers(human.id)

    first_read = client.get(
        f"/api/v1/carts/my/{popup.id}",
        headers=auth,
        params={"sales_flow_id": str(first.id)},
    )
    second_write = client.put(
        f"/api/v1/carts/my/{popup.id}",
        headers=auth,
        params={"sales_flow_id": str(second.id)},
        json={"items": _items("portal-second-updated")},
    )

    assert first_read.status_code == 200, first_read.text
    assert first_read.json()["items"]["current_step"] == "portal-first"
    assert second_write.status_code == 200, second_write.text
    assert second_write.json()["items"]["current_step"] == "portal-second-updated"
    assert carts_crud.find_by_human_popup_flow(db, human.id, popup.id, first.id)
    assert (
        carts_crud.find_by_human_popup_flow(db, human.id, popup.id, first.id).items[
            "current_step"
        ]
        == "portal-first"
    )

    payment = Payments(
        tenant_id=tenant_a.id,
        popup_id=popup.id,
        sales_flow_id=second.id,
        status=PaymentStatus.PENDING.value,
        amount=Decimal("1"),
        buyer_snapshot={"buyer_email": human.email},
    )
    db.add(payment)
    db.commit()

    with patch.object(payments_crud, "_direct_buyer_human_id", return_value=human.id):
        payments_crud.approve_payment(db, payment.id)

    assert carts_crud.find_by_human_popup_flow(db, human.id, popup.id, first.id)
    assert (
        carts_crud.find_by_human_popup_flow(db, human.id, popup.id, second.id) is None
    )


def test_flow_bound_release_and_no_default_cart_quarantine_are_opaque(
    db: Session, tenant_a: Tenants
) -> None:
    popup = _make_direct_popup(db, tenant_a)
    popup.open_checkout_signing_secret = "release-bound-secret"
    named_flow = _make_flow(db, popup, slug="release-bound")
    human = humans_crud.find_or_create(
        db, email="release-bound@test.com", tenant_id=tenant_a.id
    )
    cart = carts_crud.get_or_create(
        db,
        human_id=human.id,
        popup_id=popup.id,
        tenant_id=tenant_a.id,
        sales_flow_id=named_flow.id,
    )
    cart.email = human.email
    db.add(cart)
    db.commit()
    token = build_cart_restore_token(
        str(cart.id),
        popup.open_checkout_signing_secret,
        popup_id=str(popup.id),
        flow_id=str(named_flow.id),
    )

    assert payments_crud._validate_cart_continuity_proof(
        db, popup, human.email, cart.id, token
    )
    assert not payments_crud._validate_cart_continuity_proof(
        db, popup, human.email, cart.id, f"{token[:-1]}x"
    )
    assert not payments_crud._validate_cart_continuity_proof(
        db, popup, "foreign@test.com", cart.id, token
    )


def test_no_default_cart_quarantine_is_opaque(
    client: TestClient, db: Session, tenant_a: Tenants
) -> None:
    no_default_popup = Popups(
        tenant_id=tenant_a.id,
        name="No default cart popup",
        slug=f"no-default-cart-{uuid.uuid4().hex[:8]}",
        sale_type=SaleType.direct.value,
        status="active",
    )
    db.add(no_default_popup)
    db.flush()
    human = humans_crud.find_or_create(
        db, email="legacy-quarantine@test.com", tenant_id=tenant_a.id
    )
    legacy = Carts(
        tenant_id=tenant_a.id,
        popup_id=no_default_popup.id,
        human_id=human.id,
        items=_items("legacy-quarantine"),
    )
    db.add(legacy)
    db.commit()

    response = client.get(
        f"/api/v1/carts/my/{no_default_popup.id}", headers=_auth_headers(human.id)
    )

    assert response.status_code == 404
    assert response.json() == {"detail": "Not found"}
    assert (
        legacy.id
        == carts_crud.find_by_human_popup(db, human.id, no_default_popup.id).id
    )


def test_flow_cart_migration_module_has_reversible_schema_operations() -> None:
    path = (
        Path(__file__).resolve().parents[3]
        / "app"
        / "alembic"
        / "versions"
        / "f3c9a1d7e2b4_flow_scoped_carts.py"
    )
    assert path.exists()
    spec = importlib.util.spec_from_file_location(path.stem, path)
    assert spec and spec.loader
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)

    assert module.revision == "f3c9a1d7e2b4"
    assert module.down_revision == "e2b6a90d4c17"

    with (
        patch.object(module, "op") as upgrade_op,
        patch.object(module, "add_tenant_table_permissions") as add_permissions,
    ):
        module.upgrade()
        assert upgrade_op.create_table.called
        assert upgrade_op.create_unique_constraint.called
        add_permissions.assert_called_once_with("sales_flow_aliases")

    with (
        patch.object(module, "op") as downgrade_op,
        patch.object(module, "remove_tenant_table_permissions") as remove_permissions,
    ):
        module.downgrade()
        assert downgrade_op.drop_column.called
        remove_permissions.assert_called_once_with("sales_flow_aliases")
