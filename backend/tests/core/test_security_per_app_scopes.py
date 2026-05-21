"""TokenPayload.issued_by_app_id — encode/decode roundtrip tests.

RED-phase for Slice 2 Block A.

REQ-3.1: JWT carries per-app token scopes and app identity.
"""

from __future__ import annotations

import uuid

from app.core.security import (
    TokenPayload,
    create_access_token,
    decode_access_token,
)


class TestTokenPayloadIssuedByAppId:
    def test_token_payload_has_issued_by_app_id_field(self) -> None:
        """TokenPayload accepts issued_by_app_id=UUID and stores it."""
        app_id = uuid.uuid4()
        payload = TokenPayload(
            sub=str(uuid.uuid4()),
            exp=9999999999,
            issued_by_app_id=app_id,
        )
        assert payload.issued_by_app_id == app_id

    def test_token_payload_issued_by_app_id_defaults_to_none(self) -> None:
        """issued_by_app_id defaults to None when not provided."""
        payload = TokenPayload(
            sub=str(uuid.uuid4()),
            exp=9999999999,
        )
        assert payload.issued_by_app_id is None


class TestCreateAccessTokenEncodesAppId:
    def test_create_access_token_encodes_issued_by_app_id(self) -> None:
        """create_access_token accepts issued_by_app_id and the decoded payload
        carries the same UUID."""
        app_id = uuid.uuid4()
        subject = uuid.uuid4()
        token = create_access_token(
            subject=subject,
            token_type="human",
            issued_via="third_party",
            scopes=["portal:self_read"],
            issued_by_app_id=app_id,
        )
        payload = decode_access_token(token)
        assert payload.issued_by_app_id == app_id

    def test_create_access_token_without_app_id_decodes_to_none(self) -> None:
        """When issued_by_app_id is not passed, decoded payload has None."""
        subject = uuid.uuid4()
        token = create_access_token(
            subject=subject,
            token_type="human",
            issued_via="third_party",
            scopes=["portal:self_read"],
        )
        payload = decode_access_token(token)
        assert payload.issued_by_app_id is None

    def test_portal_token_has_no_issued_by_app_id(self) -> None:
        """Portal (non-third-party) tokens should not carry issued_by_app_id."""
        subject = uuid.uuid4()
        token = create_access_token(
            subject=subject,
            token_type="human",
        )
        payload = decode_access_token(token)
        assert payload.issued_by_app_id is None

    def test_roundtrip_preserves_app_id_uuid_type(self) -> None:
        """issued_by_app_id decoded from JWT is a uuid.UUID, not a str."""
        app_id = uuid.uuid4()
        subject = uuid.uuid4()
        token = create_access_token(
            subject=subject,
            token_type="human",
            issued_via="third_party",
            scopes=["portal:self_read"],
            issued_by_app_id=app_id,
        )
        payload = decode_access_token(token)
        assert isinstance(payload.issued_by_app_id, uuid.UUID)
        assert payload.issued_by_app_id == app_id
