"""Tests for POST /checkout/{slug}/preview."""

from unittest.mock import patch

import pytest


@pytest.fixture(autouse=True)
def disable_preview_rate_limit() -> None:
    with patch("app.core.rate_limit.get_redis", return_value=None):
        yield


def test_preview_request_requires_products() -> None:
    from app.api.checkout.schemas import CheckoutPreviewRequest

    with pytest.raises(ValueError):
        CheckoutPreviewRequest(products=[])
