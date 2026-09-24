"""The categories endpoint must not expose legacy blank values to UI selects."""

import asyncio
import uuid
from unittest.mock import Mock

from app.api.product.router import list_product_categories


def test_categories_query_excludes_blank_categories() -> None:
    db = Mock()
    db.exec.return_value.all.return_value = ["ticket"]

    assert asyncio.run(list_product_categories(db, uuid.uuid4())) == ["ticket"]
    statement = db.exec.call_args.args[0]
    assert "products.category !~" in str(statement.whereclause)
    assert "^[[:space:]]*$" in statement.whereclause.compile().params.values()
