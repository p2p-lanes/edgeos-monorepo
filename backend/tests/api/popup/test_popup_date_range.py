"""A popup's end date can never come before its start date.

Covers create (one schema check) and PATCH, where only one side of the range
may be sent and has to be checked against the value already stored.
"""

import uuid

import pytest
from fastapi.testclient import TestClient

from app.api.popup.schemas import validate_popup_date_range
from app.api.shared.enums import SaleType


def _headers(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


def _create(client: TestClient, token: str, **dates: str | None):
    return client.post(
        "/api/v1/popups",
        headers=_headers(token),
        json={
            "name": f"Date Range {uuid.uuid4().hex[:8]}",
            "sale_type": SaleType.direct.value,
            **dates,
        },
    )


def _patch(client: TestClient, token: str, popup_id: str, **dates: str | None):
    return client.patch(
        f"/api/v1/popups/{popup_id}", headers=_headers(token), json=dates
    )


def test_create_rejects_end_before_start(
    client: TestClient, admin_token_tenant_a: str
) -> None:
    response = _create(
        client,
        admin_token_tenant_a,
        start_date="2026-12-20T00:00:00Z",
        end_date="2026-12-01T00:00:00Z",
    )

    assert response.status_code == 422, response.text
    assert "end_date cannot be before start_date" in response.text


@pytest.mark.parametrize(
    "dates",
    [
        {"start_date": "2026-12-01T00:00:00Z", "end_date": "2026-12-20T00:00:00Z"},
        {"start_date": "2026-12-01T00:00:00Z", "end_date": "2026-12-01T00:00:00Z"},
        {"start_date": "2026-12-01T00:00:00Z"},
        {"end_date": "2026-12-20T00:00:00Z"},
        {},
    ],
)
def test_create_accepts_valid_or_partial_ranges(
    client: TestClient, admin_token_tenant_a: str, dates: dict[str, str]
) -> None:
    response = _create(client, admin_token_tenant_a, **dates)

    assert response.status_code == 201, response.text


def test_patch_rejects_inverted_range_sent_together(
    client: TestClient, admin_token_tenant_a: str
) -> None:
    popup = _create(client, admin_token_tenant_a).json()

    response = _patch(
        client,
        admin_token_tenant_a,
        popup["id"],
        start_date="2026-12-20T00:00:00Z",
        end_date="2026-12-01T00:00:00Z",
    )

    assert response.status_code == 422, response.text


def test_patch_rejects_start_after_stored_end(
    client: TestClient, admin_token_tenant_a: str
) -> None:
    popup = _create(
        client,
        admin_token_tenant_a,
        start_date="2026-12-01T00:00:00Z",
        end_date="2026-12-15T00:00:00Z",
    ).json()

    response = _patch(
        client, admin_token_tenant_a, popup["id"], start_date="2026-12-20T00:00:00Z"
    )

    assert response.status_code == 422, response.text
    stored = client.get(
        f"/api/v1/popups/{popup['id']}", headers=_headers(admin_token_tenant_a)
    ).json()
    assert stored["start_date"].startswith("2026-12-01")


def test_patch_rejects_end_before_stored_start(
    client: TestClient, admin_token_tenant_a: str
) -> None:
    popup = _create(
        client,
        admin_token_tenant_a,
        start_date="2026-12-10T00:00:00Z",
        end_date="2026-12-15T00:00:00Z",
    ).json()

    response = _patch(
        client, admin_token_tenant_a, popup["id"], end_date="2026-12-01T00:00:00Z"
    )

    assert response.status_code == 422, response.text


def test_patch_allows_moving_both_dates_and_clearing_one(
    client: TestClient, admin_token_tenant_a: str
) -> None:
    popup = _create(
        client,
        admin_token_tenant_a,
        start_date="2026-12-01T00:00:00Z",
        end_date="2026-12-15T00:00:00Z",
    ).json()

    moved = _patch(
        client,
        admin_token_tenant_a,
        popup["id"],
        start_date="2027-01-10T00:00:00Z",
        end_date="2027-01-20T00:00:00Z",
    )
    assert moved.status_code == 200, moved.text

    cleared = _patch(client, admin_token_tenant_a, popup["id"], end_date=None)
    assert cleared.status_code == 200, cleared.text
    assert cleared.json()["end_date"] is None

    later_start = _patch(
        client, admin_token_tenant_a, popup["id"], start_date="2027-06-01T00:00:00Z"
    )
    assert later_start.status_code == 200, later_start.text


def test_helper_compares_naive_and_aware_datetimes() -> None:
    from datetime import UTC, datetime

    with pytest.raises(ValueError):
        validate_popup_date_range(
            datetime(2026, 12, 20), datetime(2026, 12, 1, tzinfo=UTC)
        )
    validate_popup_date_range(datetime(2026, 12, 1), datetime(2026, 12, 20, tzinfo=UTC))
    validate_popup_date_range(None, datetime(2026, 12, 1))
