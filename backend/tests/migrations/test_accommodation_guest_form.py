"""Migration coverage for the accommodation guest form columns.

The upgrade is additive and defaulted, which is the part worth proving: rows
that existed before it read as "inherit" and "no answers", because that is
what they were. A NULL creeping into ``guest_form_mode`` would make
``resolve_form`` fall through to the step's questions for a property whose
operator never saw the setting.
"""

from alembic import command
from alembic.config import Config
from sqlalchemy import text

REVISION = "a4f1c8b2e7d3"
PREVIOUS_REVISION = "c7e5a1b9d3f2"

PROPERTY_COLUMNS = ("guest_form_mode", "guest_form")
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
        properties = _columns(connection, "accommodation_properties")
        bookings = _columns(connection, "accommodation_bookings")

    # A property that predates the form inherits, and inherits *nothing* until
    # a step is given a form, so nothing changes for it.
    assert properties["guest_form_mode"][0] == "NO"
    assert "inherit" in properties["guest_form_mode"][1]
    assert properties["guest_form"][0] == "YES"

    # A booking that predates the form answered nothing, and there was no form
    # to snapshot.
    assert bookings["booker_answers"][0] == "NO"
    assert "'{}'::jsonb" in bookings["booker_answers"][1]
    assert bookings["form_snapshot"][0] == "YES"


def test_upgrade_backfills_rows_written_before_it(migration_test_engine) -> None:
    with migration_test_engine.begin() as connection:
        config = _config(connection)
        command.downgrade(config, PREVIOUS_REVISION)

        for column in PROPERTY_COLUMNS:
            assert column not in _columns(connection, "accommodation_properties")
        for column in BOOKING_COLUMNS:
            assert column not in _columns(connection, "accommodation_bookings")

        command.upgrade(config, REVISION)

        properties = _columns(connection, "accommodation_properties")
        bookings = _columns(connection, "accommodation_bookings")
        assert all(column in properties for column in PROPERTY_COLUMNS)
        assert all(column in bookings for column in BOOKING_COLUMNS)
