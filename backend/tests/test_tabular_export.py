import pytest

from app.utils.tabular_export import safe_tabular_cell


@pytest.mark.parametrize("prefix", ["=", "+", "-", "@", "  ="])
def test_safe_tabular_cell_neutralizes_spreadsheet_formulas(prefix: str) -> None:
    assert safe_tabular_cell(f"{prefix}payload").startswith("'")


def test_safe_tabular_cell_preserves_regular_text() -> None:
    assert safe_tabular_cell("Ada Lovelace") == "Ada Lovelace"
