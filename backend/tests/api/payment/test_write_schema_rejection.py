import uuid

import pytest
from pydantic import ValidationError

from app.api.checkout.schemas import ProductLine
from app.api.payment.schemas import PaymentCreate
from tests.api.payment.test_typed_payment_writes import (
    _application_context,
    _auth,
    _open_context,
)

FORBIDDEN_FIELDS = ("fulfillment_type", "unexpected_override")
FORBIDDEN_VALUE = "client-supplied"


@pytest.mark.parametrize(
    ("schema", "payload"),
    [
        (ProductLine, {"product_id": uuid.uuid4()}),
        (
            PaymentCreate,
            {
                "popup_id": uuid.uuid4(),
                "products": [{"product_id": uuid.uuid4()}],
            },
        ),
    ],
    ids=("nested-product-line", "top-level-payment"),
)
@pytest.mark.parametrize("field_name", FORBIDDEN_FIELDS)
def test_write_schemas_reject_unknown_fields(schema, payload, field_name) -> None:
    with pytest.raises(ValidationError) as exc_info:
        schema.model_validate(payload | {field_name: FORBIDDEN_VALUE})

    assert [
        (error["type"], error["loc"], error["input"])
        for error in exc_info.value.errors()
    ] == [("extra_forbidden", (field_name,), FORBIDDEN_VALUE)]


def test_write_schemas_still_accept_legitimate_payloads() -> None:
    product_id = uuid.uuid4()
    popup_id = uuid.uuid4()

    product_line = ProductLine.model_validate({"product_id": product_id, "quantity": 2})
    payment = PaymentCreate.model_validate(
        {"popup_id": popup_id, "products": [{"product_id": product_id}]}
    )

    assert (product_line.product_id, product_line.quantity) == (product_id, 2)
    assert (payment.popup_id, payment.products[0].product_id) == (popup_id, product_id)


def _assert_extra_forbidden(response, location: list[str | int]) -> None:
    assert response.status_code == 422
    assert response.json() == {
        "detail": [
            {
                "type": "extra_forbidden",
                "loc": location,
                "msg": "Extra inputs are not permitted",
                "input": FORBIDDEN_VALUE,
            }
        ]
    }


@pytest.mark.parametrize("field_name", FORBIDDEN_FIELDS)
def test_open_purchase_rejects_unknown_nested_product_fields(
    client, db, tenant_a, field_name
) -> None:
    popup, flow = _open_context(db, tenant_a)

    response = client.post(
        f"/api/v1/checkout/{popup.slug}/{flow.slug}/purchase",
        headers={"X-Tenant-Id": str(tenant_a.id)},
        json={
            "products": [
                {"product_id": str(uuid.uuid4()), field_name: FORBIDDEN_VALUE}
            ],
            "buyer": {
                "email": "schema-rejection@test.com",
                "first_name": "Schema",
                "last_name": "Rejection",
            },
        },
    )

    _assert_extra_forbidden(response, ["body", "products", 0, field_name])


@pytest.mark.parametrize("field_name", FORBIDDEN_FIELDS)
def test_payment_create_rejects_unknown_top_level_fields(
    client, db, tenant_a, field_name
) -> None:
    _, _, human, application = _application_context(db, tenant_a)

    response = client.post(
        "/api/v1/payments/my",
        headers=_auth(human),
        json={
            "application_id": str(application.id),
            "products": [{"product_id": str(uuid.uuid4())}],
            field_name: FORBIDDEN_VALUE,
        },
    )

    _assert_extra_forbidden(response, ["body", field_name])
