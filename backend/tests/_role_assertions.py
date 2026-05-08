"""Helpers for role-based access control assertions.

Establishes the convention for: 'role X calling endpoint Y returns Z'.
This is the FIRST place this codebase asserts role-rejection behavior;
all subsequent role tests must use these helpers.
"""

from fastapi.testclient import TestClient


def assert_forbidden(
    client: TestClient,
    method: str,
    path: str,
    token: str,
    *,
    headers: dict[str, str] | None = None,
    json: dict | None = None,
    expected_detail_substring: str | None = None,
) -> None:
    """Assert that calling `method path` with `token` returns 403.

    Optionally asserts the response detail contains `expected_detail_substring`.
    """
    auth = {"Authorization": f"Bearer {token}"}
    if headers:
        auth.update(headers)
    response = client.request(method, path, headers=auth, json=json)
    assert response.status_code == 403, (
        f"Expected 403 on {method} {path}, got {response.status_code}: {response.text}"
    )
    if expected_detail_substring:
        assert expected_detail_substring in response.json().get("detail", "")


def assert_authorized(
    client: TestClient,
    method: str,
    path: str,
    token: str,
    *,
    headers: dict[str, str] | None = None,
    json: dict | None = None,
    expected_status: int = 200,
) -> None:
    """Assert that calling `method path` with `token` returns `expected_status` (default 200)."""
    auth = {"Authorization": f"Bearer {token}"}
    if headers:
        auth.update(headers)
    response = client.request(method, path, headers=auth, json=json)
    assert response.status_code == expected_status, (
        f"Expected {expected_status} on {method} {path}, "
        f"got {response.status_code}: {response.text}"
    )
