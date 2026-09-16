"""Migration coverage for the legacy globally unique users email index."""

from alembic import command
from alembic.config import Config
from sqlalchemy import text

REVISION = "c7e5a1b9d3f2"
PREVIOUS_REVISION = "b6d4e9f2a1c7"


def _config(connection) -> Config:
    config = Config("alembic.ini")
    config.attributes["connection"] = connection
    return config


def _is_users_email_index_unique(connection) -> bool | None:
    return connection.execute(
        text(
            """
            SELECT indisunique
            FROM pg_index
            WHERE indexrelid = to_regclass('public.ix_users_email')
            """
        )
    ).scalar_one_or_none()


def test_current_users_email_index_is_not_unique(migration_test_engine) -> None:
    with migration_test_engine.connect() as connection:
        assert _is_users_email_index_unique(connection) is False


def test_upgrade_repairs_globally_unique_email_index(migration_test_engine) -> None:
    with migration_test_engine.begin() as connection:
        config = _config(connection)
        command.downgrade(config, PREVIOUS_REVISION)
        connection.execute(text("DROP INDEX ix_users_email"))
        connection.execute(text("CREATE UNIQUE INDEX ix_users_email ON users (email)"))
        assert _is_users_email_index_unique(connection) is True

        command.upgrade(config, REVISION)

        assert _is_users_email_index_unique(connection) is False
