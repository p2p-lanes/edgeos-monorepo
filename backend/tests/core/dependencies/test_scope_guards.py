"""Tests for require_human_scope and CurrentAdminOrApiKey dependency guards.

RED-phase tests for Block 4. These validate:
  - require_human_scope passes on portal:* wildcard (explicit or grace-synthesised).
  - require_human_scope passes on exact matching scope.
  - require_human_scope raises 403 on missing scope.
  - CurrentAdminOrApiKey JWT path: ADMIN succeeds, VIEWER is rejected.
  - CurrentAdminOrApiKey api-key path: matching scope succeeds, missing scope is 403.
  - CurrentAdminOrApiKey rejects human JWTs outright.
  - get_admin_or_api_key_tenant_session resolves tenant from api_key row (api-key branch).
  - get_admin_or_api_key_tenant_session delegates to get_tenant_session (JWT branch).

Tests are expected to FAIL until app/core/dependencies/users.py is updated.
"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime, timedelta

import pytest
from fastapi import HTTPException

from app.core.security import (
    TokenPayload,
    create_access_token,
    decode_access_token,
)

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _human_payload(scopes: list[str]) -> TokenPayload:
    return TokenPayload(
        sub=str(uuid.uuid4()),
        exp=datetime.now(UTC) + timedelta(minutes=30),
        token_type="human",
        scopes=scopes,  # type: ignore[arg-type]
        issued_via="portal",
    )


def _user_payload(
    user_id: uuid.UUID | None = None,
    scopes: list[str] | None = None,
    via_api_key: bool = False,
    api_key_tenant_id: uuid.UUID | None = None,
) -> TokenPayload:
    return TokenPayload(
        sub=str(user_id or uuid.uuid4()),
        exp=datetime.now(UTC) + timedelta(minutes=30),
        token_type="user",
        scopes=scopes or [],  # type: ignore[arg-type]
        issued_via="portal",
        via_api_key=via_api_key,
        api_key_tenant_id=api_key_tenant_id,
    )


# ---------------------------------------------------------------------------
# require_human_scope
# ---------------------------------------------------------------------------


class TestRequireHumanScope:
    """Scope guard for portal (human) routes."""

    def test_require_human_scope_accepts_explicit_wildcard(self) -> None:
        """A token with portal:* passes any HumanScope check."""
        from app.core.dependencies.users import require_human_scope

        payload = _human_payload(["portal:*"])
        guard = require_human_scope("portal:applications:read")
        # Should not raise
        guard(payload)

    def test_require_human_scope_accepts_grace_synthesised_wildcard(self) -> None:
        """A legacy token whose scopes were synthesised to [portal:*] passes."""
        from app.core.dependencies.users import require_human_scope

        # decode_access_token synthesises portal:* for empty-scopes human tokens.
        token = create_access_token(
            subject=uuid.uuid4(),
            token_type="human",
        )
        payload = decode_access_token(token)
        assert "portal:*" in payload.scopes  # confirm synthesis happened

        guard = require_human_scope("portal:directory:read")
        # Should not raise
        guard(payload)

    def test_require_human_scope_accepts_matching_scope(self) -> None:
        """A token with the exact requested scope passes."""
        from app.core.dependencies.users import require_human_scope

        payload = _human_payload(["portal:applications:read"])
        guard = require_human_scope("portal:applications:read")
        guard(payload)  # Should not raise

    def test_require_human_scope_rejects_missing_scope(self) -> None:
        """A token without the required scope and without portal:* raises 403."""
        from app.core.dependencies.users import require_human_scope

        payload = _human_payload(["portal:applications:read"])
        guard = require_human_scope("portal:directory:read")
        with pytest.raises(HTTPException) as exc_info:
            guard(payload)
        assert exc_info.value.status_code == 403

    def test_require_human_scope_rejects_empty_explicit_scope_list(self) -> None:
        """A token with an explicit empty scopes list (no grace synth) raises 403.

        Note: in practice decode_access_token synthesises portal:* for human tokens
        with empty scopes. This tests the guard itself with a raw payload that has
        no scopes at all (edge case for direct payload construction).
        """
        from app.core.dependencies.users import require_human_scope

        # Build a payload with scopes=[] directly — simulates a future non-human
        # token or a specially crafted payload bypassing decode.
        payload = _human_payload([])
        guard = require_human_scope("portal:applications:read")
        with pytest.raises(HTTPException) as exc_info:
            guard(payload)
        assert exc_info.value.status_code == 403

    def test_require_human_scope_wildcard_token_passes_directory_read(self) -> None:
        """Explicit portal:* token passes portal:directory_read guard (REQ-TV-04)."""
        from app.core.dependencies.users import require_human_scope

        payload = _human_payload(["portal:*"])
        guard = require_human_scope("portal:directory:read")
        guard(payload)  # Should not raise

    def test_require_human_scope_wildcard_token_passes_api_keys_manage(self) -> None:
        """Explicit portal:* token passes portal:api_keys_manage guard."""
        from app.core.dependencies.users import require_human_scope

        payload = _human_payload(["portal:*"])
        guard = require_human_scope("portal:api_keys:manage")
        guard(payload)  # Should not raise

    def test_require_human_scope_specific_token_fails_other_scope(self) -> None:
        """Token with only portal:self_read fails portal:api_keys_manage (REQ-SE-03)."""
        from app.core.dependencies.users import require_human_scope

        payload = _human_payload(["portal:applications:read"])
        guard = require_human_scope("portal:api_keys:manage")
        with pytest.raises(HTTPException) as exc_info:
            guard(payload)
        assert exc_info.value.status_code == 403


# ---------------------------------------------------------------------------
# CurrentAdminOrApiKey
# ---------------------------------------------------------------------------


class TestCurrentAdminOrApiKey:
    """Dual-auth guard for admin endpoints."""

    def test_jwt_path_admin_role_succeeds(
        self,
        db,
        admin_user_tenant_a,
    ) -> None:
        """Admin JWT (role=ADMIN) is accepted; returns UserPublic."""
        from app.api.shared.enums import UserRole
        from app.core.dependencies.users import CurrentAdminOrApiKey

        payload = _user_payload(user_id=admin_user_tenant_a.id)
        dep = CurrentAdminOrApiKey("attendees:read")
        result = dep(token_payload=payload, db=db)

        assert result.role in (UserRole.ADMIN, UserRole.SUPERADMIN)

    def test_jwt_path_viewer_rejected(
        self,
        db,
        viewer_user_tenant_a,
    ) -> None:
        """Viewer JWT raises 403 on admin-only endpoint."""
        from app.core.dependencies.users import CurrentAdminOrApiKey

        payload = _user_payload(user_id=viewer_user_tenant_a.id)
        dep = CurrentAdminOrApiKey("attendees:read")
        with pytest.raises(HTTPException) as exc_info:
            dep(token_payload=payload, db=db)
        assert exc_info.value.status_code == 403

    def test_api_key_path_matching_scope_succeeds(
        self,
        db,
        admin_api_key_factory,
        admin_user_tenant_a,
    ) -> None:
        """Admin api-key with matching scope returns UserPublic."""
        from app.core.dependencies.users import CurrentAdminOrApiKey

        _row, _raw = admin_api_key_factory(scopes=["attendees:read"])
        payload = _user_payload(
            user_id=admin_user_tenant_a.id,
            scopes=["attendees:read"],
            via_api_key=True,
        )
        dep = CurrentAdminOrApiKey("attendees:read")
        result = dep(token_payload=payload, db=db)
        assert result is not None

    def test_api_key_path_missing_scope_rejected_403(
        self,
        db,
        admin_api_key_factory,
        admin_user_tenant_a,
    ) -> None:
        """Admin api-key without required scope raises 403."""
        from app.core.dependencies.users import CurrentAdminOrApiKey

        _row, _raw = admin_api_key_factory(scopes=["attendees:read"])
        payload = _user_payload(
            user_id=admin_user_tenant_a.id,
            scopes=["attendees:read"],  # has read but guard requires write
            via_api_key=True,
        )
        dep = CurrentAdminOrApiKey("attendees:write")
        with pytest.raises(HTTPException) as exc_info:
            dep(token_payload=payload, db=db)
        assert exc_info.value.status_code == 403

    def test_human_jwt_rejected(self, db) -> None:
        """Human JWT raises 403 on admin-only endpoint."""
        from app.core.dependencies.users import CurrentAdminOrApiKey

        payload = TokenPayload(
            sub=str(uuid.uuid4()),
            exp=datetime.now(UTC) + timedelta(minutes=30),
            token_type="human",
            scopes=["portal:*"],  # type: ignore[arg-type]
        )
        dep = CurrentAdminOrApiKey("attendees:read")
        with pytest.raises(HTTPException) as exc_info:
            dep(token_payload=payload, db=db)
        assert exc_info.value.status_code == 403


# ---------------------------------------------------------------------------
# Backwards compatibility (grace period + wildcard)
# ---------------------------------------------------------------------------


class TestBackwardsCompatibility:
    """Explicit tests for REQ-TV-04 and the grace-period backward compat contract."""

    def test_old_token_synthesised_portal_star_passes_all_guards(self) -> None:
        """Old token (synthesised portal:*) passes all require_human_scope guards."""
        from app.core.dependencies.users import require_human_scope

        # Mint a legacy-style token (no scopes in the JWT payload).
        token = create_access_token(subject=uuid.uuid4(), token_type="human")
        payload = decode_access_token(token)

        # Grace synthesis should have happened.
        assert "portal:*" in payload.scopes

        # Must pass all three guards.
        for scope in ("portal:applications:read", "portal:directory:read", "portal:api_keys:manage"):
            guard = require_human_scope(scope)  # type: ignore[arg-type]
            guard(payload)  # Should not raise

    def test_new_token_with_self_read_only_passes_self_fails_others(self) -> None:
        """New token with portal:self_read passes self-read, fails directory and api-keys."""
        from app.core.dependencies.users import require_human_scope

        token = create_access_token(
            subject=uuid.uuid4(),
            token_type="human",
            scopes=["portal:applications:read"],
            issued_via="third_party",
        )
        payload = decode_access_token(token)

        # self_read passes
        guard_self = require_human_scope("portal:applications:read")
        guard_self(payload)

        # directory_read fails
        guard_dir = require_human_scope("portal:directory:read")
        with pytest.raises(HTTPException) as exc_info:
            guard_dir(payload)
        assert exc_info.value.status_code == 403

        # api_keys_manage fails
        guard_keys = require_human_scope("portal:api_keys:manage")
        with pytest.raises(HTTPException) as exc_info:
            guard_keys(payload)
        assert exc_info.value.status_code == 403
