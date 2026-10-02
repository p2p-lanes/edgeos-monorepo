"""Public projections must not expose internal human assessments, even in old snapshots."""

import copy
import uuid
from datetime import UTC, datetime
from types import SimpleNamespace

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.api.application.schemas import ApplicationPortalPublic, ApplicationPublic
from app.api.attendee.schemas import (
    AttendeeCreate,
    AttendeePortalPublic,
    AttendeePublic,
    AttendeeUpdate,
    AttendeeWithOriginPortalPublic,
    AttendeeWithOriginPublic,
)
from app.api.auth.schemas import HumanAuth
from app.api.cart.schemas import (
    CartPortalState,
    CartPublic,
    CartState,
    CartUpdate,
    OpenCartPublic,
    OpenCartUpsert,
)
from app.api.checkout.schemas import BuyerInfo
from app.api.human.privacy import ADMIN_PROFILE_FIELDS, public_profile_metadata
from app.api.human.schemas import AuthenticatedHuman, HumanPublic, HumanSelfPublic
from app.api.payment.schemas import (
    PaymentPortalPublic,
    PaymentPublic,
    PaymentRecipientRequest,
    PaymentRecipientResponse,
)
from app.api.shared.enums import HumanRating
from app.main import application


@pytest.fixture
def metadata():
    return {
        "rating": "red_flag",
        "red_flag": True,
        "enriched_profile": {"bio": "Internal research", "tags": ["community"]},
        "dietary_notes": "vegetarian",
        "answers": {"rating": "a legitimate nested survey answer"},
    }


def human_data():
    return {
        "id": uuid.uuid4(),
        "tenant_id": uuid.uuid4(),
        "email": "privacy@example.com",
        "first_name": "Privacy",
        "rating": HumanRating.RED_FLAG,
        "red_flag": True,
        "enriched_profile": {"bio": "Internal research"},
    }


def attendee_data(metadata):
    return {
        "id": uuid.uuid4(),
        "tenant_id": uuid.uuid4(),
        "popup_id": uuid.uuid4(),
        "name": "Privacy",
        "additional_data": metadata,
        "origin": "direct_sale",
    }


def recipient_data(metadata):
    return {
        "id": uuid.uuid4(),
        "recipient_key": "draft:privacy",
        "name": "Privacy",
        "profile_snapshot": metadata,
        "created_at": datetime.now(UTC),
    }


def assert_public_metadata(value):
    assert ADMIN_PROFILE_FIELDS.isdisjoint(value)
    assert value["dietary_notes"] == "vegetarian"
    assert value["answers"] == {"rating": "a legitimate nested survey answer"}


def test_metadata_filter_is_targeted_and_non_mutating(metadata):
    before = copy.deepcopy(metadata)
    assert_public_metadata(public_profile_metadata(metadata))
    assert metadata == before


def test_internal_context_and_admin_response_keep_assessments():
    human = SimpleNamespace(**human_data())
    internal = AuthenticatedHuman.model_validate(human)
    assert internal.red_flag
    assert internal.rating == HumanRating.RED_FLAG
    assert internal.enriched_profile == human.enriched_profile
    assert HumanPublic.model_validate(human).model_dump()["red_flag"]
    public = HumanSelfPublic.model_validate(internal.model_dump())
    assert ADMIN_PROFILE_FIELDS.isdisjoint(public.model_dump())


@pytest.mark.parametrize(
    "public_type", [AttendeePortalPublic, AttendeeWithOriginPortalPublic]
)
def test_historical_attendee_metadata_is_filtered_only_on_output(public_type, metadata):
    admin = AttendeeWithOriginPublic(**attendee_data(metadata))
    before = copy.deepcopy(admin.additional_data)
    public = public_type.model_validate(admin)
    assert_public_metadata(public.model_dump(mode="json")["additional_data"])
    assert admin.additional_data == before
    assert admin.model_dump()["additional_data"]["red_flag"]


def test_application_nested_projection(metadata):
    admin = ApplicationPublic(
        id=uuid.uuid4(),
        tenant_id=uuid.uuid4(),
        popup_id=uuid.uuid4(),
        human_id=uuid.uuid4(),
        sales_flow_id=uuid.uuid4(),
        status="draft",
        human=HumanPublic(**human_data()),
        attendees=[AttendeePublic(**attendee_data(metadata))],
        red_flag=True,
        review_count=3,
        my_skip_reason="Internal note",
    )
    public = ApplicationPortalPublic.model_validate(admin.model_dump()).model_dump(
        mode="json"
    )
    assert ADMIN_PROFILE_FIELDS.isdisjoint(public)
    assert ADMIN_PROFILE_FIELDS.isdisjoint(public["human"])
    assert "my_skip_reason" not in public
    assert "reviewers" not in public
    assert_public_metadata(public["attendees"][0]["additional_data"])
    assert admin.human.red_flag


def test_historical_payment_metadata_is_filtered_only_on_output(metadata):
    recipient = PaymentRecipientResponse(**recipient_data(metadata))
    admin = PaymentPublic(
        id=uuid.uuid4(),
        tenant_id=uuid.uuid4(),
        popup_id=uuid.uuid4(),
        recipients=[recipient],
    )
    public = PaymentPortalPublic.model_validate(admin)
    assert_public_metadata(
        public.model_dump(mode="json")["recipients"][0]["profile_snapshot"]
    )
    assert admin.recipients[0].profile_snapshot["red_flag"]


@pytest.mark.parametrize("public_type", [CartPublic, OpenCartPublic])
def test_historical_cart_metadata_is_filtered_only_on_output(public_type, metadata):
    raw = {
        "recipients": [
            {
                "recipient_key": "draft:privacy",
                "name": "Privacy",
                "profile_snapshot": metadata,
            }
        ]
    }
    state = CartState.model_validate(raw)
    public = public_type(
        id=uuid.uuid4(),
        popup_id=uuid.uuid4(),
        human_id=uuid.uuid4(),
        email="privacy@example.com",
        items=state,
    )
    assert_public_metadata(
        public.model_dump(mode="json")["items"]["recipients"][0]["profile_snapshot"]
    )
    assert state.recipients[0].profile_snapshot["red_flag"]
    assert raw["recipients"][0]["profile_snapshot"]["red_flag"]
    assert isinstance(public.items, CartPortalState)


@pytest.mark.parametrize("request_type", [CartUpdate, OpenCartUpsert])
def test_untrusted_cart_snapshots_do_not_persist_assessments(request_type, metadata):
    obj = request_type.model_validate(
        {
            "email": "privacy@example.com",
            "items": {
                "recipients": [
                    {
                        "recipient_key": "draft:privacy",
                        "name": "Privacy",
                        "profile_snapshot": metadata,
                    }
                ]
            },
        }
    )
    assert_public_metadata(obj.items.recipients[0].profile_snapshot)
    assert metadata["red_flag"]


@pytest.mark.parametrize("request_type", [AttendeeCreate, AttendeeUpdate])
def test_untrusted_attendee_metadata_does_not_persist_assessments(
    request_type, metadata
):
    obj = request_type.model_validate({"name": "Privacy", "additional_data": metadata})
    assert_public_metadata(obj.additional_data)


def test_untrusted_payment_and_buyer_metadata_does_not_persist_assessments(metadata):
    assert_public_metadata(
        PaymentRecipientRequest(**recipient_data(metadata)).profile_snapshot
    )
    buyer = BuyerInfo(
        email="privacy@example.com",
        first_name="Privacy",
        last_name="Test",
        form_data=metadata,
    )
    assert_public_metadata(buyer.form_data)


def test_public_login_no_longer_accepts_a_flag():
    obj = HumanAuth.model_validate(
        {"tenant_id": uuid.uuid4(), "email": "privacy@example.com", "red_flag": True}
    )
    assert "red_flag" not in obj.model_dump()
    assert "red_flag" not in HumanAuth.model_fields


@pytest.mark.parametrize(
    "public_type,admin_type",
    [
        (HumanSelfPublic, AuthenticatedHuman),
        (AttendeeWithOriginPortalPublic, AttendeeWithOriginPublic),
        (PaymentPortalPublic, PaymentPublic),
    ],
)
def test_fastapi_response_projection_even_when_returning_an_admin_model(
    public_type, admin_type, metadata
):
    if admin_type is AuthenticatedHuman:
        admin = admin_type(**human_data())
    elif admin_type is AttendeeWithOriginPublic:
        admin = admin_type(**attendee_data(metadata))
    else:
        admin = admin_type(
            id=uuid.uuid4(),
            tenant_id=uuid.uuid4(),
            popup_id=uuid.uuid4(),
            recipients=[PaymentRecipientResponse(**recipient_data(metadata))],
        )
    api = FastAPI()

    @api.get("/test", response_model=public_type)
    def get_test():
        return admin

    with TestClient(api) as client:
        response = client.get("/test")
    assert response.status_code == 200
    body = response.json()
    if public_type is HumanSelfPublic:
        assert ADMIN_PROFILE_FIELDS.isdisjoint(body)
    elif public_type is AttendeeWithOriginPortalPublic:
        assert_public_metadata(body["additional_data"])
    else:
        assert_public_metadata(body["recipients"][0]["profile_snapshot"])


def test_every_portal_application_route_uses_the_safe_response_schema():
    spec = application.openapi()
    schemas = spec["components"]["schemas"]
    assert ADMIN_PROFILE_FIELDS.isdisjoint(schemas["HumanSelfPublic"]["properties"])
    assert "red_flag" not in schemas["ApplicationPortalPublic"]["properties"]
    assert "AuthenticatedHuman" not in schemas
    for path, operations in spec["paths"].items():
        if not path.startswith("/api/v1/applications/my"):
            continue
        for operation in operations.values():
            if not isinstance(operation, dict):
                continue
            for response in operation.get("responses", {}).values():
                schema = (
                    response.get("content", {})
                    .get("application/json", {})
                    .get("schema", {})
                )
                assert "ApplicationPublic" not in str(schema), (path, schema)
