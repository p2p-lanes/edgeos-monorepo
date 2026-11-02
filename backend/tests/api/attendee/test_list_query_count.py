"""The unfiltered attendee list must eager-load ticket details."""

from unittest.mock import MagicMock

from sqlalchemy.orm import selectinload

import app.main  # noqa: F401 - register SQLModel relationships
from app.api.attendee.crud import attendees_crud
from app.api.attendee.models import AttendeeProducts, Attendees


def test_unfiltered_listing_loads_products_without_per_row_queries() -> None:
    session = MagicMock()
    session.exec.side_effect = [MagicMock(one=lambda: 0), MagicMock(all=lambda: [])]

    rows, total = attendees_crud.find(
        session,
        skip=0,
        limit=20,
        search="guest",
        search_fields=["name", "email"],
        load_options=(
            selectinload(Attendees.attendee_products).selectinload(
                AttendeeProducts.product
            ),
            selectinload(Attendees.category_ref),
        ),
    )

    assert (rows, total) == ([], 0)
    assert session.exec.call_count == 2
    statement = session.exec.call_args_list[1].args[0]
    assert len(statement._with_options) >= 2
