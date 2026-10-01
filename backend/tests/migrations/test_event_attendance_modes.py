"""SIM-106 backfill: QR check-ins taken before attendance modes stay coherent.

An event with a checked-in participant must not sit in ``none``, and each
existing check-in needs a history row so it can later be voided.
"""

import uuid
from datetime import UTC, datetime

import sqlalchemy as sa
from alembic import command
from alembic.config import Config
from sqlmodel import Session, create_engine
from testcontainers.postgres import PostgresContainer

from app.api.popup.models import Popups
from app.api.tenant.models import Tenants

PREVIOUS_REVISION = "c4e81a2d7f90"
REVISION = "e3b7a91c5d20"


def _insert_event(connection, tenant_id, popup_id) -> uuid.UUID:
    event_id = uuid.uuid4()
    connection.execute(
        sa.text(
            """
            INSERT INTO events (
                id, tenant_id, popup_id, owner_id, title, start_time, end_time,
                timezone, status, visibility, require_approval, ical_sequence,
                created_at, updated_at
            ) VALUES (
                :id, :tenant_id, :popup_id, :owner_id, 'Talk',
                now(), now() + interval '1 hour', 'UTC', 'PUBLISHED', 'PUBLIC',
                false, 0, now(), now()
            )
            """
        ),
        {
            "id": event_id,
            "tenant_id": tenant_id,
            "popup_id": popup_id,
            "owner_id": uuid.uuid4(),
        },
    )
    return event_id


def _insert_participant(connection, tenant_id, event_id, status) -> uuid.UUID:
    participant_id = uuid.uuid4()
    connection.execute(
        sa.text(
            """
            INSERT INTO event_participants (
                id, tenant_id, event_id, profile_id, status, role,
                check_time, registered_at, created_at, updated_at
            ) VALUES (
                :id, :tenant_id, :event_id, :profile_id, :status, 'ATTENDEE',
                :check_time,
                now(), now(), now()
            )
            """
        ),
        {
            "id": participant_id,
            "tenant_id": tenant_id,
            "event_id": event_id,
            "profile_id": uuid.uuid4(),
            "status": status,
            "check_time": datetime.now(UTC) if status == "CHECKED_IN" else None,
        },
    )
    return participant_id


def test_backfill_marks_events_with_check_ins_and_logs_them():
    with PostgresContainer("postgres:17", driver="psycopg") as postgres:
        engine = create_engine(postgres.get_connection_url())
        with engine.begin() as connection:
            config = Config("alembic.ini")
            config.attributes["connection"] = connection
            command.upgrade(config, PREVIOUS_REVISION)

            with Session(connection) as session:
                tenant = Tenants(name="Tenant", slug="tenant")
                session.add(tenant)
                session.flush()
                popup = Popups(name="Popup", slug="popup", tenant_id=tenant.id)
                session.add(popup)
                session.flush()
                tenant_id, popup_id = tenant.id, popup.id
            attended = _insert_event(connection, tenant_id, popup_id)
            untouched = _insert_event(connection, tenant_id, popup_id)
            checked_in = _insert_participant(
                connection, tenant_id, attended, "CHECKED_IN"
            )
            _insert_participant(connection, tenant_id, attended, "REGISTERED")
            _insert_participant(connection, tenant_id, untouched, "REGISTERED")

            command.upgrade(config, REVISION)

            modes = dict(
                connection.execute(
                    sa.text("SELECT id, attendance_mode FROM events")
                ).all()
            )
            assert modes == {attended: "SELF_CHECKIN", untouched: "NONE"}
            logged = connection.execute(
                sa.text(
                    "SELECT participant_id, method, had_rsvp, voided_at "
                    "FROM event_check_ins"
                )
            ).all()
            assert [tuple(row) for row in logged] == [(checked_in, "QR", True, None)]

            command.downgrade(config, PREVIOUS_REVISION)
            command.upgrade(config, REVISION)
        engine.dispose()
