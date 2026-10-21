import pytest
from pydantic import ValidationError

from app.api.popup.schemas import PopupCreate, PopupUpdate
from app.api.sales_flow.schemas import SIMPLEFI_PRICING_FIELDS


@pytest.mark.parametrize("schema", [PopupCreate, PopupUpdate])
@pytest.mark.parametrize("field", SIMPLEFI_PRICING_FIELDS)
@pytest.mark.parametrize("value", [-100, 101, "1.234", "NaN", "Infinity"])
def test_popup_rejects_invalid_pricing(schema, field, value):
    with pytest.raises(ValidationError):
        schema(name="Pricing test", **{field: value})


@pytest.mark.parametrize("schema", [PopupCreate, PopupUpdate])
@pytest.mark.parametrize("field", SIMPLEFI_PRICING_FIELDS)
@pytest.mark.parametrize("value", [None, 0, -99, 100, "3.25"])
def test_popup_accepts_pricing_defaults(schema, field, value):
    from decimal import Decimal

    popup = schema(name="Pricing test", **{field: value})
    assert getattr(popup, field) == (None if value is None else Decimal(str(value)))
