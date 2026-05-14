"""Unit tests for PaymentProductRequest validators: unit_price_override field.

Spec: payments Delta — Requirement: unit_price_override Field
"""

import uuid
from decimal import Decimal

import pytest
from pydantic import ValidationError

from app.api.payment.schemas import PaymentProductRequest


class TestPaymentProductRequestSchema:
    """PaymentProductRequest structural validators."""

    def test_unit_price_override_defaults_to_none(self) -> None:
        """unit_price_override is optional, defaults to None."""
        req = PaymentProductRequest(
            product_id=uuid.uuid4(),
            attendee_id=uuid.uuid4(),
            quantity=1,
        )
        assert req.unit_price_override is None

    def test_positive_unit_price_override_is_valid(self) -> None:
        """unit_price_override >= 0 is accepted at the schema level."""
        req = PaymentProductRequest(
            product_id=uuid.uuid4(),
            attendee_id=uuid.uuid4(),
            quantity=1,
            unit_price_override=Decimal("5000"),
        )
        assert req.unit_price_override == Decimal("5000")

    def test_zero_unit_price_override_is_valid(self) -> None:
        """unit_price_override = 0 is accepted (edge case)."""
        req = PaymentProductRequest(
            product_id=uuid.uuid4(),
            attendee_id=uuid.uuid4(),
            quantity=1,
            unit_price_override=Decimal("0"),
        )
        assert req.unit_price_override == Decimal("0")

    def test_negative_unit_price_override_is_rejected(self) -> None:
        """unit_price_override < 0 must be rejected with 422."""
        with pytest.raises(ValidationError) as exc_info:
            PaymentProductRequest(
                product_id=uuid.uuid4(),
                attendee_id=uuid.uuid4(),
                quantity=1,
                unit_price_override=Decimal("-1"),
            )
        errors = exc_info.value.errors()
        assert any(
            "unit_price_override" in str(e) or "non-negative" in str(e).lower()
            for e in errors
        ), f"Expected unit_price_override error, got: {errors}"
