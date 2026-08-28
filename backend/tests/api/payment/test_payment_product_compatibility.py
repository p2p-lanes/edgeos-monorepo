from sqlalchemy import CheckConstraint

from app.api.payment.models import PaymentProducts

CONSTRAINT_NAME = "ck_payment_product_fulfillment_identity_compatibility"
CONSTRAINT_EXPRESSION = (
    "fulfillment_type IS NULL OR fulfillment_type = 'order' OR "
    "(fulfillment_type IN ('access', 'participant') AND "
    "(payment_recipient_id IS NOT NULL OR attendee_id IS NOT NULL))"
)


def test_payment_product_model_declares_identity_compatibility_constraint() -> None:
    checks = {
        constraint.name: str(constraint.sqltext)
        for constraint in PaymentProducts.__table__.constraints
        if isinstance(constraint, CheckConstraint)
    }

    assert checks[CONSTRAINT_NAME] == CONSTRAINT_EXPRESSION
    assert "ck_payment_product_has_recipient_or_attendee" not in checks
