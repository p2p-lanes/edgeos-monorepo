import uuid
from decimal import Decimal
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch
from urllib.parse import parse_qs, urlparse

import pytest
from sqlmodel import Session

from app.api.attendee.models import Attendees
from app.api.payment.schemas import PaymentCreate, PaymentProductRequest
from app.core.security import create_access_token
from tests.api.payment.test_payment_recipients import _payment_context


def _auth(human) -> dict[str, str]:
    token = create_access_token(subject=human.id, token_type="human")
    return {"Authorization": f"Bearer {token}"}


def _assert_destination(
    url: str,
    *,
    destination: str,
    popup_slug: str,
    flow_slug: str,
    payment_id: str,
) -> None:
    parsed = urlparse(url)
    query = parse_qs(parsed.query)
    assert query["lang"] == ["es"]

    if destination == "external":
        assert parsed.netloc == "brand.example"
        assert parsed.path == "/es/thanks"
        assert "d" in query
        assert "sig" in query
        assert payment_id not in url
        return

    expected_prefix = "portal" if destination == "portal" else "checkout"
    assert parsed.path.endswith(f"/{expected_prefix}/{popup_slug}/thank-you")
    assert query["payment_id"] == [payment_id]
    assert query["flow"] == [flow_slug]


@pytest.mark.parametrize("amount", [Decimal("25"), Decimal("0")], ids=["paid", "zero"])
@pytest.mark.parametrize(
    ("destination", "return_context"),
    [
        ("external", "portal"),
        ("direct", "direct"),
        ("portal", "portal"),
    ],
)
def test_application_payment_uses_flow_success_destination(
    client,
    db: Session,
    tenant_a,
    amount: Decimal,
    destination: str,
    return_context: str,
) -> None:
    popup, flow, human, _category, application, product = _payment_context(db, tenant_a)
    product.price = amount
    product.attendee_category_id = None
    attendee = Attendees(
        tenant_id=tenant_a.id,
        popup_id=popup.id,
        human_id=human.id,
        application_id=application.id,
        name="Application buyer",
        email=human.email,
        category="main",
    )
    if destination == "external":
        flow.open_checkout_success_url = "https://brand.example/{locale}/thanks"
        flow.open_checkout_signing_secret = "application-payment-test-secret"
    db.add_all([flow, product, attendee])
    db.commit()

    payment_request = PaymentCreate(
        application_id=application.id,
        products=[
            PaymentProductRequest(product_id=product.id, attendee_id=attendee.id)
        ],
        locale="es",
        return_context=return_context,
    )
    provider_response = SimpleNamespace(
        id=f"provider-{uuid.uuid4().hex}",
        status="pending",
        checkout_url="https://pay.example/checkout",
        is_installment_plan=False,
    )

    with (
        patch("app.services.simplefi.get_simplefi_client") as get_client,
        patch(
            "app.api.payment.router._send_payment_confirmed_email_best_effort",
            new_callable=AsyncMock,
        ),
    ):
        get_client.return_value.create_payment.return_value = provider_response
        response = client.post(
            "/api/v1/payments/my",
            headers=_auth(human),
            json=payment_request.model_dump(mode="json"),
        )

        assert response.status_code == 201, response.text
        body = response.json()
        if amount > 0:
            success_url = get_client.return_value.create_payment.call_args.kwargs[
                "success_path"
            ]
            assert body["redirect_url"] is None
        else:
            get_client.return_value.create_payment.assert_not_called()
            success_url = body["redirect_url"]

        _assert_destination(
            success_url,
            destination=destination,
            popup_slug=popup.slug,
            flow_slug=flow.slug,
            payment_id=body["id"],
        )
