"""Sharing is opt-in for new humans without changing existing visibility."""

import uuid

from alembic import command
from alembic.config import Config
from sqlalchemy import text

from app.alembic.versions import a4f6b8d2c9e1_public_profile_link_opt_in as migration
from app.api.human.models import Humans


def test_model_defaults_to_private():
    human = Humans(tenant_id=uuid.uuid4(), email="private@example.com")
    assert human.public_profile_enabled is False


def test_migration_changes_only_default_and_preserves_sharing(migration_test_engine):
    with (
        migration_test_engine.connect() as connection,
        connection.begin() as transaction,
    ):
        config = Config("alembic.ini")
        config.attributes["connection"] = connection
        command.downgrade(config, migration.down_revision)

        tenant_id = uuid.uuid4()
        connection.execute(
            text("INSERT INTO tenants (id, name, slug) VALUES (:id, 'Sharing', :slug)"),
            {"id": tenant_id, "slug": f"sharing-{tenant_id}"},
        )

        def insert_human(*, enabled=None, token=None):
            human_id = uuid.uuid4()
            parameters = {
                "id": human_id,
                "tenant_id": tenant_id,
                "email": f"{human_id}@example.com",
                "token": token,
            }
            fields = "id, tenant_id, email, public_profile_token"
            values = ":id, :tenant_id, :email, :token"
            if enabled is not None:
                fields += ", public_profile_enabled"
                values += ", :enabled"
                parameters["enabled"] = enabled
            connection.execute(
                text(f"INSERT INTO humans ({fields}) VALUES ({values})"), parameters
            )
            return human_id

        def visibility(human_id):
            return connection.execute(
                text(
                    "SELECT public_profile_enabled, public_profile_token "
                    "FROM humans WHERE id = :id"
                ),
                {"id": human_id},
            ).one()

        shared = insert_human(enabled=True, token="shared-fixture-token")
        private = insert_human(enabled=False, token="private-fixture-token")
        legacy = insert_human()
        assert visibility(legacy).public_profile_enabled is True

        command.upgrade(config, migration.revision)
        assert tuple(visibility(shared)) == (True, "shared-fixture-token")
        assert tuple(visibility(private)) == (False, "private-fixture-token")
        assert visibility(legacy).public_profile_enabled is True

        new_human = insert_human()
        assert visibility(new_human).public_profile_enabled is False

        command.downgrade(config, migration.down_revision)
        assert visibility(insert_human()).public_profile_enabled is True
        assert tuple(visibility(shared)) == (True, "shared-fixture-token")
        assert visibility(private).public_profile_enabled is False
        assert visibility(new_human).public_profile_enabled is False
        transaction.rollback()
