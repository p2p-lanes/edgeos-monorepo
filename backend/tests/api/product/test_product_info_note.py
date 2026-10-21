"""A product's info note: the admin-written context the checkout reveals
behind an info icon next to the product name (SIM-37).

e.g. "A passport will be requested for this product". Optional, short, and
translatable like the product's name and description.
"""

import uuid
from decimal import Decimal

from fastapi.testclient import TestClient
from sqlmodel import Session

from app.api.human.models import Humans
from app.api.popup.models import Popups
from app.api.product.models import Products
from app.api.tenant.models import Tenants
from app.api.translation.models import Translations
from app.core.security import create_access_token

NOTE = "A passport will be requested for this product."


def _headers(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


def _create(client: TestClient, token: str, popup: Popups, **extra):
    return client.post(
        "/api/v1/products",
        headers=_headers(token),
        json={
            "popup_id": str(popup.id),
            "name": f"Info Note {uuid.uuid4().hex[:8]}",
            "price": "50.00",
            "category": "ticket",
            **extra,
        },
    )


class TestAdminEditsTheNote:
    def test_create_stores_it(
        self,
        client: TestClient,
        admin_token_tenant_a: str,
        popup_tenant_a: Popups,
    ) -> None:
        resp = _create(client, admin_token_tenant_a, popup_tenant_a, info_note=NOTE)

        assert resp.status_code == 201, resp.text
        assert resp.json()["info_note"] == NOTE

    def test_products_have_none_by_default(
        self,
        client: TestClient,
        admin_token_tenant_a: str,
        popup_tenant_a: Popups,
    ) -> None:
        resp = _create(client, admin_token_tenant_a, popup_tenant_a)

        assert resp.status_code == 201, resp.text
        assert resp.json()["info_note"] is None

    def test_an_unrelated_patch_keeps_it_and_null_clears_it(
        self,
        client: TestClient,
        admin_token_tenant_a: str,
        popup_tenant_a: Popups,
    ) -> None:
        product_id = _create(
            client, admin_token_tenant_a, popup_tenant_a, info_note=NOTE
        ).json()["id"]

        renamed = client.patch(
            f"/api/v1/products/{product_id}",
            headers=_headers(admin_token_tenant_a),
            json={"name": "Renamed"},
        )
        cleared = client.patch(
            f"/api/v1/products/{product_id}",
            headers=_headers(admin_token_tenant_a),
            json={"info_note": None},
        )

        assert renamed.status_code == 200, renamed.text
        assert renamed.json()["info_note"] == NOTE
        assert cleared.status_code == 200, cleared.text
        assert cleared.json()["info_note"] is None

    def test_a_blank_note_means_no_note(
        self,
        client: TestClient,
        admin_token_tenant_a: str,
        popup_tenant_a: Popups,
    ) -> None:
        resp = _create(client, admin_token_tenant_a, popup_tenant_a, info_note="   ")

        assert resp.status_code == 201, resp.text
        assert resp.json()["info_note"] is None

    def test_it_has_a_ceiling(
        self,
        client: TestClient,
        admin_token_tenant_a: str,
        popup_tenant_a: Popups,
    ) -> None:
        resp = _create(
            client, admin_token_tenant_a, popup_tenant_a, info_note="x" * 501
        )

        assert resp.status_code == 422, resp.text

    def test_batch_import_carries_it(
        self,
        client: TestClient,
        superadmin_token: str,
        popup_tenant_a: Popups,
        tenant_a: Tenants,
    ) -> None:
        resp = client.post(
            "/api/v1/products/batch",
            headers={**_headers(superadmin_token), "X-Tenant-Id": str(tenant_a.id)},
            json={
                "popup_id": str(popup_tenant_a.id),
                "products": [
                    {
                        "name": f"Batch Note {uuid.uuid4().hex[:8]}",
                        "price": "10.00",
                        "info_note": NOTE,
                    }
                ],
            },
        )

        assert resp.status_code == 207, resp.text
        assert resp.json()[0]["success"] is True, resp.text
        assert resp.json()[0]["info_note"] == NOTE


class TestThePortalReadsIt:
    def test_the_portal_listing_returns_it_translated(
        self, client: TestClient, db: Session, tenant_a: Tenants
    ) -> None:
        # A popup of its own: the shared fixture popup collects products from
        # the whole session and this one can fall past the first page.
        popup = Popups(
            name="Info Note Popup",
            slug=f"info-note-{uuid.uuid4().hex[:8]}",
            tenant_id=tenant_a.id,
        )
        db.add(popup)
        db.flush()
        product = Products(
            tenant_id=tenant_a.id,
            popup_id=popup.id,
            name="Passport Pass",
            slug=f"passport-{uuid.uuid4().hex[:8]}",
            price=Decimal("10.00"),
            category="ticket",
            is_active=True,
            info_note=NOTE,
        )
        db.add(product)
        db.flush()
        db.add(
            Translations(
                tenant_id=tenant_a.id,
                entity_type="product",
                entity_id=product.id,
                language="es",
                data={"info_note": "Se pedira el pasaporte para este producto."},
            )
        )
        human = Humans(
            id=uuid.uuid4(),
            tenant_id=tenant_a.id,
            email=f"info-note-{uuid.uuid4().hex[:8]}@test.com",
        )
        db.add(human)
        db.commit()
        token = create_access_token(subject=human.id, token_type="human")

        def listed(language: str | None) -> dict:
            headers = _headers(token)
            if language:
                headers["Accept-Language"] = language
            resp = client.get(
                f"/api/v1/products/portal/products?popup_id={popup.id}",
                headers=headers,
            )
            assert resp.status_code == 200, resp.text
            return next(p for p in resp.json()["results"] if p["id"] == str(product.id))

        assert listed(None)["info_note"] == NOTE
        assert listed("es")["info_note"] == "Se pedira el pasaporte para este producto."


def test_the_anonymous_checkout_runtime_carries_it() -> None:
    """The open checkout builds its products from the row's own dump, so the
    runtime schema has to declare the field or it is silently dropped."""
    from app.api.checkout.schemas import CheckoutRuntimeProduct

    product = Products(
        id=uuid.uuid4(),
        tenant_id=uuid.uuid4(),
        popup_id=uuid.uuid4(),
        name="Passport Pass",
        slug="passport-pass",
        price=Decimal("10.00"),
        info_note=NOTE,
    )

    runtime = CheckoutRuntimeProduct.model_validate(product.model_dump())

    assert runtime.info_note == NOTE
