from alembic import command
from alembic.config import Config
from sqlalchemy import inspect, text
from sqlmodel import create_engine
from testcontainers.postgres import PostgresContainer


def test_event_message_migration_is_reversible_and_tenant_scoped():
    with PostgresContainer("postgres:17", driver="psycopg") as postgres:
        engine = create_engine(postgres.get_connection_url())
        with engine.begin() as connection:
            config = Config("alembic.ini")
            config.attributes["connection"] = connection
            command.upgrade(config, "f8a2c6d9e1b4")
            columns = {
                column["name"]
                for column in inspect(connection).get_columns("event_messages")
            }
            assert {
                "tenant_id",
                "event_id",
                "body",
                "sent_count",
                "failed_count",
                "completed_at",
            } <= columns
            assert connection.execute(
                text(
                    "SELECT relrowsecurity FROM pg_class WHERE oid = 'event_messages'::regclass"
                )
            ).scalar_one()
            assert (
                connection.execute(
                    text(
                        "SELECT count(*) FROM pg_policies WHERE tablename = 'event_messages'"
                    )
                ).scalar_one()
                > 0
            )
            command.downgrade(config, "c82e1f4a39d7")
            assert not inspect(connection).has_table("event_messages")
            command.upgrade(config, "f8a2c6d9e1b4")
            assert inspect(connection).has_table("event_messages")
        engine.dispose()
