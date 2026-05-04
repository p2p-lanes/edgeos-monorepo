"""Regression test for deleted legacy direct payment endpoint."""

from fastapi.testclient import TestClient


def test_post_payments_direct_returns_404(client: TestClient) -> None:
    response = client.post(
        "/api/v1/payments/direct",
        json={
            "popup_id": "00000000-0000-0000-0000-000000000000",
            "products": [],
        },
    )

    assert response.status_code == 404, response.text
