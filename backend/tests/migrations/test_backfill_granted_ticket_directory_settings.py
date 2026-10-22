"""Keep legacy ticket grants visible without exposing opted-out attendees."""

from datetime import UTC, datetime
from decimal import Decimal

from alembic import command
from alembic.config import Config
from sqlmodel import Session, create_engine, select
from testcontainers.postgres import PostgresContainer

import app.models  # noqa: F401
from app.api.application.crud import applications_crud
from app.api.attendee.models import AttendeeProducts, Attendees
from app.api.attendee_category.models import AttendeeCategories
from app.api.human.models import HumanDirectorySettings, Humans
from app.api.popup.models import Popups
from app.api.product.models import Products
from app.api.sales_flow.models import SalesFlows
from app.api.tenant.models import Tenants

PREVIOUS_REVISION = "50c71da1e604"
REVISION = "8c24d7e0f13a"


def test_backfill_only_eligible_tickets_without_existing_settings():
    with PostgresContainer("postgres:17", driver="psycopg") as postgres:
        engine = create_engine(postgres.get_connection_url())
        with engine.begin() as connection:
            config = Config("alembic.ini")
            config.attributes["connection"] = connection
            command.upgrade(config, PREVIOUS_REVISION)

            with Session(
                bind=connection, join_transaction_mode="create_savepoint"
            ) as session:
                tenant = Tenants(name="Ticket grants", slug="ticket-grants")
                session.add(tenant)
                session.flush()
                popup = Popups(
                    tenant_id=tenant.id,
                    name="Ticket grants",
                    slug="ticket-grants",
                    directory_fields=[
                        {"id": "first_name", "source": "human", "key": "first_name"},
                        {"id": "last_name", "source": "human", "key": "last_name"},
                        {"id": "email", "source": "human", "key": "email"},
                        {
                            "id": "telegram",
                            "source": "human",
                            "key": "telegram",
                            "shareable": False,
                        },
                    ],
                )
                session.add(popup)
                session.flush()
                flow = SalesFlows(
                    tenant_id=tenant.id,
                    popup_id=popup.id,
                    type="application",
                    name="Default",
                    slug="default",
                    is_default=True,
                )
                session.add(flow)
                session.flush()
                main = AttendeeCategories(
                    tenant_id=tenant.id,
                    popup_id=popup.id,
                    sales_flow_id=flow.id,
                    key="main",
                    is_primary=True,
                    directory_eligible=True,
                )
                kid = AttendeeCategories(
                    tenant_id=tenant.id,
                    popup_id=popup.id,
                    sales_flow_id=flow.id,
                    key="kid",
                    directory_eligible=False,
                )
                product = Products(
                    tenant_id=tenant.id,
                    popup_id=popup.id,
                    name="Ticket",
                    slug="ticket",
                    price=Decimal("10"),
                    category="ticket",
                )
                session.add_all([main, kid, product])
                session.flush()

                people = {}
                for name, category, ticket_state in (
                    ("Granted", main, "active"),
                    ("OptedOut", main, "active"),
                    ("Child", kid, "active"),
                    ("Revoked", main, "revoked"),
                    ("WithoutTicket", main, "none"),
                ):
                    human = Humans(
                        tenant_id=tenant.id,
                        email=f"{name.lower()}@example.test",
                        first_name=name,
                        last_name="Person",
                    )
                    session.add(human)
                    session.flush()
                    attendee = Attendees(
                        tenant_id=tenant.id,
                        popup_id=popup.id,
                        human_id=human.id,
                        category_id=category.id,
                        application_id=None,
                        name=f"{name} Person",
                        email=human.email,
                    )
                    session.add(attendee)
                    session.flush()
                    if ticket_state != "none":
                        session.add(
                            AttendeeProducts(
                                tenant_id=tenant.id,
                                attendee_id=attendee.id,
                                product_id=product.id,
                                check_in_code=f"ticket-{name}",
                                product_category_snapshot="ticket",
                                revoked_at=(
                                    datetime.now(UTC)
                                    if ticket_state == "revoked"
                                    else None
                                ),
                            )
                        )
                    people[name] = human
                session.add(
                    HumanDirectorySettings(
                        tenant_id=tenant.id,
                        popup_id=popup.id,
                        human_id=people["OptedOut"].id,
                        listed=False,
                        shared_fields=["first_name"],
                    )
                )
                session.commit()

                command.upgrade(config, REVISION)
                session.expire_all()
                settings = {
                    row.human_id: row
                    for row in session.exec(
                        select(HumanDirectorySettings).where(
                            HumanDirectorySettings.popup_id == popup.id
                        )
                    )
                }
                assert set(settings) == {
                    people["Granted"].id,
                    people["OptedOut"].id,
                }
                assert settings[people["Granted"].id].listed is True
                assert settings[people["Granted"].id].shared_fields == [
                    "first_name",
                    "last_name",
                    "email",
                ]
                assert settings[people["OptedOut"].id].listed is False
                assert settings[people["OptedOut"].id].shared_fields == ["first_name"]

                rows, total = applications_crud.find_directory(session, popup.id)
                assert total == 1
                assert [row.human_id for row in rows] == [people["Granted"].id]
                rows, total = applications_crud.find_directory(
                    session, popup.id, q="granted@example.test"
                )
                assert total == 1
                assert [row.human_id for row in rows] == [people["Granted"].id]
                humans, total = applications_crud.find_directory_humans(
                    session, popup.id
                )
                assert total == 1
                assert [human.id for human in humans] == [people["Granted"].id]

                # Reapplying the backfill must respect a later opt-out.
                settings[people["Granted"].id].listed = False
                session.add(settings[people["Granted"].id])
                session.commit()
                command.downgrade(config, PREVIOUS_REVISION)
                command.upgrade(config, REVISION)
                session.expire_all()
                restored = session.exec(
                    select(HumanDirectorySettings).where(
                        HumanDirectorySettings.human_id == people["Granted"].id,
                        HumanDirectorySettings.popup_id == popup.id,
                    )
                ).one()
                assert restored.listed is False

        engine.dispose()
