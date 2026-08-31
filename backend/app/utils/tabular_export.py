import json
import uuid
from datetime import datetime
from decimal import Decimal
from typing import Any


def safe_tabular_cell(value: Any, *, spreadsheet: bool = False) -> Any:
    """Serialize a cell while neutralizing CSV/XLSX formula injection."""
    if value is None:
        return ""
    if spreadsheet and isinstance(value, (bool, int, float)):
        return value
    if isinstance(value, datetime):
        value = value.isoformat()
    elif isinstance(value, uuid.UUID):
        value = str(value)
    elif isinstance(value, Decimal):
        return float(value) if spreadsheet else str(value)
    elif isinstance(value, (dict, list, tuple, set)):
        value = json.dumps(value, default=str, ensure_ascii=False)
    text = str(value)
    if text.lstrip().startswith(("=", "+", "-", "@")):
        text = f"'{text}"
    return text
