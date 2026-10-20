from alembic import command
from alembic.config import Config
from sqlmodel import Session, create_engine, select
from testcontainers.postgres import PostgresContainer

import app.models  # noqa: F401
from app.api.application.models import Applications
from app.api.application.schemas import (
    ApplicationAdminCreate,
    ApplicationCreate,
    ApplicationPortalPublic,
    ApplicationUpdate,
)
from app.api.base_field_config.constants import BASE_FIELD_DEFINITIONS
from app.api.base_field_config.models import BaseFieldConfigs
from app.api.form_section.models import FormSections
from app.api.human.models import HumanDirectorySettings, Humans
from app.api.popup.models import Popups
from app.api.sales_flow.crud import sales_flows_crud
from app.api.tenant.models import Tenants

PREVIOUS_REVISION = "dcb07d3de9ee"
REVISION = "6f702315ea94"


def test_legacy_privacy_field_is_removed_from_active_forms_and_api_schemas():
    assert "info_not_shared" not in BASE_FIELD_DEFINITIONS
    for schema in (
        ApplicationCreate,
        ApplicationUpdate,
        ApplicationAdminCreate,
        ApplicationPortalPublic,
    ):
        assert "info_not_shared" not in schema.model_fields


def test_legacy_privacy_choices_move_to_popup_directory_settings():
    with PostgresContainer("postgres:17", driver="psycopg") as postgres:
        engine = create_engine(postgres.get_connection_url())
        with engine.begin() as connection:
            config = Config("alembic.ini")
            config.attributes["connection"] = connection
            command.upgrade(config, PREVIOUS_REVISION)

            with Session(
                bind=connection, join_transaction_mode="create_savepoint"
            ) as session:
                tenant = Tenants(name="Privacy migration", slug="privacy-migration")
                session.add(tenant)
                session.flush()
                popup = Popups(
                    tenant_id=tenant.id,
                    name="Privacy migration",
                    slug="privacy-migration",
                    show_attendee_directory=True,
                    directory_fields=[
                        {
                            "id": "first_name",
                            "label": "First name",
                            "source": "human",
                            "key": "first_name",
                        },
                        {
                            "id": "last_name",
                            "label": "Last name",
                            "source": "human",
                            "key": "last_name",
                        },
                        {
                            "id": "email",
                            "label": "Email",
                            "source": "human",
                            "key": "email",
                        },
                        {
                            "id": "telegram",
                            "label": "Telegram username",
                            "source": "human",
                            "key": "telegram",
                        },
                        {
                            "id": "application_role",
                            "label": "Role",
                            "source": "application",
                            "key": "role_in_the_organization",
                        },
                    ],
                )
                session.add(popup)
                session.flush()
                flow = sales_flows_crud.provision_default_flow(
                    session,
                    popup_id=popup.id,
                    tenant_id=tenant.id,
                    sale_type="application",
                )
                human = Humans(
                    tenant_id=tenant.id,
                    email="privacy@example.test",
                    first_name="Privacy",
                    last_name="Tester",
                )
                session.add(human)
                session.flush()
                no_attendee_human = Humans(
                    tenant_id=tenant.id,
                    email="no-attendee@example.test",
                    first_name="No",
                    last_name="Ticket",
                )
                session.add(no_attendee_human)
                session.flush()
                application = Applications(
                    tenant_id=tenant.id,
                    popup_id=popup.id,
                    human_id=human.id,
                    sales_flow_id=flow.id,
                    status="accepted",
                    info_not_shared=["Email", "Role"],
                )
                session.add(application)
                no_attendee_application = Applications(
                    tenant_id=tenant.id,
                    popup_id=popup.id,
                    human_id=no_attendee_human.id,
                    sales_flow_id=flow.id,
                    status="accepted",
                    info_not_shared=["Telegram"],
                )
                session.add(no_attendee_application)
                session.add(
                    HumanDirectorySettings(
                        tenant_id=tenant.id,
                        human_id=human.id,
                        popup_id=popup.id,
                        listed=True,
                        shared_fields=[],
                    )
                )
                section = FormSections(
                    tenant_id=tenant.id,
                    popup_id=popup.id,
                    sales_flow_id=flow.id,
                    label="Info not shared",
                    order=1,
                )
                session.add(section)
                session.flush()
                legacy_section_id = section.id
                session.add(
                    BaseFieldConfigs(
                        tenant_id=tenant.id,
                        popup_id=popup.id,
                        sales_flow_id=flow.id,
                        field_name="info_not_shared",
                        section_id=section.id,
                        position=0,
                        required=False,
                        label="Info I'm NOT willing to share",
                        options=["Email", "Role"],
                    )
                )
                session.commit()

                command.upgrade(config, REVISION)
                session.expire_all()

                settings = session.exec(
                    select(HumanDirectorySettings).where(
                        HumanDirectorySettings.human_id == human.id,
                        HumanDirectorySettings.popup_id == popup.id,
                    )
                ).one()
                assert settings.listed is True
                assert settings.shared_fields == [
                    "first_name",
                    "last_name",
                    "telegram",
                ]
                no_attendee_settings = session.exec(
                    select(HumanDirectorySettings).where(
                        HumanDirectorySettings.human_id == no_attendee_human.id,
                        HumanDirectorySettings.popup_id == popup.id,
                    )
                ).one()
                assert no_attendee_settings.shared_fields == [
                    "first_name",
                    "last_name",
                    "email",
                    "application_role",
                ]
                session.refresh(application)
                assert application.info_not_shared == []
                assert (
                    session.exec(
                        select(BaseFieldConfigs).where(
                            BaseFieldConfigs.field_name == "info_not_shared"
                        )
                    ).all()
                    == []
                )
                assert (
                    session.exec(
                        select(FormSections).where(FormSections.id == legacy_section_id)
                    ).first()
                    is None
                )

                command.downgrade(config, PREVIOUS_REVISION)
                session.expire_all()
                assert session.get(Applications, application.id).info_not_shared == [
                    "Email",
                    "Role",
                ]
                assert session.get(
                    Applications, no_attendee_application.id
                ).info_not_shared == ["Telegram"]
                assert session.exec(
                    select(BaseFieldConfigs).where(
                        BaseFieldConfigs.field_name == "info_not_shared"
                    )
                ).all()

        engine.dispose()
