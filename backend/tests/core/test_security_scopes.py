"""Tests for TokenPayload scopes and issued_via fields.

RED-phase tests for Block 2. These validate:
  - TokenPayload carries scopes and issued_via.
  - create_access_token encodes them into the JWT payload.
  - decode_access_token recovers them.
  - Grace-period synthesis for legacy human tokens.
  - No grace synthesis for user tokens.
  - Scope universe disjointness (sanity).
  - ADMIN_API_KEY_SCOPES excludes the blacklisted domains.

Tests are expected to FAIL until core/security.py is updated.
"""

from __future__ import annotations

import uuid
from typing import get_args

import jwt

from app.core.config import settings
from app.core.security import (
    ADMIN_API_KEY_SCOPES,
    ALGORITHM,
    THIRD_PARTY_API_KEY_SCOPES_MAX,
    THIRD_PARTY_TOKEN_SCOPES_MAX,
    ApiKeyScope,
    HumanScope,
    create_access_token,
    decode_access_token,
)

_BLACKLISTED_SCOPES = {
    "email_templates",
    "users",
    "tenants",
    "popup_reviewers",
    "payments:write",
}


class TestTokenPayloadCarriesScopesAndIssuedVia:
    """TokenPayload fields are present and default correctly."""

    def test_token_payload_carries_scopes_and_issued_via(self) -> None:
        from datetime import UTC, datetime, timedelta

        from app.core.security import TokenPayload

        payload = TokenPayload(
            sub=str(uuid.uuid4()),
            exp=datetime.now(UTC) + timedelta(minutes=30),
            token_type="human",
            issued_via="portal",
            scopes=["portal:self_read"],
        )

        assert payload.issued_via == "portal"
        assert payload.scopes == ["portal:self_read"]

    def test_token_payload_defaults(self) -> None:
        from datetime import UTC, datetime, timedelta

        from app.core.security import TokenPayload

        payload = TokenPayload(
            sub=str(uuid.uuid4()),
            exp=datetime.now(UTC) + timedelta(minutes=30),
        )

        assert payload.issued_via == "portal"
        assert payload.scopes == []
        assert payload.api_key_tenant_id is None


class TestCreateDecodeRoundtrip:
    """Encode and decode symmetry for new fields."""

    def test_create_decode_roundtrip_third_party_scopes(self) -> None:
        """create_access_token encodes scopes+issued_via; decode recovers them."""
        token = create_access_token(
            subject=uuid.uuid4(),
            token_type="human",
            scopes=list(THIRD_PARTY_TOKEN_SCOPES_MAX),
            issued_via="third_party",
        )
        payload = decode_access_token(token)

        assert payload.issued_via == "third_party"
        assert set(payload.scopes) == set(THIRD_PARTY_TOKEN_SCOPES_MAX)

    def test_create_decode_roundtrip_default_no_scopes(self) -> None:
        """Token created without scopes decodes to empty list (not portal:*)."""
        subject = uuid.uuid4()
        token = create_access_token(subject=subject, token_type="user")
        payload = decode_access_token(token)

        assert payload.issued_via == "portal"
        assert payload.scopes == []  # no grace synth for user tokens


class TestGracePeriod:
    """Legacy human tokens with absent/empty scopes get portal:* synthesised."""

    def test_legacy_human_token_without_scopes_field_decodes_as_portal_star(
        self,
    ) -> None:
        """A JWT with no `scopes` key in the payload (legacy) decodes as portal:*."""
        # Mint a raw JWT manually without scopes key
        import datetime as dt

        raw_payload = {
            "sub": str(uuid.uuid4()),
            "exp": dt.datetime.now(dt.UTC) + dt.timedelta(minutes=30),
            "token_type": "human",
        }
        token = jwt.encode(raw_payload, settings.SECRET_KEY, algorithm=ALGORITHM)

        payload = decode_access_token(token)

        assert "portal:*" in payload.scopes
        assert payload.issued_via == "portal"

    def test_human_token_with_empty_scopes_decodes_as_portal_star(self) -> None:
        """A JWT with scopes=[] is treated the same as absent scopes for humans."""
        import datetime as dt

        raw_payload = {
            "sub": str(uuid.uuid4()),
            "exp": dt.datetime.now(dt.UTC) + dt.timedelta(minutes=30),
            "token_type": "human",
            "scopes": [],
        }
        token = jwt.encode(raw_payload, settings.SECRET_KEY, algorithm=ALGORITHM)

        payload = decode_access_token(token)

        assert "portal:*" in payload.scopes

    def test_user_token_without_scopes_decodes_with_empty_list(self) -> None:
        """User (admin) tokens do NOT get the portal:* grace synthesis."""
        import datetime as dt

        raw_payload = {
            "sub": str(uuid.uuid4()),
            "exp": dt.datetime.now(dt.UTC) + dt.timedelta(minutes=30),
            "token_type": "user",
        }
        token = jwt.encode(raw_payload, settings.SECRET_KEY, algorithm=ALGORITHM)

        payload = decode_access_token(token)

        assert "portal:*" not in payload.scopes
        assert payload.scopes == []


class TestScopeUniverses:
    """Sanity checks on the scope constant sets."""

    def test_third_party_token_scopes_disjoint_from_api_key_universe(
        self,
    ) -> None:
        """THIRD_PARTY_TOKEN_SCOPES_MAX (HumanScope) must not overlap ApiKeyScope."""
        human_scopes = set(get_args(HumanScope))
        api_key_scopes = set(get_args(ApiKeyScope))
        overlap = human_scopes & api_key_scopes
        assert overlap == set(), f"Overlapping scopes: {overlap}"

    def test_admin_api_key_scopes_excludes_blacklist(self) -> None:
        """ADMIN_API_KEY_SCOPES must not contain any blacklisted domain tokens."""
        for scope in ADMIN_API_KEY_SCOPES:
            for blacklisted in _BLACKLISTED_SCOPES:
                assert not scope.startswith(blacklisted), (
                    f"Scope '{scope}' looks like a blacklisted domain '{blacklisted}'"
                )

    def test_third_party_api_key_scopes_is_subset_of_admin_scopes(self) -> None:
        """THIRD_PARTY_API_KEY_SCOPES_MAX is a proper subset of ADMIN_API_KEY_SCOPES."""
        assert THIRD_PARTY_API_KEY_SCOPES_MAX.issubset(ADMIN_API_KEY_SCOPES)

    def test_third_party_token_scopes_all_in_human_scope_literal(self) -> None:
        """Every value in THIRD_PARTY_TOKEN_SCOPES_MAX must be a valid HumanScope."""
        human_scope_values = set(get_args(HumanScope))
        for scope in THIRD_PARTY_TOKEN_SCOPES_MAX:
            assert scope in human_scope_values, f"'{scope}' not in HumanScope"
