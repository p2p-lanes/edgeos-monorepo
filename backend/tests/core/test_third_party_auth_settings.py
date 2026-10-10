"""Shared access-token settings, legacy env alias and bounded lifetimes."""

import pytest
from pydantic import ValidationError

from app.core.config import Settings

ACCESS = "THIRD_PARTY_ACCESS_TOKEN_EXPIRE_MINUTES"
LEGACY = "SSO_ACCESS_TOKEN_EXPIRE_MINUTES"


def test_legacy_sso_env_alias_and_new_name_precedence(monkeypatch):
    monkeypatch.delenv(ACCESS, raising=False)
    monkeypatch.setenv(LEGACY, "45")
    assert Settings(_env_file=None).THIRD_PARTY_ACCESS_TOKEN_EXPIRE_MINUTES == 45
    monkeypatch.setenv(ACCESS, "20")
    assert Settings(_env_file=None).THIRD_PARTY_ACCESS_TOKEN_EXPIRE_MINUTES == 20


@pytest.mark.parametrize(
    "name,value",
    [
        (ACCESS, "0"),
        (ACCESS, "61"),
        ("THIRD_PARTY_REFRESH_TOKEN_IDLE_DAYS", "0"),
        ("THIRD_PARTY_REFRESH_TOKEN_IDLE_DAYS", "31"),
        ("THIRD_PARTY_GRANT_EXPIRE_DAYS", "0"),
        ("THIRD_PARTY_GRANT_EXPIRE_DAYS", "91"),
    ],
)
def test_third_party_lifetimes_are_bounded(monkeypatch, name, value):
    monkeypatch.setenv(name, value)
    with pytest.raises(ValidationError):
        Settings(_env_file=None)
