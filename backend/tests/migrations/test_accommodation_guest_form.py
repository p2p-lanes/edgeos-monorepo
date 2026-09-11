"""Migration coverage for the accommodation guest form columns.

The upgrade is additive and defaulted, which is the part worth proving: rows
that existed before it read as "no answers", because that is what they were. A
NULL creeping into ``booker_answers`` would turn every read of a pre-existing
booking into a None check nobody wrote.
"""

from alembic import command
from alembic.config import Config
from sqlalchemy import text

REVISION = "a4f1c8b2e7d3"
PREVIOUS_REVISION = "a6f4c2e9d1b7"

BOOKING_COLUMNS = ("booker_answers", "form_snapshot")


def _config(connection) -> Config:
    config = Config("alembic.ini")
    config.attributes["connection"] = connection
    return config


def _columns(connection, table: str) -> dict[str, tuple]:
    rows = connection.execute(
        text(
            """
            SELECT column_name, is_nullable, column_default
            FROM information_schema.columns
            WHERE table_name = :table
            """
        ),
        {"table": table},
    ).all()
    return {row[0]: (row[1], row[2]) for row in rows}


def test_the_columns_are_there_with_the_defaults_old_rows_need(
    migration_test_engine,
) -> None:
    with migration_test_engine.connect() as connection:
        bookings = _columns(connection, "accommodation_bookings")

    # A booking that predates the form answered nothing, and there was no form
    # to snapshot.
    assert bookings["booker_answers"][0] == "NO"
    assert "'{}'::jsonb" in bookings["booker_answers"][1]
    assert bookings["form_snapshot"][0] == "YES"


def test_upgrade_backfills_rows_written_before_it(migration_test_engine) -> None:
    with migration_test_engine.begin() as connection:
        config = _config(connection)
        command.downgrade(config, PREVIOUS_REVISION)

        for column in BOOKING_COLUMNS:
            assert column not in _columns(connection, "accommodation_bookings")

        command.upgrade(config, REVISION)

        bookings = _columns(connection, "accommodation_bookings")
        assert all(column in bookings for column in BOOKING_COLUMNS)


def test_the_questions_themselves_need_no_column(migration_test_engine) -> None:
    """The form lives on the step, in ``template_config``, which is JSONB that
    already exists. Nothing about it belongs on a property."""
    with migration_test_engine.connect() as connection:
        properties = _columns(connection, "accommodation_properties")

    assert "guest_form" not in properties
    assert "guest_form_mode" not in properties
