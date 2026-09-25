import pytest
from alembic import command
from alembic.config import Config
from sqlalchemy import inspect
from sqlalchemy.exc import IntegrityError
from sqlmodel import Session, create_engine, delete, select
from testcontainers.postgres import PostgresContainer

from app.api.event_settings.models import EventSettings
from app.api.popup.models import Popups
from app.api.tenant.models import Tenants


def test_settings_follow_popup_deletion_and_fk_downgrade_preserves_rows():
    with PostgresContainer("postgres:17", driver="psycopg") as postgres:
        engine = create_engine(postgres.get_connection_url())
        with engine.begin() as connection:
            config = Config("alembic.ini")
            config.attributes["connection"] = connection
            command.upgrade(config, "a9d3e7f2b6c4")
            with Session(connection) as session:
                tenant = Tenants(name="Cascade tenant", slug="cascade-tenant")
                session.add(tenant)
                session.flush()
                popups = [
                    Popups(name=f"Popup {i}", slug=f"popup-{i}", tenant_id=tenant.id)
                    for i in range(2)
                ]
                session.add_all(popups)
                session.flush()
                rows = [
                    EventSettings(
                        popup_id=popup.id,
                        tenant_id=tenant.id,
                        events_require_approval=False,
                        timezone="Europe/Madrid",
                    )
                    for popup in popups
                ]
                session.add_all(rows)
                session.commit()
                popup_ids = [popup.id for popup in popups]
                before = {
                    row.popup_id: row.model_dump()
                    for row in session.exec(select(EventSettings)).all()
                }

                command.upgrade(config, "c6f1a8e4d2b7")
                session.expire_all()
                assert {
                    row.popup_id: row.model_dump()
                    for row in session.exec(select(EventSettings)).all()
                } == before
                foreign_key = next(
                    fk
                    for fk in inspect(connection).get_foreign_keys("event_settings")
                    if fk["constrained_columns"] == ["popup_id"]
                )
                assert foreign_key["options"]["ondelete"] == "CASCADE"

                connection.execute(delete(Popups).where(Popups.id == popup_ids[0]))
                session.expire_all()
                assert {
                    row.popup_id: row.model_dump()
                    for row in session.exec(select(EventSettings)).all()
                } == {popup_ids[1]: before[popup_ids[1]]}

                command.downgrade(config, "a9d3e7f2b6c4")
                with pytest.raises(IntegrityError), connection.begin_nested():
                    connection.execute(delete(Popups).where(Popups.id == popup_ids[1]))
                session.expire_all()
                assert {
                    row.popup_id: row.model_dump()
                    for row in session.exec(select(EventSettings)).all()
                } == {popup_ids[1]: before[popup_ids[1]]}

                command.upgrade(config, "c6f1a8e4d2b7")
                connection.execute(delete(Popups).where(Popups.id == popup_ids[1]))
                assert session.exec(select(EventSettings)).all() == []
        engine.dispose()
