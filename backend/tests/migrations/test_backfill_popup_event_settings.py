from alembic import command
from alembic.config import Config
from sqlmodel import Session, create_engine, select
from testcontainers.postgres import PostgresContainer

from app.api.event_settings.models import EventSettings
from app.api.popup.models import Popups
from app.api.tenant.models import Tenants

PREVIOUS_REVISION = "f8a2c6d9e1b4"
REVISION = "a9d3e7f2b6c4"


def test_backfill_adds_only_missing_settings_and_preserves_them_on_downgrade():
    with PostgresContainer("postgres:17", driver="psycopg") as postgres:
        engine = create_engine(postgres.get_connection_url())
        with engine.begin() as connection:
            config = Config("alembic.ini")
            config.attributes["connection"] = connection
            command.upgrade(config, PREVIOUS_REVISION)
            with Session(connection) as session:
                tenants = [
                    Tenants(name=f"Tenant {i}", slug=f"tenant-{i}") for i in range(2)
                ]
                session.add_all(tenants)
                session.flush()
                popups = [
                    Popups(
                        name="Configured", slug="configured", tenant_id=tenants[0].id
                    ),
                    Popups(name="Missing A", slug="missing-a", tenant_id=tenants[0].id),
                    Popups(
                        name="Missing B",
                        slug="missing-b",
                        tenant_id=tenants[1].id,
                        events_enabled=False,
                    ),
                ]
                session.add_all(popups)
                session.flush()
                configured = EventSettings(
                    tenant_id=tenants[0].id,
                    popup_id=popups[0].id,
                    events_require_approval=False,
                    event_enabled=False,
                    can_publish_event="admin_only",
                    timezone="Europe/Madrid",
                    allowed_tags=["Existing"],
                    allowed_kinds=["Workshop"],
                    approval_notification_emails=["organizer@example.com"],
                    placeholder_url="https://example.com/image.png",
                )
                session.add(configured)
                session.commit()
                session.refresh(configured)
                before = configured.model_dump()
                expected_tenants = {popup.id: popup.tenant_id for popup in popups}

                command.upgrade(config, REVISION)
                session.expire_all()
                settings = {
                    row.popup_id: row
                    for row in session.exec(select(EventSettings)).all()
                }
                assert set(settings) == set(expected_tenants)
                assert settings[popups[0].id].model_dump() == before
                for popup in popups[1:]:
                    row = settings[popup.id]
                    assert row.tenant_id == expected_tenants[popup.id]
                    assert row.events_require_approval is True
                    assert row.event_enabled is True
                    assert row.can_publish_event == "everyone"
                    assert row.humans_can_create_venues is False
                    assert row.venues_require_approval is True
                    assert row.timezone == "UTC"
                    assert row.allowed_tags == []
                    assert row.allowed_kinds == []
                    assert row.approval_notification_emails == []
                after = {row.popup_id: row.model_dump() for row in settings.values()}

                command.downgrade(config, PREVIOUS_REVISION)
                command.upgrade(config, REVISION)
                session.expire_all()
                assert {
                    row.popup_id: row.model_dump()
                    for row in session.exec(select(EventSettings)).all()
                } == after
        engine.dispose()
